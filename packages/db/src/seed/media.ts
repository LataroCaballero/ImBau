// seedMedia — the deterministic media producer + bounded-poll waiter (SEED-03, D-04/D-05,
// RESEARCH Pattern 2). This is the cycle-safe RE-COMPOSITION of the Phase-2 pipeline: it does the
// SAME work as registerAndEnqueue (packages/api/src/media/register.ts) but WITHOUT importing that
// package — importing it would create a db↔api package cycle (@imbau/api already depends on
// @imbau/db). Instead it composes the @imbau/storage primitives (makeR2Client, originalKey,
// MEDIA_QUEUE, mediaJobOptions, MediaJobData) + bullmq/ioredis/@aws-sdk directly.
//
// The ONE change over register.ts that makes the seed idempotent: the mediaId is DETERMINISTIC
// (seedId(name)) instead of randomUUID, and the media-row insert ends `.onConflictDoNothing()`.
// Deterministic mediaId ⇒ deterministic originalKey/variantKey ⇒ re-runs overwrite the same R2
// object in place and the worker write-back is an UPDATE, so a full re-run adds ZERO rows/objects
// (T-03-08). jobId=mediaId (mediaJobOptions) dedups re-enqueues.
//
// Flow per asset: skip-if-already-processed → PutObject original bytes → insert media row →
// enqueue → then poll every not-yet-ready row until `variants` is non-empty within a bounded
// timeout. Timeout ⇒ explicit "worker not consuming the queue" error (D-05 fail-fast, Pitfall 3).
// Secret hygiene (T-03-06): only the queue name is named in errors — never R2 keys/secrets.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  makeR2Client,
  originalKey,
  MEDIA_QUEUE,
  mediaJobOptions,
  type MediaJobData,
} from "@imbau/storage";
import { withTenant } from "../with-tenant";
import * as schema from "../schema";
import { seedId } from "./ids";
import { MEDIA_ASSETS } from "./content";

// The single source of truth for a logical asset's deterministic mediaId. Shared by seedMedia
// (which produces the rows/objects) and content-rows (which references the same ids in galleries /
// progress_posts) so both agree without one depending on the other's runtime output.
export function mediaSeedId(assetKey: string): string {
  return seedId(`brigos:media:${assetKey}`);
}

export interface SeedMediaOptions {
  /** Max time to wait for the worker to fill variants before failing fast (default 90s). */
  readonly pollTimeoutMs?: number;
  /** Delay between readiness polls (default 1500ms). */
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

// Directory holding the committed stock images (packages/db/src/seed/assets/).
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");

interface MediaEnv {
  readonly R2_ACCOUNT_ID: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly R2_BUCKET: string;
  readonly REDIS_URL: string;
}

// Read the media env fail-closed by NAME only (never a value — V7). assertSeedPrerequisites has
// already validated presence + reachability before runSeed reaches here; this is a defensive
// second gate so seedMedia is safe to call in isolation (e.g. from a test).
function readMediaEnv(): MediaEnv {
  const names = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "REDIS_URL",
  ] as const;
  const missing = names.filter((n) => {
    const v = process.env[n];
    return v === undefined || v.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `seedMedia: missing required env (names only, never values): ${missing.join(", ")}.`,
    );
  }
  return {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET: process.env.R2_BUCKET!,
    REDIS_URL: process.env.REDIS_URL!,
  };
}

// True once the worker has written at least one variant for this media (mirror of resolveMedia's
// isReady rule — a non-empty `variants` map). Read through withTenant (RLS write path, app role).
async function variantsReady(orgId: string, mediaId: string): Promise<boolean> {
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({ variants: schema.media.variants })
      .from(schema.media)
      .where(eq(schema.media.id, mediaId))
      .limit(1),
  );
  const row = rows[0];
  return row !== undefined && Object.keys(row.variants).length > 0;
}

/**
 * Seed every catalog asset through the REAL R2 + worker pipeline, idempotently. Returns a map of
 * logical asset key → deterministic mediaId (also derivable via mediaSeedId, so callers never need
 * this return to stay in sync). Throws a fail-fast error if the worker does not fill variants
 * within the bounded timeout (D-05).
 */
export async function seedMedia(
  orgId: string,
  projectId: string,
  opts?: SeedMediaOptions,
): Promise<Map<string, string>> {
  const env = readMediaEnv();
  const pollTimeoutMs = opts?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const r2 = makeR2Client(env);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(MEDIA_QUEUE, { connection });

  const idByKey = new Map<string, string>();
  // Assets we PUT + enqueued this run and must wait on (already-processed ones are skipped).
  const pending = new Set<string>();

  try {
    for (const asset of MEDIA_ASSETS) {
      const mediaId = mediaSeedId(asset.key);
      idByKey.set(asset.key, mediaId);
      const key = originalKey(orgId, projectId, mediaId, asset.ext);

      // Skip-if-processed: an already-resolved media needs neither re-upload nor re-enqueue.
      if (await variantsReady(orgId, mediaId)) continue;

      // 1. Upload the original bytes (deterministic key ⇒ overwrite in place on re-run).
      const bytes = await readFile(join(ASSETS_DIR, asset.file));
      await r2.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: asset.contentType,
        }),
      );

      // 2. Insert the media row via the RLS write path; onConflictDoNothing makes re-runs a no-op
      //    (this is the guard register.ts deliberately lacks — the seed adds it).
      await withTenant(orgId, (tx) =>
        tx
          .insert(schema.media)
          .values({
            id: mediaId,
            organizationId: orgId,
            projectId,
            originalKey: key,
          })
          .onConflictDoNothing(),
      );

      // 3. Enqueue processing (jobId=mediaId dedups re-enqueues of the same media).
      const job: MediaJobData = {
        mediaId,
        organizationId: orgId,
        projectId,
        originalKey: key,
      };
      await queue.add("process", job, mediaJobOptions(mediaId));
      pending.add(mediaId);
    }

    // 4. Bounded-poll waiter — wait for the worker to fill variants for every enqueued media.
    const deadline = Date.now() + pollTimeoutMs;
    while (pending.size > 0) {
      for (const mediaId of [...pending]) {
        if (await variantsReady(orgId, mediaId)) pending.delete(mediaId);
      }
      if (pending.size === 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `seedMedia: ${pending.size} media asset(s) still unprocessed after ${pollTimeoutMs}ms — ` +
            `the worker is not consuming the "${MEDIA_QUEUE}" queue. Is apps/worker running? ` +
            "(docker compose up -d worker).",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    // Always release the queue + Redis socket so the one-shot seed can exit cleanly.
    await queue.close();
    connection.disconnect();
    r2.destroy();
  }

  return idByKey;
}
