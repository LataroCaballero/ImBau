import { describe, it, expect, afterEach } from "vitest";
import { createConnection, createHealthWorker } from "./index";
import type IORedis from "ioredis";
import type { Worker } from "bullmq";

// Smoke test (APP-03, RESEARCH Pattern 6): proves the worker shell actually
// connects to the Compose Redis (host :6380 → container 6379) and the BullMQ
// Worker reaches its "ready" state. This is the load-bearing assertion of the
// deployable shell — a worker that cannot reach Redis is not deployable.
//
// Requires the Compose Redis to be up; the local/CI env sets REDIS_URL to
// redis://localhost:6380. BullMQ requires `maxRetriesPerRequest: null` on the
// ioredis connection — createConnection enforces it; without it the Worker would
// throw instead of connecting.
describe("worker connects", () => {
  const openConnections: IORedis[] = [];
  const openWorkers: Worker[] = [];

  afterEach(async () => {
    // Close workers first (they hold their own duplicated connections), then the
    // shared connection, so the test process exits cleanly with no open handles.
    await Promise.all(openWorkers.splice(0).map((w) => w.close()));
    await Promise.all(openConnections.splice(0).map((c) => c.quit()));
  });

  it("reaches Redis and the BullMQ Worker becomes ready", async () => {
    const connection = createConnection();
    openConnections.push(connection);

    // maxRetriesPerRequest: null is REQUIRED by BullMQ — assert the shell set it.
    expect(connection.options.maxRetriesPerRequest).toBeNull();

    const worker = createHealthWorker(connection);
    openWorkers.push(worker);

    // The Worker emits "ready" once its (duplicated) connection is established.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("worker did not become ready within 10s")),
        10_000,
      );
      worker.on("ready", () => {
        clearTimeout(timer);
        resolve();
      });
      worker.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // A live PING through the shared connection confirms the Redis round-trip.
    await expect(connection.ping()).resolves.toBe("PONG");
  }, 15_000);
});
