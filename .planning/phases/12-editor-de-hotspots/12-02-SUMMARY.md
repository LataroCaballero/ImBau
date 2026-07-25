---
phase: 12-editor-de-hotspots
plan: 02
subsystem: api
tags: [trpc, rls, requireRole, hotspots, polygon, geometry, tenant-isolation, no-enumeration, validation]

# Dependency graph
requires:
  - phase: 12-editor-de-hotspots
    plan: 01
    provides: "@imbau/api/geometry (parsePolygon/validatePolygon/serializePolygon/polygonErrorMessage + PolygonParseError) and projects.renderExteriorKey (migration 0008)"
  - phase: 09-shell-del-panel
    provides: "projects.updateSettings write mold (requireRole + withTenant + .returning() 0-row NOT_FOUND); requireRole middleware"
  - phase: 10-d1-grilla-de-unidades
    provides: "units.updateEstado plain-UPDATE clone + role-gate test matrix mold (projects/units-role-gate.test.ts)"
provides:
  - "hotspots tRPC router — the SINGLE gated, tenant-scoped, server-re-validated write seam for floor + unit polygons (getForProject read + set/clear floor + set/clear unit)"
  - "hotspots-role-gate.test.ts — the authorization + tenant-isolation + no-enumeration + blocking-validation + canonical-round-trip + clear-not-delete proof vs real Postgres"
