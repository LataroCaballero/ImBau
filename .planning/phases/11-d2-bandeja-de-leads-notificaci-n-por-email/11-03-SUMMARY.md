---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 03
subsystem: api
tags: [trpc, zod, drizzle, rls, bullmq, ioredis, leads, pipeline, timeline]

# Dependency graph
requires:
  - phase: 11-01
    provides: "leads.desenlace + projects.leads_notify_email columns (migration 0006)"
  - phase: 11-02
    provides: "@imbau/storage lead-email queue contract (LEAD_EMAIL_QUEUE, leadEmailJobOptions, LeadEmailJobData)"
  - phase: 09
    provides: "requireRole+withTenant write mold + projects.updateSettings canary"
  - phase: 10
    provides: "units.ts write mold + events audit-per-transition pattern"
provides:
  - "leadsRouter (listForProject/create/updateEstado/addNote) — the LEADS-01..04 API surface"
  - "enqueueLeadEmail seam (packages/api/src/leads/runtime.ts) — lazy Redis producer"
  - "projects.updateSettings extended with leadsNotifyEmail (Zod .email nullable)"
  - "leads: leadsRouter registered in _app.ts (typed surface for the panel)"
affects: [11-04, 11-05, panel-leads-bandeja, worker-lead-email]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pipeline state machine as a local z.enum mirror of leadEstadoEnum (destination ∈ 4 values, free transitions)"
    - "Zod refine gating a conditional field (desenlace required iff estado==='cerrado')"
    - "Post-commit enqueue OUTSIDE withTenant (clone of quotes.create) — rolled-back insert enqueues zero jobs"
    - "Auto LeadNote + events audit row appended in the SAME withTenant tx as the transition"

key-files:
  created:
    - packages/api/src/leads/runtime.ts
    - packages/api/src/trpc/routers/leads.ts
    - packages/api/tests/leads-role-gate.test.ts
  modified:
    - packages/api/src/trpc/routers/projects.ts
    - packages/api/src/trpc/routers/_app.ts

key-decisions:
  - "origen resolved into a structured origenResuelto {tipo,label} rather than a flat string, so the panel and tests assert the pointer class deterministically"
  - "events lead-audit row keyed by (project_id, tipo=lead_estado_changed) — events has no lead_id column"
  - "projects.updateSettings: estado made optional + empty-patch guard (BAD_REQUEST) so a leadsNotifyEmail-only patch never nulls estado and an empty .set() never 500s"

patterns-established:
  - "Pattern: state-machine mutation reads current row for estadoPrev, appends auto LeadNote, UPDATE+.returning() NOT_FOUND, then events audit in-tx"
  - "Pattern: idempotency proven at this layer via deterministic leadEmailJobOptions(leadId).jobId while the runtime is mocked (BullMQ dedup lives in @imbau/storage)"

requirements-completed: [LEADS-01, LEADS-02, LEADS-03, LEADS-04]

coverage:
  - id: D1
    description: "leads.listForProject resolves origen by tenant-scoped joins (broker/unidad/cotización/Directo); cross-org projectId returns empty"
    requirement: LEADS-01
    verification:
      - kind: integration
        ref: "packages/api/tests/leads-role-gate.test.ts#resolves broker / unidad / cotización / Directo and hides cross-org leads"
        status: pass
    human_judgment: false
  - id: D2
    description: "leads.updateEstado enforces the 4-value enum, cerrado→desenlace refine, appends auto LeadNote, and writes an events audit row in the same tx; cross-role matrix (owner/developer/viewer/other-org/non-existent)"
    requirement: LEADS-02
    verification:
      - kind: integration
        ref: "packages/api/tests/leads-role-gate.test.ts#leads.updateEstado write gate + audit / cerrado desenlace refine"
        status: pass
    human_judgment: false
  - id: D3
    description: "leads.addNote appends a free-text LeadNote append-only, emits no events row and no email"
    requirement: LEADS-03
    verification:
      - kind: integration
        ref: "packages/api/tests/leads-role-gate.test.ts#appends a free-text note in ts order, writes no events row, and enqueues nothing"
        status: pass
    human_judgment: false
  - id: D4
    description: "leads.create inserts + seeds t=0 note + enqueues exactly one idempotent job AFTER commit OUTSIDE withTenant; a rolled-back insert enqueues ZERO jobs"
    requirement: LEADS-04
    verification:
      - kind: integration
        ref: "packages/api/tests/leads-role-gate.test.ts#owner creates a lead... enqueues exactly one job / a failing insert... enqueues ZERO jobs"
        status: pass
      - kind: other
        ref: "perl balanced-paren gate: enqueueLeadEmail( outside create's withTenant(...) group"
        status: pass
    human_judgment: false
  - id: D5
    description: "projects.updateSettings extended with leadsNotifyEmail (z.email nullable) without breaking the Phase 9 estado canary"
    requirement: LEADS-04
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts (canary suite still green)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 03: Leads router + enqueue seam + extended updateSettings Summary

