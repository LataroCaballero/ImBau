# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Schema + Media + Seed (Fase 1)** — Phases 1-3 (shipped 2026-07-01) — [archivo](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Cotizador (Fase 3 del plan maestro)** — Phases 4-7 (shipped 2026-07-09) — [archivo](milestones/v1.2-ROADMAP.md)
- 📋 **v1.3 Panel de autogestión (Fase 4 del plan maestro)** — Phases 8-12 (planned)

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

Directorios archivados en `milestones/v1.1-phases/`. Full detail: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md) · Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)

</details>

<details>
<summary>✅ v1.2 Cotizador (Fase 3 del plan maestro) — Phases 4-7 — SHIPPED 2026-07-09 (archivado)</summary>

El diferencial competitivo #1 de punta a punta: motor de cotización puro (`packages/quoting`, 100% cobertura + property-based tests, `QuoteResult` único, CAC como multiplicador) → emisión anónima server-side (tRPC `withAnon`→`withTenant`, snapshot versionado, rate-limit nginx 429) → UI pública mobile-first `/p/[slug]/cotizador` (contado vs financiado en vivo, slider preset, es-AR, CTA WhatsApp) → PDF asíncrono en el worker (BullMQ idempotente por `quoteId`, react-pdf + Roboto embebida, R2 + presigned GET). Numeración GSD continuó desde v1.1 (directorios `04-*`..`07-*`).

- [x] Phase 4: Motor de cotización puro (`packages/quoting`) (4/4 plans) — completed 2026-07-03
- [x] Phase 5: Emisión y persistencia server-side (API + RLS + rate limit) (5/5 plans) — completed 2026-07-04
- [x] Phase 6: UI pública del cotizador + CTA WhatsApp (6/6 plans) — completed 2026-07-05
- [x] Phase 7: PDF asíncrono en el worker (4/4 plans) — completed 2026-07-08

Directorios archivados en `milestones/v1.2-phases/`. Full detail: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md) · Requirements: [milestones/v1.2-REQUIREMENTS.md](milestones/v1.2-REQUIREMENTS.md)

</details>

### 📋 v1.3 Panel de autogestión (Fase 4 del plan maestro) — Planned

**Milestone Goal:** El developer administra su proyecto sin tocar código ni depender del operador: edita precios/estados de unidades (incl. import/export Excel), gestiona su bandeja de leads y dibuja los hotspots del edificio desde el panel — sobre la fundación auth/RLS existente y con todo v1.2 corriendo verificado en staging. Numeración GSD continúa desde v1.2 (Phases 8-12).

Deuda v1.2 primero (merge + re-verificación en staging) → shell del panel scoped al proyecto con role gate → D1 grilla de unidades editable + Excel → D2 bandeja de leads + email → editor de hotspots. Las tres superficies de escritura (D1/D2/hotspots) cuelgan del shell (Phase 9); D1 se hace antes de D2/hotspots porque fuerza la decisión de unicidad de `unit_prices` que protege el motor de cotización de v1.2 y establece el patrón `withTenant` + `requireRole` que D2 y hotspots clonan.

- [x] **Phase 8: Deuda v1.2 — merge a main + re-verificación en staging** (0/2 plans) — not started (completed 2026-07-20)
- [x] **Phase 9: Shell del panel scoped al proyecto + role gate** (0/2 plans) — not started (completed 2026-07-21)
- [ ] **Phase 10: D1 — Grilla de unidades editable + import/export Excel** (0/4 plans) — not started
- [ ] **Phase 11: D2 — Bandeja de leads + notificación por email** (0/TBD plans) — not started
- [ ] **Phase 12: Editor de hotspots** (0/TBD plans) — not started

## Phase Details

### Phase 8: Deuda v1.2 — merge a main + re-verificación en staging

**Goal**: Todo v1.2 (cotizador) corre verificado en vivo en staging tras mergear `fase-0/foundation` a `main`, dejando la fundación limpia antes de construir cualquier superficie del panel encima. Staging hoy corre imagen pre-fase-5; ningún feature nuevo debe apoyarse en infra sin verificar.
**Depends on**: v1.2 (rama `fase-0/foundation` a mergear a `main`)
**Requirements**: DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):

  1. `fase-0/foundation` está mergeada a `main` y el deploy automático dejó las 4 imágenes de v1.2 corriendo en `staging.tours.andescode.com.ar`.
  2. En staging, una ráfaga de POSTs a `/api/trpc/quotes.*` dispara `429` (rate-limit de borde nginx), sin `503` — verificado en vivo contra el VPS.
  3. En staging, el flujo PDF completo funciona de punta a punta: cotización → PDF asíncrono descargable con acentos es-AR correctos.
  4. El QR y el deep-link del PDF apuntan a la URL de staging (no localhost ni imagen pre-fase-5).

**Plans**: 2/2 plans executed
**Wave 1**