affects: [12-03-panel-editor, phase-2-explorador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server re-validates + re-serializes an untrusted polygon through the pure geometry module INSIDE the mutation (never trusts a client isValid flag), before the RLS-scoped UPDATE — the D-08 blocking-validation boundary"
    - "Clear = field-to-null UPDATE (.set({ poligonoSvg: null })), never a row delete (D-02) — same requireRole + .returning() 0-row NOT_FOUND guard as a set"
    - "Length cap (16 KB) at the Zod boundary + vertex-count cap (200) after parse, before the O(n²) self-intersection scan (T-12-04 DoS bound)"

key-files:
  created:
    - packages/api/src/trpc/routers/hotspots.ts
    - packages/api/tests/hotspots-role-gate.test.ts
  modified:
    - packages/api/src/trpc/routers/_app.ts

key-decisions:
  - "MAX_POLYGON_B = 16_000 (string length cap) and MAX_VERTICES = 200 (vertex cap before the O(n²) validation) — DoS bounds far above any real hotspot (T-12-04)"
  - "toCanonicalPolygon runs OUTSIDE the withTenant transaction (parse+validate is pure, no DB) so a BAD_REQUEST throws before any connection/tx is opened — zero rows mutated by construction"
  - "PolygonParseError (malformed token, T-12-05) is mapped to BAD_REQUEST with the parser's own es-AR message; validation reasons map through polygonErrorMessage"

patterns-established:
  - "Pattern: a polygon write is requireRole + pure-module re-validation + canonical re-serialize + RLS-scoped UPDATE + .returning() 0-row NOT_FOUND — RLS proves tenant isolation, requireRole proves authorization (orthogonal, the Phase 9 lesson)"

requirements-completed: [HSPOT-01, HSPOT-02, HSPOT-03, HSPOT-04]

coverage:
  - id: T1
    description: "hotspots router: getForProject + setFloorPolygon + clearFloorPolygon + setUnitPolygon + clearUnitPolygon, gated + tenant-scoped + server-re-validated, registered in _app.ts, elevated-pool fence intact"
    requirement: "HSPOT-01, HSPOT-02, HSPOT-03, HSPOT-04"
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/api typecheck passes (no any); grep FENCE_OK (no createOwnerDb/appDb/createAppDb); _app.ts registers hotspots; clear uses .set({ poligonoSvg: null }), no .delete("
        status: pass
    human_judgment: false
  - id: T2
    description: "Cross-role + tenant-isolation + no-enumeration + blocking-validation + canonical-round-trip + clear-not-delete matrix vs real Postgres"
    requirement: "HSPOT-01, HSPOT-02, HSPOT-03, HSPOT-04"
    verification:
      - kind: integration
        ref: "vitest run tests/hotspots-role-gate.test.ts — 16 tests green (owner/dev resolve, viewer FORBIDDEN, cross-org + non-existent NOT_FOUND for floor+unit; bowtie/<3-vertex BAD_REQUEST zero-mutation; round-trip; clear-not-delete)"
        status: pass
      - kind: integration
        ref: "pnpm --filter @imbau/api test full package — 205 tests / 22 files green, no regression to units/projects/leads gates"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-25
status: complete
---

# Phase 12 Plan 02: Hotspots write-seam router Summary

**The `hotspots` tRPC router — the single gated, tenant-scoped, server-re-validated write seam for floor and unit polygons (getForProject read + set/clear floor + set/clear unit) — a verbatim clone of the `projects.updateSettings` mold, proven against real Postgres by a 16-case authorization/isolation/validation matrix.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files:** 3 (2 created, 1 modified)

## Accomplishments
- Built `packages/api/src/trpc/routers/hotspots.ts`: five procedures on the unprivileged app pool (imports ONLY `withTenant`/`schema` from `@imbau/db` — the Phase 9 grep-fence). Every write is `requireRole("owner","developer")` over `withTenant` with a `.where(id ∧ projectId)` + `.returning()` 0-row → `NOT_FOUND` guard (no-enumeration). Every save re-validates through the Plan 01 pure `@imbau/api/geometry` module and re-serializes canonically before persisting (D-08); clears are field-to-null UPDATEs, never row deletes (D-02).
- Registered `hotspots: hotspotsRouter` in `_app.ts` so the panel imports the types with no codegen.
- Wrote `hotspots-role-gate.test.ts` cloning `units-role-gate.test.ts`: the full owner✓/developer✓/viewer→FORBIDDEN/cross-org→NOT_FOUND/non-existent→NOT_FOUND matrix for both `setFloorPolygon` and `setUnitPolygon`, plus bowtie/<3-vertex → BAD_REQUEST-with-zero-mutation, canonical round-trip (D-09), and clear-not-delete (D-02) — 16 tests, green vs real Postgres.

## Contract for Plan 03 (consumed via `inferRouterOutputs`)

**`hotspots.getForProject({ projectId: string })` (query) returns:**
```ts
{
  renderExteriorKey: string | null;
  floors: { id: string; numero: number; nombre: string | null; renderKey: string | null; poligonoSvg: string | null }[];
  units:  { id: string; floorId: string; identificador: string; poligonoSvg: string | null }[];
}
```
RLS scopes every row to the active org; a cross-org `projectId` yields `renderExteriorKey: null` + empty arrays.

**The five procedure signatures:**
- `getForProject({ projectId })` — query (protectedProcedure; owner/developer/viewer read).
- `setFloorPolygon({ projectId, floorId, poligonoSvg })` — mutation → `{ id, poligonoSvg }`.
- `clearFloorPolygon({ projectId, floorId })` — mutation → `{ id, poligonoSvg: null }`.
- `setUnitPolygon({ projectId, unitId, poligonoSvg })` — mutation → `{ id, poligonoSvg }`.
- `clearUnitPolygon({ projectId, unitId })` — mutation → `{ id, poligonoSvg: null }`.

All four writes are `requireRole("owner","developer")`. `poligonoSvg` is `z.string().max(16_000)` at the boundary; the server additionally caps vertices at 200 and re-runs `validatePolygon` inside the mutation. On any invalid payload → `BAD_REQUEST` (es-AR message) with zero rows mutated; cross-org/non-existent id → `NOT_FOUND`; viewer → `FORBIDDEN`.

## Task Commits
1. **Task 1: hotspots router + _app.ts registration** — `79b3541` (feat)
2. **Task 2: role-gate + validation + round-trip + clear-not-delete matrix** — `86e219b` (test)

## Decisions Made
- **`toCanonicalPolygon` runs before `withTenant`** — parse+validate is pure (no DB), so a `BAD_REQUEST` throws before any transaction opens; zero rows mutated is structural, not incidental.
- **DoS bounds:** `MAX_POLYGON_B = 16_000` (Zod length cap) and `MAX_VERTICES = 200` (checked after parse, before the O(n²) self-intersection scan) — T-12-04.
- **`PolygonParseError` → `BAD_REQUEST`** carrying the parser's own es-AR message (the T-12-05 injection guard surfaces as a clean 400, never a 500).

## Deviations from Plan
None — plan executed exactly as written. (The vertex cap is enforced with a dedicated `MAX_VERTICES` const as the plan suggested; `getForProject` returns `renderExteriorKey` as `null` when absent, matching the cross-org empty-hydration contract.)

## Threat Mitigations Applied
- **T-12-01/02 (spoofing/elevation):** all four writes build on `requireRole` (extends `protectedProcedure`) — unauthenticated → UNAUTHORIZED, viewer → FORBIDDEN before any UPDATE (proven by the viewer cases).
- **T-12-03 (cross-org tamper):** `withTenant` + `.where(id ∧ projectId)` + `.returning()` 0-row → NOT_FOUND (proven by the other-org + non-existent cases, identical response = no enumeration).
- **T-12-04 (DoS):** 16 KB length cap + 200-vertex cap before the O(n²) scan.
- **T-12-05 (injection):** server re-parses (integer pairs 0-1000 only) then persists `serializePolygon(points)` — only canonical integer pairs reach the DB (proven by the round-trip case).

## Issues Encountered
None.

## Deferred Issues
- **Pre-existing lint error in `packages/api/src/trpc/routers/leads.ts:183`** (`@typescript-eslint/no-unnecessary-type-assertion`, Phase 11) — untouched by this plan, still red at repo-wide `@imbau/api lint`. Out of scope; already logged to `.planning/phases/12-editor-de-hotspots/deferred-items.md` by Plan 01. `typecheck` (the plan's gate) is green; new `hotspots.ts` lints clean in isolation. Note for Plan 12-03: this will fail the CI `quality` gate until fixed.

## Known Stubs
None — every procedure is fully wired to real DB writes/reads through `withTenant`.

## User Setup Required
None.

## Next Phase Readiness
- **Plan 12-03** (panel editor island) can now import `AppRouter` types and drive the five procedures; it consumes the `getForProject` shape above via `inferRouterOutputs` and pre-validates client-side with the same `@imbau/api/geometry` module before "Guardar".

## Self-Check: PASSED

Both created files present on disk; `_app.ts` registers `hotspots`; both task commits (`79b3541`, `86e219b`) present in git history; 16/16 hotspots tests + 205/205 full-package tests green vs real Postgres.

---
*Phase: 12-editor-de-hotspots*
*Completed: 2026-07-25*
