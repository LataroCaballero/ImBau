# Phase 5: Emisión y persistencia server-side (API + RLS + rate limit) - Research

**Researched:** 2026-07-03
**Domain:** tRPC v11 `publicProcedure` boundary + Postgres RLS (withTenant/withAnon) + versioned snapshot persistence + nginx edge rate limit, on the existing ImBau multi-tenant monorepo
**Confidence:** HIGH (codebase-grounded — every seam verified by direct read; the only non-codebase facts are nginx `limit_req` status semantics [CITED] and the tRPC v11 error-formatter shape [CITED])

<user_constraints>
## User Constraints (from CONTEXT.md)

> The user delegated ALL technical decisions of this phase to Claude ("son cosas muy técnicas que se escapan"). The D-01..D-13 below are Claude's founded choices; the planner treats them as **locked**, identical to user decisions.

### Locked Decisions

**Superficie del API y semántica de emisión**
- **D-01 Dos procedures:** `quotesRouter` expone `quotes.compute` (efímero: resuelve, computa y devuelve `QuoteResult` — **sin escritura a DB**) y `quotes.create` (computa Y persiste el snapshot, devuelve `quoteId` + `QuoteResult`). "Cotización emitida" (QUOTE-02) = las creadas por `create`; los computes interactivos de la UI (fase 6) no persisten — evita el write-amplifier de spam (Pitfall 6).
- **D-02 Cuándo se emite:** `create` se dispara cuando el comprador acciona (CTA WhatsApp / pedido de PDF — el cableado UI llega en fase 6). Esta fase entrega ambos procedures funcionando y testeados vía caller; la fase 6 decide desde qué interacción llama a cada uno.
- **D-03 Resolución de org server-side:** ambos procedures reciben IDs (proyecto/unidad/plan) + parámetros del comprador (anticipo/plazo dentro de bounds), resuelven la org con `withAnon` (`SELECT ... FROM projects WHERE id = ? AND estado = 'publicado'`) **revalidando en cada request**, y recién entonces abren `withTenant(orgId)` para leer `unit_prices`/`payment_plans`/`cac_index` e insertar. Jamás un orgId provisto por el cliente; jamás precios/CAC del request body (el server re-lee siempre — Pitfall 5).
- **D-04 Snapshot PII-free:** `snapshot` = inputs financieros resueltos + `QuoteResult` + `ENGINE_VERSION` + período CAC usado. Ningún dato de contacto del comprador entra al snapshot — el contacto vive en `leads` (fase futura) linkeado por `quotes.leadId` (Pitfall 6).
- **D-05 Validación al borde:** inputs con Zod en el procedure; el insert pasa por `quoteInsertSchema` (envelope `{version: 1}` ya fijado). Errores del motor (`QuoteError` tipado de fase 4) se propagan como errores de dominio, nunca se normalizan en silencio.

**A1 vs A2 — dónde vive el pool `app`**
- **D-06 Se resuelve A1:** `apps/web` gana `DATABASE_APP_URL` en el bloque `server` de su `env.ts` y monta su propio route handler tRPC (`app/api/trpc/[trpc]/route.ts`, espejo del panel). Web deja de ser "anon-only" pero SOLO a través de `withTenant` dentro de procedures del `quotesRouter` — el fence es que `apps/web` (y todo router) sigue importando únicamente `withTenant`/`withAnon`/`schema` de `@imbau/db`, nunca `appDb`/`createOwnerDb` (grep-verificable, patrón T-03-09). Registrar como Key Decision en PROJECT.md al cerrar la fase, actualizando el comentario de `apps/web/env.ts` que hoy documenta el anon-only.

**CAC vigente y superficie de errores**
- **D-07 "CAC vigente" = último período cargado:** `max(periodo)` de `cac_index` para la org (no el mes calendario estricto). El `periodo` usado queda registrado en los inputs del snapshot.
- **D-08 Errores claros, tipados, observables:** sin ningún CAC cargado → `TRPCError` `PRECONDITION_FAILED` + mensaje es-AR accionable; inputs inválidos / plan degenerado → `BAD_REQUEST` reusando los códigos de `QuoteError` como código machine-readable en `data`. Nunca un 500 críptico; el error se loguea (pino) y se reporta (Sentry) sin filtrar internals al cliente.
- **D-09 Sin cutoff de staleness:** si el último CAC es viejo, se cotiza igual. No inventar validaciones de frescura en el MVP.

**Rate limit en el edge (QUOTE-03)**
- **D-10 Solo nginx en el MVP:** `limit_req` per-IP (`limit_req_zone $binary_remote_addr` en el contexto `http{}`) aplicado en un `location` dedicado al path tRPC de quotes (`^~ /api/trpc/quotes`) del vhost **web** únicamente. Sin token bucket Redis in-app. Vhosts existentes y prod intactos.
- **D-11 Valores punto-de-partida:** zona `quotes` con `rate=10r/s burst=20 nodelay`; respuesta 429. Números exactos ajustables en planning/UAT sin cambiar la decisión.
- **D-12 Verificación:** aplicación a mano en el VPS (sites-available + `nginx -t` + reload), y un burst de `curl` que demuestre el 429 como paso de UAT humano. El archivo versionado en `deploy/nginx/` es la fuente de verdad.

