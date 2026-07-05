# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Schema + Media + Seed (Fase 1)** — Phases 1-3 (shipped 2026-07-01) — [archivo](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Cotizador (Fase 3 del plan maestro)** — Phases 4-7 (en progreso) — numeración continúa desde v1.1

## Phases

<details>
<summary>✅ v1.0 Fundación (Fase 0) — Phases 1-4 — SHIPPED 2026-06-26 (archivado)</summary>

Monorepo + config compartida → data layer con RLS multi-tenant → auth/API/app surfaces → staging vivo con observabilidad y CI/CD. Cada merge a `main` deploya a `staging.tours.andescode.com.ar` con aislamiento de tenant verificado por tests de ausencia cross-tenant en CI contra Postgres real.

- [x] Phase 1: Monorepo Foundation (3/3 plans) — completed 2026-06-13
- [x] Phase 2: Data Layer + RLS (3/3 plans) — completed 2026-06-17
- [x] Phase 3: Auth, API & App Surfaces (5/5 plans) — completed 2026-06-18
- [x] Phase 4: Staging, Observability & CI/CD (7/7 plans) — completed 2026-06-26

Directorios archivados en `milestones/v1.0-phases/`. Full detail: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) · Requirements: [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)

</details>

<details>
<summary>✅ v1.1 Schema + Media + Seed (Fase 1) — Phases 1-3 — SHIPPED 2026-07-01 (archivado)</summary>

Modelo de datos completo de modelo-mvp §3.3 (13 tablas nuevas con RLS FORCE por tenant, events particionada por mes) → pipeline de media R2 + sharp (variantes AVIF/WebP srcset + blurhash, idempotente y observable) → seed determinista e idempotente de "Brigos Recoleta" (13 pisos, 38 unidades, pricing CAC, contenido y media procesada por el pipeline real). Numeración GSD reiniciada en Phase 1.

- [x] Phase 1: Schema completo + RLS (6/6 plans) — completed 2026-06-29
- [x] Phase 2: Pipeline de media (R2 + sharp + blurhash) (3/3 plans) — completed 2026-06-30
- [x] Phase 3: Seed del edificio ficticio (3/3 plans) — completed 2026-07-01

Full detail: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md) · Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)

</details>

### 🚧 v1.2 Cotizador (Fase 3 del plan maestro) — En progreso

**Milestone Goal:** El diferencial competitivo #1 funciona de punta a punta: un comprador cotiza una unidad (contado USD / anticipo + cuotas CAC / refuerzos), ve el resultado en pantalla, descarga el PDF y abre WhatsApp con la cotización precargada — sobre un motor de cálculo puro al 100% de cobertura donde un error de cálculo mata el producto. Numeración GSD continúa desde v1.1 (última fase 3); directorios `04-*`, `05-*`, `06-*`, `07-*`.

- [x] **Phase 4: Motor de cotización puro (`packages/quoting`)** - Motor puro, determinista y sin I/O que emite un `QuoteResult` tipado único (contado + financiado CAC), 100% cobertura + property-based tests — el contrato del que dependen todas las superficies (completed 2026-07-03)
- [x] **Phase 5: Emisión y persistencia server-side (API + RLS + rate limit)** - `publicProcedure` tRPC auditado que resuelve la org del proyecto publicado, computa vía `withTenant` y persiste el snapshot completo, con rate limit nginx — sin exponer `quotes`/`cac_index` por RLS (completed 2026-07-04)
- [ ] **Phase 6: UI pública del cotizador + CTA WhatsApp** - Web mobile-first: deep-link + picker piso→unidad, resultado en pantalla (contado vs financiado, primera cuota ARS, refuerzos, totales, leyenda no vinculante) y CTA WhatsApp precargado
- [ ] **Phase 7: PDF asíncrono en el worker** - PDF server-side generado en el worker (BullMQ) desde el snapshot, almacenado en R2, idempotente por `quoteId` y con acentos correctos — asíncrono, nunca bloquea el resultado en pantalla

## Phase Details

### Phase 4: Motor de cotización puro (`packages/quoting`)

