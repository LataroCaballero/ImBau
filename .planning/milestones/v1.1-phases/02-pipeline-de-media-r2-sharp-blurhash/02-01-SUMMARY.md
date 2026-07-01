---
phase: 02-pipeline-de-media-r2-sharp-blurhash
plan: 01
subsystem: api
tags: [r2, s3, cloudflare, aws-sdk, bullmq, ioredis, presigned-upload, rls, trpc, zod, blurhash, srcset]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: "media table (organization_id, project_id, original_key, variants jsonb, width/height/blurhash) + media_tenant RLS policy"
  - phase: 00-foundation
    provides: "withTenant/withAnon RLS seam, protectedProcedure (session-derived activeOrgId), tRPC appRouter, @imbau/config env presets, BullMQ/ioredis worker pattern"
provides:
  - "@imbau/storage package: makeR2Client (R2 checksum opt-out), originalKey/variantKey (pure server-owned keys), MEDIA_QUEUE + MediaJobData + mediaJobOptions (BullMQ contract, no bullmq dep)"
  - "r2Env preset (R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL)"
  - "resolveMedia + ResolvedMedia (pure MEDIA-05 resolver) exported from @imbau/db"
  - "media tRPC router (createUpload/confirmUpload) + media/runtime (presignPut/headOriginal/enqueueMedia/r2Bucket) + registerAndEnqueue/insertMediaRow Node convergence helpers"
affects: [02-02-worker-sharp-pipeline, 03-cotizador-seed, explorador-ficha]

# Tech tracking
tech-stack:
  added: ["@aws-sdk/client-s3 3.1076.0", "@aws-sdk/s3-request-presigner 3.1076.0", "bullmq 5.78.1 (api)", "ioredis 5.10.1 (api)", "@imbau/storage (new private package)"]
  patterns:
    - "R2 S3Client with requestChecksumCalculation/responseChecksumValidation = WHEN_REQUIRED (R2 rejects the default CRC32 trailer)"
    - "Presigned-create / confirm-enqueue two-phase upload: server-derived key + org, HeadObject before enqueue (no orphan jobs)"
    - "Lazy/memoized runtime: env validated + R2/Redis clients built on first use, so importing the router never requires R2/Redis env nor opens a socket"
    - "Pure output resolver in @imbau/db (no env/DB/Redis; publicBaseUrl by param) consumable by web (anon) and panel (auth)"

key-files:
  created:
    - "packages/storage/package.json, tsconfig.json"
    - "packages/storage/src/r2-client.ts, keys.ts, queue.ts, index.ts, keys.test.ts"
    - "packages/db/src/resolve-media.ts"
    - "packages/db/tests/resolve-media.test.ts"
    - "packages/api/src/media/runtime.ts, register.ts"
    - "packages/api/src/trpc/routers/media.ts"
    - "packages/api/tests/media-router.test.ts"
  modified:
    - "packages/config/env/presets.ts (r2Env)"
    - "packages/db/src/index.ts (barrel: resolveMedia + ResolvedMedia)"
    - "packages/api/src/trpc/routers/_app.ts (media router)"
    - "packages/api/package.json (aws-sdk/bullmq/ioredis/@imbau/storage deps)"
    - "pnpm-workspace.yaml + pnpm-lock.yaml (aws-sdk minimumReleaseAgeExclude entries)"

key-decisions:
  - "A5: built BOTH paths — the Node registerAndEnqueue core AND the presigned tRPC endpoints (tested, no UI this milestone)"
  - "A6: public serving via R2_PUBLIC_BASE_URL prepended to keys; no signed GET"
  - "R2 checksum opt-out via S3Client config (not version pin) per RESEARCH Pattern 1"
  - "media/runtime uses lazy memoized init instead of auth/runtime's eager import-time validation (Rule 3 fix — see Deviations)"

patterns-established:
  - "Shared queue contract package (@imbau/storage) with no bullmq dependency — producer (api) and consumer (worker) import the same const+type+options"
  - "insertMediaRow shared between the tRPC createUpload mutation and the seed registerAndEnqueue helper (single server-derived-key insert under withTenant)"
  - "Content-type allowlist via z.enum (image/jpeg|png|webp|avif) rejecting SVG at the tRPC boundary"

requirements-completed: [MEDIA-01, MEDIA-05]

