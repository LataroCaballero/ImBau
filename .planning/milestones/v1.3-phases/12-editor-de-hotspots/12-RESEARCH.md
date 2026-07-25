# Phase 12: Editor de hotspots — Research

**Researched:** 2026-07-24
**Requirements:** HSPOT-01, HSPOT-02, HSPOT-03, HSPOT-04
**Method:** Direct code-evidence read of the live schema, routers, seed, and panel islands (the gsd-phase-researcher subagent completed its investigation but died on an API stream error before persisting; this file is the same evidence-based picture, written inline by the orchestrator).

> **Scope guard (CLAUDE.md):** hotspots are **polígonos SVG como datos, sin motores 3D / game engine** — this is a product decision, not a technical one. NO canvas/WebGL libs (Konva, Fabric, PixiJS). The editor is hand-rolled SVG + pointer events. TypeScript strict, no `any`. Migraciones Drizzle **versionadas** (never `push`, never manual). UI es-AR voseo; código/commits inglés.

---

## 0. TL;DR for the planner

1. **[BLOCKING — RESOLVED] Where the exterior render lives → add a `projects.renderExteriorKey text` (nullable) column.** It is the exact peer of `floors.renderKey` and `units.planoKey` (both are plain nullable `text` R2 storage keys directly on their domain table). This costs **one additive, nullable, versioned Drizzle migration** — no backfill. It is NOT "cero migración", but the CONTEXT/ROADMAP explicitly anticipated this as the open question, and the polygon persistence itself (`floors.poligonoSvg`/`units.poligonoSvg`) remains zero-migration. Do NOT designate a `media` row (media has no role/kind discriminator → would require net-new convention and breaks the floors/units precedent).
2. **Editor** = hand-rolled React 19 client island rendering an `<svg viewBox="0 0 1000 1000">` over an `<image>` background, with pointer events for draw / vertex-drag / delete. Screen↔viewBox transform via `SVGGraphicsElement.getScreenCTM().inverse()` (native, exact, zoom/pan-safe) — persisted coords are always intrinsic 0–1000, independent of on-screen pixel width (D-09). ~250–350 lines.
3. **Geometry validation** = a pure, I/O-free module colocated with `@imbau/quoting`-style code, **in `packages/api/src/hotspots/`** (precedent: the panel already imports `@imbau/quoting` AND `@imbau/api/money` into client islands; a dependency-free pure module drags no server deps into the client bundle). Shoelace area + segment-intersection self-crossing test + min-vertex/min-area/collinear checks. Blocking, no autocorrect (D-08). Unit + property tests before wiring the mutation.
4. **Write mold** = verbatim clone of `projects.updateSettings` / `units.updateEstado`: `requireRole("owner","developer")` + `withTenant(ctx.activeOrgId,…)` + `.update(…).where(id ∧ projectId).returning()` → 0-row `NOT_FOUND`. One mutation per polygon save (D-10). Recommend a **`hotspots` router** with `setFloorPolygon` / `clearFloorPolygon` / `setUnitPolygon` / `clearUnitPolygon` + a read (`getForProject`). Cross-role matrix test vs real Postgres (owner✓/developer✓/viewer✗ 403 / otra org✗ NOT_FOUND).
5. **Persisted format** = a `<polygon points>`-style **`"x,y x,y x,y"`** string, integers 0–1000, space-separated pairs, comma between x and y. Rationale below. The pure module owns serialize/parse so panel-write and phase-2-read agree byte-for-byte.
6. **Seed reality:** the seed populates **no** `renderKey`/`planoKey`/`renderExteriorKey`/`poligonoSvg` — they are all null on Brigos Recoleta. So the D-06 empty-state ("falta el render") is the *default* state, and the draw-over-render happy path is **not testable on seed data as-is**. The planner MUST decide how the happy path gets a background render for UAT (recommended: a tiny seed extension setting placeholder keys — see §7).

---

## 1. [BLOCKING] Where does the building's exterior render live?

### The question
`floors.poligonoSvg` (floor polygons over the exterior render) and `units.poligonoSvg` (unit polygons over the floor plan) **already exist** — zero migration for the polygons. But the **exterior building render itself** (the background the floor polygons are drawn on) has no home: `projects` has no render column today.

