---
phase: 01-schema-completo-rls
plan: 03
subsystem: database
tags: [postgres, drizzle, rls, multi-tenancy, drizzle-zod, jsonb, partitioning]

# Dependency graph
requires:
  - phase: 01-01
    provides: "projects.ts RLS clone template, enums.ts (lead_estado/galeria_seccion), json-schemas.ts (LeadNote), roles.ts (app_authenticated/anon), units.ts composite-FK pattern"
provides:
  - "brokers table — tenant clone with composite FK to projects + anon-published SELECT policy"
  - "leads table — tenant clone PLUS anon INSERT-only policy (withCheck publicado, no using, no SELECT), typed timeline jsonb, leadInsertSchema validator"
  - "progress_posts / galleries / media content tables — tenant clones with anon-published SELECT"
  - "media R2 columns: original_key + typed variants jsonb + width/height/blurhash"
  - "events table TYPES-ONLY declaration (FLAG-A/B) + eventInsertSchema; partition/RLS DDL deferred to 01-04"
affects: [01-04, 01-05, 01-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "anon INSERT-only RLS policy (for:insert, withCheck EXISTS publicado, NO using, NO anon SELECT) for public-write tables"
    - "partitioned-table TYPES-ONLY pgTable: declared for $inferInsert/Zod, excluded from drizzle.config, DDL hand-written (mirrors .existing() role pattern)"
    - "nullable in-tenant composite FK pointers (MATCH SIMPLE skips check when pointer is NULL)"

key-files:
  created:
    - packages/db/src/schema/brokers.ts
    - packages/db/src/schema/leads.ts
    - packages/db/src/schema/progress-posts.ts
    - packages/db/src/schema/galleries.ts
    - packages/db/src/schema/media.ts
    - packages/db/src/schema/events.ts
  modified: []

key-decisions:
  - "leads quote_id is a plain nullable uuid with NO .references() — breaks the leads↔quotes reference cycle; real FK lands in 01-04 hand SQL"
  - "leads unit_id/broker_id are nullable composite FKs with onDelete set null (in-tenant pointers, MATCH SIMPLE)"
  - "events declared TYPES-ONLY: id NOT .primaryKey() (FLAG-A real PK (id,ts) hand-written), no pgPolicy/enableRLS/foreignKey (FLAG-B), kept out of drizzle.config"
  - "events unit_id/broker_id are plain nullable analytics pointers with no FK (write-light high-volume table)"

patterns-established:
  - "anon INSERT-only policy: pgPolicy(for:insert, to:anonRole, withCheck EXISTS publicado) with no using clause and no anon SELECT grant"
  - "TYPES-ONLY partitioned-table declaration excluded from drizzle.config to avoid CREATE TABLE collision with hand-written PARTITION BY"

requirements-completed: [SCHEMA-04, SCHEMA-05, SCHEMA-06]

coverage:
  - id: D1
    description: "brokers + leads schema (SCHEMA-04): brokers tenant clone; leads tenant clone PLUS anon INSERT-only publicado-gated policy, typed timeline jsonb, leadInsertSchema"
    requirement: "SCHEMA-04"
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/db typecheck (exit 0)"
        status: pass
      - kind: other
        ref: "pnpm --filter @imbau/db lint (exit 0)"
        status: pass
    human_judgment: true
    rationale: "Live RLS behavior (anon INSERT allowed vs publicado / rejected 42501 vs borrador, anon never SELECTs leads) requires the hand migration (01-04) + real Postgres; asserted in 01-06. Static typecheck/lint cannot prove the policy enforces at runtime."
  - id: D2
    description: "progress_posts + galleries + media content tables (SCHEMA-05): tenant clones with anon-published SELECT; media carries R2 original_key + typed variants + dims + blurhash"
    requirement: "SCHEMA-05"
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/db typecheck (exit 0)"
        status: pass
      - kind: other
        ref: "pnpm --filter @imbau/db lint (exit 0)"
        status: pass
    human_judgment: true
    rationale: "anon-published visibility gating across these content tables is enforced by RLS at runtime; verified against real Postgres in 01-06 after the hand migration applies grants + FORCE RLS."
  - id: D3
    description: "events TYPES-ONLY declaration (SCHEMA-06, FLAG-A/B): pgTable for types + eventInsertSchema; id NOT primaryKey; no pgPolicy/enableRLS/foreignKey; excluded from drizzle.config"
    requirement: "SCHEMA-06"
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/db typecheck (exit 0)"
        status: pass
      - kind: other
        ref: "events.ts code-only grep: no .primaryKey/pgPolicy/enableRLS/foreignKey in real code"
        status: pass
    human_judgment: true
    rationale: "The events partition DDL + both policies are hand-written in 01-04; partition routing/isolation and the absence of anon SELECT are asserted in 01-06 against real Postgres."

# Metrics
duration: 5min
completed: 2026-06-27
status: complete
---

# Phase 01 Plan 03: Content + Capture Domain + events Types-Only Summary

**Capture + content schema for SCHEMA-04/05/06: brokers, anon-INSERT-only leads with typed timeline JSONB, progress_posts/galleries/media content clones with R2 media columns, and an events partitioned-table TYPES-ONLY declaration (FLAG-A/B) — all RLS-as-code clones of the v1.0 projects.ts template.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-27T20:12:46Z
- **Completed:** 2026-06-27T20:17:10Z
- **Tasks:** 3
- **Files modified:** 6 created

## Accomplishments
- `leads` implements the public-write capture path: a `leads_anon_insert` policy (`for:"insert"`, `withCheck` EXISTS publicado, NO `using`, NO anon SELECT) plus a `leads_tenant` policy for the panel, a typed `timeline jsonb $type<LeadNote[]>`, and a co-located `leadInsertSchema` (drizzle-zod) for the future anon boundary.
- `brokers` is a standard tenant catalog clone (composite FK to projects, anon-published SELECT, UNIQUE(id, org) so leads can composite-FK it).
- `progress_posts`, `galleries`, `media` are content clones; `galleries.seccion` uses the `galeria_seccion` enum; `media` carries `original_key` + typed `variants` jsonb + `width`/`height`/`blurhash` for the Fase-2 pipeline.
- `events` is a correct FLAG-A/B types-only declaration: `pgTable` for `$inferInsert`/`$inferSelect` + `eventInsertSchema`, `id` WITHOUT `.primaryKey()`, no `pgPolicy`/`.enableRLS()`/`foreignKey`, excluded from `drizzle.config.ts` — all its DDL deferred to the 01-04 hand migration.

## Task Commits

Each task was committed atomically:

1. **Task 1: brokers + leads (anon INSERT-only, timeline JSONB) — SCHEMA-04** - `d6cf8e0` (feat)
2. **Task 2: progress_posts + galleries + media — SCHEMA-05** - `047f310` (feat)
3. **Task 3: events.ts — partitioned table TYPES ONLY (FLAG-A/B) — SCHEMA-06** - `c2e06c1` (feat)

_Note: Tasks are marked `tdd="true"`, but the behavioral RLS tests for these tables require the hand migration (01-04) + real Postgres and are deferred to the cross-tenant suite extension in 01-06 (per the plan's own verification block + D-16). This plan's verification is `typecheck` + `lint` + the structural acceptance criteria, all green._

## Files Created/Modified
- `packages/db/src/schema/brokers.ts` - tenant catalog clone; composite FK → projects; tenant + anon-published policies; UNIQUE(id, org)
- `packages/db/src/schema/leads.ts` - tenant clone + `leads_anon_insert` policy; typed `timeline` jsonb; nullable composite FKs to units/brokers; plain `quote_id` (cycle break); `leadInsertSchema`
- `packages/db/src/schema/progress-posts.ts` - content clone; `fecha`/`titulo`/`cuerpo` + plain `media_id` pointer (no FK)
- `packages/db/src/schema/galleries.ts` - content clone; `seccion` (galeria_seccion enum); `imagenes`/`pano360s` typed jsonb string[]
- `packages/db/src/schema/media.ts` - asset table; `original_key` + typed `variants` jsonb + `width`/`height`/`blurhash`; UNIQUE(id, org)
- `packages/db/src/schema/events.ts` - TYPES-ONLY partitioned-table declaration + `eventInsertSchema` (FLAG-A/B)

## Decisions Made
- **leads.quote_id has NO Drizzle `.references()`** — breaks the leads↔quotes reference cycle (quotes.lead_id references leads). The real FK is hand-written in 01-04. Followed the plan's explicit instruction.
- **leads nullable composite FKs use `onDelete("set null")`** — unit_id/broker_id are optional in-tenant pointers; MATCH SIMPLE skips the FK check when the pointer is NULL, and set-null avoids cascading lead deletion when an optional unit/broker is removed.
- **events declared types-only, excluded from drizzle.config** — `id` is `notNull().defaultRandom()` WITHOUT `.primaryKey()` (FLAG-A), and the module declares no `pgPolicy`/`.enableRLS()`/`foreignKey` (FLAG-B). All events DDL (partition, composite PK, FK, grants, FORCE RLS, both policies) is hand-written in 01-04.

## Deviations from Plan

None - plan executed exactly as written.

The plan referenced `01-PATTERNS.md`, which does not exist in the phase directory (the phase has `01-RESEARCH.md`, `01-CONTEXT.md`, `01-VALIDATION.md`, `01-DISCUSSION-LOG.md`). The equivalent guidance (Pattern 3 anon INSERT-only policy, FLAG-A/B, leads/galleries/media deltas, the `createInsertSchema` JSONB-refinement pattern) was sourced from `01-RESEARCH.md` and the already-merged 01-01 schema files (`projects.ts`, `units.ts`, `floors.ts`, `member-rls.ts`). No behavioral change; not a code deviation.

## Issues Encountered
- The worktree shell defaulted to Node 20 (pnpm fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`); switched to Node 22 LTS via nvm before running pnpm. Project requires Node 22 (CLAUDE.md / `.nvmrc`).
- `node_modules` was absent in the fresh worktree; `pnpm --filter @imbau/db` triggered a one-time `pnpm install` (lockfile up to date, no resolution changes).

## Known Stubs
None. `media.variants`/`blurhash` and `progress_posts.media_id` are intentionally empty-default columns the Fase-2 media pipeline will populate — this is the documented schema-ahead-of-pipeline design (SCHEMA-05), not a stub blocking this plan's goal.

## Next Phase Readiness
- **01-04 (hand migration)** consumes: the `events` types-only declaration (must hand-write its `CREATE TABLE ... PARTITION BY RANGE (ts)`, PK `(id, ts)`, composite FK → projects, GRANTs, FORCE RLS, and both policies), the leads `quote_id` FK (cycle-break completion), and FORCE RLS + anon INSERT grants on `leads`/`events`. It must also exclude `events.ts` from `drizzle.config.ts` while registering the other 5 tables.
- **01-06 (verification)** consumes: the cross-tenant suite must extend to brokers/leads/progress_posts/galleries/media (absence assertions) plus the leads/events anon-insert-allowed-vs-publicado / rejected-vs-borrador / no-SELECT cases (D-16).
- No blockers. `typecheck` + `lint` green for `@imbau/db`.

## Self-Check: PASSED

All 6 schema files exist on disk; all 3 task commits (`d6cf8e0`, `047f310`, `c2e06c1`) present in git history. `typecheck` + `lint` green for `@imbau/db`.

---
*Phase: 01-schema-completo-rls*
*Completed: 2026-06-27*
