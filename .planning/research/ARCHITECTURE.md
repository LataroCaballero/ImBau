# Architecture Research

**Domain:** Panel de autogestión (developer self-service) sobre monorepo Next.js/tRPC/Drizzle-RLS existente — milestone v1.3
**Researched:** 2026-07-17
**Confidence:** HIGH (verified against the actual schema, routers, worker and panel code in-repo)

## Scope

This is **integration research for a subsequent milestone**, not greenfield domain research. The stack, tenancy model and worker are decided and shipped (v1.0–v1.2). The question is precisely *how the three new panel surfaces (D1 grilla + Excel, D2 leads + email, editor de hotspots) attach to the existing seams* without violating RLS, the money rules, or the "errores observables" mandate — and in what order to build them.

**Headline findings (each expanded below):**

1. **Excel runs inline in a tRPC mutation on the app pool — no worker, no R2, no multipart.** The dataset is ~tens to low-hundreds of rows (Brigos = 38 units). BullMQ/R2 is reserved for CPU-heavy async work (sharp, PDF); Excel of a building is a KB-scale payload.
2. **The hotspot data model already exists.** `floors.poligonoSvg` and `units.poligonoSvg` are live TEXT columns with tenant + anon-published RLS policies. **No new table, no migration for the model.** Hotspots = a panel editor UI + write mutations + the *reuse* of the existing anon read policies for the future explorador.
3. **Lead state transitions append to `leads.timeline` (JSONB) and email should be a queued BullMQ job**, mirroring the "email/PDF is never the critical path" precedent (D-02/D-10). Inline Resend (the invitation precedent) is the simpler fallback.
4. **Price propagation: leave nothing running this milestone.** Do **not** emit `pg_notify` with no consumer. The single load-bearing move is to funnel every `unit_prices` write through one server path so Fase-5's SSE `NOTIFY` is a one-line insertion later.
5. **One real schema change is likely needed:** a tenant-scoped `UNIQUE(unit_id, price_list_id)` on `unit_prices` to make the grid/Excel upsert idempotent AND to keep the existing quote resolver (which assumes one contado + one financiado USD row per unit) correct.

## Standard Architecture

### System Overview — where each new feature attaches

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/panel  (Next.js App Router, Better Auth session + activeOrgId)   │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────────┐   │
│  │ Grilla    │  │ Bandeja   │  │ Editor     │  │ (existing)         │   │
│  │ unidades  │  │ leads     │  │ hotspots   │  │ dashboard + invite │   │
│  │ + Excel   │  │ + email   │  │ (SVG draw) │  │                    │   │
│  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  └──────────┬─────────┘   │
│  RSC read via createCaller · writes via useTRPC() client islands       │
└────────┼──────────────┼──────────────┼───────────────────┼────────────┘
         │ tRPC (type-safe, no codegen) — httpBatchLink → /api/trpc       │
┌────────┴──────────────┴──────────────┴───────────────────┴────────────┐
│  packages/api  (tRPC v11)   protectedProcedure → requireRole(...)      │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │ units router   │ │ leads router │ │ floors/units │  ← NEW routers   │
│  │ (grid/prices/  │ │ (list/estado │ │  hotspot     │                  │
│  │  Excel import) │ │  /notify)    │ │  mutations)  │                  │
│  └───────┬────────┘ └──────┬───────┘ └──────┬───────┘                  │
│          │  ALL writes go through withTenant(ctx.activeOrgId, …)       │
└──────────┼─────────────────┼────────────────┼─────────────────────────┘
           │                 │ enqueue email   │
┌──────────┴─────────────────┼────────────────┴─────────────────────────┐
│  packages/db  (Drizzle + RLS FORCE)   app pool (app_authenticated)     │
│  units · unit_prices · price_lists · leads(timeline) · floors          │
│  units.poligonoSvg / floors.poligonoSvg  ← ALREADY EXIST               │
└──────────┼─────────────────┼──────────────────────────────────────────┘
           │                 ↓ (recommended) EMAIL_QUEUE
