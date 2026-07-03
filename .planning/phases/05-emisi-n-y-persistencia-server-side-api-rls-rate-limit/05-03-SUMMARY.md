---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
plan: 03
subsystem: storage
tags: [contract, queue, r2-keys, pdf-pipeline, fase-7-groundwork]
requires:
  - "@imbau/storage queue.ts/keys.ts molecule (MEDIA_QUEUE precedent, v1.1 Phase 2)"
provides:
  - "QUOTE_PDF_QUEUE (const) — BullMQ channel name for the quote-PDF pipeline"
  - "QuotePdfJobData (interface) — worker job payload: quoteId, organizationId, projectId"
  - "quotePdfJobOptions(quoteId) — deterministic BullMQ options (jobId dedup + backoff)"
  - "quotePdfKey(orgId, projectId, quoteId) — deterministic quotes/*.pdf R2 key"
affects:
  - "fase 7 (PDF pipeline): both producer (quotes.create enqueue) and consumer (worker processor) import this contract"
tech-stack:
  added: []
  patterns:
    - "shared contract module with NO bullmq import (const + interface + pure helpers), mirroring MEDIA_QUEUE"
    - "jobId = entityId for BullMQ dedup idempotency"
    - "deterministic R2 key per entity so retries overwrite the same object"
key-files:
  created:
    - packages/storage/src/quote-pdf.ts
  modified:
    - packages/storage/src/keys.ts
    - packages/storage/src/index.ts
decisions:
  - "Contract shipped, no producer wired (D-13): enqueue lands in fase 7 with the consumer so jobs can never rot unconsumed in Redis"
  - "organizationId travels in the job payload because the worker has no session to derive the tenant from (feeds withTenant), same rationale as MediaJobData"
metrics:
  duration: ~2 min
  completed: 2026-07-03
  tasks: 2
  files: 3
status: complete
---

# Phase 05 Plan 03: Quote-PDF Queue Contract Summary

Froze the fase-7 quote-PDF pipeline contract in `@imbau/storage` — `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions()`, `quotePdfKey()` — as a pure, bullmq-free module cloning the `MEDIA_QUEUE` molecule, with zero producers wired this phase (D-13).

## What Was Built

- **`packages/storage/src/quote-pdf.ts` (new):** the shared contract, deliberately importing no bullmq so `@imbau/storage` stays Redis-free.
  - `QUOTE_PDF_QUEUE = "quote-pdf"` — one channel name both sides of fase 7 build against, so they can never drift onto mismatched names.
  - `QuotePdfJobData` — exactly three readonly string fields: `quoteId`, `organizationId`, `projectId`. `organizationId` travels in the payload because the worker has no session to derive the tenant from (feeds `withTenant`), same rationale as `MediaJobData`.
  - `quotePdfJobOptions(quoteId)` — pure helper returning `{ jobId: quoteId, attempts: 5, backoff: { type: "exponential", delay: 2000 } }`. `jobId = quoteId` gives BullMQ dedup so a retried enqueue can never stack duplicate PDF jobs for one quote (the PDF-02 idempotency seam).
- **`packages/storage/src/keys.ts` (extended):** `quotePdfKey(orgId, projectId, quoteId)` → `quotes/${orgId}/${projectId}/${quoteId}.pdf`. Deterministic per quoteId so a retried fase-7 job overwrites the SAME R2 object instead of duplicating (mirrors `variantKey`'s Pitfall-5 rationale); org/project segments scope the object for human-readable bucket browsing, with authority staying on RLS + the worker, not the key path.
- **`packages/storage/src/index.ts` (extended):** barrel re-exports `quotePdfKey`, `QUOTE_PDF_QUEUE`, `quotePdfJobOptions` (runtime) and `QuotePdfJobData` (type-only via `export type`, verbatimModuleSyntax), mirroring the `MEDIA_QUEUE`/`MediaJobData` split exactly. Existing exports untouched.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Create quote-pdf.ts (queue name, payload, job options) | f5394c6 | packages/storage/src/quote-pdf.ts |
| 2 | Add quotePdfKey to keys.ts + re-export contract from barrel | 1520b4a | packages/storage/src/keys.ts, packages/storage/src/index.ts |

## Verification

- `pnpm --filter @imbau/storage typecheck` — exits 0 (both tasks).
- `pnpm --filter @imbau/storage lint` — exits 0.
- `pnpm --filter @imbau/api typecheck` — exits 0 (no api-side consumer added).
- No bullmq **import** and no bullmq **dependency** anywhere under `packages/storage/src/` or `packages/storage/package.json` — verified with a precise import/require grep (see Deviations).
- No producer/consumer added: `grep -rn "QUOTE_PDF_QUEUE" packages/api/src apps/` returns nothing — only `packages/storage` defines/exports it. `quotes.create` (05-01) remains enqueue-free.

## Deviations from Plan

### Verification-command precision (no code change)

- **Found during:** Task 1 verification.
- **Issue:** The plan's literal check `! grep -rn "bullmq" packages/storage/src/` cannot pass as written, because the module's header comment intentionally references bullmq by name ("this module intentionally does NOT import bullmq") — and the very analog the plan told me to mirror (`queue.ts`) already contains the same word in its comments. The acceptance criterion's stated intent is "no bullmq **import** anywhere in the package source (no bullmq/Redis dependency)".
- **Resolution:** Verified the real intent with a precise pattern — `grep -rnE "(import|require|from).*['\"]bullmq['\"]" packages/storage/src/` (empty) and `grep -n "bullmq" packages/storage/package.json` (empty). Both confirm zero import and zero dependency. No code was changed; the explanatory comment stays, matching the accepted `queue.ts` precedent.

## Known Stubs

None — this plan deliberately ships a contract with no producer/consumer (D-13, not a stub): fase 7 wires the enqueue and worker together so jobs can never accumulate unconsumed. This is the plan's explicit intent, documented in the module header and PROJECT decisions.

## Notes

- Local toolchain requires Node 22 (via nvm); the login shell defaults to Node 20, which fails pnpm with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. All verification ran under `nvm use 22`.

## Self-Check: PASSED
- FOUND: packages/storage/src/quote-pdf.ts
- FOUND: packages/storage/src/keys.ts (quotePdfKey present)
- FOUND: packages/storage/src/index.ts (contract re-exported)
- FOUND commit: f5394c6
- FOUND commit: 1520b4a