- [x] 08-01-PLAN.md — Merge PR #5 a `main` (merge commit) + deploy a staging + verificar migrate-before-swap y seed (DEBT-01, Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md — Re-verificación en vivo: burst 429 sin 503, PDF e2e con acentos es-AR, QR/deep-link a staging, smoke + `08-UAT.md` (DEBT-02, Wave 2)

**Note**: Mecánico — re-corre la UAT existente de v1.2 contra staging; sin research nuevo. La re-verificación en vivo depende de infra del operador (merge + deploy a VPS).

### Phase 9: Shell del panel scoped al proyecto + role gate

**Goal**: El developer entra a la administración de un proyecto de su org y navega entre las tres áreas (unidades, leads, hotspots), con el gate de autorización por rol impuesto en el servidor. Es el prerrequisito estructural único sobre el que viven las tres superficies de escritura — hoy el panel es un dashboard único sin route scoped al proyecto.
**Depends on**: Phase 8 (staging verificado)
**Requirements**: PANEL-01, PANEL-02
**Success Criteria** (what must be TRUE):

  1. Un developer autenticado navega a `proyectos/[id]` y ve un layout con tabs (unidades / leads / hotspots) scoped al proyecto de su org activa (reusa `projects.listForOrg`).
  2. Un usuario no puede abrir la administración de un proyecto que no pertenece a su org (resolución de proyecto por org activa + RLS).
  3. Toda mutación scoped al proyecto exige rol owner/developer; un viewer recibe `403` al intentar escribir — probado por una matriz de tests cross-rol contra Postgres real, no solo por UI oculta.
  4. El middleware `requireRole("owner","developer")` queda establecido como patrón reutilizable de escritura del panel, listo para que D1/D2/hotspots lo clonen.

**Plans**: 2/2 plans executed
**UI hint**: yes

**Wave 1**

