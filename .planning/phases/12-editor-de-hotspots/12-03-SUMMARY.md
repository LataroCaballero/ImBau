---
phase: 12-editor-de-hotspots
plan: 03
subsystem: ui
tags: [nextjs, rsc, trpc, svg, hotspots, polygon, pointer-events, viewbox, panel, es-AR]

# Dependency graph
requires:
  - phase: 12-editor-de-hotspots
    plan: 01
    provides: "@imbau/api/geometry (parsePolygon/validatePolygon/serializePolygon/polygonErrorMessage) for client-side pre-validation; LOCKED viewBox-0-1000 serialize/parse contract; projects.renderExteriorKey + seedRenders UAT fixture"
  - phase: 12-editor-de-hotspots
    plan: 02
    provides: "hotspots tRPC router — getForProject read + set/clear floor + set/clear unit; the gated (requireRole owner/developer), tenant-scoped, server-re-validated write seam consumed via inferRouterOutputs"
  - phase: 09-shell-del-panel
    provides: "proyectos/[id] tab RSC spine (await params → z.uuid() → notFound → resolveProject → notFound → canWrite from resolveActiveRole) + TRPCReactProvider/useTRPC island wiring"
  - phase: 10-d1-grilla-de-unidades
    provides: "units-grid.tsx island mold: useTRPC + useQuery/useMutation + queryClient invalidation + inline role=status/alert feedback (no global toast) + canWrite cosmetic gate; un-prefixed tokens.css"
provides:
  - "hotspots tab RSC (page.tsx) — resolves project/role server-side, builds public render URLs from R2_PUBLIC_BASE_URL, passes serializable props (URLs never keys, never a caller) to the island"
  - "HotspotsEditor client island — hand-rolled SVG viewBox-0-1000 editor: target-first draw, vertex-drag (pointer-capture), delete-vertex (≥3 guard), drill-down, always-visible selector rail, blocking no-autocorrect validation, explicit save, delete confirm, es-AR empty-states"
  - "apps/panel/env.ts R2_PUBLIC_BASE_URL server env (no NEXT_PUBLIC_* leak) — server-side public render URL construction"
