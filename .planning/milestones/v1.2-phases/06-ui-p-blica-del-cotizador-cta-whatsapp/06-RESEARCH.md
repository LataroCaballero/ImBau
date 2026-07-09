# Phase 6: UI pública del cotizador + CTA WhatsApp - Research

**Researched:** 2026-07-04
**Domain:** Next.js 16 App Router public UI (RSC + interactive client island), Tailwind CSS v4 CSS-first design system, tRPC v11 browser client with dedicated rate-limited link, wa.me deep-link handoff
**Confidence:** HIGH (stack fully decided in CLAUDE.md; every dependency verified on npm; all upstream contracts read from source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 Fuente del número WhatsApp:** migración Drizzle nueva que agrega `whatsapp` (text, nullable) a `projects` + seed "Brigos Recoleta" actualizado para cargarlo. Número default del proyecto; routing por broker (fase 5 maestro) lo overridea después (slot de WA-01). El panel lo editará en fase 4 maestro.
- **D-02 Sin número cargado:** el CTA WhatsApp NO se renderiza (nada de botones muertos). El seed siempre carga número.
- **D-03 Composición del mensaje:** encabezado con unidad + proyecto + `toWhatsAppText(result)` + la URL del deep-link compartible (unidad+plan en params). URL-encoded completo. Copy ajustable sin bump de `ENGINE_VERSION`.
- **D-04 Control de ajuste: sliders con snap a presets.** Sliders de anticipo/plazo estilo mockup, pero que SOLO caen en los `payment_plans` autorizados (snap); nunca términos libres (el API solo acepta `paymentPlanId`). Un solo plan → slider degenera a estado fijo; no inventar planes.
- **D-05 Recompute inmediato:** cada cambio dispara `quotes.compute` (efímero) y actualiza en vivo. Ante 429: mensaje suave es-AR + reintento; la UI DEBE tolerarlo.
- **D-06 Emisión (persistencia):** `quotes.create` se dispara ÚNICAMENTE al tocar el CTA WhatsApp. Navegar/recomputar jamás persiste. Fase 7: el botón PDF será el segundo trigger de create.
- **D-07 Estructura de rutas:** `/p/[slug]/cotizador` con selección en query params (`?u=<unitId>&plan=<planId>`). Con params = deep-link al resultado; sin params = picker. El deep-link es la misma URL que viaja en el WhatsApp.
- **D-08 Picker en dos pasos:** primero piso (los 13), después unidades del piso con tipología/m²/ambientes. Solo unidades `disponible` cotizables. Necesita reads públicos anon nuevos (floors/units/payment_plans), clonando `listPublished` + withAnon.
- **D-09 Comparación contado vs financiado:** dos cards apiladas en mobile, lado a lado en desktop, con cifras de `compareQuotes` como banda de resumen. Todo visible sin interacción.
- **D-10 Stack de estilos:** Tailwind CSS v4 (CSS-first via `@import`/`@theme`, sin tailwind.config). Los tokens de `docs/marca/tokens.css` son la fuente de verdad; `packages/ui` deja de ser placeholder.
- **D-11 Nivel visual: demo wow desde ya** (contra la recomendación de base neutra). Look marca ImBau: dark-first grafito `#14181E`, superficies carbón, acento cobre (nunca fondo), Space Grotesk display, Inter UI, JetBrains Mono para TODAS las cifras, motion sutil 200-800ms con `prefers-reduced-motion`.
- **D-12 Mockup literal (visual):** replica `docs/mockup.html` §s-cotizador en layout y sensación — incluido el wa-preview y el botón PDF (placeholder no funcional u oculto; wiring es fase 7). Alcance NO literal: lead-por-cotización y selector de lista de broker quedan fuera.
- **D-13 Performance sigue siendo constraint:** <3s en 4G en gama media aplica desde esta fase. Fuentes vía `next/font`, Tailwind purgado, motion barato (transform/opacity).

### Claude's Discretion
- Arquitectura de data fetching (RSC para picker/datos estáticos + client component para el simulador; TanStack Query v5 + `@trpc/tanstack-react-query`) — respetando el link httpBatchLink DEDICADO para `/api/trpc/quotes`.
- Plan preseleccionado al aterrizar sin `?plan=`, estados de carga/skeleton, manejo fino de errores tRPC tipados (`quoteErrorCode`).
- Forma exacta de los reads públicos nuevos (procedures tRPC vs RSC con withAnon directo) y sus nombres.
- Mapping exacto tokens.css → Tailwind theme, estructura de componentes en `packages/ui` vs `apps/web`.
- Detalles del snap de sliders (cómo se mapean N planes a posiciones discretas; qué pasa con 1 solo plan).
- Copy es-AR final (voseo) de labels, leyendas de error y estados vacíos.

### Deferred Ideas (OUT OF SCOPE)
- **Lead por cotización** — Out of Scope explícito de v1.2; `quotes.leadId` deja el slot.
- **Selector de lista de precios de broker** — broker links `/b/<slug>` son fase 5 del maestro; el slot de routing queda en el mensaje WhatsApp.
- **Botón "Descargar PDF" funcional** — fase 7 (puede mostrarse como placeholder deshabilitado, sin wiring).
- **Theming por tenant** (`projects.branding`) — la marca ImBau es el look de esta fase; branding por proyecto llega con portada/galería (fase 5 maestro).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Deep-link compartible por URL param + picker piso→unidad sobre unidades publicadas (anon) | Pattern 2 (RSC→island), Pattern 5/D-07 route `/p/[slug]/cotizador?u=&plan=`, anon picker reads (Code Examples), Pitfall 6 (`useSearchParams` Suspense) |
| UI-02 | Resultado mobile-first: precio USD, anticipo USD+%, cuotas, 1ª cuota ARS, refuerzos, totales | `QuoteResult` (`FinanciadoResult`) fields already carry every value; render via `formatUsd`/`formatArs`; mockup §quote-out layout |
| UI-03 | Comparación contado vs financiado lado a lado (dos corridas del motor) | Pattern 3 (two computes) + `compareQuotes` for the savings band (D-09) |
| UI-04 | Ajuste interactivo solo dentro de presets/bounds autorizados (nunca términos libres) | Pattern 4 (snap-to-preset by planId index); API only accepts `paymentPlanId` (`quotes.ts`) |
| UI-05 | Leyenda ajuste CAC + "no vinculante" (`payment_plans.notasLegales`) visible | `notasLegales` read via anon `listPlans`; `toWhatsAppText`/serialize already carry the leyendas; render on screen |
| UI-06 | Montos es-AR consistentes server/cliente (`US$` vs `$`) | **Already solved** — `formatUsd`/`formatArs` (`@imbau/quoting/format.ts`) are deterministic; Pitfall 3 (never use `Intl`/`toLocaleString`) |
| WA-01 | CTA "Consultar por WhatsApp" → wa.me con resumen precargado, corto, con número del proyecto + slot broker | Pattern 5 (wa.me builder) + `toWhatsAppText` (D-03) + `projects.whatsapp` new column (D-01) + D-02 (hide if null) |
</phase_requirements>

## Summary

This is the first **real public UI** of `apps/web`. Almost nothing here is a technology decision — the stack is locked by CLAUDE.md and every upstream contract (`packages/quoting`, `quotes.compute`/`quotes.create`, the `withAnon` read pattern) already exists and was read from source in this research. The work is **assembly, not invention**: wire the tRPC browser client that `apps/web` still lacks, stand up Tailwind v4 + brand tokens + `next/font`, add anon reads for the piso→unidad picker, and build the mockup-faithful simulator screen that drives `compute` live and `create` on the WhatsApp CTA.

Four genuinely new technical areas needed verification and are covered below: (1) **Tailwind CSS v4 CSS-first** setup with Next 16 (`@import "tailwindcss"` + `@theme`, no `tailwind.config.js`) mapping `docs/marca/tokens.css`; (2) the **dual-`httpBatchLink` via `splitLink`** that keeps every quotes request on a URL path beginning `/api/trpc/quotes.*` so the nginx `limit_req` actually throttles it; (3) `next/font/google` self-hosting Space Grotesk / Inter / JetBrains Mono to meet the <3s-on-4G budget with zero layout shift; (4) the **mutation-race pitfall** — `quotes.compute` is a tRPC *mutation*, so a live simulator firing it on every slider change must debounce and guard against out-of-order responses (TanStack Query does not dedupe/cancel mutations).

**Primary recommendation:** RSC page at `/p/[slug]/cotizador` (`force-dynamic`) resolves the project + published floors/units/plans + `whatsapp` via `withAnon` reads and hydrates a single `"use client"` simulator island; the island calls `quotes.compute` (debounced, sequence-guarded) through a **dedicated** `httpBatchLink`, formats every amount with the existing `formatUsd`/`formatArs` from `@imbau/quoting` (UI-06 is already solved server+client), and on the CTA fires `quotes.create` then `window.location.href = wa.me/<digits>?text=<encoded>`. Reuse `toWhatsAppText(result)` for the message body. Do not hand-roll formatting, quote math, or slider a11y.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deep-link route + params (`/p/[slug]/cotizador?u=&plan=`) | Frontend Server (Next RSC) | Browser (`useSearchParams`) | RSC resolves the initial state from params; client reads/writes params for shareable state |
| Picker data (floors/units/plans of published project) | API (tRPC `publicProcedure` + `withAnon`) | Database (RLS anon policy) | Reads must go through the anon policy that filters to `publicado`; clone `listPublished` |
| Quote computation | API (`quotes.compute`, server-side) | Database (RLS, CAC/prices) | Org + prices + CAC resolved server-side under `withTenant`; never trust client inputs (fase 5) |
| Interactive simulator (sliders/modalidad/recompute) | Browser (client component) | — | Live state + debounced mutation calls; RSC cannot hold interactive state |
| es-AR money formatting | Shared (`@imbau/quoting` `format.ts`) | — | Deterministic same-in/same-out on server and client — the whole reason UI-06 is solved |
| Snapshot persistence (on CTA only) | API (`quotes.create`) | Database | Write happens once, on WhatsApp CTA (D-06); navigation never persists |
| wa.me handoff | Browser | — | Builds URL from `QuoteResult` + `project.whatsapp`, opens WhatsApp |
| Brand styling / tokens / fonts | Shared (`packages/ui` + `apps/web` layout) | — | Tokens live in `packages/ui`; `next/font` + Tailwind theme wired in the web layout |
| WhatsApp number source | Database (`projects.whatsapp`, new column) | Seed | New nullable column + seed value (D-01) |

## Standard Stack

Every version below is pinned by CLAUDE.md's Technology Stack and/or already present in the monorepo. Versions **verified on npm 2026-07-04**.

### Core (add to `apps/web`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@trpc/client` | `11.17.0` | Browser tRPC client (`createTRPCClient`, `httpBatchLink`, `splitLink`) | Match `@trpc/server@11.17.0` already in web; `splitLink`/`httpBatchLink` live here `[VERIFIED: npm]` |
| `@tanstack/react-query` | `5.101.0` | Client cache/mutation state for tRPC | Same version panel uses; v5 required by tRPC v11 (CLAUDE.md "What NOT to Use") `[VERIFIED: npm]` |
| `@trpc/tanstack-react-query` | `11.17.0` | `createTRPCContext` → `useTRPC()` proxy + `TRPCProvider` | Exact pattern already proven in `apps/panel/lib/trpc-client.tsx` `[VERIFIED: codebase]` |
| `tailwindcss` | `4.3.2` | CSS-first utility styling | CLAUDE.md D-10; `latest` on npm is `4.3.2` `[VERIFIED: npm]` |
| `@tailwindcss/postcss` | `4.3.2` | The v4 PostCSS plugin (replaces the old `tailwindcss` + `autoprefixer` PostCSS pair) | Official v4 Next integration `[CITED: tailwindcss.com/docs/guides/nextjs]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@radix-ui/react-slider` | `1.4.2` | Accessible slider primitive for the snap sliders (D-04) | Use if native `<input type=range>` a11y/styling proves insufficient for the mockup look. Otherwise a styled native range is lighter (see Alternatives) `[VERIFIED: npm]` |
| `next/font/google` | (built into `next@16.2.9`) | Self-host Space Grotesk / Inter / JetBrains Mono, zero layout shift | Always — never `<link>` to Google Fonts (fails D-13 budget) `[CITED: nextjs.org/docs]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@radix-ui/react-slider` | Styled native `<input type="range">` (as the mockup does, line 1141) | Native is zero-dep and matches mockup markup, but snapping to N discrete preset positions + keyboard a11y + a branded thumb is fiddlier to get right than Radix's `step`/`onValueChange`. For **snap-to-preset with 2–4 stops**, native range with `step` and integer stop-indices is entirely adequate and lighter — recommend native first, Radix only if design fidelity demands it. |
| `next/font/google` | `next/font/local` with downloaded woff2 | `google` is simpler and still self-hosts at build; use `local` only if you need a weight/subset Google doesn't serve. All three families are on Google Fonts (brand-book §Tipografía). |
| Dual `httpBatchLink` + `splitLink` | Single `httpLink` (no batching) for quotes | A non-batching `httpLink` also guarantees the URL path is exactly `/api/trpc/quotes.compute`, satisfying nginx — but you lose batching for the (rare) case of parallel quotes calls. `splitLink` + dedicated `httpBatchLink` keeps batching *within* the quotes namespace and is the intent of the STATE.md note. Either satisfies nginx; prefer `splitLink`. |

**Installation:**
```bash
# in apps/web
pnpm --filter @imbau/web add @trpc/client@11.17.0 @tanstack/react-query@5.101.0 @trpc/tanstack-react-query@11.17.0
pnpm --filter @imbau/web add -D tailwindcss@4.3.2 @tailwindcss/postcss@4.3.2
# optional, only if native range is rejected on fidelity grounds:
# pnpm --filter @imbau/web add @radix-ui/react-slider@1.4.2   (or export from packages/ui)
```

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm` on all new packages (2026-07-04).

| Package | Registry | Age (last publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|--------------------|-----------|-------------|---------|-------------|
| `tailwindcss` | npm | 2026-06-29 (weekly release) | 118M/wk | github.com/tailwindlabs/tailwindcss | SUS (`too-new`) | **Approved** — false positive |
| `@tailwindcss/postcss` | npm | 2026-06-29 | 23.8M/wk | github.com/tailwindlabs/tailwindcss | SUS (`too-new`) | **Approved** — false positive |
| `@tanstack/react-query` | npm | 2026-06-27 | 57.8M/wk | github.com/TanStack/query | SUS (`too-new`) | **Approved** — false positive (already in panel) |
| `@trpc/tanstack-react-query` | npm | — | (tRPC v11 line) | github.com/trpc/trpc | OK | **Approved** — already in panel |
| `@trpc/client` | npm | — | (tRPC v11 line) | github.com/trpc/trpc | OK | **Approved** — `@trpc/server` already in web |
| `@radix-ui/react-slider` | npm | 2026-06-30 | 43.4M/wk | github.com/radix-ui/primitives | SUS (`too-new`) | **Approved (optional)** — false positive |

**Note on the SUS verdicts:** all four `too-new` flags are the seam reacting to a *recent routine release date* (these packages ship near-weekly), **not** to newness of the package itself. Each has an authoritative repo, tens-to-hundreds of millions of weekly downloads, no `postinstall`, and is not deprecated. `@tanstack/react-query` and `@trpc/tanstack-react-query` are **already installed and working in `apps/panel`**. No `postinstall` scripts on any. These are the canonical, CLAUDE.md-mandated packages — treat as legitimate.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as genuinely suspicious [SUS]:** none (all `too-new` flags are release-recency false positives on official high-volume packages — no `checkpoint:human-verify` needed)

## Architecture Patterns

### System Architecture Diagram

```
                       shareable deep-link URL
                       /p/[slug]/cotizador?u=<unitId>&plan=<planId>
                                   │
                                   ▼
          ┌─────────────────────────────────────────────┐
          │  RSC page (force-dynamic)                     │
          │  createCaller({ headers })                    │
          │   ├─ projects.getPublishedBySlug  (withAnon)  │  → project {id, whatsapp, nombre}
          │   ├─ picker.listFloors            (withAnon)  │  → floors[] (published)
          │   ├─ picker.listUnits             (withAnon)  │  → units[] (disponible)
          │   └─ picker.listPlans             (withAnon)  │  → payment_plans[] (presets)
          └───────────────────┬─────────────────────────┘
                              │ initial data + params  (props)
                              ▼
          ┌─────────────────────────────────────────────┐
          │  "use client" Simulator island               │
          │  <TRPCReactProvider> (dual splitLink)         │
          │                                               │
          │  no params → Picker (piso → unidad, 2 steps)  │
          │  params    → deep-link straight to result     │
          │                                               │
          │  state: {unitId, planId(snap), modalidad}     │
          │    every change ──debounce──▶ compute.mutate  │──┐
          │    (seq-guarded, last-write-wins)             │  │
          │                                               │  │  DEDICATED httpBatchLink
          │  renders 2 cards (contado | financiado)       │  │  path: /api/trpc/quotes.compute
          │   + compareQuotes banda + notasLegales +       │ │       (nginx limit_req throttles)
          │     wa-preview  (all via formatUsd/formatArs)  │ ▼
          │                                               │ ┌──────────────────────────┐
          │  CTA "Consultar por WhatsApp":                │ │ apps/web /api/trpc/[trpc] │
          │    create.mutate ─▶ quoteId ─▶ window.location │ │ quotes.compute / .create  │
          │      = wa.me/<digits>?text=<encoded>          │ │ (publicProcedure, withAnon│
          └───────────────────────────────────────────────┘ │  → withTenant, RLS)       │
                                                             └──────────────────────────┘
                              other procedures (picker reads, etc.)
                              ──▶ default httpBatchLink (path NOT under /quotes)
```

### Recommended Project Structure
```
apps/web/
├── postcss.config.mjs           # { plugins: { "@tailwindcss/postcss": {} } }   (NEW)
├── app/
│   ├── globals.css              # @import "tailwindcss"; @theme { ...tokens }    (NEW)
│   ├── layout.tsx               # next/font vars + <body class> dark grafito     (EDIT)
│   └── p/[slug]/cotizador/
│       └── page.tsx             # RSC: force-dynamic, anon reads → island props  (NEW)
├── lib/
│   └── trpc-client.tsx          # dual splitLink client (clone panel + split)    (NEW)
└── components/                  # or consume from packages/ui
    ├── cotizador-simulator.tsx  # "use client" island: state + compute + CTA     (NEW)
    ├── picker.tsx               # "use client": piso → unidad, 2 steps           (NEW)
    ├── quote-cards.tsx          # contado | financiado cards from QuoteResult     (NEW)
    └── plan-slider.tsx          # snap-to-preset slider (native range or Radix)   (NEW)

packages/ui/
├── src/tokens.css               # copy of docs/marca/tokens.css (or re-export)    (NEW)
└── src/index.tsx                # export styled base + cotizador primitives       (EDIT)

packages/db/
├── src/schema/projects.ts       # + whatsapp: text("whatsapp")                    (EDIT)
├── migrations/0004_*.sql        # additive column (drizzle-kit generate)          (NEW)
└── src/seed/content.ts          # project.whatsapp = "+549..."                    (EDIT)

packages/api/src/trpc/routers/
└── picker.ts (or extend projects.ts) # floors/units/plans anon reads             (NEW)
```

### Pattern 1: tRPC browser client with dual `splitLink` (the load-bearing decision)
**What:** One `createTRPCClient` whose `links` array is a single `splitLink`: quotes procedures → a **dedicated** `httpBatchLink`, everything else → a **default** `httpBatchLink`. Both point at the same `/api/trpc` endpoint.
**When to use:** Always in `apps/web` — this is *the* reason the phase exists as a client-wiring task.
**Why it matters:** nginx throttles `location ^~ /api/trpc/quotes` by matching the request path. `httpBatchLink` builds the path from the comma-joined procedure names in a batch (`/api/trpc/quotes.compute,other.thing`). If a quotes call shares a batch with a non-quotes procedure, the joined path can start with the *other* name and **escape the nginx location** (STATE.md note / fase-5 A1). A dedicated link guarantees quotes procedures only ever batch with each other, so the path always begins `/api/trpc/quotes.*`.
```typescript
// apps/web/lib/trpc-client.tsx  — clone of apps/panel/lib/trpc-client.tsx, + splitLink
"use client";
import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@imbau/api";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

const url = (typeof window !== "undefined" ? window.location.origin : "") + "/api/trpc";
createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.path.startsWith("quotes."),
      true: httpBatchLink({ url }),   // dedicated: only quotes.* ever batch here
      false: httpBatchLink({ url }),  // everything else
    }),
  ],
});
```

### Pattern 2: RSC page → client island (data fetch on server, interactivity on client)
**What:** The route `page.tsx` is a Server Component (`force-dynamic`) that resolves all picker/project data through `createCaller` + `withAnon` (exactly like `apps/web/app/page.tsx`) and passes it as props to a `"use client"` simulator. The simulator owns interactive state and calls `quotes.compute` via `useTRPC()`.
**When to use:** This split for every public data-backed page.
**Why:** anon reads must happen server-side at request time (no live DB at build → `force-dynamic`, per the existing `page.tsx` comment); interactivity (sliders, live recompute) must be client-side.

### Pattern 3: Live recompute with a tRPC **mutation** (race-safe)
**What:** `quotes.compute` is defined as `.mutation()` (not a query — see `quotes.ts`). Drive it with `useMutation(trpc.quotes.compute.mutationOptions())`, fire on state change **debounced**, and guard ordering with a sequence ref so a late response can't overwrite a newer one.
**Why:** TanStack Query does not cache, dedupe, or cancel mutations. Rapid slider changes ⇒ overlapping in-flight computes ⇒ the on-screen number could settle on a stale response.
```typescript
// inside the simulator island
const compute = useMutation(trpc.quotes.compute.mutationOptions());
const seq = useRef(0);
function recompute(input: QuoteInput) {
  const mine = ++seq.current;
  compute.mutate(input, {
    onSuccess: (result) => { if (mine === seq.current) setResult(result); },
  });
}
// call recompute() from a ~150–250ms debounced effect on {unitId, planId, modalidad}
```
Run **two** computes (contado + financiado) for the side-by-side comparison (UI-03, D-09), then feed both `QuoteResult`s to `compareQuotes` for the savings band.

### Pattern 4: Snap-to-preset slider (D-04)
**What:** Map the project's `payment_plans[]` to discrete slider stops. The slider's value is an **index into the sorted plans array**, never a free anticipo/plazo value. `onValueChange(i) → setPlanId(plans[i].id) → recompute`.
**When to use:** the anticipo/plazo control. The API only accepts `paymentPlanId` (`quotes.ts` input) — free terms are structurally impossible and Out of Scope.
**Degenerate case (D-04):** if `plans.length === 1`, render the slider disabled/fixed (or omit it) — never synthesize plans.
```tsx
// native range, snap = integer index; label shows the plan's anticipoPct/cuotas
<input type="range" min={0} max={plans.length - 1} step={1}
       value={idx} disabled={plans.length < 2}
       onChange={(e) => selectPlan(plans[Number(e.target.value)])} />
