// seed.media — SEED-03 / D-04 real-pipeline proof, ENV-GATED.
//
// This suite exercises the WHOLE media path end-to-end: the seed PUTs the committed originals to
// R2, enqueues processing, and apps/worker fills AVIF/WebP variants + blurhash + dims, after which
// every media row must resolve via resolveMedia().isReady === true. That needs live R2 creds + a
// running worker, so it is `describe.skipIf`-gated on the media env being present. A cleanly
// SKIPPED run (R2/Redis absent — e.g. local/CI without secrets) is the CORRECT green outcome; the
// live-R2 proof defers to operator/UAT verification (as Phase 2 did). It never runs registerAnd-
// Enqueue and never imports @imbau/api — media.ts composes the storage primitives directly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { connectAs, ownerUrl } from "./db";
import { runSeed } from "../seed";
import { seedId } from "../src/seed/ids";
import { resolveMedia } from "../src/resolve-media";
import { MEDIA_ASSETS } from "../src/seed/content";

// The media path needs ALL of these; when any is missing we skip (the designed no-infra outcome).
const MEDIA_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "REDIS_URL",
] as const;
const hasMediaInfra = MEDIA_ENV.every((n) => {
  const v = process.env[n];
  return v !== undefined && v.length > 0;
});

const ORG_ID = seedId("brigos:org");

type MediaRowDb = {
  originalKey: string;
  variants: Record<string, string>;
  width: number | null;
  height: number | null;
  blurhash: string | null;
};

describe.skipIf(!hasMediaInfra)(
  "seed media resolves through the real R2 + worker pipeline (SEED-03/D-04)",
  () => {
    let owner: ReturnType<typeof connectAs>;

    async function selectMedia(): Promise<MediaRowDb[]> {
      const rows = await owner.db.execute<MediaRowDb>(
        sql`select original_key as "originalKey", variants, width, height, blurhash
              from media where organization_id = ${ORG_ID}`,
      );
      return [...rows];
    }

    beforeAll(async () => {
      owner = connectAs(ownerUrl());
      // Full seed WITH media (skipMedia defaults false) — requires R2 + a running worker.
      await runSeed();
    }, 180_000);

    afterAll(async () => {
      await owner.sql.end({ timeout: 5 });
    });

    it("every seeded media row is fully resolved (variants + blurhash + dims)", async () => {
      const rows = await selectMedia();
      expect(rows.length).toBeGreaterThanOrEqual(MEDIA_ASSETS.length);
      const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL!;
      for (const row of rows) {
        const resolved = resolveMedia(row, { publicBaseUrl });
        expect(resolved.isReady).toBe(true);
        expect(resolved.srcset.avif.length).toBeGreaterThan(0);
        expect(resolved.srcset.webp.length).toBeGreaterThan(0);
        expect(resolved.blurhash).toBeTruthy();
        expect(resolved.width ?? 0).toBeGreaterThan(0);
        expect(resolved.height ?? 0).toBeGreaterThan(0);
      }
    }, 180_000);

    it("a second full run leaves the media row count unchanged (idempotent)", async () => {
      const before = (await selectMedia()).length;
      await runSeed();
      const after = (await selectMedia()).length;
      expect(after).toBe(before);
    }, 180_000);
  },
);
