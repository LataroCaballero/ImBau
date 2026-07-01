# Architecture Research

**Domain:** Quoting engine + public-web quote flow + async PDF + WhatsApp handoff, integrated into an existing pnpm/Turborepo multi-tenant SaaS (ImBau v1.2 Cotizador)
**Researched:** 2026-07-01
**Confidence:** HIGH (grounded in the actual codebase — schema, RLS policies, tRPC context, media pipeline — not on generic patterns)

## Executive Finding (read this first)

The single load-bearing architectural decision of this milestone is **where the CAC read and the quote write happen**, because of an RLS fact already baked into the schema:

- `quotes` is **tenant-private**: only a `quotes_tenant` policy for `app_authenticated`, **no anon policy, no anon GRANT** → an anon SELECT/INSERT raises `42501` (documented in `quotes.ts:1-9`).
- `cac_index` is **tenant-private** for the same reason (`cac-index.ts:1-8`): CAC is org-private business data, never exposed to the public web.
- `payment_plans`, `unit_prices`, `brokers` **do** have `*_anon_published` SELECT policies → the public web already reads them via `withAnon`.

Consequence: a public/anonymous buyer **cannot** read the CAC index nor persist a quote through the anon pool. The CAC value is required to display the ARS installment ("cuota inicial en pesos al valor del mes"). Therefore **quote emission must run server-side through the app pool (`withTenant`), not the anon pool** — regardless of the fact that the buyer is anonymous.

This collides with the PROJECT.md assumption "no schema changes anticipated." It is resolvable **without** a schema change (recommended), but the roadmapper must pick a lane explicitly. See **Integration Points → The tenant-private crux**.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     apps/web  (public, anon-only today)               │
│  ┌────────────────────┐        ┌──────────────────────────────────┐  │
│  │ Unit page (RSC/ISR) │───────▶│ Cotizador UI (client component)  │  │
│  │ reads via withAnon: │        │ plan selector · anticipo · cuotas│  │
│  │  unit_price, plan,  │        │ renders QuoteResult · WhatsApp   │  │
│  │  broker (whatsapp)  │        └───────────────┬──────────────────┘  │
│  └────────────────────┘                        │ quotes.compute /     │
│                                                 │ quotes.create        │
├─────────────────────────────────────────────────┼─────────────────────┤
│                    packages/api  (tRPC v11)      ▼                     │
│  quotesRouter (NEW):                                                   │
│   compute  (publicProcedure)  ── run engine, return QuoteResult (no DB write)
│   create   (publicProcedure)  ── resolve+revalidate org, run engine,   │
│                                  persist snapshot via withTenant,      │
│                                  enqueue PDF job                       │
│                          │                    │                       │
│              ┌───────────▼─────────┐   ┌───────▼───────────┐          │
│              │ packages/quoting    │   │ withTenant(org)   │          │
│              │ PURE engine (NEW):  │   │ app_authenticated │          │
│              │ calcQuote()         │   │ INSERT quotes     │          │
│              │ toWhatsAppText()    │   │ (snapshot+version)│          │
│              │ toPdfModel()        │   └───────┬───────────┘          │
│              │ ENGINE_VERSION      │           │ enqueue              │
│              └─────────────────────┘           ▼                       │
├────────────────────────────────────────────────┼─────────────────────┤
│                        Redis / BullMQ           │ QUOTE_PDF_QUEUE      │
├────────────────────────────────────────────────┼─────────────────────┤
│                     apps/worker                 ▼                     │
│   processQuotePdf (NEW): read quote via withTenant → render PDF        │
│   (react-pdf) → PUT R2 (quotePdfKey) → withTenant UPDATE quotes.pdfKey │
│   failure → Sentry + pino (reportQuotePdfFailure)                     │
├──────────────────────────────────────────────────────────────────────┤
│   PostgreSQL 16 (RLS)          Cloudflare R2          Redis            │
│   quotes / cac_index tenant-priv   quotes/{…}.pdf     BullMQ jobs      │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `packages/quoting` (NEW, fills empty placeholder) | Pure, deterministic calc: base USD → anticipo → cuotas (CAC/fijo) → refuerzos → totals. Serializers to WhatsApp text and PDF model. Engine version. **No I/O.** | Pure TS functions + exhaustive types; Vitest unit + property-based; 100% coverage gate |
| `quotesRouter` (NEW in `packages/api`) | Boundary: validate inputs (Zod), run engine, resolve/revalidate the published-project org, persist snapshot via `withTenant`, enqueue PDF | tRPC v11 `publicProcedure`s (buyer is anonymous), reuse `withTenant`/`withAnon` |
| Cotizador UI (NEW in `apps/web`) | Mobile-first plan configurator; render `QuoteResult`; WhatsApp CTA; optional lead capture | Client component under the unit route; calls `quotes.*` |
| `processQuotePdf` (NEW in `apps/worker`) | Render the persisted snapshot to PDF (legal legend "cotización no vinculante"), store in R2, write back `pdfKey` | Mirrors `processMedia`; react-pdf; `withTenant` UPDATE |
| `packages/storage` (MODIFIED) | Add `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfKey()`, `quotePdfJobOptions()` | Same "shared contract, no bullmq import" pattern as `queue.ts` |
| `quotes` table (UNCHANGED) | Stores `snapshot` (versioned envelope), `pdfKey` (nullable), `leadId` (nullable) — all columns already exist | Drizzle schema from v1.1; no migration |