```

### Pattern 5: wa.me handoff (WA-01)
**What:** On the CTA: `create.mutate(input)` → on success build the URL and navigate.
```typescript
const digits = project.whatsapp.replace(/[^\d]/g, "");          // wa.me wants digits only
const header = `Hola! Me interesa la unidad ${unit.identificador} de ${project.nombre}.`;
const body   = toWhatsAppText(result);                           // @imbau/quoting, D-03
const link   = shareableDeepLinkUrl;                             // same URL as UI-01, with u&plan params
const text   = encodeURIComponent(`${header}\n${body}\n${link}`);
window.location.href = `https://wa.me/${digits}?text=${text}`;
```
**Why:** `wa.me/<number>?text=<urlencoded>` is the canonical WhatsApp click-to-chat format; the number must be digits only (country code, no `+`/spaces). If `project.whatsapp` is null the CTA is **not rendered at all** (D-02 — no dead buttons).

### Pattern 6: Tailwind v4 CSS-first + brand tokens
**What:** No `tailwind.config.js`. `postcss.config.mjs` loads `@tailwindcss/postcss`; `globals.css` does `@import "tailwindcss"` then a `@theme` block mapping `docs/marca/tokens.css` values to Tailwind theme tokens; `layout.tsx` imports `globals.css` and applies the `next/font` CSS variables + dark grafito background.
```css
/* apps/web/app/globals.css */
@import "tailwindcss";
@theme {
  --color-grafito: #14181E;   --color-carbon: #1D232C;
  --color-hormigon: #F2EFE9;  --color-cobre: #D98A4F;
  --color-cobre-profundo: #C0703A; --color-blueprint: #4C7DF0;
  --color-disponible: #2FA26E; --color-reservado: #E3A63C; --color-vendido: #D65454;
  --font-display: var(--font-space-grotesk), system-ui, sans-serif;
  --font-text: var(--font-inter), system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;
}
```
```javascript
// apps/web/postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```
**Content detection:** Tailwind v4 auto-detects sources but respects `.gitignore` and won't scan outside the app by default. If cotizador components live in `packages/ui`, add `@source "../../../packages/ui/src";` to `globals.css` so their classes aren't purged.