┌──────────┼───────────┐  ┌──┴───────────────────────────────────────────┐
│  PostgreSQL 16 (RLS) │  │ apps/worker (BullMQ)  media · quote-pdf · …   │
│                      │  │  + NEW email consumer → Resend (React Email)  │
└──────────────────────┘  └───────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility (new work) | Reuses / mirrors |
|-----------|---------------------------|------------------|
| Panel RSC pages | Read grid/leads/floors via `createCaller` → `withTenant` → RLS | `app/(dashboard)/page.tsx` pattern (listForOrg) |
| Panel client islands | Interactive edits/import/draw via `useTRPC()` mutations | `invite-form.tsx` + `TRPCReactProvider` |
| `units` router (NEW) | `list`, `updateEstado`, `upsertPrice`, `importExcel` — all `requireRole("owner","developer")` | `media.ts` (mutation + withTenant + RLS scoping) |
| `leads` router (NEW) | `listForOrg`, `updateEstado` (append timeline + enqueue email) | `projects.listForOrg`, `quotes.create` enqueue side-effect |
| hotspots mutations (NEW) | `floors.setPolygon`, `units.setPolygon` writing `poligonoSvg` | flat `withTenant` write, RLS `*_tenant` policy |
| Worker email consumer (NEW, recommended) | Send lead notifications via Resend, retried + observable | `quote-pdf` worker (concurrency, `failed` handler, jobOptions dedup) |

## Recommended Project Structure

```
packages/api/src/trpc/routers/
├── units.ts        # NEW — grid read + estado/price writes + Excel import (inline parse)
├── leads.ts        # NEW — listForOrg + updateEstado (timeline append + email enqueue)
├── hotspots.ts     # NEW — floors.setPolygon / units.setPolygon (or fold into units/floors)
├── _app.ts         # MODIFIED — mount units, leads, hotspots
packages/api/src/
├── excel/          # NEW — parse+build helpers (pure; SheetJS/exceljs), Zod row schema
├── email/
│   ├── lead-notification.ts   # NEW — payload builder + Resend send (or enqueue verb)
│   └── templates/lead-*.tsx   # NEW — React Email template(s)
packages/storage/src/queue.ts  # MODIFIED — add EMAIL_QUEUE + EmailJobData + emailJobOptions
apps/worker/src/
├── email.ts        # NEW — processEmail consumer + reportEmailFailure
├── index.ts        # MODIFIED — createEmailWorker + failed handler in boot()
apps/panel/app/(dashboard)/
├── proyectos/[id]/unidades/   # NEW — grilla + import/export
├── proyectos/[id]/leads/      # NEW — bandeja
├── proyectos/[id]/hotspots/   # NEW — editor
└── proyectos/[id]/layout.tsx  # NEW — project-scoped shell + tab nav
packages/db/drizzle/           # NEW migration — UNIQUE(unit_id, price_list_id) on unit_prices
```

### Structure Rationale

- **New routers, not fatter existing ones:** each surface gets its own router file mounted in `_app.ts`, exactly as `quotes`/`picker`/`media` are. Keeps the grep-fence ("import ONLY `withTenant/withAnon/schema`") auditable per file.
- **`packages/api/src/excel/` is pure:** parse/build are I/O-free and unit-testable, matching the "funciones puras" bias of `packages/quoting`. The mutation is the only I/O boundary.
- **Panel gains a project-scoped route group** (`proyectos/[id]/…`): today the panel is a single dashboard. Units, leads and hotspots are all *project*-scoped, so a shared `[id]` layout carrying "which project am I editing" is a prerequisite for all three (see Build Order, wave 1).

## Architectural Patterns

### Pattern 1: Excel import/export inline in a tRPC mutation (no worker, no R2)

**What:** Import = client reads the `.xlsx` with SheetJS → sends a normalized rows array to `units.importExcel` → Zod-validate → one `withTenant` transaction that upserts prices/estado and returns a per-row result report. Export = `units.exportGrid` returns the grid JSON; the browser builds the `.xlsx`. Server-side parse of an uploaded base64 file is an equivalent variant — the load-bearing rule is *validation + write happen server-side under `withTenant`*, regardless of where bytes are parsed.

**When to use:** Small, bounded datasets (a building is ~38–hundreds of units). Response is synchronous — the user sees "12 filas actualizadas, 2 con error" immediately.

**Trade-offs:** Inline blocks the request for the parse+write, but at these row counts that is milliseconds. **Do not** route this through BullMQ/R2 — that pattern exists for CPU-heavy async work (sharp variants, react-pdf) where the user must not wait; Excel here is neither heavy nor async. Cap the row count (e.g. ≤2000) and the payload at the tRPC boundary as a DoS guard, mirroring `media.ts`'s `MAX_UPLOAD_BYTES`.

