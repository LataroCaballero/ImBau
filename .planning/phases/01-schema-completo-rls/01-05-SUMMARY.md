---
phase: 01-schema-completo-rls
plan: 05
subsystem: infra
tags: [bullmq, worker, postgres, partitions, events, pino, cron]

# Dependency graph
requires:
  - phase: 01-04
    provides: "events parent table (PARTITION BY RANGE ts) + initial monthly partitions + DEFAULT catch-all in migration 0003_rls_domain.sql"
provides:
  - "Pure, unit-tested partition helpers: nextMonthPartitionSpec (UTC next-month bounds + events_YYYY_MM name) and renderCreatePartitionSql (idempotent CREATE TABLE IF NOT EXISTS ... PARTITION OF events)"
  - "runPartitionMaintenance executor: short-lived OWNER connection that runs the next-month partition DDL idempotently and logs via pino"
  - "Repeatable monthly BullMQ job (upsertJobScheduler, cron 0 3 1 * *) + createPartitionWorker registered in the worker boot() alongside the health shell"
affects: [events, analytics, metrics, observability, worker]

# Tech tracking
tech-stack:
  added: [postgres@3.4.9 (porsager driver, added to apps/worker)]
  patterns:
    - "Pure date/SQL helpers separated from a thin impure executor so partition math is unit-testable without DB/Redis"
    - "BullMQ repeatable job via upsertJobScheduler with a stable scheduler id (idempotent re-registration on every boot)"
    - "Owner-role DDL reads raw process.env.DATABASE_URL at call-time (mirrors packages/db/migrate.ts) so the worker's boot-time env validation stays Redis-only"

key-files:
  created:
    - apps/worker/src/partitions.ts
    - apps/worker/src/partitions.test.ts
  modified:
    - apps/worker/src/index.ts
    - apps/worker/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Added postgres@3.4.9 to the worker (already a monorepo dep via packages/db) rather than routing DDL through @imbau/db — the executor needs only a one-off OWNER connection, matching migrate.ts"
  - "boot() became async to await upsertJobScheduler; auto-boot guard now surfaces boot rejections via pino + process.exitCode (errors never swallowed)"
  - "Executor reads raw process.env.DATABASE_URL (not the worker env.ts) so worker boot still requires only NODE_ENV + REDIS_URL; the owner URL is needed only when the monthly job fires, failing loudly by NAME if absent"
  - "Cron 0 3 1 * * (03:00 UTC on the 1st) pre-creates next month with ~a month of head room; DEFAULT partition (D-05) keeps this off the critical insert path"

patterns-established:
  - "Pattern 1: pure-helper + thin-executor split for any side-effecting worker job (test the pure core, keep I/O at the edge)"
  - "Pattern 2: idempotent partition DDL — CREATE TABLE IF NOT EXISTS ... PARTITION OF, never DROP/DETACH this phase"

requirements-completed: [SCHEMA-06]

coverage:
  - id: D1
    description: "Pure helper computes next month's [from, to) UTC bounds + events_YYYY_MM partition name for any reference date (year rollover, zero-padding, exclusive upper bound)"
    requirement: "SCHEMA-06"
    verification:
      - kind: unit
        ref: "apps/worker/src/partitions.test.ts#nextMonthPartitionSpec rolls the year over: Dec reference → next-Jan partition"
        status: pass
      - kind: unit
        ref: "apps/worker/src/partitions.test.ts#nextMonthPartitionSpec zero-pads single-digit months"
        status: pass
      - kind: unit
        ref: "apps/worker/src/partitions.test.ts#nextMonthPartitionSpec uses an exclusive upper bound (next month's first day)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Idempotent partition DDL string: CREATE TABLE IF NOT EXISTS \"events_YYYY_MM\" PARTITION OF \"events\" FOR VALUES FROM (..) TO (..)"
    requirement: "SCHEMA-06"
    verification:
      - kind: unit
        ref: "apps/worker/src/partitions.test.ts#renderCreatePartitionSql renders idempotent CREATE TABLE IF NOT EXISTS ... PARTITION OF \"events\""
        status: pass
    human_judgment: false
  - id: D3
    description: "Repeatable BullMQ partition-maintenance job + executor registered on the worker boot() without breaking the health shell; executor runs next-month DDL via the owner connection"
    requirement: "SCHEMA-06"
    verification:
      - kind: unit
        ref: "apps/worker/src/index.test.ts#worker connects (smoke) — requires live Redis; not runnable in this sandbox"
        status: unknown
    human_judgment: true
    rationale: "The worker smoke test + the executor's live DDL run both require infra (Redis at :6380, Postgres owner conn) that is unavailable in this isolated worktree. typecheck + lint pass and the partition-targeting unit tests are green; a human/CI with services up should confirm the smoke test stays green and a manual job run creates next month's partition idempotently."

# Metrics
duration: ~10min
completed: 2026-06-29
status: complete
---

# Phase 01 Plan 05: Events-Partition Maintenance Job Summary

