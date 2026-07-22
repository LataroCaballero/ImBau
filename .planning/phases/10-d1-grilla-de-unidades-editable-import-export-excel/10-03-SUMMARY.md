---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
plan: 03
subsystem: api
tags: [trpc, drizzle, rls, postgres, exceljs, multi-tenant, requireRole, onConflictDoUpdate, events-audit]

# Dependency graph
requires:
  - phase: 10-01
    provides: "UNIQUE(unit_id, price_list_id) on unit_prices — the onConflictDoUpdate conflict target"
  - phase: 10-02
    provides: "pure I/O-free packages/api/src/excel module (buildWorkbook, parseWorkbook, buildDryRun, computeBulkPreview, parseMoneyEsAr)"
  - phase: 09-01
    provides: "panel write mold: requireRole(owner,developer) over withTenant + .returning() 0-row NOT_FOUND"
provides:
  - "unitsRouter: grid read (listForProject) + 4 money mutations (updatePrice, updateEstado, importExcel, bulkUpdatePrice) + export/dry-run/bulk-preview"
  - "events audit trail (unit_price_changed / unit_estado_changed) riding the same transaction as every price/estado write (D-02)"
  - "all-or-nothing + idempotent Excel import apply (single withTenant tx, server re-validates via buildDryRun)"
  - "GRID-07 public reflection proven cross-surface (Path A, force-dynamic, no revalidation plumbing)"
