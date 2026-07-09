---
phase: 07-pdf-as-ncrono-en-el-worker
plan: 03
subsystem: api
tags: [trpc, bullmq, producer, presign, rls, r2, quotes]
requires:
  - "packages/storage quote-pdf contract (QUOTE_PDF_QUEUE, QuotePdfJobData, quotePdfJobOptions) — fase 5 D-13"
  - "quotes.create snapshot persistence (QUOTE-02, fase 5)"
  - "media/runtime.ts lazy-init pattern (fase 1/2)"
provides:
  - "quotes.create enqueues a quote-pdf job on every emission (D-02) — the worker (07-02, wave 2) consumes it"
  - "quotes.pdfStatus publicProcedure — tenant-safe poll endpoint returning {ready:false} | {ready:true, url} (D-03/D-04)"
  - "packages/api/src/quotes/runtime.ts — enqueuePdf + presignPdfGet lazy seams for the quotes router"
affects:
  - "07-02 (worker consumer fulfils this producer's jobs)"
  - "07-04 / fase 6 web UI (polls quotes.pdfStatus via refetchInterval)"
tech-stack:
  added: []
  patterns:
    - "Lazy-memoized runtime module (env+R2+Queue built on first use, fail-closed with var NAME) cloned from media/runtime.ts"
    - "Anon org-resolve (withAnon over publicado project) → withTenant read, no anon policy on tenant-private tables"
key-files:
  created:
    - packages/api/src/quotes/runtime.ts
  modified:
    - packages/api/src/trpc/routers/quotes.ts
    - packages/api/tests/quotes-router.test.ts
decisions:
  - "presignPdfGet forces download with ResponseContentDisposition attachment; filename=cotizacion.pdf, expiresIn 300s (D-04 — short-lived, re-requestable)"
  - "enqueuePdf failure surfaces as the create error (observable, never silenced) — the enqueue is a side-effect of a successful persist, awaited inline"
  - "pdfStatus named under the quotes router so its HTTP path inherits the nginx /api/trpc/quotes throttle (QUOTE-03) with zero nginx changes"
metrics:
  duration: "~30m active (interrupted by provider session reset mid-task-2)"
  completed: 2026-07-06
  tasks: 2
  files: 3
status: complete
---

# Phase 7 Plan 03: API producer + pdfStatus (PDF-01) Summary

quotes.create now enqueues a BullMQ quote-pdf job per emission and quotes.pdfStatus returns a tenant-safe 300s presigned R2 GET once pdfKey exists — behind a lazy quotes/runtime.ts that opens no infra on appRouter import.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | quotes/runtime.ts — lazy producer + presigned GET | aff504e | packages/api/src/quotes/runtime.ts |
| 2 (RED) | Failing tests: enqueue-in-create + pdfStatus | 4a07934 | packages/api/tests/quotes-router.test.ts |
| 2 (GREEN) | Enqueue in create + pdfStatus procedure | 63b2b7b | packages/api/src/trpc/routers/quotes.ts |

## What was built

- **`packages/api/src/quotes/runtime.ts`** — near-verbatim clone of `media/runtime.ts`. Lazy-memoized `getEnv()` (baseEnv+r2Env+redisEnv via @t3-oss/env-core, `SKIP_ENV_VALIDATION` honored), `getR2()` (makeR2Client), `getQueue()` (IORedis `maxRetriesPerRequest: null` + `Queue(QUOTE_PDF_QUEUE)`). Exports:
  - `enqueuePdf(data: QuotePdfJobData)` → `queue.add("render", data, quotePdfJobOptions(data.quoteId))` — jobId=quoteId dedups re-enqueues (PDF-02 seam).
  - `presignPdfGet(key)` → `GetObjectCommand` presign, `expiresIn: 300`, `ResponseContentType: application/pdf`, `ResponseContentDisposition: attachment; filename="cotizacion.pdf"`.
  - No client constructed at module top level — importing appRouter opens no Redis socket and validates no R2 env (Pitfall 3).
- **`quotes.create`** — after the RETURNING insert, `await enqueuePdf({ quoteId: row.id, organizationId: orgId, projectId: input.projectId })` (D-02). Org is the server-resolved org of the publicado project, never client input.
- **`quotes.pdfStatus`** — publicProcedure `.query` (pollable via refetchInterval), input `{projectId: uuid, quoteId: uuid}`. Step 1: org resolve via `withAnon` over the publicado project (no row → `NOT_FOUND` "Proyecto no publicado."). Step 2: `withTenant(org)` select of `pdfKey` — RLS yields zero rows for a foreign quoteId → `{ready:false}` (T-07-01). `pdfKey` set → `{ready:true, url}` presigned from the ROW's key, never client input (T-07-03). No anon policy added to quotes/cac_index; @imbau/db imports stay withTenant/withAnon/schema only (T-05-07 fence intact).
- **Tests** — `vi.mock("../src/quotes/runtime")` (no live Redis/R2 under test). Five new cases: exact enqueue payload on create; `{ready:false}` without pdfKey; `{ready:true, url}` with pdfKey set via owner pool using the real `quotePdfKey` shape; cross-tenant (org A project + org B quoteId with a pdfKey) → `{ready:false}` and presign never called; unpublished project → NOT_FOUND.

## Verification

- `pnpm --filter @imbau/api typecheck` — exit 0.
- `pnpm --filter @imbau/api test` — 31/31 tests, 6/6 files green (existing QUOTE-01/02 + 5 new cases) against live Postgres RLS (`imbau_test`), runtime mocked.
- `pnpm --filter @imbau/api test -t "pdfStatus"` / `-t "enqueue"` — exit 0.
- `pnpm --filter @imbau/api lint` — exit 0.
- RED phase confirmed before implementation: 4 tests failed ("No procedure found on path quotes.pdfStatus"; enqueuePdf never called).

## TDD Gate Compliance

Task 2 (`tdd="true"`): RED commit `4a07934` (test) → GREEN commit `63b2b7b` (feat). No refactor commit needed. Note: the "unpublished → NOT_FOUND" case passed vacuously in RED (a missing tRPC procedure also throws NOT_FOUND) — it remains a meaningful guard post-implementation since it now exercises the withAnon resolve path.

## Deviations from Plan

None - plan executed exactly as written. (07-PATTERNS.md referenced in the plan context does not exist on disk; the shapes were taken from the plan's inline action text and media/runtime.ts, which the plan designates as the exact analog.)

## Known Stubs

None. The `pdfStatus` `{ready:false}` arm is not a stub — the worker that sets `pdfKey` lands in plan 07-02 (wave 2 per the phase plan), which is the documented resolution.

## Threat Flags

None beyond the plan's threat model — the new `pdfStatus` endpoint and the R2 presigned-GET surface are exactly T-07-01..T-07-04, all mitigated as planned and asserted by tests (cross-tenant isolation, row-derived key, 300s TTL, nginx quotes-prefix throttle inherited by path naming).

## Self-Check: PASSED

- FOUND: packages/api/src/quotes/runtime.ts
- FOUND: commit aff504e
- FOUND: commit 4a07934
- FOUND: commit 63b2b7b
