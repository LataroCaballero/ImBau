---
phase: 03-seed-del-edificio-ficticio
plan: 01
subsystem: database
tags: [seed, drizzle, postgres, rls, uuidv5, idempotency, es-AR, cac, pricing, tsx]

# Dependency graph
requires:
  - phase: 01-schema-completo-rls
    provides: "16-table schema + RLS (organization/projects/floors/units/price_lists/unit_prices/payment_plans/cac_index), withTenant/withAnon, createOwnerDb, composite (id, organization_id) FKs, Refuerzo Zod schema, events partitioning"
  - phase: 02-pipeline-de-media
    provides: "@imbau/storage primitives (makeR2Client, originalKey, MEDIA_QUEUE, MediaJobData), resolveMedia — reused by the media path in plan 03-02/03"
provides:
  - "Deterministic-idempotency core (seedId=uuidv5, makePrng, SEED_REFERENCE_DATE) reused by every downstream seed module"
  - "runSeed({ skipMedia? }) entry + pnpm db:seed (via tsx) that bootstraps org + publicado project + events partitions"
  - "D-05 fail-fast prerequisite guard (env NAMES only, R2 HeadBucket + Redis PING when media required)"
  - "Curated es-AR content constants for Brigos Recoleta (floors, typologies, pricing, CAC payment plans, 18-month CAC series)"
  - "seedBuilding (13 floors + 38 units, pozo curve) and seedPricing (2 USD price_lists, integer-USD unit_prices, CAC payment_plans, cac_index) — SEED-01 + SEED-02"
affects: [03-02, 03-03, seed content-rows, seed media, cotizador milestone]

# Tech tracking
tech-stack:
  added: [uuid@11.1.1, bullmq@5.78.1, ioredis@5.10.1, "@aws-sdk/client-s3@3.1076.0", "@imbau/storage (workspace)", tsx@4.22.4]
  patterns:
    - "Deterministic UUIDv5 ids + onConflictDoNothing on every insert (the uniform idempotency mechanism — no natural-key upsert)"
    - "Owner pool for the org root + partition DDL ONLY; every tenant row via withTenant (production RLS write path)"
    - "Money typing: integer USD (precio, Refuerzo.montoUsd) / numeric-as-string (m2, anticipoPct, cac_index.valor)"
    - "Curated es-AR constants + seeded PRNG for numeric jitter (not faker)"

key-files:
  created:
    - packages/db/src/seed/ids.ts
    - packages/db/src/seed/content.ts
    - packages/db/src/seed/prerequisites.ts
    - packages/db/src/seed/building.ts
    - packages/db/src/seed/pricing.ts
    - packages/db/seed.ts
    - packages/db/tests/seed.ids.test.ts
    - packages/db/tests/seed.prerequisites.test.ts
    - packages/db/tests/seed.building-pricing.test.ts
  modified:
    - packages/db/package.json
    - package.json
    - packages/db/tsconfig.json

key-decisions:
  - "db:seed runs via tsx (not node --experimental-strip-types): seed.ts imports the extensionless @imbau/db src graph, which pure Node ESM cannot resolve; tsx is the established repo runner (apps/worker dev)."
  - "seedBuilding returns SeededUnit[] (id + m2 + floorNumero + orientacion + tipologia), not just ids, so seedPricing computes realistic per-unit integer-USD prices without a DB round-trip."
  - "Events partition DDL is replicated inline in seed.ts (mirrors apps/worker/src/partitions.ts) rather than imported — a package must not depend on an app."
  - "@imbau/storage added to @imbau/db (cycle-safe: storage only deps @aws-sdk/client-s3) so prerequisites.ts can HeadBucket-probe R2 without importing @imbau/api."
  - "Fixed unit counts per floor (PB 4, typical 3, semipiso/penthouse 2) = 38 units, guaranteeing the 30-40 range deterministically."

patterns-established:
  - "Seed idempotency core: seedId(name)=uuidv5(name, SEED_NS) + .onConflictDoNothing(); cac_index conflicts on natural key (organization_id, periodo)."
  - "Fail-fast prerequisite guard names missing env vars only (ASVS V7), never values."

requirements-completed: [SEED-01, SEED-02]

coverage:
  - id: D1
    description: "Deterministic id/PRNG core (seedId stable+distinct, valid UUID, reproducible makePrng, fixed SEED_REFERENCE_DATE)"
    requirement: "SEED-01"
    verification:
      - kind: unit
        ref: "packages/db/tests/seed.ids.test.ts#seed ids — deterministic idempotency core"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-05 fail-fast prerequisite guard aborts naming missing env vars, never leaking a secret value"
    requirement: "SEED-01"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.prerequisites.test.ts#assertSeedPrerequisites — D-05 fail-fast guard"
        status: pass
    human_judgment: false
  - id: D3
    description: "Building composition — org + publicado project, 13 floors, 30-40 units, pozo sale curve (low vendido, high disponible)"
    requirement: "SEED-01"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.building-pricing.test.ts#seed building composition (SEED-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pricing — 2 USD price_lists, integer-USD unit_prices, CAC payment_plans with validated Refuerzo[], 12-24 cac_index rows"
    requirement: "SEED-02"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.building-pricing.test.ts#seed pricing (SEED-02)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Re-run invariance (SEED-04 core) — running the seed twice leaves per-table counts identical"
    requirement: "SEED-02"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.building-pricing.test.ts#seed is idempotent (SEED-04)"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-07-01