**Example:**
```typescript
// units.importExcel — protectedProcedure + requireRole("owner","developer")
.input(z.object({ projectId: z.uuid(), rows: z.array(unitPriceRowSchema).max(2000) }))
.mutation(({ ctx, input }) =>
  withTenant(ctx.activeOrgId, async (tx) => {
    // RLS scopes every read/write to activeOrg; a foreign unitId is invisible → reported, not written.
    // upsert unit_prices (needs UNIQUE(unit_id, price_list_id)); update units.estado.
    // return { updated, skipped: [{ row, reason }] } — never throw on one bad row.
  }))
```

### Pattern 2: Hotspot polygons as data on existing columns (zero-migration model)

**What:** Each floor already owns `floors.poligonoSvg` (its shape on the building/exterior render) and each unit owns `units.poligonoSvg` (its shape on the floor-plan render). The editor loads a background render, lets the operator draw a polygon, and persists the point list as TEXT via `floors.setPolygon` / `units.setPolygon` under `withTenant`. The future explorador reads the same columns through the **already-shipped** `floors_anon_published` / `units_anon_published` SELECT policies.

**When to use:** This is the intended model — the columns and both policies exist. No new `hotspots` table is warranted; the navigation graph is exactly building→floor polygon→unit polygon.

**Trade-offs:** One polygon per level per row (sufficient for this navigation). If richer per-hotspot metadata is ever needed, a table comes later — not now. **XSS posture:** store polygon *coordinates* (validate a points/JSON string with Zod), and render them through React `<polygon points=…>` — never `dangerouslySetInnerHTML` a stored SVG document. This is consistent with `media.ts` deliberately rejecting `image/svg+xml` uploads.

**Open confirmation (LOW-risk):** the *building-level* background render (the image the floor polygons sit on) — `floors.renderKey` is the floor-plan render; confirm where the exterior/building render lives (a `projects` field or a designated `media` row) before wiring the floor editor's canvas. Unit polygons clearly sit on `floors.renderKey`.

### Pattern 3: Lead state transition = timeline append + queued email (email off the critical path)

**What:** `leads.updateEstado` runs under `withTenant`, sets `leads.estado` and appends a typed `LeadNote` to `leads.timeline` (validated by the existing `leadNoteSchema`), then enqueues an `EMAIL_QUEUE` job. The transition commits regardless of email outcome; the worker sends via Resend with attempts/backoff and a `failed` → Sentry+pino handler.

**When to use:** Any developer-facing action whose latency matters and whose email is non-critical. This mirrors the shipped decision that the PDF/WhatsApp path never blocks on the side effect (D-02/D-10).

**Trade-offs:** A queued email adds a queue + worker consumer (~1 file + `queue.ts` contract + boot wiring — all cloned from `quote-pdf`). The simpler alternative is **inline Resend in the mutation**, exactly as `send-invitation.ts` does today (awaited, throws on failure). Inline is acceptable for v1 low volume but couples transition latency and success to email delivery. Recommendation: **queue it** to match the async precedent and the observability mandate; fall back to inline only if the queue wiring is deemed out of budget.

**Events table note:** `events` (partitioned analytics) is a *Fase-6 metrics* concern. This milestone's source of truth for a lead's history is `leads.timeline`. Emitting an `events` row per transition is optional and cheap, but building the metrics consumer is explicitly out of scope — do not couple D2 to it.

## Data Flow

### D1 — grid edit / Excel import
```
Operator edits cell / drops .xlsx
    ↓ (client island; SheetJS parses xlsx → rows[])
useTRPC().units.updateEstado | upsertPrice | importExcel  (POST /api/trpc)
    ↓ protectedProcedure → requireRole("owner","developer")
withTenant(ctx.activeOrgId) → RLS units_tenant / unit_prices_tenant
    ↓ upsert unit_prices (UNIQUE unit_id+price_list_id) · update units.estado
Postgres commits → per-row report returned → grid refetch
```

### D2 — lead transition + notification
```
Operator moves lead nuevo→contactado
    ↓ useTRPC().leads.updateEstado
withTenant(activeOrgId): set estado + append LeadNote to timeline (commit)
    ↓ enqueue EMAIL_QUEUE { leadId, organizationId, event }
apps/worker → processEmail → withTenant(orgId) read lead/broker recipient
    ↓ Resend send (React Email) · retries · failed→Sentry+pino
```

