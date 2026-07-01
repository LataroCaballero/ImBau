---
phase: 02-pipeline-de-media-r2-sharp-blurhash
plan: 02
subsystem: worker
tags: [sharp, blurhash, bullmq, r2, s3, aws-sdk, drizzle, rls, withTenant, srcset, avif, webp]

# Dependency graph
requires:
  - phase: 02-01-media-transport-entry
    provides: "@imbau/storage (makeR2Client, variantKey, MEDIA_QUEUE/MediaJobData/mediaJobOptions) + media table with variants/width/height/blurhash + media_tenant RLS policy"
  - phase: 01-schema-media-seed
    provides: "media table + media_tenant FOR ALL TO app_authenticated policy (default-deny for owner)"
  - phase: 00-foundation
    provides: "withTenant RLS seam (set_config GUC), @imbau/config env presets (r2Env/dbEnv), BullMQ/ioredis worker shell + partitions.ts pure/impure split"
provides:
  - "apps/worker media pipeline: renderVariants (pure sharp AVIF/WebP srcset + blurhash) + processMedia (download-once R2 → sequential upload → single withTenant UPDATE)"
  - "media-variants.ts: pickWidths (no upscale) + QUALITY + BREAKPOINTS (pure helpers)"
  - "media-runtime.ts: worker R2 wrapper (getOriginal/putVariant/R2_BUCKET via makeR2Client)"
  - "media-store.ts: writeVariants — the worker's SOLE write seam, app_authenticated via withTenant"
  - "createMediaWorker + mediaQueue wired into boot() consuming MEDIA_QUEUE"
  - "worker env A8: r2Env + dbEnv (three DATABASE_* URLs) composed; vitest.config.ts injecting test env"
affects: [02-03-idempotency-retries-observability, explorador-ficha, 03-cotizador-seed]

# Tech tracking
tech-stack:
  added: ["sharp 0.35.2 (worker)", "blurhash 2.0.5 (worker)", "@aws-sdk/client-s3 3.1076.0 (worker)", "drizzle-orm 0.45.2 (worker)", "@imbau/db (workspace:* into worker)", "@imbau/storage (workspace:* into worker)"]
  patterns:
    - "Pure render (renderVariants: Buffer→buffers, real sharp/blurhash, no I/O) + thin impure executor (processMedia: the only side effect) — same split as partitions.ts"
    - "Worker write-back via withTenant(organizationId-from-payload) as app_authenticated — NEVER owner/BYPASSRLS (media_tenant default-deny for owner)"
    - "Download-once → sequential per-variant encode/upload → single atomic UPDATE with the complete variants map (A1: never a half-written row)"
    - "Deterministic variantKey(mediaId,fmt,width) → retry overwrites in place, never duplicates"
    - "Per-package vitest.config.ts injecting test.env so import-time @imbau/db env validation + env.ts run with dummy R2 + lazy DB (no real infra for unit/mocked suites)"

key-files:
  created:
    - "apps/worker/src/media-variants.ts (pickWidths, QUALITY, BREAKPOINTS — pure)"
    - "apps/worker/src/media-variants.test.ts (8 pure unit tests)"
    - "apps/worker/src/media-runtime.ts (R2 get/put wrapper, makeR2Client once)"
    - "apps/worker/src/media-store.ts (writeVariants → withTenant UPDATE, sole write seam)"
    - "apps/worker/src/media.ts (renderVariants pure + processMedia executor)"
    - "apps/worker/src/media.test.ts (4 pure renderVariants + 2 processMedia orchestration tests)"
    - "apps/worker/vitest.config.ts (test.env injection)"
  modified:
    - "apps/worker/package.json (sharp/blurhash/aws-sdk/drizzle-orm/@imbau/db/@imbau/storage deps)"
    - "apps/worker/src/env.ts (A8: compose r2Env + dbEnv)"
    - "apps/worker/src/env.test.ts (mirror r2Env + dbEnv surface)"
    - "apps/worker/src/index.ts (createMediaWorker + mediaQueue in boot())"
    - "apps/worker/tsconfig.json (include vitest.config.ts for the lint/type project service)"
    - "pnpm-lock.yaml"