- [x] 09-01-PLAN.md — Canary write mold (`projects.updateSettings` + `getForOrg` + `org.activeMemberRole`) + cross-role matrix vs real Postgres (PANEL-01, PANEL-02, Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 09-02-PLAN.md — Panel shell `proyectos/[id]` route tree: layout + tabs + placeholders + notFound + selector wiring (PANEL-01, Wave 2)

### Phase 10: D1 — Grilla de unidades editable + import/export Excel

**Goal**: El developer administra precios, estados y listas de pago de sus unidades desde una grilla editable, con round-trip Excel (export → editar → import con preview) transaccional e idempotente, y los cambios se reflejan en la web pública al instante. Es la superficie de mayor valor del panel y la de mayor riesgo (dinero) — establece el patrón `withTenant` + `requireRole` + parse puro que D2 y hotspots reutilizan.
**Depends on**: Phase 9 (shell + role gate)
**Requirements**: GRID-01, GRID-02, GRID-03, GRID-04, GRID-05, GRID-06, GRID-07
**Success Criteria** (what must be TRUE):

  1. El developer edita inline el precio de una unidad por lista de pago (matriz unidad × price_list) y el cambio persiste con vigencia.
  2. El developer cambia el estado de una unidad (disponible/reservado/vendido) desde la grilla.
  3. El developer exporta la grilla a un Excel con template canónico (celdas sanitizadas contra formula/CSV injection) y lo re-importa: la validación completa muestra un preview dry-run con diff campo por campo antes de aplicar.
  4. El import se aplica all-or-nothing (una sola transacción `withTenant`) e idempotente por clave natural (`UNIQUE(unit_id, price_list_id)`); una fila inválida aborta todo sin escrituras parciales, y el dinero nunca se contamina con floats (parse es-AR con `Number.isInteger` post-parse).
  5. El developer aplica bulk edit de precios (% o monto fijo) sobre una selección de unidades, y todo cambio de precio/estado se refleja al instante en el picker/cotizador público (revalidación ISR on-demand).

**Plans**: 2/4 plans executed
**UI hint**: yes
**Research flag**: RESUELTO en planning — parse de dinero es-AR se disuelve por la regla de dominio (USD entero, sin centavos → cualquier fraccional es inválido, elimina la ambigüedad `.`/`,`); `vigencia` es server-set `now()` (no se importa fecha, DD/MM/YYYY fuera de scope); UX de validación/error especificada en 10-UI-SPEC.md (Copywriting Contract es-AR + Import Flow). GRID-07 resuelto a Path A (web `force-dynamic`, sin plumbing de revalidación; se valida con test cross-surface).

- [x] 10-01-PLAN.md — Migración versionada `UNIQUE(unit_id, price_list_id)` [BLOCKING] + prueba de enforcement (GRID-05, Wave 1)
- [x] 10-02-PLAN.md — Módulo puro `packages/api/src/excel/` (build/parse/money/dry-run/bulk) + property tests + exceljs/fast-check (GRID-03/04/06, Wave 1)
- [ ] 10-03-PLAN.md — Router `units` (4 mutaciones + read + export/dry-run) clonando el molde de Phase 9 + matriz cross-rol/transaccional/idempotencia/GRID-07 vs Postgres real (GRID-01..07, Wave 2)
- [ ] 10-04-PLAN.md — UI del panel: grilla + edición inline + dropdown estado + selección/bulk-con-preview + wizard de import (4 pasos) + wiring de tokens de marca (GRID-01/02/03/04/06/07, Wave 3)

### Phase 11: D2 — Bandeja de leads + notificación por email

**Goal**: El developer gestiona su bandeja de leads con origen trazable, los mueve por un pipeline fijo de 4 estados con notas en el timeline, y recibe un aviso por email ante cada lead nuevo sin que la notificación bloquee ni duplique la mutación. Superficie liviana (anti-CRM), independiente de D1, que clona el patrón de role-gate/audit de la grilla y el contrato worker BullMQ + Resend del quote-pdf.
**Depends on**: Phase 9 (shell + role gate); reusa el patrón role-gate/audit de Phase 10
**Requirements**: LEADS-01, LEADS-02, LEADS-03, LEADS-04
**Success Criteria** (what must be TRUE):

  1. El developer ve la bandeja de leads con su origen (broker / unidad / cotización) resuelto por joins.
  2. El developer mueve un lead por el pipeline fijo `nuevo → contactado → negociación → cerrado` (máquina de estados impuesta, sin estados libres).
  3. El developer agrega notas al timeline de un lead y quedan persistidas en orden.
  4. Ante un lead nuevo, el developer recibe un aviso por email encolado (BullMQ) e idempotente por evento (`lead:{id}:{event}`) — nunca `await` inline en la mutación, nunca duplica en reintentos ni bulk.

**Plans**: TBD
**UI hint**: yes

### Phase 12: Editor de hotspots

**Goal**: El developer dibuja, edita y borra los polígonos SVG del edificio (pisos sobre el render exterior, unidades sobre la planta) y los vincula a piso/unidad, guardados en coordenadas viewBox intrínsecas y validados, consumibles tal cual por el explorador de la fase 2 (milestone futuro) vía las policies anon existentes. Es la superficie más UI-heavy pero de menor riesgo de cronograma: su único consumidor es un milestone posterior, y no depende de D1/D2.
**Depends on**: Phase 9 (shell + role gate)
**Requirements**: HSPOT-01, HSPOT-02, HSPOT-03, HSPOT-04
**Success Criteria** (what must be TRUE):

  1. El developer dibuja polígonos de pisos sobre el render exterior del edificio y los vincula a un piso.
  2. El developer dibuja polígonos de unidades sobre la planta del piso y los vincula a una unidad.
  3. El developer edita y borra polígonos existentes.
  4. Los polígonos se guardan en coordenadas viewBox intrínsecas (0-1000, no atadas a píxeles) y validados (no degenerados ni auto-intersecados), consumibles tal cual por el explorador de fase 2 vía las policies anon existentes de `floors.poligonoSvg`/`units.poligonoSvg` — cero migración de schema.

**Plans**: TBD
**UI hint**: yes
**Research flag**: al planificar, resolver la pregunta abierta de dónde vive el render exterior del edificio (campo en `projects` vs fila de `media` designada) antes de cablear el canvas del editor de pisos — bloqueante pero de bajo riesgo (`--research-phase` o un spike de arquitectura corto).

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 (v1.3). D2 (11) y hotspots (12) son paralelizables una vez existe el shell (9), si hay capacidad.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Monorepo Foundation | v1.0 | 3/3 | Complete | 2026-06-13 |
| 2. Data Layer + RLS | v1.0 | 3/3 | Complete | 2026-06-17 |
| 3. Auth, API & App Surfaces | v1.0 | 5/5 | Complete | 2026-06-18 |
| 4. Staging, Observability & CI/CD | v1.0 | 7/7 | Complete | 2026-06-26 |
| 1. Schema completo + RLS | v1.1 | 6/6 | Complete | 2026-06-29 |
| 2. Pipeline de media | v1.1 | 3/3 | Complete | 2026-06-30 |
| 3. Seed del edificio ficticio | v1.1 | 3/3 | Complete | 2026-07-01 |
| 4. Motor de cotización puro | v1.2 | 4/4 | Complete | 2026-07-03 |
| 5. Emisión y persistencia server-side | v1.2 | 5/5 | Complete | 2026-07-04 |
| 6. UI pública del cotizador + WhatsApp | v1.2 | 6/6 | Complete | 2026-07-05 |
| 7. PDF asíncrono en el worker | v1.2 | 4/4 | Complete | 2026-07-08 |
| 8. Deuda v1.2 — merge + re-verificación staging | v1.3 | 2/2 | Complete    | 2026-07-20 |
| 9. Shell del panel scoped al proyecto + role gate | v1.3 | 2/2 | Complete    | 2026-07-21 |
| 10. D1 — Grilla de unidades + Excel | v1.3 | 2/4 | In Progress|  |
| 11. D2 — Bandeja de leads + email | v1.3 | 0/TBD | Not started | - |
| 12. Editor de hotspots | v1.3 | 0/TBD | Not started | - |
