---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
verified: 2026-07-05T19:35:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
behavior_unverified_items:
  - truth: "El comprador llega a cotizar una unidad sin el explorador — vía deep-link compartible por URL param + un picker mínimo piso→unidad sobre unidades publicadas (rol anon)."
    test: "Visitar /p/<slug>/cotizador sin params → picker de pisos aparece → seleccionar piso → unidades aparecen con badges de estado → seleccionar una disponible → la vista de resultado aparece y la URL lleva ?u="
    expected: "La URL se actualiza con ?u=<unitId>; la vista de resultado aparece (el picker desaparece). Un deep-link ?u=<id>&plan=<id> muestra la vista de resultado directamente sin pasar por el picker."
    why_human: "El flujo piso→unidad→resultado es una secuencia de transiciones de estado (floor selected → units fetched → unit picked → URL updated → result view rendered) que requiere un servidor Next.js corriendo con la DB seeded. Las e2e specs (picker.spec.ts) cubren exactamente esto pero no pueden re-ejecutarse en verificación sin levantar el stack."
  - truth: "En una pantalla mobile-first el comprador ve el resultado completo — precio USD, anticipo (USD + %), cuotas, primera cuota ARS 'al valor del mes', refuerzos y totales — con la comparación contado vs financiado lado a lado (dos corridas del mismo motor)."
    test: "Con un ?u=<id>&plan=<id> válido, verificar en viewport móvil y desktop que el resultado muestra todos los campos y que los dos quotes.compute (contado + financiado) se disparan y alimentan QuoteCards."
    expected: "En mobile (1 col): las dos tarjetas apiladas. En desktop (sm:): lado a lado. Todos los campos requeridos presentes con formato es-AR. El band de ahorro de compareQuotes visible."
    why_human: "El rendering efectivo en pantalla real (con datos del motor vía API) requiere el stack completo corriendo. El render test (jsdom) verifica el contenido dado un QuoteResult mockeado, pero la transición estado 'loading → result shown' usando datos reales del engine solo se ejerce en e2e."
  - truth: "Tocar 'Consultar por WhatsApp' abre wa.me con un resumen corto URL-encoded (del mismo QuoteResult) al número del proyecto, con el slot de routing por broker listo."
    test: "Con la DB seeded (Brigos Recoleta lleva +5491155551234), tap el CTA en la vista de resultado. Interceptar la navegación y verificar el target."
    expected: "La URL de destino es https://wa.me/5491155551234?text=<encoded> donde el texto decodificado contiene el header (unidad + proyecto), los montos de toWhatsAppText y el deep-link actual."
    why_human: "La navegación a wa.me es una transición de estado (click → window.location.href = url) que requiere el browser real con el app server corriendo. La e2e whatsapp-cta.spec.ts la cubre via route interception; no puede re-ejecutarse sin el servidor."
human_verification:
  - test: "Correr la suite e2e completa de apps/web"
    expected: "4/4 specs pasan: picker.spec.ts (2 tests), cotizador.spec.ts (1 test), whatsapp-cta.spec.ts (1 test)"
    why_human: "Las specs e2e ejercen el flujo completo del comprador contra la DB seeded real y el servidor Next.js; requieren `pnpm db:seed` contra el Compose dev DB y luego `pnpm --filter @imbau/web test:e2e`. El SUMMARY reporta 4/4 pero no puede re-verificarse sin el stack."
  - test: "Verificar el layout mobile-first en un viewport real"
    expected: "En móvil (<640px): las tarjetas contado/financiado se apilan verticalmente. En desktop (640px+): se muestran en dos columnas. Todos los montos usan la fuente JetBrains Mono (font-mono) y el fondo grafito con colores de marca."
    why_human: "La corrección del CSS responsive (grid-cols-1 sm:grid-cols-2) es verificable por código, pero el rendering visual con el brand theme (dark grafito, cobre accent, font tokens) requiere ojos humanos."
  - test: "Verificar que el CTA está ausente cuando el proyecto no tiene número de WhatsApp"
    expected: "El botón 'Consultar por WhatsApp' no se renderiza cuando project.whatsapp es null o vacío (la guardia showCta = whatsappDigits !== '' en el simulator)."
    why_human: "La guardia está verificada por código pero el comportamiento visual en un proyecto sin número requiere prueba manual o un test e2e adicional con un proyecto sin número."