**Contrato de queue PDF (dependencia de fase 7)**
- **D-13 Contrato sí, producer no:** agregar a `packages/storage` el contrato del pipeline PDF — `QUOTE_PDF_QUEUE`, `QuotePdfJobData` (`{quoteId, organizationId, projectId}`), `quotePdfKey()`, `quotePdfJobOptions()` — con el patrón "shared contract, no bullmq import" de `queue.ts`. `quotes.create` **NO encola jobs todavía**.

### Claude's Discretion
- Números finales de rate/burst del `limit_req` (D-11 es punto de partida).
- Forma exacta del shape de error tRPC (`data` payload, mapping QuoteError→TRPCError code por código).
- Nombres de funciones/archivos, estructura interna del router, helper compartido de resolución proyecto→org.
- Estrategia de tests (caller de integración contra Postgres real reusando `trpc-tenant.test.ts` + seed "Brigos Recoleta"; qué se mockea y qué no).
- Si `compute` y `create` comparten un core interno único (recomendado: sí, una función privada `resolveAndQuote` que create extiende con el insert).

### Deferred Ideas (OUT OF SCOPE)
- Token bucket Redis in-app como segunda capa de rate limiting — reevaluar si nginx `limit_req` resulta insuficiente.
- Enqueue del job PDF desde `quotes.create` — fase 7 (junto con el processor, D-13).
- Creación de lead al accionar WhatsApp/contacto — milestone futuro; `quotes.leadId` ya deja el slot.
- Ingesta automática del índice CAC (COTIZ-F04) — Future Requirements.
- UI del cotizador y cliente tRPC de `apps/web` como superficie visible — fase 6 (acá solo se monta el route handler server-side).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUOTE-01 | Comprador anónimo genera cotización; cómputo + persistencia server-side vía procedure público con `withTenant` (sin policies anon a `quotes`/`cac_index`) | `withTenant`/`withAnon` verified in `packages/db/src/with-tenant.ts`; `quotes`/`cac_index` are tenant-private (verified in schema). Pattern: `projects.listPublished` (withAnon) resolves org → `withTenant(orgId)` reads CAC/prices + inserts. `calcQuote` (fase 4) consumed as-is. |
| QUOTE-02 | Cada cotización emitida persiste snapshot completo (inputs + outputs + `ENGINE_VERSION`) en `quotes.snapshot` | `quoteInsertSchema` + `quoteSnapshotSchema` (`{version:1}.passthrough()`) verified. `QuoteResult` already embeds `version`. Snapshot envelope = `{version:1, inputs:{...}, result:QuoteResult, cacPeriodo}`. |
| QUOTE-03 | Endpoint anónimo con rate limit en el edge (nginx `limit_req`, no Traefik) | Pre-documented `limit_req` skeleton in `deploy/nginx/staging.tours.andescode.com.ar.conf`. **CRITICAL:** default reject status is 503 — must add `limit_req_status 429;` [CITED]. |
</phase_requirements>

## Summary

This phase is **pure integration wiring on top of already-shipped seams** — the research consolidates verified facts, it does not open new technical ground. Every load-bearing component exists and was read directly: `withTenant`/`withAnon` (the only sanctioned data-access helpers), the `publicProcedure`/`protectedProcedure` split, the `quotes` tenant-private schema with its `quoteInsertSchema` envelope validator, the complete `packages/quoting` engine (`calcQuote`, `QuoteError` with 7 codes, `ENGINE_VERSION`), the media router as a copy-paste template for the `withTenant`-insert pattern, the `packages/storage/queue.ts` "shared contract, no bullmq" molecule, and the nginx vhost with a pre-documented `limit_req` skeleton.

The single load-bearing architectural fact (from milestone ARCHITECTURE.md, re-verified here): `quotes` and `cac_index` are **tenant-private** — an anon SELECT/INSERT raises Postgres `42501`. Therefore an anonymous buyer's quote MUST be computed and persisted **server-side through the app pool** (`withTenant(resolvedOrgId)`), never the anon browser role. The org is resolved from the published project via `withAnon` and re-validated on every request; prices and CAC are always re-read server-side, never trusted from the request body. This is D-03 and Pitfall 5 — the #1 integration pitfall of the milestone.

Three phase-specific gaps were filled beyond the milestone research: (1) **nginx `limit_req` defaults to HTTP 503, not 429** — D-11 requires 429, so the config must add `limit_req_status 429;` [CITED]; (2) the **QuoteError→TRPCError mapping** needs a tRPC v11 `errorFormatter` on `initTRPC` to surface the machine-readable `code` in `data` (none exists today — `init.ts` uses a plain `.create()`); (3) **A1 (D-06) is low-risk at the infra layer** because the web container already receives `DATABASE_APP_URL` via `env_file: [.env]` in `compose.staging.yml` — the change is surfacing it in `apps/web/env.ts` + mounting the route handler, not new infra.