key-decisions:
  - "A8: worker now imports @imbau/db + carries all THREE DATABASE_* URLs (import-time validation), even though the write-back uses only DATABASE_APP_URL via withTenant"
  - "A1: variants/blurhash/width/height persisted in ONE withTenant UPDATE after all PutObjects succeed — no incremental writes, no half-processed DB state"
  - "media-runtime builds the S3Client at module import (worker IS the consumer, env validated at boot) — unlike api/media/runtime which is lazy/memoized because the appRouter imports it on non-enqueue paths"
  - "sharp reports AVIF as format 'heif' (HEIF container) — test asserts format ∈ {heif, avif}"

patterns-established:
  - "Worker pure/impure split mirrors partitions.ts: testable CPU core + thin executor owning all I/O via mockable seams (media-runtime, media-store)"
  - "RLS-correct worker write: organizationId from job payload → withTenant GUC → app_authenticated UPDATE satisfying media_tenant.withCheck (no session in the worker)"
  - "vitest.config.ts test.env preserves real CI/local DATABASE_*/REDIS_URL via process.env.X ?? dummy, so the same suite runs with or without live infra"

requirements-completed: [MEDIA-02, MEDIA-03]

coverage:
  - id: D1
    description: "pickWidths selects srcset widths without upscaling (dedupe + ascending sort; srcWidth<=0 → []); QUALITY = avif{50,4}/webp{80}"
    requirement: MEDIA-02
    verification:
      - kind: unit
        ref: "apps/worker/src/media-variants.test.ts (pickWidths no-upscale/clamp/dedupe/sort/empty + QUALITY)"
        status: pass
    human_judgment: false
  - id: D2
    description: "renderVariants produces decodable AVIF+WebP at each non-upscaled width with correct source dims (MEDIA-02)"
    requirement: MEDIA-02
    verification:
      - kind: unit
        ref: "apps/worker/src/media.test.ts (renderVariants: real sharp, each buffer decodes as format at requested width ≤ source; dims)"
        status: pass
    human_judgment: false
  - id: D3
    description: "blurhash (4×3) + width/height computed and round-trippable to a w*h*4 RGBA buffer (MEDIA-03)"
    requirement: MEDIA-03
    verification:
      - kind: unit
        ref: "apps/worker/src/media.test.ts (blurhash decode → Uint8ClampedArray length w*h*4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "processMedia downloads the original ONCE, uploads each deterministic variantKey, and writes the COMPLETE variants map + blurhash + dims in a single writeVariants call (MEDIA-02/03, A1)"
    requirement: MEDIA-02
    verification:
      - kind: integration
        ref: "apps/worker/src/media.test.ts (R2 + store mocked: getOriginal×1, putVariant per variantKey, single writeVariants with complete payload; write-after-all-uploads)"
        status: pass
    human_judgment: false
  - id: D5
    description: "writeVariants runs the write-back as app_authenticated via withTenant(organizationId) — never owner/BYPASSRLS (A8)"
    requirement: MEDIA-03
    verification:
      - kind: other
        ref: "grep withTenant in apps/worker/src/media-store.ts; the role-guard proving app_authenticated (not owner) is scheduled for 02-03"
        status: pass
    human_judgment: false
  - id: D6
    description: "End-to-end against a REAL Cloudflare R2 bucket + Postgres: a confirmed upload is processed into actual AVIF/WebP objects and a real media row UPDATE"
    verification: []
    human_judgment: true
    rationale: "All automated tests mock R2 (media-runtime) and DB (media-store) by plan prohibition. Real-R2 + real-DB processing cannot be verified until the Cloudflare bucket/token/CORS/public domain (02-01 D6 infra step) is provisioned AND the worker carries DATABASE_APP_URL; the role-guard integration test lands in 02-03."

# Metrics
duration: ~10min
completed: 2026-06-30
status: complete
---

# Phase 2 Plan 02: Worker sharp pipeline (MEDIA-02) + blurhash/dims (MEDIA-03) Summary

