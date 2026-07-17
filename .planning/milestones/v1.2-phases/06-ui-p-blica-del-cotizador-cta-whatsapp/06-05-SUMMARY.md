---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 05
subsystem: ui
tags: [frontend, rsc, client-island, trpc, tanstack-query, simulator, whatsapp, picker, nextjs]

# Dependency graph
requires:
  - phase: 06-02
    provides: apps/web shell — dual splitLink tRPC client (TRPCReactProvider/useTRPC), Tailwind v4 tokens, env
  - phase: 06-03
    provides: picker tRPC router (getPublishedProject incl. whatsapp, listFloors, listUnits, listPlans)
  - phase: 06-04
    provides: lib/whatsapp.ts (buildWhatsappUrl), lib/plan-snap.ts (sortPlans), components/quote-cards.tsx, components/plan-slider.tsx
provides:
  - "RSC route /p/[slug]/cotizador that resolves project+floors+plans via the anon picker caller and hydrates a single client island"
  - "Picker island (piso→unidad, 2 steps; only disponible units selectable)"
  - "CotizadorSimulator island: live debounced race-safe quotes.compute (contado+financiado), 429 tolerance, single quotes.create on the WhatsApp CTA, shareable ?u&plan deep-link"
affects: [06-06, e2e, pdf, explorador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RSC resolves anon reads server-side → passes as island props (mirrors app/page.tsx force-dynamic)"
    - "Race-safe live recompute: debounced effect + monotonic useRef sequence guard drops stale compute responses"
    - "Mutation-object identity churn avoided by reading the useMutation through a ref so the effect deps stay reactive-only"
    - "Write-amplifier fence: quotes.create called exactly once inside the CTA handler; recompute uses compute only"

key-files:
  created:
    - "apps/web/app/p/[slug]/cotizador/page.tsx"
    - "apps/web/components/picker.tsx"
    - "apps/web/components/cotizador-simulator.tsx"
  modified: []

key-decisions:
  - "Debounce window = 200ms (inside the RESEARCH 150-250ms band): collapses fast slider drags into a single compute pair while staying live"
  - "Deep-link params (?u/?plan) are seeded into initial state and re-synced via router.replace; server validates them as z.uuid() at the tRPC boundary — no client-side format check needed (soft-error path catches invalid ids)"
  - "unitIdentificador for the WhatsApp header comes from the Picker selection; a deep-link that reopens without a picker session falls back to the literal 'seleccionada' (compute/create only need the unitId)"
  - "Both modalidades (contado + financiado) are always computed and shown; the modalidad toggle re-fires the debounced compute and selects which modalidad the CTA persists"

patterns-established:
  - "Two-step anon picker reporting selection UP via callback; URL state owned by the parent island"
  - "429 → soft es-AR message + auto backoff-retry via a retryTick effect dep; never a raw stack"

requirements-completed: [UI-01, UI-02, UI-03, UI-04, UI-05, WA-01]

coverage:
  - id: D1
    description: "RSC page /p/[slug]/cotizador resolves published project (+whatsapp)/floors/plans via the anon picker caller, force-dynamic, mounts TRPCReactProvider + Suspense; es-AR no-project state"
    requirement: "UI-01"
    verification:
      - kind: automated
        ref: "cd apps/web && npx tsc --noEmit (exit 0) + SKIP_ENV_VALIDATION=1 next build → /p/[slug]/cotizador listed as ƒ (Dynamic)"
        status: pass
      - kind: manual_procedural
        ref: "Visit /p/<slug>/cotizador on staging — picker renders; ?u=<unit>&plan=<plan> deep-links straight to the result"
        status: unknown
    human_judgment: true
    rationale: "Mockup fidelity + mobile-first layout + live behavior on real staging data need human eyes (Fable-window QA)"
  - id: D2
    description: "Picker island: floors (descending) → units via trpc.picker.listUnits; only disponible selectable; tipología/m²/ambientes + semantic status badge"
    requirement: "UI-01"
    verification:
      - kind: automated
        ref: "grep: \"use client\", picker.listUnits, disponible, onPickUnit present; tsc exit 0; eslint exit 0"
        status: pass
      - kind: manual_procedural
        ref: "On staging: reservado/vendido units render disabled and are not clickable; disponible advances to the result"
        status: unknown
    human_judgment: true
    rationale: "Selectability + badge semantics + empty/loading states are visual/interaction judgments against real seed data"
  - id: D3
    description: "Simulator drives debounced race-safe quotes.compute (two runs), tolerates 429, and fires a single quotes.create on the WhatsApp CTA that opens the pre-filled wa.me link"
    requirement: "WA-01"
    verification:
      - kind: automated
        ref: "grep: quotes.compute/quotes.create/buildWhatsappUrl/useRef/429/useSearchParams present; create.mutateAsync appears ONLY in onWhatsapp handler; tsc+eslint+next build exit 0"
        status: pass
      - kind: e2e
        ref: "06-06 e2e plan: deep-link renders result, slider recompute updates cards, CTA opens wa.me, 429 shows soft message"
        status: unknown
    human_judgment: true
    rationale: "Live compute race-safety, 429 soft-retry behavior and the wa.me hand-off are best proven by the phase e2e plan + a human on staging"
  - id: D4
    description: "WhatsApp CTA hidden when project.whatsapp is null (D-02); PDF button rendered disabled 'Próximamente' (D-12)"
    requirement: "UI-02"
    verification:
      - kind: automated
        ref: "code: showCta guarded by whatsappDigits !== ''; PDF <button disabled> with no handler"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-05
status: complete
---

# Phase 06 Plan 05: UI pública del cotizador + CTA WhatsApp Summary

**Interactive mobile-first cotizador at /p/[slug]/cotizador: an RSC page resolves the anon picker data, a two-step piso→unidad picker feeds a client island that runs live debounced race-safe quotes.compute (contado vs financiado), tolerates 429 softly, and hands off to WhatsApp via a single quotes.create on the CTA.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-05T03:11:03Z
- **Completed:** 2026-07-05T03:19:49Z
- **Tasks:** 3
- **Files modified:** 3 (all created)

## Accomplishments
- RSC route `/p/[slug]/cotizador` (force-dynamic) resolves the published project (+whatsapp), floors and plans through the anon picker caller server-side, then mounts `TRPCReactProvider` + `Suspense` around the island and passes the data as props. es-AR "proyecto no encontrado" state for unpublished slugs.
- Two-step `Picker` island: floors descending → per-floor units via `trpc.picker.listUnits`, with tipología / m² / ambientes and a semantic status badge; only `disponible` units are selectable (reservado/vendido rendered disabled). Reports the selection up via `onPickUnit(unitId, floorId, identificador)`; never writes URL state.
- `CotizadorSimulator` island: seeds `?u`/`?plan` deep-link state, keeps the URL in sync (`router.replace`), and on any change of {unitId, planId, modalidad} fires a **200ms-debounced** `quotes.compute` guarded by a **monotonic `useRef` sequence** so a stale response can never overwrite a newer selection. Two computes (contado + financiado) feed `QuoteCards` + `compareQuotes`.
- 429 tolerance: a `TRPCClientError` with `data.httpStatus === 429` maps to a soft es-AR message + an automatic backoff-retry (via a `retryTick` effect dep); engine-domain failures read `data.quoteErrorCode` and surface a friendly message. No raw stack ever shown.
- Write-amplifier fence (D-06): `quotes.create` is called **exactly once**, inside the WhatsApp CTA handler; on success it builds the `wa.me` URL via `buildWhatsappUrl` (deepLinkUrl = the current `?u&plan` URL) and navigates. The CTA is not rendered when `project.whatsapp` is null (D-02). PDF button rendered disabled ("Próximamente", D-12).

## Task Commits

Each task was committed atomically:

1. **Task 1: RSC page /p/[slug]/cotizador** - `cb96d20` (feat)
2. **Task 2: Picker island (piso→unidad)** - `1f2385d` (feat)
3. **Task 3: Cotizador simulator island** - `1f3ff60` (feat)

## Files Created/Modified
- `apps/web/app/p/[slug]/cotizador/page.tsx` - force-dynamic RSC page; anon picker reads → island props, Suspense-wrapped, no-project state
- `apps/web/components/picker.tsx` - `"use client"` two-step piso→unidad picker (disponible-only selectable)
- `apps/web/components/cotizador-simulator.tsx` - `"use client"` island: state + debounced race-safe compute + 429 tolerance + single create + wa.me hand-off

## Decisions Made
- **Debounce = 200ms** (RESEARCH 150-250ms band) — noted here for the e2e plan's timing assertions.
- **Deep-link validation** delegated to the server (`z.uuid()` at the tRPC boundary): invalid `?u`/`?plan` values fall into the soft-error path rather than a client-side format guard. The e2e plan can assert a garbage `?u` shows the soft message, not a crash.
- **unitIdentificador fallback**: the WhatsApp header uses the identificador captured from the Picker; a cold deep-link (URL reopened without a picker session) falls back to the literal `"seleccionada"` since compute/create only need the unitId. Full identificador resolution on cold deep-links is a possible future refinement (would need a by-id anon read or a units scan).
- **Both modalidades always computed & shown**: `QuoteCards` renders contado + financiado side-by-side; the modalidad toggle re-fires the debounced compute (satisfying "changing modalidad triggers a compute") and selects which modalidad the CTA persists.

## Deviations from Plan

None - plan executed exactly as written. (One in-scope lint fix during Task 3: the async CTA `onClick` was wrapped as `() => void onWhatsapp()` to satisfy `@typescript-eslint/no-misused-promises` — part of writing the task to the project's lint gate, not a scope change.)

## Issues Encountered
- `@typescript-eslint/no-misused-promises` flagged the async CTA handler passed directly to `onClick`. Resolved by wrapping in a void arrow (`() => void onWhatsapp()`). Re-lint + re-typecheck green.

## User Setup Required
None - no external service configuration required. (The cotizador route reaches live staging when the phase PR merges; staging currently runs a pre-phase-5 image per PROJECT.md.)

## Next Phase Readiness
- The full cotizador UI path is wired and buildable (`tsc` exit 0, `eslint` exit 0, `next build` exit 0 with `/p/[slug]/cotizador` marked ƒ Dynamic). Ready for the 06-06 e2e plan (deep-link → result, slider recompute, CTA → wa.me, 429 soft path) and staging UAT.
- Known follow-ups for e2e: assert the 200ms debounce collapses drags; assert a stale compute cannot overwrite; assert `quotes.create` fires once on the CTA only; assert the CTA is absent when whatsapp is null.

## Self-Check: PASSED

All 3 created files present on disk; all 4 commits (cb96d20, 1f2385d, 1f3ff60, 91ab7a3) present in git history. Verification gates: `tsc --noEmit` exit 0, `eslint` exit 0, `next build` exit 0 (route `/p/[slug]/cotizador` marked ƒ Dynamic).

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
