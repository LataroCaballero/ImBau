---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 04
subsystem: worker
tags: [bullmq, worker, resend, email, rls, multi-tenant, leads, security-definer]

# Dependency graph
requires:
  - phase: 11-01
    provides: leads/desenlace schema + projects.leadsNotifyEmail column
  - phase: 11-02
    provides: LEAD_EMAIL_QUEUE + LeadEmailJobData contract (@imbau/storage) + sendLeadNotification (@imbau/api/email)
  - phase: 11-04a
    provides: public.org_owner_emails(p_org_id) SECURITY DEFINER door (migration 0007) for the owner-email fallback
provides:
  - "processLeadEmail(job) — the worker consumer that drains LEAD_EMAIL_QUEUE into exactly one notification email under the payload tenant"
  - "reportLeadEmailFailure(err, ctx) — observable failure reporter (Sentry + pino, ids only)"
  - "createLeadEmailWorker + boot() registration (Queue + Worker + failed handler)"
affects: [11-03, leads-notify-fallback, worker-email-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker consumer clones the quote-pdf molecule: thin impure processor + verbatim Sentry+pino failure reporter, registered in boot() with a failed handler, event-driven (no upsertJobScheduler)"
    - "Owner-email fallback reads the un-RLS'd Better Auth user table ONLY through the org_owner_emails SECURITY DEFINER function via a raw drizzle sql fragment inside withTenant — never the owner pool, never a direct user SELECT"

key-files:
  created:
    - apps/worker/src/lead-email.ts
    - apps/worker/src/lead-email.test.ts
  modified:
    - apps/worker/src/index.ts
    - apps/worker/src/env.ts
    - apps/worker/package.json
    - apps/worker/tsconfig.json
    - apps/worker/vitest.config.ts

key-decisions:
  - "readLeadForEmail runs a SINGLE withTenant(payload.orgId) tx: lead+origen joins, project (nombre, leadsNotifyEmail), and — only when leadsNotifyEmail is null — the org owners via org_owner_emails. Recipient SELECTION lives in processLeadEmail (outside the read) so the unit test exercises the D-05 fallback + origen resolution directly against a controlled row (the quote-pdf orchestration-test mold)."
  - "Owner emails resolved with `sql\`select o as email from public.org_owner_emails(${orgId}) as o\`` through the app pool inside withTenant — the only door app_authenticated has to the un-RLS'd user table (migration 0007). grep createOwnerDb|appDb in lead-email.ts == 0."
  - "Empty-both case (leadsNotifyEmail null AND no org owner) THROWS so BullMQ fails the job — a lead is never lost silently (D-05)."
  - "BETTER_AUTH_URL added to the worker env aggregator (cherry-picked from authEnv, NOT the whole spread — the worker must not carry BETTER_AUTH_SECRET) + the vitest env block, the approved default for the bandeja deep-link origin."

requirements-completed: [LEADS-04]

coverage:
  - id: T1
    description: "processLeadEmail sends exactly one notification to project.leadsNotifyEmail (or the org-owner fallback) under withTenant(payload.orgId), origen resolved to the es-AR chip label"
    requirement: "LEADS-04"
    verification:
      - kind: unit
        ref: "lead-email.test.ts: configured-email path, owner fallback (single + multi), origen broker/unidad/cotizacion/Directo, no-recipient throw, error propagation — 10 passing"
        status: pass
      - kind: other
        ref: "grep -cE 'createOwnerDb|appDb' apps/worker/src/lead-email.ts == 0; withTenant(job.data.organizationId) asserted in test"
        status: pass
    human_judgment: false
  - id: T2
    description: "Lead-email Queue + Worker + failed handler registered in boot(); event-driven (no upsertJobScheduler); worker depends on @imbau/api"
    requirement: "LEADS-04"
    verification:
      - kind: unit
        ref: "index.test.ts (boot smoke) passes with the lead-email worker; full worker suite 42/42 green"
        status: pass
      - kind: other
        ref: "only partitionsQueue.upsertJobScheduler call in index.ts (none for lead-email); @imbau/api workspace:* in apps/worker/package.json"
        status: pass
    human_judgment: false

# Metrics
duration: ~8min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 04: lead-email worker consumer Summary

**The worker now drains `LEAD_EMAIL_QUEUE`: `processLeadEmail` reads the lead + project under `withTenant(payload.orgId)` as `app_authenticated`, resolves the recipient (`project.leadsNotifyEmail` ?? the org owners via the hardened `org_owner_emails` SECURITY DEFINER door), builds the bandeja deep-link, and dispatches exactly one es-AR notification through `@imbau/api/email` — with failures routed to Sentry + pino (ids only) and idempotency guaranteed by the producer's `jobId=lead:{id}:created` dedup. LEADS-04 is closed end-to-end.**

## Performance
- **Duration:** ~8 min
- **Started:** 2026-07-24T20:37:16Z
- **Completed:** 2026-07-24T20:44:49Z
- **Tasks:** 3
- **Files:** 2 created, 5 modified (+ pnpm-lock.yaml)

## Accomplishments
- `processLeadEmail(job)` + `readLeadForEmail(orgId, leadId, projectId)` + `reportLeadEmailFailure(err, ctx)` (`apps/worker/src/lead-email.ts`), cloning the quote-pdf processor + failure-reporter shape.
- Owner-email fallback wired through `public.org_owner_emails(orgId)` (migration 0007) with a raw drizzle `sql` fragment inside `withTenant` — RLS-scoped, never the owner pool, never a direct `user` read. Verified: `grep createOwnerDb|appDb` in `lead-email.ts` == 0.
- Origen resolution mirrors `leads.listForProject` (broker nombre > unidad identificador > cotización id > `Directo`), kept in the processor so it is unit-tested directly.
- `createLeadEmailWorker` + boot() registration: `new Queue(LEAD_EMAIL_QUEUE)`, the Worker (concurrency 2), and the `failed` → `reportLeadEmailFailure` handler; event-driven (NO `upsertJobScheduler`). Added to the boot return type/object.
- `@imbau/api` added as a worker workspace dependency; `BETTER_AUTH_URL` added to the worker env aggregator + the vitest env block for the deep-link origin.
- `lead-email.test.ts`: 10 orchestration tests (configured email, owner fallback single + multi, origen incl. `Directo`, no-recipient throw, error propagation, structured-ids-only failure report). Full worker suite 42/42 green; worker typecheck + lint clean.

## Task Commits
1. **Task 1: processLeadEmail + recipient resolution + reportLeadEmailFailure** — `3cb4d1c` (feat)
2. **Task 2: register lead-email Queue + Worker + failed handler in boot()** — `1b89fca` (feat)
3. **Task 3: lead-email processor unit test** — `9b5e65a` (test)

## Files Created/Modified
- `apps/worker/src/lead-email.ts` (created) — the processor, tenant-scoped read (incl. the org_owner_emails door), recipient/origen resolution, and the observable failure reporter.
- `apps/worker/src/lead-email.test.ts` (created) — orchestration unit test (db/email/env/Sentry/pino mocked).
- `apps/worker/src/index.ts` — `createLeadEmailWorker` + boot() Queue/Worker/failed-handler wiring + return type.
- `apps/worker/src/env.ts` — `BETTER_AUTH_URL` (cherry-picked from authEnv) for the bandeja deep-link.
- `apps/worker/package.json` — `@imbau/api: workspace:*` dependency.
- `apps/worker/tsconfig.json` — `jsx: react-jsx` (JIT `.tsx` email template pulled in by the `@imbau/api/email` import).
- `apps/worker/vitest.config.ts` — `BETTER_AUTH_URL` dummy in the test env block.

## Decisions Made
- **Everything in `lead-email.ts` (no separate store):** matched the plan's single-file intent. Kept recipient SELECTION and origen resolution in `processLeadEmail` (outside the `withTenant` read), so the unit test mocks `@imbau/db`'s `withTenant` to return a controlled composite row and asserts the D-05 fallback / origen / single-send — the same orchestration-test discipline as `quote-pdf.test.ts` (DB query correctness is left to integration; `org_owner_emails` was already runtime-verified in 11-04a).
- **Owner fallback resolved in-tx, conditionally:** `org_owner_emails` is only called when `leadsNotifyEmail` is null, so the configured-email path costs no extra lookup.
- **Multi-owner recipients → comma list** within the existing `to: string` contract of `sendLeadNotification` (unchanged — `@imbau/api` is out of this plan's scope).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `jsx: react-jsx` added to the worker tsconfig**
- **Found during:** Task 1 (`pnpm --filter @imbau/worker typecheck`).
- **Issue:** Importing `@imbau/api/email` (a JIT workspace package) makes `tsc` follow the send module into the es-AR React Email `.tsx` template; the worker's `node.json` base does not set `jsx`, so typecheck failed with TS6142 (`--jsx not set`).
- **Fix:** Added `compilerOptions.jsx: "react-jsx"` to `apps/worker/tsconfig.json`. The worker already ships `react` + `@types/react` (for `@react-pdf/renderer`), so this adds no dependency and only affects typecheck (tsup owns the build transform).
- **Files modified:** apps/worker/tsconfig.json
- **Commit:** 3cb4d1c

**2. [Rule 2 - Missing critical] No-recipient guard (lead never lost)**
- **Found during:** Task 1.
- **Issue:** When `leadsNotifyEmail` is null AND the org resolves no owner, silently returning would drop the notification — violating the D-05 "a lead is NEVER lost silently" must-have.
- **Fix:** `processLeadEmail` throws when the resolved recipient set is empty, so BullMQ fails/retries the job and the failure is observable.
- **Files modified:** apps/worker/src/lead-email.ts
- **Commit:** 3cb4d1c

### Scheduling adjustment (not scope)
- The `@imbau/api` dependency (`package.json`) and `BETTER_AUTH_URL` (`env.ts`) — listed under Task 2 / the unblock note — landed in the **Task 1** commit instead, because `lead-email.ts`'s own typecheck (its `@imbau/api/email` import and `env.BETTER_AUTH_URL` usage) requires both to be present. No change in what was built.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical) + 1 scheduling adjustment. No architectural changes, no new external packages (`@imbau/api` is an internal workspace dep).

## Blocker Resolution (from the prior aborted attempt)
The prior attempt correctly refused a direct read of the un-RLS'd Better Auth `user` table and the owner pool. This execution used the user-approved Option 1 landed by 11-04a: the owner-email fallback calls `public.org_owner_emails(orgId)` (SECURITY DEFINER, EXECUTE granted to `app_authenticated` only) through a raw drizzle `sql` fragment inside `withTenant` — the single sanctioned door. `grep createOwnerDb|appDb` in `lead-email.ts` == 0.

## Issues Encountered
- The worker vitest suite's `globalSetup` (`tests/setup.ts`) connects to the local `_test` DB in the main process (no `test.env` injection), so running the suite locally requires the `DATABASE_*`/`REDIS_URL`/`BETTER_AUTH_*` exports from the "Local test env recipe" memory. Migrations 0006/0007 were already applied; the suite passed 42/42.

## User Setup Required
None for local/CI. Staging/prod already carry `BETTER_AUTH_URL` (existing auth var) + `RESEND_API_KEY`/`INVITE_FROM` for the real send; without a Resend key the dispatch logs a dev-console line (D-09).

## Next Phase Readiness
- **11-03 (enqueue seam) closes the loop:** the producer (`leads.create`) pushes `lead:{id}:created` jobs; this worker drains them. Idempotency is the producer's `jobId` dedup — re-seed/bulk never duplicate sends.
- No blockers.

## Self-Check: PASSED

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