## Recommended Project Structure

```
packages/quoting/src/
├── index.ts             # barrel: calcQuote, types, ENGINE_VERSION, serializers
├── types.ts             # QuoteInput, QuoteResult, CuotaLine, RefuerzoLine (typed, integer money)
├── engine.ts            # calcQuote(input): pure calc, embeds { version: ENGINE_VERSION }
├── serialize.ts         # toWhatsAppText(result), toPdfModel(result) — pure
├── money.ts             # integer-USD + decimal-ARS helpers, explicit rounding
├── version.ts           # ENGINE_VERSION = 1  (== snapshot envelope version)
├── engine.test.ts       # unit tables (contado / CAC / refuerzos / edge cases)
└── engine.property.test.ts  # fast-check invariants (sum(cuotas)+anticipo == saldo, monotonicity…)

packages/api/src/trpc/routers/
└── quotes.ts            # NEW quotesRouter (compute + create); registered in _app.ts

packages/storage/src/
├── quote-pdf.ts         # NEW: QUOTE_PDF_QUEUE, QuotePdfJobData, quotePdfJobOptions
└── keys.ts              # MODIFIED: add quotePdfKey(orgId, projectId, quoteId)

apps/worker/src/
├── quote-pdf.ts         # NEW: processQuotePdf + reportQuotePdfFailure
├── quote-pdf-render.tsx # NEW: react-pdf document from toPdfModel() output
└── index.ts             # MODIFIED boot(): QUOTE_PDF_QUEUE + worker + failed handler

apps/web/app/
└── [projectSlug]/[unitId]/   # NEW unit route: RSC reads (withAnon) + cotizador client UI
    ├── page.tsx              # server: read unit_price, payment_plans, broker via anon caller
    └── cotizador.tsx         # client: configurator, calls quotes.*, WhatsApp CTA
```

### Structure Rationale

- **`packages/quoting` has zero dependencies on `db`/`api`/`storage`.** Its input/output types are plain (mirror the DB shapes but are not Drizzle rows). This keeps it pure, trivially 100%-coverable, and re-runnable for audit. Everything else depends on *its output type* — hence it is built first.
- **Serializers live inside `quoting`** (`toWhatsAppText`, `toPdfModel`) so on-screen, PDF, and WhatsApp text all derive from the **same** `QuoteResult` — guaranteeing they never drift.
- **PDF rendering (react-pdf) lives in the worker**, not in `quoting`: rendering is I/O-adjacent and server-only. `quoting` produces a pure `PdfModel` (data); the worker owns the JSX/render. This preserves the engine's purity.

## Architectural Patterns

### Pattern 1: Pure engine, versioned snapshot, server-authoritative compute

**What:** `calcQuote(input): QuoteResult` is pure. Every result embeds `{ version: ENGINE_VERSION }`. The persisted `snapshot` stores **inputs + outputs + version** (`{ version: 1, inputs: {...}, result: {...} }`) so any emitted quote can be re-verified/re-rendered exactly as issued even after prices or CAC change — full auditability (modelo §3.4).

