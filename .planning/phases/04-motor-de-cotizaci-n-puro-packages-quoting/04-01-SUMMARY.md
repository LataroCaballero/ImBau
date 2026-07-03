---
phase: 04-motor-de-cotizaci-n-puro-packages-quoting
plan: 01
subsystem: quoting
tags: [decimal.js, fast-check, vitest, coverage, money, versioning, typescript]

# Dependency graph
requires:
  - phase: 01-schema+media+seed
    provides: quoteSnapshotSchema envelope (z.literal(1)) in packages/db/src/schema/json-schemas.ts; payment_plans.anticipoPct + cac_index.valor numeric columns (arrive as strings)
provides:
  - "packages/quoting foundation: exact-pinned engine deps (decimal.js runtime; fast-check, @fast-check/vitest, @vitest/coverage-v8 dev)"
  - "Package-scoped 100% coverage gate (vitest.config.ts thresholds { 100: true }); root config stays threshold-free"
  - "Money primitives: roundHalfUpUsd (D-03), allocateCuotas (D-02, last cuota absorbs remainder), decimal2 (D-04) on one ROUND_HALF_UP Decimal clone"
  - "ENGINE_VERSION = 1 constant (D-13/ENGINE-06), equal to the snapshot envelope literal, re-exported from the barrel"
affects: [04-02, 04-03, 04-04, calcQuote, serializers, formatters, quoting-property-tests]

# Tech tracking
tech-stack:
  added: [decimal.js@10.6.0, fast-check@4.8.0, "@fast-check/vitest@0.4.1", "@vitest/coverage-v8@4.1.8"]
  patterns:
    - "One module-local Decimal.clone({ rounding: ROUND_HALF_UP }) = single visible rounding decision (ENGINE-05)"
    - "Package-scoped coverage gate via mergeConfig(rootConfig) — threshold never at the root"
    - "Named remainder rule (D-02): last cuota absorbs resto; N-1 identical base = floor(saldo/N)"
    - "Numeric Drizzle strings wrapped directly in Decimal — never float-coerced (Pitfall 1)"

key-files:
  created:
    - packages/quoting/vitest.config.ts
    - packages/quoting/src/version.ts
    - packages/quoting/src/version.test.ts
    - packages/quoting/src/money.ts
    - packages/quoting/src/money.test.ts
  modified:
    - packages/quoting/package.json
    - packages/quoting/tsconfig.json
    - packages/quoting/src/index.ts
    - pnpm-lock.yaml

key-decisions:
  - "ENGINE_VERSION exported as integer 1 (as const), pinned equal to quoteSnapshotSchema z.literal(1) so a snapshot needs no migration (D-13)"
  - "allocateCuotas: last cuota absorbs the remainder (D-02) — deliberate override of research's 'distribute across first k' suggestion"
  - "vitest.config.ts added to packages/quoting/tsconfig.json include so the eslint TS project service resolves it (matches packages/db)"

patterns-established:
  - "Package-scoped 100% coverage gate: mergeConfig(rootConfig) + coverage.thresholds { 100: true }, include src/**/*.ts, exclude *.test.ts + barrel"
  - "Money discipline: decimal.js only, one ROUND_HALF_UP clone, integer USD in/out, 2-decimal ARS string, no float coercion, exact (===) assertions"

requirements-completed: [ENGINE-05, ENGINE-06]

coverage:
  - id: D1
    description: "Engine deps installed at exact pins (decimal.js runtime; fast-check, @fast-check/vitest, @vitest/coverage-v8 dev); placeholder roundUsd removed"
    requirement: "ENGINE-05"
    verification:
      - kind: other
        ref: "grep '\"decimal.js\": \"10.6.0\"' packages/quoting/package.json && ! grep -rq roundUsd packages/quoting/src"
        status: pass
    human_judgment: false
  - id: D2
    description: "Package-scoped 100% coverage gate armed; root vitest.config.ts has no threshold"
    requirement: "ENGINE-05"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/quoting exec vitest run --coverage (100% stmts/branches/funcs/lines; gate did not fail)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Money primitives: roundHalfUpUsd (D-03), allocateCuotas (D-02, last absorbs remainder, Σcuotas === saldo), decimal2 (D-04)"
    requirement: "ENGINE-05"
    verification:
      - kind: unit
        ref: "packages/quoting/src/money.test.ts (13 tests, exact assertions)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ENGINE_VERSION = 1 exported and equal to the quoteSnapshotSchema envelope literal (D-13)"
    requirement: "ENGINE-06"
    verification:
      - kind: unit
        ref: "packages/quoting/src/version.test.ts#ENGINE_VERSION equals 1"
        status: pass
    human_judgment: false

# Metrics
duration: ~5min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 01: Quoting Engine Foundation Summary

**decimal.js money primitives (half-up anticipo, last-cuota-absorbs-remainder split, exact 2-decimal ARS) on a single ROUND_HALF_UP clone, plus a package-scoped 100% coverage gate and an ENGINE_VERSION pinned to the snapshot envelope**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-03T15:43:00Z
- **Completed:** 2026-07-03T15:48:00Z
- **Tasks:** 2 (Task 2 via TDD: RED → GREEN)
- **Files modified:** 9