affects: [phase-11-leads, phase-12-hotspots, panel-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "INSERT ... ON CONFLICT write mutation: RLS-scoped existence pre-check → NOT_FOUND, then upsert (the INSERT-path variant of the Phase 9 UPDATE 0-row mold)"
    - "Transactional bulk apply: one withTenant tx wraps the whole N-upsert + events loop (all-or-nothing); server re-runs the pure validator inside the tx"
    - "events audit insert co-transactional with the mutating write (audit row exists iff the write committed)"

key-files:
  created:
    - "packages/api/src/trpc/routers/units.ts — unitsRouter (grid read + 4 mutations + export/dry-run/bulk-preview)"
    - "packages/api/tests/units-role-gate.test.ts — cross-role authz + tenant-isolation matrix"
    - "packages/api/tests/import-apply.test.ts — atomicity + idempotency vs real Postgres"
    - "packages/api/tests/public-reflection.test.ts — GRID-07 cross-surface (Path A)"
  modified:
    - "packages/api/src/trpc/routers/_app.ts — registered units: unitsRouter (travels to panel via AppRouter)"

key-decisions:
  - "updatePrice uses an RLS-scoped existence pre-check (unit + price_list under the active org) to return NOT_FOUND, because an INSERT ... ON CONFLICT against a cross-org parent raises a composite-FK violation (23503) rather than the clean 0-row an UPDATE gives — same no-enumeration guarantee, correct for the INSERT path."
  - "A cleared (blank/null) price cell on import DELETEs the unit_prices row (precio is NOT NULL integer — an unpriced unit has no row, not a 0 row)."
  - "events.tipo constants are stable English: unit_price_changed / unit_estado_changed (Open Q #3)."
  - "GRID-07 satisfied by Path A (keep force-dynamic, cross-surface integration test) — no /api/revalidate, revalidateTag, or REVALIDATE_SECRET introduced (D-14)."

patterns-established:
  - "Money mutation mold for D2/hotspots: requireRole(owner,developer) → withTenant → write → .returning() 0-row NOT_FOUND → co-transactional events audit."
  - "Thin transactional wrappers over a pure I/O-free module: all risky money/classification/bulk logic delegated to packages/api/src/excel; the router only supplies the DB snapshot and persists the result."

requirements-completed: [GRID-01, GRID-02, GRID-03, GRID-04, GRID-05, GRID-06, GRID-07]

coverage:
  - id: D1
    description: "Inline price edit upserts one row per unit×list with server-set vigencia; owner/developer succeed, viewer FORBIDDEN, cross-org/non-existent NOT_FOUND"
    requirement: "GRID-01"
    verification:
      - kind: integration
        ref: "packages/api/tests/units-role-gate.test.ts#units.updatePrice write gate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Inline estado edit persists, validated against unidadEstadoEnum, same role/isolation matrix"
    requirement: "GRID-02"
    verification:
      - kind: integration
        ref: "packages/api/tests/units-role-gate.test.ts#units.updateEstado write gate"
        status: pass
    human_judgment: false
  - id: D3
    description: "Export returns a sanitized canonical-template workbook of all project units"
    requirement: "GRID-03"
    verification:
      - kind: integration
        ref: "packages/api/tests/import-apply.test.ts#exportExcel covers all project units"
        status: pass
    human_judgment: false
  - id: D4
    description: "Import dry-run returns the classified diff (nuevas/con cambios/sin cambios/errores) against live DB rows, writing nothing"
    requirement: "GRID-04"
    verification:
      - kind: integration
        ref: "packages/api/tests/import-apply.test.ts#exportExcel round-trip dry-run clean"
        status: pass
    human_judgment: false
  - id: D5
    description: "Import apply is all-or-nothing in one withTenant tx (one bad row → zero writes); unchanged re-import is a no-op; server re-validates dry-run, never trusts client"
    requirement: "GRID-05"
    verification:
      - kind: integration
        ref: "packages/api/tests/import-apply.test.ts#importExcel is transactional + idempotent"
        status: pass
    human_judgment: false
  - id: D6
    description: "Bulk price edit applies % or fixed to one list over a selection, Math.round integer USD, in one transaction; negatives rejected"
    requirement: "GRID-06"
    verification:
      - kind: integration
        ref: "packages/api/tests/units-role-gate.test.ts (bulk gated via requireRole) + packages/api/src/excel/bulk.test.ts (computeBulkPreview)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A committed panel price/estado mutation is observable through the anon caller on the next request (GRID-07 Path A, no cache plumbing)"
    requirement: "GRID-07"
    verification:
      - kind: integration
        ref: "packages/api/tests/public-reflection.test.ts#GRID-07 a committed panel write is visible to the anon public read"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every price/estado transition emits an events audit row inside the SAME transaction as the write (D-02)"
    verification:
      - kind: integration
        ref: "packages/api/tests/units-role-gate.test.ts (event counts) + import-apply.test.ts (audit emission + rollback)"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-22
status: complete
---

# Phase 10 Plan 03: units router — grid mutations + transactional Excel round-trip Summary

**A `units` tRPC router wiring the grid read + four money mutations + Excel export/dry-run as thin `requireRole`-gated `withTenant` clones over the pure Plan-02 excel module, with all-or-nothing/idempotent import apply, co-transactional events audit, and GRID-07 public reflection proven cross-surface.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-22T17:08:31Z
- **Completed:** 2026-07-22T17:22:00Z
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `unitsRouter` with `listForProject`, `updatePrice`, `updateEstado`, `exportExcel`, `dryRunImport`, `importExcel`, `bulkPreview`, `bulkUpdatePrice` — every write gated by `requireRole("owner","developer")` over `withTenant`, registered in `_app.ts` (travels to the panel by type).
- Import apply + bulk apply are each ONE `withTenant` transaction: server re-parses + re-validates via the pure `buildDryRun`, throws-to-rollback on any error (zero writes), upserts on the Plan-01 `UNIQUE(unit_id, price_list_id)` (idempotent), with an `events` audit row per change riding the same transaction (D-02).
- All risky logic delegated to `packages/api/src/excel` — no re-implemented money parse, dry-run classification, or bulk preview.
- Three integration suites green vs real Postgres (19 tests): cross-role authz + tenant isolation, atomicity + idempotency, GRID-07 public reflection (Path A). Full `@imbau/api` gate: 124/124 tests, typecheck + lint clean.

## Task Commits

1. **Task 1: units router grid read + inline price/estado mutations + role gate** — `44c4e52` (feat)
2. **Task 2: all-or-nothing + idempotent Excel import apply suite** — `2fd77e4` (test)
3. **Task 3: GRID-07 public reflection cross-surface (Path A)** — `2fd349a` (test)

_Note: the units.ts router file (Task 1 commit) contains both the Task-1 inline mutations and the Task-2 export/dry-run/import/bulk procedures; Task 2's commit is the import-apply proof suite._

## Files Created/Modified
- `packages/api/src/trpc/routers/units.ts` - unitsRouter: grid read + 4 money mutations + export/dry-run/bulk-preview; thin wrappers over the pure excel module; imports only withTenant/schema (no elevated pool).
- `packages/api/src/trpc/routers/_app.ts` - registered `units: unitsRouter`.
- `packages/api/tests/units-role-gate.test.ts` - cross-role matrix (owner/developer ✓, viewer FORBIDDEN, cross-org/non-existent NOT_FOUND) for updatePrice + updateEstado + events audit assertions.
- `packages/api/tests/import-apply.test.ts` - all-or-nothing rollback, idempotent no-op re-import, valid multi-row apply, duplicate-key idempotency, oversized-upload rejection, export round-trip dry-run.
- `packages/api/tests/public-reflection.test.ts` - owner mutation → anon read (picker.listUnits estado + quotes.compute price) reflection, Path A.

## Decisions Made
- **updatePrice existence pre-check (not a bare .returning() guard):** An `INSERT ... ON CONFLICT` against a cross-org unit/list raises a composite-FK violation (23503), not the clean 0-row an `UPDATE` produces. So updatePrice does an RLS-scoped existence check of the unit and price_list under the active org first, returning `NOT_FOUND` (no-enumeration) before the upsert. `updateEstado` remains the verbatim UPDATE + 0-row `NOT_FOUND` clone.
- **Blank price on import = DELETE:** `precio` is a NOT NULL integer, so an unpriced unit has no row. A cleared/blank price cell classified `null` by the dry-run deletes the `unit_prices` row rather than writing a 0.
- **events.tipo constants:** `unit_price_changed` / `unit_estado_changed` (stable English, Open Q #3).
- **GRID-07 Path A:** cross-surface integration test only; no revalidation endpoint/secret/tag (D-14).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] updatePrice cross-org path returns NOT_FOUND via existence pre-check**
- **Found during:** Task 1 (units router)
- **Issue:** The plan prescribed the verbatim `updateSettings` mold (`.returning()` 0-row → NOT_FOUND). That mold is exact for the `UPDATE` in `updateEstado`, but `updatePrice` is an `INSERT ... ON CONFLICT`: a cross-org `unitId`/`priceListId` would trip a composite-FK violation (SQLSTATE 23503 → INTERNAL_SERVER_ERROR, leaking enumeration) instead of yielding a clean 0-row.
- **Fix:** Added an RLS-scoped existence check of the unit and the price_list (scoped to the active org via withTenant) that throws NOT_FOUND before the upsert; kept the `.returning()` 0-row guard as a defense-in-depth backstop.
- **Files modified:** packages/api/src/trpc/routers/units.ts
- **Verification:** units-role-gate.test.ts asserts other-org owner and non-existent id both reject with NOT_FOUND for updatePrice.
- **Committed in:** 44c4e52 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical / correctness).
**Impact on plan:** Necessary to preserve the plan's own no-enumeration acceptance criterion on the INSERT path. No scope creep — same gate contract, correct mechanism.