### Pattern 7: next/font self-hosting (D-13)
```typescript
// apps/web/app/layout.tsx
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const text = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
// <html className={`${display.variable} ${text.variable} ${mono.variable}`} lang="es-AR">
```
All three are on Google Fonts (brand-book §Tipografía) and get self-hosted at build (no runtime fetch, no FOUT, `size-adjust` prevents layout shift).

### Anti-Patterns to Avoid
- **Co-batching quotes with other procedures** → nginx `limit_req` misses them → QUOTE-03 protection silently bypassed. Use `splitLink` (Pattern 1).
- **`toLocaleString`/`Intl` currency style in the browser for money** → hydration mismatch + `$`-vs-`US$` drift. Use `formatUsd`/`formatArs` from `@imbau/quoting` (already deterministic, UI-06).
- **Re-running the engine per surface / recomputing the WhatsApp text by hand** → screen vs message drift. Use `toWhatsAppText(result)` on the same `QuoteResult`.
- **Firing `quotes.create` on navigation/recompute** → write-amplifier + spurious snapshots. `create` fires **only** on the CTA (D-06).
- **Free anticipo/plazo inputs** → Out of Scope; only `paymentPlanId` crosses the boundary.
- **`<link>` to Google Fonts / render-blocking CSS** → busts the <3s-4G budget. Use `next/font`.
- **Rendering the WhatsApp CTA when `project.whatsapp` is null** → dead button (violates D-02).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| es-AR money strings | custom `Intl`/regex formatter | `formatUsd`/`formatArs` (`@imbau/quoting`) | Server/client determinism + `US$`/`$` labels already solved; a re-impl reintroduces the 1000× peso-misread bug (UI-06) |
| WhatsApp message body | inline string of amounts | `toWhatsAppText(result)` | One `QuoteResult` → identical UI/PDF/WhatsApp; copy is tunable without ENGINE bump |
| Contado-vs-financiado savings | subtract prices in the component | `compareQuotes(contado, financiado)` | `ahorroUsd`/`ahorroPct` are derived (never floats) in the engine |
| Any quote arithmetic | anticipo/cuota/refuerzo math in JSX | `quotes.compute` server-side | The engine is the single source of truth; the client only renders `QuoteResult` |
| Anon published reads | raw SQL / client `where estado='publicado'` | `publicProcedure` + `withAnon` (clone `listPublished`) | The RLS anon policy does the filtering; app-layer filters are a footgun |
| Slider keyboard/ARIA | custom drag handlers | native `<input type=range>` (snap by index) or `@radix-ui/react-slider` | a11y + touch + keyboard for free |
| URL/deep-link state | manual `history.pushState` parsing | Next `useSearchParams` / `useRouter` | Shareable params done right, SSR-safe |

