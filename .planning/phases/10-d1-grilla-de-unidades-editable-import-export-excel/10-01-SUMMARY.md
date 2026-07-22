---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
plan: 01
subsystem: database
tags: [drizzle, postgres, migration, unique-constraint, rls, unit_prices]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: unit_prices table (SCHEMA-02) with three composite org-pin FKs + tenant/anon RLS policies
  - phase: 08-cotizador
    provides: v1.2 quoting resolver that assumes one price row per unit×list
provides:
  - "UNIQUE(unit_id, price_list_id) constraint on unit_prices (unit_prices_unit_list_uq), versioned + applied"
  - "Conflict target for the idempotent grid/Excel upsert in Plan 03 (onConflictDoUpdate)"
  - "DB-enforced one-row-per-unit×list invariant (was convention-only)"
affects: [10-03 grid/Excel upsert, cotizador resolver invariant]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "unique(\"<name>\").on(t.a, t.b) in the schema extras array → drizzle-kit generate → ADD CONSTRAINT migration (mirrors units.ts/floors.ts/price-lists.ts unique() idiom)"
    - "Enforcement proof test: seed via ownerSql() only, assert on the raw Postgres error (SQLSTATE 23505 + constraint_name), not on an app-role read"

key-files:
  created:
    - packages/db/migrations/0005_unit_prices_unit_list_uq.sql
    - packages/db/migrations/meta/0005_snapshot.json
    - packages/api/tests/unit-prices-unique.test.ts
  modified:
    - packages/db/src/schema/unit-prices.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "Renamed the drizzle-kit default tag (0005_next_archangel) to the plan's descriptive 0005_unit_prices_unit_list_uq and synced the journal entry so migrate resolves the file."
  - "Test asserts on postgres.js error `.code` (23505) AND `.constraint_name` (unit_prices_unit_list_uq) — a rename of the constraint would fail the test, keeping the proof pinned to the named natural key."

patterns-established:
  - "Named UNIQUE constraint via unique(\"name\").on(...) so downstream upserts can target it explicitly and the enforcement test can name it."

requirements-completed: [GRID-05]

coverage:
  - id: D1
    description: "unit_prices enforces at most one row per (unit_id, price_list_id) — second duplicate-natural-key insert rejected by the DB"
    requirement: "GRID-05"
    verification:
      - kind: integration
        ref: "packages/api/tests/unit-prices-unique.test.ts#rejects a SECOND insert with the same (unit_id, price_list_id)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Versioned migration 0005 adds the UNIQUE constraint and applies cleanly against existing seed data (no events-partition drift)"
    requirement: "GRID-05"
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/db db:migrate (exit 0); pg_constraint has unit_prices_unit_list_uq"
        status: pass
    human_judgment: false

# Metrics
duration: 2min
completed: 2026-07-22
status: complete
---

# Phase 10 Plan 01: unit_prices UNIQUE(unit_id, price_list_id) schema gate Summary

**Added and DB-enforced the versioned `UNIQUE(unit_id, price_list_id)` constraint on `unit_prices`, proven by an integration test that seeds a live `_test` Postgres and asserts a duplicate natural-key insert is rejected with SQLSTATE 23505.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-22T16:19:29Z
- **Completed:** 2026-07-22T16:21:39Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `unit_prices_unit_list_uq` UNIQUE(unit_id, price_list_id) declared in `unit-prices.ts` extras (FKs + both RLS policies untouched) and emitted as a single-statement versioned migration.
- Migration `0005_unit_prices_unit_list_uq.sql` applied to `imbau_test` (exit 0, clean against existing unique seed data); constraint confirmed present in `pg_constraint`.
- Integration test proves enforcement: first `(unit_id, price_list_id)` insert accepted, second rejected with `23505` / `unit_prices_unit_list_uq`.
- Full db + api gates green (typecheck, lint, tests); the [BLOCKING] schema gate is unblocked for the Plan 03 upsert.

## Task Commits

1. **Task 1: Add UNIQUE(unit_id, price_list_id) + generate/apply migration [BLOCKING]** - `5263f99` (feat)
2. **Task 2: Prove the constraint is enforced (dup insert rejected)** - `4b3867b` (test)

**Plan metadata:** _(final docs commit — see git log)_

## Files Created/Modified
- `packages/db/src/schema/unit-prices.ts` - Added `unique` import + `unique("unit_prices_unit_list_uq").on(t.unitId, t.priceListId)` in the extras array.
- `packages/db/migrations/0005_unit_prices_unit_list_uq.sql` - Versioned `ADD CONSTRAINT` migration (only the unit_prices unique; no events-partition drift).
- `packages/db/migrations/meta/0005_snapshot.json` - drizzle-kit snapshot for the new migration.
- `packages/db/migrations/meta/_journal.json` - Journal entry tag synced to the renamed file.
- `packages/api/tests/unit-prices-unique.test.ts` - Enforcement proof (seed via ownerSql, assert 23505 + constraint_name).

## Decisions Made
- Renamed drizzle-kit's default tag `0005_next_archangel` to the plan's `0005_unit_prices_unit_list_uq` and updated the journal `tag` so `db:migrate` resolves the renamed SQL file. Migration content unchanged.
- Enforcement test asserts on both `.code` (`23505`) and `.constraint_name` (`unit_prices_unit_list_uq`) from postgres.js, pinning the proof to the named natural key.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The generated migration contained only the intended `ALTER TABLE "unit_prices" ADD CONSTRAINT` (events.ts is deliberately absent from drizzle.config, so no partitioned-table drift was emitted).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03's `onConflictDoUpdate (unit_id, price_list_id)` now has a real conflict target; the idempotent grid/Excel upsert can be built on top.
- The v1.2 cotizador's one-row-per-unit×list invariant is now a hard DB guarantee.

## Self-Check: PASSED

All created/modified files present on disk; both task commits (`5263f99`, `4b3867b`) present in git history.

---
*Phase: 10-d1-grilla-de-unidades-editable-import-export-excel*
*Completed: 2026-07-22*
