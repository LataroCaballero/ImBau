// The lead-email RUNTIME (LEADS-04) — the side-effectful enqueue seam for the leads router: the
// BullMQ producer that pushes lead-notification jobs onto LEAD_EMAIL_QUEUE. The tRPC router
// (trpc/routers/leads.ts) imports ONLY the small `enqueueLeadEmail` verb exported here — it never
// constructs a Queue itself, keeping the Redis connection in one place (EXACT analog of
// quotes/runtime.ts, stripped of the R2/S3 half — leads need no object storage).
//
// LAZY, MEMOIZED INITIALIZATION (Pitfall 3 — mirrors quotes/runtime.ts): the appRouter composes
// this router, and the web/panel apps (plus sibling integration tests) import the appRouter WITHOUT
// ever calling leads.create. If env validation + the IORedis/Queue construction ran at module
// import, merely importing the router would (a) require REDIS_URL to be present everywhere the
// router is referenced and (b) open a live Redis socket as an import side effect. Both are wrong for
// a path that may never enqueue. So env is parsed and the queue is built on FIRST USE and cached.
// Env still fails CLOSED: the first enqueueLeadEmail call validates baseEnv + redisEnv via
// @t3-oss/env-core and throws with the variable NAME (never the value — V7). The leads-role-gate
// test vi.mocks this whole module, so no live infra runs under test.
//
// NO EMAIL SEND HERE: this module only pushes the job (ids-only payload). The actual Resend
// dispatch + recipient resolution happen in the worker (Plan 04) — a Redis push failure surfaces as
// the create error (observable), but the email delivery never blocks the request.
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, redisEnv } from "@imbau/config/env/presets";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  LEAD_EMAIL_QUEUE,
  leadEmailJobOptions,
  type LeadEmailJobData,
} from "@imbau/storage";

type LeadRuntimeEnv = {
  REDIS_URL: string;
  NODE_ENV: "development" | "test" | "production";
};

let cachedEnv: LeadRuntimeEnv | undefined;
let cachedQueue: Queue | undefined;

// Validate + cache env on first use (fail-closed). SKIP_ENV_VALIDATION=1 is honored only for the
// Docker build (no secrets at build time); at runtime it is unset. Only baseEnv + redisEnv are
// composed here — the object-storage preset is deliberately omitted (leads never touch R2).
function getEnv(): LeadRuntimeEnv {
  cachedEnv ??= createEnv({
    server: {
      ...baseEnv.server,
      ...redisEnv.server,
    },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  }) as LeadRuntimeEnv;
  return cachedEnv;
}

// The BullMQ producer. maxRetriesPerRequest: null is REQUIRED by BullMQ's blocking commands (the
// same contract apps/worker/src/index.ts uses). Built on first enqueue so importing the router
// never opens a Redis socket.
function getQueue(): Queue {
  if (!cachedQueue) {
    const connection = new IORedis(getEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    cachedQueue = new Queue(LEAD_EMAIL_QUEUE, { connection });
  }
  return cachedQueue;
}

// Enqueue the lead-notification job with the deterministic options (jobId = `lead:{id}:created`
// dedups re-enqueues — the LEADS-04 idempotency seam). Called as the post-commit side-effect of a
// successful leads.create persist (OUTSIDE the withTenant tx). The worker (Plan 04) consumes
// LEAD_EMAIL_QUEUE, re-reads the lead under RLS, resolves the recipient, and sends via Resend.
export async function enqueueLeadEmail(data: LeadEmailJobData): Promise<void> {
  await getQueue().add("notify", data, leadEmailJobOptions(data.leadId));
}