**Key insight:** fases 4–5 deliberately front-loaded all the hard correctness into `packages/quoting` and the `quotes` router so that *this* phase is a pure presentation layer. The single largest risk is a task re-implementing formatting or math on the client "for convenience" and breaking the server==client guarantee.

## Runtime State Inventory

> Applies because this phase adds a column + new seed value (a small migration/data change).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `projects` table has **no** `whatsapp` column today (verified: not in `packages/db/src/schema/projects.ts`). Brokers already have `whatsapp` (migration `0002_domain.sql`) — **do not confuse the two** (seed `content-rows.ts:71` `whatsapp` is the *broker* field). | New additive migration `0004_*.sql`: `ALTER TABLE projects ADD COLUMN whatsapp text` (nullable). `drizzle-kit generate` — never hand-edit SQL. |
| Live service config | nginx `location ^~ /api/trpc/quotes` already applied + tested on the VPS (STATE.md). No change; but the client link split (Pattern 1) is what keeps requests inside it. | None — but verify the split preserves the path prefix. |
| OS-registered state | None — no scheduler/daemon touches this phase. | None. |
| Secrets/env vars | `apps/web/env.ts` already validates `DATABASE_ANON_URL`/`DATABASE_APP_URL` (fase 5). The tRPC client is browser-side and needs no new secret; the CTA number comes from DB, not env. | None. |
| Build artifacts | `apps/web` gains Tailwind/PostCSS + `next/font` → new build inputs. Staging still runs the pre-fase-5 web image (`a599bb7`); this phase's UAT depends on PR #1 → main landing the fase-5 quotes route + this UI. | Ensure the merge/deploy ordering is in the plan; rebuild the web image. |

