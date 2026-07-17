# Phase 5: Emisión y persistencia server-side (API + RLS + rate limit) - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 10 (4 new, 6 modified)
**Analogs found:** 10 / 10 (every file has an exact in-repo analog — this phase is clone-and-compose, no new ground)

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `packages/api/src/trpc/routers/quotes.ts` | NEW | router | request-response (anon compute + create) | `packages/api/src/trpc/routers/projects.ts` (withAnon) + `routers/media.ts` (withTenant read+insert) | exact (two-analog composite) |
| `packages/api/src/trpc/init.ts` | MODIFIED | config | request-response (errorFormatter) | itself (add `errorFormatter` to `initTRPC...create()`) + `packages/quoting/src/errors.ts` (`QuoteError.code`) | exact |
| `packages/api/src/trpc/routers/_app.ts` | MODIFIED | router (registry) | — | itself (mirror `media:` registration) | exact |
| `packages/api/tests/quotes-router.test.ts` | NEW | test | integration (caller + real PG) | `packages/api/tests/trpc-tenant.test.ts` | exact |
| `packages/storage/src/quote-pdf.ts` | NEW | utility (shared contract) | pub-sub (queue contract, no producer) | `packages/storage/src/queue.ts` | exact |
| `packages/storage/src/keys.ts` | MODIFIED | utility | transform (pure key derivation) | itself (`originalKey`/`variantKey`) | exact |
| `packages/storage/src/index.ts` | MODIFIED | config (barrel) | — | itself | exact |
| `apps/web/app/api/trpc/[trpc]/route.ts` | NEW | route (mount) | request-response | `apps/panel/app/api/trpc/[trpc]/route.ts` | exact (byte-mirror) |
| `apps/web/env.ts` | MODIFIED | config | — | itself (add `DATABASE_APP_URL` to `server` block, mirror `DATABASE_ANON_URL` line) | exact |
| `deploy/nginx/staging.tours.andescode.com.ar.conf` | MODIFIED | config (infra) | request-response (edge throttle) | itself (the pre-documented `limit_req` skeleton, lines 71-78) | exact |

## Pattern Assignments

### `packages/api/src/trpc/routers/quotes.ts` (router, request-response) — NEW

**Analogs:** `packages/api/src/trpc/routers/projects.ts` (the withAnon published-only resolve) + `packages/api/src/trpc/routers/media.ts` (the withTenant read → guard → mutate shape).

**Imports pattern** — clone the fenced import set (only `withTenant`/`withAnon`/`schema` from `@imbau/db`, NEVER `appDb`/`createOwnerDb` — T-03-09 grep-fence). From `media.ts` lines 11-16 + `projects.ts` line 11:
```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, desc } from "drizzle-orm";
import { withAnon, withTenant, schema } from "@imbau/db";
import { calcQuote, ENGINE_VERSION, type QuoteInput } from "@imbau/quoting";
import { router, publicProcedure } from "../init";
```
Note: `quoteInsertSchema` is exported from `@imbau/db` (co-located in `packages/db/src/schema/quotes.ts` line 75) — import it for the `create` insert.

**withAnon org-resolve pattern** (D-03) — clone `projects.ts` `listPublished` (lines 20-22), but resolve a single project by id and read back `organizationId`. The anon policy filters `estado='publicado'` server-side; a client orgId is never read:
```typescript
// projects.ts:20-22 — the withAnon shape to extend with a WHERE id + returning organizationId
listPublished: publicProcedure.query(() =>
  withAnon((tx) => tx.select().from(schema.projects)),
),
```
Extended (RESEARCH Pattern 1, lines 197-201): `withAnon((tx) => tx.select({id, organizationId}).from(schema.projects).where(eq(schema.projects.id, input.projectId)))`; `if (!proj[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Proyecto no publicado." })`.

**withTenant read → guard → compute pattern** — clone `media.ts` `confirmUpload` (lines 66-92): read under `withTenant(orgId)`, guard the missing row with a typed `TRPCError`, then act. Apply to CAC `max(periodo)` (D-07) + prices + plan:
```typescript
// media.ts:69-84 — the withTenant SELECT + PRECONDITION_FAILED guard shape to clone
const rows = await withTenant(ctx.activeOrgId, (tx) =>
  tx.select().from(schema.media).where(eq(schema.media.id, input.mediaId)),
);
const media = rows[0];
if (!media) { throw new TRPCError({ code: "NOT_FOUND" }); }
const exists = await headOriginal(media.originalKey);
if (!exists) {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Original bytes not found in R2; upload did not complete.",
  });
}
```
For quotes: after `.orderBy(desc(schema.cacIndex.periodo)).limit(1)`, guard `if (!cac[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No hay índice CAC cargado para este proyecto. Cargá el CAC en el panel." })` (D-08, es-AR).