**The BullMQ media worker: pure `renderVariants` (real sharp → AVIF/WebP srcset at non-upscaled widths + blurhash 4×3 from a 32×32 raster) and a thin `processMedia` executor that downloads the original once, uploads each variant to a deterministic R2 key, and persists the complete variants map + blurhash + dimensions in ONE `withTenant` UPDATE as `app_authenticated` — all tested with R2 and Postgres mocked.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-30T16:05:59Z
- **Completed:** 2026-06-30T16:15:01Z
- **Tasks:** 2
- **Files modified:** 13 (7 created, 6 modified)

## Accomplishments
- `media-variants.ts` — pure `pickWidths` (filters breakpoints below the source, adds a single source clamp, dedupes + sorts ascending; `srcWidth<=0 → []`; never upscales) + `QUALITY` (avif quality 50/effort 4, webp quality 80) + `BREAKPOINTS`.
- `media.ts` — `renderVariants` (CPU-pure: source dims → per width × {avif,webp} a fresh `sharp(input).rotate().resize({withoutEnlargement}).{fmt}().toBuffer()`, sequential to bound memory; blurhash 4×3 from a 32×32 RGBA raster) and `processMedia` (the ONLY side effect: `getOriginal` once → sequential `putVariant` per deterministic `variantKey` → single `writeVariants`).
- `media-store.ts` — `writeVariants`, the worker's SOLE write seam: one atomic `withTenant(organizationId, …).update(media)` as `app_authenticated`, satisfying `media_tenant` (never owner/BYPASSRLS).
- `media-runtime.ts` — worker R2 wrapper building the checksum-opt-out `S3Client` once via `makeR2Client`, exposing `getOriginal`/`putVariant`/`R2_BUCKET`.
- `index.ts` — `createMediaWorker<MediaJobData>` (concurrency 2) + `mediaQueue` on `MEDIA_QUEUE` registered in `boot()`.
- `env.ts` (A8) — composes `r2Env` + `dbEnv` (three DATABASE_* URLs, required by the `@imbau/db` import); `vitest.config.ts` injects dummy R2 + lazy DB so worker suites need no real infra.
- All 22 worker tests green (media-variants 8, media 6, env 2, plus the existing index live-Redis smoke + partitions), typecheck + lint clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Deps + env A8 + media-variants (pure) + media-runtime (R2 wrapper)** - `acd7af0` (feat)
2. **Task 2: media.ts (renderVariants + processMedia) + media-store (withTenant) + Worker wiring** - `0f3825a` (feat)

_TDD note: both tasks were `tdd="true"`; pure helpers + the executor were authored with their behavior tests and committed once green per task (test + implementation in the same commit, matching the 02-01 convention)._

## Files Created/Modified
- `apps/worker/src/media-variants.ts` - pure `pickWidths`/`QUALITY`/`BREAKPOINTS`
- `apps/worker/src/media-variants.test.ts` - 8 pure unit tests
- `apps/worker/src/media-runtime.ts` - R2 get/put wrapper (`makeR2Client` once)
- `apps/worker/src/media-store.ts` - `writeVariants` (sole write seam, withTenant)
- `apps/worker/src/media.ts` - `renderVariants` (pure) + `processMedia` (executor)
- `apps/worker/src/media.test.ts` - 4 pure renderVariants + 2 processMedia orchestration tests
- `apps/worker/vitest.config.ts` - per-package config injecting test env (R2 dummy + lazy DB)
- `apps/worker/package.json` - sharp/blurhash/aws-sdk/drizzle-orm/@imbau/db/@imbau/storage deps (exact pins)
- `apps/worker/src/env.ts` - A8: compose `r2Env` + `dbEnv`
- `apps/worker/src/env.test.ts` - mirror the new composed surface (R2_BUCKET in the missing case)
- `apps/worker/src/index.ts` - `createMediaWorker` + `mediaQueue` in `boot()`
- `apps/worker/tsconfig.json` - include `vitest.config.ts` (lint project service)
- `pnpm-lock.yaml` - new worker deps

