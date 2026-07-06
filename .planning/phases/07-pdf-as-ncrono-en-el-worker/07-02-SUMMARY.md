---
phase: 07-pdf-as-ncrono-en-el-worker
plan: 02
subsystem: worker
tags: [worker, pdf, bullmq, processor, r2, withTenant, idempotency, qrcode]

# Dependency graph
requires:
  - phase: 07-01 (worker PDF foundation)
    provides: QuoteDoc + QuoteHeader/QuoteDocProps + WEB_PUBLIC_BASE_URL env + PDF/QR/React deps
  - phase: 07-03 (API producer)
    provides: quotes.create enqueues QUOTE_PDF_QUEUE jobs + pdfStatus contract this consumer fulfils
  - phase: 04-cotizador (packages/quoting)
    provides: toPdfModel serializer + QuoteResult contract (montos, never recomputed)
provides:
  - "processQuotePdf — BullMQ consumer that renders the frozen snapshot to a PDF, uploads to the deterministic R2 key, and writes pdfKey back once (idempotent under retry — PDF-01/PDF-02)"
  - "reportQuotePdfFailure — Sentry + pino failure reporter (structured fields only, D-10)"
  - "createQuotePdfWorker + boot() QUOTE_PDF_QUEUE wiring with a failed handler"
  - "readQuoteForPdf / writePdfKey — tenant-scoped (withTenant/app_authenticated) read+write seams"
  - "putPdf — R2 PutObject seam (application/pdf) + WEB_PUBLIC_BASE_URL re-export"
