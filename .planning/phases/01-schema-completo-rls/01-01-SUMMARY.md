---
phase: 01-schema-completo-rls
plan: 01
subsystem: database
tags: [drizzle, postgres, rls, multi-tenant, zod, drizzle-zod, pgenum, jsonb]

# Dependency graph
requires:
  - phase: 00-foundation (auth + multitenancy + RLS)
    provides: projects.ts RLS template, roles.ts (app_authenticated/anon stubs), with-tenant GUC, single migration journal
provides:
  - 5 domain pgEnums (unidad_estado, lead_estado, galeria_seccion, ajuste_tipo, moneda)
  - typed-JSONB Zod contracts (refuerzoSchema/Refuerzo, leadNoteSchema/LeadNote, quoteSnapshotSchema/QuoteSnapshot versioned envelope)
  - drizzle-zod@0.8.3 in @imbau/db for boundary validation
  - projects UNIQUE(id, organization_id) so child tables can composite-FK the parent
  - floors + units catálogo tables (SCHEMA-01) as faithful RLS clones with composite-FK org-pinning and anon-published EXISTS
affects: [01-02 (pricing tables import enums + projects UNIQUE), 01-03 (content tables import enums), 01-04 (migration generation + hand SQL), 01-06 (isolation suite fixtures)]

# Tech tracking
tech-stack:
  added: [drizzle-zod@0.8.3]
  patterns: [denormalized organization_id flat tenant policy clone, composite FK (fk, organization_id) -> parent (id, organization_id) for structural org-pinning, single-level EXISTS anon-published child policy, versioned JSONB envelope { version: 1 } passthrough]

key-files:
  created:
    - packages/db/src/schema/enums.ts
    - packages/db/src/schema/json-schemas.ts
    - packages/db/src/schema/floors.ts
    - packages/db/src/schema/units.ts
  modified:
    - packages/db/package.json
    - packages/db/src/schema/projects.ts
    - pnpm-lock.yaml

key-decisions:
  - "lead_estado enum value is ASCII negociacion (no accent); UI renders the accented label (D-15 / A4)"
  - "QuoteSnapshot envelope fixed to { version: 1 } with .passthrough() so the Fase-3 calc shape evolves without a migration (D-13)"
  - "units gets DUAL composite FK (project_id + floor_id, each paired with organization_id) so cross-tenant inserts are structurally impossible (D-02)"
  - "Refuerzo money fields (cuota, montoUsd) are integers, never float (D-14)"

patterns-established:
  - "Pattern 1: catálogo table = flat clone of projects.ts (denormalized organization_id text, ::text GUC tenant policy, .enableRLS())"
  - "Pattern 2: composite FK org-pinning requires parent UNIQUE(id, organization_id) (D-02 / Pitfall 7)"
  - "Pattern 3: anon-published child policy = single-level EXISTS against projects.estado='publicado' (FLAG-D)"

requirements-completed: [SCHEMA-01]

