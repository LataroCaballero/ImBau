---
phase: 04-motor-de-cotizaci-n-puro-packages-quoting
plan: 04
subsystem: quoting
tags: [quoting, decimal.js, vitest, coverage, serializers, barrel, es-AR]

# Dependency graph
requires:
  - phase: 04-02
    provides: format.ts (formatUsd/formatArs shared es-AR formatter), types.ts (QuoteComparison, PdfModel)
  - phase: 04-03
    provides: engine.ts (calcQuote), package-scoped vitest coverage config
provides:
  - compareQuotes(contado, financiado) — derived ahorro USD + 2-decimal % (D-11)
  - toWhatsAppText(result) + toPdfModel(result) — two pure serializers off one QuoteResult (ENGINE-03/D-12)
  - completed public barrel (index.ts) — full runtime + type-only API, money internals hidden
  - enforced package-wide 100% coverage gate (test script now runs --coverage)
affects: [fase-5-api, fase-6-ui-whatsapp, fase-7-pdf]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One QuoteResult, many serializers (Pattern 3): every surface derives from the same result via the one formatter — UI == PDF == WhatsApp can't drift"
    - "Derived-figure single source: compareQuotes is the only place ahorro is computed; surfaces read, never recompute (D-11)"
    - "Barrel convention: export {} for runtime, export type {} for type-only (verbatimModuleSyntax), internals unexported"

key-files:
  created:
    - packages/quoting/src/compare.ts
    - packages/quoting/src/compare.test.ts
    - packages/quoting/src/serialize.ts
    - packages/quoting/src/serialize.test.ts
  modified:
    - packages/quoting/src/index.ts
    - packages/quoting/package.json
    - packages/config/eslint.js

key-decisions:
  - "Made the package `test` script `vitest run --coverage` so the thresholds{100:true} gate is actually enforced (was dormant under plain `vitest run`)"
  - "Added `**/coverage/**` to the shared eslint ignores — coverage now generates on every test run and would otherwise break `eslint .`"
  - "Primera cuota shown in ARS for CAC plans (formatArs) and in USD for fijo plans (formatUsd), via one shared formatter"

patterns-established:
  - "Pattern 3 — one QuoteResult feeds every serializer; serializers never re-run the engine (grep-verified)"
  - "Derived figures (ahorro) computed once in compareQuotes; surfaces consume, never recompute"

requirements-completed: [ENGINE-03, ENGINE-04]

coverage:
  - id: D1
    description: "compareQuotes derives ahorroUsd (int) + ahorroPct (2-decimal string) via decimal.js — single source, surfaces never recompute (D-11)"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "packages/quoting/src/compare.test.ts#compareQuotes — derived ahorro figures (D-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "toWhatsAppText + toPdfModel are pure serializers off one QuoteResult (never re-run the engine); all amounts via the shared es-AR formatter — three surfaces cannot drift (ENGINE-03/D-12)"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "packages/quoting/src/serialize.test.ts#no drift — both serializers derive from the same QuoteResult"
        status: pass
    human_judgment: false
  - id: D3
    description: "Public barrel exposes full engine API (runtime + types); money primitives kept internal"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "grep: export { calcQuote / export type { present; no roundHalfUpUsd/allocateCuotas exported"
        status: pass
    human_judgment: false
  - id: D4
    description: "Package-scoped 100% coverage gate is enforced and green (lines/branches/functions/statements), no coverage-ignore pragma in src"
    requirement: "ENGINE-04"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/quoting test (vitest run --coverage) — 100% 69/69 stmts, 36/36 branches, 16/16 funcs, 59/59 lines"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 04: Public surface + coverage gate Summary

**Finalized the quoting engine's public contract — compareQuotes ahorro figures, two pure serializers (toWhatsAppText/toPdfModel) off one QuoteResult, the completed barrel, and an actually-enforced package-wide 100% coverage gate.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-03T16:15:59Z
- **Completed:** 2026-07-03T16:24:00Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `compareQuotes(contado, financiado)` — the single source of the ahorro USD + 2-decimal % figures, computed with decimal.js half-up (never a float); surfaces read it, never recompute (D-11).
- `toWhatsAppText` + `toPdfModel` — two pure serializers that derive WhatsApp text and a PDF data model from the SAME `QuoteResult`, rendering every amount through the one shared es-AR formatter (`formatUsd`/`formatArs`). Neither re-runs the engine — grep-verified. One output shape, three surfaces that can't drift (ENGINE-03).
- Completed the public barrel (`index.ts`): full runtime API (`calcQuote`, `compareQuotes`, `toWhatsAppText`, `toPdfModel`, `ENGINE_VERSION`, `QuoteError`, `formatUsd`, `formatArs`) + all public types via `export type`; money primitives stay internal.
- Locked the 100% coverage gate: it is now actually enforced on every `pnpm test` (was dormant), green at 100% on all four metrics with no coverage-ignore escape hatch.

## Task Commits

Each task was committed atomically:

