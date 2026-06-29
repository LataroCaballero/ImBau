---
phase: 01-schema-completo-rls
plan: 04
subsystem: database
tags: [postgres, drizzle, rls, partitioning, migrations, multi-tenant]

# Dependency graph
requires:
  - phase: 01-01
    provides: enums, json-schemas, projects, roles, RLS baseline (0000_init + 0001_rls), single Drizzle journal
  - phase: 01-02
    provides: floors, units, price-lists, unit-prices, payment-plans, cac-index modules
  - phase: 01-03
    provides: quotes, brokers, leads, progress-posts, galleries, media, events modules
provides:
  - "0002_domain.sql (generated): 5 enums, 12 tenant tables, composite FKs, projects UNIQUE, tenant + anon_published policies"
  - "0003_rls_domain.sql (hand): enum grants, scoped table grants, FORCE RLS on 13 tables, full partitioned events DDL, lead<->quote FKs"
  - "Verified migrate-from-zero: pnpm db:migrate applies 0000-0003 clean and idempotent against an empty DB"
  - "events: partitioned BY RANGE(ts), PK(id,ts), monthly + default partitions, ENABLE+FORCE RLS, events_tenant + events_anon_insert"
affects: [01-05, 01-06, seed, cotizador, panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single Drizzle journal with interleaved generated + hand-written migrations (0002 generated, 0003 hand)"
    - "FLAG-B: partitioned table (events) excluded from drizzle.config; ALL its DDL hand-authored"
    - "Hand-edit of generated .sql is drift-free (snapshot unchanged) — same pattern as 0000_init.sql role prepend"

key-files:
  created:
    - packages/db/migrations/0002_domain.sql
    - packages/db/migrations/0003_rls_domain.sql
    - packages/db/migrations/meta/0002_snapshot.json
  modified:
    - packages/db/src/schema/index.ts
    - packages/db/drizzle.config.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "events excluded from drizzle.config (FLAG-B) but re-exported from the barrel for its types/Zod"
  - "quotes + cac_index tenant-private: app DML only, no anon grant; leads/events anon INSERT-only (no SELECT)"
  - "projects(id,organization_id) UNIQUE reordered before child composite FKs in 0002 (generated order was invalid)"

patterns-established:
  - "Pattern 1: partitioned-parent RLS — ENABLE+FORCE + policies on the events parent propagate to all partitions"
  - "Pattern 2: cycle-break FKs (lead<->quote) added idempotently in hand SQL via pg_constraint guards"

requirements-completed: [SCHEMA-06, SCHEMA-07]

coverage:
  - id: D1
    description: "All 13 new tables wired (barrel + drizzle.config minus events); 0002 generated events-free"
    requirement: "SCHEMA-07"
    verification:
      - kind: automated
        ref: "pnpm --filter @imbau/db db:generate (No schema changes / no events relation); pnpm --filter @imbau/db typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "0003 hand SQL: enum grants, scoped table grants, FORCE RLS on 13 tables, full events partition DDL + both policies, lead<->quote FKs"
    requirement: "SCHEMA-06"
    verification:
      - kind: automated
        ref: "psql counts on imbau_test: 13 FORCE-RLS tables, 9 anon SELECT, 0 anon SELECT on leads/events/quotes/cac_index, 2 anon INSERT, partitioned events, 2 cycle FKs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migrate-from-zero gate: pnpm db:migrate applies 0000-0003 clean from an empty DB and is idempotent"
    requirement: "SCHEMA-06"
    verification:
      - kind: automated
        ref: "pnpm --filter @imbau/db db:migrate against empty imbau_test (exit 0; re-run no-op exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-06-29
status: complete
---

# Phase 01 Plan 04: Schema convergence — wire, generate, hand-author RLS, migrate-from-zero Summary

**The complete §3.3 domain schema (12 tenant tables + a partitioned-by-month events table) plus all RLS grants/policies now reaches a fresh database cleanly via the single Drizzle journal — proven by an idempotent migrate-from-zero.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-29T20:01:00Z (approx)
- **Completed:** 2026-06-29T20:36:00Z (approx)
- **Tasks:** 3 completed
- **Files modified:** 6 (2 created migrations, 1 created snapshot, 3 modified config/barrel/journal)

## Accomplishments
- Registered all 14 new schema modules in the barrel (incl. events) and the 12 non-events modules in drizzle.config (events excluded per FLAG-B), then generated `0002_domain.sql` — 5 enums, 12 tables, composite FKs, projects UNIQUE, tenant + anon_published policies, and crucially NO events relation.
- Hand-authored `0003_rls_domain.sql`: GRANT USAGE on 5 enums; scoped grants (app DML everywhere, anon SELECT on 9 catalog tables, anon INSERT-only on leads/events, none on quotes/cac_index); FORCE ROW LEVEL SECURITY on all 13 new tenant tables; the full partitioned events DDL (PK `(id, ts)`, composite FK → projects, monthly 2026_06–2026_09 + default partitions, ENABLE+FORCE RLS, `events_tenant` + `events_anon_insert`); and the idempotent lead↔quote cycle-break FKs.
- Ran the BLOCKING migrate-from-zero gate against a freshly dropped/recreated empty `imbau_test`: `pnpm db:migrate` applied 0000→0003 clean (exit 0) and a re-run is a no-op (idempotent). Verified on the live DB: 13 tables, partitioned events with 5 partitions, 13 FORCE-RLS tables, exact anon grant surface, 2 cycle FKs.

## Task Commits

Each task was committed atomically:

1. **Task 1: Register tables + generate 0002** - `5837811` (feat)
2. **Task 2: Hand-author 0003 RLS/partition/grant SQL** - `801eb17` (feat)
3. **Task 3: migrate-from-zero gate + blocking migration fixes** - `e870261` (fix)

_Note: Task 3's verification surfaced two blocking issues in the migration files (see Deviations); the fix was committed as part of the Task 3 gate._

## Files Created/Modified
- `packages/db/src/schema/index.ts` - Re-exports all 14 new domain modules (incl. events for its types/Zod).
- `packages/db/drizzle.config.ts` - Adds the 12 non-events modules to the `schema:` array (events omitted, FLAG-B).
- `packages/db/migrations/0002_domain.sql` - Generated: enums, 12 tables, composite FKs, projects UNIQUE, RLS policies; projects UNIQUE hand-reordered before child FKs.
- `packages/db/migrations/0003_rls_domain.sql` - Hand: enum/table grants, FORCE RLS, full partitioned events DDL + both policies, lead↔quote FKs.
- `packages/db/migrations/meta/_journal.json` - Appended 0002_domain (idx 2) and 0003_rls_domain (idx 3) entries.
- `packages/db/migrations/meta/0002_snapshot.json` - drizzle-kit snapshot for 0002.

## Decisions Made
- **events DDL is entirely hand-written (FLAG-B):** Drizzle has no `PARTITION BY` support, so listing events in drizzle.config would emit a plain table colliding with the hand partition DDL. The barrel still re-exports events so consumers get `$inferInsert`/`$inferSelect` + the Zod schema.
- **Trust-boundary grant surface:** anon gets SELECT on the 9 catalog/content tables only, INSERT-only on leads + events (no SELECT — public writes, never reads), and nothing on quotes/cac_index (tenant-private). Verified at the DB level.
- **RLS on the partitioned parent:** ENABLE+FORCE + both policies on the `events` parent propagate to every partition, so no per-partition policy DDL is needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Generated 0002 emitted `projects` UNIQUE after the child composite FKs that depend on it**
- **Found during:** Task 3 (migrate-from-zero gate)
- **Issue:** drizzle-kit appended `ALTER TABLE "projects" ADD CONSTRAINT ... UNIQUE("id","organization_id")` AFTER all child composite FK ALTERs. On a fresh apply the first composite FK (`floors` → `projects(id, organization_id)`) failed: "no unique constraint matching given keys for referenced table projects".
- **Fix:** Moved the `projects` UNIQUE statement to before the first composite FK in `0002_domain.sql`, with an explanatory comment (mirrors the documented hand-prepend pattern in 0000_init.sql). Editing the .sql does not change the 0002 snapshot, so `db:generate` still reports no drift (verified).
- **Files modified:** packages/db/migrations/0002_domain.sql
- **Verification:** `pnpm db:migrate` progressed past 0002 to 0003; `db:generate` reports "No schema changes".
- **Committed in:** `e870261`

**2. [Rule 3 - Blocking] 0003 header comment contained the literal `--> statement-breakpoint` marker, which the drizzle-orm migrator splits on even inside SQL comments**
- **Found during:** Task 3 (migrate-from-zero gate)
- **Issue:** The drizzle-orm postgres-js migrator splits each migration file on the literal breakpoint marker string regardless of SQL comment context. The header comment described the idempotent style using that exact marker verbatim, so the file was split mid-comment, producing an invalid SQL chunk ("` separators)...").
- **Fix:** Reworded the 0003 header comment to not write the breakpoint marker verbatim, and documented why.
- **Files modified:** packages/db/migrations/0003_rls_domain.sql
- **Verification:** `pnpm db:migrate` applied 0003 successfully; idempotent re-run is a no-op.
- **Committed in:** `e870261`

Both deviations were directly caused by this plan's own generated/hand-authored migration files, and Task 3's action explicitly authorized fixing the offending migration file and re-running from an empty DB (never patching the DB by hand, never `drizzle-kit push`).

## Verification Evidence

Against a freshly dropped/recreated empty `imbau_test`:

- `pnpm --filter @imbau/db db:migrate` → applies 0000–0003, exit 0; re-run → no-op, exit 0 (idempotent journal).
- `pnpm --filter @imbau/db typecheck` → clean. `pnpm --filter @imbau/db lint` → clean. `db:generate` → "No schema changes" (no drift, no events relation generated).
- DB asserts: 13 new tables present; `events` is partitioned (`relkind=p`) with partitions `events_2026_06..09` + `events_default`; `events` PK = `(id, ts)`; 13 tables have `relrowsecurity AND relforcerowsecurity`; anon has SELECT on exactly the 9 catalog tables and 0 SELECT on leads/events/quotes/cac_index; anon has INSERT on leads + events; both `leads_quote_id_quotes_id_fk` and `quotes_lead_id_leads_id_fk` exist.

## Known Stubs
None. All tables, policies, grants, and partitions are fully realized in the migration journal and verified live.

## Threat Flags
None. The grant/policy surface matches the plan's threat register exactly (T-01-12 FORCE RLS, T-01-13 scoped anon grants, T-01-14 migrate-only single journal, T-01-15 events_default partition); no new security surface was introduced beyond what the plan specified.

## Self-Check: PASSED

All created files exist on disk and all task/summary commits are present in git history:
- Files: 0002_domain.sql, 0003_rls_domain.sql, meta/0002_snapshot.json, 01-04-SUMMARY.md
- Commits: 5837811 (Task 1), 801eb17 (Task 2), e870261 (Task 3 + fixes), cb96c80 (summary)
- Journal contains the 0003_rls_domain entry.
