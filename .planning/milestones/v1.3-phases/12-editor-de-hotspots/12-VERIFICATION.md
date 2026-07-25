---
phase: 12-editor-de-hotspots
verified: 2026-07-25T13:05:00-03:00
status: passed
score: 4/4 roadmap truths verified (functional); the 1 test-quality gap was RESOLVED inline (commit 865423e)
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The geometry module's property-based test suite reliably proves the round-trip and always-valid-convex-polygon invariants (Plan 12-01 Task 2 acceptance criterion: 'pnpm --filter @imbau/api test -- geometry runs both geometry.test.ts and geometry.property.test.ts green')."
    status: resolved
    resolution: "Fixed in commit 865423e — recentered the convexPolygon circle well inside the viewBox (center 470-530, radius <=430 ⇒ no clamp distortion) and added an independent shoelace-area precondition (|2*area| >= 2, the module's exact MIN_AREA_EPSILON accept threshold) so genuinely degenerate sub-EPSILON draws (coincident OR near-collinear, which the distinct-point-only guard missed) are skipped. Re-verified deterministic: geometry.property.test.ts 15/15 green across fresh fast-check seeds; full @imbau/api suite 205/205; typecheck + eslint clean."
    reason: "geometry.property.test.ts is flaky, not reliably green. Re-ran `pnpm --filter @imbau/api test -- geometry` 3 times independently during verification: it failed 2 of 3 runs with a real, reproducible counterexample (not an infra flake). The 'a genuinely convex polygon always validates' property occasionally generates two adjacent vertices that round to the identical integer point (e.g. counterexample [{x:650,y:450},{x:650,y:450},{x:649,y:426}]), which is a genuinely degenerate 2-distinct-point triangle — validatePolygon correctly returns {ok:false, reason:'degenerate'} for it, but the test asserts {ok:true} unconditionally once the array length is >=3. The bug is in the test's `fc.pre(points.length >= 3)` guard (packages/api/src/hotspots/geometry.property.test.ts:54), which checks array length but not point distinctness, so it does not filter out the rounding-collision case. This is a defect in the test fixture, not in validatePolygon (which behaves correctly)."
    artifacts:
      - path: "packages/api/src/hotspots/geometry.property.test.ts"
        issue: "convexPolygon arbitrary can produce two adjacent vertices that round to the same integer point; the fc.pre guard only checks points.length >= 3, not point distinctness, so the resulting degenerate fixture intermittently fails the 'always valid' assertion. Reproduced independently: 2 failures out of 3 consecutive `pnpm --filter @imbau/api test -- geometry` runs during this verification."
    missing:
      - "Strengthen the fc.pre guard (or the convexPolygon map step) to reject fixtures where any two vertices in the generated array are identical (e.g. `fc.pre(new Set(points.map(p => `${p.x},${p.y}`)).size === points.length)`), or widen the minimum angular separation between generated angles so rounding cannot collapse two distinct angles onto the same integer coordinate."
      - "Re-run `pnpm --filter @imbau/api test -- geometry` several times after the fix to confirm it is deterministically green (not just green on one lucky run) before merging/shipping."
---

# Phase 12: Editor de hotspots Verification Report