**Goal**: Existe `packages/quoting` — un motor de cotización puro, determinista y sin I/O que emite un `QuoteResult` tipado único (el contrato del que dependen UI, PDF y WhatsApp), verificado al 100% de cobertura con property-based tests. La base peso (CAC como multiplicador) queda encodada en el contrato `QuoteInput` en esta fase; ninguna superficie puede construirse hasta que la forma de salida esté finalizada.
**Depends on**: Nothing (primera fase del milestone; consume los tipos del schema `quotes`/`payment_plans`/`cac_index`/`unit_prices` de v1.1, sin cambios de schema)
**Requirements**: ENGINE-01, ENGINE-02, ENGINE-03, ENGINE-04, ENGINE-05, ENGINE-06
**Success Criteria** (what must be TRUE):

  1. Dado una unidad + lista de precios + plan de pago + índice CAC vigente, el motor calcula la cotización contado (precio USD con descuento) y la financiada (anticipo USD + N cuotas ajustadas por CAC + refuerzos, primera cuota en ARS "al valor del mes" con CAC como multiplicador) como funciones puras sin I/O — nunca proyecta CAC futuro ni inventa FX. (ENGINE-01, ENGINE-02)
  2. El motor emite una única estructura tipada `QuoteResult` que alimenta UI, PDF y texto de WhatsApp de forma idéntica — una sola forma de salida, sin recompute por superficie. (ENGINE-03)
  3. `packages/quoting` pasa CI con 100% de cobertura + property-based tests que prueban los invariantes: anticipo + saldo + refuerzos reconcilian con el precio exacto, suma de cuotas = saldo al centavo, CAC monótono ⇒ cuota ARS monótona, y determinismo. (ENGINE-04)
  4. Todo el dinero fluye en enteros (USD) / decimal (ARS) con una regla de redondeo y asignación de resto documentada y testeada — los totales cierran al centavo, nunca un float. (ENGINE-05)
  5. El motor exporta `ENGINE_VERSION`, embebible en un snapshot y bumpeable ante cualquier cambio de fórmula. (ENGINE-06)