**Row→QuoteInput mapping** — numeric strings pass STRAIGHT through (Pitfall 3, never `parseFloat`). The engine input types (`packages/quoting/src/types.ts` lines 34-63) explicitly type `anticipoPct: string` and `cac.valor: string`; integer columns (`precio`, `cuotas`, `montoUsd`) are `number`. `calcQuote` throws `QuoteError` on degenerate input — do NOT catch-and-normalize (D-05); let it propagate (the errorFormatter surfaces the code).

**Shared private core** (Discretion — recommended yes): one `async function resolveAndQuote(input)` doing anon-resolve → withTenant read → map → `calcQuote`, returning `{ orgId, quoteInput, result, cacPeriodo }`. `compute` returns `result`; `create` extends with the insert below.

**Snapshot insert pattern** (create only, D-04/QUOTE-02) — clone `media.ts` withTenant-write posture; validate the envelope through `quoteInsertSchema` (RESEARCH Pattern 2, lines 222-231):
```typescript
const snapshot = { version: 1 as const, inputs: quoteInput, result, cacPeriodo };
const values = quoteInsertSchema.parse({
  organizationId: orgId, projectId: input.projectId, unitId: input.unitId,
  paymentPlanId: input.paymentPlanId, snapshot,
});
const [row] = await withTenant(orgId, (tx) =>
  tx.insert(schema.quotes).values(values).returning({ id: schema.quotes.id }));
return { quoteId: row.id, result };
// NO enqueue — fase 7 wires the PDF producer (D-13).
```

**Router assembly** — clone the `router({...})` factory shape from `projects.ts` lines 14-23 / `media.ts` lines 34-93. Both procedures are `publicProcedure` (anonymous buyer, D-03) with a `z.object({...})` `.input()` and `.mutation(async ({ input }) => ...)` (no `ctx` tenant — org is resolved inside).

---

### `packages/api/src/trpc/init.ts` (config) — MODIFIED

**Analog:** itself. Today line 14 is a bare `initTRPC.context<TRPCContext>().create();` with NO formatter. Add an `errorFormatter` that copies `QuoteError.code` into `data` (D-08, RESEARCH Pattern 3 lines 236-249, `[CITED: trpc.io/docs/server/error-formatting]`):
```typescript
import { QuoteError } from "@imbau/quoting"; // add to imports (line 11 area)

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        quoteErrorCode: cause instanceof QuoteError ? cause.code : undefined,
      },
    };
  },
});
```
Resolvers throw `new TRPCError({ code: "BAD_REQUEST", message, cause: quoteError })` so the formatter surfaces the machine code without leaking the error object. `QuoteError.code` is one of 7 values (`packages/quoting/src/errors.ts` lines 21-28). Keep the existing `router`/`publicProcedure`/`protectedProcedure`/`createTRPCContext` exports (lines 16-39) untouched.

---

### `packages/api/src/trpc/routers/_app.ts` (router registry) — MODIFIED

**Analog:** itself. Mirror the `media` registration exactly (lines 13, 20):
```typescript
import { quotesRouter } from "./quotes";      // add near line 13
// ...
export const appRouter = router({
  projects: projectsRouter,
  org: orgRouter,
  member: memberRouter,
  invitation: invitationRouter,
  media: mediaRouter,
  quotes: quotesRouter,                        // add here
});
```

---

### `packages/api/tests/quotes-router.test.ts` (integration test) — NEW

**Analog:** `packages/api/tests/trpc-tenant.test.ts`.