### Evidence (read from the live schema)
- `packages/db/src/schema/floors.ts:29` — `renderKey: text("render_key")` — *"Render de planta (storage key)"*. A **plain nullable text R2 storage key, directly on the domain table.** Not an FK to `media`.
- `packages/db/src/schema/units.ts:44` — `planoKey: text("plano_key")` — *"Plano amoblado (storage key)"*. Same pattern.
- `packages/db/src/schema/projects.ts` — columns are `id, organizationId, nombre, slug, estado, whatsapp, leadsNotifyEmail`. **No render column.** Has `projects_anon_published` (table-level SELECT for `estado='publicado'`).
- `packages/db/src/schema/media.ts` — a generic asset table (`originalKey`, `variants` jsonb, `blurhash`, `width`, `height`) for the Fase-2 AVIF/WebP srcset pipeline. **It has no `kind`/`role`/`seccion` discriminator** — nothing marks a row as "the exterior render." `seedMedia` produces gallery/progress rows only.
- `packages/db/seed.ts` + `packages/db/src/seed/*` — seed sets **none** of `renderKey`, `planoKey`, `poligonoSvg`; `seedMedia` produces gallery/progress media, not floor/unit/exterior renders.

### Recommendation → **add `projects.renderExteriorKey text` (nullable)**

```ts
// packages/db/src/schema/projects.ts
renderExteriorKey: text("render_exterior_key"),   // R2 storage key of the building's exterior
                                                   // render; the background for floor polygons.
                                                   // Nullable: null → D-06 empty-state.
```

**Why (a) projects-column beats (b) media-row:**
| | (a) `projects.renderExteriorKey` (recommended) | (b) designated `media` row |
|---|---|---|
| Matches existing precedent | ✅ exact peer of `floors.renderKey` / `units.planoKey` | ❌ nothing else uses a media row for a render |
| "Which asset is the exterior render?" | ✅ unambiguous — the column *is* the answer | ❌ needs a net-new discriminator (a `kind` col or naming convention) = MORE schema work |
| Anon consumption (phase-2) | ✅ free — `projects_anon_published` is table-level SELECT; a new text column is auto-readable for publicado projects, **zero new pgPolicy** | ⚠️ works via `media_anon_published`, but you still need the discriminator to find the row |
| Migration cost | one additive **nullable** text column, versioned, no backfill | one row-convention (+ maybe a discriminator column) |
| Symmetry | ✅ building→`projects`, floor→`floors`, unit→`units` | ❌ breaks the symmetry |

**Migration note — versioned, NOT push (CLAUDE.md, load-bearing):** this project uses **versioned** Drizzle migrations (`drizzle-kit generate` → committed SQL → `pnpm db:migrate`; see migrations `0005`, `0007` in the decision log). The plan-phase **schema-push gate** will fire because a schema file changes — but its default "`drizzle-kit push`" is **wrong here**. The planner must inject a `[BLOCKING]` **`drizzle-kit generate` + `pnpm db:migrate`** task (a new numbered migration `0008_*`), run AFTER the schema edit and BEFORE verification, `autonomous: false` if the generate step needs confirmation. Never `push`, never manual DDL.

**Phase-2 consumption contract:** the future explorer reads `projects.renderExteriorKey` (via `withAnon`, gated by `projects_anon_published`) as the exterior background, then `floors.poligonoSvg` for floor hotspots, then per-floor `floors.renderKey` + `units.poligonoSvg` for unit hotspots. All four columns are already anon-published (or will be, for the new column, automatically). The `picker` router (`listFloors`/`listUnits`) is the exact anon read seam that phase-2 will extend — it already `select()`s all floor/unit columns, so the new polygons ride along with no router change needed for reads.

---

## 2. Hand-rolled SVG polygon editor (HSPOT-01/02/03)

### Shape
A React 19 **client island** (`"use client"`) — the exact pattern of `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx`. The RSC page (`hotspots/page.tsx`) resolves the project + role and the background URL, then renders `<HotspotsEditor projectId canWrite exteriorRenderUrl floors … />`.

```
<div class="editor-canvas" style="position:relative">
  <img src={renderUrl} />                      // background (or D-06 empty-state if null)
  <svg viewBox="0 0 1000 1000"                 // FIXED intrinsic space, overlaid, absolute-positioned
       style="position:absolute; inset:0; width:100%; height:100%">
    <polygon points={draft} />                 // committed + in-progress polygons
    {vertices.map(v => <circle cx cy r /> )}   // draggable vertex handles
  </svg>
</div>
```

### Screen ↔ viewBox transform (the load-bearing detail for D-09)
Do NOT compute the transform by hand from `getBoundingClientRect` (breaks under aspect-ratio letterboxing / zoom). Use the **native CTM**:

```ts
function screenToViewBox(svg: SVGSVGElement, e: PointerEvent): { x: number; y: number } {
  const pt = new DOMPoint(e.clientX, e.clientY);
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  // clamp to the intrinsic 0–1000 box; round to integers for a stable persisted string
  return { x: clamp(Math.round(p.x), 0, 1000), y: clamp(Math.round(p.y), 0, 1000) };
}
```
`viewBox="0 0 1000 1000"` + `width:100%` makes the SVG user-space **always** 0–1000 regardless of the render's on-screen pixel size → persisted coords are intrinsic (the "dinero entero nunca float" analog: the canonical representation never depends on the view). Use `preserveAspectRatio` consistently on both `<image>`/`<img>` and `<svg>` (or overlay the svg exactly on the img box) so vertices land where the operator clicks.

### Interactions (D-01/D-02/D-03)
- **Draw:** `pointerdown` on empty canvas appends a vertex. Close by clicking the first vertex (hit-radius in viewBox units, e.g. ≤ ~20) or double-click. Live `<polyline>` preview while open.
- **Edit vertex:** `pointerdown` on a vertex `<circle>` → `setPointerCapture` → `pointermove` updates that vertex → `pointerup` releases. (Pointer capture is the React-19-safe way to keep the drag glued to one handle.)
- **Delete vertex:** control (right-click / a small ✕ on the handle / keyboard Delete on selected vertex). Guard: cannot drop below 3 vertices (that would degenerate — see §3).
- **Delete polygon:** a "Borrar polígono" control → clears the field (D-02: it is an **UPDATE to null**, not a row delete).
- **No autosave (D-10):** an explicit "Guardar" button runs validation (§3) then the mutation.

### React/Next landmines
- All pointer logic is client-only. The RSC page passes serializable props (`projectId`, `canWrite`, `exteriorRenderUrl`, floor list) — never a tRPC caller.
- `getScreenCTM()` is only valid after mount/layout; read it inside the handler, not render.
- Keep the SVG a single fixed `viewBox`; do not resize it on window resize — `width:100%` + `viewBox` handles responsiveness for free.

---

## 3. Pure geometry-validation module (HSPOT-04 / D-08)

### Location → `packages/api/src/hotspots/geometry.ts` (pure, I/O-free)
Precedent: `packages/api/src/excel/*` is exactly this shape (pure module, unit + property tested, consumed by the router AND importable). And `apps/panel/.../units-grid.tsx` imports `@imbau/api/money` + `@imbau/quoting` into a **client** island — so if the panel wants to pre-validate before "Guardar", a dependency-free `geometry.ts` can be imported client-side too without dragging server deps. Server RE-VALIDATES inside the mutation regardless (never trust a client `isValid` flag — the exact `buildDryRun` lesson from units.ts:317).

### Algorithms (recommend)
- **Degenerate:** `< 3` vertices → invalid. **Area ≈ 0** via the **shoelace formula**; reject `|area| < ε` (ε in viewBox² units, e.g. a few units² — tune so a visible triangle passes). **Collinear**: all-collinear ⇒ area 0, so the area check subsumes it.
- **Self-intersection:** test every non-adjacent edge pair with a standard **segment-intersection** (orientation / CCW test). O(n²) is fine — polygons here are a handful of vertices. Reject if any non-adjacent pair crosses.
- **Bounds:** every vertex integer in `[0,1000]` (the transform already clamps; validate defensively).
- **Blocking, no autocorrect (D-08):** return a typed result `{ ok: true } | { ok: false, reason: 'degenerate'|'self_intersecting'|'out_of_bounds'|'too_few_points' }`; the router throws `BAD_REQUEST` with the es-AR voseo message; nothing is silently repaired.

### es-AR voseo messages (from CONTEXT specifics)
- self-intersecting → *"El polígono se cruza consigo mismo — corregilo antes de guardar."*
- degenerate → *"El polígono es demasiado chico o no tiene forma — marcá al menos 3 vértices."*

### Serialize / parse (single source of truth)
`serializePolygon(points): string` and `parsePolygon(svg): Point[]` live in the same module so panel-write and phase-2-read never drift.

### Tests (before wiring the mutation — packages/quoting/excel precedent)
- **Unit:** valid triangle/quad; 2-point (reject); zero-area collinear (reject); bowtie self-intersection (reject); out-of-bounds (reject); round-trip `parse(serialize(p)) === p`.
- **Property:** `serialize→parse` round-trips for any integer point list; a convex hull of random points is always non-self-intersecting; a known bowtie is always rejected. (Project already runs property tests on pure risk modules — `engine.property.test.ts`, and `parseMoneyEsAr` property-proven.)