**Plans**: 4/4 plans complete

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Fundación: deps (decimal.js/fast-check) + gate de cobertura 100% package-scoped + primitivas money (redondeo half-up, regla de resto, ARS decimal) + `ENGINE_VERSION` (ENGINE-05, ENGINE-06)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Contrato: `QuoteInput`/`QuoteResult` (unión discriminada por modalidad) + `QuoteError` (rechazo tipado D-07) + formateador es-AR determinista (ENGINE-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — Motor: `calcQuote` puro (contado + financiado CAC/refuerzos) + tabla unitaria + suite property-based fast-check (ENGINE-01, ENGINE-02, ENGINE-04)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 04-04-PLAN.md — Superficies + barrel + gate: `compareQuotes` + `toWhatsAppText`/`toPdfModel` + barrel público + cobertura 100% verde (ENGINE-03, ENGINE-04)

### Phase 5: Emisión y persistencia server-side (API + RLS + rate limit)

**Goal**: Un comprador anónimo puede disparar la emisión de una cotización cuyo cómputo y persistencia corren server-side por un `publicProcedure` tRPC auditado que resuelve la org del proyecto `publicado`, lee CAC vía `withTenant` y persiste el snapshot completo — sin agregar policies anon a `quotes`/`cac_index` (quedan tenant-private) y con rate limit en el edge. La sub-decisión A1-vs-A2 (dónde vive el pool `app`) se resuelve como Key Decision documentada en esta fase.
**Depends on**: Phase 4 (consume el contrato `QuoteResult`; el snapshot embebe `ENGINE_VERSION`)
**Requirements**: QUOTE-01, QUOTE-02, QUOTE-03
**Success Criteria** (what must be TRUE):

  1. Una request anónima contra el procedure público de cotización resuelve la org del proyecto `publicado`, lee CAC y computa/persiste la cotización vía `withTenant` — sin ninguna policy anon sobre `quotes`/`cac_index` (siguen tenant-private); un mes CAC faltante falla con un mensaje server claro, no un 500 críptico. (QUOTE-01)
  2. Cada cotización emitida persiste su snapshot completo (inputs resueltos + outputs + versión del motor) en `quotes.snapshot`, capturando el estado punto-en-el-tiempo que nunca se recomputa en vivo. (QUOTE-02)
  3. El endpoint anónimo de cotización tiene rate limit en el edge vía nginx `limit_req` (no Traefik — D-01), rechazando ráfagas abusivas sin tocar la config de prod. (QUOTE-03)

**Plans**: 5/5 plans complete

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — quotesRouter (compute/create + resolveAndQuote) + errorFormatter + registro en appRouter (QUOTE-01, QUOTE-02)
- [x] 05-03-PLAN.md — Contrato de queue PDF en packages/storage: QUOTE_PDF_QUEUE + QuotePdfJobData + quotePdfKey, sin producer (D-13)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Test de integración del router vía caller contra Postgres real: happy paths, errores tipados y 42501 anon (QUOTE-01, QUOTE-02)
- [x] 05-04-PLAN.md — A1/D-06: DATABASE_APP_URL en apps/web/env.ts + mount tRPC en web + Key Decision en PROJECT.md (QUOTE-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-05-PLAN.md — Rate limit nginx limit_req (429) en el path de quotes del vhost web + procedimiento de apply/UAT manual (QUOTE-03)

### Phase 6: UI pública del cotizador + CTA WhatsApp

**Goal**: Un comprador llega a una unidad publicada sin el explorador, cotiza en el celular y ve el resultado completo en pantalla (contado vs financiado, primera cuota ARS, refuerzos, totales, leyenda de ajuste CAC + no vinculante), con un CTA que abre WhatsApp con la cotización precargada — todo derivado del mismo `QuoteResult`, con formato es-AR consistente entre server y cliente.
**Depends on**: Phase 5 (llama al `publicProcedure` de cotización; `apps/web` estrena su cliente tRPC)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, WA-01
**Success Criteria** (what must be TRUE):

  1. El comprador llega a cotizar una unidad sin el explorador — vía deep-link compartible por URL param + un picker mínimo piso→unidad sobre unidades publicadas (rol anon). (UI-01)
  2. En una pantalla mobile-first el comprador ve el resultado completo — precio USD, anticipo (USD + %), cuotas, primera cuota ARS "al valor del mes", refuerzos y totales — con la comparación contado vs financiado lado a lado (dos corridas del mismo motor). (UI-02, UI-03)
  3. El comprador ajusta anticipo/plazo de forma interactiva solo dentro de los planes preset y bounds autorizados por el developer (nunca términos libres), con la leyenda de ajuste CAC + "cotización no vinculante" visible y todos los montos formateados es-AR consistentes entre server y cliente (`US$` vs `$`). (UI-04, UI-05, UI-06)
  4. Tocar "Consultar por WhatsApp" abre wa.me con un resumen corto URL-encoded (del mismo `QuoteResult`, no la tabla completa) al número del proyecto, con el slot de routing por broker listo para fase 5. (WA-01)

**Plans**: 5/6 plans executed

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — DB: `projects.whatsapp` nullable column + versioned migration [BLOCKING] + seed number (WA-01)
- [x] 06-02-PLAN.md — Web foundation: deps + Tailwind v4 CSS-first + brand tokens/fonts + dual-splitLink tRPC client + vitest/Playwright infra (UI-06)

**Wave 2** *(blocked on Wave 1)*

- [x] 06-03-PLAN.md — API: anon `picker` router (project+whatsapp/floors/units/plans) mounted in AppRouter + integration test (UI-01, UI-05)
- [x] 06-04-PLAN.md — Presentational: wa.me URL builder + plan-snap map + quote-cards + snap slider, all from one QuoteResult (UI-02, UI-03, UI-04, UI-05, UI-06, WA-01)

**Wave 3** *(blocked on Wave 2)*

- [x] 06-05-PLAN.md — Interactive: RSC page `/p/[slug]/cotizador` + piso→unidad picker + simulator island (live compute, 429-tolerant, WhatsApp CTA) (UI-01, UI-02, UI-03, UI-04, UI-05, WA-01)

**Wave 4** *(blocked on Wave 3)*

- [ ] 06-06-PLAN.md — e2e: Playwright picker/deep-link/result/comparison/slider/leyenda/es-AR/WhatsApp CTA + phase gate (UI-01..06, WA-01)

**UI hint**: yes

### Phase 7: PDF asíncrono en el worker

**Goal**: El comprador puede descargar el PDF de su cotización, generado server-side en el worker (BullMQ) desde el snapshot persistido y almacenado en R2 — asíncrono, idempotente por `quoteId`, con acentos españoles correctos y la leyenda legal, sin bloquear nunca el resultado en pantalla ni el path demo-crítico (pantalla + WhatsApp).
**Depends on**: Phase 5 (snapshot persistido + contrato de queue) y Phase 6 (descarga/poll cableada en la UI)
**Requirements**: PDF-01, PDF-02, PDF-03
**Success Criteria** (what must be TRUE):

  1. El comprador puede descargar el PDF de su cotización, renderizado server-side en el worker BullMQ desde el snapshot persistido (nunca desde re-lecturas en vivo) y almacenado en R2 con la key en `quotes.pdfKey` — asíncrono, sin bloquear nunca el resultado en pantalla. (PDF-01)
  2. La generación de PDF es idempotente por `quoteId` (un retry de BullMQ nunca duplica objetos) y renderiza correctamente los acentos españoles en el worker Alpine (fuente embebida, sin Chromium). (PDF-02)
  3. El PDF lleva la leyenda legal "cotización no vinculante" + la leyenda de ajuste CAC. (PDF-03)

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Monorepo Foundation | v1.0 | 3/3 | Complete | 2026-06-13 |
| 2. Data Layer + RLS | v1.0 | 3/3 | Complete | 2026-06-17 |
| 3. Auth, API & App Surfaces | v1.0 | 5/5 | Complete | 2026-06-18 |
| 4. Staging, Observability & CI/CD | v1.0 | 4/4 | Complete    | 2026-07-03 |
| 1. Schema completo + RLS | v1.1 | 6/6 | Complete | 2026-06-29 |
| 2. Pipeline de media | v1.1 | 3/3 | Complete | 2026-06-30 |
| 3. Seed del edificio ficticio | v1.1 | 3/3 | Complete | 2026-07-01 |
| 4. Motor de cotización puro | v1.2 | 0/4 | Not started | - |
| 5. Emisión y persistencia server-side | v1.2 | 5/5 | Complete    | 2026-07-04 |
| 6. UI pública del cotizador + WhatsApp | v1.2 | 5/6 | In Progress|  |
| 7. PDF asíncrono en el worker | v1.2 | 0/TBD | Not started | - |