**Caller + real-PG pattern** — clone the whole harness: `createCaller` + `ownerSql()` seed helper + `makeUserWithActiveOrg` fixture (lines 10-56). Anon calls use `new Headers()` (line 108 — `listPublished` precedent), tenant seeding uses the owner pool (lines 26-34):
```typescript
import { createCaller, type CreateContextOptions } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";
const owner = ownerSql();
// seed publicado project + pricing via owner`insert into ...` (lines 26-34 pattern)
// anon caller: await createCaller({ headers: new Headers() })
```
**Test-map coverage** (RESEARCH lines 435-439): (1) anon `quotes.compute` on a publicado project resolves org, reads CAC, returns `QuoteResult`; non-publicado → `NOT_FOUND`. (2) missing CAC → `PRECONDITION_FAILED` (not 500) — assert `.rejects.toMatchObject({ code: "PRECONDITION_FAILED" })` (mirror lines 74-77). (3) `quotes.create` persists snapshot `{version:1, inputs, result, cacPeriodo}`, row visible only under `withTenant(org)`, `result.version === ENGINE_VERSION`. (4) degenerate plan → `BAD_REQUEST` with `data.quoteErrorCode`. Seed pricing: reuse `packages/db/src/seed/{pricing,ids}.ts` (Brigos Recoleta: 2 price_lists, CAC-adjusted payment_plans, 18-month cac_index) OR seed inline via owner like `seedProject`.

---

### `packages/storage/src/quote-pdf.ts` (shared contract) — NEW

**Analog:** `packages/storage/src/queue.ts` (byte-for-byte molecule, D-13). Same "const + interface + pure options helper, NO bullmq import" shape (lines 12-39):
```typescript
export const QUOTE_PDF_QUEUE = "quote-pdf";
export interface QuotePdfJobData {
  readonly quoteId: string;
  readonly organizationId: string;
  readonly projectId: string;
}
export function quotePdfJobOptions(quoteId: string): {
  jobId: string; attempts: number; backoff: { type: "exponential"; delay: number };
} {
  return { jobId: quoteId, attempts: 5, backoff: { type: "exponential", delay: 2000 } };
}
```
Match `queue.ts`'s `jobId = <id>` dedup rationale (idempotent re-enqueue) and 5-attempt exponential backoff.

---

### `packages/storage/src/keys.ts` (pure key derivation) — MODIFIED

**Analog:** itself (`originalKey`/`variantKey`, lines 10-28). Add a deterministic, idempotent-on-retry key in the same style:
```typescript
export function quotePdfKey(orgId: string, projectId: string, quoteId: string): string {
  return `quotes/${orgId}/${projectId}/${quoteId}.pdf`;
}
```

---

### `packages/storage/src/index.ts` (barrel) — MODIFIED

**Analog:** itself (lines 6-8). Mirror the `MEDIA_QUEUE`/`MediaJobData` export split (`export` for runtime, `export type` for type-only, per verbatimModuleSyntax):
```typescript
export { originalKey, variantKey, quotePdfKey } from "./keys";
export { QUOTE_PDF_QUEUE, quotePdfJobOptions } from "./quote-pdf";
export type { QuotePdfJobData } from "./quote-pdf";
```

---

### `apps/web/app/api/trpc/[trpc]/route.ts` (route mount) — NEW

**Analog:** `apps/panel/app/api/trpc/[trpc]/route.ts` — byte-mirror (verified identical target). Copy verbatim (lines 6-18):
```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@imbau/api";

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });
}
export { handler as GET, handler as POST };
```

---

### `apps/web/env.ts` (config) — MODIFIED

**Analog:** itself. Today the `server` block (lines 17-27) declares `DATABASE_ANON_URL` and a comment documents "anon-only (D-03)". D-06/A1 widens this: add `DATABASE_APP_URL` alongside it (mirror the `DATABASE_ANON_URL: dbEnv.server.DATABASE_ANON_URL` line 21), and rewrite the anon-only comment (lines 6-14) to document the app-pool widening (grep-fenced to withTenant inside quotesRouter). `DATABASE_APP_URL` already exists on the web container (`compose.staging.yml env_file: [.env]`) — no new secret. `packages/db/src/env.ts` (dbEnv) already validates it; this surfaces it at the app boundary (Pitfall 6). The `@imbau/db` boot builds `appDb` from it, so failing to surface it locally breaks the web route handler.

---

### `deploy/nginx/staging.tours.andescode.com.ar.conf` (infra) — MODIFIED