**leadsRouter (listForProject/create/updateEstado/addNote) with the pipeline state machine, append-only timeline, events audit, and the load-bearing post-commit lead-email enqueue seam — all cloning the settled Phase 9/10 requireRole+withTenant write mold, proven against real Postgres.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-24T19:35:04Z
- **Completed:** 2026-07-24T19:42:46Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `enqueueLeadEmail` Redis-only lazy/memoized producer seam (clone of `quotes/runtime.ts` stripped of R2/S3), pushing an idempotent `lead:{id}:created` job.
- `leadsRouter` with the 4 procedures: origen-resolving read, free-transition state machine with `cerrado`→`desenlace` refine + auto timeline entry + events audit, append-only note, and the alta-manual create that enqueues the notification email as a post-commit side-effect OUTSIDE the tenant tx.
- `projects.updateSettings` extended with `leadsNotifyEmail` (`z.email().nullable().optional()`) and a partial-key `.set(...)` — the Phase 9 estado canary stays green.
- 15-test cross-role/transition/timeline/idempotency matrix vs real Postgres, including the load-bearing rollback proof that a failing create enqueues ZERO jobs.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enqueue seam (leads/runtime.ts)** - `be4d9c0` (feat)
2. **Task 2: leadsRouter + extend projects.updateSettings + register** - `c2da48b` (feat)
3. **Task 3: leads-role-gate matrix vs real Postgres** - `bee6a9f` (test)

_Note: Task 3 is a test-only deliverable executed against the router built in Tasks 1-2, so it landed green in a single `test(...)` commit (no RED/GREEN split — the behavior already existed)._

## Files Created/Modified
- `packages/api/src/leads/runtime.ts` - lazy/memoized IORedis+Queue; `enqueueLeadEmail(data)` pushes a `notify` job with `leadEmailJobOptions(leadId)`. Composes baseEnv+redisEnv only (no R2).
- `packages/api/src/trpc/routers/leads.ts` - the LEADS-01..04 router; grep-fenced to `withTenant`/`schema` only.
- `packages/api/src/trpc/routers/projects.ts` - `updateSettings` extended with `leadsNotifyEmail`; estado optional + empty-patch guard.
- `packages/api/src/trpc/routers/_app.ts` - registered `leads: leadsRouter`.
- `packages/api/tests/leads-role-gate.test.ts` - the cross-role/transition/timeline/idempotency matrix.

## Decisions Made
- **origen shape:** `listForProject` returns `origenResuelto: { tipo, label }` (broker/unidad/cotizacion/directo) instead of a flat string, so the panel renders the pointer class and tests assert it deterministically.
- **events lead-audit key:** `events` has no `lead_id` column, so a lead transition audit row is keyed by `(project_id, tipo="lead_estado_changed")`; `countEvents(projectId, tipo)` in the test measures the delta.
- **updateSettings partial patch:** made `estado` optional and added a `BAD_REQUEST` guard when zero keys are provided, so a `leadsNotifyEmail`-only patch never nulls `estado` and an empty `.set()` never raises a runtime 500. The canary (which always sends `estado`) is unaffected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Empty-patch guard on projects.updateSettings**
- **Found during:** Task 2 (extend updateSettings)
- **Issue:** Making `estado` optional to allow a `leadsNotifyEmail`-only patch means a call with neither key would reach Drizzle's `.set({})`, raising a runtime "No values to set" 500.
- **Fix:** Build the `.set` object from only the provided keys and throw `BAD_REQUEST` ("No hay cambios para aplicar.") when it is empty.
- **Files modified:** packages/api/src/trpc/routers/projects.ts
- **Verification:** typecheck green; projects-role-gate canary green (always sends estado).
- **Committed in:** `c2da48b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical correctness guard)
**Impact on plan:** The guard is required for correct partial-patch behavior introduced by D-05; no scope creep. All other work followed the plan and PATTERNS map verbatim.

## Issues Encountered
- Two acceptance-gate greps (`r2Env` in runtime.ts, `createOwnerDb|appDb` in leads.ts) initially matched my own explanatory comments. Reworded the comments so the source assertions return 0 without weakening the documentation. Both gates then passed.

## User Setup Required
None - no external service configuration required. (Live Redis/Resend delivery is exercised by the Plan 04 worker; this plan's enqueue seam is unit-mocked and the DB matrix runs against local Postgres.)

## Next Phase Readiness
- **Plan 04 (worker):** consumes `LEAD_EMAIL_QUEUE`; the enqueue seam and ids-only payload are in place. The recipient resolver will read `projects.leadsNotifyEmail` (fallback = org owners).
- **Plan 05 (panel):** `leads.listForProject`/`create`/`updateEstado`/`addNote` are the typed surface for the kanban + drawer. `origenResuelto`, `timeline`, and `desenlace` are all exposed on the read.
- No blockers.

## Self-Check: PASSED

All 5 created/modified files exist on disk; all 3 task commits (`be4d9c0`, `c2da48b`, `bee6a9f`) present in git history.

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