**Idempotent monthly BullMQ job (cron 0 3 1 * *) that pre-creates next month's `events_YYYY_MM` partition via an owner connection, backed by pure, unit-tested date/SQL helpers.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-29T20:15:00Z
- **Completed:** 2026-06-29T20:21:00Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Pure `nextMonthPartitionSpec` + `renderCreatePartitionSql` helpers — UTC next-month bounds, `events_YYYY_MM` naming, year rollover, zero-padding, exclusive upper bound, idempotent `CREATE TABLE IF NOT EXISTS ... PARTITION OF "events"` — fully unit-tested with no DB/Redis dependency (5 tests).
- `runPartitionMaintenance` executor: opens a short-lived OWNER connection (raw `DATABASE_URL`, `postgres` driver, `max: 1`), runs the next-month DDL, logs a structured pino line, always closes the connection; errors propagate to BullMQ → pino + Sentry.
- Repeatable job registered in `boot()` via `upsertJobScheduler` (stable scheduler id, monthly cron) plus a dedicated `createPartitionWorker`, without removing the health queue/worker or the `import.meta.url` auto-boot guard.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure partition helper (date bounds + idempotent DDL) with unit tests** - `dea6e9d` (feat)
2. **Task 2: Register the repeatable pre-create job on the worker (skeleton)** - `c19dbb6` (feat)

_TDD note: Task 1 followed RED (failing `partitions.test.ts` — module missing) → GREEN (helpers added, 5 tests pass). Both files committed together as one atomic task commit._

## Files Created/Modified
- `apps/worker/src/partitions.ts` - Pure `nextMonthPartitionSpec` + `renderCreatePartitionSql` helpers; `PARTITIONS_QUEUE` constant; `runPartitionMaintenance` impure executor (owner connection + idempotent DDL + pino log).
- `apps/worker/src/partitions.test.ts` - Unit tests: Dec→Jan rollover (`events_2027_01`, `2027-01-01`/`2027-02-01`), zero-padding, exclusive upper bound, UTC bounds, idempotent DDL contents.
- `apps/worker/src/index.ts` - `boot()` made async; registers the repeatable scheduler (cron `0 3 1 * *`) + `createPartitionWorker` alongside the health shell; auto-boot guard surfaces boot rejections.
- `apps/worker/package.json` - Added `postgres@3.4.9` dependency.
- `pnpm-lock.yaml` - Lockfile updated for the new worker dependent (offline, already-resolved version).

## Decisions Made
- **postgres driver in the worker:** the executor needs only a one-off OWNER connection for DDL, so it depends on `postgres@3.4.9` directly (the same driver/version `packages/db` uses) rather than pulling in `@imbau/db`. Mirrors `packages/db/migrate.ts`.
- **Raw `process.env.DATABASE_URL`, not worker env.ts:** keeps the worker's boot-time validation Redis-only (APP-03 shell). The owner URL is required only when the monthly job actually runs; absence fails loudly by variable NAME (never value — V7).
- **`boot()` is now async:** `upsertJobScheduler` is a Redis round-trip. The auto-boot guard awaits via `.catch()` and sets `process.exitCode = 1` on failure so boot errors are observable, never swallowed.
- **Phase-1 scope honored:** registration + executor + pure helpers only. No retention/DETACH/DROP of old partitions (deferred), consistent with D-06 and the threat register (T-01-17: no destructive DDL this phase).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the `postgres` driver dependency to the worker**
- **Found during:** Task 2 (register the executor)
- **Issue:** The plan requires the executor to open an owner DB connection, but `apps/worker/package.json` carried no Postgres driver (the worker was a pure Redis shell). Import would fail.
- **Fix:** Added `postgres@3.4.9` (the exact version already resolved in the monorepo via `packages/db`) to the worker dependencies and updated `pnpm-lock.yaml` offline. This is a known, already-vendored package — not a new/unverified install.
- **Files modified:** apps/worker/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @imbau/worker typecheck` and `lint` clean; partition unit tests green.
- **Committed in:** c19dbb6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's own requirement that the executor open an owner connection. No scope creep — a single, already-vendored driver.

## Issues Encountered
- **Worker smoke test (`index.test.ts`) not runnable in this sandbox.** It validates `REDIS_URL` at import and connects to a live Redis (`:6380`); Redis/Postgres are down and Docker/`.env` access is permission-denied in this isolated worktree. The failure is purely environmental and pre-existing — the smoke test imports only `createConnection`/`createHealthWorker` (untouched by this plan) and does not call `boot()`, so this plan introduces no new open-handle risk. Verified instead: `partitions.test.ts` (5) + `env.test.ts` (2) green with a dummy `REDIS_URL`, plus clean `typecheck` and `lint`. CI (which provides a Redis service) should confirm the smoke test stays green.

## User Setup Required
None - no external service configuration required. (At runtime the worker container needs the OWNER `DATABASE_URL` for the monthly job to fire; the DEFAULT partition remains the safety net if it does not.)

## Next Phase Readiness
- SCHEMA-06 maintenance half delivered: the worker carries an idempotent monthly pre-create job; the DEFAULT partition keeps it off the critical insert path.
- Deferred (future milestone): retention/DETACH of old partitions, and a live integration test of the executor against a running Postgres.

---
*Phase: 01-schema-completo-rls*
*Completed: 2026-06-29*
