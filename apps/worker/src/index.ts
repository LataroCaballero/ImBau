// Import Sentry instrumentation FIRST (OBS-01) — before ./env and any other
// module — so @sentry/node patches the libraries it instruments as they load.
import "./instrument";
// Import env next so validation runs at boot and fails closed on bad/missing
// vars (MONO-03, D-03), BEFORE any Redis/BullMQ wiring touches process.env.
import { env } from "./env";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import { logger } from "@imbau/observability";
import { PARTITIONS_QUEUE, runPartitionMaintenance } from "./partitions";

// Deployable BullMQ shell (APP-03 / D-16, RESEARCH Pattern 6). This phase the
// worker only proves it can reach Redis and stand up a Worker — there is NO real
// job logic (heavy jobs: media variants, PDFs, land with later milestones).
// Observability (phase 4): Sentry is initialized via ./instrument and structured
// logs go through the shared @imbau/observability pino logger (OBS-01/OBS-02).

// The BullMQ health queue/worker channel name. One channel is enough for the shell.
const HEALTH_QUEUE = "health";

// Stable scheduler id for the repeatable partition-maintenance job. A fixed id makes
// upsertJobScheduler idempotent — re-running boot() updates the SAME schedule instead
// of stacking duplicates.
const PARTITIONS_SCHEDULER_ID = "events-partition-monthly";

// Cron pattern: 03:00 UTC on the 1st of every month (minute hour day-of-month month
// day-of-week). Pre-creates NEXT month's partition with ~a month of head room; the
// DEFAULT partition (D-05) is the safety net so timing is non-critical.
const PARTITIONS_CRON = "0 3 1 * *";

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

// Build the BullMQ Worker that runs the events-partition pre-create job (D-06). The
// processor delegates to the pure-helper-backed executor in partitions.ts, which
// opens its own short-lived OWNER connection per run (no Postgres handle is held open
// between jobs). Errors propagate so BullMQ marks the job failed → pino + Sentry.
export function createPartitionWorker(connection: IORedis): Worker {
  return new Worker(PARTITIONS_QUEUE, () => runPartitionMaintenance(), {
    connection,
  });
}

// Boot the shell: open the connection, register the (idle) health queue + the
// repeatable events-partition maintenance schedule (D-06), stand up both workers, and
// log a structured JSON line once Redis is reached. Returns the handles so a caller
// could close them; the long-running process keeps them open. Async because
// upsertJobScheduler talks to Redis to register the monthly schedule.
export async function boot(): Promise<{
  connection: IORedis;
  queue: Queue;
  worker: Worker;
  partitionsQueue: Queue;
  partitionWorker: Worker;
}> {
  const connection = createConnection();
  const queue = new Queue(HEALTH_QUEUE, { connection });
  const worker = createHealthWorker(connection);

  worker.on("ready", () => {
    logger.info(
      { node_env: env.NODE_ENV, queue: HEALTH_QUEUE },
      "worker connected to Redis, awaiting jobs",
    );
  });

  // Events-partition maintenance (SCHEMA-06 / D-06): a repeatable monthly job that
  // pre-creates NEXT month's events_YYYY_MM partition idempotently. upsertJobScheduler
  // is itself idempotent on PARTITIONS_SCHEDULER_ID — re-booting updates the schedule
  // rather than duplicating it. The DEFAULT partition (D-05) keeps this OFF the
  // critical insert path; retention/detach is intentionally deferred past phase 1.
  const partitionsQueue = new Queue(PARTITIONS_QUEUE, { connection });
  await partitionsQueue.upsertJobScheduler(
    PARTITIONS_SCHEDULER_ID,
    { pattern: PARTITIONS_CRON },
    { name: "ensure-next-month-partition" },
  );
  const partitionWorker = createPartitionWorker(connection);

  // Preserve the env-first boot log so deploy smoke checks still see it.
  logger.info({ node_env: env.NODE_ENV }, "worker boot ok");

  return { connection, queue, worker, partitionsQueue, partitionWorker };
}

// Auto-boot ONLY when this module is the process entrypoint (i.e. `node dist/index.js`
// / `tsx src/index.ts`), NOT when imported by the smoke test — otherwise the test
// would spin up a second connection/worker it never closes (open-handle leak). boot()
// now returns a Promise; surface any boot-time rejection (pino + Sentry via
// ./instrument) instead of leaving an unhandled rejection.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  boot().catch((err: unknown) => {
    logger.error({ err }, "worker boot failed");
    process.exitCode = 1;
  });
}