### Price-propagation seam (leave dormant)
```
unit_prices write (grid/Excel)  ──▶  [ Fase-5 insertion point: pg_notify inside the SAME withTenant tx ]
                                       (NO consumer, NO NOTIFY built this milestone)
```

## Integration Points

### Internal boundaries — every new write path and its RLS implication

| New write path | Procedure guard | Tenancy enforcement | Notes |
|----------------|-----------------|---------------------|-------|
| `units.updateEstado` | protected + requireRole | `withTenant(activeOrgId)` → `units_tenant` | client never sends orgId; foreign unitId → 0 rows |
| `units.upsertPrice` | protected + requireRole | `unit_prices_tenant` + 3 composite FKs org-pin | **needs `UNIQUE(unit_id, price_list_id)` migration** for onConflict upsert |
| `units.importExcel` | protected + requireRole | one `withTenant` tx; per-row RLS visibility | bad row → reported, never throws whole batch; row/size cap |
| `leads.updateEstado` | protected + requireRole | `leads_tenant`; timeline validated by `leadNoteSchema` | append note; enqueue email carries orgId in payload |
| `floors.setPolygon` / `units.setPolygon` | protected + requireRole | `floors_tenant` / `units_tenant` | validate coordinates (Zod), store TEXT; render via React not raw SVG |
| Email worker read | (worker, no session) | `withTenant(orgId)` from job payload | orgId travels in job data, exactly like media/pdf jobs |

### External services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Resend + React Email | Reuse `send-invitation.ts` shape (dev console fallback when no `RESEND_API_KEY`) | New lead template; verified `INVITE_FROM`-style sender required in staging/prod |
| Cloudflare R2 | **Not needed for Excel.** Only touched if hotspot editor uploads new renders (that reuses the existing `media.createUpload/confirmUpload` presigned pipeline) | do not build a new upload path |
| BullMQ/Redis | Add `EMAIL_QUEUE` to `packages/storage/src/queue.ts`; producer in api, consumer in worker | clone `MEDIA_QUEUE`/`QUOTE_PDF_QUEUE` contract + `boot()` wiring verbatim |

## Anti-Patterns (specific to this milestone)

### Anti-Pattern 1: Routing Excel through the worker/R2 pipeline
**What people do:** upload `.xlsx` to R2 → enqueue a job → worker parses.
**Why it's wrong:** adds Redis + R2 + async polling for a KB payload that parses in milliseconds; the operator must then wait for a round-trip to learn row 12 failed.
**Do this instead:** parse client-side (or in the mutation), validate + upsert inline under `withTenant`, return a synchronous per-row report.

### Anti-Pattern 2: Emitting `pg_notify` now "so SSE is ready later"
**What people do:** add `NOTIFY price_changed` to the price write this milestone.
**Why it's wrong:** there is no LISTENer; it is an untested moving part that can't be verified and isn't in scope. The master doc's "cambio de precio al instante" is a *future phase* deliverable.
**Do this instead:** funnel all price writes through one `upsertPrice`/`importExcel` path so Fase-5 adds `pg_notify` (inside the existing `withTenant` tx) in one place. Build nothing else.

### Anti-Pattern 3: Multiple `unit_prices` rows per (unit, list) via price history
**What people do:** INSERT a new `vigencia` row on every edit for audit history.
**Why it's wrong:** the shipped quote resolver (`resolveAndQuote` in `quotes.ts`) reads `unit_prices` by `unitId` and expects exactly one contado + one financiado USD row — no `max(vigencia)` selection. Multiple rows silently break/duplicate the quote.
**Do this instead:** **upsert one row per (unit, price_list)** (UPDATE `precio`, set `vigencia = now()`) behind a `UNIQUE(unit_id, price_list_id)` constraint. If append-only price history is ever wanted, it is a joint change: the resolver must switch to latest-`vigencia` at the same time. Flag, don't sneak.

### Anti-Pattern 4: Rendering stored hotspot SVG as raw markup
**What people do:** `dangerouslySetInnerHTML` the `poligonoSvg` string.
**Why it's wrong:** turns a tenant-writable field into a stored-XSS vector on the public explorador.
**Do this instead:** store coordinates, validate with Zod, render through React `<svg><polygon points=…>` — consistent with the existing `image/svg+xml` upload rejection.

