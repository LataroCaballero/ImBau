---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
plan: 04
subsystem: ui
tags: [nextjs, react, trpc, tailwind-v4, exceljs, es-AR, panel, units-grid]

# Dependency graph
requires:
  - phase: 10-03
    provides: unitsRouter (listForProject + updatePrice/updateEstado/importExcel/bulkUpdatePrice + exportExcel/dryRunImport/bulkPreview), all requireRole(owner,developer)+withTenant, events audit co-transactional
  - phase: 10-02
    provides: pure packages/api/src/excel module (build/parse/money/dry-run/bulk), DryRunResult + BulkPreview types
  - phase: 09
    provides: proyectos/[id] shell + resolveProject/canWrite guard + RSC placeholder page
provides:
  - Styled panel units-grid surface at proyectos/[id]/unidades (first STYLED panel screen)
  - Inline price-cell edit state machine (idle→editing→saving→saved/error, cobre focus ring, em-dash empty)
  - Estado inline dropdown + row selection (indeterminate header) + Exportar a Excel download
  - 4-step import wizard (Upload→Validation→Diff→Confirm) with Aplicar disabled while errores > 0
  - Bulk-edit panel with mandatory viejo→nuevo preview modal before any money write
  - Panel token wiring: extended packages/ui/src/tokens.css + apps/panel globals/postcss/layout fonts
