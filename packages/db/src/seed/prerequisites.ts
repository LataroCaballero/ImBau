// assertSeedPrerequisites — the D-05 fail-fast startup guard (RESEARCH Pattern, PATTERNS §162-166).
//
// The seed is demo-grade and NOT optional: if the infra it needs is missing, it must abort BEFORE
// any partial write with a single explicit "what is missing + how to provide it" error — never
// warn-and-continue (D-05, CLAUDE.md "errores observables, nunca silenciados").
//
// Security (ASVS V7, mirrors migrate.ts:34-38 + env.ts): the error reports the missing variable
// NAMES only — never their values — so a misconfigured run fails loudly without leaking secrets.
//
// `skipMedia` lets pure-DB runs (and the DB-only tests) proceed without R2/Redis: it drops the
// media env requirements and skips the R2/Redis reachability probes. A full run (skipMedia=false)
// additionally requires the R2_* + REDIS_URL vars and probes R2 (HeadBucket) and Redis (PING).
import IORedis from "ioredis";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { makeR2Client } from "@imbau/storage";

// Owner/app/anon connection strings — always required (the seed cannot write without them).
const DB_VARS = ["DATABASE_URL", "DATABASE_APP_URL", "DATABASE_ANON_URL"] as const;
// Media pipeline vars — required only when media is being seeded (skipMedia=false).
const MEDIA_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "REDIS_URL",
] as const;

function missingVarNames(names: readonly string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0;
  });
}

export async function assertSeedPrerequisites(opts?: { skipMedia?: boolean }): Promise<void> {
  const skipMedia = opts?.skipMedia ?? false;

  // 1. Env presence — collect ALL missing NAMES at once (never values, V7).
  const required = skipMedia ? [...DB_VARS] : [...DB_VARS, ...MEDIA_VARS];
  const missing = missingVarNames(required);
  if (missing.length > 0) {
    const mediaHint = skipMedia
      ? ""
      : " Media seeding also needs a running apps/worker to process the queued media jobs.";
    throw new Error(
      `Missing required env for pnpm db:seed: ${missing.join(", ")}. ` +
        "Bring up the infra (docker compose up -d postgres redis worker) and export these " +
        `variables (only their NAMES are shown — never values).${mediaHint}`,
    );
  }

  if (skipMedia) return;

  // 2. R2 reachability (HeadBucket). Uses makeR2Client (never a raw S3Client — CRC32 opt-out).
  const r2 = makeR2Client({
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
  });
  try {
    await r2.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET! }));
  } catch (cause) {
    throw new Error(
      "R2 is not reachable: HeadBucket on the configured R2_BUCKET failed. Verify the R2 " +
        "credentials + bucket and network access (names only; no secret values logged).",
      { cause },
    );
  } finally {
    r2.destroy();
  }

  // 3. Redis reachability (PING). maxRetriesPerRequest: null matches the BullMQ producer contract;
  // lazyConnect so we control connect/PING and never dangle a background reconnect loop.
  const redis = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch (cause) {
    throw new Error(
      "Redis is not reachable: PING via REDIS_URL failed. Is Redis up (docker compose up -d redis)?",
      { cause },
    );
  } finally {
    redis.disconnect();
  }
}