**When to use:** Always. The engine never reads a clock, DB, or env; the caller passes the CAC vigente and prices in.

**Trade-offs:** Snapshot is larger (stores inputs too) — worth it for probative value ("cotización no vinculante" but archivable). Version bump is the ONLY way the interior shape changes; the DB envelope (`quoteSnapshotSchema = z.object({version: z.literal(1)}).passthrough()`) stays fixed, so evolving the calc needs **no migration** — just a new `ENGINE_VERSION` and a widened `z.literal(1)` → `z.union([...])`.

**Example:**
```typescript
// packages/quoting/src/engine.ts
export function calcQuote(input: QuoteInput): QuoteResult {
  const anticipoUsd = roundUsd(input.precioUsd * input.anticipoPct / 100);
  const saldoUsd = input.precioUsd - anticipoUsd;
  // ... cuotas (CAC vs fijo), refuerzos, totals — all integer USD / decimal ARS
  return { version: ENGINE_VERSION, precioUsd: input.precioUsd, anticipoUsd, cuotas, refuerzos, totals };
}
```

### Pattern 2: Read-anon, compute+persist-app (the media pipeline, re-applied)

**What:** Mirror the proven `createUpload`/`confirmUpload` → BullMQ → `processMedia` → `withTenant` UPDATE flow. Quote emission = insert `quotes` via `withTenant` → enqueue → worker renders PDF → `withTenant` UPDATE `pdfKey`. The job payload carries `organizationId` (the worker has no session), exactly like `MediaJobData`.

**When to use:** The persist + PDF path. Reuse `mediaJobOptions`' shape: `jobId = quoteId` (dedup/idempotent), `attempts: 5`, exponential backoff; `failed` handler → Sentry + pino.

**Trade-offs:** Requires the **app pool** in whatever process runs `quotes.create` (see the crux below). That is the price of keeping `quotes`/`cac_index` invisible to raw anon SQL.

**Example:**
```typescript
// packages/storage/src/quote-pdf.ts  (no bullmq import — shared contract, like queue.ts)
export const QUOTE_PDF_QUEUE = "quote-pdf";
export interface QuotePdfJobData { quoteId: string; organizationId: string; projectId: string; }
export function quotePdfJobOptions(quoteId: string) {
  return { jobId: quoteId, attempts: 5, backoff: { type: "exponential", delay: 2000 } } as const;
}
```

### Pattern 3: WhatsApp CTA as a pure link from the engine output

**What:** `toWhatsAppText(result)` returns the message body; the CTA is `https://wa.me/<brokerPhone>?text=<encodeURIComponent(text)>`. Broker phone comes from `brokers.whatsapp`, which is **anon-readable** (`brokers_anon_published` SELECT confirmed) — read in the RSC via `withAnon`, no privileged path needed.

**When to use:** Immediately on the unit page, from the in-memory `QuoteResult`. Do **not** wait for the PDF (it may not be rendered yet). Optionally append the public quote-page URL.

**Trade-offs:** wa.me text length is bounded — keep the message a concise summary (unit id, precio, anticipo, N cuotas, first cuota ARS + CAC legend), not the full schedule. The full detail lives in the PDF and on-screen.

## Data Flow

### Quote generation (anonymous buyer) — recommended flow

```
Buyer on /[projectSlug]/[unitId]  (published project, RSC via withAnon reads
   unit_price + payment_plans + broker.whatsapp)
        │  configures plan (anticipo %, cuotas, refuerzos)
        ▼
quotes.compute  (publicProcedure)  ── engine runs SERVER-SIDE ──────────┐
        │  needs CAC vigente → read via withTenant(orgResolved) [app]    │  (crux)
        ▼                                                                │
QuoteResult returned → rendered on screen + WhatsApp CTA built ──────────┘
        │  buyer clicks "Consultar por WhatsApp" / leaves contact
        ▼
quotes.create  (publicProcedure, rate-limited)
   1. withAnon: SELECT project WHERE id=? AND estado='publicado'  → orgId  (revalidate!)
   2. withTenant(orgId): read unit_price + plan + cac_index vigente
   3. calcQuote(...) → snapshot {version, inputs, result}
   4. withTenant(orgId): INSERT quotes (snapshot), optional leads (anon path or app)
   5. enqueue QUOTE_PDF_QUEUE { quoteId, organizationId, projectId }
        ▼
on-screen result + WhatsApp fire IMMEDIATELY (no PDF wait)
        ▼ (async, background)
worker processQuotePdf → render → R2 → withTenant UPDATE quotes.pdf_key
        ▼
PDF download link appears (poll quote.pdfKey, or included in broker email)
```

