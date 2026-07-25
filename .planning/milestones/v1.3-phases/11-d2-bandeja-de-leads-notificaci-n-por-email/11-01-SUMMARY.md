---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 01
subsystem: database
tags: [drizzle, postgres, migration, rls, seed, leads]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: leads + projects schema, deterministic Brigos seed, versioned Drizzle migrations
provides:
  - "leads.desenlace nullable text column (ganado|perdido) — cerrado outcome sidecar, enum untouched"
  - "projects.leads_notify_email nullable text column — per-project notify recipient (null = org owners)"
  - "Migration 0006_leads_desenlace_projects_notify_email — one additive nullable-column migration, applied to live dev DB, idempotent"
  - "Seed: cerrado leads carry non-null desenlace (Tomás=ganado, Camila=perdido) via the email-free direct insert path"
affects: [11-02, 11-03, 11-04, 11-05, leads-router, projects-updateSettings, lead-email-worker, kanban-bandeja]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive nullable column via generated Drizzle migration (never push/manual) — D-03/D-05 forward-compatible sidecar over enum edits"
    - "Seed carries new column through the existing direct tx.insert(schema.leads).onConflictDoNothing() — structurally bypasses the create/email seam"

key-files:
  created:
    - packages/db/migrations/0006_leads_desenlace_projects_notify_email.sql
    - packages/db/migrations/meta/0006_snapshot.json
  modified:
    - packages/db/src/schema/leads.ts
    - packages/db/src/schema/projects.ts
    - packages/db/src/seed/content.ts
    - packages/db/src/seed/content-rows.ts
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "desenlace declared as plain nullable text (validated at the Zod boundary in Plan 03), mirroring origen — NOT a PG enum, per D-03 discretion; leadEstadoEnum left untouched."
  - "leadsNotifyEmail added with no new pgPolicy — projects_tenant covers panel read/write; projects_anon_published is SELECT-only over public fields."
  - "For a real Ganado/Perdido badge mix from seed data, Camila Vega was reframed as a realistic closed-lost lead (perdido); Tomás Acosta stays ganado. Only the two cerrado leads carry desenlace."

patterns-established:
  - "Pattern 1: generated additive nullable-column migration applied to the live dev DB before any downstream router/worker/UI verification (avoids config-derived-type false positives)."
  - "Pattern 2: seed extends new columns via the existing direct insert, keeping re-seed structurally email-free (belt-and-suspenders with the jobId dedup in Plan 03)."

requirements-completed: [LEADS-02, LEADS-04]

coverage:
  - id: D1
    description: "leads.desenlace nullable text column exists in schema + live DB; leadEstadoEnum unchanged"
    requirement: LEADS-02
    verification:
      - kind: automated_ui
        ref: "psql information_schema.columns → leads.desenlace text is_nullable=YES"
        status: pass
      - kind: unit
        ref: "pnpm --filter @imbau/db typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "projects.leads_notify_email nullable text column exists in schema + live DB"
    requirement: LEADS-04
    verification:
      - kind: automated_ui
        ref: "psql information_schema.columns → projects.leads_notify_email text is_nullable=YES"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration 0006 = exactly two additive ADD COLUMN, no drop/type/enum; applied to live DB, idempotent on re-run"
    requirement: LEADS-02
    verification:
      - kind: integration
        ref: "pnpm --filter @imbau/db db:migrate (twice) → applied then no-op; grep -Eic 'add column' == 2; grep -iE 'drop|alter column .* type|create type' == none"
        status: pass
    human_judgment: false
  - id: D4
    description: "Seeded cerrado leads carry non-null desenlace (ganado/perdido) via email-free direct insert; re-seed idempotent (13 leads unchanged), non-cerrado desenlace null"
    requirement: LEADS-04
    verification:
      - kind: integration
        ref: "runSeed({skipMedia:true}) x2 on dev imbau → Tomás=ganado, Camila=perdido; total leads 13/13; non-cerrado non-null desenlace = 0; grep enqueueLeadEmail/create in content-rows == 0"
        status: pass
    human_judgment: false

# Metrics
duration: 30min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 01: Additive leads.desenlace + projects.leads_notify_email columns Summary

**Two additive nullable columns (leads.desenlace ganado|perdido, projects.leads_notify_email) landed via generated Drizzle migration 0006, applied to the live dev DB idempotently, with cerrado seed leads carrying real Ganado/Perdido outcomes through the email-free direct-insert path.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-24
- **Tasks:** 3
- **Files modified:** 5 (+2 migration artifacts created)

