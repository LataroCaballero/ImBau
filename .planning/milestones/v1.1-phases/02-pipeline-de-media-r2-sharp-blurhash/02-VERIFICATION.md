---
phase: 02-pipeline-de-media-r2-sharp-blurhash
verified: 2026-06-30T16:55:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Live Cloudflare R2 end-to-end smoke — upload a real image via createUpload/confirmUpload (or registerAndEnqueue), confirm the original lands under originals/… in R2, the worker writes variants under variants/{mediaId}/{width}.{avif|webp}, the media row shows variants/blurhash/width/height populated, and variants are served publicly via R2_PUBLIC_BASE_URL (resolveMedia round-trip for web/panel)."
    expected: "Original object present in R2 bucket. Variant objects present. media row fully populated. Public CDN URL resolves the image bytes."
    why_human: "Requires provisioned Cloudflare R2 bucket + API token + public domain + CORS. CI uses an in-memory mock S3; no live R2 contact is made in any automated test. This is deferred by explicit user decision (documented in 02-03-SUMMARY.md D6, human_judgment:true)."

  - test: "Force a live failure (e.g. temporarily invalid R2 token) in staging and confirm: (a) the error reaches Sentry and the pino log stream, (b) the media row stays variants={} (recoverable), never showing a partial map."
    expected: "Sentry event captured. Structured pino log line present with err/mediaId/queue. Row variants column is {} after the failed job."
    why_human: "Requires live Sentry project wired to staging + a real failed R2 operation. The automated spy test proves the reportMediaFailure code path but cannot confirm real Sentry delivery."
---

# Phase 2: Pipeline de Media R2+Sharp+Blurhash — Verification Report

**Phase Goal:** El pipeline de media opera de punta a punta — una imagen subida a Cloudflare R2 se procesa en el worker generando variantes AVIF/WebP en múltiples tamaños y un placeholder, con keys/dimensiones/blurhash persistidos en `media` y resolubles por web y panel; el job es idempotente, con reintentos y errores observables (Sentry + pino), y nunca deja la media en estado inconsistente.
**Verified:** 2026-06-30T16:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Scope Note

Per the prompt and the phase's own plan (02-03-PLAN.md Task 3, 02-03-SUMMARY.md D6), the real Cloudflare R2 end-to-end staging smoke is **deferred by explicit user decision**. CI and automated tests use a mock S3 (in-memory, via `vi.mock`) plus the real local Postgres 16. The live-R2 confirmation is a human-verification item, not a gap. This verification treats the automated deliverables as the pass condition for all 5 MEDIA-* criteria and surfaces the live-R2 smoke as the single human item.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MEDIA-01: An image upload (via API/presigned) inserts a row in `media` (project + originalKey) | VERIFIED | `packages/api/src/trpc/routers/media.ts` — createUpload inserts via `insertMediaRow → withTenant → schema.media`, server-derived key. SVG blocked at z.enum. confirmUpload HeadObjects before enqueue. 5/5 media-router.test.ts GREEN (incl. row-in-correct-org assertion, server-key assertion, SVG rejection, no-orphan-job). |
| 2 | MEDIA-02: Worker produces AVIF/WebP variants at multiple srcset sizes, referenced from `media` | VERIFIED | `apps/worker/src/media.ts` — `renderVariants` encodes fresh `sharp(input)` per width × {avif,webp} sequentially; `processMedia` downloads original once, uploads to deterministic `variantKey`s, calls `writeVariants` once. `apps/worker/src/media-variants.ts` — `pickWidths` never upscales. 8 media-variants tests + 6 media.test.ts GREEN (decodable AVIF/WebP buffers verified, download-once + single-write orchestration verified). |
| 3 | MEDIA-03: blurhash + width/height calculated and persisted in `media` for LQIP | VERIFIED | `renderVariants` computes blurhash from 32×32 RGBA raster (4×3 components). `writeVariants` persists `{variants, blurhash, width, height}` in one UPDATE. media.test.ts: blurhash round-trip via `decode(...)` → Uint8ClampedArray length w*h*4. Integration test (real PG16): recoverability case asserts `ok.width===800`, `ok.height===600`, `ok.blurhash` truthy. |
| 4 | MEDIA-04: Job is idempotent with retries; failures reported to Sentry + pino (never silenced); never leaves media inconsistent | VERIFIED | `reportMediaFailure` in `media.ts`: calls `Sentry.captureException(err, {extra:{mediaId,attempts}})` + `logger.error({err,mediaId,queue:MEDIA_QUEUE},"media job failed")` — never swallows. `index.ts` wires `mediaWorker.on("failed", …)` → `reportMediaFailure`. `mediaJobOptions` in `@imbau/storage`: jobId=mediaId (dedup), attempts=5, exponential backoff delay 2000ms. 2/2 media-failure.test.ts spy tests GREEN. 3/3 media-integration.test.ts GREEN (real PG16 + mock S3): idempotency (2 runs → 1 row, identical map), recoverability (injected failure → variants={}, no partial map; clean rerun populates), role-guard (app_authenticated, rolsuper/rolbypassrls=false; foreign-org job → default-deny). |
| 5 | MEDIA-05: A helper/API resolves a `media` row to its complete variant set (srcset + blurhash + dims), consumable by web and panel | VERIFIED | `packages/db/src/resolve-media.ts` — pure `resolveMedia(row, {publicBaseUrl})`: parses `{fmt}-{width}` keys, sorts sources by width, assembles srcset strings, empty variants → isReady=false (safe `<img>`). Exported from `@imbau/db` barrel. No I/O (publicBaseUrl by param). 8/8 resolve-media.test.ts GREEN (populated + empty variant cases). |

