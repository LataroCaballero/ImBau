// Import env FIRST so validation runs at boot and fails closed on bad/missing
// vars (MONO-03, D-03), BEFORE any Redis/BullMQ wiring touches process.env.
import { env } from "./env";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";

// Deployable BullMQ shell (APP-03 / D-16, RESEARCH Pattern 6). This phase the
// worker only proves it can reach Redis and stand up a Worker — there is NO real
// job logic (heavy jobs: media variants, PDFs, land with later milestones). No
// Sentry / pino / OTel here either — observability is phase 4 (scope guard).

// The BullMQ health queue/worker channel name. One channel is enough for the shell.
const HEALTH_QUEUE = "health";

// Build the ioredis connection. `maxRetriesPerRequest: null` is REQUIRED by BullMQ
// (its blocking commands throw otherwise) — the smoke test asserts it is null.
// Factored out so the test can construct + close a connection deterministically
// without triggering the module's auto-boot.
export function createConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

// Build the BullMQ Worker on the health queue. The processor is a no-op shell
// (returns "ok") — there is no real job logic this phase (D-16/APP-03).
export function createHealthWorker(connection: IORedis): Worker {
  // No-op processor — the shell has no real job logic (D-16/APP-03). Returns a
  // resolved Promise (not `async`, which would lint as await-less) to satisfy
  // BullMQ's Processor signature.
  return new Worker(HEALTH_QUEUE, () => Promise.resolve("ok"), { connection });
}

// Boot the shell: open the connection, register the (idle) health queue, stand up
// the worker, and log a structured JSON line once it reaches Redis. Returns the
// handles so a caller could close them; the long-running process keeps them open.
export function boot(): {
  connection: IORedis;
  queue: Queue;
  worker: Worker;
} {
  const connection = createConnection();
  const queue = new Queue(HEALTH_QUEUE, { connection });
  const worker = createHealthWorker(connection);

  worker.on("ready", () => {
    console.log(
      JSON.stringify({
        msg: "worker connected to Redis, awaiting jobs",
        node_env: env.NODE_ENV,
        queue: HEALTH_QUEUE,
      }),
    );
  });

  // Preserve the env-first boot log so deploy smoke checks still see it.
  console.log(
    JSON.stringify({ msg: "worker boot ok", node_env: env.NODE_ENV }),
  );

  return { connection, queue, worker };
}

// Auto-boot ONLY when this module is the process entrypoint (i.e. `node dist/index.js`
// / `tsx src/index.ts`), NOT when imported by the smoke test — otherwise the test
// would spin up a second connection/worker it never closes (open-handle leak).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  boot();
}
