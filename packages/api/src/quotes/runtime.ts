// The quote-PDF RUNTIME (PDF-01) — the side-effectful seam for the quotes router: the R2 S3
// client (presigned GET) and the BullMQ producer that enqueues quote-PDF render jobs. The tRPC
// router (trpc/routers/quotes.ts) imports ONLY the small verbs exported here — it never
// constructs an S3Client or a Queue itself, keeping the credentials + Redis connection in one
// place (EXACT analog of media/runtime.ts).
//
// LAZY, MEMOIZED INITIALIZATION (Pitfall 3 — mirrors media/runtime.ts): the appRouter composes
// this router, and the web/panel apps (plus sibling integration tests) import the appRouter
// WITHOUT ever calling a quotes procedure. If env validation + the IORedis/Queue construction
// ran at module import, merely importing the router would (a) require R2_* + REDIS_URL to be
// present everywhere the router is referenced and (b) open a live Redis socket as an import side
// effect. Both are wrong for a path that may never enqueue. So env is parsed and the clients are
// built on FIRST USE and cached. Env still fails CLOSED: the first enqueuePdf/presignPdfGet call
// validates r2Env + redisEnv via @t3-oss/env-core and throws with the variable NAME (never the
// value — V7). The quotes-router test vi.mocks this whole module, so no live infra runs under test.
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, r2Env, redisEnv } from "@imbau/config/env/presets";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  makeR2Client,
  QUOTE_PDF_QUEUE,
  quotePdfJobOptions,
  type QuotePdfJobData,
} from "@imbau/storage";

type QuoteRuntimeEnv = {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  R2_PUBLIC_BASE_URL: string;
  REDIS_URL: string;
  NODE_ENV: "development" | "test" | "production";
};

let cachedEnv: QuoteRuntimeEnv | undefined;
let cachedR2: S3Client | undefined;
let cachedQueue: Queue | undefined;

// Validate + cache env on first use (fail-closed). SKIP_ENV_VALIDATION=1 is honored only for
// the Docker build (no secrets at build time); at runtime it is unset.
function getEnv(): QuoteRuntimeEnv {
  cachedEnv ??= createEnv({
    server: {
      ...baseEnv.server,
      ...r2Env.server,
      ...redisEnv.server,
    },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  }) as QuoteRuntimeEnv;
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
    cachedQueue = new Queue(QUOTE_PDF_QUEUE, { connection });
  }
  return cachedQueue;
}

// The target R2 bucket (validated). Exposed for callers/diagnostics that need the bucket name.
export function r2Bucket(): string {
  return getEnv().R2_BUCKET;
}

// Enqueue the quote-PDF render job with the deterministic options (jobId = quoteId dedups
// re-enqueues — the PDF-02 idempotency seam). The worker (wave 2) consumes QUOTE_PDF_QUEUE.
export async function enqueuePdf(data: QuotePdfJobData): Promise<void> {
  await getQueue().add("render", data, quotePdfJobOptions(data.quoteId));
}

// Presign a single GetObject URL bound to ONE key, short-lived (300s — re-requestable, D-04).
// The buyer's browser fetches the PDF bytes directly from R2 with this URL; the Next process
// never proxies PDF bytes. ResponseContentDisposition forces a download named cotizacion.pdf.
export function presignPdfGet(key: string): Promise<string> {
  return getSignedUrl(
    getR2(),
    new GetObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: 'attachment; filename="cotizacion.pdf"',
    }),
    { expiresIn: 300 },
  );
}
