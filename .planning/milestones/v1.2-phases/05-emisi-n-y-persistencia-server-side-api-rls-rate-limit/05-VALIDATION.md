---
phase: 5
slug: emisi-n-y-persistencia-server-side-api-rls-rate-limit
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (workspace: `@imbau/api`, `@imbau/storage`, `@imbau/web`) |
| **Config file** | `packages/api/vitest.config.ts` (existing — integration tests run against real Postgres `_test` DB) |
| **Quick run command** | `pnpm --filter @imbau/api test -- quotes-router` |
| **Full suite command** | `pnpm test` (turbo, all workspaces) |
| **Estimated runtime** | ~60 seconds (quick: ~15 s) |

> Local runs need the `_test` DB/Redis/auth env exports (see developer local-test-env recipe); CI is already wired with migrate step + redis service.

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` verify (typecheck/lint/grep gates in Waves 1–3; `pnpm --filter @imbau/api test -- quotes-router` once 05-02 lands)
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | QUOTE-01 | T-05 (D-08) | Errors typed, no internals leaked | typecheck+grep | `pnpm --filter @imbau/api typecheck && grep -c "errorFormatter" packages/api/src/trpc/init.ts` | ✅ | ⬜ pending |
| 05-01-02 | 01 | 1 | QUOTE-01/02 | T-05 (Pitfall 5) | Org resolved server-side; withTenant-only reads | typecheck+lint+grep | `pnpm --filter @imbau/api typecheck && pnpm --filter @imbau/api lint && grep -Ec "from \"@imbau/db\"" packages/api/src/trpc/routers/quotes.ts` | ❌ (new file) | ⬜ pending |
| 05-01-03 | 01 | 1 | QUOTE-01 | — | Router reachable only via appRouter | typecheck+grep | `pnpm --filter @imbau/api typecheck && grep -c "quotes: quotesRouter" packages/api/src/trpc/routers/_app.ts` | ✅ | ⬜ pending |
| 05-02-01 | 02 | 2 | QUOTE-01/02 | T-05 (RLS) | Anon happy path via withAnon→withTenant, snapshot `{version:1}` persisted | integration (real Postgres) | `pnpm --filter @imbau/api test -- quotes-router` | ❌ (new test file) | ⬜ pending |
| 05-02-02 | 02 | 2 | QUOTE-01/02 | T-05 (RLS) | Missing CAC→PRECONDITION_FAILED; anon probe on `quotes`/`cac_index`→42501 | integration (real Postgres) | `pnpm --filter @imbau/api test -- quotes-router && pnpm --filter @imbau/api test` | ❌ (new test file) | ⬜ pending |
| 05-03-01 | 03 | 1 | QUOTE-02 | — | Contract-only, no bullmq import | typecheck+grep | `pnpm --filter @imbau/storage typecheck && grep -c "QUOTE_PDF_QUEUE" packages/storage/src/quote-pdf.ts && ! grep -rn "bullmq" packages/storage/src/` | ❌ (new file) | ⬜ pending |
| 05-03-02 | 03 | 1 | QUOTE-02 | — | Barrel re-exports contract | typecheck+lint+grep | `pnpm --filter @imbau/storage typecheck && pnpm --filter @imbau/storage lint && grep -c "quotePdfKey" packages/storage/src/index.ts` | ✅ | ⬜ pending |
| 05-04-01 | 04 | 2 | QUOTE-01 | T-05 (A1 fence) | Web gains app pool only via withTenant fence | grep+typecheck | `grep -c "DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL" apps/web/env.ts && pnpm --filter @imbau/web typecheck` | ✅ | ⬜ pending |
| 05-04-02 | 04 | 2 | QUOTE-01 | — | Mount mirrors panel handler | test -f+grep+typecheck+lint | `test -f "apps/web/app/api/trpc/[trpc]/route.ts" && grep -c "fetchRequestHandler" "apps/web/app/api/trpc/[trpc]/route.ts" && pnpm --filter @imbau/web typecheck && pnpm --filter @imbau/web lint` | ❌ (new file) | ⬜ pending |
| 05-04-03 | 04 | 2 | QUOTE-01 | — | Key Decision A1 documented | grep | `grep -c "A1 — apps/web" .planning/PROJECT.md` | ✅ | ⬜ pending |
| 05-05-01 | 05 | 3 | QUOTE-03 | T-05 (DoS) | 429 on burst, panel vhost untouched | grep gates on conf | `grep -c "limit_req_status 429" deploy/nginx/staging.tours.andescode.com.ar.conf` (+ zone/location greps per plan) | ✅ | ⬜ pending |
| 05-05-02 | 05 | 3 | QUOTE-03 | — | Apply procedure documented | grep | `grep -c "Phase 5 rate-limit apply" deploy/nginx/staging.tours.andescode.com.ar.conf` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — Vitest + real-Postgres integration pattern (`packages/api/tests/trpc-tenant.test.ts`) and seed "Brigos Recoleta" already exist. The new `quotes-router` test file is created by plan 05-02 (tdd tasks), not Wave 0.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| nginx `limit_req` rejects burst with HTTP 429 on `/api/trpc/quotes` | QUOTE-03 | Limit lives in VPS infra (host nginx), not automatable in CI (D-12) | Apply conf on VPS (sites-available + `nginx -t` + reload), then `curl` burst > 20 req against the quotes path on the web vhost — expect 429 on excess; panel vhost and prod untouched |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra suffices)
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-03
