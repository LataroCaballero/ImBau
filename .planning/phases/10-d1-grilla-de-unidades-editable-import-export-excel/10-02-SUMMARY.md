---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
plan: 02
subsystem: api
tags: [exceljs, excel, es-AR-money-parse, csv-injection, fast-check, dry-run, bulk-price]

# Dependency graph
requires:
  - phase: 10-01
    provides: "unit_prices UNIQUE(unit_id, price_list_id) — the natural key the import upsert + dry-run idempotency rely on"
  - phase: 03 (v1.0 quoting)
    provides: "packages/quoting formatUsd (185000 → 'US$ 185.000') — parseMoneyEsAr is its defensive inverse; the pure-module + property-test discipline cloned here"
provides:
  - "packages/api/src/excel/ — a pure, I/O-free Excel module: build (sanitized) + defensive es-AR money parse + dry-run classify/diff + bulk-preview"
  - "parseMoneyEsAr: the single load-bearing money invariant (never yields a non-integer), property-proven"
  - "buildDryRun(raw, current) + computeBulkPreview(selection, mode, value): the pure engines Plan 03's four mutations wrap in withTenant"
affects: [10-03, panel-units-grid, import-wizard, bulk-edit]

# Tech tracking
tech-stack:
  added: ["exceljs@4.4.0 (runtime, MIT)", "fast-check (devDep, already in repo)"]
  patterns:
    - "Pure I/O-free module (no fs/DB/network) — Excel reads/writes Buffers only, matching the packages/quoting discipline"
    - "Defensive cell-type parsing: branch on ExcelJS.ValueType, never trust cell.value typed as number"
    - "Uniform CSV/formula-injection sanitization ('-prefix on = + - @ tab CR) applied to every string cell + exact inverse on read for a lossless round-trip"

key-files:
  created:
    - packages/api/src/excel/template.ts
    - packages/api/src/excel/types.ts
    - packages/api/src/excel/money.ts
    - packages/api/src/excel/build.ts
    - packages/api/src/excel/parse.ts
    - packages/api/src/excel/dry-run.ts
    - packages/api/src/excel/bulk.ts
    - packages/api/src/excel/money.test.ts
    - packages/api/src/excel/build.test.ts
    - packages/api/src/excel/parse.test.ts
    - packages/api/src/excel/dry-run.test.ts
    - packages/api/src/excel/bulk.test.ts
  modified:
    - packages/api/package.json
    - packages/api/vitest.config.ts
    - pnpm-lock.yaml

key-decisions:
  - "Unknown identificador → validation error ('no existe en el proyecto'), NOT a 'nueva' — units are created elsewhere, not via Excel. Resolves an internal plan contradiction in favor of the explicit acceptance criteria + UI-SPEC copy."
  - "'nueva' = a project unit that was entirely unpriced (both lists null) and gains a price on import; any other modification of a tracked unit is 'con cambios'. Keeps the classification meaningful without allowing unit creation."
  - "A BLANK price cell on import = null (no price), not an error — the only way an unchanged export re-imports as all 'sin cambios' (GRID-05 idempotency). Only MALFORMED prices are errors."
  - "Valid estado set defined locally in dry-run.ts (mirrors unidadEstadoEnum) rather than importing @imbau/db — keeps the module provably DB-free per Task 2 acceptance."

patterns-established:
  - "Pattern: pure excel engines feed thin withTenant mutations (Plan 03) — validation truth lives in the pure module, re-run server-side inside the tx"
  - "Pattern: fast-check property test guards the load-bearing invariant (money never non-integer; bulk preview never negative/non-integer)"

requirements-completed: [GRID-03, GRID-04, GRID-06]

