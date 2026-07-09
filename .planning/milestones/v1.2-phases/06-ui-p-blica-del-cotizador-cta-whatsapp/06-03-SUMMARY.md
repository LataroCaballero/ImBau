---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 03
subsystem: api
tags: [trpc, rls, anon, picker, drizzle, zod, whatsapp]

# Dependency graph
requires:
  - phase: 06-01
    provides: projects.whatsapp column (per-project WhatsApp CTA target)
provides:
  - picker tRPC router with four anon published-only reads (getPublishedProject, listFloors, listUnits, listPlans)
  - picker mounted into AppRouter (end-to-end types for the web client, no codegen)
  - integration test proving the picker reads are anon-safe (published-only) via real Postgres RLS
affects: [06-05, web-rsc-page, cotizador-ui, whatsapp-cta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anon read seam: publicProcedure + withAnon clone of projects.listPublished; RLS does all visibility filtering (no app-layer status WHERE)"
    - "Import fence: picker.ts imports ONLY { withAnon, schema } from @imbau/db (no owner/app pool)"

key-files:
  created:
    - packages/api/src/trpc/routers/picker.ts
    - packages/api/tests/picker-router.test.ts
  modified:
    - packages/api/src/trpc/routers/_app.ts

key-decisions:
  - "picker returns ALL units regardless of status; selectability (only disponible) is a client-side decision, not a server filter"
  - "getPublishedProject selects id/nombre/whatsapp only; visibility gated purely by the anon RLS policy"

patterns-established:
  - "Pattern: anon picker reads clone the projects.listPublished withAnon shape — RLS anon policies gate to published projects"
  - "Pattern: grep-fence verification (no createOwnerDb/appDb/createAppDb; no status literal) guards the anon data path"

requirements-completed: [UI-01, UI-05]

coverage:
  - id: D1
    description: "picker.getPublishedProject resolves a published project (with its whatsapp CTA number) and returns nothing for an unpublished one"
    requirement: "UI-01"
    verification:
      - kind: integration
        ref: "packages/api/tests/picker-router.test.ts#getPublishedProject resolves the published project with its whatsapp CTA number"
        status: pass
      - kind: integration
        ref: "packages/api/tests/picker-router.test.ts#getPublishedProject returns no row for an unpublished project"
        status: pass
    human_judgment: false
  - id: D2
    description: "picker.listFloors / picker.listUnits return published-project rows only; listUnits returns non-disponible units too (status not filtered server-side)"
    requirement: "UI-01"
    verification:
      - kind: integration
        ref: "packages/api/tests/picker-router.test.ts#listFloors returns the published project's floors, none for the unpublished one"
        status: pass
      - kind: integration
        ref: "packages/api/tests/picker-router.test.ts#listUnits returns ALL units incl. non-disponible ones (status is not filtered server-side)"
        status: pass
    human_judgment: false
  - id: D3
    description: "picker.listPlans returns the payment plan with notasLegales (the UI-05 leyenda) and the snap-slider preset fields"
    requirement: "UI-05"
    verification:
      - kind: integration
        ref: "packages/api/tests/picker-router.test.ts#listPlans returns the plan with notasLegales and the snap-slider preset fields"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-05
status: complete
---

# Phase 06 Plan 03: Anon Picker Router Summary

**A fenced, RLS-safe `picker` tRPC router serving four anon published-only reads (project+whatsapp, floors, units, plans+notasLegales), mounted into AppRouter and proven anon-safe by a real-Postgres integration test.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-05T02:42:00Z
- **Completed:** 2026-07-05T02:54:53Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `picker` router with `getPublishedProject` (selecting the new `whatsapp` column), `listFloors`, `listUnits`, `listPlans` — each a `publicProcedure + withAnon` clone of `projects.listPublished`, letting the anon RLS policies do all published-only filtering (no app-layer status WHERE).
- Mounted `picker: pickerRouter` into `_app.ts`, so `AppRouter` now exposes the four procedures for end-to-end web-client types with no codegen.
- Integration test drives the ANON caller against the live `_test` Postgres: a published and a borrador project are seeded, and the anon caller sees ONLY the published project's rows across all four procedures.
- Proved `listUnits` returns non-disponible units too (status is a client-side selectability concern, not a server filter) and `listPlans` carries `notasLegales` (UI-05 leyenda) plus `anticipoPct/cuotas/ajuste/refuerzos`.

## Task Commits

Each task was committed atomically:

1. **Task 1: picker router (anon published reads) + mount in AppRouter** - `d96a588` (feat)
2. **Task 2: picker router integration test (caller vs real Postgres)** - `b4d8488` (test)

## Files Created/Modified
- `packages/api/src/trpc/routers/picker.ts` - New anon picker router; four withAnon reads, fenced to `{ withAnon, schema }` imports only.
- `packages/api/src/trpc/routers/_app.ts` - Imports and mounts `picker: pickerRouter`; extends `AppRouter`; procedure inventory comment updated.
- `packages/api/tests/picker-router.test.ts` - New integration test (5 cases) proving the anon reads are published-only and carry the fields the UI needs.

## Decisions Made
- **Return all units, filter client-side:** `listUnits` returns every unit regardless of `estado`; the component decides that only `disponible` units are selectable. This keeps the server query pure and lets the UI render sold/reserved units as context.
- **Followed plan as specified** otherwise — the withAnon clone shape, the import fence, and the grep-verified prohibitions were implemented exactly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Both grep-fence verification and `pnpm --filter @imbau/api typecheck` passed on first run; the integration test passed on first run (5/5 in isolation, and the full `@imbau/api` suite stays green at 26/26).

## Known Stubs
None. All four procedures are wired to real Drizzle queries against the schema; no placeholder/empty-data paths.

## Threat Flags
None. The plan's `<threat_model>` (T-06-03-INFO information disclosure, T-06-03-ELEV owner-pool bypass, T-06-03-TAMPER malformed inputs) is fully mitigated: every read routes through `withAnon`; the import fence is grep-verified; inputs are validated as `z.string()`/`z.uuid()` at the tRPC boundary. No new security surface beyond the planned anon reads.

## Next Phase Readiness
- The web RSC page (Plan 05) can now resolve picker/project data server-side through `picker.getPublishedProject` (whatsapp for the CTA), `listFloors`, `listUnits`, and `listPlans` (notasLegales for the UI-05 leyenda) with full end-to-end types.
- No blockers.

## Self-Check: PASSED

- FOUND: packages/api/src/trpc/routers/picker.ts
- FOUND: packages/api/tests/picker-router.test.ts
- FOUND: packages/api/src/trpc/routers/_app.ts (picker mounted)
- FOUND commit: d96a588 (feat Task 1)
- FOUND commit: b4d8488 (test Task 2)

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