**Analog:** itself — the pre-documented `limit_req` skeleton (lines 71-78, commented). Activate it for the quotes tRPC path (D-10/D-11, RESEARCH lines 342-357). Add the zone in the `http{}` context (this file only contains `server{}` blocks — the zone lives in the host's `nginx.conf` http context, or a top-of-file note directs where it goes):
```nginx
# http{} context (top-level, outside server blocks):
limit_req_zone $binary_remote_addr zone=quotes:10m rate=10r/s;   # D-11 starting point
```
Inside the HTTPS :443 **web** server block (`server_name staging.tours.andescode.com.ar`, after line 55), a dedicated location BEFORE `location /`:
```nginx
location ^~ /api/trpc/quotes {
    limit_req zone=quotes burst=20 nodelay;   # D-11
    limit_req_status 429;                      # CRITICAL — nginx default is 503 [CITED]
    proxy_pass http://127.0.0.1:8092;          # web container loopback (same as location /)
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
}
```
Apply BY HAND on the VPS (sites-available + `nginx -t` + `systemctl reload nginx`), NEVER `certbot --nginx`, prod/panel vhosts untouched (D-12, same as 04-07). The 429 burst is a human UAT step (not CI). Panel :443 block (lines 82-118) stays untouched — the limit is web-only.

## Shared Patterns

### Tenant isolation (the load-bearing crux — QUOTE-01, Pitfall 1)
**Source:** `packages/db/src/with-tenant.ts` (`withAnon`/`withTenant`), demonstrated in `routers/projects.ts` (withAnon) + `routers/media.ts` (withTenant).
**Apply to:** `quotes.ts` (both procedures) and the router test.
Anon resolves the org from the published project (`withAnon` on `projects`), then the app pool scoped to that org (`withTenant(orgId)`) reads CAC/prices + inserts. `cac_index`/`quotes` are tenant-private (`packages/db/src/schema/quotes.ts` line 63 — `quotes_tenant` policy only, no anon policy) → an anon SELECT/INSERT raises `42501`. NEVER add anon policies; NEVER `WHERE organization_id = ?` at the app layer (RLS is the boundary). NEVER read orgId/price/CAC from the request body.

### Grep-fence on the data-access surface (T-03-09)
**Source:** convention enforced across `routers/projects.ts` (lines 9-10 comment) and `media.ts` (line 10 comment).
**Apply to:** `quotes.ts` and `apps/web` (post-A1). Routers import ONLY `withTenant`/`withAnon`/`schema`/`quoteInsertSchema` from `@imbau/db` — never `appDb`/`createOwnerDb`. This is the fence that makes A1 (web holding the app pool) safe and grep-verifiable.

### Typed, observable error surface (D-08, V7)
**Source:** `media.ts` `TRPCError` guards (lines 75-84) + `packages/quoting/src/errors.ts` (`QuoteError.code`, 7 codes) + new `init.ts` errorFormatter.
**Apply to:** `quotes.ts`. Missing CAC → `PRECONDITION_FAILED` (es-AR message); degenerate plan → `QuoteError` propagates → `BAD_REQUEST` + `data.quoteErrorCode`. Never a cryptic 500; log (pino) + report (Sentry) on error paths; never leak internals to the client.

### Numeric-string boundary (Pitfall 3)
**Source:** `packages/quoting/src/types.ts` lines 34-48 (`anticipoPct: string`, `cac.valor: string`).
**Apply to:** the row→`QuoteInput` mapper in `quotes.ts`. Drizzle `numeric` → JS string; pass straight into `QuoteInput` (the engine wraps in Decimal). Never `parseFloat`/`Number(...)`.

### Shared queue contract (no bullmq import)
**Source:** `packages/storage/src/queue.ts` (MEDIA_QUEUE molecule).
**Apply to:** `quote-pdf.ts` + barrel. Const + interface + pure options helper; `@imbau/storage` never depends on bullmq — producer (fase 7) and consumer construct their own Queue/Worker around the shared values.

## No Analog Found

None. Every file has an exact in-repo analog (this phase is deliberately clone-and-compose — RESEARCH: "correctness comes almost entirely from not writing new code").

## Metadata

**Analog search scope:** `packages/api/src/trpc/**`, `packages/api/tests/**`, `packages/storage/src/**`, `packages/quoting/src/**`, `packages/db/src/schema/**`, `apps/{panel,web}/**`, `deploy/nginx/**`
**Files scanned:** 14 (all read directly; no re-reads)
**Pattern extraction date:** 2026-07-03