## Decisions Made
- **A8 (worker gains DB access):** the worker imports `@imbau/db` (via `media-store`) and therefore carries all three DATABASE_* URLs, because `@imbau/db`'s env module validates them and builds the app/anon pools at IMPORT time. Only `DATABASE_APP_URL` is role-bearing for the write-back (via `withTenant`), but all three must be present or the import throws.
- **A1 (single atomic write):** `processMedia` accumulates the full variants map in memory and writes it once, only after every `putVariant` resolves — a crash before that leaves `variants='{}'` / dims NULL (the recoverable pre-processing state), never a half-written row.
- **media-runtime is eager (not lazy like api/media/runtime):** the worker IS the media consumer and has already validated `R2_*` at boot via `./env`, so constructing the `S3Client` at module import is correct here.
- **AVIF metadata format:** sharp reports AVIF buffers as `format: 'heif'` (HEIF container), so `media.test.ts` asserts the decoded format ∈ `{heif, avif}`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `vitest.config.ts` added to `apps/worker/tsconfig.json` include**
- **Found during:** Task 1 (lint gate)
- **Issue:** ESLint's typed-lint project service could not find the new `apps/worker/vitest.config.ts` ("was not found by the project service"), failing `pnpm --filter @imbau/worker lint`. The plan specified creating the vitest config but the worker tsconfig `include` did not cover it (unlike `packages/db/tsconfig.json`, which lists `vitest.config.ts`).
- **Fix:** Added `"vitest.config.ts"` to the worker tsconfig `include` array, matching the db package convention.
- **Files modified:** `apps/worker/tsconfig.json`
- **Verification:** `pnpm --filter @imbau/worker lint` and `typecheck` both clean.
- **Committed in:** `acd7af0` (Task 1 commit)

**2. [Rule 1 - Bug] `noUncheckedIndexedAccess` on the largest-breakpoint access**
- **Found during:** Task 1 (typecheck)
- **Issue:** `BREAKPOINTS[BREAKPOINTS.length - 1]` is typed `number | undefined` under `noUncheckedIndexedAccess`, failing `tsc`.
- **Fix:** Derived `LARGEST_BREAKPOINT = Math.max(...BREAKPOINTS)` once at module level and used it for the source clamp (keeps BREAKPOINTS the single source of truth).
- **Files modified:** `apps/worker/src/media-variants.ts`
- **Verification:** `pnpm --filter @imbau/worker typecheck` clean; pickWidths tests still green.
- **Committed in:** `acd7af0` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both were small mechanical fixes to satisfy the existing lint/type gates; no behavior change, no scope change. The pipeline surface matches the plan exactly.

## Issues Encountered
- **Local Node default is 20; project requires >=22.** Resolved by `nvm use 22` (Node 22.22.3 + pnpm 11.6.0) for all install/test/typecheck/lint runs. A transitive `sharp@0.34.5` build appeared during install, but the worker's own `sharp` resolves to the pinned `0.35.2` (verified).
- **Import-time env coupling:** importing `@imbau/db` opens its env validation at import, so the worker suites needed `vitest.config.ts` `test.env` (dummy R2 + lazy DB URLs ending in `_test`, real values preferred when present) to run without live infra — this is the intended A8 design, handled as the plan specified.

## User Setup Required
None new beyond 02-01. Real-R2 + real-DB end-to-end processing remains gated on the Cloudflare bucket/token/CORS/public-domain provisioning (02-01 D6) AND the worker carrying `DATABASE_APP_URL` in its deployed env; the role-guard integration test (app_authenticated, not owner) lands in 02-03.

## Next Phase Readiness
- **02-03 (idempotency, retries, observability)** can consume `processMedia`, `renderVariants`, `media-store.writeVariants`, and the `createMediaWorker`/`mediaQueue` wiring. The `failed` handler (Sentry + pino) and the app_authenticated role-guard are explicitly deferred to 02-03 — the Worker is functional now but reports failures only via BullMQ's default retry (mediaJobOptions: attempts 5 / exponential backoff from the 02-01 producer).
- **Blocker (verification only, not code):** real-R2/real-DB processing is gated on the Cloudflare provisioning + worker DATABASE_APP_URL above.

---
*Phase: 02-pipeline-de-media-r2-sharp-blurhash*
*Completed: 2026-06-30*

## Self-Check: PASSED
All 7 created files verified present; both task commits (acd7af0, 0f3825a) verified in git log.