status: complete
---

# Phase 3 Plan 01: Seed foundation + building & pricing Summary

**Deterministic UUIDv5-idempotent seed for "Brigos Recoleta": owner-bootstrapped org + publicado project, 13 floors / 38 units with a pozo sale curve, 2 USD price_lists, integer-USD unit_prices, CAC payment_plans with semestral Refuerzo[], and an 18-month cac_index — all re-runnable via `pnpm db:seed`.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-01T13:20:00Z (approx)
- **Completed:** 2026-07-01T13:40:00Z (approx)
- **Tasks:** 3
- **Files modified:** 12 (9 created, 3 modified)

## Accomplishments
- Established the seed's single idempotency mechanism: `seedId(name)=uuidv5(name, SEED_NS)` + `.onConflictDoNothing()` on every insert, plus a `makePrng` (mulberry32) for deterministic numeric jitter and a fixed `SEED_REFERENCE_DATE`.
- Built the D-05 fail-fast prerequisite guard (env presence by NAME, R2 HeadBucket + Redis PING when media is required, `skipMedia` for DB-only runs) — secret-safe (names, never values).
- Authored curated es-AR demo-grade content (building identity, 13 floors, typology mix + m² bands, orientations, 2 price lists, 2 CAC payment plans with semestral refuerzos, 18-month synthetic CAC series).
- `runSeed()` bootstraps the organization via the OWNER pool + pre-creates ≥2 monthly events partitions, then writes the `publicado` project, floors, units, price_lists, payment_plans, unit_prices, and cac_index — every tenant row through `withTenant` (production RLS path).
- SEED-01 + SEED-02 proven by an integration test: 13 floors, 38 units, pozo curve, 2 USD price_lists, integer-USD prices, CAC plans, 12-24 cac_index rows, and re-run count invariance.

## Task Commits

1. **Task 1: deterministic id core + db:seed wiring** - `7d34925` (feat)
2. **Task 2: prerequisites guard + es-AR content + owner scaffold** - `dc9f3ed` (feat)
3. **Task 3: building + pricing generators wired into runSeed** - `d46f16f` (feat)

_Task 3 is a tdd task; test + implementation landed in one atomic commit (integration generator)._

## Files Created/Modified
- `packages/db/src/seed/ids.ts` - SEED_NS, seedId (uuidv5), makePrng (mulberry32), SEED_REFERENCE_DATE — the idempotency core
- `packages/db/src/seed/content.ts` - curated es-AR constants (building, floors, typologies, pricing, CAC payment plans, 18-month CAC series)
- `packages/db/src/seed/prerequisites.ts` - assertSeedPrerequisites (D-05 fail-fast, skipMedia-aware)
- `packages/db/src/seed/building.ts` - seedBuilding → 13 floors + 38 units, deterministic pozo curve; returns SeededUnit[]
- `packages/db/src/seed/pricing.ts` - seedPricing → 2 USD price_lists, integer-USD unit_prices, CAC payment_plans, 18-month cac_index
- `packages/db/seed.ts` - runSeed({ skipMedia? }) entry: owner org root + partition DDL, withTenant project + generators; tsx-run CLI
- `packages/db/tests/seed.ids.test.ts` - determinism + PRNG reproducibility
- `packages/db/tests/seed.prerequisites.test.ts` - names-not-values, all-missing, resolves
- `packages/db/tests/seed.building-pricing.test.ts` - composition, pozo curve, pricing, CAC, re-run invariance
- `packages/db/package.json` - deps (uuid/bullmq/ioredis/@aws-sdk/client-s3/@imbau/storage) + tsx devDep + db:seed script
- `package.json` - root db:seed passthrough
- `packages/db/tsconfig.json` - include seed.ts