**Primary recommendation:** Build one `quotesRouter` with a shared private `resolveAndQuote(input)` core (withAnon org-resolve → withTenant read CAC/prices → map rows to `QuoteInput` → `calcQuote`); `quotes.compute` returns its `QuoteResult`, `quotes.create` extends it with a `withTenant` INSERT validated by `quoteInsertSchema`. Add a tRPC `errorFormatter` mapping `QuoteError.code` into `data.quoteErrorCode`. Mirror the panel's route handler into `apps/web`, add `DATABASE_APP_URL` to `apps/web/env.ts` server block, add the `limit_req` zone + `location ^~ /api/trpc/quotes` block (with `limit_req_status 429`) to the web vhost, and add the PDF-queue contract to `packages/storage` (no producer). Integration-test via the tRPC caller against real Postgres reusing the `trpc-tenant.test.ts` pattern + the "Brigos Recoleta" seed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Org resolution from published project | API / Backend (`quotesRouter` via `withAnon`) | Database (anon RLS policy filters `estado='publicado'`) | Server-derived only (D-03); a client-supplied orgId is never trusted (T-03-05). |
| CAC + price read for anonymous buyer | API / Backend (`withTenant` app pool) | Database (tenant RLS on `cac_index`/`unit_prices`/`payment_plans`) | `cac_index`/`quotes` are tenant-private → must run app-pool server-side, not anon browser role (Pitfall 5). |
| Quote computation | API / Backend (calls pure `packages/quoting`) | — | `calcQuote` is pure/no-I/O (fase 4); the API only maps DB rows → `QuoteInput`. Never client-side (Anti-Pattern 1). |
| Snapshot persistence | API / Backend (`withTenant` INSERT) | Database (`quotes_tenant` withCheck) | Server-authoritative, versioned, point-in-time (QUOTE-02). |
| Edge rate limiting | CDN / Edge (host nginx `limit_req`) | — | Anonymous write funnel; throttled at the edge, not in-app (D-10). Traefik does NOT exist on staging (D-01). |
| PDF queue contract | API package boundary (`packages/storage`) | — | Shared contract only; producer (enqueue) + consumer (worker) are fase 7 (D-13). |
| Route-handler mount | Frontend Server (`apps/web` App Router) | — | Mirror of panel's `/api/trpc/[trpc]/route.ts`; server runtime holds the app pool (A1/D-06). |

## Standard Stack

No new external packages. This phase composes libraries already installed and version-pinned in the monorepo. Verified from `packages/api/package.json` + `packages/db/package.json` on 2026-07-03.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@trpc/server` | `11.17.0` | `quotesRouter` `publicProcedure`s + `errorFormatter` | Already the API layer; v11 first-class App Router support. `[VERIFIED: packages/api/package.json]` |
| `zod` | `4.4.3` | Input validation at the procedure boundary | Already the tRPC boundary validator. `[VERIFIED: packages/api/package.json]` |
| `drizzle-orm` | `0.45.2` | Queries inside `withTenant`/`withAnon` | The sanctioned query builder. `[VERIFIED]` |
| `postgres` (porsager) | `3.4.9` | Driver behind `appDb`/`anonDb` | Transaction-scoped GUC pattern. `[VERIFIED]` |
| `@imbau/quoting` | workspace | `calcQuote`, `QuoteError`, `ENGINE_VERSION`, `QuoteInput`/`QuoteResult` | Fase-4 engine consumed as-is — API only maps rows→input. `[VERIFIED: packages/quoting/src/index.ts]` |
| `@imbau/db` | workspace | `withTenant`, `withAnon`, `schema`, `quoteInsertSchema` | The only sanctioned data-access surface. `[VERIFIED: with-tenant.ts]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-zod` | `0.8.3` | `quoteInsertSchema = createInsertSchema(quotes, {snapshot: quoteSnapshotSchema})` | Already authored in `quotes.ts`; import to validate the insert. `[VERIFIED]` |
| `@trpc/server/adapters/fetch` | `11.17.0` | `fetchRequestHandler` for the web route handler | Copy panel's `app/api/trpc/[trpc]/route.ts` verbatim. `[VERIFIED]` |
| `pino` (via app logger) | installed | Structured error logging (D-08) | On the `PRECONDITION_FAILED`/domain-error paths. `[VERIFIED: STATE.md observability]` |
| `@sentry/nextjs` | installed | Error reporting (D-08) | Non-domain failures reported; internals never leaked to client. `[VERIFIED]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A1 (`apps/web` holds app pool) | A2 (relocate emission to panel/dedicated API route) | Cleaner isolation but one more moving part + a cross-app hop from web UI. **D-06 chose A1** — the app-pool URL is already in the web container, so the marginal risk is a documented, grep-fenced widening. |
| tRPC `errorFormatter` for machine code | Attach code only to `TRPCError.cause` | `errorFormatter` surfaces `code` in `data` for the client without leaking the internal error object; recommended for D-08. |
| Shared `resolveAndQuote` core | Duplicate resolve logic in compute + create | Duplication risks drift between the ephemeral and persisted paths. Discretion allows either; shared core recommended. |

**Installation:** None. All dependencies present.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** It composes workspace packages (`@imbau/quoting`, `@imbau/db`, `@imbau/storage`, `@imbau/api`) and already-pinned deps (`@trpc/server` 11.17.0, `zod` 4.4.3, `drizzle-orm` 0.45.2, `postgres` 3.4.9) that were legitimacy-audited in prior milestones.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Anonymous buyer (fase 6 UI, not this phase)
        │  compute / create   (IDs + anticipo/plazo params; NEVER orgId, NEVER price/CAC)
        ▼