coverage:
  - id: D1
    description: "@imbau/storage: R2 client with checksum opt-out + pure deterministic key/queue helpers"
    requirement: MEDIA-01
    verification:
      - kind: unit
        ref: "packages/storage/src/keys.test.ts (originalKey/variantKey/MEDIA_QUEUE/mediaJobOptions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "r2Env preset declares the five R2_* env names with Zod schemas (names only, never values)"
    requirement: MEDIA-01
    verification:
      - kind: other
        ref: "grep 'export const r2Env' packages/config/env/presets.ts; @imbau/api typecheck consumes it"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveMedia maps a media row to ResolvedMedia (isReady, originalUrl, sources.avif/webp by width, srcset); empty variants → placeholder"
    requirement: MEDIA-05
    verification:
      - kind: unit
        ref: "packages/db/tests/resolve-media.test.ts (populated + empty variants)"
        status: pass
    human_judgment: false
  - id: D4
    description: "media.createUpload inserts a media row under RLS (server-derived org+key) and returns a presigned PUT URL"
    requirement: MEDIA-01
    verification:
      - kind: integration
        ref: "packages/api/tests/media-router.test.ts (inserts row for caller's org + returns presigned putUrl; SVG rejected)"
        status: pass
    human_judgment: false
  - id: D5
    description: "media.confirmUpload HeadObjects the original and enqueues only if bytes exist (no orphan jobs), with a server-derived job payload"
    requirement: MEDIA-01
    verification:
      - kind: integration
        ref: "packages/api/tests/media-router.test.ts (HeadObject + enqueue payload; no-enqueue when bytes missing)"
        status: pass
    human_judgment: false
  - id: D6
    description: "End-to-end against a REAL Cloudflare R2 bucket (presigned PUT actually stores; public URL serves) — requires provisioned bucket + token + CORS + public domain"
    verification: []
    human_judgment: true
    rationale: "All automated tests mock S3/R2 (no live infra by plan prohibition). Real-R2 upload/serve cannot be verified until the bucket, API token, CORS, and public base URL are provisioned in the Cloudflare dashboard (Runtime State Inventory — human/infra step)."

# Metrics
duration: ~75min
completed: 2026-06-30
status: complete
---

# Phase 2 Plan 01: Media transport + entry (MEDIA-01) and output resolver (MEDIA-05) Summary

**R2 presigned-upload pipeline: a new @imbau/storage package (checksum-opt-out S3 client + deterministic keys + BullMQ queue contract), a pure resolveMedia srcset/blurhash resolver in @imbau/db, and a media tRPC router (createUpload/confirmUpload) with server-derived keys, SVG rejection, and HeadObject-before-enqueue — all tested with S3 + Redis mocked.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-06-30T14:40:00Z
- **Completed:** 2026-06-30T15:55:00Z
- **Tasks:** 3
- **Files modified:** 17 (11 created, 6 modified)

## Accomplishments
- New private package `@imbau/storage`: `makeR2Client` (the load-bearing R2 checksum opt-out), pure `originalKey`/`variantKey`, and the `MEDIA_QUEUE`/`MediaJobData`/`mediaJobOptions` BullMQ contract shared by api (producer) and worker (consumer) — with NO bullmq dependency.
- `r2Env` preset (five R2_* vars, names + Zod only) added to `@imbau/config`.
- Pure `resolveMedia(row, { publicBaseUrl })` in `@imbau/db` (MEDIA-05): parses `{fmt}-{width}` variant keys into ordered `sources.avif/webp` + `srcset` strings; empty variants → `isReady:false` placeholder that never breaks an `<img>`.
- `media` tRPC router with `createUpload` (validate → insert under `withTenant` → presign) and `confirmUpload` (RLS lookup → HeadObject → enqueue), plus `media/runtime` (presignPut/headOriginal/enqueueMedia) and `registerAndEnqueue`/`insertMediaRow` for the Phase-3 seed.
- All three suites green with R2 + BullMQ mocked: storage 7 tests, db 22 (incl. 8 resolve-media + the existing cross-tenant gate), api 12 (incl. 5 media-router).

## Task Commits

Each task was committed atomically:

1. **Task 1: @imbau/storage package + r2Env preset** - `4c5c40e` (feat)
2. **Task 2: pure resolveMedia resolver in @imbau/db (MEDIA-05)** - `e47f765` (feat)
3. **Task 3: media tRPC router + runtime + registerAndEnqueue (MEDIA-01)** - `b4b6cb4` (feat)

_TDD note: the three tasks were `tdd="true"`; the pure helpers (keys, resolveMedia) and the router were authored test-first and committed once green per task (the behavior tests live alongside each implementation in the same commit)._

## Files Created/Modified
- `packages/storage/src/r2-client.ts` - `makeR2Client(env)` S3Client with WHEN_REQUIRED checksum opt-out
- `packages/storage/src/keys.ts` - pure `originalKey`/`variantKey` (server-owned, deterministic)
- `packages/storage/src/queue.ts` - `MEDIA_QUEUE`, `MediaJobData`, `mediaJobOptions` (no bullmq dep)
- `packages/storage/src/index.ts` - barrel; `packages/storage/src/keys.test.ts` - 7 unit tests
- `packages/config/env/presets.ts` - added `r2Env` (R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL)
- `packages/db/src/resolve-media.ts` - `resolveMedia` + `ResolvedMedia` (pure); `packages/db/src/index.ts` re-exports them
- `packages/db/tests/resolve-media.test.ts` - 8 unit tests (populated + empty variants)
- `packages/api/src/media/runtime.ts` - lazy/memoized R2 + BullMQ verbs (presignPut/headOriginal/enqueueMedia/r2Bucket)
- `packages/api/src/media/register.ts` - `insertMediaRow` + `registerAndEnqueue`
- `packages/api/src/trpc/routers/media.ts` - createUpload/confirmUpload; `_app.ts` registers `media`
- `packages/api/tests/media-router.test.ts` - 5 integration tests (S3/BullMQ mocked)
- `packages/api/package.json` - aws-sdk client-s3 + s3-request-presigner 3.1076.0, @imbau/storage, bullmq, ioredis