1. **Task 1: compareQuotes (TDD)** - `66b8d5b` (feat)
2. **Task 2: pure serializers toWhatsAppText + toPdfModel (TDD)** - `d5190d5` (feat)
3. **Task 3: barrel + enforced coverage gate** - `abfe895` (feat)

_Note: TDD tasks 1 & 2 combined RED+GREEN into a single commit each (test + impl verified together)._

## Files Created/Modified
- `packages/quoting/src/compare.ts` - `compareQuotes` deriving ahorro USD + % via decimal.js (single source, D-11)
- `packages/quoting/src/compare.test.ts` - exact-assertion tests: repeating-decimal (16.67), equal-price zero, clean-ratio
- `packages/quoting/src/serialize.ts` - `toWhatsAppText` (short es-AR voseo resumen) + `toPdfModel` (pure data model + 2 leyendas), both off one QuoteResult via shared formatter
- `packages/quoting/src/serialize.test.ts` - builds one result per scenario (contado/CAC/fijo); asserts both serializers + no drift
- `packages/quoting/src/index.ts` - completed public barrel (runtime + type-only exports, internals hidden)
- `packages/quoting/package.json` - `test` script now `vitest run --coverage` (gate enforcement)
- `packages/config/eslint.js` - added `**/coverage/**` to shared ignores

## Decisions Made
- Primera cuota rendered in ARS (`formatArs`) for CAC plans and in USD (`formatUsd`) for fijo plans — both via the one shared formatter, so no inline currency strings.
- PDF `leyendas` always carry "Cotización no vinculante." + the CAC-adjustment note for both modalidades (simpler, no extra branch).
- Money primitives (`roundHalfUpUsd`/`allocateCuotas`/`decimal2`) deliberately NOT re-exported — implementation detail (threat T-04-07).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Coverage gate was dormant — made `test` script collect coverage**
- **Found during:** Task 3 (enforce the coverage gate)
- **Issue:** The plan's cited gate command `pnpm --filter @imbau/quoting test -- --coverage` does NOT collect coverage: the `--` is passed through as `vitest run -- --coverage`, so `--coverage` is parsed as a positional test-name filter, not the flag. Coverage was never measured and the `thresholds{100:true}` gate never fired (exactly the pitfall the 04-03 handoff flagged).
- **Fix:** Changed the `test` script from `vitest run` to `vitest run --coverage`, so the canonical `pnpm --filter @imbau/quoting test` collects coverage and enforces 100%. Proven by adding a temporary uncovered function → gate exits 1; reverted.
- **Files modified:** `packages/quoting/package.json`
- **Verification:** `pnpm --filter @imbau/quoting test` reports 100% (69/69 stmts, 36/36 branches, 16/16 funcs, 59/59 lines) and exits 0; the enforcement was proven to fail on uncovered code.
- **Committed in:** `abfe895` (Task 3 commit)

**2. [Rule 3 - Blocking] Shared eslint config linted the generated coverage report**
- **Found during:** Task 3 (running lint after coverage now generates `coverage/`)
- **Issue:** Once `test` generates a `coverage/` directory, `eslint .` tries to parse the HTML report's JS assets (`block-navigation.js`, `prettify.js`, `sorter.js`) and fails with "not found by the project service" — this is the deferred item 04-03 logged (`packages/config/eslint.js` ignores lacked `**/coverage/**`). My change made it a hard blocker.
- **Fix:** Added `**/coverage/**` to the shared eslint `ignores` array. (`coverage/` is already gitignored at repo root, so nothing generated is committed.)
- **Files modified:** `packages/config/eslint.js`
- **Verification:** `pnpm --filter @imbau/quoting lint` exits 0 with a `coverage/` dir present.
- **Committed in:** `abfe895` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking)
**Impact on plan:** Both fixes are required for the plan's own must-have ("the enforced coverage gate is green") to be true and for lint to pass. The eslint change resolves a cross-plan deferred item. Both are scoped to the coverage-enablement my task performs. No scope creep.

## Issues Encountered
- The plan's grep-based `<verify>` blocks match literal substrings, so comments in `compare.ts`/`serialize.ts` that mentioned `parseFloat`/`calcQuote` tripped the "must find nothing" checks. Reworded those comments (no behavior change) so the grep guards pass cleanly.

## User Setup Required
None - no external service configuration required. `packages/quoting` is a pure package (no I/O, no env, no DB).

## Next Phase Readiness
- The `QuoteResult` contract and full public API are locked — fases 5 (API/persistence), 6 (UI/WhatsApp) and 7 (PDF) can build against `@imbau/quoting` directly.
- Serializer copy is a reasonable draft (D-12/D-13): final es-AR wording is validated against the live surfaces in fases 6/7 and does not bump `ENGINE_VERSION`.
- Phase 04 (all 4 plans) is complete; the crown-jewel engine is at enforced 100% coverage.

## Self-Check: PASSED

All created files present on disk; all task commits (`66b8d5b`, `d5190d5`, `abfe895`) and the SUMMARY commit (`6728a9a`) verified in git history.

---
*Phase: 04-motor-de-cotizaci-n-puro-packages-quoting*
*Completed: 2026-07-03*
