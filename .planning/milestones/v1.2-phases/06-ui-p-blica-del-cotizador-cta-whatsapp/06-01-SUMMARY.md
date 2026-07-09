---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 01
subsystem: database
tags: [drizzle, migration, postgres, rls, seed, whatsapp]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: projects table with RLS (projects_tenant + projects_anon_published) and the idempotent "Brigos Recoleta" seed
provides:
  - projects.whatsapp nullable text column (per-project default WhatsApp CTA number, WA-01 slot)
  - versioned migration 0004_project_whatsapp.sql (additive ADD COLUMN, drizzle-kit generated)
  - seeded Brigos Recoleta project carrying a WhatsApp number so demo/staging always render the CTA
affects: [whatsapp-cta, cotizador-ui, wa-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive nullable column exposed to anon via the EXISTING table-level SELECT policy — no new pgPolicy"
    - "drizzle-kit generate → rename to descriptive tag + sync meta/_journal.json → migrate (versioned, never hand-edited SQL)"

key-files:
  created:
    - packages/db/migrations/0004_project_whatsapp.sql
    - packages/db/migrations/meta/0004_snapshot.json
  modified:
    - packages/db/src/schema/projects.ts
    - packages/db/migrations/meta/_journal.json
    - packages/db/seed.ts

key-decisions:
  - "whatsapp literal inlined in seed.ts (not sourced from BUILDING.project) to satisfy the plan verify grep and keep the D-01 comment at the insert site"
  - "Seed idempotency proven via runSeed({skipMedia:true}) run twice — the media pipeline (live R2 + worker) is orthogonal to the project-row/whatsapp acceptance criteria and gated to live UAT"

patterns-established:
  - "Public-but-tenant-published columns ride the existing projects_anon_published SELECT policy (only publicado rows reach anon); no per-column policy"

requirements-completed: [WA-01]

coverage:
  - id: D1
    description: "projects.whatsapp nullable text column exists, is anon-readable via the existing published-only policy (no new pgPolicy), and the 0004 additive migration is generated and applied to the DB"
    requirement: WA-01
    verification:
      - kind: integration
        ref: "docker psql: SELECT column_name,is_nullable,data_type FROM information_schema.columns WHERE table_name='projects' AND column_name='whatsapp' → whatsapp|YES|text"
        status: pass
      - kind: other
        ref: "grep -c 'pgPolicy(' packages/db/src/schema/projects.ts → 2 (unchanged)"
        status: pass
      - kind: other
        ref: "pnpm --filter @imbau/db typecheck → exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Seeded Brigos Recoleta project carries a WhatsApp number and re-running the seed is idempotent (exactly one row, whatsapp set, no duplicates)"
    requirement: WA-01
    verification:
      - kind: integration
        ref: "runSeed({skipMedia:true}) run twice → projects=1, whatsapp='+5491155551234' after both runs (no duplicate rows); seed exit 0"
        status: pass
    human_judgment: false

# Metrics
duration: ~15min
completed: 2026-07-05
status: complete
---

# Phase 6 Plan 01: projects.whatsapp column + seed Summary

**Added a nullable `projects.whatsapp` column via additive migration 0004 (anon-readable through the existing published-only policy, no new pgPolicy) and seeded "Brigos Recoleta" with a WhatsApp number so the WA-01 CTA never renders as a dead button.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-05T02:22Z (approx)
- **Completed:** 2026-07-05T02:37Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `projects.whatsapp` nullable `text` column added to the schema and applied to the dev DB as a versioned, drizzle-kit-generated additive migration (`0004_project_whatsapp.sql`) — no hand-edited SQL.
- No RLS change: the existing `projects_anon_published` (table-level SELECT to `anonRole`) already exposes the new column to anon; `pgPolicy(` count stays at exactly 2.
- Seeded Brigos Recoleta project now carries `whatsapp: "+5491155551234"` (D-01/D-02); proven idempotent by running the seed twice — exactly one project row, whatsapp set, zero duplicates.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add projects.whatsapp column, generate migration, apply it** - `d6acd89` (feat)
2. **Task 2: Seed Brigos Recoleta with a WhatsApp number (idempotent)** - `8a2b023` (feat)

## Files Created/Modified
- `packages/db/src/schema/projects.ts` - Added `whatsapp: text("whatsapp")` nullable column after `estado`, with a comment marking it the WA-01 CTA slot; no policy change.
- `packages/db/migrations/0004_project_whatsapp.sql` - Additive `ALTER TABLE "projects" ADD COLUMN "whatsapp" text;` (drizzle-kit generated, renamed from the random suffix `0004_sour_red_ghost`).
- `packages/db/migrations/meta/_journal.json` - 0004 entry tag updated to `0004_project_whatsapp` to match the renamed SQL file.
- `packages/db/migrations/meta/0004_snapshot.json` - drizzle-kit schema snapshot for migration 0004.
- `packages/db/seed.ts` - Added `whatsapp: "+5491155551234"` to the publicado project `.values({...})`, `onConflictDoNothing()` preserved.

## Migration filename note
drizzle-kit generated the migration as `0004_sour_red_ghost.sql`. It was renamed to the plan-specified `0004_project_whatsapp.sql`, and the corresponding `meta/_journal.json` entry `tag` was updated to `0004_project_whatsapp` so the migrator resolves the file correctly. The idx-keyed snapshot file (`0004_snapshot.json`) needs no rename.

## Decisions Made
- **whatsapp literal inlined in seed.ts** rather than sourced from `BUILDING.project`: the plan's verify grep (`grep -q 'whatsapp: "+549' seed.ts`) requires the literal at the insert site, and it keeps the D-01 rationale comment where the value is used. Reused the same digits format as the broker seed (`+5491155551234`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Seed idempotency verified with `skipMedia:true` instead of the full `pnpm db:seed`**
- **Found during:** Task 2 (seed idempotency proof)
- **Issue:** The full `pnpm db:seed` CLI fail-fasts requiring live R2 credentials (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL`) reachable via HeadBucket **and** an actively-consuming `apps/worker` to process the queued media jobs. Those R2 creds live in SOPS (`staging.enc.yaml`, decrypt needs `SOPS_AGE_KEY_FILE`) and the media pipeline is a live-infra UAT concern — it does not touch the projects row or the whatsapp column.
- **Fix:** Ran the seed twice via a temporary `runSeed({ skipMedia: true })` runner (the seed's own `RunSeedOptions.skipMedia` path, designed exactly for DB-only runs), which drops the media env requirements and R2/Redis probes. This exercises the real `withTenant` RLS write path for the project insert — the exact acceptance criteria of this plan.
- **Files modified:** None committed (temporary runner `_seed_run_tmp.mts` created, used, and deleted; never staged).
- **Verification:** Run 1 → `projects=1, whatsapp=+5491155551234`. Run 2 → still `projects=1`, whatsapp unchanged, no duplicate rows. Seed process exit code 0; downstream rows fully seeded (floors=13, units=38, brokers=3), confirming a complete (not partial) run.
- **Committed in:** N/A (verification step only; the seed.ts change is in `8a2b023`).

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep. The `skipMedia` path proves the plan's actual must-haves (project row carries whatsapp; re-seed is idempotent). Full-media re-seed with live R2 remains a phase-level live UAT item (consistent with PROJECT.md's Phase 2/3 live-R2-is-human-UAT decisions).

## Issues Encountered
- `pnpm`/corepack fails under the shell's default Node 20 (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). Resolved by switching to Node 22 via nvm (`nvm use 22`) for all pnpm/drizzle-kit/tsx invocations — matches the MEMORY local-dev recipe.
- Postgres `NOTICE: relation "events_2026_06" already exists, skipping` printed during re-seed — expected idempotent behavior from the `CREATE TABLE IF NOT EXISTS` partition pre-create, not an error.

## User Setup Required
None - no external service configuration required for this plan.

## Next Phase Readiness
- `projects.whatsapp` is available as a source-of-truth column for the WhatsApp CTA (WA-01) and downstream cotizador UI plans in this phase.
- The migration reaches staging only when the phase branch merges to main (staging currently runs a pre-fase-5 web image — noted in STATE.md).
- Full-media re-seed with live R2 + worker is deferred to the phase's live UAT (out of scope for this DB-only plan).

## Self-Check: PASSED

All 5 created/modified files exist on disk; both task commits (`d6acd89`, `8a2b023`) present in git history.

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
