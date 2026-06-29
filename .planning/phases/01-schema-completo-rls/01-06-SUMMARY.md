---
phase: 01-schema-completo-rls
plan: 06
subsystem: testing
tags: [postgres, rls, drizzle, vitest, multi-tenant, partitioning]

# Dependency graph
requires:
  - phase: 01-schema-completo-rls (plans 01-01..01-04)
    provides: the 13 new domain tables, their tenant/anon RLS policies, scoped GRANTs, FORCE ROW LEVEL SECURITY, and the partitioned events DDL (migrations 0002/0003)
provides:
  - Domain-wide cross-tenant absence gate covering every new tenant table (read A->B / B->A = zero rows of the other org, as the unprivileged app role)
  - Anon published-only assertions over the 9 catalog/content tables (SCHEMA-07)
  - No-anon-SELECT assertions (42501) for the tenant-private tables (quotes, cac_index, leads, events)
  - Anon INSERT-only assertions for leads/events (publicado succeeds, borrador rejected 42501)
  - Events partition routing (far-future ts -> DEFAULT partition) + parent-table isolation assertions
  - 13 reusable owner-seeded fixtures (makeFloor..makeEvent) cloning the established makeProject style
affects: [02-explorador-ficha, 03-cotizador, 04-panel, any phase querying domain tables through withTenant/withAnon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Descriptor-driven RLS table matrix: typed AbsenceCase/WriteCase/NoAnonCase arrays loop a single assertion over every table (no per-table copy-paste, no `any`)"
    - "Owner-seeded project bundle (seedBundle) producing one row of every project-scoped table per (org, estado) so absence/anon/events cases assert against specific known ids"
    - "AppTx/AnonTx derived via Parameters<typeof withTenant> so descriptor closures stay fully typed without exporting internal pool types"

key-files:
  created: []
  modified:
    - packages/db/tests/helpers.ts
    - packages/db/tests/cross-tenant.test.ts

key-decisions:
  - "Reused rlsViolationInChain for grant-denied anon SELECTs: SQLSTATE 42501 (insufficient_privilege) covers both RLS withCheck violations and missing-grant denials, so one helper keys on code 42501 for every rejection case"
  - "Cross-tenant INSERT cases point the parent FKs at org B's REAL rows so the only possible rejection is the tenant withCheck (42501), never a vacuous FK violation (23503) — mirrors the existing member write test rationale"
  - "Anon published-only asserted via specific row ids (a known publicado row is visible, a known borrador row is absent) rather than global estado scans — robust against accumulated test-DB state"
  - "cac_index seeded once per org (it is org-scoped, not project-scoped) and treated as tenant-private in the absence + no-anon coverage"

patterns-established:
  - "Phase exit gate = the @imbau/db suite green against live Postgres 16 with NOBYPASSRLS roles; assertions NEVER run as the owner, only via withTenant/withAnon"
  - "When an RLS test fails, the fix belongs in the schema/migration plan, never in the assertion — this plan added zero schema changes because 01-01..01-04 were already correct"

requirements-completed: [SCHEMA-07, SCHEMA-08]

coverage:
  - id: D1
    description: "Cross-tenant read isolation: org A reads zero org B rows (and mirror) on all 13 new tenant tables, as the unprivileged app role"
    requirement: "SCHEMA-08"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(1) read isolation A->B and B->A: zero rows of the other org on every new tenant table"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cross-tenant write rejection: INSERT claiming the other org raises 42501 (withCheck) and UPDATE of an other-org row affects 0 rows (using) on all 13 tables"
    requirement: "SCHEMA-08"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(2) cross-tenant INSERT raises 42501 on every new tenant table (withCheck)"
        status: pass
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(2) cross-tenant UPDATE of an org-B row affects 0 rows on every new tenant table (using)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Anon published-only: anon reads only publicado-project rows on the 9 catalog/content tables and zero borrador rows"
    requirement: "SCHEMA-07"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(3) anon sees ONLY publicado-project rows on catalog/content tables, zero borrador"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tenant-private no-anon: anon SELECT on quotes, cac_index, leads, events each raises 42501 (no grant)"
    requirement: "SCHEMA-07"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(4) anon SELECT on tenant-private tables (quotes, cac_index, leads, events) raises 42501"
        status: pass
    human_judgment: false
  - id: D5
    description: "Anon INSERT-only: leads/events insert succeeds against a publicado project and is rejected (42501) against a borrador project"
    requirement: "SCHEMA-07"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(5) anon INSERT into leads/events: publicado succeeds, borrador rejected (42501)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Events partition behavior: a far-future ts lands in the DEFAULT partition (no error) and is readable by its tenant; an org-B event is absent when org A queries the events parent"
    requirement: "SCHEMA-08"
    verification:
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts#(6) events: far-future ts routes to DEFAULT partition + readable by tenant; org-B event absent from parent"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-06-29
status: complete
---

# Phase 1 Plan 6: Domain-wide RLS Exit Gate Summary

**The @imbau/db cross-tenant suite now proves tenant isolation, anon published-only access, tenant-private no-anon access, and events partition routing/isolation across all 13 new tables — 14 tests green against live Postgres 16 with NOBYPASSRLS roles.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-29T23:15:22Z
- **Completed:** 2026-06-29T23:27:24Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended the cross-tenant absence gate (SCHEMA-08) from `projects`/`member` to every new tenant table: floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, and the partitioned events — read A->B / B->A return zero rows of the other org, asserted as the unprivileged `app_authenticated` role.
- Added per-table cross-tenant write rejection: INSERT claiming the other org raises SQLSTATE 42501 (withCheck) and UPDATE of an other-org row affects 0 rows (using clause).
- Added the anon read/write boundary (SCHEMA-07): anon published-only over the 9 catalog/content tables (a known publicado row visible, a known borrador row absent), no-anon-SELECT 42501 on quotes/cac_index/leads/events, and anon INSERT-only on leads/events (publicado succeeds, borrador rejected 42501).
- Added events partition coverage: a far-future `ts` routes to `events_default` without error and is read back by its tenant; an org-B event is invisible when org A queries the events parent (Pitfall 6 parent isolation).
- Added 13 reusable owner-seeded fixtures (`makeFloor`..`makeEvent`, with `makeEvent` accepting a `ts` override) cloning the established `makeProject` style; the existing fixtures and `closeFixtures` were left untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Owner-seeded fixtures for every new table** - `324012c` (test)
2. **Task 2: Extend cross-tenant.test.ts — absence, anon-published, anon insert-only, events routing** - `9057156` (test)

_Note: Task 2 is tagged `tdd="true"`. Because the implementation under test (the RLS schema + migrations) already shipped in plans 01-01..01-04, the verification deliberately deferred to this plan landed green on first run — there was no separate `feat` commit to add (see TDD Gate Compliance below)._

## Files Created/Modified
- `packages/db/tests/helpers.ts` - Added 13 owner-seeded fixtures (one per new domain table) mirroring `makeProject`; each inserts via the owner connection with a fresh `randomUUID` id and the parent FK column(s) set.
- `packages/db/tests/cross-tenant.test.ts` - Added the `seedBundle` helper + richer `Scenario` (org-A/org-B publicado+borrador bundles, per-org cac_index) and a new `describe("domain-wide RLS exit gate (SCHEMA-07/08)")` with 7 cases driven by typed descriptor arrays.

## Decisions Made
- Reused `rlsViolationInChain` for anon grant-denied SELECTs — 42501 (insufficient_privilege) is the shared SQLSTATE for both RLS withCheck violations and missing-grant denials.
- Cross-tenant INSERT cases use org B's real parent rows so the sole rejection cause is the tenant withCheck (42501), not a vacuous FK violation.
- Anon published-only is asserted against specific known row ids (publicado visible / borrador absent), making the gate robust against accumulated shared test-DB state.
- Verification ran against the live Dockerized Postgres (`imbau_test`) with `DATABASE_URL`/`DATABASE_APP_URL`/`DATABASE_ANON_URL` all pointed at the dedicated `_test` DB; the harness guard confirmed `app_authenticated`/`anon` are `rolbypassrls=false`.

## Deviations from Plan

None - plan executed exactly as written. No schema/migration fixes were required: every assertion passed against the pre-existing 01-01..01-04 RLS schema, confirming the deferred RLS work is behaviorally correct.

## Issues Encountered
- The fresh git worktree had no `node_modules`; ran `pnpm install --frozen-lockfile` once (hardlinks from the shared store, ~6s) so vitest/tsc/eslint could run. This is standard worktree setup, not a dependency change.
- `@imbau/db`'s `client.ts` validates `DATABASE_APP_URL`/`DATABASE_ANON_URL` via the app env (not the `TEST_*` overrides), so all three `DATABASE_*` vars must point at `imbau_test` to run the suite — documented here for future runs.

## TDD Gate Compliance
Task 2 is `tdd="true"`, but the system under test (the RLS policies, grants, FORCE RLS, and partitioned events DDL) already exists from plans 01-01..01-04 — this plan's charter is the behavioral verification of that already-built schema. The RED phase therefore could not produce a failing implementation step (the implementation predates this plan), and the suite went green on first run. No production code changed, so there is a `test(...)` commit but no paired `feat(...)` commit. Had any assertion failed, the fix would have been a schema/migration change in the earlier plans (per the plan's explicit instruction), not a weakened test.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SCHEMA-07 and SCHEMA-08 are satisfied: the multi-tenant + anon boundary is now behaviorally proven for the full §3.3 domain schema. This is the phase exit gate.
- Wave/phase merge expectation: `pnpm test && pnpm typecheck && pnpm lint` green; the CI `quality` gate (real Postgres service, NOBYPASSRLS roles) is the final gate before `/gsd-verify-work`.
- No blockers. Later phases (explorador/ficha, cotizador, panel) can build queries on `withTenant`/`withAnon` knowing isolation and publish-gating are enforced and tested.

---
*Phase: 01-schema-completo-rls*
*Completed: 2026-06-29*
