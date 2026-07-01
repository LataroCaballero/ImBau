---
phase: 02-pipeline-de-media-r2-sharp-blurhash
plan: 03
subsystem: worker
tags: [bullmq, sentry, pino, observability, drizzle, rls, withTenant, idempotency, retries, role-guard, vitest, postgres, mock-s3]

# Dependency graph
requires:
  - phase: 02-02-worker-sharp-pipeline
    provides: "processMedia + renderVariants + media-store.writeVariants (sole withTenant write seam) + createMediaWorker/mediaQueue wiring + media-runtime (mockable R2 seam)"
  - phase: 02-01-media-transport-entry
    provides: "@imbau/storage (variantKey, MEDIA_QUEUE, mediaJobOptions: jobId=mediaId/attempts/backoff) + media table with variants/width/height/blurhash + media_tenant RLS policy"
  - phase: 01-schema-media-seed
    provides: "media table + media_tenant FOR ALL TO app_authenticated policy (default-deny for owner)"
  - phase: 00-foundation
    provides: "withTenant RLS seam (set_config GUC), @imbau/db createOwnerDb + migrate journal, @imbau/observability logger, @sentry/node instrument"
provides:
  - "reportMediaFailure(err, ctx) → Sentry.captureException + logger.error (mediaId/attempts/queue) — failure is observable, never swallowed (MEDIA-04 / T-02-11)"
  - "mediaWorker.on('failed', …) wired to reportMediaFailure; media worker concurrency bounded at 2"
  - "Worker integration harness: tests/db.ts (owner/app pools + `_test` DB guard), tests/setup.ts (idempotent migrate + app_authenticated role-guard globalSetup), tests/helpers.ts (makeOrg/makeProject/makeMedia owner fixtures)"
  - "media-integration.test.ts proving MEDIA-04: idempotency (two runs → one row, identical variants map + keys), recoverability (injected failure → row stays variants={}, clean rerun populates), role-guard (write-back as app_authenticated rolsuper/rolbypassrls=false; foreign-org job writes nothing via RLS default-deny)"
