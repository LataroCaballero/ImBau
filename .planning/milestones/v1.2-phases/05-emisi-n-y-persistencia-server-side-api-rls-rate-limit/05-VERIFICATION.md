---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
verified: 2026-07-04T00:00:00Z
status: passed
score: 2/3 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification: false
behavior_unverified_items:

  - truth: "El endpoint anónimo de cotización tiene rate limit en el edge vía nginx limit_req (QUOTE-03), rechazando ráfagas abusivas sin tocar la config de prod."
    test: "Apply the versioned vhost on the VPS (copy to /etc/nginx/sites-available/, run nginx -t && systemctl reload nginx — never certbot --nginx). Then fire a burst of ~40 rapid POST requests to https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1 (e.g. a shell for loop with curl -s -o /dev/null -w '%{http_code}')."
    expected: "The first ~20 requests pass through to the app (200 / 400-class from the tRPC procedure), and the excess returns 429 — NOT 503 (which is nginx's default limit_req reject status and would break the fase-6 retry contract)."
    why_human: "The nginx config is versioned in deploy/nginx/ as the source of truth (D-12), but application to the live VPS is a manual ssh operation and the 429 burst is only observable against a running nginx with real certs and DNS — neither is reproducible in CI or by file inspection alone."
human_verification:

  - test: "VPS apply + curl-burst 429 UAT for QUOTE-03 edge rate-limit"
    expected: "First ~20 rapid POSTs to https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1 return 200/4xx (app responses), remaining excess returns 429. Record the exact observed statuses; if values were tuned in place, sync rate/burst back to deploy/nginx/staging.tours.andescode.com.ar.conf (D-12, source of truth)."
    why_human: "Runtime behavior of the nginx limit_req zone requires the config applied on the live VPS with real DNS and TLS — not provable by config-file inspection or CI grep gates alone."
---

# Phase 05: Emisión y persistencia server-side (API/RLS/Rate-Limit) — Verification Report

**Phase Goal:** Un comprador anónimo puede disparar la emisión de una cotización cuyo cómputo y persistencia corren server-side por un `publicProcedure` tRPC auditado que resuelve la org del proyecto `publicado`, lee CAC vía `withTenant` y persiste el snapshot completo — sin agregar policies anon a `quotes`/`cac_index` (quedan tenant-private) y con rate limit en el edge. La sub-decisión A1-vs-A2 (dónde vive el pool `app`) se resuelve como Key Decision documentada en esta fase.

**Verified:** 2026-07-04
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | Una request anónima contra el procedure público de cotización resuelve la org del proyecto `publicado`, lee CAC y computa/persiste la cotización vía `withTenant` — sin ninguna policy anon sobre `quotes`/`cac_index`; un mes CAC faltante falla con un mensaje server claro, no un 500 críptico. (QUOTE-01) | VERIFIED | `quotes.ts` publicProcedure: `withAnon` resolves org from publicado project, single `withTenant(orgId)` reads plan+prices+CAC. Missing-CAC guard throws `PRECONDITION_FAILED` with es-AR message. Quotes schema comments confirm "NO anon policy" / "NO anon GRANT" on both tables. 9 integration tests (5303f92, 6720e5f) in `quotes-router.test.ts` prove: anon compute (new Headers()), NOT_FOUND for borrador, PRECONDITION_FAILED for missing CAC, 42501 on anon SELECT of cac_index and anon INSERT into quotes. Import fence holds: single `from "@imbau/db"` binds only `withAnon, withTenant, schema` — no elevated/owner pool. |
| 2 | Cada cotización emitida persiste su snapshot completo (inputs resueltos + outputs + versión del motor) en `quotes.snapshot`, capturando el estado punto-en-el-tiempo que nunca se recomputa en vivo. (QUOTE-02) | VERIFIED | `quotes.create`: builds `{ version: ENGINE_VERSION, inputs: quoteInput, result, cacPeriodo }`, validates via `schema.quoteInsertSchema.parse()` (quoteSnapshotSchema enforces `z.literal(1)`), inserts via `withTenant(orgId, tx => tx.insert(schema.quotes).values(values).returning(...)`) with null-guard on the returning row. Integration test `create persists the versioned snapshot and it is readable via withTenant` asserts snapshot.version===1, snapshot.result.version===ENGINE_VERSION, correct cacPeriodo (max-periodo CAC_PERIODO_NUEVO), correct precioFinanciadoUsd, and readability via withTenant. |
| 3 | El endpoint anónimo de cotización tiene rate limit en el edge vía nginx `limit_req` (no Traefik — D-01), rechazando ráfagas abusivas sin tocar la config de prod. (QUOTE-03) | PRESENT_BEHAVIOR_UNVERIFIED | Config artifact is substantive and correct: `limit_req_zone $binary_remote_addr zone=quotes:10m rate=10r/s;` at http level (before first `server {`), `location ^~ /api/trpc/quotes` with `limit_req zone=quotes burst=20 nodelay;` + `limit_req_status 429;` + correct `proxy_pass http://127.0.0.1:8092`, panel block has NO active `limit_req zone=quotes`. "Phase 5 rate-limit apply" operator procedure present in conf header (D-12). By design, VPS apply + 429 burst confirmation is the end-of-phase human UAT — not CI-verifiable. |