**Score:** 5/5 truths verified (behavior_unverified: 0)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/storage/src/r2-client.ts` | makeR2Client with WHEN_REQUIRED checksum opt-out | VERIFIED | Both `requestChecksumCalculation` and `responseChecksumValidation` set to `"WHEN_REQUIRED"` — the load-bearing R2 config. |
| `packages/storage/src/keys.ts` | Pure originalKey/variantKey helpers | VERIFIED | `originalKey(orgId,projectId,mediaId,ext)` → `originals/{orgId}/{projectId}/{mediaId}.{ext}`; `variantKey(mediaId,fmt,width)` → `variants/{mediaId}/{width}.{fmt}`. No imports of infra. |
| `packages/storage/src/queue.ts` | MEDIA_QUEUE, MediaJobData, mediaJobOptions | VERIFIED | `MEDIA_QUEUE = "media-processing"`, `mediaJobOptions(mediaId)` returns `{jobId:mediaId, attempts:5, backoff:{type:"exponential",delay:2000}}`. No bullmq import. |
| `packages/storage/src/index.ts` | Barrel for all @imbau/storage exports | VERIFIED | Re-exports makeR2Client, originalKey, variantKey, MEDIA_QUEUE, mediaJobOptions, MediaJobData (type). |
| `packages/storage/src/keys.test.ts` | Unit tests for key helpers | VERIFIED | 7 tests — originalKey format, determinism; variantKey format, determinism; MEDIA_QUEUE value; mediaJobOptions structure. All GREEN. |
| `packages/config/env/presets.ts` (r2Env) | 5 R2_* vars with Zod schemas | VERIFIED | `r2Env.server` declares R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET (z.string().min(1)) and R2_PUBLIC_BASE_URL (z.string().url()). |
| `packages/db/src/resolve-media.ts` | Pure resolveMedia + ResolvedMedia | VERIFIED | 92 lines, no ./client or ./with-tenant import. Parses variant keys, sorts sources, handles empty variants gracefully. |
| `packages/db/src/index.ts` (barrel) | Exports resolveMedia and ResolvedMedia | VERIFIED | Lines 7-8: `export { resolveMedia } from "./resolve-media"; export type { ResolvedMedia } from "./resolve-media";` |
| `packages/db/tests/resolve-media.test.ts` | 8 unit tests for resolveMedia | VERIFIED | Populated variants (isReady=true, sorted sources, correct srcset strings, dims/blurhash passthrough) + empty variants (isReady=false, empty sources, safe for img). All GREEN. |
| `packages/api/src/media/runtime.ts` | Lazy/memoized R2 + BullMQ verbs | VERIFIED | presignPut/headOriginal/enqueueMedia exported; env validated on first use (not at import — rule-3 fix vs auth/runtime); no live socket at import. |
| `packages/api/src/media/register.ts` | insertMediaRow + registerAndEnqueue | VERIFIED | insertMediaRow inserts via withTenant(organizationId), derives key server-side. registerAndEnqueue seeds Phase-3 seed path. |
| `packages/api/src/trpc/routers/media.ts` | createUpload/confirmUpload, SVG blocked | VERIFIED | createUpload: z.enum blocks svg, org from ctx.activeOrgId, key server-derived. confirmUpload: HeadObject before enqueue, RLS scopes SELECT. No app-layer org filter. |
| `packages/api/src/trpc/routers/_app.ts` | `media: mediaRouter` registered | VERIFIED | `import { mediaRouter } from "./media"; … media: mediaRouter` present. |
| `packages/api/tests/media-router.test.ts` | 5 integration tests (mocked S3/BullMQ) | VERIFIED | createUpload inserts row + presigns correctly; confirmUpload HeadObjects + enqueues; SVG rejected; no orphan job when bytes missing. All GREEN. |
| `apps/worker/src/media-variants.ts` | pickWidths, QUALITY, BREAKPOINTS (pure) | VERIFIED | pickWidths never upscales (filters `w < srcWidth`), clamps at LARGEST_BREAKPOINT, dedupes + sorts ascending. QUALITY = {avif:{quality:50,effort:4}, webp:{quality:80}}. No I/O. |
| `apps/worker/src/media-variants.test.ts` | 8 pure unit tests | VERIFIED | pickWidths no-upscale, clamp, dedupe, sort, srcWidth<=0→[]; QUALITY values. All GREEN. |
| `apps/worker/src/media-runtime.ts` | getOriginal/putVariant/R2_BUCKET (R2 wrapper) | VERIFIED | makeR2Client(env) at module import (eager — worker is the consumer, env validated at boot). getOriginal downloads via GetObjectCommand, putVariant uploads via PutObjectCommand. |
| `apps/worker/src/media-store.ts` | writeVariants via withTenant (sole write seam) | VERIFIED | Single `withTenant(organizationId, tx => tx.update(schema.media).set({variants,blurhash,width,height}).where(eq(schema.media.id,mediaId)))`. Never owner/BYPASSRLS. |
| `apps/worker/src/media.ts` | renderVariants (pure) + processMedia (executor) + reportMediaFailure | VERIFIED | renderVariants: CPU-pure, sequential encode, blurhash from 32×32 raster. processMedia: download-once → sequential upload → single writeVariants. reportMediaFailure: Sentry + pino, never swallows. |
| `apps/worker/src/media.test.ts` | 6 tests (renderVariants pure + processMedia orchestration) | VERIFIED | Real sharp AVIF/WebP buffers decode correctly; blurhash round-trip; download-once; single writeVariants; deterministic keys. All GREEN. |
| `apps/worker/src/media-failure.test.ts` | 2 spy tests (Sentry + pino observability) | VERIFIED | Both `Sentry.captureException` and `logger.error` receive correct args (err/mediaId/attempts/queue); undefined context handled gracefully. All GREEN. |
| `apps/worker/src/index.ts` | createMediaWorker + mediaQueue + failed handler wired | VERIFIED | `createMediaWorker` returns Worker<MediaJobData> over MEDIA_QUEUE (concurrency 2); `mediaQueue` in boot(); `mediaWorker.on("failed", …) → reportMediaFailure`. |
| `apps/worker/src/env.ts` | Composes r2Env + dbEnv (A8) | VERIFIED | `...r2Env.server` + `...dbEnv.server` (three DATABASE_* URLs) in the server block. Required because importing @imbau/db triggers its own env validation. |
| `apps/worker/vitest.config.ts` | globalSetup + include tests/** + test.env | VERIFIED | `globalSetup: ["./tests/setup.ts"]`; `include: ["src/**/*.test.ts", "tests/**/*.test.ts"]`; test.env injects dummy R2 vars + lazy DB URLs. |
| `apps/worker/tests/db.ts` | Owner/app URL plumbing + _test guard | VERIFIED | ownerUrl()/appUrl() from env; requireTestDb guard rejects non-`_test` DB name. |
| `apps/worker/tests/setup.ts` | globalSetup: idempotent migrate + assertUnprivileged | VERIFIED | Migrates @imbau/db journal as owner; asserts app connection is app_authenticated with rolsuper/rolbypassrls=false; fails the whole suite if role is privileged. |
| `apps/worker/tests/helpers.ts` | makeOrg/makeProject/makeMedia/getMediaById/countMediaById | VERIFIED | Owner-connection fixtures with randomUUID IDs; getMediaById and countMediaById for assertion queries. |
| `apps/worker/tests/media-integration.test.ts` | 3 integration tests (idempotency/recoverability/role-guard) | VERIFIED | PG16 real + mock S3 (in-memory Map). idempotency: 2 runs → 1 row, identical map/keys. recoverability: injected failure → variants={}, clean rerun → populated. role-guard: app_authenticated confirmed, foreign-org → default-deny. All GREEN. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `media.createUpload` | `schema.media` INSERT | `insertMediaRow → withTenant(ctx.activeOrgId)` | VERIFIED | Row inserted as app_authenticated, org from session, key server-derived |
| `media.confirmUpload` | `enqueueMedia` | `headOriginal` gate — enqueues only if bytes exist | VERIFIED | No orphan jobs: precondition-failed when HeadObject returns false |
| `mediaRouter` | `appRouter` | `_app.ts: media: mediaRouter` | VERIFIED | Registered at line 20 of _app.ts |
| `processMedia` | `writeVariants` | download-once → sequential putVariant → single writeVariants call | VERIFIED | processMedia wires media-runtime + media-store; never calls writeVariants before all putVariants succeed |
| `writeVariants` | Postgres `media` row | `withTenant(organizationId, tx => tx.update(...))` | VERIFIED | Single UPDATE, app_authenticated role, org from job payload |
| `mediaWorker.on("failed")` | `reportMediaFailure` | `index.ts: mediaWorker.on("failed", (job, err) => reportMediaFailure(...))` | VERIFIED | Both Sentry + pino called; never swallowed |
| `resolveMedia` | `@imbau/db` consumers (web + panel) | `packages/db/src/index.ts` barrel re-export | VERIFIED | No cycles; pure function with publicBaseUrl by parameter |
| `r2Env` | `@imbau/config/env/presets.ts` | Imported by api/runtime.ts + worker/env.ts | VERIFIED | Five R2_* names with Zod schemas |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `media.ts::processMedia` | `input` (original bytes) | `getOriginal(originalKey)` from R2 | Yes (real data in integration; mocked in unit) | VERIFIED (mock-S3 in CI; live-R2 is the human item) |
| `media.ts::renderVariants` | `variants`, `blurhash`, `width`, `height` | Pure computation from `input` Buffer via sharp | Yes — real sharp encode, real blurhash | VERIFIED |
| `media-store.ts::writeVariants` | UPDATE to `media.variants/blurhash/width/height` | `withTenant(organizationId, ...)` on real PG16 | Yes — integration test reads back real values | VERIFIED |
| `resolve-media.ts::resolveMedia` | `sources.avif`, `sources.webp`, `srcset` | Parses `row.variants` (a Record<string,string>) | Yes — unit tests assert correct URL construction | VERIFIED |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| storage pure helpers | `pnpm --filter @imbau/storage test --run` | 7/7 tests | PASS |
| resolveMedia pure function + DB cross-tenant | `pnpm --filter @imbau/db test --run` | 22/22 tests | PASS |
| media tRPC router (mocked S3/BullMQ + real PG16) | `pnpm --filter @imbau/api test --run` | 12/12 tests (4 files) | PASS |
| worker full suite (media-variants, media, media-failure, media-integration, env, index) | `pnpm --filter @imbau/worker test --run` | 27/27 tests (7 files) | PASS |

**Total automated coverage: 68/68 tests across 18 test files. All GREEN.**

---

### Probe Execution

No probe scripts declared or detected (`scripts/*/tests/probe-*.sh` absent). Step 7c: SKIPPED — behavioral spot-checks (Step 7b) plus the full test suite runs serve as the equivalent.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MEDIA-01 | 02-01 | Upload via API/presigned → media row + R2 original | VERIFIED | createUpload/confirmUpload tests GREEN; code path fully wired; live-R2 portion → human item |
| MEDIA-02 | 02-02 | Worker produces AVIF/WebP srcset variants → media row | VERIFIED | renderVariants + processMedia tests GREEN; real sharp buffers decoded |
| MEDIA-03 | 02-02 | blurhash + width/height calculated and persisted | VERIFIED | Integration test (PG16) asserts dims and truthy blurhash after clean run |
| MEDIA-04 | 02-03 | Idempotent job, retries, observable failures, never inconsistent | VERIFIED | 3/3 integration tests + 2/2 spy tests GREEN |
| MEDIA-05 | 02-01 | resolveMedia resolves media to srcset+blurhash+dims for web+panel | VERIFIED | 8/8 resolve-media.test.ts GREEN; barrel export confirmed |

No orphaned requirements: REQUIREMENTS.md maps exactly MEDIA-01 through MEDIA-05 to Phase 2, all accounted for.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/worker/src/media.ts` | 30 | Comment uses word "placeholder" | INFO | Refers to LQIP concept (Low Quality Image Placeholder), not a code stub. No code smell — the comment documents the intent of the blurhash feature. |

No `TBD`, `FIXME`, `XXX` markers in any phase source file. No `TODO` markers with unresolved debt (only documentation-intent comments). No stub implementations (empty returns on critical paths). No `return null` / `return []` / `return {}` in non-graceful-degradation positions.

---

### Prohibition Compliance

| Prohibition | File | Compliance |
|-------------|------|------------|
| NO client-supplied R2 keys or organizationIds | `media.ts`, `register.ts` | COMPLIANT — org from ctx.activeOrgId, key from server-minted mediaId |
| NO SVG or non-allowlisted content-types | `media.ts` (router) | COMPLIANT — z.enum blocks image/svg+xml; test asserts BAD_REQUEST |
| NO owner/BYPASSRLS for media INSERT | `register.ts` | COMPLIANT — insertMediaRow uses withTenant only; no createOwnerDb/appDb import |
| NO enqueueing without HeadObject confirmation | `media.ts` (router) | COMPLIANT — confirmUpload gate verified by test |
| NO incremental variants writes | `media.ts` (processMedia) | COMPLIANT — accumulates uploads[], calls writeVariants once at the end |
| NO upscaling variants | `media-variants.ts` | COMPLIANT — pickWidths filters `w < srcWidth`; withoutEnlargement at sharp layer too |
| NO real R2/Redis in tests | All test files | COMPLIANT — vi.mock("../src/media-runtime"), vi.mock("../src/media/runtime"), no live sockets |

---

### Human Verification Required

#### 1. Live Cloudflare R2 End-to-End Smoke (MEDIA-01, MEDIA-02, MEDIA-05)

**Test:** Provision a Cloudflare R2 bucket + API token (access key/secret), enable public access (custom domain or r2.dev), and configure CORS to allow presigned PUT from the panel origin. Load `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` into the staging environment (SOPS/CI, never in git). Then:

1. Call `media.createUpload` with a real image content-type and size; receive the presigned `putUrl`.
2. PUT the image bytes directly to the `putUrl` from a client (or cURL).
3. Call `media.confirmUpload` with the returned `mediaId`.
4. Observe the worker processing: confirm the original is present under `originals/{orgId}/{projectId}/{mediaId}.{ext}` in R2, and the variants under `variants/{mediaId}/{width}.{avif|webp}`.
5. Query the `media` row; confirm `variants`, `blurhash`, `width`, `height` are all populated.
6. Call `resolveMedia` (or any route that exposes it) with the row and `R2_PUBLIC_BASE_URL`; confirm the returned `srcset` URLs resolve to actual image bytes.

**Expected:** Full round-trip with real R2 infrastructure. Variants are publicly accessible via CDN.

**Why human:** Requires a provisioned Cloudflare R2 bucket + API token + public domain + CORS policy. CI uses an in-memory mock S3 by plan prohibition. No live R2 contact in any automated test. Deferred by explicit user decision (02-03-SUMMARY.md D6, `human_judgment: true`).

---

#### 2. Forced-Failure Observability on Real Staging Infra (MEDIA-04)

**Test:** With the staging environment running and Sentry connected, temporarily invalidate the R2 credentials (or corrupt the token scope to deny PutObject). Trigger a media processing job and observe:

1. The job fails on the R2 PutObject call.
2. A Sentry event appears with `extra: { mediaId, attempts }` and the correct error.
3. The structured pino log line appears: `{ err, mediaId, queue: "media-processing" } "media job failed"`.
4. Query the `media` row; confirm `variants = '{}'` (recoverable state, no partial map).
5. Restore the credentials and re-run the job; confirm the row is fully populated (recovery works).

**Expected:** Observable failure → Sentry event + pino log → row stays recoverable. Clean rerun → full success.

**Why human:** Requires live Sentry project + real R2 + staging worker deployment. The automated spy test (`media-failure.test.ts`) proves the `reportMediaFailure` code path but cannot confirm real Sentry delivery or real R2 failure behavior.

---

### Gaps Summary

No gaps. All 5 MEDIA-* success criteria are satisfied in code and verified by automated tests (68/68 tests GREEN). The two human-verification items above are deferred by explicit user decision and are not implementation gaps — the code and logic are complete and correct.

The sole outstanding thread is the live Cloudflare R2 staging smoke, which requires external infra provisioning (bucket + token + public domain + CORS) before it can run. This is tracked in 02-03-SUMMARY.md D6 and surfaces here as `status: human_needed`.

---

_Verified: 2026-06-30T16:55:00Z_
_Verifier: Claude (gsd-verifier)_
