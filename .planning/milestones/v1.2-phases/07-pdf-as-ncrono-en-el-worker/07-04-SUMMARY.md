---
phase: 07-pdf-as-ncrono-en-el-worker
plan: 04
subsystem: ui
tags: [web, trpc, polling, presigned-download, env, compose, staging, nextjs, tanstack-query]

# Dependency graph
requires:
  - phase: 07-03
    provides: "quotes.pdfStatus publicProcedure ({ready:false} | {ready:true, url}) + quotes.create enqueue — the poll contract the UI drives"
  - phase: 07-01
    provides: "worker quote-pdf processor that writes quotes.pdfKey (flips pdfStatus to ready)"
  - phase: 06
    provides: "cotizador-simulator island (compute/create cycle, WhatsApp CTA, dedicated quotes splitLink) + the PDF placeholder button"
provides:
  - "apps/web server env now validates REDIS_URL + R2_* (server-only) because the PDF producer + presign run in the web process (D-02)"
  - "staging topology: web depends_on redis (service_healthy) + worker WEB_PUBLIC_BASE_URL for the QR deep-link (D-08)"
  - "real buyer PDF flow: emit/reuse a shared quoteId (D-01), poll quotes.pdfStatus (~2s), auto-download the presigned R2 URL (D-03), soft-fail at ~40s (D-10)"
