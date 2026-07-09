# Phase 6: UI pública del cotizador + CTA WhatsApp - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 15 new/modified
**Analogs found:** 13 / 15 (2 have no in-repo analog: Tailwind v4 CSS-first + snap slider)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/db/src/schema/projects.ts` (EDIT: `whatsapp` col) | model/schema | CRUD | itself + `brokers` whatsapp col | exact (self-edit) |
| `packages/db/migrations/0004_*.sql` (NEW) | migration | schema-DDL | `migrations/0003_rls_domain.sql` | exact |
| `packages/db/seed.ts` (EDIT: project.whatsapp) | seed | batch | `seed.ts:104-113` (project insert) | exact (self-edit) |
| `packages/api/src/trpc/routers/picker.ts` (NEW) | route (tRPC router) | request-response (anon read) | `routers/projects.ts` (`listPublished`) | exact |
| `packages/api/src/trpc/routers/_app.ts` (EDIT: mount picker) | route/config | — | `_app.ts` itself | exact (self-edit) |
| `apps/web/lib/trpc-client.tsx` (NEW) | provider/client | request-response | `apps/panel/lib/trpc-client.tsx` | exact + splitLink delta |
| `apps/web/app/p/[slug]/cotizador/page.tsx` (NEW) | route (RSC page) | request-response | `apps/web/app/page.tsx` | exact |
| `apps/web/app/layout.tsx` (EDIT: fonts + provider) | layout/config | — | `apps/panel/app/layout.tsx` + `apps/web/app/layout.tsx` | role-match |
| `apps/web/app/globals.css` (NEW) | config (Tailwind v4) | — | none (first public UI) | no analog |
| `apps/web/postcss.config.mjs` (NEW) | config | — | none | no analog |
| `apps/web/env.ts` (no change expected) | config | — | itself | n/a (no new env) |
| `apps/web/components/cotizador-simulator.tsx` (NEW) | component (client island) | event-driven (live recompute) | `apps/panel/app/(dashboard)/invite-form.tsx` | role-match |
| `apps/web/components/picker.tsx` (NEW) | component (client island) | request-response | `invite-form.tsx` + `page.tsx` | role-match |
| `apps/web/components/quote-cards.tsx` (NEW) | component (presentational) | transform (render QuoteResult) | none (uses `format*`) | partial |
| `apps/web/components/plan-slider.tsx` (NEW) | component | event-driven | none (native range / Radix) | no analog |
| `packages/ui/src/*` (EDIT: tokens + primitives) | utility/config | — | none (placeholder today) | no analog |

## Pattern Assignments

### `packages/db/src/schema/projects.ts` (EDIT — add `whatsapp`)

**Analog:** itself (RLS-forced tenant table); no policy change needed. The existing `projects_anon_published` (SELECT to `anonRole`, table-level) already exposes any new column to anon — do NOT add a policy.

Add inside the columns object (after `estado`, line 28):
```typescript
whatsapp: text("whatsapp"),   // nullable; broker routing overrides later (WA-01 slot). No policy change.
```
`text` is already imported (line 7). Do NOT confuse with `brokers.whatsapp` (seed `content.ts:307/314/321` is the broker field — a different table).

**Migration:** run `pnpm --filter @imbau/db exec drizzle-kit generate` → emits `packages/db/migrations/0004_*.sql` (next after `0003_rls_domain.sql`). NEVER hand-edit the SQL (CLAUDE.md versioned-migrations rule). Expected body: `ALTER TABLE "projects" ADD COLUMN "whatsapp" text;` (additive, nullable, no backfill).

---

### `packages/db/seed.ts` (EDIT — project `whatsapp`)

**Analog:** `seed.ts:100-113` (the project insert). Add `whatsapp` to the `.values({...})` so demo/staging always render the CTA (D-01/D-02). Number is a digits+`+` string like the broker seed values (`"+5491155551234"`, `content.ts:307`).
```typescript
// seed.ts inside .insert(schema.projects).values({...})  (after estado: "publicado")
whatsapp: "+5491155551234",   // D-01: default project number; CTA always renders (D-02)
```

---

### `packages/api/src/trpc/routers/picker.ts` (NEW — anon reads)

**Analog:** `packages/api/src/trpc/routers/projects.ts` (`listPublished`, lines 20-22).

**Fence (T-03-09 / T-05-07, grep-verified):** import ONLY `withAnon`/`schema` from `@imbau/db` — never `createOwnerDb`/`appDb`. Mirror the `projects.ts` header comment.

**Imports pattern** (clone `projects.ts:11-12` + add zod/eq):
```typescript
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAnon, schema } from "@imbau/db";
import { router, publicProcedure } from "../init";
```

**Core anon-read pattern** (clone the `listPublished` shape — `publicProcedure` → `withAnon((tx) => tx.select()...)`). The anon RLS policies on `floors`/`units`/`payment_plans` (`units_anon_published`, `payment_plans_anon_published`) already gate every row to `estado='publicado'` via single-level `EXISTS` on the parent project (see `units.ts:72-77`, `payment-plans.ts:60-65`) — NO app-layer `where estado=...`:
```typescript
export const pickerRouter = router({
  getPublishedProject: publicProcedure.input(z.object({ slug: z.string() })).query(({ input }) =>
    withAnon((tx) =>
      tx.select({ id: schema.projects.id, nombre: schema.projects.nombre,
                  whatsapp: schema.projects.whatsapp })            // NEW column (D-01)
        .from(schema.projects).where(eq(schema.projects.slug, input.slug)).limit(1))),
  listFloors: publicProcedure.input(z.object({ projectId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.floors).where(eq(schema.floors.projectId, input.projectId)))),
  listUnits: publicProcedure.input(z.object({ floorId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.units).where(eq(schema.units.floorId, input.floorId)))),
  listPlans: publicProcedure.input(z.object({ projectId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.projectId, input.projectId)))),
});
```
Only `disponible` units are selectable (D-08) — filter/label in the picker component, NOT in the query (the semantic tokens `disponible/reservado/vendido` come from `units.estado`, `units.ts:45`). `payment_plans.notasLegales` (`payment-plans.ts:41`) carries the UI-05 leyenda text — read it via `listPlans`.

---

### `packages/api/src/trpc/routers/_app.ts` (EDIT — mount picker)

**Analog:** `_app.ts` itself (lines 10-24). Add `import { pickerRouter } from "./picker";` and `picker: pickerRouter,` inside `router({...})`. This extends `AppRouter` so the web client gets end-to-end types with no codegen.

---

### `apps/web/lib/trpc-client.tsx` (NEW — dual splitLink client)

**Analog:** `apps/panel/lib/trpc-client.tsx` (whole file, 45 lines) — clone it, then swap the single `httpBatchLink` for a `splitLink`.

**Imports + context pattern** (panel lines 1-16): `"use client"`, `createTRPCContext<AppRouter>()` → export `{ TRPCProvider, useTRPC }`, `getBaseUrl()` (panel lines 18-23), and the `TRPCReactProvider` wrapper with `useState(() => new QueryClient())` (panel lines 25-44).

**Delta (Pattern 1 — the load-bearing decision):** the `links` array becomes a single `splitLink` so quotes procedures only ever batch with each other — keeping the HTTP path prefixed `/api/trpc/quotes.*` so the nginx `location ^~ /api/trpc/quotes` `limit_req` actually throttles them (STATE.md / fase-5 A1; `deploy/nginx/staging.tours.andescode.com.ar.conf`):
```typescript
import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
// ...
createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.path.startsWith("quotes."),
      true: httpBatchLink({ url }),   // dedicated: only quotes.* batch here
      false: httpBatchLink({ url }),  // everything else (picker reads)
    }),
  ],
});
```
New deps to add to `apps/web` (server side `@trpc/server@11.17.0` already present, `package.json:21`): `@trpc/client@11.17.0`, `@tanstack/react-query@5.101.0`, `@trpc/tanstack-react-query@11.17.0`.

---

### `apps/web/app/p/[slug]/cotizador/page.tsx` (NEW — RSC page)

**Analog:** `apps/web/app/page.tsx` (whole file, 44 lines).

**Force-dynamic + anon-read pattern** (page.tsx lines 11, 25-26): `export const dynamic = "force-dynamic";` then `const caller = await createCaller({ headers: await headers() })` and call `caller.picker.getPublishedProject/listFloors/...`. Import `"../env"` (or the relative path) to keep env fail-fast at boot (page.tsx line 3). Web is anon-only for reads — the direct server caller is enough (no auth client). Resolve project + floors + plans + `whatsapp` server-side and pass as props to the client island.

**Suspense (Pitfall 6):** the client subtree reads `useSearchParams` (`?u=&plan=`), so wrap the island in `<Suspense>` even though the page is `force-dynamic`.

---

### `apps/web/app/layout.tsx` (EDIT — fonts + provider + dark grafito)

**Analog:** `apps/web/app/layout.tsx` (current minimal, keep `lang="es-AR"`) + `apps/panel/app/layout.tsx` for provider mounting. Add `next/font/google` (Space Grotesk / Inter / JetBrains Mono, `variable` + `display:"swap"` — RESEARCH Pattern 7), apply the font CSS vars + dark grafito on `<body>`, `import "./globals.css"`, and wrap children in `TRPCReactProvider` from `apps/web/lib/trpc-client`.

---

### `apps/web/components/cotizador-simulator.tsx` (NEW — client island)

**Analog:** `apps/panel/app/(dashboard)/invite-form.tsx` (client island using `useTRPC` + `useMutation`).

**Client-island + mutation pattern** (invite-form lines 1-19): `"use client"`, `const trpc = useTRPC();`, `const compute = useMutation(trpc.quotes.compute.mutationOptions());`. Error/pending UI via `mutation.isPending`/`isError`/`error.message` (invite-form lines 50-61) — es-AR voseo.

**Race-safe recompute (Pattern 3 / Pitfall 2):** `quotes.compute` is a `.mutation` (`quotes.ts:172-177`) — TanStack Query does NOT dedupe/cancel mutations. Debounce ~150-250ms + monotonic `seq` ref, drop stale responses:
```typescript
const compute = useMutation(trpc.quotes.compute.mutationOptions());
const seq = useRef(0);
function recompute(input: QuoteInput) {
  const mine = ++seq.current;
  compute.mutate(input, { onSuccess: (r) => { if (mine === seq.current) setResult(r); } });
}
```
Run TWO computes (contado + financiado, UI-03/D-09), feed both to `compareQuotes`. **Never** compute `create` on navigation — only on the CTA (D-06).

**429 tolerance (Pitfall 4):** map the tRPC error to a soft es-AR message + retry; read `error.data.quoteErrorCode` for engine-domain errors (already surfaced by `errorFormatter`, see `quotes.ts:148-166`).

**CTA / wa.me handoff (Pattern 5 / WA-01):** on the CTA, `create.mutate(input)` (`quotes.ts:181` returns `{quoteId, result}`) → build and navigate:
```typescript
const digits = project.whatsapp.replace(/[^\d]/g, "");   // digits only, no +/spaces
const header = `Hola! Me interesa la unidad ${unit.identificador} de ${project.nombre}.`;
const text   = encodeURIComponent(`${header}\n${toWhatsAppText(result)}\n${deepLinkUrl}`);
window.location.href = `https://wa.me/${digits}?text=${text}`;
```
If `project.whatsapp` is null, do NOT render the CTA at all (D-02 — no dead buttons).

---

### `apps/web/components/quote-cards.tsx` (NEW — presentational)

**No direct analog** (first public render surface). MUST format money ONLY with `formatUsd`/`formatArs` from `@imbau/quoting` (barrel `index.ts:17`) — NEVER `Intl`/`toLocaleString` (Pitfall 3, hydration + `US$`/`$` drift; UI-06 is already solved server==client). Render `FinanciadoResult`/`ContadoResult` fields directly (`QuoteResult`, barrel type export). JetBrains Mono for ALL financial figures (D-11). Contado + financiado cards apiladas (mobile) / lado a lado (desktop) with the `compareQuotes` savings band (D-09). Layout literal to `docs/mockup.html §s-cotizador` (D-12).

---

### `apps/web/components/plan-slider.tsx` (NEW — snap-to-preset)

**No in-repo analog.** Native `<input type="range">` with value = INDEX into the sorted `payment_plans[]` (Pattern 4 / D-04). The API only accepts `paymentPlanId` (`quotes.ts:31`) — free terms are structurally impossible. `plans.length === 1` → disabled/fixed, never synthesize plans. Radix `@radix-ui/react-slider@1.4.2` only if native fidelity is rejected (Assumption A1). Motion transform/opacity only (D-13).

---

### `packages/ui/src/*` (EDIT — placeholder → design system)

**No analog** (currently placeholder). Recommendation (RESEARCH Open Q1): tokens + presentational primitives (cards, badges, slider) go here; stateful islands (simulator, picker w/ tRPC) stay in `apps/web`. Copy `docs/marca/tokens.css` in. If cotizador presentational components live here, add `@source "../../../packages/ui/src";` to `apps/web/app/globals.css` or they get purged (Pitfall 5).

## Shared Patterns

### Anon published-only reads (withAnon)
**Source:** `packages/api/src/trpc/routers/projects.ts:20-22` (`listPublished`)
**Apply to:** every new `picker.ts` procedure; the RSC page caller.
```typescript
publicProcedure.query(() => withAnon((tx) => tx.select().from(schema.projects)))
```
The anon RLS policy does the `publicado` filtering (`projects.ts:52-57`, `units.ts:72-77`, `payment-plans.ts:60-65`). App-layer `where estado=...` is a footgun — never add it.

### @imbau/db import fence (T-03-09 / T-05-07)
**Source:** header comments in `projects.ts:9-10`, `quotes.ts:11-13`
**Apply to:** `picker.ts`. Import ONLY `withTenant`/`withAnon`/`schema` — never the owner/elevated pool. grep-verified in plan verification.

### es-AR deterministic money formatting (UI-06 — already solved)
**Source:** `packages/quoting/src/index.ts:17` → `formatUsd`/`formatArs`
**Apply to:** all render components + the wa.me text. Never `Intl`/`toLocaleString` in components (Pitfall 3).

### One QuoteResult → every surface (ENGINE-03)
**Source:** `packages/quoting/src/index.ts:12-17` (`calcQuote`, `compareQuotes`, `toWhatsAppText`)
**Apply to:** quote-cards (render), wa-preview + CTA (`toWhatsAppText(result)`, `serialize.ts:36`), comparison band (`compareQuotes`). Never recompute money or the WhatsApp text by hand.

### Client island: useTRPC + useMutation
**Source:** `apps/panel/app/(dashboard)/invite-form.tsx:9-19,50-61`
**Apply to:** simulator + picker islands. Provider (`TRPCProvider`/`useTRPC`) from `apps/web/lib/trpc-client.tsx` (cloned from panel).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/app/globals.css` | config | — | First Tailwind v4 CSS-first setup in repo (`@import "tailwindcss"` + `@theme` mapping `docs/marca/tokens.css`) — use RESEARCH Pattern 6 |
| `apps/web/postcss.config.mjs` | config | — | First PostCSS config; `{ plugins: { "@tailwindcss/postcss": {} } }` (RESEARCH) |
| `apps/web/components/plan-slider.tsx` | component | event-driven | No slider exists; native range snap-by-index (Pattern 4) |
| `apps/web/components/quote-cards.tsx` | component | transform | No public render surface yet; driven by `format*` + mockup |
| `packages/ui/src/*` | design system | — | Placeholder today; tokens.css says "importar en packages/ui" |

## Metadata

**Analog search scope:** `apps/web/app`, `apps/panel/{app,lib}`, `packages/api/src/trpc/routers`, `packages/db/src/schema`, `packages/db/seed.ts` + `src/seed`, `packages/quoting/src`
**Files scanned:** ~18 (all read from source this session)
**Pattern extraction date:** 2026-07-04