## Recommended Build Order

Dependencies: (a) the merge debt gates realistic staging verification of everything; (b) all three features are project-scoped and need a panel shell that today does not exist; (c) D1 and D2 are mutually independent; (d) hotspots depends on nothing in D1/D2 and only unlocks the *future* Fase-2 explorador, so it is lowest-urgency but fully parallelizable.

```
Task 0  ─ MERGE fase-0/foundation → main + staging re-verify (v1.2 debt)
          rate-limit 429 · full PDF flow · QR with staging URL. No feature code; unblocks all.
             │
Wave 1  ─ Panel project-scoped shell: proyectos list → [id] layout + tab nav
          (reuses projects.listForOrg; prerequisite for D1/D2/hotspots)
             │
Wave 2  ─ ┌─ D1 grilla de unidades ──────────────┐   ┌─ D2 bandeja de leads ───────┐
          │  1. migration UNIQUE(unit,list)       │   │  1. leads.listForOrg + UI    │
          │  2. read grid (RSC)                   │   │  2. updateEstado + timeline  │
          │  3. estado/price write mutations      │   │  3. EMAIL_QUEUE + worker +   │
          │  4. Excel EXPORT (read-only, trivial) │   │     Resend template          │
          │  5. Excel IMPORT (validate + upsert)  │   └──────────────────────────────┘
          └──────────────────────────────────────┘     (parallel with D1)
             │
Wave 3  ─ Editor de hotspots (floors/units setPolygon + canvas UI)
          zero D1/D2 dependency; could shift earlier/parallel if capacity allows.
```

**Rationale for D1-before/with-D2, hotspots last:** D1 is the highest-value surface, exercises the write-under-`withTenant` + `requireRole` pattern that D2 and hotspots then clone, and forces the `unit_prices` uniqueness decision that also protects the quote engine. D2 is independent and can run in parallel once the shell exists. Hotspots is the most UI-heavy (SVG drawing), needs the render-image confirmation, and its only downstream consumer (explorador) is a *later* milestone — so it carries the least schedule risk if it slips to the end.

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| 1 developer, ~40 units | Inline Excel + inline reads are trivially fast; nothing to tune |
| Dozens of projects, hundreds of units each | Grid read stays a single tenant-scoped SELECT; add pagination only if a project exceeds ~1k units. Excel row cap already bounds import |
| Multi-org, high lead volume | Queued email decouples transition latency from Resend; worker concurrency already the tuning knob (clone `concurrency: 2`) |

### Scaling priorities
1. **First bottleneck:** none realistic at MVP volumes — keep it simple, resist premature async.
2. **Second bottleneck:** if the public lead-capture endpoint (Fase-2) drives high inbound volume, the queued email design already absorbs it; inline email would not.

## Sources

- In-repo schema: `packages/db/src/schema/{units,floors,unit-prices,price-lists,leads,quotes,events,enums}.ts` — `poligonoSvg` columns, RLS policies, composite FKs, `leadNoteSchema`, enums. **HIGH** (source of truth)
- In-repo routers: `packages/api/src/trpc/routers/{quotes,projects,media}.ts`, `middleware.ts` (requireRole), `with-tenant.ts` — established mutation/withTenant/enqueue patterns. **HIGH**
- In-repo worker + storage: `apps/worker/src/index.ts`, `quote-pdf-runtime.ts`, `packages/api/src/quotes/runtime.ts`, `packages/storage/src/queue.ts` — BullMQ producer/consumer contract to clone for email. **HIGH**
- In-repo email + panel: `packages/api/src/email/send-invitation.ts`, `apps/panel/app/(dashboard)/page.tsx`, `lib/trpc-client.tsx` — Resend fallback pattern, RSC caller vs client island. **HIGH**
- `.planning/PROJECT.md` (v1.3 goal, D-01/D-02/D-10/D-13 decisions) + `docs/modelo-mvp.md` §3.3 (referenced) — feature scope + "cambio de precio al instante" future-phase promise. **HIGH**

---
*Architecture research for: ImBau panel de autogestión (milestone v1.3) — integration of D1/D2/hotspots into the shipped monorepo.*
*Researched: 2026-07-17*