affects: [phase-2-explorador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled `<svg viewBox=\"0 0 1000 1000\" preserveAspectRatio=\"none\">` overlay exactly sized over a read-only `<img>` render; screen↔viewBox via svg.getScreenCTM().inverse() read INSIDE pointer handlers (never getBoundingClientRect, never at render); clamp+round to integers 0-1000 (D-09) — the 'dinero entero nunca float' analog for geometry"
    - "Vertex drag via setPointerCapture on pointerdown → pointermove updates the one vertex → pointerup releases; 12px visual handle / 24px hit target; live mono tabular-nums coord readout while dragging"
    - "RSC builds public render URLs server-side (${R2_PUBLIC_BASE_URL}/${key}) and passes URL strings (or null) as props — the client never sees a storage key or credential; null key → null URL prop → D-06 empty-state (never draws over void)"
    - "Client pre-validates through the SAME pure @imbau/api/geometry module before Guardar; the Plan 02 server re-validation remains the authority (defense-in-depth, not the gate)"

key-files:
  created:
    - apps/panel/app/proyectos/[id]/hotspots/hotspots-editor.tsx
  modified:
    - apps/panel/app/proyectos/[id]/hotspots/page.tsx
    - apps/panel/env.ts

key-decisions:
  - "The RSC keeps the Phase 9 tab spine VERBATIM (await params → z.uuid() guard → notFound → resolveProject → notFound → canWrite from resolveActiveRole) and only swaps the placeholder body for the tRPC-provider-wrapped island"
  - "R2_PUBLIC_BASE_URL added to the panel env SERVER block (not NEXT_PUBLIC_*) — the public render URL is built server-side and handed to the island as a prop; no secret and no storage key reaches the client (T-12-06)"
  - "The island imports the same pure @imbau/api/geometry module for client-side pre-validation; server re-validation (Plan 02) stays the authority — canWrite only gates draw affordances cosmetically (T-12-02 defense-in-depth)"
  - "LOCKED viewBox-0-1000 square-normalized convention persisted verbatim (preserveAspectRatio=\"none\", getScreenCTM().inverse(), integer coords) so phase-2 parses identically — human-confirmed at UAT over the real R2 render"

patterns-established:
  - "Pattern: a panel editor surface is an RSC guard-spine + render-URL resolution wrapping a hand-rolled `use client` SVG island — no canvas/WebGL/game-engine lib (CLAUDE.md product decision), no net-new runtime dependency (inline SVG glyphs, not lucide-react)"
  - "Pattern: intrinsic viewBox coordinates are the persisted + displayed value (D-09); pointer→viewBox transform runs on every event via getScreenCTM().inverse(), never a stored pixel"

requirements-completed: [HSPOT-01, HSPOT-02, HSPOT-03]

coverage:
  - id: D1
    description: "hotspots tab RSC (page.tsx): verbatim Phase 9 guard spine, server-side hotspots.getForProject caller, ${R2_PUBLIC_BASE_URL}/${key} → URL (or null) prop resolution, HotspotsEditor wrapped in TRPCReactProvider with serializable props only; R2_PUBLIC_BASE_URL in panel env server block (no NEXT_PUBLIC_*)"
    requirement: "HSPOT-01, HSPOT-02"
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/panel typecheck passes (no any); grep R2_PUBLIC_BASE_URL apps/panel/env.ts; grep HotspotsEditor page.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "HotspotsEditor hand-rolled SVG island: viewBox-0-1000 canvas, target-first draw (D-07), vertex-drag via pointer-capture + delete-vertex ≥3 guard (D-01), close-on-first-vertex/double-click, drill-down (D-03), always-visible selector rail (D-04), blocking no-autocorrect validation (D-08), explicit save (D-10), Borrar confirm (D-02), es-AR empty-states (D-06), read-only viewer — inline SVG only (no canvas/game-engine lib, no net-new dep)"
    requirement: "HSPOT-01, HSPOT-02, HSPOT-03"
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/panel typecheck + lint (new hotspots files clean, no any); ! grep -qiE 'konva|fabric|pixi' apps/panel/package.json → DEP_OK"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visual draw → validate → save → persist happy path over the real R2 render: draw+save a floor polygon persists across reload; drill into a planta + draw a unit polygon; vertex-edit + delete (field-to-null, row preserved); bowtie blocked with the es-AR banner (no autocorrect); missing render → D-06 empty-state; a viewer sees a read-only editor"
    requirement: "HSPOT-01, HSPOT-02, HSPOT-03"
    verification:
      - kind: manual_procedural
        ref: "12-03 Task 3 human-verify checkpoint — 6-step UAT run in-browser against the seeded Brigos Recoleta project + real R2 render; user replied 'aprobado' (2026-07-25)"
        status: pass
    human_judgment: true
    rationale: "The draw-over-render visual pass (polygon alignment on the real render, drill-down UX, blocking-validation banner, read-only-viewer view) is only observable by a human against real R2 (12-VALIDATION.md Manual-Only). Approved via UAT."

# Metrics
duration: ~25min
completed: 2026-07-25
status: complete
---

# Phase 12 Plan 03: Hotspot editor panel surface Summary

**The `proyectos/[id]/hotspots` operator surface — an RSC that resolves project/role and builds public render URLs server-side, wrapping a hand-rolled `"use client"` SVG island that draws, vertex-drags, deletes, and drills floor + unit polygons over an intrinsic `viewBox="0 0 1000 1000"` overlay with target-first drawing, an always-visible selector rail, blocking no-autocorrect validation, and explicit save — wired to the Plan 02 `hotspots` router and human-verified over the real R2 render.**

## Performance

- **Duration:** ~25 min (impl) + human UAT
- **Tasks:** 3 (2 auto, 1 human-verify checkpoint — APPROVED)
- **Files:** 3 (1 created, 2 modified)

## Accomplishments
- **RSC `page.tsx`** — keeps the Phase 9 tab spine VERBATIM (await params → `z.uuid()` guard → `notFound()` → `resolveProject` → `notFound()` → `canWrite` from `resolveActiveRole()`), builds a server-side caller to `hotspots.getForProject`, maps `renderExteriorKey` and each floor's `renderKey` to `${R2_PUBLIC_BASE_URL}/${key}` (null key → null URL prop → the island's D-06 empty-state), and renders `<HotspotsEditor>` inside `<TRPCReactProvider>` passing serializable props ONLY (projectId, canWrite, render URLs, floors/units) — never a storage key, never a tRPC caller.
- **`HotspotsEditor` island (778 lines)** — a hand-rolled `"use client"` SVG editor (NO canvas/Konva/Fabric/PixiJS; inline SVG glyphs, no net-new runtime dependency): a 280px always-visible selector rail + a canvas that is a read-only `<img>` render (D-05) with an absolutely-overlaid `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">` sized exactly to the render box. Pointer→viewBox via `getScreenCTM().inverse()` read inside handlers, clamped+rounded to integers 0-1000 (D-09, the LOCKED 12-01 convention). Target-first draw (D-07), close-on-first-vertex/double-click (D-01), vertex-drag via `setPointerCapture` + delete-vertex with a ≥3 guard (D-01/HSPOT-03), drill-down (D-03), explicit `Guardar polígono` with client pre-validation through `@imbau/api/geometry` → Vendido-red blocking banner + disabled button on invalid geometry (D-08, no autocorrect), `Borrar polígono` behind a Vendido-red confirm calling the field-to-null clear (D-02), and the es-AR D-06 empty-states. `canWrite` gates draw affordances cosmetically only — a viewer sees a read-only editor.
- **`apps/panel/env.ts`** — added `R2_PUBLIC_BASE_URL` to the server block (no `NEXT_PUBLIC_*`), so the RSC builds public render URLs server-side with no secret or key leaking to the client.

