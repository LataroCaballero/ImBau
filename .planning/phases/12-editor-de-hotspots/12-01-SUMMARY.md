---
phase: 12-editor-de-hotspots
plan: 01
subsystem: database
tags: [drizzle, postgres, rls, geometry, svg, polygon, fast-check, seed, hotspots]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: "floors.poligonoSvg / units.poligonoSvg (already exist — zero polygon migration), floors.renderKey, projects_anon_published policy, seedBuilding/seedMedia + deterministic mediaSeedId/originalKey"
  - phase: 10-d1-grilla-de-unidades
    provides: "pure I/O-free risk-module pattern (packages/api/src/excel/money-core.ts) reused as the geometry-module mold"
provides:
  - "projects.renderExteriorKey (nullable text) — the exterior building render's home; background for floor polygons; auto anon-readable via existing projects_anon_published"
  - "Versioned migration 0008_projects_render_exterior_key.sql (additive ADD COLUMN, no backfill; poligono_svg untouched)"
  - "Pure geometry module @imbau/api/geometry: Point, serializePolygon, parsePolygon, validatePolygon, polygonErrorMessage — the LOCKED serialize/parse + blocking-validation contract phase-2 and Plan 02 consume"
  - "seedRenders — idempotent fixture pointing renderExteriorKey + 3 floors.renderKey at resolvable seeded gallery keys so the draw-over-render happy path has a UAT background"
