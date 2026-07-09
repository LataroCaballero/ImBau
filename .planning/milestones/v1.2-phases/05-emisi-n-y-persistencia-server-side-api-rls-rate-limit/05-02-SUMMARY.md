---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
plan: 02
subsystem: testing
tags: [vitest, trpc, drizzle, rls, postgres, quoting, multi-tenant, integration-test]

# Dependency graph
requires:
  - phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit (plan 01)
    provides: "quotesRouter (compute/create), resolveAndQuote core, errorFormatter surfacing quoteErrorCode"
  - phase: 01-schema-media-seed
    provides: "quotes/cac_index/payment_plans/unit_prices/price_lists schema + withTenant/withAnon RLS helpers + _test DB harness"
  - phase: 04-motor-de-cotizaci-n-packages-quoting
    provides: "ENGINE_VERSION, QuoteError + QuoteErrorCode, QuoteResult contract"
provides:
  - "packages/api/tests/quotes-router.test.ts — the behavioral Nyquist proof for QUOTE-01/QUOTE-02 against real Postgres"
  - "seedQuoteFixtures owner-pool helper (project→floor→unit→2 USD price lists→2 unit prices→CAC plan→2 cac periods)"
  - "42501 anon-privacy regression probes on cac_index (SELECT) and quotes (INSERT)"