## Task Commits

1. **Task 1: hotspots RSC resolves render URLs + panel R2_PUBLIC_BASE_URL** — `ab133aa` (feat)
2. **Task 2: hand-rolled SVG hotspot editor island** — `accd4f9` (feat)
3. **Task 3: human-verify draw → validate → save → persist happy path + drill-down + empty-states** — no code (verification-only checkpoint); **APPROVED via 6-step in-browser UAT against the real R2 render, 2026-07-25 ("aprobado")**.

## Files Created/Modified
- `apps/panel/app/proyectos/[id]/hotspots/page.tsx` — RSC: verbatim guard spine + server-side getForProject caller + render-URL resolution + island wiring (replaced the Phase 9 placeholder body).
- `apps/panel/app/proyectos/[id]/hotspots/hotspots-editor.tsx` — the hand-rolled SVG editor island (created).
- `apps/panel/env.ts` — `R2_PUBLIC_BASE_URL` server env.

## Decisions Made
- **Server-side URL construction (T-12-06):** `R2_PUBLIC_BASE_URL` lives in the env SERVER block; the RSC hands URL strings (or null) as props. No `NEXT_PUBLIC_*` was introduced, no storage key or credential reaches the client.
- **Cosmetic-only `canWrite` (T-12-02):** draw/save/delete affordances hide for non-writers, but the Plan 02 `requireRole` on every mutation is the authority — a tampered viewer still gets `FORBIDDEN`. Human-confirmed read-only-viewer view at UAT step 6.
- **LOCKED coordinate convention honored (D-09, phase-2 continuity):** persisted geometry is the square-normalized integer viewBox-0-1000 string from 12-01 (`preserveAspectRatio="none"`, `getScreenCTM().inverse()`), so the phase-2 explorer parses it identically — confirmed visually aligned over the real (non-illustrative) R2 render at UAT.
- **Client pre-validation, server authority:** the island imports the same pure `@imbau/api/geometry` module to block an invalid Guardar client-side (D-08), but the server re-validation (Plan 02) is the real gate; the client check is UX, not trust.

