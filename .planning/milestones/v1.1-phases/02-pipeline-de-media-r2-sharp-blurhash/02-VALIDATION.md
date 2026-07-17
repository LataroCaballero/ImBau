---
phase: 2
slug: pipeline-de-media-r2-sharp-blurhash
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` §Validation Architecture. The per-task map below
> is completed after planning (it needs real plan/task IDs).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `4.1.8` (already configured in `apps/worker`, `packages/db`, `packages/api`) |
| **Config file** | per-package `vitest.config.ts`; `packages/db/tests/setup.ts` is the `globalSetup` (owner migrate + role guard, `*_test` DB guard) |
| **Quick run command** | `pnpm --filter @imbau/worker test` (pure pipeline + sharp/blurhash units) |
| **Full suite command** | `pnpm test` (turbo — worker + db + api suites) |
| **Estimated runtime** | ~60s quick units; integration (PG16 + Redis) adds container/setup time |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @imbau/worker test` (or the package the task touched)
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds for pure units; integration gated behind compose/CI services

---

## Per-Task Verification Map

> Populated after planning. Requirement → behavior coverage is locked below;
> task IDs are grafted once the PLAN.md files exist.

| Req ID | Behavior | Test Type | Infra | Automated Command |
|--------|----------|-----------|-------|-------------------|
| MEDIA-01 | createUpload inserts `media` row (via `withTenant`) + returns presigned PUT URL; confirmUpload HeadObject + enqueue | integration | PG16 + mock S3 + mock queue | `pnpm --filter @imbau/api test` |
| MEDIA-01 | client-supplied key never trusted; `originalKey` is server-derived | unit | none | `pnpm --filter @imbau/api test` |
| MEDIA-02 | `pickWidths` never exceeds source width; dedupes/sorts | unit (pure) | none | `pnpm --filter @imbau/worker test` |
| MEDIA-02 | sharp produces decodable AVIF + WebP at each width; dims correct | unit (real sharp, in-mem buffer) | none | `pnpm --filter @imbau/worker test` |
| MEDIA-02 | variant keys deterministic (`variants/{mediaId}/{width}.{fmt}`) | unit (pure) | none | `pnpm --filter @imbau/worker test` |
| MEDIA-03 | blurhash round-trip: `decode(encode(...))` non-empty; width/height persisted | unit (real blurhash) | none | `pnpm --filter @imbau/worker test` |
| MEDIA-04 | idempotency: run `processMedia` twice → identical variant keys, one row, identical `variants` map | integration | PG16 + mock S3 | `pnpm --filter @imbau/worker test` |
| MEDIA-04 | failure injection: sharp/S3 throw → job fails, `Sentry.captureException` spy called, pino error logged, row stays `variants={}` (recoverable) | unit/integration (spies) | partial | `pnpm --filter @imbau/worker test` |
| MEDIA-04 | `jobId = mediaId` dedups re-enqueue | unit (BullMQ add, same jobId) | none | `pnpm --filter @imbau/worker test` |
| MEDIA-04 | write-back runs as `app_authenticated` + GUC (not owner / not BYPASSRLS) | integration (role guard) | PG16 | `pnpm --filter @imbau/worker test` |
| MEDIA-05 | `resolveMedia` maps row → `{ srcset per fmt/width, blurhash, dims, urls }`; `isReady=false` when variants empty | unit (pure) | none | `pnpm --filter @imbau/db test` |
| MEDIA-05 | resolver consumable from web (anon) + panel (auth) paths | integration | PG16 | `pnpm --filter @imbau/api test` |

*Status legend during execution: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Property-based / round-trip targets (Nyquist sampling)

- **Round-trip:** synthetic image (sharp `create`) at random dims → process → every `pickWidths` width has both AVIF + WebP keys, each decodes, decoded width == requested width (≤ source).
- **Idempotency property:** for any media, `process()` then `process()` ⇒ identical `variants` map and exactly one row (re-query count == 1).
- **Failure-recoverability property:** inject failure at variant *k* ⇒ DB `variants` still `{}` (no partial map) and the job is retryable to a clean success.
- **blurhash property:** for any non-trivial image, `decode(encode(...))` yields a buffer of the requested size (validity, not pixel-equality).

---

## Wave 0 Requirements

- [ ] `apps/worker/src/media-variants.test.ts` — `pickWidths` + key derivation (MEDIA-02)
- [ ] `apps/worker/src/media.test.ts` — sharp pipeline, blurhash round-trip, idempotency, failure-injection (MEDIA-02/03/04)
- [ ] worker write-back role-guard test (own file or folded into db tests) — `app_authenticated` + GUC (MEDIA-04)
- [ ] `packages/db/src/resolve-media.test.ts` — resolver mapping + `isReady` (MEDIA-05)
- [ ] `packages/api/src/trpc/routers/media.test.ts` — createUpload/confirmUpload via `createCaller` (MEDIA-01/05)
- [ ] Shared in-memory **mock S3** helper across worker/api tests (or `aws-sdk-client-mock` dev dep)
- [ ] Framework install: none (Vitest present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real R2 upload → process → fetch variant URL (staging smoke) | MEDIA-01/02 | Real Cloudflare R2 bucket + token + public domain + CORS are human/infra (not provisioned in CI) | After R2 provisioning checkpoint: upload a real image on staging, confirm variants appear at `R2_PUBLIC_BASE_URL` and the row's `variants`/`blurhash`/dims populate |

*CI uses a mock S3 client; real R2 is exercised only on staging behind the human provisioning checkpoint.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (pure units)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