## Issues Encountered
- Initial `@imbau/api typecheck` flagged two `row possibly undefined` accesses in the role-gate test (`noUncheckedIndexedAccess` on `rows[0]`). Switched the two direct property reads to `toMatchObject` (the projects-role-gate discipline). Resolved before the Task 1 commit.

## Known Stubs
None — every procedure is wired to real DB reads/writes and proven against real Postgres. No hardcoded/empty data paths.

## User Setup Required
None - no external service configuration required. (Panel frontend that consumes this router is a later plan; the router travels to the panel by type today.)

## Next Phase Readiness
- The panel write mold is now proven for the money surface; Phase 11 (leads) reuses `requireRole → withTenant → .returning() → co-transactional events` verbatim.
- Panel D1 grid UI (Plan 10-04) can consume `units.listForProject` + the mutations directly via the typed AppRouter.
- No blockers.

---
*Phase: 10-d1-grilla-de-unidades-editable-import-export-excel*
*Completed: 2026-07-22*

## Self-Check: PASSED
- All 4 created files present + SUMMARY.md on disk.
- All 3 task commits present in git (44c4e52, 2fd77e4, 2fd349a).
- `units: unitsRouter` registered in _app.ts.
- Full `@imbau/api` gate green: 124/124 tests, typecheck clean, lint clean.