apps/web  ── app/api/trpc/[trpc]/route.ts  (NEW mount, mirror of panel; A1/D-06)
        │   fetchRequestHandler → appRouter
        ▼
packages/api  quotesRouter (NEW)
        │
        ├─ publicProcedure "compute"  ─────────────┐
        └─ publicProcedure "create"   ─────────────┤
                                                    ▼
                        resolveAndQuote(input)  (shared private core)
                          1. withAnon:  SELECT projects WHERE id=? AND estado='publicado' → orgId
                                        (anon RLS policy enforces publicado; revalidated per request)
                          2. withTenant(orgId):  read unit_prices (contado+financiado),
                                        payment_plan, cac_index (max periodo)   [app pool, tenant RLS]
                          3. map rows → QuoteInput (numeric strings straight through — NO parseFloat)
                          4. calcQuote(input) → QuoteResult   (pure; throws QuoteError on degenerate)
                                                    │
        compute → return QuoteResult ──────────────┤
        create  → additionally:                     ▼
                          5. withTenant(orgId): INSERT quotes (snapshot validated by quoteInsertSchema)
                          6. return { quoteId, result }
                          (NO enqueue — fase 7 wires the PDF producer, D-13)
                                                    │
        ▼                                           ▼
errorFormatter maps QuoteError.code → data.quoteErrorCode   PostgreSQL 16 (RLS)
   (BAD_REQUEST); missing CAC → PRECONDITION_FAILED           quotes / cac_index  tenant-private
   pino + Sentry on error paths (D-08)                        unit_prices / payment_plans  anon-published

Edge:  host nginx vhost (web)  location ^~ /api/trpc/quotes { limit_req zone=quotes burst=20 nodelay;
                                                              limit_req_status 429; proxy_pass web; }

packages/storage (NEW contract, no producer):  QUOTE_PDF_QUEUE, QuotePdfJobData, quotePdfKey(), quotePdfJobOptions()
```

### Recommended Project Structure
```
packages/api/src/trpc/routers/
├── quotes.ts        # NEW quotesRouter (compute + create + private resolveAndQuote)
└── _app.ts          # MODIFIED: register quotes
packages/api/src/trpc/
└── init.ts          # MODIFIED: add errorFormatter (QuoteError.code → data)
packages/api/tests/
└── quotes-router.test.ts   # NEW integration test (caller + real Postgres + Brigos seed)
packages/storage/src/
├── quote-pdf.ts     # NEW: QUOTE_PDF_QUEUE, QuotePdfJobData, quotePdfJobOptions
├── keys.ts          # MODIFIED: add quotePdfKey(orgId, projectId, quoteId)
└── index.ts         # MODIFIED: export the new contract
apps/web/
├── app/api/trpc/[trpc]/route.ts   # NEW mount (mirror of panel)
└── env.ts           # MODIFIED: add DATABASE_APP_URL to server block; update anon-only comment
deploy/nginx/
└── staging.tours.andescode.com.ar.conf   # MODIFIED: limit_req_zone (http) + location (web) + limit_req_status 429
```

### Pattern 1: withAnon-resolve → withTenant-compute/persist (the tenant-private crux)
**What:** Resolve org from the published project via the anon pool, then elevate to the app pool scoped to that org for the privileged CAC read + quote insert. Never expose CAC/quotes to the anon role.
**When to use:** Both `compute` and `create`.
**Example:**
```typescript
// packages/api/src/trpc/routers/quotes.ts  — shape, not final code
// Source: verified seams — with-tenant.ts, projects.ts (withAnon), media.ts (withTenant insert)
import { withAnon, withTenant, schema, quoteInsertSchema } from "@imbau/db";
import { calcQuote, ENGINE_VERSION, type QuoteInput } from "@imbau/quoting";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