coverage:
  - id: D1
    description: "5 domain pgEnums (unidad_estado, lead_estado, galeria_seccion, ajuste_tipo, moneda) with Spanish data values / English identifiers"
    requirement: "SCHEMA-01"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/db typecheck (tsc --noEmit, exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Typed-JSONB Zod contracts (Refuerzo, LeadNote, QuoteSnapshot versioned envelope) exist and are importable; integer money fields; { version:1 } passthrough envelope"
    requirement: "SCHEMA-01"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/db typecheck + lint (exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "projects carries unique().on(id, organizationId) so child tables can composite-FK it"
    requirement: "SCHEMA-01"
    verification:
      - kind: unit
        ref: "packages/db/src/schema/projects.ts contains unique().on(t.id, t.organizationId); typecheck exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "floors + units catálogo tables (SCHEMA-01) as faithful RLS clones: tenant + anon-published policies, composite FK org-pinning, .enableRLS()"
    requirement: "SCHEMA-01"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/db typecheck (composite-FK targets resolve, exit 0)"
        status: pass
      - kind: integration
        ref: "packages/db/tests/cross-tenant.test.ts (RLS isolation + anon-published behavior — DEFERRED to plan 01-06 against real Postgres 16)"
        status: unknown
    human_judgment: false
  - id: D5
    description: "drizzle-zod@0.8.3 added to @imbau/db for boundary validation"
    requirement: "SCHEMA-01"
    verification:
      - kind: unit
        ref: "packages/db/package.json dependencies include drizzle-zod@0.8.3; pnpm install lockfile verified"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-06-27
status: complete
---

# Phase 01 Plan 01: Foundation + Catálogo (floors + units) Summary

**Phase-wide schema foundation — 5 domain pgEnums, typed-JSONB Zod envelopes, drizzle-zod, projects parent UNIQUE — plus floors + units authored as faithful clones of the v1.0 projects.ts RLS template (SCHEMA-01).**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-27T20:03:48Z
- **Completed:** 2026-06-27T20:06:57Z
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- Authored `enums.ts` with the 5 domain pgEnums (Spanish DATA values, English identifiers), reusing the existing `estado` enum rather than redeclaring it.
- Authored `json-schemas.ts` with the three typed-JSONB contracts: `Refuerzo` (integer money), `LeadNote`, and the `QuoteSnapshot` `{ version: 1 }` passthrough envelope whose interior stays open for Fase 3.
- Added `drizzle-zod@0.8.3` to `@imbau/db` (peer-compatible with the pinned `drizzle-orm@0.45.2` + `zod@4.4.3`), lockfile updated.
- Added `unique().on(id, organizationId)` to `projects` so every child table can composite-FK the parent pair (D-02 / Pitfall 7).
- Authored `floors.ts` and `units.ts` (SCHEMA-01) as flat clones of `projects.ts`: denormalized `organization_id` (TEXT), `::text` GUC tenant policy, single-level EXISTS anon-published policy, composite-FK org-pinning, `.enableRLS()`. `units` carries a dual composite FK (project + floor) so cross-tenant inserts are structurally impossible.

## Task Commits

Each task was committed atomically:

1. **Task 1: Foundation — enums, typed-JSONB Zod contracts, drizzle-zod dep, projects UNIQUE** - `79c31ad` (feat)
2. **Task 2: Catálogo — floors + units (SCHEMA-01)** - `8040857` (feat)

_Note: tasks were marked tdd="true", but the plan's `<verify>` binds verification to typecheck + lint and both `<done>` notes explicitly defer behavior proof to the migrate-from-zero gate (01-04) and the cross-tenant isolation suite (01-06). The vitest globalSetup migrates a live Postgres DB, which is outside this wave's scope; no behavior test file was added here per the plan's deferral._

## Files Created/Modified
- `packages/db/src/schema/enums.ts` - 5 domain pgEnums (unidad_estado, lead_estado, galeria_seccion, ajuste_tipo, moneda)
- `packages/db/src/schema/json-schemas.ts` - Zod contracts + inferred types for the JSONB columns (Refuerzo, LeadNote, QuoteSnapshot)
- `packages/db/src/schema/floors.ts` - floors catálogo table + RLS (tenant + anon-published), composite FK, parent UNIQUE
- `packages/db/src/schema/units.ts` - units catálogo table + RLS, dual composite FK, unidad_estado enum
- `packages/db/package.json` - added drizzle-zod@0.8.3 dependency
- `packages/db/src/schema/projects.ts` - additive unique().on(id, organizationId) for child composite FKs
- `pnpm-lock.yaml` - lockfile entry for drizzle-zod

## Decisions Made
- Followed plan as specified. Resolved-decision details applied verbatim: ASCII `negociacion` for `lead_estado`; `{ version: 1 }` passthrough envelope for `QuoteSnapshot`; integer money in `Refuerzo`; dual composite FK on `units`.
- Did NOT register the new modules in `index.ts` / `drizzle.config.ts` — the plan explicitly assigns that to plan 01-04. `tsc` still type-checks them via the `src` include, so the verification gate holds.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Both tasks passed `pnpm --filter @imbau/db typecheck` and `pnpm --filter @imbau/db lint` clean on the first run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The shared foundation (enums, JSONB Zod contracts, `projects` UNIQUE, drizzle-zod) is in place for the parallel wave-2 plans 01-02 (pricing) and 01-03 (content), which import these.
- `floors` + `units` compile as faithful RLS clones; behavior (RLS isolation, anon-published) is proven downstream by the migrate-from-zero gate (01-04) and the cross-tenant isolation suite (01-06).
- Not yet wired into `index.ts` / `drizzle.config.ts` (by design — plan 01-04 registers all new tables and generates the migration).

## Self-Check: PASSED

- All 4 created schema files + SUMMARY.md verified present on disk.
- Both task commits (79c31ad, 8040857) verified in git log.

---
*Phase: 01-schema-completo-rls*
*Completed: 2026-06-27*