**Seed action (D-01):** the project seed object (`content.ts:16` `project: { nombre, slug }`) currently has **no** `whatsapp`. Add a number to it so demo/staging always render the CTA (D-02). The anon `projects` policy is table-level SELECT, so the new column is readable by anon automatically — no policy change (matches `projects_anon_published`).

## Common Pitfalls

### Pitfall 1: quotes escape the nginx rate-limit via co-batching
**What goes wrong:** quotes.compute gets batched with a non-quotes procedure; the HTTP path no longer starts `/api/trpc/quotes`; nginx `limit_req` never sees it; QUOTE-03 protection is silently void.
**Why it happens:** `httpBatchLink` derives the URL path from the comma-joined procedure names in a batch.
**How to avoid:** `splitLink` with a dedicated `httpBatchLink` for `op.path.startsWith("quotes.")` (Pattern 1).
**Warning signs:** DevTools shows a request to `/api/trpc/projects.x,quotes.compute`. Test: hammer the simulator and confirm 429s appear (fase-5 UAT proved 429 on the box).

### Pitfall 2: out-of-order compute responses (mutation, not query)
**What goes wrong:** fast slider drags fire overlapping computes; a late response overwrites the value for the newer selection.
**Why it happens:** `compute` is a tRPC `.mutation`; TanStack Query neither dedupes nor cancels mutations.
**How to avoid:** debounce (~150–250ms) + a monotonic sequence ref that drops stale responses (Pattern 3).
**Warning signs:** the number "flickers" back to a previous plan after you stop dragging.