## Accomplishments
- `leads.desenlace` nullable `text` column (D-03) added beside `estado` without touching `leadEstadoEnum` — the cheap, forward-compatible cerrado ganado/perdido sidecar consumed by Plan 03's `updateEstado` refine and Plan 05's desenlace prompt.
- `projects.leads_notify_email` nullable `text` column (D-05) added beside `whatsapp`; null is the valid "fall back to org owners" sentinel read by the Plan 04 worker recipient resolver.
- Generated migration `0006_leads_desenlace_projects_notify_email.sql` with exactly two `ALTER TABLE ... ADD COLUMN` statements (no drop/type-change/enum DDL), applied to the live dev `imbau` DB and verified idempotent on a second `db:migrate`.
- Seed now attaches `desenlace` to the two `cerrado` leads (Tomás Acosta = ganado, Camila Vega reframed as a realistic closed-lost = perdido) through the existing direct `tx.insert(schema.leads).onConflictDoNothing()` — the create/email seam is never touched, so a re-seed sends zero emails.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add nullable desenlace + leads_notify_email columns** - `98adf52` (feat)
2. **Task 2 [BLOCKING]: Generate + apply migration 0006 to the live DB** - `17721ee` (feat)
3. **Task 3: Seed desenlace on cerrado leads; confirm seed bypasses the email seam** - `ee5100c` (feat)

**Plan metadata:** see final `docs(11-01)` commit.

## Files Created/Modified
- `packages/db/src/schema/leads.ts` - added nullable `desenlace: text("desenlace")` beside `estado`; enum untouched.
- `packages/db/src/schema/projects.ts` - added nullable `leadsNotifyEmail: text("leads_notify_email")` beside `whatsapp`; no new pgPolicy.
- `packages/db/migrations/0006_leads_desenlace_projects_notify_email.sql` - generated two-statement additive migration.
- `packages/db/migrations/meta/_journal.json` + `meta/0006_snapshot.json` - drizzle journal/snapshot for 0006.
- `packages/db/src/seed/content.ts` - `LeadDef` gains optional `desenlace`; set on the two cerrado leads (Camila reframed to a lost deal).
- `packages/db/src/seed/content-rows.ts` - maps `desenlace` into `leadRows` for the existing direct insert.

## Decisions Made
- **desenlace as plain nullable text, not a PG enum** (D-03 discretion): mirrors how `origen` is plain text; the `ganado|perdido` domain is enforced at the Zod boundary in Plan 03. Keeps `leadEstadoEnum` untouched and the migration purely additive.
- **No new pgPolicy for leads_notify_email**: `projects_tenant` already covers panel read/write, and `projects_anon_published` is SELECT-only over intentionally-public fields — the new column is panel-private and needs no policy change.
- **Camila Vega reframed as closed-lost (perdido)**: the seed has only two `cerrado` leads and both narratives described won deals. To make the bandeja's Cerrado column render both Ganado AND Perdido badges from real data (the plan's stated must-have), Camila's closing timeline was rewritten as a realistic lost deal ("compró en otra torre; cerramos como perdido"). Tomás Acosta stays ganado. No test references these lead narratives (grep-verified), so this is a safe, deterministic seed change.

## Deviations from Plan

### Observations (no auto-fix required)

**1. [Note] Seed contains 13 leads, not the "14" stated in the plan/CONTEXT**
- **Found during:** Task 3 (seed verification)
- **Detail:** The `LEADS` array has 13 entries (nuevo 4 / contactado 4 / negociacion 3 / cerrado 2), confirmed both in source and in the live DB. The plan's `must_haves` and CONTEXT reference "the 14 fictitious leads" — a pre-existing documentation inaccuracy inherited from Phase 1/3, not introduced here.
- **Action:** Intentionally NOT changed. Adding a 14th lead would be scope creep and would alter the deterministic dataset that downstream plans/tests depend on. This plan's scope is attaching `desenlace` to the existing cerrado leads, which is fully satisfied. Downstream plans should treat the seed as 13 leads.

---

**Total deviations:** 0 auto-fixed. 1 documentation observation (lead count 13 vs 14) surfaced for downstream awareness.
**Impact on plan:** None. All success criteria met; the "14" figure is incidental to the plan's actual deliverables.

## Issues Encountered
- **Node/toolchain:** the login shell defaults to Node 18/20 with no pnpm on PATH; ran everything under `PATH=$HOME/.nvm/versions/node/v22.22.3/bin` + `corepack enable` (pnpm 11.6.0), per the project's local-dev-environment note.
- **Seed verification against a pre-seeded dev DB:** the two cerrado leads already existed (without desenlace) and `onConflictDoNothing` never updates existing rows. To prove the insert-with-desenlace path, the two seed cerrado leads were deleted and `runSeed({skipMedia:true})` re-run (skipMedia exempts the R2/Redis probes). Both cerrado leads reinserted with correct desenlace; a second run left the count at 13 (idempotent). This is a verification-only manipulation of deterministic dev fixtures — fully re-creatable by the seed.

## User Setup Required
None - no external service configuration required. (The live migration was applied to the local dev `imbau` DB; staging/CI apply 0006 through their own `db:migrate` step.)

## Next Phase Readiness
- Both columns are live in schema, the versioned migration, and the dev DB — Plan 03 (`leads.updateEstado` desenlace refine, `projects.updateSettings` leadsNotifyEmail) and Plan 04 (worker recipient resolver) can build against real columns without false-positive verification.
- Seed provides real Ganado/Perdido data for Plan 05's bandeja Cerrado column.
- No blockers.

## Self-Check: PASSED

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