**Phase Goal:** Editor SVG draw/edit/delete + vínculo piso/unidad, coords viewBox intrínsecas — el developer dibuja, edita y borra los polígonos SVG del edificio (pisos sobre el render exterior, unidades sobre la planta) y los vincula a piso/unidad, guardados en coordenadas viewBox intrínsecas y validados, consumibles tal cual por el explorador de fase 2 vía las policies anon existentes.
**Verified:** 2026-07-25
**Status:** passed (initial run found 1 test-quality gap; resolved same-day inline — commit 865423e)
**Re-verification:** Gap closed inline during execution — property test deflaked + re-verified 15/15 deterministic

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, HSPOT-01..04)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El developer dibuja polígonos de pisos sobre el render exterior del edificio y los vincula a un piso (HSPOT-01) | ✓ VERIFIED | `hotspots-editor.tsx` target-first draw (rail selection required before drawing, D-07) → click-to-place-vertex → close on first vertex/double-click → `hotspots.setFloorPolygon` (`packages/api/src/trpc/routers/hotspots.ts`) persists `floors.poligonoSvg` scoped by `(floorId ∧ projectId)`. Proven against real Postgres by `hotspots-role-gate.test.ts` (owner/developer resolve; round-trip case). Human UAT (12-03 Task 3) confirmed the visual draw→save→reload→persist path — APPROVED 2026-07-25. |
| 2 | El developer dibuja polígonos de unidades sobre la planta del piso y los vincula a una unidad (HSPOT-02) | ✓ VERIFIED | Drill-down (`drillIntoFloor`) opens the planta mode; identical draw flow targets `hotspots.setUnitPolygon`, scoped by `(unitId ∧ projectId)`. Proven by `hotspots-role-gate.test.ts` (`setUnitPolygon` matrix). Human UAT step 4 confirmed drill-down + unit-polygon draw+save. |
| 3 | El developer edita y borra polígonos existentes (HSPOT-03) | ✓ VERIFIED | Edit: click an existing (Blueprint) polygon → cobre selection → `setPointerCapture` vertex-drag (`onVertexPointerDown`/`onSvgPointerMove`) → right-click delete-vertex guarded `>3` (`deleteVertex`). Delete: `Borrar polígono` behind a Vendido-red confirm → `clearFloorPolygon`/`clearUnitPolygon` — a field-to-null `.set({ poligonoSvg: null })` UPDATE, **not** a row delete (confirmed in `hotspots.ts` and proven by `hotspots-role-gate.test.ts`'s "clear is a field-to-null UPDATE, NOT a row delete" describe block: the floor/unit row is still returned by `getForProject` after clear). Human UAT step 3 confirmed vertex-drag persistence and delete-then-row-still-listed. |
| 4 | Los polígonos se guardan en coordenadas viewBox intrínsecas (0-1000), validados (no degenerados ni auto-intersecados), consumibles tal cual por fase 2, cero migración de schema (HSPOT-04) | ✓ VERIFIED (functional) / ⚠️ artifact gap in test suite | `packages/api/src/hotspots/geometry.ts` implements `validatePolygon` (too_few_points / out_of_bounds / self_intersecting / degenerate, in the load-bearing order documented) and `serializePolygon`/`parsePolygon` (locked `"x,y x,y…"` integer 0-1000 format). The server (`hotspots.ts` `toCanonicalPolygon`) re-validates and re-serializes before every write — proven server-side by `hotspots-role-gate.test.ts` (bowtie/`<3`-vertex → `BAD_REQUEST`, zero rows mutated; round-trip case byte-equal). Migration `0008_projects_render_exterior_key.sql` is a single additive `ALTER TABLE "projects" ADD COLUMN "render_exterior_key" text;` — `floors.poligono_svg` / `units.poligono_svg` untouched (zero migration for polygons, confirmed by reading the SQL file). **However:** `geometry.property.test.ts` (the artifact meant to *prove* this invariant via property-based testing) is flaky — see Gaps below. The underlying `validatePolygon` logic itself is correct (verified independently via the deterministic `geometry.test.ts` and the real-Postgres `hotspots-role-gate.test.ts`, both of which passed consistently across all reruns), but the property-test artifact does not reliably pass, which is itself a deliverable defect. |

**Score:** 4/4 functional truths verified · 1 artifact-level gap (flaky property test) found via independent re-execution, not trusted from SUMMARY.md claims.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0008_projects_render_exterior_key.sql` | Additive migration adding `projects.renderExteriorKey` | ✓ VERIFIED | Confirmed on disk: single `ALTER TABLE "projects" ADD COLUMN "render_exterior_key" text;`, no `poligono_svg` touch. Journal entry present (`idx: 8`, `when` bumped past 0007). |
| `packages/db/src/schema/projects.ts` (`renderExteriorKey`) | Nullable text column, documented | ✓ VERIFIED | Present, nullable, well-commented, no new `pgPolicy` added. |
| `packages/api/src/hotspots/geometry.ts` | Pure serialize/parse/validate module, zero imports | ✓ VERIFIED | `grep -E "^\s*import "` returns nothing — zero runtime imports. Exports `Point`, `serializePolygon`, `parsePolygon`, `validatePolygon`, `polygonErrorMessage`, `PolygonParseError`. Exported as `@imbau/api/geometry` (`package.json` `exports` map confirmed). |
| `packages/api/src/hotspots/geometry.test.ts` | Unit tests for the 4 validation reasons + round-trip | ✓ VERIFIED | Present, passed consistently in all 3 independent reruns. |
| `packages/api/src/hotspots/geometry.property.test.ts` | fast-check property tests | ⚠️ FLAKY | Present, but 2 of 3 independent reruns FAILED with a reproducible counterexample in the "convex always valid" property (see Gaps). |
| `packages/db/src/seed/renders.ts` | Idempotent seed fixture for renderExteriorKey + floor renders | ✓ VERIFIED | `isNull`-guarded UPDATEs, registered in `seed.ts` after `seedMedia`. Idempotency proven by `seed.idempotency.test.ts` (part of the 47-passed `@imbau/db` suite re-run during verification). |
| `packages/api/src/trpc/routers/hotspots.ts` | 5-procedure router (getForProject + set/clear × floor/unit) | ✓ VERIFIED | All 5 procedures present exactly as specified; `requireRole("owner","developer")` on all 4 writes; `protectedProcedure` on the read; imports only `withTenant, schema` from `@imbau/db` (fence check: `FENCE_OK`, no `createOwnerDb`/`appDb`/`createAppDb`). |
| `packages/api/tests/hotspots-role-gate.test.ts` | Cross-role + validation + round-trip + clear-not-delete matrix vs real Postgres | ✓ VERIFIED | 307-line test file; re-ran independently against real Docker Postgres — 205/205 tests passed (consistent across reruns). Matrix covers owner✓/developer✓/viewer→FORBIDDEN/cross-org→NOT_FOUND/non-existent→NOT_FOUND for both setFloorPolygon and setUnitPolygon, bowtie/<3-vertex BAD_REQUEST with zero mutation, round-trip, and clear-not-delete. |
| `packages/api/src/trpc/routers/_app.ts` | Registers `hotspots` router | ✓ VERIFIED | `import { hotspotsRouter } from "./hotspots"` + `hotspots: hotspotsRouter` in the router map. |
| `apps/panel/app/proyectos/[id]/hotspots/page.tsx` | RSC: verbatim guard spine + render-URL resolution + island wiring | ✓ VERIFIED | `await params → z.uuid() → notFound → resolveProject → notFound → canWrite` spine intact; builds `hotspots.getForProject` server-side caller; maps storage keys to URLs via `${env.R2_PUBLIC_BASE_URL}/${key}`; passes only serializable props (never a caller, never a raw key) to `<HotspotsEditor>` wrapped in `<TRPCReactProvider>`. |
| `apps/panel/app/proyectos/[id]/hotspots/hotspots-editor.tsx` | Hand-rolled SVG island | ✓ VERIFIED | 778-line client island. Inline SVG only — dependency check confirms no `konva`/`fabric`/`pixi` in `apps/panel/package.json`. All interaction contracts (target-first draw, vertex drag via pointer-capture, delete-vertex ≥3 guard, close-on-first-vertex/double-click, drill-down, always-visible selector rail, blocking validation banner, explicit save, delete confirm, 5 empty-states) present and match the UI-SPEC copy verbatim. |
| `apps/panel/env.ts` (`R2_PUBLIC_BASE_URL`) | Server-only env var | ✓ VERIFIED | `R2_PUBLIC_BASE_URL: z.string().url()` declared in the server block; no `NEXT_PUBLIC_*` leak. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `hotspots-editor.tsx` (`dataQuery`) | `useQuery(trpc.hotspots.getForProject...)` | `hotspots.ts` `getForProject` → real `withTenant` DB reads on `projects`/`floors`/`units` | Yes — real DB query, no static/empty stub return | ✓ FLOWING |
| `page.tsx` (`exteriorRenderUrl` / `floorRenderUrls`) | Server-side `caller.hotspots.getForProject` | Same withTenant DB read + `${R2_PUBLIC_BASE_URL}/${key}` mapping | Yes — resolves to real seeded R2 keys (confirmed working visually per human UAT) | ✓ FLOWING |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `hotspots-editor.tsx` | `hotspots` tRPC router | `useTRPC()` + `useQuery`/`useMutation` on `trpc.hotspots.*` | ✓ WIRED | Confirmed via `inferRouterOutputs<AppRouter>` typed usage; no drift, `typecheck` green. |
| `hotspots.ts` router | `@imbau/api/geometry` | `parsePolygon`/`validatePolygon`/`serializePolygon`/`polygonErrorMessage` imports, invoked inside `toCanonicalPolygon` before every write | ✓ WIRED | Server RE-validates; never trusts client `isValid`. Proven by the bowtie/too-few-vertex BAD_REQUEST tests. |
| `page.tsx` | `hotspots.getForProject` | Server-side `createCaller` | ✓ WIRED | Confirmed — real query, used to build render URL props. |
| `hotspots.ts` writes | `floors`/`units` tables | `withTenant` + `.where(id ∧ projectId)` + `.returning()` | ✓ WIRED | 0-row → `NOT_FOUND`; proven cross-org/non-existent cases in the role-gate matrix. |
| `_app.ts` | `hotspots.ts` | router registration | ✓ WIRED | Confirmed by grep + successful `typecheck`. |

### Behavioral Spot-Checks / Test Execution (independently re-run, not trusted from SUMMARY)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Geometry unit + property tests | `pnpm --filter @imbau/api test -- geometry` (3 independent runs) | Run 1: FAIL (convex-property counterexample) · Run 2: PASS (205/205) · Run 3: FAIL (same counterexample class) | ✗ FLAKY (see Gaps) |
| Hotspots role-gate matrix vs real Postgres | `pnpm --filter @imbau/api test -- hotspots-role-gate` | 205/205 tests passed | ✓ PASS |
| DB / RLS / seed-idempotency suite | `pnpm --filter @imbau/db test` | 47 passed / 4 skipped (R2-gated, expected) | ✓ PASS |
| API typecheck | `pnpm --filter @imbau/api typecheck` | Clean, no errors | ✓ PASS |
| Panel typecheck | `pnpm --filter @imbau/panel typecheck` | Clean, no errors | ✓ PASS |
| Panel lint | `pnpm --filter @imbau/panel lint` | Clean, no errors/warnings on hotspots files | ✓ PASS |
| API lint | `pnpm --filter @imbau/api lint` | 1 pre-existing error in `leads.ts:183` (Phase 11, logged in `deferred-items.md`, confirmed NOT touched by phase 12) | ✓ PASS (as documented; not phase-12 scope) |
| Elevated-pool fence | `grep -Eq "createOwnerDb\|appDb\|createAppDb" hotspots.ts` | No match | ✓ PASS (`FENCE_OK`) |
| Canvas/game-engine dependency check | `grep -iE "konva\|fabric\|pixi" apps/panel/package.json` | No match | ✓ PASS (`DEP_OK`) |
| Anti-pattern scan (TODO/FIXME/XXX/placeholder) | grep across the 5 new/modified phase-12 files | No matches (the 4 "placeholder" hits are all doc-comments describing the seed's *placeholder render* concept, not code stubs) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| HSPOT-01 | 12-02, 12-03 | Developer dibuja polígonos de pisos y los vincula a un piso | ✓ SATISFIED | `setFloorPolygon` + draw UI + role-gate test + human UAT |
| HSPOT-02 | 12-02, 12-03 | Developer dibuja polígonos de unidades y los vincula a una unidad | ✓ SATISFIED | `setUnitPolygon` + drill-down UI + role-gate test + human UAT |
| HSPOT-03 | 12-02, 12-03 | Developer edita y borra polígonos existentes | ✓ SATISFIED | vertex-drag/delete-vertex UI + `clearFloorPolygon`/`clearUnitPolygon` field-to-null (not row delete) + test proof |
| HSPOT-04 | 12-01, 12-02 | Polígonos en viewBox intrínseco, validados, consumibles por fase 2, cero migración | ✓ SATISFIED (functional) — with the geometry.property.test.ts flakiness noted as a quality gap | Migration 0008 additive-only; geometry module + server re-validation proven by deterministic tests; the flaky property test does not indicate a product defect but is an unmet acceptance criterion in its own right |

All 4 requirement IDs (HSPOT-01..04) declared in phase-12 PLAN frontmatter are accounted for and cross-referenced against `.planning/REQUIREMENTS.md` (all marked `[x]` / "Complete" in the traceability table, 19/19 v1.3 coverage). No orphaned requirements found for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/api/src/hotspots/geometry.property.test.ts` | 54 | `fc.pre(points.length >= 3)` guard insufficient — doesn't reject duplicate-point (rounding-collision) degenerate fixtures | 🛑 Blocker (test reliability) | Causes the property suite to intermittently fail `pnpm --filter @imbau/api test`, contradicting the plan's own "runs... green" acceptance criterion and risking spurious CI reds (CLAUDE.md: "CI roja = no se mergea" — an unreliable test is itself a CI-quality violation) |
| `packages/api/src/trpc/routers/leads.ts` | 183 | Pre-existing `@typescript-eslint/no-unnecessary-type-assertion` (Phase 11 debt) | ℹ️ Info | Confirmed NOT introduced by phase 12 (reproduces at pre-phase-12 HEAD `6cfa374`); logged in `deferred-items.md` by the executor with an explicit follow-up reference. Not counted as a phase-12 blocker per the debt-marker gate (referenced follow-up exists). |

No `TODO`/`FIXME`/`XXX`/`HACK` markers found in any phase-12-authored file. No stub returns, no hardcoded empty data flowing to render, no orphaned wiring.

### Human Verification (already completed — not re-requested)

The full draw → validate → save → persist happy path, drill-down, vertex-edit, delete (field-to-null), bowtie-blocked validation, empty-states, and read-only-viewer behavior were verified by the user in a real browser against the seeded R2 render and **approved** ("aprobado", 2026-07-25, 12-03-SUMMARY Task 3). This is treated as completed evidence per the phase's explicit context and is not re-requested here.

**Not independently instrumented (UI-SPEC "backstop" items, non-blocking, informational only):** the 4 backstop truths in 12-03's `must_haves` (long-label truncation in the 280px rail, non-square-render viewBox alignment, overlapping-polygon legibility over a photographic render, dense-vertex 24px-hit-target precision) were not each independently exercised at UAT per the 12-03-SUMMARY's own note ("not each independently instrumented — noted here for the verifier"). These are secondary visual-polish edge cases, not required for the core HSPOT-01..04 goal, and do not block this verification, but are recorded here for visibility should the seeded dataset later include a genuinely non-square render or a very long unit identifier.

### Gaps Summary

**✅ RESOLVED (2026-07-25, commit `865423e`):** the gap below was closed inline during phase execution — the property-test generator was deflaked (recentered circle so no clamp distortion + an independent shoelace-area precondition matching the module's exact `MIN_AREA_EPSILON` accept threshold) and re-verified **15/15 deterministic** across fresh fast-check seeds, with the full `@imbau/api` suite **205/205** and typecheck+lint clean. Original finding retained below for audit.

One gap found via independent re-execution (not by trusting SUMMARY.md's "green" claims): `packages/api/src/hotspots/geometry.property.test.ts`'s "a genuinely convex polygon always validates" property is flaky. Re-running `pnpm --filter @imbau/api test -- geometry` three times during this verification produced 2 failures and 1 pass, with a reproducible counterexample class (two adjacent generated vertices rounding to the identical integer coordinate, which `validatePolygon` correctly flags as `degenerate` — the test's own `fc.pre` guard doesn't filter this out). This does not indicate a defect in the shipped `validatePolygon` logic (proven correct and stable by the deterministic `geometry.test.ts` and the real-Postgres `hotspots-role-gate.test.ts`, both of which passed consistently across all reruns) — it is a defect confined to the property-test fixture generator. It is nonetheless a real, unmet acceptance criterion from Plan 12-01 Task 2 ("pnpm --filter @imbau/api test -- geometry runs both ... green") and a latent source of spurious CI failures. Recommended fix: strengthen the `fc.pre` guard in `convexPolygon` to also reject duplicate-point fixtures (not just length < 3), then re-verify determinism across several runs before considering this closed.

All 4 roadmap Success Criteria (HSPOT-01..04) and all 4 requirement IDs are otherwise functionally satisfied, with the underlying implementation, wiring, and server-side authorization/validation independently confirmed against the running codebase (not merely inferred from SUMMARY.md).

---

*Verified: 2026-07-25*
*Verifier: Claude (gsd-verifier)*