### Pitfall 3: hydration mismatch on money strings
**What goes wrong:** a number rendered server-side differs from the client render → React hydration warning + visible flip.
**Why it happens:** `Intl` currency style emits a narrow no-break space (U+202F) and ICU-version-dependent symbols (documented in `format.ts` header).
**How to avoid:** use only `formatUsd`/`formatArs`; never `toLocaleString`/`Intl.NumberFormat({style:'currency'})` in components.
**Warning signs:** console hydration warning mentioning a text node with `$`/`US$`.

### Pitfall 4: 429 not tolerated in the UI
**What goes wrong:** a burst hits the rate limit and the simulator shows a raw error or blank result.
**Why it happens:** the edge returns 429 (`limit_req_status 429`) under burst; the client must expect it (fase-5 note).
**How to avoid:** map the tRPC error to a soft es-AR message + auto-retry/backoff; never surface a stack. Read `error.data.quoteErrorCode` for engine-domain errors (already wired in `errorFormatter`, `init.ts`).
**Warning signs:** an unhandled TRPCClientError with `data.httpStatus === 429`.

### Pitfall 5: Tailwind purges `packages/ui` classes
**What goes wrong:** cotizador components in `packages/ui` render unstyled in prod (classes stripped).
**Why it happens:** v4 auto-detection doesn't scan outside the app / into ignored paths by default.
**How to avoid:** add `@source "../../../packages/ui/src";` to `globals.css`, or keep cotizador components inside `apps/web`.
**Warning signs:** styled in dev, unstyled after `next build`.

### Pitfall 6: `useSearchParams` without a Suspense boundary
**What goes wrong:** Next 16 build/runtime error or full-page CSR bailout when `useSearchParams` is used in a client component that isn't wrapped in `<Suspense>`.
**Why it happens:** App Router requires a Suspense boundary around `useSearchParams` on statically-analyzable routes.
**How to avoid:** wrap the client island in `<Suspense>` (the RSC page is `force-dynamic` anyway; still wrap the param-reading client subtree).
**Warning signs:** build warning about `useSearchParams()` should be wrapped in a suspense boundary.

## Code Examples

### Anon picker reads (clone of `listPublished`, `projects.ts`)
```typescript
// packages/api/src/trpc/routers/picker.ts  (or extend projects.ts)
// Imports ONLY withAnon/schema (fence T-03-09). Anon RLS policies already restrict
// floors/units/payment_plans to published projects (see units.ts / floors.ts / payment-plans.ts).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAnon, schema } from "@imbau/db";
import { router, publicProcedure } from "../init";

export const pickerRouter = router({
  getPublishedProject: publicProcedure.input(z.object({ slug: z.string() })).query(({ input }) =>
    withAnon((tx) =>
      tx.select({ id: schema.projects.id, nombre: schema.projects.nombre,
                  whatsapp: schema.projects.whatsapp })            // NEW column
        .from(schema.projects).where(eq(schema.projects.slug, input.slug)).limit(1))),
  listFloors: publicProcedure.input(z.object({ projectId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.floors).where(eq(schema.floors.projectId, input.projectId)))),
  listUnits: publicProcedure.input(z.object({ floorId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.units).where(eq(schema.units.floorId, input.floorId)))),
  listPlans: publicProcedure.input(z.object({ projectId: z.uuid() })).query(({ input }) =>
    withAnon((tx) => tx.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.projectId, input.projectId)))),
});
```
Only `disponible` units are cotizable (D-08) — filter/label in the picker; `reservado`/`vendido` shown but not selectable, using the semantic tokens.

