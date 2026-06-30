// The media RUNTIME (MEDIA-01) — the side-effectful seam for the media router: the R2 S3
// client (presign + HeadObject) and the BullMQ producer that enqueues processing jobs. The
// tRPC router (trpc/routers/media.ts) and the seed helper (./register) import ONLY the small
// verbs exported here — they never construct an S3Client or a Queue themselves, keeping the
// credentials + Redis connection in one place.
//
// LAZY, MEMOIZED INITIALIZATION (deviation from auth/runtime's eager pattern — see below):
// the appRouter composes this router, and the web/panel apps (plus sibling integration tests
// like trpc-tenant) import the appRouter WITHOUT ever calling a media procedure. If env
// validation + the IORedis/Queue construction ran at module import (like auth/runtime), merely
// importing the router would (a) require R2_* + REDIS_URL to be present everywhere the router
// is referenced and (b) open a live Redis socket as an import side effect. Both are wrong for a
// path that may never enqueue. So env is parsed and the clients are built on FIRST USE and
// cached. Env still fails CLOSED: the first presignPut/headOriginal/enqueueMedia call validates
// r2Env + redisEnv via @t3-oss/env-core and throws with the variable NAME (never the value —
// V7). The media-router test vi.mocks this whole module, so no live infra runs under test.
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, r2Env, redisEnv } from "@imbau/config/env/presets";
import {
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  makeR2Client,
  MEDIA_QUEUE,
  mediaJobOptions,
  type MediaJobData,
} from "@imbau/storage";

type MediaEnv = {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  R2_PUBLIC_BASE_URL: string;
  REDIS_URL: string;
  NODE_ENV: "development" | "test" | "production";
};

let cachedEnv: MediaEnv | undefined;
let cachedR2: S3Client | undefined;
let cachedQueue: Queue | undefined;

// Validate + cache env on first use (fail-closed). SKIP_ENV_VALIDATION=1 is honored only for
// the fase-3 Docker build (no secrets at build time); at runtime it is unset.
function getEnv(): MediaEnv {
  cachedEnv ??= createEnv({
    server: {
      ...baseEnv.server,
      ...r2Env.server,
      ...redisEnv.server,
    },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  }) as MediaEnv;
  return cachedEnv;
}

// The configured R2 client (the checksum opt-out lives in makeR2Client — RESEARCH Pattern 1).
function getR2(): S3Client {
  cachedR2 ??= makeR2Client(getEnv());
  return cachedR2;
}

// The BullMQ producer. maxRetriesPerRequest: null is REQUIRED by BullMQ's blocking commands
// (the same contract apps/worker/src/index.ts uses). Built on first enqueue so importing the
// router never opens a Redis socket.
function getQueue(): Queue {
  if (!cachedQueue) {
    const connection = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    cachedQueue = new Queue(MEDIA_QUEUE, { connection });
  }
  return cachedQueue;
}

// The target R2 bucket (validated). Exposed for callers/diagnostics that need the bucket name.
export function r2Bucket(): string {
  return getEnv().R2_BUCKET;
}

// Presign a single PutObject URL bound to ONE key + content-type, short-lived (1h). The
// browser PUTs the original bytes directly to R2 with this URL; the API never proxies bytes.
export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    getR2(),
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, ContentType: contentType }),
    { expiresIn: 3600 },
  );
}

// HeadObject the original to confirm the bytes actually landed before enqueueing (RESEARCH
// Pitfall 4: no object → no job). A 404/NotFound resolves to false; any OTHER error propagates
// (errors stay observable — never silently swallowed, per CLAUDE.md).
export async function headOriginal(key: string): Promise<boolean> {
  try {
    await getR2().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }));
    return true;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "NotFoundException") {
      return false;
    }
    throw err;
  }
}

// Enqueue the processing job with the deterministic options (jobId = mediaId dedups
// re-enqueues — MEDIA-04). The worker (plan 02-02) consumes MEDIA_QUEUE.
export async function enqueueMedia(data: MediaJobData): Promise<void> {
  await getQueue().add("process", data, mediaJobOptions(data.mediaId));
}
