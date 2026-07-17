---
phase: 03-seed-del-edificio-ficticio
plan: 03
subsystem: database
tags: [seed, idempotency, rls, count-invariance, anon, cross-tenant, docs, es-AR, SEED-04]

# Dependency graph
requires:
  - phase: 03-seed-del-edificio-ficticio
    plan: 01
    provides: "seed idempotency core (seedId/onConflictDoNothing/SEED_REFERENCE_DATE), runSeed({skipMedia}), D-05 prerequisite guard, building + pricing generators"
  - phase: 03-seed-del-edificio-ficticio
    plan: 02
    provides: "cycle-safe seedMedia + seedContentRows (brokers/leads/galleries/progress_posts/events) wired into runSeed; skipMedia keeps the content half coherent"
  - phase: 01-schema-completo-rls
    provides: "withTenant/withAnon, tenant RLS policies (publicado-only anon read, org=GUC withCheck/using), _test harness role guard"
provides:
  - "seed.idempotency.test.ts — the always-on SEED-04 gate: run-twice per-table count(*) invariance + count(*)===count(distinct id) across all 13 seeded tables, robust to shared-DB accumulation (scoped to the deterministic ORG_ID)"
  - "RLS-correctness proof for the seed: withAnon reads the publicado project's floors/units/galleries; a foreign-tenant GUC reads zero seeded rows"
  - "env-gated media idempotency block (full runSeed twice → media count invariant + anon/foreign media RLS) — skips cleanly without R2"
  - "README ## Comandos + CLAUDE.md ## Comandos documenting pnpm db:seed with its full prerequisite list"
affects: [03 phase verification, cotizador milestone, panel, web publica]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotency proven as DELTA scoped to the deterministic seed ORG_ID (count after run 1 vs after run 2), so the gate is robust to rows other suites already left in the shared _test DB"
    - "RLS-correctness asserted only through the unprivileged app/anon roles (withAnon / withTenant(foreignOrgId)) — never the owner, which would pass for the wrong reason"
    - "Media invariance kept behind describe.skipIf(!hasMediaInfra); a cleanly-skipped media block is the correct green outcome without R2/worker"

key-files:
  created:
    - packages/db/tests/seed.idempotency.test.ts
    - README.md
  modified:
    - CLAUDE.md

key-decisions:
  - "The run-twice count-invariance gate scopes every count to the seed's deterministic ORG_ID (not a global count), so it measures THIS org's rows only and is unaffected by the building-pricing/content suites that also seed the same org into the shared _test DB."
  - "A fresh foreign tenant is created via helpers.makeOrg(); withTenant(foreignOrgId) proves cross-tenant isolation (zero seeded rows visible) — reuses the Phase-1 absence-suite pattern rather than inventing a new one."
  - "Media RLS + media count-invariance live only in the env-gated describe.skipIf block, because media rows are not produced under skipMedia (the always-on CI path)."

patterns-established:
  - "SEEDED_TABLES descriptor (table + scopeCol) drives a single generic loop asserting count invariance + no-dup-ids per table, keeping table/column names in a fixed in-test whitelist (sql.raw) with ORG_ID always parameterized."

requirements-completed: [SEED-04]

coverage:
  - id: E1
    description: "Run the full seed twice (skipMedia) → identical per-table count(*) for every seeded table (row-count invariance — the SEED-04 gate)"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.idempotency.test.ts#seed idempotency — row-count invariance (SEED-04 gate)"
        status: pass
    human_judgment: false
  - id: E2
    description: "No duplicate ids across re-runs (count(*) === count(distinct id) per seeded table)"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.idempotency.test.ts#seed idempotency — row-count invariance (SEED-04 gate)"
        status: pass
    human_judgment: false
  - id: E3
    description: "withAnon reads the publicado project's seeded floors/units/galleries (published visibility)"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.idempotency.test.ts#seed RLS correctness — withAnon reads the publicado project's floors/units/galleries"
        status: pass
    human_judgment: false
  - id: E4
    description: "A foreign-tenant GUC reads zero seeded rows (cross-tenant isolation)"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.idempotency.test.ts#seed RLS correctness — a foreign-tenant GUC reads zero seeded rows"
        status: pass
    human_judgment: false
  - id: E5
    description: "Full-seed (media on) media row count is also invariant across a re-run + anon/foreign media RLS"
    requirement: "SEED-04"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.idempotency.test.ts#seed idempotency — media path (env-gated)"
        status: deferred
        note: "describe.skipIf-gated; SKIPPED this run (R2/worker unavailable locally). Live-R2 proof deferred to operator/UAT, as Phase 2 did."
    human_judgment: true
  - id: E6
    description: "pnpm db:seed documented with its full prerequisite list (db:migrate first, compose up postgres+redis+worker, R2/DB/Redis env by NAME) + license manifest reference"
    requirement: "SEED-04"
    verification:
      - kind: static
        ref: "grep db:seed / db:migrate / REDIS_URL in README.md + db:seed in CLAUDE.md"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-01
status: complete
---

# Phase 3 Plan 03: Seed idempotency gate + docs Summary

**The SEED-04 exit gate turned into an always-on automated test: `runSeed({ skipMedia: true })` runs twice and every seeded table's `count(*)` is asserted identical (no duplicated ids), plus RLS-correctness — `withAnon` reads the publicado project's floors/units/galleries while a foreign-tenant GUC reads zero seeded rows — and `pnpm db:seed` documented with its full prerequisite list in README + CLAUDE.md.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-01
- **Tasks:** 2
- **Files:** 2 created (seed.idempotency.test.ts, README.md), 1 modified (CLAUDE.md)

