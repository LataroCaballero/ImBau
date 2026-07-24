---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
verified: 2026-07-24T13:20:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 10: D1 — Grilla de unidades editable + Excel round-trip Verification Report

**Phase Goal:** A role-gated panel grid where owners/developers edit price + estado inline and in bulk, plus a transactional, idempotent Excel import/export, with public (anon) reflection of published changes.
**Verified:** 2026-07-24T13:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `unit_prices` enforces one row per (unit_id, price_list_id) at the DB — GRID-05 | ✓ VERIFIED | `packages/db/src/schema/unit-prices.ts` L74-76: `unique("unit_prices_unit_list_uq").on(t.unitId, t.priceListId)`; migration `packages/db/migrations/0005_unit_prices_unit_list_uq.sql` = `ALTER TABLE "unit_prices" ADD CONSTRAINT "unit_prices_unit_list_uq" UNIQUE("unit_id","price_list_id")`; `packages/api/tests/unit-prices-unique.test.ts` asserts a second raw insert with the same natural key rejects with `.code === "23505"` and `.constraint_name === "unit_prices_unit_list_uq"`. Ran targeted: PASS. |
| 2 | `packages/api/src/excel/` is pure/I/O-free; es-AR money parse is `Number.isInteger`-gated | ✓ VERIFIED | `grep` for `fs`/`node:fs`/`@imbau/db` imports across `packages/api/src/excel/*.ts` returns zero hits. `money.ts` branches on `ExcelJS.ValueType`, rejects Formula/Error/Date/RichText/Boolean/Null, gates Number and normalized-String paths on `Number.isInteger(n) && n >= 0`. `money.test.ts` includes a `fast-check` property (`fcTest.prop`) over 12 adversarial cell-value generators (ints, floats, es-AR/decimal-comma strings, formulas, dates, richText, errors, booleans, null) asserting `r.ok ⇒ Number.isInteger(r.value) && r.value >= 0`. |
| 3 | `sanitizeCell` prefixes every leading `= + - @` / tab / CR string cell with `'` on export (formula-injection defense) | ✓ VERIFIED | `packages/api/src/excel/build.ts` L13/20-22: `INJECTION_LEAD = /^[=+\-@\t\r]/` applied uniformly to every string cell (identificador/piso/tipologia/estado), never selectively. |
| 4 | units tRPC router: every write is `requireRole("owner","developer")` over `withTenant`; import/bulk apply are single all-or-nothing transactions with co-transactional events audit; `updatePrice` pre-checks existence → `NOT_FOUND` (no cross-org enumeration) | ✓ VERIFIED | `packages/api/src/trpc/routers/units.ts`: `updatePrice`/`updateEstado`/`dryRunImport`/`importExcel`/`bulkPreview`/`bulkUpdatePrice` all built on `requireRole("owner","developer")`; `listForProject`/`exportExcel` are tenant-scoped reads. Every write path is a single `withTenant(...)` call (one tx) with the whole N-upsert / estado loop + `events` insert inside it — no per-row transactions. `updatePrice` does an RLS-scoped existence pre-check of unit + price_list before the `INSERT ... ON CONFLICT` upsert, throwing `NOT_FOUND` pre-write (documented rationale: a cross-org INSERT would otherwise raise 23503, not a clean 0-row). Router imports only `withTenant, schema` from `@imbau/db` — no elevated pool. `units-role-gate.test.ts` (11 tests): owner ✓ / developer ✓ / viewer FORBIDDEN / other-org NOT_FOUND / non-existent-id NOT_FOUND for both mutations, plus events-count assertions. `import-apply.test.ts` (6 tests): all-or-nothing rollback (one invalid row → zero writes), idempotent no-op re-import, valid multi-row apply + events, duplicate-key idempotency (Plan 01 UNIQUE), oversized-base64 rejection (`z.string().max(10_000_000)`), export round-trip. Ran targeted: all PASS. |
| 5 | Panel surface at `apps/panel/app/proyectos/[id]/unidades` honors the Phase 9 RSC guard verbatim + the 10-UI-SPEC contract; money renders via canonical `formatUsd` | ✓ VERIFIED | Diffed current `page.tsx` against the Phase 9 commit (`47bda88`): the `z.uuid()` → `notFound()` → `resolveProject` → `notFound()` → `resolveActiveRole` → `canWrite` guard is byte-identical; only the `<main>` body changed from placeholder text to `<UnitsGrid projectId={id} canWrite={canWrite} />`. `units-grid.tsx`/`import-wizard.tsx`/`bulk-edit.tsx` import `formatUsd` from `@imbau/quoting` for every money display (price cells, diff viejo→nuevo, bulk preview); empty price renders `"—"` (em dash), never `0`. Grid-level load-error state (role="alert" + Reintentar) is distinct from the per-cell save-error state (vendido-red border + revert). Selection bar, indeterminate header checkbox, sticky checkbox+identificador columns, import wizard 4 steps, bulk-edit mandatory-preview modal all present and match the UI-SPEC component inventory. |
| 6 | Import apply is all-or-nothing, server re-validates (never trusts client), and unchanged re-import is a no-op — GRID-05 | ✓ VERIFIED | `units.ts` `importExcel`: re-`parseWorkbook`s + re-runs `buildDryRun` server-side inside the `withTenant` tx; `if (report.errors.length > 0) throw TRPCError({code:"BAD_REQUEST"...})` aborts the tx before any write. `import-apply.test.ts` proves: (b) one invalid row ("NO-EXISTE" identificador) alongside a valid change → the valid change does NOT land, event count unchanged; (c)/(d) re-importing an unchanged/just-applied export → `applied: 0`, DB untouched, exactly one price row per unit×list. |
| 7 | Bulk edit routes through a mandatory preview (viejo→nuevo) before any write; % or fixed, `Math.round` to integer, rejects negatives — GRID-06 | ✓ VERIFIED | `bulk-edit.tsx` has NO direct apply path — `confirmApply()` is only reachable after `preview !== null` (set by `runPreview()` calling `units.bulkPreview`), and the Confirmar button is `disabled` when `preview.errors.length > 0`. `packages/api/src/excel/bulk.ts`'s `computeBulkPreview` (exercised via `bulk.test.ts`) uses `Math.round` and rejects any previewed `< 0` result with an es-AR reason; `bulkUpdatePrice` server-side re-throws `BAD_REQUEST` if `preview.errors.length > 0`, aborting the whole apply. |
| 8 | GRID-07 — a committed panel write is visible through the anon picker/quotes caller on the next request (Path A, no cache plumbing) | ✓ VERIFIED | `packages/api/tests/public-reflection.test.ts` seeds a `publicado` project via `ownerSql()`, then: (a) an owner `createCaller` calls `units.updateEstado`, and an anon `createCaller({headers:new Headers()})` calling `picker.listUnits({floorId})` observes the change on the very next call; (b) an owner `updatePrice` is observed by an anon `quotes.compute({modalidad:"contado"})` call. No `/api/revalidate`, `revalidateTag`, or `REVALIDATE_SECRET` introduced anywhere in the phase (`grep` confirms absence). Ran targeted: PASS. |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0005_unit_prices_unit_list_uq.sql` | Versioned UNIQUE migration | ✓ VERIFIED | Present, single `ALTER TABLE` statement, journal entry synced (`meta/_journal.json` idx 5). |
| `packages/db/src/schema/unit-prices.ts` | `unique(...)` in extras array | ✓ VERIFIED | FKs and both `pgPolicy` blocks untouched; unique constraint added at L74-76. |
| `packages/api/src/excel/{template,types,money,build,parse,dry-run,bulk}.ts` | Pure module | ✓ VERIFIED | No `fs`/`@imbau/db` imports; each file exists and is exercised by a colocated `.test.ts`. |
| `packages/api/src/trpc/routers/units.ts` | `unitsRouter` w/ 8 procedures | ✓ VERIFIED | `listForProject, updatePrice, updateEstado, exportExcel, dryRunImport, importExcel, bulkPreview, bulkUpdatePrice` all present, registered in `_app.ts` (`units: unitsRouter`). |
| `packages/api/tests/{unit-prices-unique,units-role-gate,import-apply,public-reflection}.test.ts` | Integration proofs | ✓ VERIFIED | All present; ran targeted subset — 124/124 API tests pass (16 files), includes all four. |
| `apps/panel/app/proyectos/[id]/unidades/{units-grid,import-wizard,bulk-edit}.tsx` | Client islands | ✓ VERIFIED | Present, wired via `useTRPC().units.*`, `pnpm --filter @imbau/panel typecheck && lint` both exit 0. |
| `packages/ui/src/tokens.css` (extended) + `apps/panel/{globals.css,postcss.config.mjs,layout.tsx}` | Token wiring | ✓ VERIFIED | `--color-disponible/reservado/vendido/cobre/gris-*/hormigon/blanco/grafito` mirrored into the panel `@theme` block; `layout.tsx` sets the three next/font vars; un-prefixed naming preserved (not forked to `--imbau-*`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `unit-prices.ts unique()` | generated migration | drizzle-kit generate | WIRED | Migration 0005 contains exactly the ADD CONSTRAINT (no events-partition drift, confirmed by content inspection). |
| `units.ts updatePrice/importExcel/bulkUpdatePrice` | `unit_prices_unit_list_uq` | `onConflictDoUpdate({target:[unitId,priceListId]})` | WIRED | All three write paths target the exact Plan-01 constraint columns. |
| `units-grid.tsx` | `units.updatePrice/updateEstado/exportExcel` | `useTRPC().units.*` mutations/query | WIRED | Confirmed by source read; typecheck/lint clean. |
| `import-wizard.tsx` | `units.dryRunImport` → `units.importExcel` | sequential mutate calls, Aplicar disabled while `hasErrors` | WIRED | `disabled={hasErrors || applyMut.isPending}` on the Aplicar button. |
| `bulk-edit.tsx` | `units.bulkPreview` → `units.bulkUpdatePrice` | mandatory preview-state gate | WIRED | No code path calls `bulkUpdatePrice` before `preview !== null`; Confirmar disabled when `preview.errors.length > 0`. |
| Panel write (`units.updateEstado`/`updatePrice`) | anon `picker.listUnits`/`quotes.compute` | force-dynamic per-request Postgres read (Path A) | WIRED | `public-reflection.test.ts` proves this cross-surface, against real Postgres. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| unit_prices UNIQUE enforcement | `pnpm --filter @imbau/api test -- unit-prices-unique` (run as part of the targeted batch below) | pass | ✓ PASS |
| units cross-role + tenant-isolation matrix | `pnpm --filter @imbau/api test -- units-role-gate` | pass | ✓ PASS |
| Import apply atomicity + idempotency | `pnpm --filter @imbau/api test -- import-apply` | pass | ✓ PASS |
| GRID-07 public reflection | `pnpm --filter @imbau/api test -- public-reflection` | pass | ✓ PASS |
| Pure excel module (money/build/parse/dry-run/bulk) | `pnpm --filter @imbau/api test -- money build parse dry-run bulk` | pass | ✓ PASS |
| Full targeted batch (all of the above run together) | `pnpm --filter @imbau/api test -- unit-prices-unique units-role-gate import-apply public-reflection money build parse dry-run bulk` | 16 test files / 124 tests passed | ✓ PASS |
| `@imbau/db` regression | `pnpm --filter @imbau/db test` | 7 files / 1 skipped, 47 tests / 4 skipped, 0 failures | ✓ PASS |
| Panel typecheck | `pnpm --filter @imbau/panel typecheck` | exit 0 | ✓ PASS |
| Panel lint | `pnpm --filter @imbau/panel lint` | exit 0 | ✓ PASS |

All commands above were re-run live in this verification pass (Node 22.22.3, Docker Postgres/Redis up) — not taken on SUMMARY.md's word alone.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| GRID-01 | 10-03, 10-04 | Inline price edit per lista, persisted with vigencia | ✓ SATISFIED | `units.updatePrice` + `units-role-gate.test.ts` + `units-grid.tsx` PriceCell state machine |
| GRID-02 | 10-03, 10-04 | Inline estado edit (disponible/reservado/vendido) | ✓ SATISFIED | `units.updateEstado` + `units-role-gate.test.ts` + `units-grid.tsx` EstadoCell |
| GRID-03 | 10-02, 10-03, 10-04 | Export to canonical Excel, sanitized against formula injection | ✓ SATISFIED | `buildWorkbook`/`sanitizeCell` + `units.exportExcel` + `import-apply.test.ts` export-covers-all-units case + `units-grid.tsx` Exportar a Excel |
| GRID-04 | 10-02, 10-03, 10-04 | Import dry-run with field-by-field diff before apply | ✓ SATISFIED | `buildDryRun` + `units.dryRunImport` + `import-wizard.tsx` (Aplicar disabled while errores>0) |
| GRID-05 | 10-01, 10-02, 10-03 | Transactional + idempotent import (UNIQUE constraint + all-or-nothing) | ✓ SATISFIED | Migration 0005 + `unit-prices-unique.test.ts` + `import-apply.test.ts` |
| GRID-06 | 10-02, 10-03, 10-04 | Bulk price edit (% / fixed) over a selection | ✓ SATISFIED | `computeBulkPreview` + `units.bulkPreview/bulkUpdatePrice` + `bulk-edit.tsx` mandatory preview |
| GRID-07 | 10-03, 10-04 | Instant public reflection of price/estado changes | ✓ SATISFIED | `public-reflection.test.ts` (Path A, force-dynamic, no revalidation plumbing) + success copy in `import-wizard.tsx`/`bulk-edit.tsx` |

No orphaned requirements: REQUIREMENTS.md maps only GRID-01..07 to Phase 10 and all 7 are declared across the 4 plans' `requirements` frontmatter and satisfied above.

### Anti-Patterns Found

None. `grep` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and for `placeholder|coming soon|not yet implemented` (case-insensitive) across all phase-10 source/test/UI files modified in this phase returned zero debt markers (the one `placeholder=` hit in `bulk-edit.tsx` is a legitimate HTML input placeholder attribute, not a debt marker).

### Accepted Realities (not defects, per phase orchestrator note — independently confirmed)

1. **10-02 stall+resume:** `git log` confirms `5211fd5` and `4cd7885` are each single `feat` commits (no separate RED test commit precedes them), consistent with the SUMMARY's documented stall-before-any-commit + resume. The tests themselves are exhaustive (unit + fast-check property on both load-bearing invariants) and green — confirmed by running them directly. This is a process artifact, not a coverage gap.
2. **10-04 stale-dev-DB UAT fix:** Confirmed operational, not code — `imbau_test` (used by all automated tests re-run in this verification) already had migration 0005 applied and all tests pass; the fix was applying the same migration to the separate dev DB `imbau`, no source changed.

### Human Verification Required

None. All must-haves resolved to VERIFIED via direct source inspection, live re-run of the automated test suites (not just trusting prior green claims), and cross-referencing against REQUIREMENTS.md. Phase 10-04's Task 3 human-verify checkpoint was already completed and approved during execution (browser UAT of the grid, import wizard, bulk edit, and GRID-07 cross-tab reflection); no further human action is needed for this phase to close.

### Gaps Summary

No gaps. All 8 observable truths verified, all artifacts present/substantive/wired, all key links wired, requirements GRID-01..07 fully satisfied and traced, no anti-patterns, no orphaned requirements. Phase 10 goal is achieved: a role-gated panel grid with inline + bulk price/estado editing, a transactional/idempotent Excel round-trip, and proven instant public reflection.

---

*Verified: 2026-07-24T13:20:00Z*
*Verifier: Claude (gsd-verifier)*
