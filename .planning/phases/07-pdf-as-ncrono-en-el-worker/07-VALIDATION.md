---
phase: 7
slug: pdf-as-ncrono-en-el-worker
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-05
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit/integration) + @playwright/test 1.60 (e2e) |
| **Config file** | per-package vitest configs (turbo-managed) |
| **Quick run command** | `pnpm test --filter <changed-package>` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --filter <changed-package>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01·T1 | 07-01 | 1 | PDF-02 | T-07-SC, T-07-12 | Font asset committed + resolvable in Alpine; audited deps | unit/config | `pnpm --filter @imbau/worker test -t "worker env validation" && pnpm --filter @imbau/worker typecheck` | ✅ env.test.ts | ⬜ pending |
| 07-01·T2 | 07-01 | 1 | PDF-02, PDF-03 | T-07-12 | Embedded font renders accents; leyendas laid out | unit | `pnpm --filter @imbau/worker test -t "QuoteDoc"` | ❌ quote-pdf-doc.test.ts (authored in task) | ⬜ pending |
| 07-03·T1 | 07-03 | 1 | PDF-01 | T-07-02 | Lazy producer/presign, no infra on import | typecheck | `pnpm --filter @imbau/api typecheck` | ✅ | ⬜ pending |
| 07-03·T2 | 07-03 | 1 | PDF-01 | T-07-01, T-07-03, T-07-04 | pdfStatus tenant-safe (RLS) + enqueue in create | integration | `pnpm --filter @imbau/api test -t "pdfStatus" && pnpm --filter @imbau/api test -t "enqueue"` | ✅ extend quotes-router.test.ts | ⬜ pending |
| 07-02·T1 | 07-02 | 2 | PDF-01 | T-07-03 | withTenant read/write (app_authenticated) + R2 put | typecheck | `pnpm --filter @imbau/worker typecheck` | ✅ | ⬜ pending |
| 07-02·T2 | 07-02 | 2 | PDF-01, PDF-02 | T-07-13, T-07-14, T-07-10 | Short-circuit + deterministic key + observable failure | unit | `pnpm --filter @imbau/worker test -t "processQuotePdf"` | ❌ quote-pdf.test.ts (authored in task) | ⬜ pending |
| 07-04·T1 | 07-04 | 2 | PDF-01 | T-07-05 | R2_/REDIS server-only env; web→redis depends_on | unit/config | `pnpm --filter @imbau/web test && pnpm --filter @imbau/web typecheck` | ✅ env.test.ts | ⬜ pending |
| 07-04·T2 | 07-04 | 2 | PDF-01 | T-07-04, T-07-15 | Poll inside rate limit; soft-fail never blocks demo | typecheck/lint/build + human | `pnpm --filter @imbau/web typecheck && pnpm --filter @imbau/web lint && SKIP_ENV_VALIDATION=1 pnpm --filter @imbau/web build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are authored inside their owning `tdd` task (co-located, small — no separate Wave 0 plan):

- [ ] `apps/worker/src/quote-pdf-doc.test.ts` (07-01·T2) — real `renderToBuffer`: assert `%PDF` magic + accented content renders + both leyendas passed (PDF-02/PDF-03).
- [ ] `apps/worker/src/quote-pdf.test.ts` (07-02·T2) — processor orchestration with `vi.mock` of `./quote-pdf-store`, `./quote-pdf-runtime`, `./quote-pdf-doc`, `@react-pdf/renderer`, `qrcode`: short-circuit, single deterministic-key put + write, deep-link built (PDF-01/PDF-02).
- [ ] `packages/api/tests/quotes-router.test.ts` (07-03·T2) — EXTEND existing suite: `vi.mock("../src/quotes/runtime")`; assert enqueue-in-create + pdfStatus `{ready:false}` / `{ready:true,url}` / cross-tenant isolation / NOT_FOUND (PDF-01).
- [ ] `apps/worker/vitest.config.ts` test.env gains `WEB_PUBLIC_BASE_URL` so `index.test.ts` import-time env validation stays green (07-01·T1).

*All new/extended test files run under the existing Vitest infrastructure (no new runner or globalSetup needed).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end PDF download (tap → generate → auto-download) | PDF-01, PDF-02, PDF-03 | Requires the full stack (web enqueue + worker render + R2 + presign) which only runs after merging the PR to `main` → the post-fase-7 web/worker image reaches the staging VPS. Not reproducible in CI. | On `staging.tours.andescode.com.ar`: open a published unit's cotizador, tap "Descargar PDF"; confirm "Generando PDF…" then an auto-downloaded one-page PDF with correct es-AR accents, both legal leyendas, the full header (proyecto/unidad/piso/tipología/m²/fecha/CAC/ref), and a footer deep-link + scannable QR. Confirm a retry reuses the same PDF (idempotent) and a forced failure shows the soft es-AR message while WhatsApp stays live. |
| Accents render in the Alpine worker container (not just macOS dev) | PDF-02 | Font-path resolution differs between local dev and the Alpine runner image; only the deployed worker image proves the `.ttf` COPY + absolute-path registration works in-container. | After staging deploy, inspect a generated PDF's header/leyendas: áéíóúñ and ¿¡ / U$S render as glyphs, never boxes/blanks. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (quote-pdf-doc.test.ts, quote-pdf.test.ts, quotes-router.test.ts extension)
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (2026-07-06) — tests authored within their owning tdd tasks; end-to-end download is manual staging UAT (post-merge).