---

## 4. Persisted SVG string format (Claude's Discretion → pick one)

**Recommendation: `<polygon points>` form — `"x,y x,y x,y …"`**, integers 0–1000, one space between pairs, one comma within a pair. Example: `"120,880 300,880 300,650 120,650"`.

Why over `path d`:
- Directly usable as `<polygon points={…}>` in both the editor and the phase-2 explorer — no path-command parsing.
- Trivial, unambiguous parse: `.trim().split(/\s+/).map(p => p.split(',').map(Number))`.
- Compact; integers only (D-09 intrinsic coords). No curve/command ambiguity.
- A `poligonoSvg` field name + a bare points list = obviously a polygon; phase-2 consumes it with zero heuristics.

Document this in the plan's "Artifacts this phase produces" so phase-2 has the exact contract.

---

## 5. Write mold + router (D-10) — clone, don't invent

### The mold (verbatim from `projects.updateSettings` / `units.updateEstado`)
```ts
setFloorPolygon: requireRole("owner", "developer")
  .input(z.object({ projectId: z.uuid(), floorId: z.uuid(), poligonoSvg: z.string() }))
  .mutation(({ ctx, input }) =>
    withTenant(ctx.activeOrgId, async (tx) => {
      const v = validatePolygon(parsePolygon(input.poligonoSvg));   // server re-validates (D-08)
      if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: msgFor(v.reason) });
      const rows = await tx.update(schema.floors)
        .set({ poligonoSvg: serializePolygon(...) })
        .where(and(eq(schema.floors.id, input.floorId), eq(schema.floors.projectId, input.projectId)))
        .returning({ id: schema.floors.id });
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });   // no-enumeration
      return rows[0];
    }));
```
- `clearFloorPolygon` / `clearUnitPolygon` = same mold, `.set({ poligonoSvg: null })` (D-02).
- `setUnitPolygon` = same, on `schema.units`, `.where(id ∧ projectId)`.
- **Read:** `getForProject` (a `protectedProcedure` under `withTenant`) returns floors (id, numero, nombre, renderKey, poligonoSvg) + units (id, floorId, identificador, poligonoSvg) + the project's `renderExteriorKey` so the editor can hydrate existing polygons and backgrounds in one call.

### Router shape → **new `hotspots` router**, registered in `_app.ts`
Recommend `hotspots.{getForProject,setFloorPolygon,clearFloorPolygon,setUnitPolygon,clearUnitPolygon}` (cohesive, one file) over scattering setters onto `floors`/`units` routers (which don't exist as domain routers today — only `units` exists, and it's the Excel/money surface). Register beside `units`/`projects` in `packages/api/src/trpc/routers/_app.ts`. Imports ONLY `withTenant/schema` from `@imbau/db` (the grep-fence — never the owner pool).

### Cross-role matrix test (clone `projects-role-gate.test.ts`)
Vs **real Postgres**: owner✓ / developer✓ / viewer✗ (FORBIDDEN before the write) / otra org → NOT_FOUND (invisible under RLS, 0-row). Plus a validation test: a self-intersecting/degenerate polygon → BAD_REQUEST, no row mutated.

### `whoami` on storage-key → URL
There is **no existing key→URL helper** in the panel (only `R2_PUBLIC_BASE_URL` env defs in `packages/api/src/media/runtime.ts` and `quotes/runtime.ts`). The editor background URL must be built **server-side in the RSC** (`` `${R2_PUBLIC_BASE_URL}/${renderExteriorKey}` ``) and passed as a prop to the client island — do NOT introduce a `NEXT_PUBLIC_*` client env if avoidable. Same for each floor's `renderKey` when drilling into a planta (the read procedure returns the keys; the RSC or a thin server action maps key→URL). Confirm where `R2_PUBLIC_BASE_URL` is currently surfaced to the panel runtime.

---

## 6. Drill-down UX (D-03/D-04/D-06) — mostly the approved 12-UI-SPEC