---

# Phase 06: UI pública del cotizador + CTA WhatsApp — Verification Report

**Phase Goal:** Un comprador llega a una unidad publicada sin el explorador, cotiza en el celular y ve el resultado completo en pantalla (contado vs financiado, primera cuota ARS, refuerzos, totales, leyenda de ajuste CAC + no vinculante), con un CTA que abre WhatsApp con la cotización precargada — todo derivado del mismo QuoteResult, con formato es-AR consistente entre server y cliente.
**Verified:** 2026-07-05T19:35:00Z
**Status:** passed — closed by orchestrator re-verification (fresh independent e2e run, 4/4; see "Orchestrator Re-Verification" below)
**Re-verification:** Initial verification + same-day orchestrator e2e closure

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (UI-01) | El comprador llega a cotizar una unidad sin el explorador — vía deep-link compartible por URL param + un picker mínimo piso→unidad sobre unidades publicadas (rol anon). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Artifacts wired: RSC page force-dynamic, picker.getPublishedProject, Picker component with disponible-only selectability, useSearchParams deep-link. Runtime picker flow (floor→unit→URL update) is a state transition requiring a live server. E2e picker.spec.ts exists (verified 4/4 per SUMMARY). |
| 2 (UI-02, UI-03) | En una pantalla mobile-first el comprador ve el resultado completo — precio USD, anticipo (USD + %), cuotas, primera cuota ARS, refuerzos y totales — con la comparación contado vs financiado lado a lado (dos corridas del mismo motor). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | QuoteCards renders all required fields (verified by jsdom render tests — 6 assertions, 26/26 pass). Simulator runs two computes (contado + financiado) via parallel mutateAsync. Mobile-first CSS (`grid-cols-1 sm:grid-cols-2`) verified in code. Live compute state transition (loading→result) requires running server. |
| 3 (UI-04, UI-05, UI-06) | El comprador ajusta anticipo/plazo solo dentro de los planes preset y bounds autorizados (nunca términos libres), con la leyenda de ajuste CAC + "cotización no vinculante" visible y montos es-AR consistentes entre server y cliente. | ✓ VERIFIED | PlanSlider snaps to integer indices only (code verified). formatUsd/formatArs exclusively (grep clean: no toLocaleString, no Intl.NumberFormat in UI files). "Cotización no vinculante" and notasLegales rendered (render test asserts text presence). Render tests 26/26 green. |
| 4 (WA-01) | Tocar "Consultar por WhatsApp" abre wa.me con un resumen corto URL-encoded (del mismo QuoteResult) al número del proyecto, con el slot de routing por broker listo. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | buildWhatsappUrl verified: fixed https://wa.me/ host, digits-only strip, null when absent (unit test passes). quotes.create only in onWhatsapp handler (code inspection). CTA hidden via showCta guard when project.whatsapp is null. CTA navigation (state transition: click→window.location.href) requires live browser. E2e whatsapp-cta.spec.ts exists. |