### projects.whatsapp column (additive, RLS-forced table)
```typescript
// packages/db/src/schema/projects.ts — add inside the columns object
whatsapp: text("whatsapp"),   // nullable; broker routing overrides later (WA-01 slot). No policy change.
```
Then `pnpm --filter @imbau/db exec drizzle-kit generate` → review `0004_*.sql` → migrate. No new `pgPolicy`: the existing `projects_anon_published` (table-level SELECT) already exposes the new column to anon.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` + `@tailwind base/components/utilities` | CSS-first `@import "tailwindcss"` + `@theme` in CSS | Tailwind v4 (2025) | No JS config file; tokens map directly in `globals.css` (D-10) |
| `tailwindcss` as a PostCSS plugin + `autoprefixer` | `@tailwindcss/postcss` (single plugin, autoprefix built in) | Tailwind v4 | `postcss.config.mjs` has one plugin |
| tRPC v10 `@trpc/react-query` + React Query v4 | v11 `@trpc/tanstack-react-query` + `useTRPC()` proxy + RQ v5 | tRPC v11 | Already the panel's pattern; clone it |
| `<link>` Google Fonts | `next/font` self-host at build | Next 13+ | Zero layout shift, no runtime fetch (D-13) |

**Deprecated/outdated:**
- `@trpc/react-query` (v10 style) — replaced by `@trpc/tanstack-react-query` (v11).
- React Query v4 with tRPC v11 — breaks (CLAUDE.md "What NOT to Use").
- `autoprefixer`/`postcss-import` as separate deps for Tailwind — folded into `@tailwindcss/postcss`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Native `<input type=range>` with index-snap is sufficient for the mockup slider fidelity (Radix optional) | Standard Stack / Pattern 4 | LOW — if design rejects it, add `@radix-ui/react-slider@1.4.2` (already vetted); no architectural change |
| A2 | The nginx path-match concern is fully addressed by `splitLink` keeping quotes in their own batch (path stays `/api/trpc/quotes.*`) | Pattern 1 / Pitfall 1 | MEDIUM — must be verified with a live 429 test on staging (fase-5 UAT recipe exists); a non-batching `httpLink` is the fallback that also guarantees the path |
| A3 | The project seed object needs a `whatsapp` value added (it currently has none; only brokers do) | Runtime State Inventory | LOW — verified by reading `content.ts`; if a project number already existed the migration/seed edit is simpler, not harder |
| A4 | The debounce window ~150–250ms keeps request volume comfortably under `10r/s + burst 20` for discrete presets | Pattern 3 / D-05 | LOW — presets are discrete so change events are sparse; tune if 429s appear in UAT |

**Confirmation needed before locking:** A2 is the one to validate empirically (it protects QUOTE-03). Everything else is low-risk.

## Open Questions

1. **Where do cotizador components live — `apps/web/components` or `packages/ui`?**
   - What we know: D-10 says `packages/ui` "deja de ser placeholder"; tokens belong there. CONTEXT leaves component location to Claude's Discretion.
   - What's unclear: whether the *interactive* islands (which need `"use client"` + tRPC) should sit in `packages/ui` or stay in the app.
   - Recommendation: put **tokens + presentational primitives** (cards, slider, badges) in `packages/ui`; keep **stateful islands** (simulator, picker with tRPC) in `apps/web`. Add `@source` for the ui path (Pitfall 5).

2. **Preselected plan when landing without `?plan=` (D, Claude's Discretion).**
   - Recommendation: default to the first `payment_plans` row sorted by `anticipoPct` (or a `orden` if present), and default modalidad to `financiado` (the differentiator). Contado always shown alongside via the comparison.

3. **PDF button in this phase (D-12).**
   - Recommendation: render it visually (mockup fidelity) but **disabled** with a soft "Próximamente" affordance — no wiring (fase 7 owns it).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | build/dev | ✓ (nvm) | 22.x | — |
| pnpm | workspace | ✓ | 11.6.0 (pinned) | — |
| Postgres 16 + Redis | anon reads / compute in dev | ✓ (Compose, per MEMORY) | 16 | — |
| Seeded "Brigos Recoleta" | picker/compute live data | ✓ | — | `pnpm db:seed` |
| Staging quotes route | UAT | ✗ until PR #1 → main | — | Merge PR #1 first (STATE.md) |

**Missing dependencies with no fallback:** staging UAT is blocked until PR #1 (fase-5 quotes route) merges to `main` — sequence this in the plan.
**Missing dependencies with fallback:** none for local dev.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.8` (unit) + Playwright `@playwright/test 1.60.0` (e2e) |
| Config file | Vitest per-package; Playwright in `apps/panel` today — **new Playwright setup needed for `apps/web`** (Wave 0) |
| Quick run command | `pnpm --filter @imbau/web test` |
| Full suite command | `pnpm test` (turbo) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | deep-link `?u=&plan=` renders result; no-params opens picker | e2e | `pnpm --filter @imbau/web test:e2e -g "deep-link"` | ❌ Wave 0 |
| UI-01 | picker piso→unidad, only `disponible` selectable | e2e | `... -g "picker"` | ❌ Wave 0 |
| UI-02 | mobile result shows precio/anticipo/cuotas/1ª cuota ARS/refuerzos/totales | e2e (snapshot) | `... -g "resultado"` | ❌ Wave 0 |
| UI-03 | contado vs financiado side-by-side (two engine runs) | e2e | `... -g "comparacion"` | ❌ Wave 0 |
| UI-04 | slider snaps to preset planIds only; single plan → fixed | unit (map fn) + e2e | `pnpm --filter @imbau/web test -t "snap"` | ❌ Wave 0 |
| UI-05 | `notasLegales` + "no vinculante" visible | e2e | `... -g "leyenda"` | ❌ Wave 0 |
| UI-06 | amounts es-AR, server==client (`US$`/`$`) | unit | covered by `@imbau/quoting` format tests (exist) + a render assertion | ✅ (engine) / ❌ render |
| WA-01 | CTA builds `wa.me/<digits>?text=` from `QuoteResult`; hidden if no number | unit (URL builder) + e2e | `pnpm --filter @imbau/web test -t "whatsapp"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/web test` (unit: URL builder, plan-snap map, format render)
- **Per wave merge:** `pnpm --filter @imbau/web test:e2e` (picker + deep-link + CTA flows)
- **Phase gate:** full `pnpm test` green + Lighthouse budget (D-13) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/web` Playwright config + `test:e2e` script (panel has it; web does not)
- [ ] `apps/web/vitest` setup for component/unit tests (JSDOM/RTL or vitest browser mode)
- [ ] Unit test files: wa.me URL builder, plan→slider-index map, money render assertion
- [ ] e2e specs: picker flow, deep-link, comparison render, CTA opens wa.me, 429 tolerance (Pitfall 4)
- [ ] Lighthouse/perf check wiring for the <3s-4G budget (D-13) — may be a manual UAT step if CI budget isn't ready

## Security Domain

`security_enforcement: true`, ASVS L1. This surface is **anonymous public** (no auth), so V2/V3/V4 mostly N/A; V5 (input validation) and V7 (error handling) are the live concerns.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | anon-only surface (no login) |
| V3 Session Management | no | no session on web public |
| V4 Access Control | yes (server-side) | RLS anon policies filter to `publicado`; org resolved server-side (`quotes.ts`), never from client |
| V5 Input Validation | **yes** | URL params + tRPC inputs validated as `z.uuid()`/enum at the boundary (already in `quoteInputSchema`); validate `?u`/`?plan` before calling |
| V6 Cryptography | no | no secrets handled client-side |
| V7 Error Handling | **yes** | `errorFormatter` surfaces `quoteErrorCode` only; no stack/PII leaks (init.ts); map 429 to soft copy |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reflected XSS via `?u`/`?plan` or wa-preview text | Tampering | React auto-escapes; validate params as uuid; never `dangerouslySetInnerHTML` |
| Open redirect via WhatsApp link | Tampering | URL host is a fixed literal `https://wa.me/`; only digits from `project.whatsapp` are interpolated |
| Rate-limit bypass (compute spam) | DoS | nginx `limit_req` at edge — **only works if the dedicated-link path prefix holds** (Pitfall 1); UI tolerates 429 |
| Tenant/price tampering via client inputs | Tampering/Info-disclosure | org/prices/CAC resolved server-side under RLS (`resolveAndQuote`); client sends only IDs+modalidad |
| Enumerating unpublished units via picker | Info-disclosure | anon RLS policies already gate every read to `estado='publicado'` (units/floors/plans schemas verified) |