The 28KB approved `12-UI-SPEC.md` is the design contract; the planner lifts its `## UI Considerations`. Implementation landmines only:
- **RSC vs client boundary:** page (RSC) resolves project + role + keys→URLs; editor (client island) owns all pointer/draw state. Exterior view and planta view can be one island with an internal `mode` state, or the planta is a nested view keyed by `floorId` — either is fine (D-Discretion), but the **floor list/selector must be always visible (D-04)** so the operator can open any planta even before its exterior polygon exists (the huevo-y-gallina safety net).
- **Empty-states (D-06):** null `renderExteriorKey` → *"Falta el render exterior de este proyecto — cargalo para dibujar los pisos."* null floor `renderKey` → *"Falta la planta de este piso."* Never draw on blank.
- **Drill-down (D-03):** click a floor's exterior polygon → open that floor's planta. The always-visible list is the alternate path.
- **canWrite (D-08):** cosmetic; server `requireRole` is the authority (viewer sees a read-only editor).

---

## 7. Seed / verifiability gap (planner MUST address)

The seed sets **no** renders or polygons (`renderExteriorKey`/`renderKey`/`planoKey`/`poligonoSvg` all null on Brigos Recoleta). Consequences:
- The **D-06 empty-state is the default** — good to demo, but the **draw→validate→save happy path has no background to draw on** in a fresh seed.
- **Recommendation:** add a tiny, idempotent seed extension (or a documented UAT fixture) that sets `projects.renderExteriorKey` + a couple of `floors.renderKey` to a placeholder R2 key that actually resolves (e.g. reuse an already-seeded gallery `exteriores-fachada` asset key, or a public placeholder). Without this, HSPOT-01/02 cannot be exercised end-to-end in UAT — only the empty-state and the mutation (via a manually-set key) can. Keep it deterministic/idempotent (the seed is safe-rerun).
- Alternatively the planner can gate the happy-path UAT on a manual key-set SQL snippet documented in the plan; the seed-extension is cleaner and matches project conventions.

---

## Validation Architecture

Nyquist is enabled — each success criterion maps to a validation layer:

| Success criterion (ROADMAP) | Requirement | Validation layer(s) |
|---|---|---|
| Draw floor polygons over exterior render + link to floor | HSPOT-01 | **Integration** (`hotspots.setFloorPolygon` vs real Postgres: writes `floors.poligonoSvg`, scoped by project) · **e2e/UAT** draw→guardar→persist with a background render present (needs §7 fixture) |
| Draw unit polygons over planta + link to unit | HSPOT-02 | **Integration** (`hotspots.setUnitPolygon` writes `units.poligonoSvg`) · **e2e/UAT** drill-down exterior→planta→draw |
| Edit and delete existing polygons | HSPOT-03 | **Integration** (set overwrites; `clear*` sets null = D-02 field clear, not row delete) · **unit** (vertex drag/delete keeps ≥3) · **e2e/UAT** edit a seeded polygon, delete it |
| Intrinsic viewBox 0–1000 + validated + phase-2-consumable | HSPOT-04 | **Unit + property** (geometry: degenerate/self-intersection/bounds; `serialize↔parse` round-trip) · **Integration** (server re-validates, BAD_REQUEST on bad polygon, no row mutated) · **contract** (persisted string parses as `<polygon points>` 0–1000; `picker`-style anon read returns it unchanged) |
| Authorization (cross-cutting) | all | **Cross-role matrix vs real Postgres** (owner✓/developer✓/viewer✗ FORBIDDEN/otra-org NOT_FOUND) — clone `projects-role-gate.test.ts` |
| Zero migration for polygons; +1 additive for exterior render | HSPOT-04 | **Migration** (`0008_*` generated + `pnpm db:migrate`; `poligonoSvg` untouched) |

An honest verifier can confirm each with explicit evidence (test files, migration file, a persisted string read back via the anon seam). The one item needing a human/UAT signal is the **visual** draw-over-render pass (background fixture from §7).

---

## Open questions / risks for planning

1. **Exterior-render migration** — confirmed needed (§1). Low-risk, additive, nullable. Schema-push gate fires but must be satisfied with **versioned generate+migrate**, not `push`.
2. **Verifiability fixture** (§7) — decide seed-extension vs documented manual key-set. Recommend seed-extension.
3. **Where `R2_PUBLIC_BASE_URL` reaches the panel** (§5) — confirm the RSC can build key→URL server-side without a new client env.
4. **One-island-two-modes vs nested planta view** — D-Discretion; keep the floor selector always visible (D-04) either way.
5. **Zoom/pan** — not required (CONTEXT deferred multi-select/layers). `getScreenCTM()` is already zoom-safe if added later; don't build it now.

## RESEARCH COMPLETE