### Sync vs async for the PDF — recommendation: ASYNC

The product goal is "portada → cotización por WhatsApp en <2 min" and "<3s en 4G." react-pdf rendering is heavy and must not block the buyer.

- **On-screen result + WhatsApp CTA: synchronous** (from the in-memory `QuoteResult` — zero extra latency).
- **PDF: asynchronous** via BullMQ, exactly like media variants. The download button either (a) polls `quotes.pdfKey` until non-null (simple, MVP-appropriate), or (b) the PDF link is delivered in the broker/lead notification email once ready. **Do not** reuse SSE/LISTEN-NOTIFY for this in the MVP — polling a single quote is simpler and cheaper.

### State ownership

```
QuoteResult (ephemeral)  ──lives in the client while configuring──▶ display + WhatsApp
       │ (on emit)
       ▼
quotes.snapshot (durable, versioned)  ──▶ authoritative record ──▶ PDF render source
```

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 0–1k quotes/day | Current single-worker BullMQ is ample. `compute` is pure/fast; `create` is one short `withTenant` tx + one enqueue. |
| 1k–100k | Add PDF worker concurrency (like media `concurrency: 2`); ensure `quotes` has an index on `(organization_id, project_id)`; cache CAC-vigente read per (org, período) request-scoped. |
| 100k+ | Separate the PDF worker from the media worker (own queue already isolates them); consider ISR/edge-cache for the unit page shell; move CAC lookups behind a small read cache. |

### Scaling priorities

1. **First bottleneck: PDF rendering throughput** — react-pdf is CPU-heavy. Async queue already absorbs bursts; raise concurrency before anything else.
2. **Second: the app-pool connection count on the public path** — if `quotes.create` runs in `apps/web`, watch pool sizing; the anonymous surface can be spiked. Rate-limit at the edge (below).

## Anti-Patterns

### Anti-Pattern 1: Running the engine (and CAC read) client-side

**What people do:** Compute the quote in the browser and send the result up to be stored.
**Why it's wrong:** The calc is the product's differentiator and the snapshot is probative — a client-computed value can be tampered, and CAC is org-private (must not ship to the browser as raw data). It also breaks "on-screen == PDF == persisted."
**Do this instead:** Compute server-side (`quotes.compute`/`create`); the browser only renders the returned `QuoteResult`.

### Anti-Pattern 2: Giving the anon role read/write on `cac_index`/`quotes` to "keep it simple"

**What people do:** Add `*_anon_published` policies to `cac_index` and an anon INSERT to `quotes` (mirroring `leads`) so the web can use `withAnon` end-to-end.
**Why it's wrong:** It exposes org-private CAC values and lets anon enumerate quote rows — weaker isolation, and it *is* the schema change PROJECT.md wanted to avoid.
**Do this instead:** Keep both tenant-private; concentrate the privileged read/write in one audited `publicProcedure` that re-derives the org from the published project (app-pool elevation). (This is a genuine fork — see the crux; if the team decides CAC exposure is acceptable, the anon-policy route is the alternative.)

### Anti-Pattern 3: Blocking the WhatsApp/on-screen result on PDF generation

**What people do:** `await` PDF render inside `quotes.create` before returning.
**Why it's wrong:** Kills the <2 min / <3s goals; couples a fast path to a slow one; a react-pdf failure would fail the whole quote.
**Do this instead:** Return the result immediately; enqueue the PDF; surface it when ready.

### Anti-Pattern 4: Trusting a client-supplied `organizationId` or price on the public path

