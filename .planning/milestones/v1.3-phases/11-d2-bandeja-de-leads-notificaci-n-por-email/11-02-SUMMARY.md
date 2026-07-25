---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 02
subsystem: api
tags: [bullmq, resend, react-email, queue-contract, idempotency, es-AR, t3-env]

# Dependency graph
requires:
  - phase: 07-cotizador (quote-pdf molecule)
    provides: "quote-pdf queue-contract mold (const + type + pure options helper, no bullmq import) cloned for the lead-email contract"
  - phase: 02-auth (invitation email)
    provides: "send-invitation.ts dev/prod Resend branch + invitation.tsx es-AR template mold cloned for lead notifications"
provides:
  - "LEAD_EMAIL_QUEUE + LeadEmailJobData + leadEmailJobOptions(leadId) queue contract (jobId = lead:{id}:created dedup seam), exported from @imbau/storage barrel"
  - "LeadNotificationEmail es-AR React Email template (nombre/contacto/origen/proyecto + bandeja deep-link CTA)"
  - "sendLeadNotification dispatch (dev console fallback / Resend send / throw on error) with a worker-safe minimal env"
  - "@imbau/api/email subpath export so the worker imports the dispatch without the tRPC router graph"
affects: [11-03-enqueue-seam, 11-04-worker-processor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Queue-contract molecule: const + readonly type + pure jobId options helper, no bullmq import (keeps @imbau/storage Redis-free)"
    - "Worker-safe minimal createEnv: compose only the vars the module needs from presets, never reuse the auth runtime env (keeps BETTER_AUTH_SECRET/DATABASE_URL off the worker)"
    - "Resend dev/prod branch: console summary fallback when RESEND_API_KEY absent, verified INVITE_FROM sender when present, throw on Resend error (observable)"

key-files:
  created:
    - packages/storage/src/lead-email.ts
    - packages/api/src/email/templates/lead-notification.tsx
    - packages/api/src/email/send-lead-notification.ts
    - packages/api/tests/send-lead-notification.test.ts
  modified:
    - packages/storage/src/index.ts
    - packages/api/package.json

key-decisions:
  - "jobId = lead:{leadId}:created (not bare leadId) — namespaced per event so future lead events can share the queue without jobId collisions"
  - "BETTER_AUTH_URL composed into the dispatch's minimal env (declared-not-read) so a worker missing the panel base URL fails loudly at import — webEnv/deep-link precedent"
  - "deepLink is a param passed by the worker (which owns its panel base URL), not built inside the dispatch — matches the Plan 04 worker contract"

patterns-established:
  - "Lead-email queue contract cloned from quote-pdf mold with a namespaced dedup key"
  - "Dispatch reads a dedicated minimal env, never the auth runtime env — worker import safety"

requirements-completed: [LEADS-04]

coverage:
  - id: D1
    description: "Lead-email queue contract: LEAD_EMAIL_QUEUE + LeadEmailJobData (ids only) + leadEmailJobOptions with jobId = lead:{id}:created, attempts=5, exponential backoff; exported from the @imbau/storage barrel"
    requirement: "LEADS-04"
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/storage typecheck (pass) + grep -c 'lead:' packages/storage/src/lead-email.ts == 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "es-AR voseo LeadNotificationEmail template: <Html lang=\"es-AR\">, 4 body lines (Nombre/Contacto/Origen/Proyecto), CTA button 'Ver el lead en el panel' deep-linking to the bandeja"
    requirement: "LEADS-04"
    verification:
      - kind: unit
        ref: "packages/api/tests/send-lead-notification.test.ts#sends via Resend ... (asserts deepLink + 'Ver el lead en el panel' + nombre threaded into the rendered tree)"
        status: pass
      - kind: other
        ref: "pnpm --filter @imbau/api typecheck (pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "sendLeadNotification dispatch: dev console summary fallback / Resend send from INVITE_FROM with subject 'Tenés un lead nuevo en {Proyecto}' / throw on Resend error; worker-safe minimal env (no auth/DB secrets); @imbau/api/email export"
    requirement: "LEADS-04"
    verification:
      - kind: unit
        ref: "packages/api/tests/send-lead-notification.test.ts (3 cases: console fallback / Resend send / error throw — all pass)"
        status: pass
      - kind: other
        ref: "grep 'auth/env' send-lead-notification.ts == empty; grep '\"./email\"' packages/api/package.json present"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 02: Email molecule (queue contract + Resend dispatch + es-AR template) Summary

**Lead-email BullMQ queue contract with `lead:{id}:created` idempotency, an es-AR voseo React Email template, and a Resend dispatch with a dev console fallback — all worker-safe via a dedicated minimal env and the new `@imbau/api/email` export.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-24T19:24:19Z
- **Completed:** 2026-07-24T19:30:19Z
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- Cloned the quote-pdf mold into `lead-email.ts`: `LEAD_EMAIL_QUEUE`, `LeadEmailJobData` (ids only — no PII), and a pure `leadEmailJobOptions(leadId)` whose `jobId = lead:{leadId}:created` is the LEADS-04 / T-11-08 dedup seam (attempts=5, exponential backoff). Exported from the `@imbau/storage` barrel; no bullmq import (storage stays Redis-free).
- Built the es-AR voseo `LeadNotificationEmail` template with typed props, `<Html lang="es-AR">`, preheader, heading, the four lead body lines, and the `Ver el lead en el panel` CTA button deep-linking to the bandeja (copy verbatim from UI-SPEC §Notification email template, D-07).
- Built `sendLeadNotification` with the send-invitation dev/prod branch (console summary when `RESEND_API_KEY` absent; render + send from verified `INVITE_FROM` when present; throw on Resend error), a **dedicated minimal env** that never reuses the auth runtime env, and the `@imbau/api/email` subpath export so the worker imports it without the tRPC router graph. 3-case unit test green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Lead-email BullMQ queue contract + barrel export** - `5b5c3a8` (feat)
2. **Task 2: es-AR lead-notification React Email template** - `f3078d5` (feat)
3. **Task 3: Resend dispatch + minimal env + ./email export + test** - `d656edd` (feat)

## Files Created/Modified
- `packages/storage/src/lead-email.ts` (created) - Queue contract: const + type + pure jobId options helper
- `packages/storage/src/index.ts` (modified) - Barrel re-exports for the lead-email contract
- `packages/api/src/email/templates/lead-notification.tsx` (created) - es-AR voseo React Email template
- `packages/api/src/email/send-lead-notification.ts` (created) - Resend dispatch with dev fallback + minimal env
- `packages/api/package.json` (modified) - Added `./email` subpath export
- `packages/api/tests/send-lead-notification.test.ts` (created) - 3-case unit test (console / send / error)

## Decisions Made
- **jobId namespacing:** used `lead:{leadId}:created` rather than a bare id so the queue can carry future lead events without jobId collisions (matches CONTEXT D-06 `lead:{id}:{event}`).
- **`deepLink` passed by the worker:** the dispatch receives the fully-qualified bandeja URL rather than building it, matching the Plan 04 worker contract (the worker owns its panel base URL). `BETTER_AUTH_URL` is still composed into the dispatch's minimal env (declared-not-read) so a worker missing the panel base URL fails loudly at import — the webEnv/deep-link precedent.
- **Test env manipulation:** the Resend send/error cases set `process.env` + `vi.resetModules()` + dynamic import so the module's dedicated `createEnv` re-reads env; `resend` is mocked with a regular (non-arrow) function so `new Resend(key)` works.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Applied pending Drizzle migration 0006 to the local `_test` DB**
- **Found during:** Task 3 verification (running the `@imbau/api` suite)
- **Issue:** 9 pre-existing DB-integration tests failed with `column "leads_notify_email" does not exist` — Plan 01's migration 0006 was committed but never applied to the local `_test` Postgres (known dev-DB migration-lag gotcha). Not caused by this plan's code.
- **Fix:** Ran `pnpm --filter @imbau/db db:migrate` against `imbau_test` (idempotent, infra-only — no schema/code change). Suite then green (151/151).
- **Files modified:** none (DB state only)
- **Verification:** `pnpm --filter @imbau/api test` → 18 files / 151 tests passed.
- **Committed in:** n/a (environment sync, no repo change)

**2. [Rule 1 - Bug] Reworded an env comment so the acceptance grep stays clean**
- **Found during:** Task 3 acceptance check
- **Issue:** The dispatch's env comment referenced the literal path token `auth/env`, which would make the acceptance assertion `grep -n "auth/env" send-lead-notification.ts returns nothing` fail even though the module never imports it.
- **Fix:** Reworded the comment to "the auth runtime's env module" (no path token). Behavior unchanged.
- **Files modified:** packages/api/src/email/send-lead-notification.ts
- **Verification:** `grep -n "auth/env"` now returns nothing; typecheck + tests still green.
- **Committed in:** `d656edd` (Task 3 commit)

---

**Total deviations:** 2 (1 blocking env-sync, 1 comment fix)
**Impact on plan:** No scope creep. The migration sync is a local-environment concern (CI applies migrations itself); the comment fix is cosmetic and preserves the worker-import-safety invariant.

## Issues Encountered
- The `pnpm --filter @imbau/api test -- <name>` filter passthrough did not scope the run (ran the whole suite); used `node vitest.mjs run tests/send-lead-notification.test.ts` directly to iterate on the single file.
- Initial Resend mock used an arrow function, which cannot be used with `new` ("is not a constructor"); switched to a regular function whose returned object overrides `this`.

## Threat surface
No new security surface beyond the plan's `<threat_model>`. The dispatch mitigations hold: dev fallback logs only the public lead summary (to/nombre/origen), never the API key (T-11-03); `from` is the verified `INVITE_FROM` only (T-11-04); `jobId = lead:{id}:created` blocks notification-spam amplification (T-11-08); no new external packages (T-11-SC).

## User Setup Required
None - no external service configuration required. (Staging/prod Resend delivery already uses the existing `RESEND_API_KEY` / `INVITE_FROM` env from the invitation path.)

## Next Phase Readiness
- **Plan 03 (enqueue seam):** `LEAD_EMAIL_QUEUE` + `leadEmailJobOptions` + `LeadEmailJobData` are ready to import from `@imbau/storage`.
- **Plan 04 (worker processor):** `sendLeadNotification` is importable via `@imbau/api/email` without pulling the router graph; the worker builds the bandeja `deepLink` from its own panel base URL and passes it in.

## Self-Check: PASSED

All 4 created files + SUMMARY present on disk; all 3 task commits (5b5c3a8, f3078d5, d656edd) present in git history.

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