coverage:
  - id: D1
    description: "Defensive es-AR money parser: any fractional/non-digit/formula/date/richText/error cell is rejected; a successful parse is ALWAYS a non-negative integer USD (D-08)"
    requirement: GRID-04
    verification:
      - kind: unit
        ref: "packages/api/src/excel/money.test.ts#parseMoneyEsAr accepts/rejects + property"
        status: pass
    human_judgment: false
  - id: D2
    description: "CSV/formula-injection sanitization: every string cell starting with = + - @ tab CR is '-prefixed on export (GRID-03, D-11)"
    requirement: GRID-03
    verification:
      - kind: unit
        ref: "packages/api/src/excel/build.test.ts#sanitizeCell + build→parse round-trip"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cell-type-safe import: parseWorkbook keeps raw money cells; formula/date/richText/error/empty cells are surfaced for defensive per-cell parse (GRID-04)"
    requirement: GRID-04
    verification:
      - kind: unit
        ref: "packages/api/src/excel/parse.test.ts#parseWorkbook cell-type-safe reads"
        status: pass
    human_judgment: false
  - id: D4
    description: "Dry-run classification/diff: nueva / con cambios (field-by-field old→new) / sin cambios / inválida with es-AR reasons; unchanged re-import → all sin cambios (GRID-04, D-06/D-07, idempotency)"
    requirement: GRID-04
    verification:
      - kind: unit
        ref: "packages/api/src/excel/dry-run.test.ts#classification + es-AR reasons + idempotency"
        status: pass
    human_judgment: false
  - id: D5
    description: "Bulk-preview: % or fixed over one list, Math.round to integer USD, rejects <0 and unpriced with es-AR reasons (GRID-06, D-12)"
    requirement: GRID-06
    verification:
      - kind: unit
        ref: "packages/api/src/excel/bulk.test.ts#percent/fixed rounding + negative rejection + property"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-22
status: complete
---

# Phase 10 Plan 02: Pure Excel round-trip module Summary

**Pure, I/O-free `packages/api/src/excel/` module — defensive es-AR integer-USD money parse (property-proven), formula/CSV-injection-sanitized workbook build/parse, dry-run classification/diff, and bulk-preview — the net-new 20% risk isolated and exhaustively tested before any mutation is wired.**

## Performance

- **Duration:** ~20 min (resume of a stalled prior run)
- **Completed:** 2026-07-22
- **Tasks:** 2 (both TDD)
- **Files modified:** 15 (12 created in src/excel, 3 modified: package.json, vitest.config.ts, pnpm-lock.yaml)