## Accomplishments
- Installed the three net-new engine deps at exact pins (decimal.js@10.6.0 runtime; fast-check@4.8.0, @fast-check/vitest@0.4.1, @vitest/coverage-v8@4.1.8 dev) — decimal.js is the engine's only runtime dependency, per the pure-package constraint.
- Stood up a package-scoped 100% coverage gate (`vitest.config.ts` via `mergeConfig(rootConfig)` + `coverage.thresholds { 100: true }`) — the root config remains threshold-free so no other package reddens.
- Removed the placeholder `roundUsd` + `index.test.ts`; the barrel now re-exports `ENGINE_VERSION`.
- Authored the two numeric cornerstones every later plan depends on: `version.ts` (`ENGINE_VERSION = 1`, equal to `quoteSnapshotSchema`'s `z.literal(1)`) and `money.ts` (`roundHalfUpUsd`, `allocateCuotas`, `decimal2`) on one `ROUND_HALF_UP` Decimal clone.
- 100% coverage (8/8 stmts, 2/2 branches, 4/4 funcs, 7/7 lines); typecheck + lint green; 13 tests pass.

## Task Commits

1. **Task 1: Deps + coverage gate + placeholder removal + ENGINE_VERSION** - `a6d4792` (feat)
2. **Task 2 (RED): failing money tests** - `65b3f88` (test)
3. **Task 2 (GREEN): money primitives implementation** - `11109e4` (feat)

_Task 2 followed TDD: test → feat. No REFACTOR commit — the GREEN implementation was already clean and at 100% coverage._

## Files Created/Modified
- `packages/quoting/vitest.config.ts` - Package-scoped Vitest config: `mergeConfig(root)` + `coverage.thresholds { 100: true }`, include `src/**/*.ts`, exclude tests + barrel.
- `packages/quoting/src/version.ts` - `ENGINE_VERSION = 1 as const`; header pins it to the snapshot envelope literal (D-13/ENGINE-06).
- `packages/quoting/src/version.test.ts` - Asserts `ENGINE_VERSION === 1` and documents the envelope contract.
- `packages/quoting/src/money.ts` - `roundHalfUpUsd` (D-03), `allocateCuotas` (D-02), `decimal2` (D-04) on one `ROUND_HALF_UP` Decimal clone.
- `packages/quoting/src/money.test.ts` - 13 exact-assertion unit tests over every behavior-block case, incl. a named remainder-rule test proving `Σcuotas === saldo`.
- `packages/quoting/src/index.ts` - Barrel now `export { ENGINE_VERSION } from "./version"` (placeholder removed).
- `packages/quoting/package.json` - Engine deps added at exact pins.
- `packages/quoting/tsconfig.json` - Added `vitest.config.ts` to `include` (eslint project service; matches packages/db).
- `pnpm-lock.yaml` - Lockfile updated for the new deps.

## Decisions Made
- **ENGINE_VERSION as integer `1 as const`** — matches `quoteSnapshotSchema`'s `z.literal(1)` so a persisted snapshot validates with no migration (D-13). Header documents the lock-step bump rule.
- **`allocateCuotas` — last cuota absorbs the remainder (D-02)** — the user's locked rule, a deliberate override of research's "distribute across the first k" suggestion; the header names it and a test proves `Σcuotas === saldo`.
- **`.toNumber()` kept as the sole Decimal→number conversion** — research-verbatim and idiomatic; see Deviations for the over-broad verify grep note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `vitest.config.ts` to `packages/quoting/tsconfig.json` include**
- **Found during:** Task 1 (lint gate)
- **Issue:** `eslint .` failed — `vitest.config.ts was not found by the project service` because the package tsconfig only included `["src"]`.
- **Fix:** Extended `include` to `["src", "vitest.config.ts"]`, mirroring `packages/db/tsconfig.json` (which already lists its `vitest.config.ts`).
- **Files modified:** packages/quoting/tsconfig.json
- **Verification:** `pnpm --filter @imbau/quoting lint` passes; typecheck still green.
- **Committed in:** `a6d4792` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the lint gate the plan requires; no scope creep — matches an established sibling-package pattern.

## Issues Encountered
- **Task 2 verify command has two over-broad greps (false positives, code intent is met).** (1) `! grep -q 'toBeCloseTo' money.test.ts` originally matched an explanatory comment; reworded the comment so the grep is now fully clean (0 matches). (2) `! grep -Eq 'parseFloat|Number\(' money.ts` matches decimal.js's idiomatic `.toNumber()` method (the substring `Number(` inside `toNumber(`), NOT the banned `Number(str)`/`parseFloat(str)` coercion. The genuine requirement — no float coercion of the numeric-string args — holds: `anticipoPct` and `cacValor` are wrapped directly in `new D(...)`. `.toNumber()` is the research-verbatim Decimal→integer-USD conversion and the only residual match; comment prose was reworded to remove all other matches. Kept `.toNumber()` for quality over gaming the grep.

## User Setup Required
None - no external service configuration required. Pure package, no I/O.

## Next Phase Readiness
- Money primitives + `ENGINE_VERSION` + coverage gate + deps are the base for plan 04-03 (`calcQuote` + fast-check property tests) and the barrel completion in plan 04-04.
- The 100% gate is armed now and enforced package-wide once the full surface lands (plan 04-04).
- No blockers.

---
*Phase: 04-motor-de-cotizaci-n-puro-packages-quoting*
*Completed: 2026-07-03*