affects: [05-04, 05-05, cotizador-ui, pdf-worker, whatsapp-cta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration test clones the trpc-tenant harness: owner-pool seeding + anon caller via new Headers() = the exact production anonymous entry path"
    - "Postgres SQLSTATE assertion reads err.cause.code (DrizzleQueryError wraps the postgres.js PostgresError) — robust anon-privacy 42501 probe"
    - "Money assertions are exact integer/string equality — never approximate matchers"

key-files:
  created:
    - packages/api/tests/quotes-router.test.ts
  modified: []

key-decisions:
  - "42501 SQLSTATE is read off the rejection's `cause` (DrizzleQueryError.cause is the postgres.js PostgresError) via a postgresSqlState() helper — Drizzle wraps driver errors, so a top-level `.code` check would miss it."
  - "orgB seeded with full fixtures but NO cac_index to exercise the missing-CAC PRECONDITION_FAILED path without disturbing orgA's max-periodo assertion."
  - "Degenerate plan uses anticipoPct '150.00' (out of [0,100]) → ANTICIPO_PCT_FUERA_DE_RANGO, the QuoteError code the errorFormatter surfaces as data.quoteErrorCode."

patterns-established:
  - "Task 1 seeds only what it asserts (orgA + fixtureA) so its commit is lint-clean; Task 2 extends beforeAll (orgB, degenerate plan, borrador project) rather than restructuring."
  - "captureRejection() + typed-field inspection for assertions that need the thrown error's cause/code, keeping .rejects.toMatchObject for simple typed-code checks."

requirements-completed: [QUOTE-01, QUOTE-02]

# Coverage metadata (#1602)
coverage:
  - id: D1
    description: "Anon compute on a publicado project returns a financiado QuoteResult with version===ENGINE_VERSION, using the max(periodo) CAC row (D-03/D-07)"
    requirement: QUOTE-01
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#anon compute returns a financiado QuoteResult read from the publicado project"
        status: pass
    human_judgment: false
  - id: D2
    description: "compute writes NO quotes row (D-01) — proven by an owner-pool row-count before/after"
    requirement: QUOTE-01
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#compute writes NO quotes row (D-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "create persists {version:1, inputs, result, cacPeriodo} snapshot (result.version===ENGINE_VERSION, max periodo, seeded financiado price) readable via withTenant (D-04)"
    requirement: QUOTE-02
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#create persists the versioned snapshot and it is readable via withTenant (QUOTE-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "contado compute returns the seeded contado price and modalidad 'contado'"
    requirement: QUOTE-01
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#contado compute returns the seeded contado price"
        status: pass
    human_judgment: false
  - id: D5
    description: "Error surface: borrador → NOT_FOUND; org without CAC → PRECONDITION_FAILED (not 500); degenerate plan → BAD_REQUEST with cause QuoteError.code ANTICIPO_PCT_FUERA_DE_RANGO (D-08)"
    requirement: QUOTE-01
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#borrador project → NOT_FOUND / org without CAC → PRECONDITION_FAILED / degenerate plan → BAD_REQUEST carrying the machine-readable engine code"
        status: pass
    human_judgment: false
  - id: D6
    description: "Tenant privacy: anon SELECT on cac_index and anon INSERT into quotes both raise Postgres 42501 (no anon policy — Pitfall 5 / T-05-02)"
    requirement: QUOTE-02
    verification:
      - kind: integration
        ref: "packages/api/tests/quotes-router.test.ts#cac_index stays anon-invisible / quotes stays anon-unwritable (42501)"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-03
status: complete
---

# Phase 05 Plan 02: Quotes-router integration proof Summary

**Integration test (`quotes-router.test.ts`) proving QUOTE-01/QUOTE-02 end-to-end through the anonymous tRPC caller against real Postgres — server-side org resolution, max-período CAC read, versioned snapshot persistence, and the "no anon policy" 42501 invariant on cac_index/quotes.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-03T21:00Z (approx)
- **Completed:** 2026-07-03T21:25:00Z
- **Tasks:** 2
- **Files modified:** 1 (1 created)

## Accomplishments
- Cloned the `trpc-tenant` harness into a new `quotes-router.test.ts`: `ownerSql()` seeding, `makeUserWithActiveOrg` org minting, anon caller via `new Headers()` — the exact production anonymous entry path.
- `seedQuoteFixtures` owner-pool helper inserts a full quoting fixture in FK order (publicado project → floor → unit → two USD price lists named Contado/Financiado → two unit prices → a CAC payment plan with a refuerzo → two cac_index periods).
- Happy-path proofs (Task 1, 4 tests): anon financiado compute returns `version===ENGINE_VERSION` and uses the newer of two seeded CAC periods; compute writes zero quotes rows (row-count before/after); create persists `{version:1, inputs, result, cacPeriodo}` readable through `withTenant`; contado returns the seeded contado price.
- Negative/privacy proofs (Task 2, 5 tests): borrador → `NOT_FOUND`; org without CAC → `PRECONDITION_FAILED` (never a 500); degenerate plan (`anticipoPct '150.00'`) → `BAD_REQUEST` whose `cause` is a `QuoteError` with code `ANTICIPO_PCT_FUERA_DE_RANGO`; anon `SELECT` on `cac_index` and anon `INSERT` into `quotes` both raise Postgres `42501`.
- Full `@imbau/api` suite green (21 tests across 5 files), typecheck and lint clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fixture seeding + happy-path compute/create tests** - `5303f92` (test)
2. **Task 2: Error-surface + tenant-privacy negative tests** - `6720e5f` (test)

_Note: This plan carried `tdd="true"` tasks, but the code under test (quotesRouter) already shipped in 05-01; the deliverable here is the behavioral test file itself, so each task is a single `test(...)` commit rather than a RED→GREEN pair._

## Files Created/Modified
- `packages/api/tests/quotes-router.test.ts` (created) — the QUOTE-01/QUOTE-02 integration contract: 9 tests, owner-pool `seedQuoteFixtures`, anon caller, `withTenant`/`withAnon` assertions.

## Decisions Made
- **42501 read off `cause`:** Drizzle wraps the postgres.js driver error in a `DrizzleQueryError` whose `cause` is the `PostgresError` carrying the SQLSTATE `.code`. A `postgresSqlState()` helper reads `err.code ?? err.cause.code`, so the anon-privacy probes assert the true SQLSTATE rather than a wrapper's undefined `.code`.
- **orgB has full fixtures but no CAC:** isolates the missing-CAC `PRECONDITION_FAILED` path from orgA's max-período happy-path assertion (two orgs, no cross-contamination).
- **Task split for clean commits:** Task 1 seeds only orgA/fixtureA (what it asserts) so its commit passes lint; Task 2 extends `beforeAll` with orgB, the degenerate plan, and the borrador project rather than restructuring.

## Deviations from Plan

None - plan executed exactly as written. The one course-correction (reading the 42501 SQLSTATE from `err.cause.code` instead of `err.code`) was anticipated by the plan itself, which noted "if the property shape differs, assert the rejection ... via a caught-error inspection rather than a string match."

## Issues Encountered
- **Fresh worktree had no `node_modules`:** ran `pnpm install --frozen-lockfile` (Node 22 via nvm) — a workspace link/install from the committed lockfile, no new external packages.
- **Anon-privacy 42501 probes initially failed** asserting `err.code`: Drizzle wraps the driver error, so the SQLSTATE lives on `err.cause.code`. A vitest probe confirmed the shape (`DrizzleQueryError` → `cause: PostgresError{ code: "42501" }`); added `postgresSqlState()` and both probes went green.

## User Setup Required
None - no external service configuration required. (Local run needs the `_test` DB + env exports per the developer's local-test-env recipe; CI is already wired.)

## Next Phase Readiness
- QUOTE-01/QUOTE-02 now have green automated evidence against real Postgres with the real RLS roles — the phase's Nyquist validation contract for the emission core is satisfied.
- Remaining phase-05 coverage: the manual QUOTE-03 429 rate-limit burst is human UAT (plan 05-05); plan 05-04 is independent.
- No blockers.

## Self-Check: PASSED

- `packages/api/tests/quotes-router.test.ts` exists on disk (FOUND).
- `.planning/phases/05-.../05-02-SUMMARY.md` exists on disk (FOUND).
- Task commits present in git history: `5303f92` (FOUND), `6720e5f` (FOUND).
- `pnpm --filter @imbau/api test` → 21 passed (5 files); typecheck and lint clean.

---
*Phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit*
*Completed: 2026-07-03*