async function resolveAndQuote(input: ComputeInput) {
  // 1. anon resolve + revalidate publicado (RLS filters; a client orgId is never read — D-03)
  const proj = await withAnon((tx) =>
    tx.select({ id: schema.projects.id, organizationId: schema.projects.organizationId })
      .from(schema.projects).where(eq(schema.projects.id, input.projectId)));
  if (!proj[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Proyecto no publicado." });
  const orgId = proj[0].organizationId;

  // 2. app-pool read: prices (contado+financiado), plan, CAC max(periodo) — all tenant-scoped
  return withTenant(orgId, async (tx) => {
    // ...select unit_prices for both lists, payment_plan, cac max periodo...
    const cac = await tx.select().from(schema.cacIndex)
      .orderBy(desc(schema.cacIndex.periodo)).limit(1);   // D-07: max periodo
    if (!cac[0]) throw new TRPCError({ code: "PRECONDITION_FAILED",
      message: "No hay índice CAC cargado para este proyecto. Cargá el CAC en el panel." }); // D-08
    // 3. map rows → QuoteInput (numeric strings pass straight in — NO parseFloat, Pitfall 1)
    const quoteInput: QuoteInput = mapRows(/* ...prices, plan, cac[0] */);
    const result = calcQuote(quoteInput);   // throws QuoteError → mapped by errorFormatter
    return { orgId, quoteInput, result, cacPeriodo: cac[0].periodo };
  });
}
```

### Pattern 2: Versioned snapshot insert (create only)
**What:** Persist `{ version: 1, inputs, result, cacPeriodo }` through `quoteInsertSchema` so the envelope is validated and the interior is engine-owned. `result.version === ENGINE_VERSION` already.
**Example:**
```typescript
// create extends resolveAndQuote with the insert (withCheck enforces org match)
const snapshot = { version: 1 as const, inputs: quoteInput, result, cacPeriodo };
const values = quoteInsertSchema.parse({
  organizationId: orgId, projectId: input.projectId, unitId: input.unitId,
  paymentPlanId: input.paymentPlanId, snapshot,
});
const [row] = await withTenant(orgId, (tx) =>
  tx.insert(schema.quotes).values(values).returning({ id: schema.quotes.id }));
return { quoteId: row.id, result };
```

### Pattern 3: tRPC v11 errorFormatter — surface QuoteError.code (D-08)
**What:** `init.ts` currently calls `initTRPC.context<T>().create()` with no formatter. Add an `errorFormatter` that, when `error.cause instanceof QuoteError`, copies the machine-readable code into `shape.data`. Throw `new TRPCError({ code: "BAD_REQUEST", message, cause: quoteError })` from the resolver.
**Example:**
```typescript
// packages/api/src/trpc/init.ts (MODIFIED) — Source: tRPC v11 error-formatter docs [CITED: trpc.io/docs/server/error-formatting]
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

### Anti-Patterns to Avoid
- **Adding anon policies to `cac_index`/`quotes` to "fix" 42501** — leaks every tenant's index / opens spam. Keep tenant-private; compute server-side (Pitfall 5, Anti-Pattern 2).
- **Trusting client-supplied orgId / price / CAC** — cross-tenant write & price tampering. Re-derive org from the published project; re-read prices/CAC from DB (Anti-Pattern 4, T-03-05).
- **Importing `appDb`/`createOwnerDb` in the router** — breaks the grep-fence (T-03-09). Only `withTenant`/`withAnon`/`schema`.
- **`parseFloat` on `anticipoPct`/`cac.valor`** — float contamination (Pitfall 1). Numeric strings pass straight into `QuoteInput` (the engine wraps them in Decimal).
- **Persisting on every `compute`** — write-amplifier / spam. Only `create` persists (D-01, Pitfall 6).
- **Relying on nginx default reject status** — it is 503, not 429. Must set `limit_req_status 429;` (QUOTE-03/D-11).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant isolation on the quote path | Manual `WHERE organization_id = ?` | `withTenant(orgId)` + RLS policies | RLS is the enforced boundary; app-layer filters silently diverge (media/projects routers set the precedent). |
| Snapshot envelope validation | Ad-hoc object assembly | `quoteInsertSchema` (`quoteSnapshotSchema`) | Envelope `{version:1}` + passthrough already authored; rejects a payload missing `version`. |
| Quote math | Re-derive in the router | `calcQuote` from `@imbau/quoting` | Pure, 100%-covered, property-tested engine; router only maps rows→input. |
| PDF queue contract | Inline queue name/type in api + worker | `QUOTE_PDF_QUEUE`/`QuotePdfJobData` in `@imbau/storage` | One source of truth; producer/consumer can't drift (mirror `MEDIA_QUEUE`). |
| Edge throttle | In-app counter | nginx `limit_req` | Edge is the right tier; in-app token bucket is deferred (D-10). |
| Rate-limit reject status | Assume 429 | Explicit `limit_req_status 429;` | nginx default is 503 [CITED]. |

**Key insight:** This phase's correctness comes almost entirely from *not writing new code* — reusing `withTenant`, `calcQuote`, `quoteInsertSchema`, and the media/projects router patterns. The only genuinely new logic is org-resolution + row→`QuoteInput` mapping + the error mapping.

## Runtime State Inventory

Not a rename/refactor/migration phase — greenfield router + config additions, **no schema change, no data migration**. One deliberate config-surface widening to note (not runtime state to migrate):

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `quotes.snapshot` is new writes only; no existing rows to migrate. | None. |
| Live service config | Host nginx vhost gains a `limit_req` zone + `location` block; applied by hand on the VPS (not auto-deployed). | Manual `nginx -t` + reload per D-12 (same as 04-07). |
| OS-registered state | None. | None. |
| Secrets/env vars | `DATABASE_APP_URL` already present in the web container via `env_file: [.env]` (verified `compose.staging.yml`); `@imbau/db` env already validates it. Only `apps/web/env.ts` (app-level t3-env schema) must surface it in the `server` block + update the anon-only comment. | Code edit to `apps/web/env.ts`; **no new secret**, no rotation. |
| Build artifacts | None — no package renames. | None. |

## Common Pitfalls

### Pitfall 1: Anon path raises 42501 on CAC/quotes (THE #1 integration trap)
**What goes wrong:** Reading `cac_index` or inserting `quotes` through the anon pool → Postgres `42501`, looks like an RLS bug.
**Why it happens:** The public buyer is anonymous; the instinct is to use `withAnon` end-to-end. But `cac_index`/`quotes` have no anon policy.
**How to avoid:** Resolve org via `withAnon` on `projects` (published-only), then do CAC read + insert via `withTenant(orgId)` (app pool). Never add anon policies.
**Warning signs:** `42501` on the quotes path; a migration adding anon to `cac_index`/`quotes`; prices/CAC coming from the request body.

### Pitfall 2: nginx `limit_req` returns 503, D-11 wants 429
**What goes wrong:** The `location ^~ /api/trpc/quotes` block throttles correctly but returns 503; the UAT expecting 429 fails and fase-6 retry logic keys off the wrong status.
**Why it happens:** nginx `limit_req` default reject status is 503 [CITED].
**How to avoid:** Add `limit_req_status 429;` in the location (or server) block.
**Warning signs:** curl burst returns `503 Service Temporarily Unavailable` instead of `429 Too Many Requests`.

### Pitfall 3: Float contamination at the numeric-string boundary
**What goes wrong:** `parseFloat(row.valor)` / `Number(anticipoPct)` before handing to the engine reintroduces float error across N cuotas.
**Why it happens:** Drizzle returns `numeric` (`anticipoPct`, `cac.valor`) as JS strings; TS silently coerces.
**How to avoid:** Pass the strings straight into `QuoteInput.plan.anticipoPct` / `cac.valor` — the engine wraps them in Decimal. The `QuoteInput` type explicitly types these as `string`.
**Warning signs:** `parseFloat`/`Number(...)` around price/CAC; `toBeCloseTo` in a quote test.

### Pitfall 4: `compute` persists / snapshot recompute drift
**What goes wrong:** Persisting on `compute` (spam), or later re-running `calcQuote` from IDs instead of reading the stored snapshot (fase 6/7 drift).
**How to avoid:** Only `create` inserts (D-01). Snapshot stores inputs+result+version so fase 7 renders from it, never re-computes (Pitfall 7 of milestone).
**Warning signs:** an INSERT in the `compute` path; fase-7 code importing `calcQuote`.

### Pitfall 5: Missing CAC surfaces as a cryptic 500
**What goes wrong:** No `cac_index` row for the org → an unhandled `undefined` access → opaque 500 (violates success criterion 1).
**How to avoid:** Guard `cac[0]` → `TRPCError({ code: "PRECONDITION_FAILED", message: "...cargá el CAC..." })`, logged (pino) + reported (Sentry), es-AR message, no internals leaked (D-08).
**Warning signs:** a 500 with a stack trace reaching the client; no explicit missing-CAC branch.

### Pitfall 6: `@imbau/db` boot in web needs all three DB URLs
**What goes wrong:** Importing `@imbau/db` in the web route handler triggers `client.ts` which builds `appDb` from `env.DATABASE_APP_URL` (db's own validated env). If the web process lacks it, boot fails closed.
**Why it happens:** `packages/db/src/env.ts` validates the full `dbEnv` (owner+app+anon). Verified: `compose.staging.yml` web uses `env_file: [.env]` (full bundle) → all three present. Locally, the dev must have `DATABASE_APP_URL` set.
**How to avoid:** Surface `DATABASE_APP_URL` in `apps/web/env.ts` (D-06) so the app boundary validates it too; ensure local `.env`/test env exports it.
**Warning signs:** web boots today (withAnon works) → URL already present; a missing-var error at web start after removing it from `.env`.

## Code Examples

### Web route handler (mirror of panel — verified)
```typescript
// apps/web/app/api/trpc/[trpc]/route.ts  (NEW — byte-mirror of apps/panel/app/api/trpc/[trpc]/route.ts)
// Source: apps/panel/app/api/trpc/[trpc]/route.ts (verified)
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

### nginx rate-limit (add to the web vhost)
```nginx
# In the http{} context (top of the conf, outside server blocks):
limit_req_zone $binary_remote_addr zone=quotes:10m rate=10r/s;   # D-11 starting point

# Inside the HTTPS :443 web server block (server_name staging.tours.andescode.com.ar):
location ^~ /api/trpc/quotes {
    limit_req zone=quotes burst=20 nodelay;   # D-11
    limit_req_status 429;                      # CRITICAL — default is 503 [CITED]
    proxy_pass http://127.0.0.1:8092;          # web container loopback (same as location /)
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
}
```
Note: tRPC batches queries; the batched path is `/api/trpc/quotes.compute,quotes.create?batch=1`. `location ^~ /api/trpc/quotes` matches the prefix. Confirm the fase-6 client does not batch quotes calls together with non-quotes procedures under a different path (a batched multi-router call posts to `/api/trpc/<first>` — for quotes-only calls the prefix holds).

### PDF queue contract (mirror of queue.ts — D-13, no producer)
```typescript
// packages/storage/src/quote-pdf.ts (NEW) — Source: packages/storage/src/queue.ts (verified pattern)
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
// keys.ts (MODIFIED): deterministic, idempotent-on-retry key
export function quotePdfKey(orgId: string, projectId: string, quoteId: string): string {
  return `quotes/${orgId}/${projectId}/${quoteId}.pdf`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `apps/web` strictly anon-only (D-03, v1.1) | `apps/web` holds app pool via `withTenant` inside `quotesRouter` only, grep-fenced (D-06/A1) | This phase | Documented Key Decision in PROJECT.md; comment in `apps/web/env.ts` updated. |
| Traefik rate-limit middleware (CLAUDE.md aspirational) | host nginx `limit_req` (D-01) | v1.1 (04-07) | No Traefik on staging; rate limit lives in `deploy/nginx/`. |

**Deprecated/outdated:**
- CLAUDE.md's "Traefik rate-limit middleware at the edge" — superseded by D-01 (host nginx + certbot). Do NOT plan a Traefik middleware.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | tRPC batches quotes calls under `/api/trpc/quotes.*` such that `location ^~ /api/trpc/quotes` reliably matches them | Code Examples (nginx) | If fase-6 batches quotes with other routers, the prefix may not match the POST path; rate limit would miss. Mitigation: fase-6 planner keeps quotes on a dedicated (unbatched or quotes-only) link, OR the limit is applied to all `/api/trpc/` on web. **Verify during fase-6 client wiring.** |

**Note:** The tRPC `errorFormatter` shape and nginx `limit_req_status` are `[CITED]` (official docs), not assumed. All other claims are `[VERIFIED]` against the codebase.

## Open Questions

1. **Batched tRPC path vs nginx prefix (see A1)**
   - What we know: tRPC v11 httpBatchLink posts to `/api/trpc/<procedures-joined>?batch=1`; a quotes-only batch starts with `quotes.`.
   - What's unclear: whether fase-6 will co-batch quotes with non-quotes calls.
   - Recommendation: Plan the nginx `location` as `^~ /api/trpc/quotes` now (correct for quotes-only calls); flag for fase-6 to keep the quotes client on a dedicated link, or widen the limit to `/api/trpc/` on the web vhost if co-batching is needed. Low stakes — the limit is tunable by hand (D-11/D-12).

2. **Contado vs financiado price resolution (which two `unit_prices` rows)**
   - What we know: seed has two `price_lists` per project ("Financiado" list price + "Contado" discounted); `QuoteInput` needs both `precioContadoUsd` + `precioFinanciadoUsd`.
   - What's unclear: whether the input carries `priceListId`(s) or the router resolves both lists for the unit by list name/`isContado` flag.
   - Recommendation: Router selects both `unit_prices` rows for the unit (join `price_lists.moneda`/name), maps to the two prices. Discretion — the planner picks the resolution key; the seed's `price_lists` have a stable `nombre`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 16 (`_test` DB) | Integration test (caller path) | ✓ (local recipe in MEMORY) | 16.x | — |
| `DATABASE_APP_URL` env in web/test | A1 app-pool path | ✓ (compose `env_file`; local `.env`) | — | Set locally per db-test recipe |
| host nginx on VPS | QUOTE-03 edge limit | ✓ (staging, host nginx owns 80/443) | — | — (manual apply, D-12) |
| Redis / BullMQ | PDF **contract** only (no producer) | ✓ (contract needs no runtime) | — | N/A — no enqueue this phase |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** local test run needs `DATABASE_APP_URL`/`_test` DB exports (documented recipe in user MEMORY `local-test-env-recipe`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `packages/api/vitest.config.ts` (globalSetup `tests/setup.ts`, hookTimeout 60s, testTimeout 30s) |
| Quick run command | `pnpm --filter @imbau/api test` |
| Full suite command | `pnpm test` (turbo, all packages) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUOTE-01 | anon caller → `quotes.compute` resolves published-project org, reads CAC, returns `QuoteResult`; a non-publicado project → NOT_FOUND | integration (caller + real PG) | `pnpm --filter @imbau/api test -t "quotes"` | ❌ Wave 0 (`packages/api/tests/quotes-router.test.ts`) |
| QUOTE-01 | missing CAC for org → `PRECONDITION_FAILED` (not 500) | integration | same file | ❌ Wave 0 |
| QUOTE-01 | `cac_index`/`quotes` never anon-readable (anon SELECT still 42501) | integration/negative | reuse tenant-private assertion pattern | ❌ Wave 0 (assert no policy added) |
| QUOTE-02 | `quotes.create` persists snapshot `{version:1, inputs, result, cacPeriodo}`; row visible only under `withTenant(org)`; `result.version === ENGINE_VERSION` | integration | same file | ❌ Wave 0 |
| QUOTE-02 | degenerate plan → `QuoteError` mapped to `BAD_REQUEST` with `data.quoteErrorCode` | integration | same file (errorFormatter) | ❌ Wave 0 |
| QUOTE-03 | nginx `limit_req` burst → 429 | **manual UAT** (infra, not CI — D-12) | `curl` burst on staging web vhost | N/A (human) |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/api test` (+ `pnpm --filter @imbau/api typecheck lint`)
- **Per wave merge:** `pnpm test` (full turbo suite; quoting 100% gate stays green)
- **Phase gate:** Full suite green + manual 429 UAT on staging before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/api/tests/quotes-router.test.ts` — covers QUOTE-01/02 via tRPC caller (reuse `trpc-tenant.test.ts` seeding pattern: mint org via `makeUserWithActiveOrg`, seed a **publicado** project + pricing via the owner/`withTenant` seed helpers, then call through `createCaller` with an empty-header (anon) context for `compute`/`create`).
- [ ] Seed fixtures: reuse `packages/db/src/seed/*` ("Brigos Recoleta": 2 price_lists, CAC-adjusted payment_plans, 18-month `cac_index`) — confirm a helper seeds pricing under the test org, or seed inline via the owner client like `seedProject` does.
- [ ] No framework install needed (Vitest already configured for `@imbau/api`).
- Manual (not automatable in CI): the 429 rate-limit burst (D-12) — belongs in VERIFICATION.md as a human UAT step, like the 04-07 nginx apply.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` (verified `.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Server-authoritative compute; org derived server-side; tenant-private tables stay private (documented crux). |
| V2 Authentication | no | The buyer is anonymous by design; no auth on the public quote path (org resolved from published project). |
| V4 Access Control | **yes** | RLS via `withTenant`/`withAnon`; `app_authenticated` is NOSUPERUSER/NOBYPASSRLS; no anon policy on `cac_index`/`quotes`; no client-supplied orgId (T-03-05); grep-fence on `appDb`/`createOwnerDb`. |
| V5 Input Validation | **yes** | Zod at the procedure boundary; `quoteInsertSchema` for the snapshot; `QuoteError` domain rejection (never normalize). |
| V6 Cryptography | no | No new crypto; secrets unchanged (`DATABASE_APP_URL` already provisioned). |
| V7 Error Handling & Logging | **yes** | Typed `TRPCError` codes; es-AR messages; pino + Sentry; **internals never leaked** to the client (D-08); errorFormatter exposes only a machine code, not the error object. |
| V11 Business Logic / Anti-automation | **yes** | Edge `limit_req` throttle on the anonymous write funnel (QUOTE-03); persist only on `create` (anti-spam, D-01/Pitfall 6). |

### Known Threat Patterns for {tRPC publicProcedure + RLS + anon write funnel}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read/write via client-supplied orgId | Elevation of Privilege / Tampering | Org re-derived from published project; `withTenant` withCheck; no client orgId read (T-03-05). |
| CAC index leak via anon policy | Information Disclosure | Keep `cac_index` tenant-private; server-side read only (Anti-Pattern 2). |
| Price/quote tampering from request body | Tampering | Server re-reads `unit_prices`/`cac_index` by ID; never trust body amounts. |
| Anonymous quote/snapshot spam | Denial of Service | nginx `limit_req` (429); `compute` ephemeral, only `create` persists. |
| PII in audit blob | Information Disclosure | Snapshot is finance-only; contact lives in `leads` via `quotes.leadId` (D-04). |
| Cryptic 500 leaking stack/internals | Information Disclosure | Guarded `PRECONDITION_FAILED`/`BAD_REQUEST`; errorFormatter surfaces only `quoteErrorCode` (D-08). |
| Owner/superuser pool on public path | Elevation of Privilege | Router imports only `withTenant`/`withAnon`; grep-fenced (T-03-09). |

## Sources

### Primary (HIGH confidence — direct codebase read)
- `packages/db/src/with-tenant.ts` — `withTenant`/`withAnon` GUC-scoped transaction helpers.
- `packages/db/src/schema/{quotes,cac-index,payment-plans,unit-prices,price-lists,json-schemas}.ts` — tenant-private posture, `quoteInsertSchema`, `quoteSnapshotSchema`.
- `packages/api/src/trpc/{init,context}.ts`, `routers/{projects,media,_app}.ts`, `src/index.ts` — procedure split, `createCaller`, withAnon/withTenant router patterns, errorFormatter absence.
- `packages/quoting/src/{index,engine,types,errors}.ts` — `calcQuote`, `QuoteError` (7 codes), `ENGINE_VERSION`, `QuoteInput`/`QuoteResult`, serializers.
- `packages/storage/src/{queue,keys,index}.ts` — shared-contract-no-bullmq pattern to mirror.
- `apps/panel/app/api/trpc/[trpc]/route.ts`, `apps/web/env.ts`, `packages/db/src/{client,env}.ts`, `packages/config/env/presets.ts` — mount template + env wiring for A1.
- `deploy/nginx/staging.tours.andescode.com.ar.conf`, `deploy/compose.staging.yml` — vhost `limit_req` skeleton + web `env_file` confirming `DATABASE_APP_URL` presence.
- `packages/api/{vitest.config.ts,tests/trpc-tenant.test.ts,tests/media-router.test.ts}`, `packages/db/src/seed/{pricing,ids}.ts` — test framework + integration/seed pattern.
- `.planning/research/{ARCHITECTURE,PITFALLS}.md` — milestone HIGH-confidence research (consolidated, not re-derived).

### Secondary (MEDIUM/HIGH — official docs)
- nginx `limit_req` / `limit_req_status` — default reject status is 503; set 429 for APIs. [CITED]
- tRPC v11 `errorFormatter` — shape for surfacing custom codes in `data`. [CITED: trpc.io/docs]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps present + version-verified from package.json.
- Architecture: HIGH — every seam read directly; patterns are clones of existing verified routers.
- Pitfalls: HIGH — grounded in committed schema + milestone research; nginx-429 gap caught and cited.

**Research date:** 2026-07-03
**Valid until:** 2026-08-02 (stable — internal seams; revisit if `@imbau/quoting` bumps `ENGINE_VERSION` or the auth/RLS contract changes)

Sources:
- [nginx trac #309 — HTTP 429 for rate limiting](https://trac.nginx.org/nginx/ticket/309)
- [NGINX Community Blog — Rate Limiting with NGINX](https://blog.nginx.org/blog/rate-limiting-nginx)