**Score:** 4/4 truths verified (SC1/SC2/SC4 closed by fresh independent e2e run — see Orchestrator Re-Verification)
**behavior_unverified:** 0

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/projects.ts` | whatsapp nullable text column, exactly 2 pgPolicy | ✓ VERIFIED | `whatsapp: text("whatsapp")` at line 34; grep -c 'pgPolicy(' returns 2 |
| `packages/db/migrations/0004_project_whatsapp.sql` | Additive ADD COLUMN, drizzle-kit generated | ✓ VERIFIED | Body: `ALTER TABLE "projects" ADD COLUMN "whatsapp" text;` — single additive statement |
| `packages/db/seed.ts` | Brigos Recoleta carries whatsapp, onConflictDoNothing preserved | ✓ VERIFIED | `whatsapp: "+5491155551234"` at line 113; onConflictDoNothing present |
| `apps/web/app/globals.css` | @import tailwindcss + @theme brand tokens | ✓ VERIFIED | `@import "tailwindcss"` + `@theme { --color-grafito: #14181e; … --font-mono: … }` |
| `apps/web/postcss.config.mjs` | @tailwindcss/postcss plugin only | ✓ VERIFIED | `export default { plugins: { "@tailwindcss/postcss": {} } }` |
| `apps/web/lib/trpc-client.tsx` | splitLink gated on isQuotesOp | ✓ VERIFIED | `splitLink({ condition: (op) => isQuotesOp(op.path) … })` present; re-exports from trpc-split.ts |
| `apps/web/lib/trpc-split.ts` | Pure isQuotesOp predicate | ✓ VERIFIED | JSX-free module; unit test asserts true for quotes.* and false for picker.*/projects.* |
| `apps/web/app/layout.tsx` | next/font Space Grotesk/Inter/JetBrains Mono, no Google Fonts link, dark grafito body | ✓ VERIFIED | Imports from next/font/google; no fonts.googleapis.com reference; `<body className="bg-grafito text-hormigon font-text">` |
| `apps/web/vitest.config.ts` | Excludes e2e/**, jsdom env, self-contained | ✓ VERIFIED | `environment: "jsdom"`, `exclude: [...configDefaults.exclude, "e2e/**"]` |
| `apps/web/playwright.config.ts` | testDir ./e2e, port 3110 (not 3000/3001) | ✓ VERIFIED | `const PORT = Number(process.env.WEB_E2E_PORT ?? 3110)` |
| `packages/api/src/trpc/routers/picker.ts` | 4 anon reads via withAnon, whatsapp selected, fence clean | ✓ VERIFIED | Imports only `{ withAnon, schema }`; getPublishedProject/listFloors/listUnits/listPlans all present; no createOwnerDb/appDb/estado literal |
| `packages/api/src/trpc/routers/_app.ts` | picker: pickerRouter mounted | ✓ VERIFIED | `picker: pickerRouter` in router composition |
| `packages/api/tests/picker-router.test.ts` | Integration test: anon caller sees published rows only, whatsapp + notasLegales present | ✓ VERIFIED | 5 assertions; all pass (26/26 API suite green) |
| `apps/web/lib/whatsapp.ts` | buildWhatsappUrl: fixed host, digits-only, null when absent | ✓ VERIFIED | `return 'https://wa.me/${digits}?text=${text}'`; returns null when absent; unit test passes |
| `apps/web/lib/plan-snap.ts` | sortPlans/planToIndex/indexToPlan/isSingle | ✓ VERIFIED | Exports verified; plan-snap unit tests pass |
| `apps/web/components/quote-cards.tsx` | Renders all fields via formatUsd/formatArs, no toLocaleString/Intl, leyendas present | ✓ VERIFIED | Render test 6 assertions pass; grep clean for toLocaleString/Intl.NumberFormat |
| `apps/web/components/plan-slider.tsx` | Native range, step=1, max=plans.length-1, disabled when single | ✓ VERIFIED | `type="range"`, `max={Math.max(0, plans.length - 1)}`, `disabled={single}` |
| `apps/web/app/p/[slug]/cotizador/page.tsx` | force-dynamic, anon picker reads, TRPCReactProvider, Suspense | ✓ VERIFIED | All 4 verified in code; `export const dynamic = "force-dynamic"` |
| `apps/web/components/picker.tsx` | "use client", listUnits via tRPC, disponible-only selectable | ✓ VERIFIED | All 3 verified in code |
| `apps/web/components/cotizador-simulator.tsx` | "use client", useSearchParams, two computes, monotonic seqRef, 429 → soft message, create only in CTA, showCta guard | ✓ VERIFIED (code) | All structural elements present in code; state-transition behaviors are PRESENT_BEHAVIOR_UNVERIFIED |
| `apps/web/e2e/picker.spec.ts` | UI-01: picker flow + deep-link | ✓ VERIFIED (exists, 4/4 per SUMMARY) | Substantive assertions; 4 tests listed by playwright --list |
| `apps/web/e2e/cotizador.spec.ts` | UI-02..06: result render, es-AR, slider, leyenda | ✓ VERIFIED (exists, 4/4 per SUMMARY) | Substantive assertions including `US$` regex and "no vinculante" |
| `apps/web/e2e/whatsapp-cta.spec.ts` | WA-01: CTA target, PDF disabled | ✓ VERIFIED (exists, 4/4 per SUMMARY) | Route interceptor pattern; asserts `https://wa.me/<digits>` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/web/lib/trpc-client.tsx` | `/api/trpc/quotes.*` (nginx limit_req) | splitLink with isQuotesOp predicate | ✓ WIRED | Unit test verifies quotes.* → true, picker.*/projects.* → false |
| `apps/web/app/p/[slug]/cotizador/page.tsx` | `packages/api/src/trpc/routers/picker.ts` | createCaller → picker.getPublishedProject/listFloors/listPlans | ✓ WIRED | Code verified; project+floors+plans passed as island props |
| `apps/web/components/cotizador-simulator.tsx` | `quotes.compute` / `quotes.create` | useTRPC() → trpc.quotes.{compute,create}.mutationOptions() | ✓ WIRED | Code verified; two parallel computes per change; create only in onWhatsapp |
| `apps/web/components/cotizador-simulator.tsx` | `apps/web/lib/whatsapp.ts` | buildWhatsappUrl on CTA success | ✓ WIRED | `buildWhatsappUrl({ whatsapp: project.whatsapp, … result, deepLinkUrl })` |
| `apps/web/components/quote-cards.tsx` | `@imbau/quoting` | formatUsd/formatArs/compareQuotes | ✓ WIRED | Code + render tests; grep clean (no toLocaleString/Intl) |
| `apps/web/components/picker.tsx` | `packages/api/src/trpc/routers/picker.ts` | useTRPC → picker.listUnits | ✓ WIRED | `trpc.picker.listUnits.queryOptions({ floorId })` |
| `packages/db/migrations/0004_project_whatsapp.sql` | `packages/db/src/schema/projects.ts` | drizzle-kit generated; applied to dev DB | ✓ WIRED | Single additive ADD COLUMN; journal updated |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `quote-cards.tsx` | `contado`/`financiado` props (ContadoResult/FinanciadoResult) | quotes.compute via simulator → passed as props | Yes — engine computations from real unit+plan data | ✓ FLOWING (code) / ⚠️ requires live server for end-to-end |
| `picker.tsx` | `units` (listUnits query) | trpc.picker.listUnits → DB via withAnon | Yes — real Postgres rows via RLS | ✓ FLOWING (integration test proves real data) |
| `page.tsx` | `project`, `floors`, `plans` | picker.getPublishedProject/listFloors/listPlans (withAnon) | Yes — real DB via anon RLS | ✓ FLOWING (integration test proves real data) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Web unit tests: splitLink predicate, wa.me builder, plan-snap, quote-cards render, leyenda | `pnpm --filter @imbau/web test --run` | 5 files, 26 tests PASS | ✓ PASS |
| API integration: picker router anon reads (published-only, whatsapp, notasLegales) | `pnpm --filter @imbau/api test -- picker-router` (with DB env) | 26 tests PASS (includes 5 picker assertions) | ✓ PASS |
| E2e spec enumeration | `playwright test --list` | 4 tests in 3 files listed | ✓ (exists; cannot run without live server) |
| No toLocaleString/Intl in UI files | grep across apps/web/lib/ and apps/web/components/ | 0 matches | ✓ PASS |
| No TBD/FIXME/XXX debt markers in phase files | grep across all modified files | 0 matches | ✓ PASS |
| All commits from SUMMARY exist in git | git log --oneline | All 19 commits verified | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UI-01 | 06-03, 06-05, 06-06 | Deep-link + picker piso→unidad (anon) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | RSC page + picker exist and are wired; e2e tests cover runtime flow (SUMMARY: 4/4 pass) |
| UI-02 | 06-04, 06-05, 06-06 | Resultado mobile-first: precio/anticipo/cuotas/primera cuota ARS/refuerzos/totales | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | QuoteCards render test verifies all fields; live compute requires server |
| UI-03 | 06-04, 06-05, 06-06 | Comparación contado vs financiado (dos corridas del motor) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Render test verifies savings band; simulator fires two mutateAsync calls (code) |
| UI-04 | 06-04, 06-05, 06-06 | Ajuste preset-only (nunca términos libres) | ✓ SATISFIED | PlanSlider snaps to planId index; no free term emitted (code + plan-snap unit tests) |
| UI-05 | 06-03, 06-04, 06-05, 06-06 | Leyenda CAC + "cotización no vinculante" visible | ✓ SATISFIED | Render test asserts both texts present; listPlans carries notasLegales (integration test) |
| UI-06 | 06-02, 06-04, 06-06 | Montos es-AR consistentes server/cliente (formatUsd/formatArs) | ✓ SATISFIED | Render test uses real formatter output; grep clean (no toLocaleString/Intl in UI) |
| WA-01 | 06-01, 06-03, 06-04, 06-05, 06-06 | WhatsApp CTA con resumen URL-encoded del QuoteResult | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | URL builder verified (unit test); CTA navigation requires live browser (e2e covers it) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/components/cotizador-simulator.tsx` | 304 | "placeholder" comment (PDF button) | ℹ️ Info | Intentional — PDF wiring explicitly deferred to fase 7 (D-12), documented in plan and SUMMARY. Not a blocker. |

No debt markers (TBD/FIXME/XXX), no toLocaleString/Intl.NumberFormat in UI files, no empty return stubs.

## Orchestrator Re-Verification (2026-07-05)

The three PRESENT_BEHAVIOR_UNVERIFIED items (SC1, SC2, SC4) shared a single closing condition stated by the verifier: a fresh, independent run of the apps/web e2e suite against the merged tree with the seeded dev DB. The orchestrator executed it immediately after verification:

```
$ pnpm --filter @imbau/web test:e2e   # Node 22, Compose Postgres up, seeded dev DB, port 3110
✓ [chromium] e2e/cotizador.spec.ts — result, comparison, es-AR amounts, slider, leyenda (UI-02..06)
✓ [chromium] e2e/picker.spec.ts — picker: floor→unit, only disponible selectable, reaches result with ?u (UI-01)
✓ [chromium] e2e/picker.spec.ts — deep-link: ?u=&plan= renders the result view directly, no picker (UI-01)
✓ [chromium] e2e/whatsapp-cta.spec.ts — CTA opens a pre-filled wa.me URL; PDF button disabled (WA-01)
4 passed (13.2s)
```

- **SC1 (UI-01):** picker flow + deep-link exercised live → VERIFIED.
- **SC2 (UI-02/UI-03):** live double compute populating the full result view exercised → VERIFIED.
- **SC4 (WA-01):** CTA navigation to `https://wa.me/<digits>?text=` intercepted and asserted live → VERIFIED.
- **CTA-absent-when-no-number** (human_verification item 3): closed at the unit level — `buildWhatsappUrl` returns `null` for null/empty/digit-less numbers (`apps/web/lib/whatsapp.test.ts`) and the `showCta = whatsappDigits !== ""` guard (`cotizador-simulator.tsx:228-229`) is trivially code-verified.

**Remaining (non-blocking, tracked in 06-UAT.md):** the purely visual pass — brand theme (grafito/cobre, JetBrains Mono figures) and mobile card stacking on a real viewport. This requires human eyes; run `/gsd-verify-work 6`.

### Prohibitions Verification

All plan prohibitions are satisfied:

| Prohibition | Evidence |
|-------------|----------|
| No new pgPolicy on projects.whatsapp | grep -c 'pgPolicy(' projects.ts → 2 (unchanged) |
| Migration is drizzle-kit generated (not hand-edited) | Single additive ADD COLUMN; no backfill; meta/_journal.json updated by tool |
| No tailwind.config.* in apps/web | ls tailwind.config.* → no matches |
| No Google Fonts network link in layout | grep shows no fonts.googleapis.com; next/font self-hosts at build |
| No toLocaleString/Intl.NumberFormat in UI | grep across apps/web/lib/ + apps/web/components/ → 0 matches |
| WhatsApp URL host is fixed https://wa.me/ literal | `return 'https://wa.me/${digits}?text=${text}'` — only digits variable |
| Slider never emits free anticipo/plazo | onChange maps integer index → plans[i].id via plan-snap; no free term |
| picker.ts imports only withAnon/schema | Import fence verified by grep; no createOwnerDb/appDb/createAppDb |
| No app-layer estado/publicado filter in picker queries | grep on picker.ts → 0 matches for estado/publicado literal |
| quotes.create only in CTA handler | Code: `create.mutateAsync` appears only inside `onWhatsapp` callback |

### Human Verification Required

#### 1. End-to-End Buyer Flow (UI-01 + WA-01)

**Test:** Run `pnpm --filter @imbau/web test:e2e` (requires `pnpm db:seed` against Compose dev DB). Or manually:
- Visit `/p/brigos-recoleta/cotizador` (no params) → verify picker shows floors
- Select any floor → verify units show with Disponible/Reservado/Vendido badges
- Verify a reservado/vendido unit is not clickable; a disponible unit is
- Click a disponible unit → verify result view appears and URL gains `?u=<unitId>`
- Visit `/p/brigos-recoleta/cotizador?u=<unitId>&plan=<planId>` directly → verify result view with no picker step

**Expected:** The picker flow and deep-link both reach the result view. Reservado/vendido units are visually disabled. The URL is shareable.

**Why human:** State transitions (click → floor units fetched → unit selected → URL updated) require a running Next.js server.

#### 2. Result View Content + Mobile-First Layout (UI-02 + UI-03)

**Test:** With a deep-linked result view, on both a mobile viewport (≤375px) and desktop (≥768px), verify:
- Financiado card shows: precio USD, anticipo (USD + %), cuotas count, primera cuota ARS "al valor del mes", refuerzos schedule, total
- Contado card shows: precio USD
- Both cards visible, with a savings band below (ahorro USD + %)
- Mobile: cards stacked. Desktop: side by side (two columns)
- All amounts use `US$ ` prefix (USD) or `$ ` prefix (ARS) with dot-thousands and comma-decimals (es-AR)

**Expected:** Full result visible, no raw Intl currency formatting (no "U+202F narrow no-break space" tells), responsive layout correct.

**Why human:** Mobile-first visual rendering (responsive CSS, font rendering, brand tokens applied) requires a browser. The live compute that populates the data requires the API server.

#### 3. WhatsApp CTA Navigation (WA-01)

**Test:** From the result view with the seeded Brigos Recoleta project (+5491155551234), click "Consultar por WhatsApp" and inspect the navigation target.

**Expected:** The browser navigates (or the route is intercepted in e2e) to `https://wa.me/5491155551234?text=<encoded>` where the decoded text contains the unit/project header, the toWhatsAppText amounts, and the shareable deep-link URL. The PDF button renders as disabled "Próximamente".

**Why human:** The CTA navigation (`window.location.href = url`) is a state transition requiring a live browser session. The e2e whatsapp-cta.spec.ts verifies this via route interception — it must run against the seeded dev DB and the built Next.js server.

### Gaps Summary

No gaps found. All required artifacts exist, are substantive, and are wired. All prohibitions satisfied. All unit and integration tests pass (26/26 web, 26/26 API). The 3 PRESENT_BEHAVIOR_UNVERIFIED truths are items where the code and wiring are verified but the runtime state transitions require a live server to confirm. The e2e test suite (4 specs, 3 files) covers all three. The SUMMARY reports 4/4 passing locally.

**To close human_needed status:** Run `pnpm --filter @imbau/web test:e2e` against the seeded dev DB (see playwright.config.ts — webServer builds and starts the app on port 3110). If 4/4 pass on a fresh run, the phase gate is met.

---

_Verified: 2026-07-05T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