## Accomplishments
- `parseMoneyEsAr` — the single load-bearing money invariant: branches on `ExcelJS.ValueType` (rejects formula/date/richText/error), gates every value on `Number.isInteger && >= 0`, and a fast-check property proves NO cell input ever yields a non-integer or negative value.
- `sanitizeCell` / `buildWorkbook` — uniform `'`-prefix on `= + - @` tab CR (GRID-03, D-11), written as a lossless round-trip with `unsanitizeCell` as the exact inverse.
- `buildDryRun` — classifies nueva / con cambios (field-by-field old→new) / sin cambios / inválida with es-AR reasons; an unchanged export re-imports as every-row `sin cambios` (the GRID-05 idempotency signal).
- `computeBulkPreview` — % or fixed change over one list, `Math.round` to integer USD (D-12), rejects any `< 0` result and any unpriced unit with an es-AR reason (Open Q #2 resolution).
- Full `@imbau/api` gate green: 62 excel tests (5 files) pass in ~1s with no DB, typecheck clean, lint clean. SheetJS stays absent.

## Task Commits

1. **Task 1: exceljs + template/types/money/build/parse + tests** - `5211fd5` (feat)
2. **Task 2: dry-run classification/diff + bulk-preview + tests** - `4cd7885` (feat)

_Note: Task 1's source (template/types/money/build/parse) and tests were authored by the prior stalled run and committed here intact; Task 2 (dry-run/bulk) was authored during this resume. Because nothing was committed before the stall, the RED/GREEN TDD gates could not be reconstructed as separate commits — each task is a single feat carrying source + passing tests (see TDD Gate Compliance)._

## Files Created/Modified
- `packages/api/src/excel/template.ts` - Canonical single-sheet column order (single source of truth for export + import, D-09)
- `packages/api/src/excel/types.ts` - RawRow/ExportRow/CurrentUnit/RowClass/FieldDiff/DryRunResult/BulkPreview
- `packages/api/src/excel/money.ts` - `parseMoneyEsAr` defensive es-AR → integer-USD parse
- `packages/api/src/excel/build.ts` - `sanitizeCell` + `buildWorkbook` (I/O-free, writeBuffer)
- `packages/api/src/excel/parse.ts` - `parseWorkbook` (keeps raw money cells) + `unsanitizeCell`
- `packages/api/src/excel/dry-run.ts` - `buildDryRun(raw, current)` classify/diff engine
- `packages/api/src/excel/bulk.ts` - `computeBulkPreview(selection, mode, value)` calculator
- `packages/api/src/excel/{money,build,parse,dry-run,bulk}.test.ts` - unit + fast-check property tests
- `packages/api/package.json` - exceljs@4.4.0 (runtime) + fast-check (devDep) added
- `packages/api/vitest.config.ts` - includes `src/**/*.test.ts` for the colocated pure suites
- `pnpm-lock.yaml` - exceljs dependency tree

## Decisions Made
- **Resolved a plan-internal contradiction** (behavior text said "identificador absent from current → nueva" while acceptance criteria + UI-SPEC said "unknown identificador → error"): unknown identificador is an ERROR ("no existe en el proyecto") since units are not created via Excel; `nueva` is a previously-unpriced project unit that gains a price. This satisfies every explicit acceptance criterion and the UI-SPEC copy.
- **Blank price cell = null, not error** — required for GRID-05 idempotency (an unchanged export must re-import as all `sin cambios`).
- **Valid estado set kept local** in dry-run.ts (mirrors `unidadEstadoEnum`) to keep the module provably free of DB imports per Task 2 acceptance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed an unnecessary type assertion flagged by lint in parse.test.ts**
- **Found during:** Full quality gate (lint) after implementing Task 2
- **Issue:** `Buffer.from((await new ExcelJS.Workbook().xlsx.writeBuffer()) as ArrayBuffer)` tripped `@typescript-eslint/no-unnecessary-type-assertion` (the prior stalled run left it; lint had never been run before the stall).
- **Fix:** Dropped the `as ArrayBuffer` cast — `writeBuffer()` is already assignable to `Buffer.from`'s arg (build.ts uses the same call uncast and typechecks).
- **Files modified:** packages/api/src/excel/parse.test.ts
- **Verification:** `pnpm --filter @imbau/api lint` clean; excel suite still 62/62 green; typecheck clean.
- **Committed in:** `5211fd5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/blocking-lint)
**Impact on plan:** Necessary to pass the plan's lint gate. No scope creep.

## Issues Encountered
- **Prior run stalled on the stream watchdog before committing anything.** The on-disk work (template/types/money/build/parse + their tests, exceljs deps, vitest config) was consistent and typechecked clean. This resume kept that work intact, authored the two missing modules (dry-run.ts, bulk.ts) + tests, ran the full gate, and reconstructed the commits along the plan's 2-task boundaries.

## TDD Gate Compliance
The plan's two tasks are `tdd="true"`. Because the prior run stalled with ZERO commits, there is no RED (`test(...)`) commit preceding a GREEN (`feat(...)`) commit — the source and its passing tests were reconstructed together post-hoc into one `feat` commit per task. The tests are exhaustive (unit + fast-check property on the two load-bearing invariants) and all pass, but the RED→GREEN commit sequence is not present in git history. This is a consequence of the stall+resume, not a testing gap.

## Self-Check: PASSED

Files verified on disk: template.ts, types.ts, money.ts, build.ts, parse.ts, dry-run.ts, bulk.ts, money.test.ts, build.test.ts, parse.test.ts, dry-run.test.ts, bulk.test.ts — all present.
Commits verified in git log: `5211fd5`, `4cd7885` — both present.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The pure engines (`buildWorkbook`, `parseWorkbook`, `parseMoneyEsAr`, `buildDryRun`, `computeBulkPreview`) are ready for Plan 03 to wrap in the four thin `requireRole` + `withTenant` mutations (updatePrice, updateEstado, bulkUpdatePrice, importExcel), with import-apply as a single all-or-nothing tx re-running `buildDryRun` server-side.
- GRID-07 public reflection remains the resolved Path A (apps/web stays `force-dynamic`; cross-surface integration test) — Plan 03/04 scope.

---
*Phase: 10-d1-grilla-de-unidades-editable-import-export-excel*
*Completed: 2026-07-22*