affects: [explorador-ficha, 03-cotizador-seed, 04-panel, staging-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Failure observability seam: reportMediaFailure is a pure-of-reported-effects function invoked by the BullMQ 'failed' handler AND directly by a spy test — testable without Redis/a live Worker"
    - "Worker integration harness mirrors packages/db/tests: ownerUrl()/appUrl() + requireTestDb (`_test` name guard, never logs the value) + assertUnprivileged globalSetup that fails the whole suite if the app connection can bypass RLS"
    - "MEDIA-04 data-level proofs over real PG16 with R2 mocked via vi.mock('../src/media-runtime') (in-memory Map for putVariant, synthetic sharp buffer for getOriginal) — no live R2/Redis in CI"
    - "Recoverability is demonstrable because 02-02's single final UPDATE means an injected failure leaves variants={} (recoverable pre-processing state), never a partial map (A1)"

key-files:
  created:
    - "apps/worker/src/media-failure.test.ts (pure spy test: Sentry.captureException + logger.error receive err/mediaId/attempts/queue)"
    - "apps/worker/tests/db.ts (owner/app URL plumbing + requireTestDb `_test` guard, reuses createOwnerDb)"
    - "apps/worker/tests/setup.ts (globalSetup: idempotent migrate as owner + assertUnprivileged app_authenticated role-guard)"
    - "apps/worker/tests/helpers.ts (makeOrg/makeProject/makeMedia owner fixtures, replicated from packages/db)"
    - "apps/worker/tests/media-integration.test.ts (idempotency + recoverability + role-guard, PG16 + mock S3)"
  modified:
    - "apps/worker/src/media.ts (added reportMediaFailure: Sentry + pino, never re-throws/swallows)"
    - "apps/worker/src/index.ts (mediaWorker.on('failed', …) → reportMediaFailure; concurrency bounded at 2)"
    - "apps/worker/vitest.config.ts (globalSetup ./tests/setup.ts + include tests/**/*.test.ts)"
    - "apps/worker/tsconfig.json (include tests/**/*.ts + vitest.config.ts so typecheck covers the harness)"

key-decisions:
  - "Retries/dedup are NOT reconfigured in the worker — jobId=mediaId/attempts=5/exponential backoff come from the 02-01 producer (mediaJobOptions); 02-03 DOCUMENTS and verifies them via the data-level idempotency proof rather than re-asserting BullMQ options"
  - "reportMediaFailure is exported as a directly-callable function (not an inline closure) so the spy test exercises it without Redis or a live Worker"
  - "The worker replicates the 3 needed fixtures (makeOrg/makeProject/makeMedia) instead of importing packages/db/tests/* — those test helpers are not exported across package boundaries"
  - "Real-R2 staging smoke (Task 3) DEFERRED by user decision — tracked as a pending human-verification item, not a completion blocker; CI/local cover the logic with mock S3 + real Postgres"

patterns-established:
  - "Observability seam tested by spies: route failures to Sentry + pino in one exported function, asserted with vi.spyOn — proves the error is never swallowed without standing up Redis"
  - "Per-package integration harness with an RLS role-guard globalSetup: the suite refuses to run if the app connection reports rolbypassrls=true or an unexpected current_user"

requirements-completed: [MEDIA-04]

coverage:
  - id: D1
    description: "reportMediaFailure routes a job failure to Sentry.captureException (extra: mediaId/attempts) AND logger.error (err/mediaId/queue) — never swallowed (MEDIA-04 / T-02-11)"
    requirement: MEDIA-04
    verification:
      - kind: unit
        ref: "apps/worker/src/media-failure.test.ts (spies on Sentry.captureException + logger.error; both receive error/mediaId/attempts/queue)"
        status: pass
    human_judgment: false
  - id: D2
    description: "media worker 'failed' handler is wired to reportMediaFailure with { mediaId: job.data.mediaId, attempts: job.attemptsMade }; concurrency bounded at 2"
    requirement: MEDIA-04
    verification:
      - kind: other
        ref: "grep 'failed' + reportMediaFailure in apps/worker/src/index.ts; covered transitively by the spy test"
        status: pass
    human_judgment: false
  - id: D3
    description: "processMedia is idempotent: two runs → exactly one media row, an identical variants map, and an identical variantKey set (deterministic key → overwrite, never duplicates) (MEDIA-04)"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/worker/tests/media-integration.test.ts (idempotency: two runs → one row, identical variants map + keys; PG16 + mock S3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Recoverability: an injected failure (getOriginal/putVariant throws) leaves the media row variants={} (recoverable, no partial map); a clean rerun populates it (MEDIA-04 / A1 / T-02-10)"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/worker/tests/media-integration.test.ts (recoverability: injected failure → variants={}, clean rerun populated)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Role-guard: write-back runs as app_authenticated with the GUC (rolsuper=false, rolbypassrls=false); a foreign-org job writes nothing via RLS default-deny — never owner/BYPASSRLS (A8 / T-02-12)"
    requirement: MEDIA-04
    verification:
      - kind: integration
        ref: "apps/worker/tests/media-integration.test.ts (role-guard: current_user='app_authenticated', rolsuper/rolbypassrls=false; foreign org → variants={}); globalSetup assertUnprivileged"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real-R2 end-to-end staging smoke: provision Cloudflare R2 (bucket/token/public-domain/CORS), load R2_* + worker DATABASE_APP_URL staging secrets, then verify original→R2, worker variants under variants/{mediaId}/{width}.{avif,webp}, media row variants/blurhash/width/height populated, variants served from R2_PUBLIC_BASE_URL via resolveMedia, and a forced failure → Sentry+pino + row stays variants={}"
    verification: []
    human_judgment: true
    rationale: "DEFERRED by user decision (not a completion blocker). The Cloudflare dashboard (bucket/token/public domain/CORS) and staging secrets live outside git; CI never touches live R2 (mock S3). This remains a pending human-verification item for staging work — the automated logic is fully proven by D1–D5."

# Metrics
duration: ~4min
completed: 2026-06-30
status: complete
---

# Phase 2 Plan 03: Media hardening — observability, idempotency, recoverability, role-guard (MEDIA-04) Summary

**`reportMediaFailure` routes every media-job failure to Sentry + pino (mediaId/attempts/queue, never swallowed) wired into the BullMQ `failed` handler, plus a worker integration harness over real Postgres 16 + mock S3 that PROVES MEDIA-04's three guarantees — idempotency (two runs → one row, identical variants/keys), recoverability (injected failure → row stays `variants={}`, clean rerun populates), and the app_authenticated role-guard (write-back never as owner/BYPASSRLS; foreign-org job writes nothing via RLS default-deny). The real-R2 staging smoke is DEFERRED as a tracked human-verification item.**

## Performance

- **Duration:** ~4 min (autonomous tasks; continuation finalized the SUMMARY)
- **Started:** 2026-06-30T13:25:04-03:00
- **Completed:** 2026-06-30T13:29:00-03:00 (autonomous work)
- **Tasks:** 2 of 3 executed (Task 3 deferred by user decision)
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments
- **Failure observability (MEDIA-04 / T-02-11):** `reportMediaFailure(err, ctx)` in `apps/worker/src/media.ts` calls `Sentry.captureException(err, { extra: { mediaId, attempts } })` and `logger.error({ err, mediaId, queue: MEDIA_QUEUE }, "media job failed")` — it reports but never re-throws or swallows. `index.ts` wires `mediaWorker.on("failed", (job, err) => reportMediaFailure(err, { mediaId: job?.data?.mediaId, attempts: job?.attemptsMade }))` and bounds worker concurrency at 2 (Pitfall 6).
- **MEDIA-04 integration guarantees over real PG16 + mock S3:** `media-integration.test.ts` proves idempotency (two `processMedia` runs → exactly one media row, an identical variants map, identical variantKey set), recoverability (an injected `getOriginal`/`putVariant` throw → the row stays `variants={}`, then a clean rerun populates it — A1, no partial map), and the role-guard (write-back runs as `app_authenticated` with `rolsuper=false`/`rolbypassrls=false`; a foreign-org `organizationId` writes nothing via RLS default-deny — A8).
- **Worker integration harness:** `tests/db.ts` (owner/app URL plumbing + `requireTestDb` `_test`-name guard that never logs the value, reusing `createOwnerDb` from `@imbau/db`), `tests/setup.ts` (globalSetup: idempotent migrate as owner against the `@imbau/db` journal + `assertUnprivileged` that fails the whole suite if the app connection can bypass RLS), and `tests/helpers.ts` (replicated `makeOrg`/`makeProject`/`makeMedia` owner fixtures).
- **Retries/dedup documented, not reconfigured:** `jobId=mediaId` dedup + `attempts=5` + exponential backoff come from the 02-01 producer (`mediaJobOptions`); this plan verifies them through the data-level idempotency proof rather than re-asserting BullMQ options in the worker.
- Full worker suite verified green at this base: 7 files / 27 tests, typecheck + lint clean, against real local Postgres 16 + an in-memory mock S3.

## Task Commits

Each task was committed atomically:

1. **Task 1: reportMediaFailure (Sentry + pino) + `failed` handler wiring** - `286984e` (feat) — 2/2 pure spy tests (Sentry + pino both receive err/mediaId/attempts/queue; never swallowed).
2. **Task 2: Worker integration harness + idempotency/recoverability/role-guard (PG16 + mock S3)** - `070f862` (test) — 3/3 integration tests green.
3. **Task 3: Cloudflare R2 provisioning + real end-to-end staging smoke** - **DEFERRED** (human-verification item; see "Deferred / Human Verification Required" below). No code; gates only the staging smoke, never CI.

_TDD note: both autonomous tasks were `tdd="true"`. Task 1 authored the spy test alongside `reportMediaFailure`; Task 2 landed as a `test(...)` commit (the harness + the three MEDIA-04 proofs), matching the 02-01/02-02 convention of committing test + supporting implementation once green per task._

## Files Created/Modified
- `apps/worker/src/media.ts` - added `reportMediaFailure` (Sentry + pino; reports, never swallows)
- `apps/worker/src/index.ts` - `mediaWorker.on("failed", …)` → `reportMediaFailure`; concurrency bounded at 2
- `apps/worker/src/media-failure.test.ts` - pure spy test (no Redis/Postgres/R2)
- `apps/worker/tests/db.ts` - owner/app URL plumbing + `requireTestDb` `_test` guard (reuses `createOwnerDb`)
- `apps/worker/tests/setup.ts` - globalSetup: idempotent migrate (owner) + `assertUnprivileged` app_authenticated role-guard
- `apps/worker/tests/helpers.ts` - `makeOrg`/`makeProject`/`makeMedia` owner fixtures (replicated from packages/db)
- `apps/worker/tests/media-integration.test.ts` - idempotency + recoverability + role-guard (PG16 + mock S3)
- `apps/worker/vitest.config.ts` - `globalSetup: ["./tests/setup.ts"]` + `include` extended to `tests/**/*.test.ts`
- `apps/worker/tsconfig.json` - `include` extended to `tests/**/*.ts` + `vitest.config.ts`

## Decisions Made
- **Retries/dedup verified, not re-implemented:** the worker does not reconfigure `jobId`/`attempts`/`backoff` — those are the 02-01 producer's `mediaJobOptions`. 02-03 proves the *observable consequence* (idempotency of the data) instead of re-asserting BullMQ config the worker doesn't own.
- **`reportMediaFailure` is a top-level exported function** rather than an inline `on("failed")` closure, so the spy test invokes it directly with mocked `Sentry`/`logger` — no Redis or live Worker needed for the observability proof.
- **Replicated the 3 fixtures instead of importing `packages/db/tests/*`:** those test helpers are not exported across package boundaries, so `makeOrg`/`makeProject`/`makeMedia` were mirrored into `apps/worker/tests/helpers.ts`.
- **Task 3 (real-R2 staging smoke) DEFERRED by user decision:** tracked as a pending human-verification item, not a completion blocker. The automated path is fully covered by the mock-S3 + real-Postgres suites; the live smoke closes the loop once Cloudflare R2 + staging secrets exist.

## Deviations from Plan

None - the two autonomous tasks executed exactly as written. Task 3 was a `checkpoint:human-verify` (gate="blocking") that the user explicitly resolved by **deferring** the real-R2 staging smoke; this is a checkpoint resolution, not an implementation deviation.

## Issues Encountered
None during the autonomous tasks. The only open item is environmental, not a code problem: the real-R2 end-to-end smoke cannot run until Cloudflare R2 is provisioned and staging secrets are loaded (see below).

## Deferred / Human Verification Required

**Task 3 — Cloudflare R2 provisioning + real end-to-end staging smoke — DEFERRED (pending human-verification item).**

This is the only outstanding item for this plan and it is intentionally **not** a completion blocker (user decision). CI and local runs fully cover the pipeline logic with an in-memory mock S3 + real Postgres 16; CI never touches a live R2 bucket or a Cloudflare token. The remaining manual smoke, to be run by a human once infra exists:

1. **Provision Cloudflare R2** (Cloudflare Dashboard → R2): create the ImBau bucket, an API token (access key/secret), enable public access (custom domain or `r2.dev`), and add a CORS policy allowing the presigned `PUT` from the panel origin.
2. **Load staging secrets** (SOPS/CI, never in git): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, plus the worker's `DATABASE_APP_URL` (role `app_authenticated`) alongside `DATABASE_URL`/`DATABASE_ANON_URL`.
3. **Run the end-to-end smoke** in staging: upload a real image (via `createUpload`/`confirmUpload` or `registerAndEnqueue`) and confirm (a) the original lands under `originals/…` in R2, (b) the worker writes variants under `variants/{mediaId}/{width}.{avif|webp}`, (c) the `media` row gets `variants`/`blurhash`/`width`/`height` populated, and (d) variants are served from `R2_PUBLIC_BASE_URL` (`resolveMedia` resolves them for web/panel).
4. **Force a failure** (e.g. a temporarily invalid R2 token) and confirm the error reaches Sentry + the pino logs and the row stays `variants={}` (recoverable), never partial.

**Resume signal:** write "approved" when the staging smoke passes, or describe any provisioning/CORS/token/public-domain problems found.

## User Setup Required

**External service requires manual configuration (deferred, non-blocking).** Cloudflare R2 must be provisioned (bucket + API token + public domain + CORS) and the `R2_*` + worker `DATABASE_APP_URL` staging secrets loaded before the real end-to-end smoke (Task 3 above) can run. None of this is required for CI, typecheck, lint, or the local/CI test suites, which use a mock S3.

## Next Phase Readiness
- **MEDIA-04 is satisfied in code and proven by tests:** the media job is idempotent, retries via the producer's `mediaJobOptions`, reports failures observably (Sentry + pino), and never leaves the media inconsistent (`variants={}` recoverable). The app_authenticated role-guard (A8) and recoverability (A1) are both covered by `media-integration.test.ts`.
- **Downstream phases** (explorador/ficha, panel) can rely on the worker producing complete, RLS-correct variant maps and on failures being observable rather than silent.
- **Only open thread:** the deferred real-R2 staging smoke (Task 3), tracked for staging/infra work — not a blocker for phase completion.

---
*Phase: 02-pipeline-de-media-r2-sharp-blurhash*
*Completed: 2026-06-30*

## Self-Check: PASSED
All 5 created files verified present (`apps/worker/src/media-failure.test.ts`, `apps/worker/tests/{db,setup,helpers,media-integration}.ts`); both autonomous task commits (`286984e`, `070f862`) verified in git log. Task 3 (real-R2 staging smoke) is the single DEFERRED human-verification item, recorded above — automated coverage (D1–D5) fully verified.