**Score:** 2/3 truths verified (1 present, behavior-unverified)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/api/src/trpc/routers/quotes.ts` | quotesRouter with compute/create publicProcedures | VERIFIED | 213 lines, substantive: resolveAndQuote core, withAnon org-resolve, withTenant reads+insert, all TRPCError branches, QuoteError→BAD_REQUEST mapping |
| `packages/api/src/trpc/init.ts` | errorFormatter surfacing quoteErrorCode | VERIFIED | `initTRPC.context<TRPCContext>().create({ errorFormatter({shape, error}) { const cause = error.cause; return {...shape, data: {...shape.data, quoteErrorCode: cause instanceof QuoteError ? cause.code : undefined}} } })` — imports QuoteError from @imbau/quoting |
| `packages/api/src/trpc/routers/_app.ts` | quotes: quotesRouter registered | VERIFIED | `quotes: quotesRouter` present; all prior registrations (projects, org, member, invitation, media) intact |
| `packages/api/tests/quotes-router.test.ts` | 9 integration tests for QUOTE-01/QUOTE-02 behavioral proof | VERIFIED | Substantive: seedQuoteFixtures owner-pool helper, makeUserWithActiveOrg, createCaller({headers: new Headers()}), 4 happy-path tests + 5 negative/privacy tests, postgresSqlState helper for 42501 probes |
| `packages/storage/src/quote-pdf.ts` | PDF contract: QUOTE_PDF_QUEUE, QuotePdfJobData, quotePdfJobOptions | VERIFIED | QUOTE_PDF_QUEUE="quote-pdf", QuotePdfJobData with 3 readonly string fields, quotePdfJobOptions(quoteId) returns {jobId: quoteId, attempts: 5, backoff: {type:"exponential", delay:2000}}. No bullmq actual import (confirmed by `grep -rn "^import.*bullmq"` → no matches) |
| `packages/storage/src/keys.ts` | quotePdfKey(orgId, projectId, quoteId) | VERIFIED | Returns `quotes/${orgId}/${projectId}/${quoteId}.pdf` with idempotent-retry doc comment |
| `packages/storage/src/index.ts` | Barrel re-exports all PDF contract symbols | VERIFIED | `export { originalKey, variantKey, quotePdfKey } from "./keys"`, `export { QUOTE_PDF_QUEUE, quotePdfJobOptions } from "./quote-pdf"`, `export type { QuotePdfJobData } from "./quote-pdf"` |
| `apps/web/app/api/trpc/[trpc]/route.ts` | tRPC fetch route handler, GET+POST, endpoint /api/trpc | VERIFIED | `fetchRequestHandler({endpoint: "/api/trpc", req, router: appRouter, createContext: () => createTRPCContext({headers: req.headers})})`, exported as `{handler as GET, handler as POST}` |
| `apps/web/env.ts` | DATABASE_APP_URL in server block, no owner DATABASE_URL | VERIFIED | `DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL` present in server block (grep count = 1), owner `DATABASE_URL` not declared, A1 widening comment documents T-03-09 fence |
| `.planning/PROJECT.md` | A1 Key Decision row (D-06) | VERIFIED | Row "A1 — apps/web hosts the app pool for the anonymous quote path (Phase 5 / D-06)..." present with T-03-09 fence and rationale; Last updated footer updated |
| `deploy/nginx/staging.tours.andescode.com.ar.conf` | limit_req_zone + location + 429 + panel untouched + apply procedure | VERIFIED | All 4 plan-05-05 must-haves confirmed by file inspection; "Phase 5 rate-limit apply" note present; panel block has no active limit_req zone=quotes; runtime 429 behavior is human UAT |

---

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| withAnon(projects → orgId) | withTenant(orgId) reads | `resolveAndQuote` in quotes.ts | WIRED | Org resolved from publicado project row, orgId passed to withTenant, never from request body (T-05-01) |
| resolveAndQuote | quotes.create snapshot INSERT | `withTenant(orgId, tx => tx.insert(schema.quotes)...)` | WIRED | create calls resolveAndQuote, builds snapshot with ENGINE_VERSION, validates via quoteInsertSchema.parse, inserts with RETURNING |
| errorFormatter on initTRPC | data.quoteErrorCode on TRPCError shape | `cause instanceof QuoteError ? cause.code : undefined` | WIRED | Pattern verified in init.ts; re-throw in quotes.ts sets `cause: err` (the QuoteError); integration test confirms ANTICIPO_PCT_FUERA_DE_RANGO surfaces |
| quotesRouter | appRouter | `quotes: quotesRouter` in _app.ts | WIRED | Confirmed present in _app.ts |
| appRouter | apps/web/app/api/trpc/[trpc]/route.ts | fetchRequestHandler | WIRED | Verified in route.ts — appRouter + createTRPCContext imported from @imbau/api |
| DATABASE_APP_URL | apps/web/env.ts server block | dbEnv.server.DATABASE_APP_URL | WIRED | Validated at boot; confirmed in server block |
| nginx location ^~ /api/trpc/quotes | web backend 127.0.0.1:8092 | proxy_pass | WIRED (config-level) | Correct proxy_pass, burst=20 nodelay, limit_req_status 429; runtime VPS confirmation is human UAT |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| quotes.ts `resolveAndQuote` | orgId | `withAnon(tx → select organizationId from projects where id=input.projectId)` | DB row (RLS-filtered to publicado) | FLOWING |
| quotes.ts `resolveAndQuote` | plan, prices, cacRow | `withTenant(orgId, tx → selects from paymentPlans, unitPrices+priceLists join, cacIndex)` | Real DB rows via app pool | FLOWING |
| quotes.ts `create` | snapshot | `calcQuote(quoteInput)` → `{version: ENGINE_VERSION, inputs, result, cacPeriodo}` | Computed from real DB data, versioned by ENGINE_VERSION=1 | FLOWING |
| quotes.ts `create` | inserted row | `tx.insert(schema.quotes).values(values).returning({id})` | Real DB insert, row returned via RETURNING | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Test file has 9 integration tests | `grep -c "^  it(" packages/api/tests/quotes-router.test.ts` | 9 | PASS |
| quotes.create snapshot version wired to ENGINE_VERSION | `grep "version: ENGINE_VERSION" packages/api/src/trpc/routers/quotes.ts` | line 187: `version: ENGINE_VERSION` | PASS |
| quoteSnapshotSchema enforces z.literal(1) | Read packages/db/src/schema/json-schemas.ts | `z.object({ version: z.literal(1) }).passthrough()` | PASS |
| No actual bullmq import in storage source | `grep -rn "^import.*bullmq" packages/storage/src/` | no matches | PASS |
| No QUOTE_PDF_QUEUE producer in api or apps | `grep -rn "QUOTE_PDF_QUEUE" packages/api/src/ apps/` | no matches | PASS |
| Grep-fence: no @imbau/db import under apps/web | `grep -rn 'from "@imbau/db"' apps/web/` | FENCE_OK | PASS |
| No parseFloat/Number( on numeric strings in quotes.ts | `grep -n "parseFloat\|Number(" packages/api/src/trpc/routers/quotes.ts` | matches only in comments | PASS |
| No insert in compute path | `grep -n "insert" packages/api/src/trpc/routers/quotes.ts` | insert only in `create` procedure (lines 199-200) | PASS |
| All 12 phase commits in git history | `git log --oneline` grep for all commit hashes | 12/12 found | PASS |
| 429 burst on live VPS | N/A — requires VPS apply + DNS + TLS | not runnable in CI | SKIP — human UAT |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| QUOTE-01 | 05-01, 05-02, 05-04 | Anon buyer generates a quote server-side via audited publicProcedure with withTenant, no anon policies on quotes/cac_index | SATISFIED | resolveAndQuote core (05-01), 5 behavioral integration tests (05-02), web tRPC mount (05-04) |
| QUOTE-02 | 05-01, 05-02 | Each quote persists a complete versioned snapshot in quotes.snapshot | SATISFIED | quotes.create with quoteInsertSchema.parse+RETURNING insert (05-01), snapshot persistence integration test including withTenant read-back (05-02) |
| QUOTE-03 | 05-05 | Anonymous quote endpoint has edge rate limit via nginx limit_req returning 429 on burst | PARTIALLY SATISFIED — config verified, runtime confirmation pending | Config directives verified in deploy/nginx/; runtime 429 burst is pending human VPS UAT (D-12) |

---

### Anti-Patterns Found

No debt markers (TBD, FIXME, XXX), stubs, or empty implementations found in any of the 11 phase-modified files. Every file is substantive. No `return null` / `return {}` / `return []` patterns exist in the router code.

---

### Human Verification Required

#### 1. QUOTE-03 Edge Rate-Limit — 429 Burst on Staging VPS

**Test:** On the VPS (`root@andescode.com.ar`):

1. Copy `deploy/nginx/staging.tours.andescode.com.ar.conf` to `/etc/nginx/sites-available/…` (keep existing symlink, never re-create it).
2. Run `nginx -t && systemctl reload nginx` — confirm exit 0. Do NOT use `certbot --nginx`.
3. From a shell with internet access, fire a burst of ~40 rapid POST requests:
   ```bash
   for i in $(seq 1 40); do
     curl -s -o /dev/null -w "%{http_code}\n" \
       "https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1"
   done
   ```

**Expected:** The first ~20 requests return 200 or 4xx (tRPC app responses); the excess returns **429** (NOT 503 — nginx's default). Record exact statuses. If rate/burst were tuned in place during UAT, sync the tuned values back to `deploy/nginx/staging.tours.andescode.com.ar.conf` (source of truth, D-12).

**Why human:** The nginx `limit_req` zone is loaded into the live nginx master process only after manual VPS apply. The 429 rejection behavior is only observable with real DNS, TLS, and a running nginx — not reproducible from the repo file or CI grep gates alone. This is the phase's intentional end-of-phase UAT step (D-12), documented in the conf header's "Phase 5 rate-limit apply" section.

---

### Additional Findings

**A1 Key Decision (D-06):** The A1-vs-A2 sub-decision left open by the v1.2 roadmap is now closed. `apps/web` validates `DATABASE_APP_URL` in its server block and serves `appRouter` at `/api/trpc/*` — reaching data ONLY via `withTenant`/`withAnon` inside `packages/api` routers (T-03-09 grep-fence, confirmed: no `@imbau/db` import under `apps/web/`). `DATABASE_URL` (owner pool) is deliberately NOT declared in `apps/web/env.ts`. The decision is registered in `.planning/PROJECT.md` Key Decisions table.

**PDF Contract (D-13):** Fase-7 groundwork (plan 05-03) is complete — `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`, and `quotePdfKey` are exported from `@imbau/storage` with no bullmq dependency, and no producer is wired in `quotes.create` (confirmed: grep for QUOTE_PDF_QUEUE in api/apps returns nothing). Jobs cannot accumulate unconsumed until fase 7 wires enqueue + worker together.

**Numeric string discipline (D-14):** Verified `anticipoPct` and `cac.valor` pass straight through to `QuoteInput` as strings — no `parseFloat` or `Number(` wraps these fields anywhere in `quotes.ts`.

**Import fence (T-03-09/T-05-07):** The single `from "@imbau/db"` import in `quotes.ts` binds exactly `withAnon, withTenant, schema` — no elevated/owner-pool clients. Confirmed by file read.

---

### Gaps Summary

No gaps. All code artifacts are present, substantive, and wired. The single outstanding item (QUOTE-03 runtime 429 behavior) is a human UAT step by design — not a code gap.

---

*Verified: 2026-07-04*
*Verifier: Claude (gsd-verifier)*