affects: [07-04, pdf-worker-e2e, staging-worker-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker PDF consumer cloned from the verified media pipeline: pure-ish executor (processQuotePdf) delegates ALL I/O to a withTenant store seam + an R2 runtime seam so the orchestration test mocks store/runtime/doc/renderer/qrcode and needs zero infra"
    - "Snapshot interior narrowed at the DB boundary (QuotePdfSnapshot { result, cacPeriodo }) so the processor reads snapshot.result cast-free — amounts never recomputed (T-04-06)"
    - "Render-time es-AR emission date via Intl.DateTimeFormat(America/Argentina/Buenos_Aires), frozen by the D-11 short-circuit (quotes has no createdAt)"

key-files:
  created:
    - "apps/worker/src/quote-pdf-store.ts — readQuoteForPdf (snapshot+pdfKey+unit/floor/project descriptors under one withTenant) + writePdfKey (atomic pdfKey write-back)"
    - "apps/worker/src/quote-pdf-runtime.ts — putPdf (R2 PutObject application/pdf) + R2_BUCKET + WEB_PUBLIC_BASE_URL exports"
    - "apps/worker/src/quote-pdf.ts — processQuotePdf + reportQuotePdfFailure"
    - "apps/worker/src/quote-pdf.test.ts — processor orchestration (store/runtime/doc/renderer/qrcode mocked; toPdfModel real)"
  modified:
    - "apps/worker/src/index.ts — createQuotePdfWorker + boot() QUOTE_PDF_QUEUE queue/worker + failed handler + return type"

key-decisions:
  - "Narrowed quotes.snapshot to QuotePdfSnapshot { result: QuoteResult; cacPeriodo: string|null } at the store boundary (the column is typed QuoteSnapshot = { version:1 } + passthrough, so its interior is unknown) — keeps the processor's toPdfModel(row.snapshot.result) cast-free and strict"
  - "readQuoteForPdf filters by row id only inside withTenant — RLS (quotes_tenant/units_tenant/... GUC) scopes every read to orgId; a missing row throws so BullMQ marks the job failed (never a silent empty PDF)"
  - "Imported only `eq` from drizzle-orm (not `and`) — the id-equality filters plus RLS are sufficient; an unused `and` would fail lint"

patterns-established:
  - "Quote-PDF worker pipeline mirrors the media pipeline seam split (store = withTenant I/O, runtime = R2 I/O, processor = thin orchestrator) so both are mockable in isolation"

requirements-completed: [PDF-01, PDF-02]

coverage:
  - id: P1
    description: "processQuotePdf short-circuits (D-11) — a quote that already has pdfKey is never re-rendered or re-uploaded"
    requirement: "PDF-02"
    verification:
      - kind: unit
        ref: "apps/worker/src/quote-pdf.test.ts#short-circuits (D-11): a quote that already has pdfKey is never re-rendered or re-uploaded"
        status: pass
    human_judgment: false
  - id: P2
    description: "Happy path puts to quotePdfKey(org,project,quoteId) ONCE then writes that same key back ONCE, put strictly before write (PDF-01/PDF-02)"
    requirement: "PDF-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/quote-pdf.test.ts#happy path: puts to the deterministic key ONCE then writes that same key back ONCE (put before write)"
        status: pass
    human_judgment: false
  - id: P3
    description: "The cotizador deep-link {WEB_PUBLIC_BASE_URL}/p/{slug}/cotizador?u={unitId}&plan={paymentPlanId} is built server-side and fed to QRCode.toDataURL (D-08)"
    requirement: "PDF-01"
    verification:
      - kind: unit
        ref: "apps/worker/src/quote-pdf.test.ts#builds the cotizador deep-link (D-08) and feeds it to QRCode.toDataURL"
        status: pass
    human_judgment: false
  - id: P4
    description: "Amounts come only from snapshot.result via toPdfModel — calcQuote never runs in the worker (T-04-06/T-07-13)"
    verification:
      - kind: static
        ref: "apps/worker/src/quote-pdf.ts imports toPdfModel from @imbau/quoting and reads row.snapshot.result; it does not import or call calcQuote"
        status: pass
    human_judgment: false
  - id: P5
    description: "pdfKey write-back + snapshot/descriptor reads run as app_authenticated via withTenant, never the owner/BYPASSRLS pool (T-07-03)"
    verification:
      - kind: static
        ref: "apps/worker/src/quote-pdf-store.ts imports only withTenant/schema from @imbau/db (+ eq); every read/write is inside withTenant(orgId)"
        status: pass
    human_judgment: false
  - id: P6
    description: "Failure path routes to Sentry + pino (reportQuotePdfFailure) wired to quotePdfWorker.on('failed') — never swallowed (D-10/T-07-10)"
    verification:
      - kind: static
        ref: "apps/worker/src/index.ts boot() wires quotePdfWorker.on('failed', … reportQuotePdfFailure) with quoteId + attemptsMade"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-06
status: complete
---

# Phase 7 Plan 02: Worker quote-PDF processor + boot wiring Summary

**A BullMQ `QUOTE_PDF_QUEUE` consumer that reads the frozen quote snapshot + descriptors under `withTenant`, short-circuits if the PDF already exists (D-11), lays out the snapshot via `toPdfModel` (never recompute — D-07/T-04-06), builds the cotizador deep-link QR (D-08), renders `QuoteDoc` to a Buffer, uploads it to the deterministic R2 key, and writes `pdfKey` back once — idempotent under retry, observable on failure — cloned from the verified media pipeline.**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (Task 2 via TDD: RED → GREEN)
- **Files:** 5 (4 created, 1 modified)

## Accomplishments
- `quote-pdf-store.ts` — `readQuoteForPdf` reads the frozen `snapshot` + `pdfKey` + the non-monetary unit/floor/project descriptors in ONE `withTenant(orgId)` transaction (RLS scopes every read to the org; no monetary column is read from those tables — D-07). `writePdfKey` is the single atomic `pdfKey` write-back as `app_authenticated`. Imports only `withTenant`/`schema` from `@imbau/db` (+ `eq`).
- `quote-pdf-runtime.ts` — `putPdf` uploads the PDF to R2 with `ContentType: application/pdf` (overwrite on retry — never duplicates), plus `R2_BUCKET` + `WEB_PUBLIC_BASE_URL` re-exports so the processor never imports `./env` (keeps the test env-free).
- `quote-pdf.ts` — `processQuotePdf` orchestrates: withTenant read → **short-circuit on `pdfKey` (D-11)** → `toPdfModel(row.snapshot.result)` (montos solo del snapshot; `calcQuote` never runs — T-04-06) → deep-link + `QRCode.toDataURL` (D-08) → `renderToBuffer(QuoteDoc(...))` → `putPdf(quotePdfKey(org,project,quoteId))` → single `writePdfKey`, put strictly before write. `reportQuotePdfFailure` routes failures to Sentry + pino with structured fields only (D-10).
- `index.ts` `boot()` — declares `QUOTE_PDF_QUEUE`, stands up `createQuotePdfWorker` (concurrency 2), and wires `quotePdfWorker.on("failed", … reportQuotePdfFailure)`; both handles added to the boot return object + its type.
- **Triple idempotency (PDF-02):** short-circuit on `pdfKey` (D-11) + deterministic `quotePdfKey` overwrite + `jobId=quoteId` dedup (producer's `quotePdfJobOptions`, 07-03).

## Task Commits
| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | tenant-scoped read/write + R2 put seams | `f73c720` (feat) | quote-pdf-store.ts, quote-pdf-runtime.ts |
| 2 (RED) | failing orchestration test for processQuotePdf | `c28192d` (test) | quote-pdf.test.ts |
| 2 (GREEN) | processQuotePdf + boot wiring | `2875a59` (feat) | quote-pdf.ts, index.ts |

## Verification
- `pnpm --filter @imbau/worker typecheck` — exit 0.
- `pnpm --filter @imbau/worker lint` — exit 0.
- `pnpm --filter @imbau/worker test` — **9 files / 32 tests green** (3 new quote-pdf cases + existing media/env/index/quote-pdf-doc suites), against live Postgres RLS + Redis with store/runtime/doc/renderer/qrcode mocked.
- RED confirmed before GREEN: `quote-pdf.test.ts` failed with "Cannot find module './quote-pdf'" (8 other files / 29 tests green) at commit `c28192d`.

## TDD Gate Compliance
Task 2 (`tdd="true"`): RED commit `c28192d` (test) → GREEN commit `2875a59` (feat). No refactor commit needed (implementation was clean). Gate sequence intact.

## Deviations from Plan
None — plan executed exactly as written. The store narrows `quotes.snapshot` to a `QuotePdfSnapshot { result, cacPeriodo }` interface (the column's `QuoteSnapshot` type is `{ version:1 }` + passthrough, so its interior is `unknown`); this was the plan's intent ("snapshot typed") made strict-typecheck-safe and is documented as a key decision, not a scope change.

## Environment Notes (no repo change)
- Local shell defaults to Node 20; activated Node 22 (v22.22.3) via nvm for all pnpm/test/typecheck runs.
- Ran a workspace `pnpm install` (worktree `node_modules` was incomplete) and supplied the documented local `_test` DB/Redis/auth env (Docker Postgres :5432 `imbau:dev`, Redis :6380) for the worker test globalSetup — same recipe as 07-01. No repo files changed by either.

## Known Stubs
None. `processQuotePdf` is the real, fully-wired consumer; the `pdfStatus` `{ready:false}` arm from 07-03 is now resolved once this worker sets `pdfKey`.

## Threat Flags
None beyond the plan's threat model. T-07-03 (cross-tenant/client-influenced key), T-07-10 (silent failure), T-07-13 (recompute drift), T-07-14 (retry duplication) are all mitigated as planned and asserted (deterministic server-side key via `quotePdfKey`, withTenant `app_authenticated` writes, `toPdfModel`-only amounts, triple idempotency, Sentry+pino failure reporter).

## Next Phase Readiness
- The producer→consumer loop is closed: `quotes.create` (07-03) enqueues; this worker renders + persists `pdfKey`; `quotes.pdfStatus` (07-03) then returns the presigned URL. 07-04 / fase 6 UI can poll to completion.
- **Deferred to CI/staging:** live end-to-end (real R2 upload + real Redis job drain + container-runtime font resolution, D4 from 07-01) is only confirmable against a built worker image with real R2 creds — no local Docker daemon for image build. The processor path is fully unit-proven with mocked seams.

## Self-Check: PASSED
- FOUND: apps/worker/src/quote-pdf-store.ts
- FOUND: apps/worker/src/quote-pdf-runtime.ts
- FOUND: apps/worker/src/quote-pdf.ts
- FOUND: apps/worker/src/quote-pdf.test.ts
- FOUND: commit f73c720, c28192d, 2875a59

---
*Phase: 07-pdf-as-ncrono-en-el-worker*
*Completed: 2026-07-06*