**What people do:** Let the browser pass org/price into `quotes.create`.
**Why it's wrong:** Cross-tenant write / price tampering. The whole codebase's rule (T-03-05) is "org is server-derived only."
**Do this instead:** Resolve org from the `(projectSlug/unitId)` via a `withAnon` published-only read, re-validate `estado='publicado'`, then `withTenant(org)`. Read the price from the DB, never from input.

## Integration Points

### The tenant-private crux (the decision the roadmapper must make)

| Option | How | Schema change? | Isolation | Recommendation |
|--------|-----|----------------|-----------|----------------|
| **A — App-pool elevation (recommended)** | One `publicProcedure` resolves+revalidates the published-project org, then reads CAC / writes quote via `withTenant`. The public-serving process holds the app pool. | **None** | Strong — CAC/quotes stay invisible to raw anon SQL | **Choose this.** Concentrates privilege in one audited, rate-limited function; no migration. |
| B — Add anon policies | `cac_index` anon-published SELECT + `quotes` anon INSERT (like `leads`); engine runs in RSC via `withAnon`. | **Yes** (2 policies + grants) | Weaker — anon can read CAC, enumerate quotes | Only if the team explicitly accepts exposing CAC to the public role. |

**Option A sub-decision — where the app pool lives:**
- **A1 (leaning recommended):** `apps/web` gains `DATABASE_APP_URL` used *only* by the `quotes.create/compute` path. This widens the D-03 "web is anon-only" isolation deliberately — it must be documented as a Key Decision, the app-pool usage grep-fenced to the quotes router, and the endpoint edge-rate-limited.
- **A2:** Relocate quote emission to a surface that already holds the app pool (a dedicated public API route / the panel's server runtime), keeping `apps/web` strictly anon. Cleaner isolation, one more moving part.

Flag both to the user; do not silently widen D-03.

### Rate limiting (anon-triggered write)

`quotes.create` is an anonymous write, same class as `events`/`leads` (modelo §3.3 requires an edge rate-limit). **Note the staging reality:** the proxy is **nginx-host + certbot, not Traefik** (Decision D-01). So the rate limit is `nginx limit_req` (or an app-layer limiter) — the Traefik middleware from CLAUDE.md is not available on the shared staging box. Roadmapper should not plan a Traefik middleware here.

### External services

| Service | Integration | Notes |
|---------|-------------|-------|
| Cloudflare R2 | Reuse `makeR2Client` + a new `quotePdfKey()`; deterministic key `quotes/{orgId}/{projectId}/{quoteId}.pdf` → retry overwrites in place (idempotent, like `variantKey`) | Reuse `@imbau/storage` transport; add key + queue contract only |
| Redis / BullMQ | New `QUOTE_PDF_QUEUE`; producer = `@imbau/api`, consumer = `apps/worker`; contract in `@imbau/storage` (no bullmq import) | Same producer/consumer split as `MEDIA_QUEUE` |
| Sentry + pino | `reportQuotePdfFailure` on the worker `failed` handler; errors never swallowed | Mirror `reportMediaFailure` |
| WhatsApp (wa.me) | Pure link from `brokers.whatsapp` (anon-readable) + `toWhatsAppText()` | No API, just a URL |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `quoting` ↔ everything | Types only (import `QuoteInput`/`QuoteResult`); pure functions | `quoting` imports nothing from `db`/`api`/`storage` — keep it acyclic and pure |
| `api` ↔ `db` | `withTenant`/`withAnon` only (never `appDb`/owner pool) | Same rule the media/projects routers already follow (T-03-09) |
| `api` ↔ `worker` | Via `@imbau/storage` queue contract (`QuotePdfJobData`) | Payload carries `organizationId` (worker has no session) |
| `worker` ↔ `db` | `withTenant(payload.organizationId)` for read + `pdfKey` UPDATE | Exactly the `processMedia` write-back pattern |

## Suggested Build Order (dependency-driven)

1. **`packages/quoting` — engine first, 100% coverage + property tests.** Densest pure logic; defines the `QuoteResult` type every other surface consumes. Includes `toWhatsAppText`/`toPdfModel` and `ENGINE_VERSION`. No integration. *(This is the milestone's quality centerpiece — CI coverage gate.)*
2. **API + persistence — `quotesRouter` (`compute` + `create`).** Resolve the tenant-private crux (Option A). Wire `withAnon` org-resolution, `withTenant` CAC read + snapshot insert, register in `_app.ts`. Add the `@imbau/storage` PDF queue/key contract here (producer side).
3. **Web UI — unit route + cotizador.** RSC anon reads (unit_price, plans, broker) + client configurator calling `quotes.*`; render `QuoteResult`; **WhatsApp CTA lands here** (it's a pure link, cheap). Add a tRPC client to `apps/web` (currently none) or use server actions.
4. **PDF worker — async render.** `processQuotePdf` + react-pdf document + R2 store + `pdfKey` write-back + `failed`→Sentry; register queue/worker in `boot()`; wire the download/poll on the UI. Last because it's async and non-blocking to the core UX.

Rationale: each step depends only on prior ones; the engine's output type is the contract; WhatsApp (cheap) ships with UI; PDF (heavy, async) is isolated last so a PDF slip never blocks the demo-critical on-screen + WhatsApp path.

## New vs Modified — explicit

**New:**
- `packages/quoting/src/*` — engine, types, serializers, version, unit + property tests (fills the empty placeholder).
- `packages/api/src/trpc/routers/quotes.ts` — `quotesRouter` (`compute`, `create`).
- `packages/storage/src/quote-pdf.ts` — `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`.
- `apps/worker/src/quote-pdf.ts` + `quote-pdf-render.tsx` — `processQuotePdf`, react-pdf document, `reportQuotePdfFailure`.
- `apps/web/app/[projectSlug]/[unitId]/*` — unit route + cotizador client UI + WhatsApp CTA (+ possibly a web tRPC client).

**Modified:**
- `packages/api/src/trpc/routers/_app.ts` — register `quotes`.
- `packages/storage/src/index.ts` — export the new contract; `keys.ts` — add `quotePdfKey()`.
- `apps/worker/src/index.ts` `boot()` — declare `QUOTE_PDF_QUEUE`, stand up the worker, wire `failed`.
- `apps/web/env.ts` — **only under Option A1**: add `DATABASE_APP_URL` (documented D-03 widening).
- nginx staging vhost — add `limit_req` for the quote-create endpoint (no Traefik).

**Unchanged (no migration):**
- `quotes` table — `snapshot`, `pdfKey`, `leadId` already exist; envelope `{version:1}.passthrough()` accommodates the engine interior.
- `payment_plans`, `unit_prices`, `cac_index`, `brokers` — schema/policies as shipped in v1.1.

## Money & determinism notes (for the engine planner)

- USD amounts are **integers** (`unit_prices.precio integer`, `Refuerzo.montoUsd int`, `anticipoPct numeric`) — never float (CLAUDE.md D-14). ARS installments derive from CAC (`cac_index.valor numeric(12,4)`).
- Recommend integer-USD arithmetic + a **decimal** discipline for ARS (integer minor units or `decimal.js`), with **explicit, tested rounding rules** — rounding is the classic quoting pitfall and a property-test target (e.g. `sum(cuotas) + anticipo + sum(refuerzos) == precio` in USD).
- Keep `quoting` dependency-light; if a decimal lib is added, it's the only runtime dep and must be pinned.

## Sources

- Codebase (HIGH — direct read): `packages/db/src/schema/{quotes,payment-plans,cac-index,unit-prices,leads,brokers,json-schemas}.ts`; `packages/db/src/with-tenant.ts`; `packages/api/src/trpc/{init,context,middleware}.ts`, `routers/{projects,media,_app}.ts`, `media/register.ts`; `packages/storage/src/{queue,keys,index}.ts`; `apps/worker/src/index.ts`; `apps/web/app/page.tsx`, `env.ts`.
- `docs/modelo-mvp.md` §3.3 (schema + anon-insert-with-rate-limit), §3.4 (cotizador engine spec), §3.5 (deploy). HIGH.
- `.planning/PROJECT.md` — v1.2 milestone goal, D-01 (nginx not Traefik), D-03 (web anon-only), money conventions. HIGH.

---
*Architecture research for: ImBau v1.2 Cotizador — quoting engine integration*
*Researched: 2026-07-01*