affects: [phase-7-uat, staging-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TanStack Query useQuery + trpc.*.queryOptions with a functional refetchInterval (poll until {ready:true} → false) for a status-poll on the dedicated quotes link"
    - "Client deadline pattern: a window.setTimeout soft-fail cap is the single failure surface so transient poll errors (429) never raise a raw error (D-10)"
    - "Shared emitted-quote retained in a ref (retainedQuoteRef), invalidated by a selection-change effect (D-01)"

key-files:
  created: []
  modified:
    - apps/web/env.ts
    - apps/web/env.test.ts
    - deploy/compose.staging.yml
    - apps/web/components/cotizador-simulator.tsx

key-decisions:
  - "PDF poll cadence 2000ms, soft-fail deadline 40000ms (inside the 30-45s band) — sized against the nginx zone=quotes 10r/s throttle"
  - "Auto-download via a synthetic anchor + download attr; presigned GET already carries Content-Disposition: attachment (07-03), so cross-origin download works and a visible fallback link covers mobile blocking"
  - "retainedQuoteRef is a ref (not state): both async handlers read the freshest emission with no stale-closure race; a selection-change effect clears it"
  - "vitest.config.ts left untouched — no other web vitest suite imports apps/web/env.ts, so no test.env block is needed"

patterns-established:
  - "Status-poll UI: useQuery(queryOptions(input, { enabled, refetchInterval: q => q.state.data?.ready ? false : POLL_MS, retry: false }))"
  - "Soft-degradation deadline: a setTimeout resets the button + shows an es-AR message; the critical path (WhatsApp) never depends on the optional feature"

requirements-completed: [PDF-01]

coverage:
  - id: D1
    description: "apps/web validates REDIS_URL + the five R2_* vars in the SERVER block only (never NEXT_PUBLIC_) so the in-process PDF producer/presign fail-fast on a missing var without leaking secrets to the browser bundle"
    requirement: "PDF-01"
    verification:
      - kind: unit
        ref: "apps/web/env.test.ts#resolves without throwing when NEXT_PUBLIC_APP_ENV + the server vars are valid"
        status: pass
      - kind: unit
        ref: "apps/web/env.test.ts#surfaces NEXT_PUBLIC_APP_ENV when its value is invalid"
        status: pass
      - kind: other
        ref: "pnpm --filter @imbau/web typecheck (tsc --noEmit) — exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "staging compose wires web depends_on redis (service_healthy) and gives the worker WEB_PUBLIC_BASE_URL for the QR deep-link"
    requirement: "PDF-01"
    verification:
      - kind: other
        ref: "YAML parse of deploy/compose.staging.yml — valid"
        status: pass
    human_judgment: true
    rationale: "The depends_on ordering + inherited REDIS_URL/R2_* + WEB_PUBLIC_BASE_URL only prove out when the post-merge web/worker images boot on the shared VPS; verified at the phase staging gate, not by a unit test."
  - id: D3
    description: "Buyer taps 'Descargar PDF' → shows 'Generando PDF…' → polls quotes.pdfStatus → auto-downloads the presigned PDF; reuses the WhatsApp quoteId (D-01), resets on selection change, soft-fails at ~40s (D-10) while WhatsApp stays live"
    requirement: "PDF-01"
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/web typecheck + lint + SKIP_ENV_VALIDATION=1 build — all exit 0"
        status: pass
      - kind: manual_procedural
        ref: "07-04-PLAN.md Task 2 human-check: staging tap→generate→auto-download, correct es-AR accents/leyendas/header/QR, WhatsApp CTA stays usable, forced failure shows the soft message"
        status: unknown
    human_judgment: true
    rationale: "End-to-end PDF generation (worker render + R2 upload + accents/QR/leyendas) and the auto-download + soft-fail UX can only be exercised against a live staging deploy with the fase-7 worker image and R2; not reproducible in the unit/build harness."

# Metrics
duration: 8min
completed: 2026-07-06
status: complete
---

# Phase 7 Plan 04: Buyer PDF download flow + web PDF env/staging wiring Summary

**Replaced the fase-6 'Descargar PDF · Próximamente' placeholder with a real emit/reuse-quoteId → poll quotes.pdfStatus (~2s) → auto-download presigned R2 flow that soft-fails at ~40s, and declared the server-only REDIS_URL + R2_* env the in-process PDF producer/presign now needs plus the staging web→redis + worker QR-origin wiring.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-06T18:40:22Z
- **Completed:** 2026-07-06T18:48:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- apps/web/env.ts now spreads `REDIS_URL` + `...r2Env.server` into the `server:` block (D-02) — server-only, never `NEXT_PUBLIC_` (T-07-05); env.test.ts composes the same schema and stays green.
- deploy/compose.staging.yml: `web.depends_on` adds `redis: { condition: service_healthy }`, and `worker.environment` adds `WEB_PUBLIC_BASE_URL: https://staging.tours.andescode.com.ar` (D-08).
- cotizador-simulator.tsx: real PDF button that reuses one emitted quoteId shared with the WhatsApp CTA (D-01), polls `quotes.pdfStatus` on the dedicated quotes link with a 2s `refetchInterval`, auto-downloads the presigned URL when `{ready:true}` (D-03), and degrades softly at a ~40s deadline with an es-AR voseo message + a visible fallback link while WhatsApp stays live (D-10).

## Task Commits

Each task was committed atomically:

1. **Task 1: web server env (REDIS_URL + R2_*) + staging compose** - `a7912bc` (feat)
2. **Task 2: cotizador PDF flow (quoteId reuse, pdfStatus polling, auto-download, soft-fail)** - `f004437` (feat)

## Files Created/Modified
- `apps/web/env.ts` - Added `REDIS_URL` + `r2Env.server` to the server block (in-process producer/presign, D-02); documented server-only rationale.
- `apps/web/env.test.ts` - Composed the fase-7 server schema (base + redis + R2) with dummy runtime values; the leak-guard read stays client-only.
- `deploy/compose.staging.yml` - web `depends_on` redis; worker `WEB_PUBLIC_BASE_URL` for the QR deep-link.
- `apps/web/components/cotizador-simulator.tsx` - Shared `retainedQuoteRef` + `ensureQuote` helper; `useQuery` poll of `quotes.pdfStatus`; `triggerDownload` anchor; soft-fail deadline; replaced the disabled placeholder button.

## Decisions Made
- Poll cadence 2000ms + soft-fail deadline 40000ms, sized to sit comfortably inside the nginx `zone=quotes` throttle on the dedicated `quotes.*` link.
- Retained quote held in a ref (not state) to avoid a stale-closure race between the WhatsApp and PDF async handlers; a selection-change effect (`{unitId, planId, modalidad}`) clears it so the next trigger emits a fresh quote (D-01).
- The `~40s` deadline is the single failure surface: transient poll errors (e.g. a 429) just wait for the next interval tick (`retry: false`), never raising a raw error to the buyer (D-10).
- `vitest.config.ts` left untouched — the only web suite touching env is `env.test.ts`, which reconstructs the schema via env-core rather than importing `env.ts`, so no `test.env` block is required.

## Deviations from Plan
None - plan executed exactly as written. (One env.test.ts refinement: t3-env fences server-var *access* on the client/jsdom, so the valid-case test asserts resolution-without-throwing + reads only the client var — the composed server schema + supplied runtime values are the actual parity check. This matches the plan's intent and reinforces T-07-05.)

## Issues Encountered
None. The Better Auth "default secret / base URL not set" warnings during `SKIP_ENV_VALIDATION=1 build` are pre-existing (building without live secrets) and unrelated to this plan — the build completed and emitted the route tree.

## User Setup Required
None - `REDIS_URL` and the `R2_*` values already exist in the SOPS-decrypted staging `.env` (worker/media consume them today); `WEB_PUBLIC_BASE_URL` is a non-secret literal in compose. No new secret to generate.

## Known Stubs
None. The `{ready:false}` poll arm is fulfilled by the worker (07-01/07-02); the UI intentionally polls until `pdfKey` exists or the deadline elapses.

## Threat Flags
None beyond the plan's threat model. T-07-05 (secret leak) mitigated: `REDIS_URL`/`R2_*` are server-block only. T-07-04 (poll DoS) mitigated: `pdfStatus` stays a `quotes.*` op on the dedicated link → nginx throttle, ~2s cadence, capped at the deadline. T-07-15 (PDF failure blocks demo) mitigated: soft-fail resets the button; WhatsApp CTA never depends on the PDF.

## Next Phase Readiness
- The full buyer path is code-complete; end-to-end PDF download (accents, leyendas, header, QR) is verifiable once the post-merge web + worker images land on the staging VPS (phase-7 UAT gate).
- No blockers for merge.

## Self-Check: PASSED

---
*Phase: 07-pdf-as-ncrono-en-el-worker*
*Completed: 2026-07-06*