## Accomplishments

- **Row-count-invariance gate (SEED-04):** `seed.idempotency.test.ts` calls `runSeed({ skipMedia: true })` twice and asserts every seeded table (`organization`, `projects`, `floors`, `units`, `price_lists`, `unit_prices`, `payment_plans`, `cac_index`, `brokers`, `leads`, `progress_posts`, `galleries`, `events`) keeps an identical `count(*)` across the re-run, and that `count(*) === count(distinct id)` per table (no duplicated ids). Counts are scoped to the seed's deterministic `ORG_ID`, so the delta is robust to rows the earlier building-pricing/content suites already left in the shared `_test` DB.
- **RLS-correctness (T-03-11):** through the unprivileged roles only — `withAnon` sees the seeded org's `floors`/`units`/`galleries` (the project is `publicado`, D-06), and `withTenant(foreignOrgId, …)` (a fresh org from `helpers.makeOrg()`) sees **zero** of the seeded org's rows (the tenant `using` clause filters to the GUC org). Reuses the Phase-1 cross-tenant absence pattern.
- **Media idempotency (env-gated):** a `describe.skipIf(!hasMediaInfra)` block runs the FULL `runSeed()` (media on) twice and asserts the `media` count is invariant plus anon/foreign media RLS — SKIPPED cleanly here (no R2), the correct green outcome; live-R2 proof deferred to UAT as in Phase 2.
- **Docs (SEED-04 / T-03-12):** `README.md` gains a `## Comandos` section documenting `pnpm db:seed` — that it is deterministic + idempotent (safe to re-run, no duplica filas), and the full D-05 prerequisite list (`pnpm db:migrate` first, `docker compose up -d postgres redis worker`, and the required env vars **by NAME only** — never values), pointing at `packages/db/src/seed/assets/LICENSES.md` for image provenance. `CLAUDE.md`'s `## Comandos` mirrors the `db:seed` one-liner with its prereqs. Prose is es-AR (voseo).

## Task Commits

1. **Task 1: row-count-invariance gate + RLS-correctness assertions (SEED-04)** — `7bcdbd0` (test)
2. **Task 2: document pnpm db:seed + prerequisites (SEED-04)** — `14dd7ec` (docs)

## Files Created/Modified

- `packages/db/tests/seed.idempotency.test.ts` — the SEED-04 gate: run-twice per-table count invariance + no-dup-ids; withAnon published-visibility; foreign-tenant isolation; env-gated media invariance + media RLS.
- `README.md` — new `## Comandos` section documenting `pnpm db:seed`, its idempotency, and the full prerequisite list; references the license manifest.
- `CLAUDE.md` (EDIT) — `## Comandos` now lists `pnpm db:seed` with its prerequisites (split `db:migrate` and `db:seed` into separate lines).

## Decisions Made

- **Counts are scoped to the deterministic `ORG_ID`, asserted as a run-1-vs-run-2 delta.** The shared `_test` DB already holds the same seeded org from the building-pricing and content suites; a global `count(*)` would be brittle. Scoping to `ORG_ID` and comparing the count before/after a fresh re-run measures exactly the invariance SEED-04 requires.
- **Foreign tenant via `helpers.makeOrg()` + `withTenant(foreignOrgId)`** — the sanctioned cross-tenant isolation pattern from the Phase-1 absence suite; the foreign org is empty so it sees zero seeded rows, and the assertion also filters visible rows by `organizationId === ORG_ID` to be explicit about "zero seeded rows".
- **Media assertions confined to the env-gated block** because media rows are not produced under `skipMedia` (the always-on CI path); a cleanly-skipped media block is the designed no-infra outcome.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were required (typecheck + lint clean on the first run, all assertions green).

## Known Stubs

None. The always-on gate exercises the real DB-only seed path; the media path is intentionally env-gated (not a stub), consistent with plan 03-02 and Phase 2's deferred R2 verification.

## User Setup Required / Deferred Verification

**Live-R2 media idempotency is deferred to UAT.** R2 credentials + a running `apps/worker` are not available in this environment, so the env-gated media block (E5) was correctly SKIPPED. To exercise it: export `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL`/`REDIS_URL`, `docker compose up -d postgres redis worker`, then run `pnpm --filter @imbau/db test -- --run seed.idempotency` against a `_test` DB — expect the media count to be invariant across a second full run and anon to read the publicado media while a foreign tenant reads none.

## Verification Results

Automated gate (with the local Node-22 + Postgres `imbau_test` env preamble):
- `pnpm --filter @imbau/db typecheck` — clean.
- `pnpm --filter @imbau/db lint` — clean.
- Full `@imbau/db` suite: **47 passed, 4 skipped, 0 failed** — `seed.idempotency` invariance + anon + foreign-tenant assertions pass; the 4 skips are the env-gated media blocks (`seed.media` file + this plan's media block), the correct outcome without R2.

## Self-Check: PASSED

`packages/db/tests/seed.idempotency.test.ts` and `README.md` exist on disk; `CLAUDE.md` contains `db:seed`; both task commits (`7bcdbd0`, `14dd7ec`) are in git history. Typecheck + lint clean, full suite green.

---
*Phase: 03-seed-del-edificio-ficticio*
*Completed: 2026-07-01*