## Sources

### Primary (HIGH confidence)
- Codebase (read this session): `apps/panel/lib/trpc-client.tsx`, `apps/web/app/{page,layout}.tsx` + `api/trpc/[trpc]/route.ts`, `packages/api/src/trpc/{init.ts,routers/quotes.ts,routers/projects.ts}`, `packages/quoting/src/{index,types,serialize,format}.ts`, `packages/db/src/schema/{projects,floors,units,payment-plans}.ts`, `packages/db/src/seed/{content,content-rows}.ts`, `docs/{mockup.html,marca/brand-book.md,marca/tokens.css}` — the authoritative contracts this phase consumes.
- `npm view` 2026-07-04 — `tailwindcss@4.3.2`, `@tailwindcss/postcss@4.3.2`, `@trpc/client@11.18.0` (pin 11.17.0 to match server), `@tanstack/react-query@5.101.0`, `@radix-ui/react-slider@1.4.2`.
- CLAUDE.md Technology Stack + STATE.md/CONTEXT.md decisions — locked stack + fase-5 rate-limit/dedicated-link rationale.

### Secondary (MEDIUM confidence)
- [Tailwind CSS — Install with Next.js](https://tailwindcss.com/docs/guides/nextjs) + [Tailwind v4 blog](https://tailwindcss.com/blog/tailwindcss-v4) — `@tailwindcss/postcss`, `@import "tailwindcss"`, `@theme` CSS-first config.
- [Next.js — CSS / Fonts docs](https://nextjs.org/docs/app/getting-started/css) — `next/font`, `useSearchParams` Suspense requirement.

### Tertiary (LOW confidence)
- Package legitimacy seam `too-new` verdicts — noise from routine recent releases of high-volume official packages; overridden by download/repo evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package pinned by CLAUDE.md and verified on npm; two are already in the panel.
- Architecture: HIGH — the RSC→island, `withAnon` read, and tRPC-client patterns are cloned from existing, working code read this session.
- Pitfalls: HIGH — the two load-bearing ones (batch/nginx, mutation race) are grounded in the actual router definitions and STATE.md notes.
- Tailwind v4 setup: MEDIUM/HIGH — official docs confirm the CSS-first flow; exact `@source` need depends on final component location.

**Research date:** 2026-07-04
**Valid until:** 2026-08-03 (stable stack; refresh sooner only if Next 16 / Tailwind v4 minor bumps change the font/PostCSS wiring)