affects: [11-leads-inbox, 12-hotspots-editor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Panel adopts the same Tailwind v4 CSS-first @theme mirror as apps/web; LIVE packages/ui/src/tokens.css EXTENDED with un-prefixed neutrals/radii/type-scale (NOT forked, NOT switched to --imbau-*)"
    - "Client island (\"use client\") consuming useTRPC().units.* mutations from an RSC body that keeps the inherited z.uuid()/resolveProject/notFound guard verbatim; canWrite is cosmetic defense-in-depth only"
    - "Per-surface INLINE feedback (role=status/role=alert) instead of a global toast system — folds the UI-SPEC unresolved toast row into the invite-form inline pattern"
    - "Every irreversible money op (bulk edit, import apply) routes through a mandatory preview modal (viejo→nuevo, all-or-nothing copy) before any write"
    - "Money display via canonical formatUsd (single-source formatter — UI == PDF == WhatsApp)"

key-files:
  created:
    - apps/panel/app/proyectos/[id]/unidades/units-grid.tsx
    - apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx
    - apps/panel/app/proyectos/[id]/unidades/bulk-edit.tsx
    - apps/panel/app/globals.css
    - apps/panel/postcss.config.mjs
  modified:
    - apps/panel/app/proyectos/[id]/unidades/page.tsx
    - apps/panel/app/layout.tsx
    - packages/ui/src/tokens.css
    - apps/panel/next.config.ts
    - apps/panel/package.json

key-decisions:
  - "Money renders via canonical formatUsd as 'US$ 185.000' (not the UI-SPEC illustrative 'USD 185.000' label) — user-accepted; the single-source formatter guarantees UI == PDF == WhatsApp"
  - "Feedback folded into per-surface inline role=status/role=alert states (no global toast) — resolves the UI-SPEC unresolved toast row without dropping the requirement"
  - "packages/ui/src/tokens.css EXTENDED (not forked); consumers stay on un-prefixed --grafito/--cobre naming; panel mirrors apps/web @theme rather than inventing a new token surface"
  - "canWrite is cosmetic only; all write authority remains server-side requireRole (Plan 03)"

patterns-established:
  - "Pattern: panel STYLED surface = RSC guard (verbatim) + \"use client\" island via useTRPC — the mold Phases 11/12 clone for leads inbox and hotspots editor"
  - "Pattern: mandatory preview modal for irreversible money ops (viejo→nuevo, all-or-nothing) — reusable for any bulk/destructive panel op"

requirements-completed: [GRID-01, GRID-02, GRID-03, GRID-04, GRID-06, GRID-07]

coverage:
  - id: D1
    description: "Flat units grid (one row/unit) with read-only ref columns + inline price-cell edit per lista (Financiado/Contado), persisting via units.updatePrice; empty price renders em-dash, money via formatUsd"
    requirement: "GRID-01"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/panel typecheck && lint (exit 0)"
        status: pass
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: click price cell → edit → Enter saves (brief tint); failure → vendido-red border + revert"
        status: pass
    human_judgment: true
    rationale: "Browser inline-edit interaction + es-AR copy rendering + cobre focal-point hierarchy are not assertable in unit tests"
  - id: D2
    description: "Estado inline dropdown (disponible/reservado/vendido) via units.updateEstado + per-row checkboxes with indeterminate header feeding the bulk selection"
    requirement: "GRID-02"
    verification:
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: change estado via dropdown; select rows (header indeterminate on partial)"
        status: pass
    human_judgment: true
    rationale: "Dropdown + selection interaction verified in browser"
  - id: D3
    description: "Exportar a Excel button calling units.exportExcel and triggering a browser download of the base64 workbook (all units, sanitized server-side)"
    requirement: "GRID-03"
    verification:
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: .xlsx downloads with all units"
        status: pass
    human_judgment: true
    rationale: "Browser download behavior verified manually"
  - id: D4
    description: "4-step import wizard (Upload→Validation report→Diff preview→Confirm); Aplicar cambios disabled while dry-run reports errores > 0; field-by-field viejo→nuevo diff"
    requirement: "GRID-04"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/panel typecheck && lint (exit 0)"
        status: pass
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: invalid row shows es-AR reason + disables Aplicar; valid file shows diff and applies with 'La web pública ya está actualizada'"
        status: pass
    human_judgment: true
    rationale: "Multi-step wizard flow + es-AR validation copy + apply-blocked gate verified in browser"
  - id: D5
    description: "Bulk-edit panel (% or monto fijo over a selection) always routed through a mandatory preview modal (viejo→nuevo per unit) before units.bulkUpdatePrice — no blind apply path"
    requirement: "GRID-06"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/panel typecheck && lint (exit 0)"
        status: pass
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: +10% → preview shows viejo→nuevo → Confirmar → success"
        status: pass
    human_judgment: true
    rationale: "Preview-before-write flow + money math verified interactively"
  - id: D6
    description: "Success copy after any apply asserts instant public-web reflection ('La web pública ya está actualizada') — GRID-07 Path A"
    requirement: "GRID-07"
    verification:
      - kind: manual_procedural
        ref: "10-04 Task 3 human-verify: edited price/estado reflected in the public cotizador (another tab)"
        status: pass
    human_judgment: true
    rationale: "Cross-surface reflection (force-dynamic Path A) confirmed by opening the public cotizador in a second tab"

# Metrics
duration: ~35min
completed: 2026-07-24
status: complete
---

# Phase 10 Plan 04: Panel Units-Grid UI Summary

**Styled panel units-grid at proyectos/[id]/unidades — inline price/estado editing, row selection, Excel export, a 4-step import wizard (apply-blocked until 100% valid), and bulk-edit with a mandatory viejo→nuevo preview — all es-AR voseo over the Plan 03 unitsRouter, with the panel's first brand-token wiring.**

## Performance

- **Duration:** ~35 min (across the pre-checkpoint execution + this finalization)
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint, approved)
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- Panel's first STYLED surface: extended the LIVE `packages/ui/src/tokens.css` with un-prefixed neutrals/radii/type-scale (from docs/marca values), added `apps/panel/globals.css` + `postcss.config.mjs` mirroring the apps/web Tailwind v4 @theme, wired the three next/font vars in `layout.tsx`.
- `units-grid.tsx` client island: sticky-header flat grid (one row/unit), inline price-cell state machine (idle→editing with 2px cobre focus ring→saving→saved/error with revert), estado dropdown, row checkboxes with indeterminate header, selection bar, and Exportar a Excel download — all consuming `useTRPC().units.*`.
- `import-wizard.tsx`: 4-step modal (Upload→Validation report→Diff preview→Confirm) with the summary bar, scrollable invalid-rows list, field-by-field viejo→nuevo diff, and Aplicar cambios disabled while `errores > 0`.
- `bulk-edit.tsx`: selection-triggered panel (% / monto fijo) routed through a mandatory preview modal (affected-units viejo→nuevo, all-or-nothing copy) before `units.bulkUpdatePrice` — no blind apply.
- Human visual/UX checkpoint APPROVED ("perfecto pass"): styled grid, inline price edit, estado edit, bulk preview, import diff, and GRID-07 public-web reflection all confirmed in the browser.

## Task Commits

Each task was committed atomically:

1. **Task 1: Panel token wiring + RSC body + units-grid island** - `dd98719` (feat)
2. **Task 2: Import wizard (4-step) + bulk-edit mandatory preview** - `ee61c3a` (feat)
3. **Task 3: Human visual/UX verification** - checkpoint (APPROVED, no code commit)

**Plan metadata:** docs(10-04) commit (this finalization)

## Files Created/Modified

- `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx` - Client island: grid + inline price cell + estado + selection + export
- `apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx` - 4-step import modal (dry-run → apply, blocked until valid)
- `apps/panel/app/proyectos/[id]/unidades/bulk-edit.tsx` - Bulk-edit panel + mandatory preview modal
- `apps/panel/app/proyectos/[id]/unidades/page.tsx` - RSC body replaced with `<UnitsGrid>`, inherited guard kept verbatim
- `apps/panel/app/globals.css` - `@import "tailwindcss";` + @theme mirror (new)
- `apps/panel/postcss.config.mjs` - Tailwind v4 postcss wiring (new)
- `apps/panel/app/layout.tsx` - globals.css import + next/font CSS vars on `<html>`
- `packages/ui/src/tokens.css` - Extended with neutrals/radii/type-scale (un-prefixed)
- `apps/panel/{next.config.ts,package.json}` + `pnpm-lock.yaml` - Panel deps/config for the styled surface

## Decisions Made

- **Money label via canonical `formatUsd`:** renders `US$ 185.000` (not the UI-SPEC illustrative `USD 185.000`). User-accepted — the single-source formatter guarantees UI == PDF == WhatsApp; forking a panel-only label would risk drift on the highest-risk (money) screen.
- **Inline per-surface feedback, no global toast:** folded the UI-SPEC unresolved toast row into `role="status"`/`role="alert"` inline states (cloning invite-form). Single-cell edits use the inline saved/error cell; import/bulk apply render inline banners inside their own modal.
- **Tokens extended, not forked:** kept consumers on un-prefixed `--grafito`/`--cobre`; panel mirrors apps/web's @theme instead of introducing `--imbau-*`.
- **canWrite is cosmetic:** all write authority stays server-side (`requireRole`, Plan 03); hiding a button is never the control.

## Deviations from Plan

None requiring code changes. One accepted presentation deviation and one environment gotcha (below) — neither altered the delivered code.

### Accepted presentation deviation

**Money label format** — `formatUsd` yields `US$ 185.000` rather than the UI-SPEC's illustrative `USD 185.000`. Accepted by the user during UAT; chosen to preserve the single-source money formatter across UI/PDF/WhatsApp.

## Verification Notes

**UAT env fix (NOT a code change — nothing new committed):** During the human-verify checkpoint, inline price + bulk price mutations initially returned HTTP 500 (`there is no unique or exclusion constraint matching the ON CONFLICT specification`). Root cause: the DEV database `imbau` had not been migrated to 0005 (the Plan 10-01 `UNIQUE(unit_id, price_list_id)`) — only `imbau_test` had it. The orchestrator ran `pnpm db:migrate` against the dev DB and the upsert then succeeded under the app role with RLS on. The delivered code and its `imbau_test` suite were correct; this was a stale-dev-DB gotcha, not a plan defect. `estado` edits were unaffected (plain UPDATE, no ON CONFLICT).

## Issues Encountered

- Stale dev DB (see Verification Notes) — resolved by applying the pending 0005 migration to `imbau`; no code impact.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 (D1 — Grilla de unidades + Excel) is COMPLETE: all four plans shipped (schema/migration, pure excel module, unitsRouter, panel UI). GRID-01..07 delivered.
- The panel STYLED-surface mold (RSC guard verbatim + `"use client"` island via useTRPC + inline feedback + mandatory preview for destructive ops) is the reusable pattern for Phase 11 (leads inbox) and Phase 12 (hotspots editor).
- Milestone v1.3 continues with Phase 11 (D2 — leads inbox + email) and Phase 12 (hotspots editor), both parallelizable now that the shell (Phase 9) and this first styled surface exist.

## Self-Check: PASSED

- Created files verified on disk: units-grid.tsx, import-wizard.tsx, bulk-edit.tsx, globals.css, postcss.config.mjs (all FOUND).
- Task commits verified in git history: dd98719, ee61c3a (both FOUND).

---
*Phase: 10-d1-grilla-de-unidades-editable-import-export-excel*
*Completed: 2026-07-24*