affects: [12-02-hotspots-router, 12-03-panel-editor, phase-2-explorador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, zero-import geometry module bundle-safe for the client (mirrors money-core.ts) — single source of truth for serialize/parse + validate; server re-validates through it"
    - "Additive nullable domain column on projects instead of a designated media row (keeps building→projects / floor→floors / unit→units symmetry; zero new pgPolicy)"
    - "isNull-guarded UPDATE seed step for safe re-run (never overwrites an operator's real key)"

key-files:
  created:
    - packages/db/migrations/0008_projects_render_exterior_key.sql
    - packages/db/src/seed/renders.ts
    - packages/api/src/hotspots/geometry.ts
    - packages/api/src/hotspots/geometry.test.ts
    - packages/api/src/hotspots/geometry.property.test.ts
  modified:
    - packages/db/src/schema/projects.ts
    - packages/db/seed.ts
    - packages/api/package.json
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "Persisted SVG format LOCKED: '\"x,y x,y …\"' space-separated integer pairs, viewBox 0–1000, min 3 pairs"
  - "Self-intersection is checked BEFORE the area/degenerate check because a classic bowtie has shoelace area 0 (would be mislabeled degenerate otherwise)"
  - "MIN_AREA_EPSILON = 1 viewBox² unit — sub-1u² triangles are sub-pixel/unusable; exactly-collinear (area 0) always caught"
  - "out_of_bounds reason also covers non-integer coordinates (defensive server-side; the editor's screen→viewBox transform clamps to [0,1000])"
  - "parsePolygon THROWS (PolygonParseError) on any non-integer/out-of-range/malformed token — the T-12-05 injection guard, never repairs or returns junk"

patterns-established:
  - "Pattern: geometry validation is blocking + typed + no-autocorrect (D-08); reason→es-AR message mapping lives in the same pure module"
  - "Pattern: intrinsic viewBox-0-1000 coordinates, never pixel-dependent (D-09) — the 'dinero entero nunca float' analog for geometry"

requirements-completed: [HSPOT-04]

coverage:
  - id: D1
    description: "projects.renderExteriorKey nullable text column shipped via versioned additive migration 0008 (poligono_svg untouched, zero new pgPolicy)"
    requirement: "HSPOT-04"
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/db db:migrate (applied clean) + information_schema shows render_exterior_key text nullable"
        status: pass
      - kind: integration
        ref: "packages/db test suite (47 passed / 4 R2-skipped) — RLS/tenant suite green with additive column"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pure @imbau/api/geometry module: serialize/parse (locked integer viewBox format, injection-guarded) + blocking no-autocorrect validatePolygon with 4 typed reasons + es-AR messages"
    requirement: "HSPOT-04"
    verification:
      - kind: unit
        ref: "packages/api/src/hotspots/geometry.test.ts (serialize/parse round-trip, malformed rejection, 4 reasons, es-AR strings)"
        status: pass
      - kind: unit
        ref: "packages/api/src/hotspots/geometry.property.test.ts (fast-check: round-trip, convex always valid, bowtie always self_intersecting)"
        status: pass
      - kind: other
        ref: "grep -E '^\\s*import ' packages/api/src/hotspots/geometry.ts → zero imports (bundle-safe); tsc --noEmit passes, no any"
        status: pass
    human_judgment: false
  - id: D3
    description: "seedRenders idempotent fixture: sets renderExteriorKey + 3 floors.renderKey to resolvable seeded gallery originalKeys for the UAT happy-path background"
    requirement: "HSPOT-04"
    verification:
      - kind: integration
        ref: "packages/db seed.idempotency.test.ts (runSeed twice, row-invariance) green with seedRenders registered"
        status: pass
      - kind: manual_procedural
        ref: "Visual: draw-over-render happy path with a resolvable R2 background at UAT"
        status: unknown
    human_judgment: true
    rationale: "Whether ${R2_PUBLIC_BASE_URL}/${originalKey} actually serves the placeholder image as an editor background is only observable against real R2 at UAT (the automated gate runs skipMedia and asserts only DB row invariance)."

# Metrics
duration: 20min
completed: 2026-07-24
status: complete
---

# Phase 12 Plan 01: Hotspot editor back-end foundation Summary

**Additive `projects.renderExteriorKey` (migration 0008) plus a pure, zero-import `@imbau/api/geometry` module (locked `"x,y x,y …"` viewBox-0-1000 serialize/parse + blocking no-autocorrect validation) and an idempotent seed render fixture.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-24T23:11:56-03:00
- **Completed:** 2026-07-24T23:16:37-03:00 (code); docs after
- **Tasks:** 2
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- Resolved the one open schema question: the building's exterior render lives in a new nullable `projects.renderExteriorKey` text column — the exact peer of `floors.renderKey` / `units.planoKey`, shipped as versioned additive migration `0008` (no backfill, `poligono_svg` untouched, zero new pgPolicy; anon-readable for `publicado` via the existing table-level policy).
- Built the pure, dependency-free `@imbau/api/geometry` module: the LOCKED `"x,y x,y …"` integer viewBox-0-1000 serialize/parse contract (single source of truth for panel-write and phase-2-read) and blocking, no-autocorrect `validatePolygon` with four typed reasons (`too_few_points` / `out_of_bounds` / `self_intersecting` / `degenerate`) + es-AR voseo messages. Unit + fast-check property tested; zero runtime imports (bundle-safe like `money-core.ts`).
- Extended the seed with an idempotent `seedRenders` step so the draw-over-render happy path has a resolvable background at UAT.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add projects.renderExteriorKey via migration 0008 + seed render fixture** — `fc7b6cc` (feat)
2. **Task 2 (TDD RED): failing geometry tests** — `1d49846` (test)
3. **Task 2 (TDD GREEN): pure geometry module** — `00aa13f` (feat)

_No REFACTOR commit — the GREEN implementation was clean._

## Files Created/Modified
- `packages/db/src/schema/projects.ts` — added nullable `renderExteriorKey` text column (documented peer-of-renderKey rationale)
- `packages/db/migrations/0008_projects_render_exterior_key.sql` — additive `ADD COLUMN "render_exterior_key" text`
- `packages/db/migrations/meta/_journal.json` — entry 8 (renamed tag + bumped `when` past 0007)
- `packages/db/src/seed/renders.ts` — idempotent `seedRenders(orgId, projectId)` fixture
- `packages/db/seed.ts` — registered `seedRenders` after `seedMedia`
- `packages/api/src/hotspots/geometry.ts` — pure geometry module
- `packages/api/src/hotspots/geometry.test.ts` — unit tests
- `packages/api/src/hotspots/geometry.property.test.ts` — fast-check property tests
- `packages/api/package.json` — added `"./geometry"` export entry

## Decisions Made
- **Persisted format LOCKED:** `"x,y x,y …"` space-separated integer pairs, viewBox `0 0 1000 1000`, min 3 pairs — directly usable as `<polygon points>` in editor and phase-2 explorer.
- **Validation order matters:** self-intersection is checked before the degenerate/area check because a classic bowtie has shoelace area 0 and would otherwise be mislabeled `degenerate`.
- **`MIN_AREA_EPSILON = 1`** viewBox² unit; **`out_of_bounds`** also flags non-integer coordinates; **`parsePolygon` throws** on any malformed token (T-12-05 injection guard).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bumped migration 0008 journal `when` timestamp past 0007**
- **Found during:** Task 1 (apply migration 0008)
- **Issue:** `drizzle-kit generate` auto-assigned 0008 a `when` of `1784945381551`, which is LESS than 0007's hand-set `when` of `1785000000000`. Drizzle's migrator applies journal entries whose `when` is greater than the last-recorded migration's timestamp, so it silently SKIPPED 0008 as "already applied" — `migrate` reported success but the column never got created (verified absent via `information_schema`).
- **Fix:** Set 0008's journal `when` to `1785100000000` (clearly greater than 0007). Re-ran `db:migrate`; the column now exists (`render_exterior_key | text | YES`).
- **Files modified:** `packages/db/migrations/meta/_journal.json`
- **Verification:** `information_schema.columns` shows `render_exterior_key text nullable`; `@imbau/db` suite green.
- **Committed in:** `fc7b6cc` (Task 1 commit)

**2. [Rule 3 - Blocking] seedRenders signature is `(orgId, projectId)` not `(orgId)`**
- **Found during:** Task 1 (create seedRenders)
- **Issue:** The plan's prose named the export `seedRenders(orgId)`, but building the resolvable `originalKey` and scoping the floor UPDATEs both require `projectId`, which `seed.ts` already has in scope at the call site.
- **Fix:** Implemented `seedRenders(orgId, projectId)` and registered it accordingly.
- **Files modified:** `packages/db/src/seed/renders.ts`, `packages/db/seed.ts`
- **Verification:** seed idempotency test green; typecheck passes.
- **Committed in:** `fc7b6cc` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Both necessary for the migration to actually apply and the seed to compile. No scope creep — no new tables, no polygon migration, no new packages.

## Issues Encountered
- One local psql check initially looked at a stale column list; resolved by re-querying `information_schema` after the `when`-fix migration re-ran (see Deviation 1). No data-loss risk (additive nullable column).

## Deferred Issues
- **Pre-existing lint error in `packages/api/src/trpc/routers/leads.ts:183`** (`@typescript-eslint/no-unnecessary-type-assertion`) — from Phase 11, untouched by this plan, reproduces at pre-phase-12 HEAD. Out of scope; logged to `.planning/phases/12-editor-de-hotspots/deferred-items.md`. Repo-wide `@imbau/api lint` is red because of it; my new `hotspots/*` files lint clean in isolation. Note for Plan 12-02/03: this will fail the CI `quality` gate until fixed.

## User Setup Required
None - no external service configuration required. (The seed's placeholder render keys resolve only under real R2 at UAT; no new env.)

## Next Phase Readiness
- **Plan 12-02** can now build the `hotspots` tRPC router: it re-serializes through `serializePolygon`/`parsePolygon` and re-validates through `validatePolygon` (import from `@imbau/api/geometry`), writing `floors.poligonoSvg` / `units.poligonoSvg`, and reads `projects.renderExteriorKey` for the editor background.
- **Plan 12-03** panel island can import the same pure module client-side to pre-validate before "Guardar".
- Contract is LOCKED and documented for the future phase-2 explorer.

## Self-Check: PASSED

All 5 created files present on disk; all 3 task commits (`fc7b6cc`, `1d49846`, `00aa13f`) present in git history.

---
*Phase: 12-editor-de-hotspots*
*Completed: 2026-07-24*