## Decisions Made
- **A5 (both paths):** shipped the Node `registerAndEnqueue` core AND the presigned tRPC endpoints, tested, no UI this milestone.
- **A6 (public serving):** `resolveMedia` builds URLs by prepending `R2_PUBLIC_BASE_URL` to stored keys; no signed GET.
- **Checksum opt-out via config** (`requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"`) rather than pinning an old aws-sdk — keeps other SDK fixes (RESEARCH Pattern 1 / Pitfall 1).
- **MAX_UPLOAD_BYTES = 25 MiB** declared-size ceiling at the createUpload boundary (DoS defense; the worker also caps decode pixels in 02-02). [ASSUMED — tunable]

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] media/runtime made lazy/memoized instead of eager (auth/runtime-style) init**
- **Found during:** Task 3 (media router + runtime)
- **Issue:** The plan said to mirror `auth/runtime`, which validates env at module import. But the `appRouter` composes the media router, and `trpc-tenant.test.ts` (plus the web/panel apps and any RSC type import) imports the appRouter WITHOUT mocking `media/runtime`. Eager `createEnv` at import made `trpc-tenant.test.ts` fail (missing `R2_PUBLIC_BASE_URL`/`REDIS_URL`) and would have opened a live Redis socket merely by importing the router — wrong for a path that may never enqueue.
- **Fix:** Refactored `media/runtime.ts` to validate env and build the R2 client + BullMQ Queue lazily on first use (memoized). Env still fails CLOSED on the first `presignPut`/`headOriginal`/`enqueueMedia` call (with the variable NAME, never the value). The standalone `R2_BUCKET` value export became `r2Bucket()` (lazy; no external consumer) and the test mock was updated to match.
- **Files modified:** `packages/api/src/media/runtime.ts`, `packages/api/tests/media-router.test.ts`
- **Verification:** `trpc-tenant.test.ts` green again; full api suite 12/12; importing the appRouter requires no R2/Redis env.
- **Committed in:** `b4b6cb4` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The lazy-init change preserves the planned public surface (presignPut/headOriginal/enqueueMedia) and the fail-closed guarantee while fixing a module-load side effect that broke a sibling suite. The only surface change is `R2_BUCKET` const → `r2Bucket()` accessor (internal-only). No scope creep.

## Issues Encountered
- **Local Node default is 20, project requires >=22.** Resolved by `nvm use 22` (Node 22.22.3 + pnpm 11.6) for all install/test/typecheck/lint runs.
- **DB-backed test suites need a running Postgres `_test` DB.** Postgres (localhost:5432, user imbau/dev) and Redis were already up via Docker; reused the CI env contract (`TEST_DATABASE_*` / `DATABASE_*` for app_authenticated:dev / anon:dev, `BETTER_AUTH_*`) to run `@imbau/db` and `@imbau/api` suites green locally.

## User Setup Required
**External services require manual configuration** before real-R2 (non-mocked) verification and before deploying the media pipeline:
- Provision a Cloudflare R2 bucket + API token (access key/secret), a public access binding (custom domain or r2.dev), and CORS allowing presigned PUT from the panel origin.
- Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (SOPS/CI secrets, never hardcoded). The worker additionally needs `DATABASE_APP_URL` in plan 02-02.
- These are flagged in 02-RESEARCH Runtime State Inventory as a human/infra step; coverage deliverable **D6** routes to human verification for this reason.

## Next Phase Readiness
- **02-02 (worker sharp pipeline)** can consume `@imbau/storage` (MEDIA_QUEUE/MediaJobData/mediaJobOptions, makeR2Client, variantKey) and write back via `withTenant` — no new dependency edges or cycles (@imbau/storage does not depend on @imbau/db).
- **Phase 3 seed** can call `registerAndEnqueue` to converge the direct-PutObject path with the same insert+enqueue core.
- **Blocker (verification only, not code):** real-R2 end-to-end is gated on the Cloudflare bucket/token/CORS/public-domain provisioning above.

---
*Phase: 02-pipeline-de-media-r2-sharp-blurhash*
*Completed: 2026-06-30*

## Self-Check: PASSED
All 12 created files verified present; all 4 commits (4c5c40e, e47f765, b4b6cb4, ea1bb1a) verified in git log.