## Decisions Made
- **db:seed uses `tsx`, not `node --experimental-strip-types`** (see Deviations Rule 3). migrate.ts works under node strip-types only because it imports zero local `.ts` files; seed.ts imports the whole extensionless `@imbau/db` src graph, which pure Node ESM cannot resolve.
- **seedBuilding returns `SeededUnit[]`** (id + price inputs) rather than bare ids, so seedPricing computes realistic per-unit integer-USD prices without a DB round-trip.
- **Events partition DDL replicated inline in seed.ts** (mirrors `apps/worker/src/partitions.ts`) instead of imported — a package must not depend on an app.
- **`@imbau/storage` added to `@imbau/db`** (cycle-safe) so prerequisites.ts can HeadBucket-probe R2 without importing `@imbau/api` (which would create the db↔api cycle).
- **Fixed unit counts per floor** (PB 4, typical 3, semipiso/penthouse 2 = 38 total) to guarantee the 30-40 range deterministically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `db:seed` runner changed from `node --experimental-strip-types` to `tsx`**
- **Found during:** Task 2 (seed.ts owner scaffold)
- **Issue:** The plan specified `"db:seed": "node --experimental-strip-types seed.ts"` (mirroring migrate.ts). Verified empirically that Node's type-stripping cannot resolve extensionless relative imports (`ERR_MODULE_NOT_FOUND`); seed.ts (unlike migrate.ts) imports the extensionless `@imbau/db` src graph, so it cannot run under that runner.
- **Fix:** Switched the script to `"db:seed": "tsx seed.ts"` (tsx is the established repo TS runner — apps/worker uses it for `dev`) and added `tsx@4.22.4` as a devDependency of `@imbau/db`. Confirmed tsx resolves the extensionless graph.
- **Files modified:** packages/db/package.json
- **Verification:** Smoke-ran `runSeed({skipMedia:true})` via tsx against imbau_test — org present, project publicado, 7 events child partitions.
- **Committed in:** dc9f3ed (Task 2 commit)

**2. [Rule 2 - Missing Critical] `process.exit(0)` after the CLI `runSeed()` call**
- **Found during:** Task 2 (smoke test)
- **Issue:** `client.ts` opens process-global app/anon pools at import with no exported close, so the one-shot `pnpm db:seed` CLI would hang on open connections after the seed logically completes.
- **Fix:** Added `process.exit(0)` in the `isMain` branch only (tests import runSeed and never hit it).
- **Files modified:** packages/db/seed.ts
- **Verification:** Smoke run terminated cleanly.
- **Committed in:** dc9f3ed (Task 2 commit)

**3. [Rule 3 - Blocking] `@imbau/storage` added as a `@imbau/db` dependency**
- **Found during:** Task 2 (prerequisites.ts R2 probe)
- **Issue:** `assertSeedPrerequisites` needs `makeR2Client` (from `@imbau/storage`) to HeadBucket-probe R2, but `@imbau/storage` was not a declared dep of `@imbau/db`.
- **Fix:** Added `"@imbau/storage": "workspace:*"`. Verified no cycle (`@imbau/storage` deps only `@aws-sdk/client-s3`).
- **Files modified:** packages/db/package.json
- **Verification:** `@imbau/db` package.json contains no `@imbau/api` dep (cycle check green); typecheck + tests pass.
- **Committed in:** dc9f3ed (Task 2 commit)

**4. [Rule 1 - Bug] Test row-typing to satisfy TS strict (no `as unknown as`)**
- **Found during:** Task 3 (integration test typecheck)
- **Issue:** `owner.sql.unsafe(...)` rows typed as `Row & Iterable<Row>` failed direct casts under strict TS; the repo convention (WR-03) forbids `as unknown as`.
- **Fix:** Rewrote read-backs to use `owner.db.execute<T>(sql\`…\`)` (the setup.ts pattern), with `sql.raw(table)` for the fixed table whitelist and parameterized `ORG_ID`.
- **Files modified:** packages/db/tests/seed.building-pricing.test.ts
- **Verification:** typecheck clean; 39 tests pass.
- **Committed in:** d46f16f (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (2 blocking, 1 missing critical, 1 bug)
**Impact on plan:** All necessary for a runnable, non-hanging, cycle-free, strict-typed seed. No scope creep — the seed's content, structure, and idempotency guarantees match the plan exactly.

## Issues Encountered
- macOS lacks `timeout`; smoke scripts self-terminate via `process.exit(0)` instead.
- The vitest filename filter (`-- --run seed.*`) does not isolate a single file under this config; the whole `@imbau/db` suite (39 tests) runs — all green, so this is cosmetic.

## User Setup Required
None for this plan (pure-DB, `skipMedia`). The full media path (plan 03-02/03) will require R2 credentials + a running `apps/worker` (documented by the D-05 guard).

## Next Phase Readiness
- `seed.ts`, `ids.ts`, and `content.ts` are the foundation plans 03-02/03 build on; clearly-marked TODO call sites for `seedContentRows` and `seedMedia` are already in `runSeed`.
- Events partitions for the reference month + prior 2 months are pre-created, ready for D-07 cross-month events.
- Media seeding (SEED-03/D-04) still needs the R2 + worker path — deferred to plan 03-02/03 as designed.

## Self-Check: PASSED

All 9 created source/test files + SUMMARY exist on disk; all 3 task commits (7d34925, dc9f3ed, d46f16f) are in git history. `@imbau/db` test suite green (39 tests), typecheck + lint clean, no `@imbau/api` dependency.

---
*Phase: 03-seed-del-edificio-ficticio*
*Completed: 2026-07-01*
