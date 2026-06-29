// Events partition maintenance (SCHEMA-06, D-06). PURE helpers + a thin executor.
//
// The `events` parent is a RANGE-partitioned table (BY RANGE (ts), one partition
// per month named `events_YYYY_MM`) whose initial partitions + a DEFAULT catch-all
// ship in migration 0003_rls_domain.sql. The DEFAULT partition (D-05) already
// guarantees no insert ever fails, so this job is the observability-friendly
// pre-creation path, NOT a hard dependency on the critical insert path.
//
// Phase-1 scope (D-06): pre-create NEXT month's partition idempotently. Retention/
// DETACH of old partitions is deferred — there is no DROP/DETACH here by design.
//
// The two PURE functions below are side-effect-free (no DB/Redis) so the date math +
// idempotent DDL are unit-testable without any running infra (see partitions.test.ts).
// `runPartitionMaintenance` at the bottom is the thin impure executor the BullMQ job
// calls; it owns the only side effects (one short-lived owner connection per run).

import postgres from "postgres";
import { logger } from "@imbau/observability";

// A computed partition spec: the table name plus the `[from, to)` range bounds as
// `YYYY-MM-01` date strings (from = the month's first day, to = the NEXT month's
// first day, exclusive — matching Postgres RANGE partition semantics).
export interface PartitionSpec {
  /** Partition table name, e.g. `events_2027_01`. */
  readonly name: string;
  /** Inclusive lower bound, the month's first day as `YYYY-MM-01`. */
  readonly from: string;
  /** Exclusive upper bound, the NEXT month's first day as `YYYY-MM-01`. */
  readonly to: string;
}

// Zero-pad a 1-based month (1..12) to a two-char string (`1` → `01`).
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// Format a UTC year + 1-based month as the first-of-month date string `YYYY-MM-01`.
function firstOfMonth(year: number, month1: number): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month1)}-01`;
}

/**
 * Compute NEXT month's partition spec for a reference instant, in UTC.
 *
 * Given any `Date`, returns the partition that covers the month AFTER the
 * reference month: the `events_YYYY_MM` name (UTC year/month of next month,
 * zero-padded) and the `[from, to)` bounds as `YYYY-MM-01` strings (from = next
 * month's first day, to = the month after that, exclusive). Year rollover
 * (December → next January) is handled in UTC so it never drifts by local TZ.
 */
export function nextMonthPartitionSpec(reference: Date): PartitionSpec {
  // getUTCMonth() is 0-based; +1 → 1-based current month, +1 again → next month.
  // Normalizing through 1-based math keeps the December → January (year +1)
  // rollover correct without manual wraparound branches.
  const refYear = reference.getUTCFullYear();
  const refMonth1 = reference.getUTCMonth() + 1; // 1..12 current month

  // Next month (1-based). If current is December (12), this becomes 13 → roll to
  // January of the following year.
  let nextYear = refYear;
  let nextMonth1 = refMonth1 + 1;
  if (nextMonth1 > 12) {
    nextMonth1 = 1;
    nextYear += 1;
  }

  // The month AFTER next month, for the exclusive upper bound.
  let afterYear = nextYear;
  let afterMonth1 = nextMonth1 + 1;
  if (afterMonth1 > 12) {
    afterMonth1 = 1;
    afterYear += 1;
  }

  return {
    name: `events_${nextYear.toString().padStart(4, "0")}_${pad2(nextMonth1)}`,
    from: firstOfMonth(nextYear, nextMonth1),
    to: firstOfMonth(afterYear, afterMonth1),
  };
}

/**
 * Render the idempotent `CREATE TABLE IF NOT EXISTS` DDL for a partition spec.
 *
 * Mirrors the hand-written DDL style in migration 0003_rls_domain.sql:
 *   CREATE TABLE IF NOT EXISTS "events_YYYY_MM" PARTITION OF "events"
 *     FOR VALUES FROM ('<from>') TO ('<to>')
 *
 * `IF NOT EXISTS` makes re-running a no-op (T-01-17: never corrupt partitions on
 * re-run); there is NO DROP/DETACH here. Inputs are derived purely from
 * `nextMonthPartitionSpec` (computed `YYYY-MM-DD` constants), so the string is not
 * built from any external/untrusted value.
 */
export function renderCreatePartitionSql(spec: PartitionSpec): string {
  return (
    `CREATE TABLE IF NOT EXISTS "${spec.name}" PARTITION OF "events" ` +
    `FOR VALUES FROM ('${spec.from}') TO ('${spec.to}')`
  );
}

// The repeatable job's queue name. Exported so index.ts (scheduler + worker) and
// any future test reference a single source of truth.
export const PARTITIONS_QUEUE = "partitions-maintenance";

/**
 * Impure executor for the monthly pre-create job (D-06 skeleton scope).
 *
 * Opens a SHORT-LIVED owner connection, runs the idempotent next-month partition
 * DDL, logs a structured pino line on success, and always closes the connection.
 *
 * Owner role + raw `process.env.DATABASE_URL` (NOT the worker's env.ts): creating a
 * partition of `events` is DDL on a migration-owned table, which only the OWNER role
 * may run — exactly the connection string `packages/db/migrate.ts` uses. We read the
 * raw var the same way migrate.ts does so the worker's BOOT-time env validation
 * (which has no DATABASE_URL — APP-03 Redis shell) stays unchanged: the owner URL is
 * required only when this job actually fires, and we fail loudly with the var NAME
 * (never the value — V7) if it is absent. `max: 1` keeps the one-off DDL
 * deterministic. Errors propagate to the BullMQ processor → pino + Sentry
 * (./instrument); they are never swallowed.
 */
export async function runPartitionMaintenance(
  reference: Date = new Date(),
): Promise<PartitionSpec> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL: the partition-maintenance job needs the OWNER-role connection string to run partition DDL.",
    );
  }

  const spec = nextMonthPartitionSpec(reference);
  const ddl = renderCreatePartitionSql(spec);

  // OWNER role, single connection — mirrors packages/db/migrate.ts.
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // The DDL is built purely from computed YYYY-MM-DD constants (no external
    // input), so `unsafe` here carries no injection surface — it is the postgres.js
    // way to run a non-parameterized DDL string. IF NOT EXISTS makes re-runs no-ops.
    await sql.unsafe(ddl);
    logger.info(
      { queue: PARTITIONS_QUEUE, partition: spec.name, from: spec.from, to: spec.to },
      "events partition ensured (pre-create next month)",
    );
    return spec;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