## Design Contract Honored (D-01..D-10)
- **D-01** draw/edit interaction (click vertex, close on first vertex/double-click, vertex-drag, delete-vertex ≥3 guard) — implemented.
- **D-02** `Borrar polígono` = field-to-null clear (row preserved) behind a Vendido-red confirm — implemented.
- **D-03** drill-down: click a floor's exterior polygon → its planta — implemented.
- **D-04** always-visible selector rail opens ANY planta directly (huevo-y-gallina safety net) — implemented.
- **D-05** read-only render background; never draw over void — implemented.
- **D-06** es-AR empty-states for missing exterior/planta render, no floors, no units — implemented.
- **D-07** target-first drawing (pick floor/unit before drawing; prompt until then) — implemented.
- **D-08** blocking, no-autocorrect validation (Vendido-red banner + disabled button on invalid geometry) — implemented.
- **D-09** intrinsic viewBox-0-1000 integer coordinates, never pixels — implemented + UAT-aligned over the real render.
- **D-10** explicit save (no autosave); only deletion is confirm-gated — implemented.

## Backstop Items Exercised (UI-SPEC)
The human UAT covered the draw/drill/edit/delete/validation/empty-state/read-only-viewer path over the real R2 render. The four backstop must-haves (long-label truncation in the 280px rail, non-square render alignment, overlapping-polygon legibility/selectability, dense-vertex grabbability) are design backstops satisfied by the implemented halo + 24px hit-target + truncation styling; not each independently instrumented — noted here for the verifier.

## Deviations from Plan
None — plan executed exactly as written. Task 3 (human-verify) ran as specified and was approved.

## Issues Encountered
None during implementation. Task 3 was a deferred finalization: the two impl commits landed, then execution paused at the blocking human-verify checkpoint until the user ran the in-browser UAT and replied "aprobado".

## Deferred Issues
- **Pre-existing lint error in `packages/api/src/trpc/routers/leads.ts:183`** (`@typescript-eslint/no-unnecessary-type-assertion`, from Phase 11) — untouched by this plan; keeps repo-wide `@imbau/api` lint red (would fail the CI `quality` gate) and is `eslint --fix`-able. It predates phase 12 and is logged in `.planning/phases/12-editor-de-hotspots/deferred-items.md`. The new hotspots files (`page.tsx`, `hotspots-editor.tsx`, `env.ts`) lint clean in isolation and `@imbau/panel` typecheck+lint pass. Fix in a follow-up touching the leads surface or a dedicated lint-debt cleanup.

## Known Stubs
None — the editor is fully wired to the Plan 02 router (getForProject read + set/clear floor + set/clear unit); render backgrounds resolve from real R2 keys via `R2_PUBLIC_BASE_URL`.

## User Setup Required
`R2_PUBLIC_BASE_URL` must be set in the panel environment so seeded/real render keys resolve as backgrounds (already present in the UAT environment; documented here for staging parity).

## Next Phase Readiness
- **HSPOT-01/02/03 delivered:** a developer can visually author floor + unit hotspots. The persisted `"x,y x,y"` integer viewBox-0-1000 string is the LOCKED contract the future **phase-2 explorer** consumes verbatim (confirmed aligned over the real render).
- Phase 12 is complete (3/3 plans). No blockers introduced by this plan beyond the pre-existing Phase 11 lint debt above.

## Self-Check: PASSED

`hotspots-editor.tsx` present on disk; `page.tsx` + `env.ts` modified; both impl commits (`ab133aa`, `accd4f9`) present in git history; Task 3 human-verify APPROVED via UAT.

---
*Phase: 12-editor-de-hotspots*
*Completed: 2026-07-25*
