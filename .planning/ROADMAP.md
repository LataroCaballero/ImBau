# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Schema + Media + Seed (Fase 1)** — Phases 1-3 (en progreso) — numeración GSD reiniciada

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

### 🚧 v1.1 Schema + Media + Seed (Fase 1) — En progreso

**Milestone Goal:** Completar el modelo de datos del producto (modelo-mvp §3.3) con RLS por tenant, montar el pipeline de media (R2 + sharp + blurhash) en el worker, y sembrar el edificio ficticio realista — todo en migraciones Drizzle versionadas y verificado en CI/staging. Numeración GSD reinicia en Phase 1; directorios `01-*`, `02-*`, `03-*`.

- [x] **Phase 1: Schema completo + RLS** - Modelo de datos §3.3 en migraciones Drizzle con RLS FORCE por tenant, policy anon published-only y suite de aislamiento cross-tenant verde en CI (completed 2026-06-29)
- [x] **Phase 2: Pipeline de media (R2 + sharp + blurhash)** - Upload a R2 → procesamiento sharp en el worker (variantes AVIF/WebP srcset + blurhash/dims) persistido en `media` y resoluble por web/panel (completed 2026-06-30)
- [ ] **Phase 3: Seed del edificio ficticio** - Seed determinista e idempotente de "Brigos Recoleta" (~13 pisos) poblando todas las tablas + media procesada

## Phase Details

### Phase 1: Schema completo + RLS

**Goal**: El modelo de datos completo de modelo-mvp §3.3 existe en migraciones Drizzle versionadas, con `FORCE ROW LEVEL SECURITY` y policy por tenant en toda tabla con tenant; la web pública (rol `anon`, sin BYPASSRLS) solo lee filas de proyectos `publicado`; y el aislamiento cross-tenant está verificado en CI sobre todas las tablas nuevas.
**Depends on**: Nothing (primera fase del milestone; construye sobre el schema base orgs→projects de v1.0)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SCHEMA-05, SCHEMA-06, SCHEMA-07, SCHEMA-08
**Success Criteria** (what must be TRUE):

  1. Todas las tablas de §3.3 (floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events) existen vía migraciones Drizzle versionadas — `pnpm db:migrate` corre limpio desde cero, sin `push` ni cambios manuales al schema. (SCHEMA-01..06)
  2. Cada tabla con tenant tiene `FORCE ROW LEVEL SECURITY` + policy por tenant; el dinero se guarda en enteros (USD para precios) / decimal (ARS para cuotas), nunca floats; `quotes` queda con el schema listo para que el cotizador de Fase 3 lo consuma (sin motor de cálculo). (SCHEMA-02, SCHEMA-03)
  3. La suite de aislamiento cross-tenant, extendida a todas las tablas nuevas, pasa verde en CI contra Postgres 16 real con roles sin BYPASSRLS: org A no lee ni escribe filas de org B. (SCHEMA-08)
  4. Un test verifica que, con el rol `anon`, la web pública solo lee filas pertenecientes a proyectos `publicado` en todas las tablas de catálogo/contenido. (SCHEMA-07)
  5. `events` está particionada por mes, y tanto `events` como `leads` aceptan insert anónimo validado por Zod (analytics y captación de leads), con RLS por tenant en ambas. (SCHEMA-04, SCHEMA-06)

**Plans**: 6/6 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Foundation + catálogo: 5 enums, JSONB Zod contracts, drizzle-zod, `projects` UNIQUE, floors + units (SCHEMA-01) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Pricing + quotes: price_lists, unit_prices (FLAG-D project_id), payment_plans (refuerzos JSONB), cac_index (tenant-private), quotes (versioned snapshot) (SCHEMA-02, SCHEMA-03) [wave 2]
- [x] 01-03-PLAN.md — Content + events types: brokers, leads (anon INSERT-only), progress_posts, galleries, media, events.ts (FLAG-A/B types-only) (SCHEMA-04, SCHEMA-05, SCHEMA-06) [wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — Register + generate 0002 + hand 0003 (FORCE RLS, anon GRANTs, events partition DDL) + [BLOCKING] `pnpm db:migrate` from zero (SCHEMA-06, SCHEMA-07) [wave 3]

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Worker events-partition maintenance job (skeleton, idempotent) (SCHEMA-06) [wave 4]
- [x] 01-06-PLAN.md — Exit gate: cross-tenant isolation suite + anon published-only over all new tables, green in CI (SCHEMA-07, SCHEMA-08) [wave 4]

### Phase 2: Pipeline de media (R2 + sharp + blurhash)

**Goal**: El pipeline de media opera de punta a punta — una imagen subida a Cloudflare R2 se procesa en el worker generando variantes AVIF/WebP en múltiples tamaños y un placeholder, con keys/dimensiones/blurhash persistidos en `media` y resolubles por web y panel; el job es idempotente, con reintentos y errores observables.
**Depends on**: Phase 1 (la tabla `media` y su RLS provienen de SCHEMA-05)
**Requirements**: MEDIA-01, MEDIA-02, MEDIA-03, MEDIA-04, MEDIA-05
**Success Criteria** (what must be TRUE):

  1. Subir una imagen (vía API/presigned) la almacena en Cloudflare R2 y registra su fila en `media` (project + key del original). (MEDIA-01)
  2. El worker (BullMQ + sharp) produce variantes AVIF/WebP en múltiples tamaños (srcset) almacenadas en R2 y referenciadas desde `media`. (MEDIA-02)
  3. `blurhash` + `width`/`height` quedan calculados y persistidos en `media` para placeholders LQIP. (MEDIA-03)
  4. El job de procesamiento es idempotente y con reintentos: un fallo se reporta a Sentry + pino (nunca se silencia) y nunca deja la media en estado inconsistente. (MEDIA-04)
  5. Un helper/API resuelve una `media` a su set completo de variantes (srcset + blurhash + dimensiones), consumible desde web y panel. (MEDIA-05)

**Plans**: 3/3 plans complete

Plans:

- [x] 02-01-PLAN.md
- [x] 02-02-PLAN.md
- [x] 02-03-PLAN.md

**Wave 1**

- [x] 02-01: Upload a R2 (API/presigned) + registro de la fila en `media` + helper resolver de variantes (MEDIA-01, MEDIA-05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02: Worker sharp — variantes AVIF/WebP srcset en R2 + blurhash/dimensiones persistidos en `media` (MEDIA-02, MEDIA-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-03: Idempotencia, reintentos y errores observables (Sentry + pino) del job de media (MEDIA-04)

### Phase 3: Seed del edificio ficticio

**Goal**: Un seed determinista, idempotente y re-ejecutable del edificio "Brigos Recoleta" (~13 pisos) puebla todas las tablas con datos realistas — pisos, unidades, listas de precios y planes de pago con CAC, contenido y media procesada — suficiente para panel, web pública y futuras métricas, y documentado en los comandos.
**Depends on**: Phase 1 (todas las tablas) y Phase 2 (galleries con media procesada — variantes + blurhash)
**Requirements**: SEED-01, SEED-02, SEED-03, SEED-04
**Success Criteria** (what must be TRUE):

  1. `pnpm db:seed` crea la organización, el proyecto `publicado`, ~13 floors y units realistas (tipologías, m2, orientaciones, estados disponible/reservado/vendido variados). (SEED-01)
  2. El seed carga pricing realista — price_lists (contado USD / financiado), unit_prices, payment_plans con ajuste CAC y `cac_index` con histórico de varios períodos. (SEED-02)
  3. El seed puebla contenido de ejemplo — progress_posts, galleries con media procesada (variantes + blurhash), brokers y algunos leads/events — suficiente para poblar panel y métricas. (SEED-03)
  4. `pnpm db:seed` es idempotente: re-ejecutarlo no duplica filas en corridas sucesivas, y el comando está documentado en el README/comandos. (SEED-04)

**Plans**: TBD

Plans:

- [ ] 03-01: Seed del edificio — org + proyecto publicado + floors/units realistas + pricing (price_lists, unit_prices, payment_plans CAC, cac_index histórico) (SEED-01, SEED-02)
- [ ] 03-02: Seed de contenido (progress_posts, galleries con media procesada, brokers, leads/events) + idempotencia + documentación de `pnpm db:seed` (SEED-03, SEED-04)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Schema completo + RLS | v1.1 | 6/6 | Complete    | 2026-06-29 |
| 2. Pipeline de media | v1.1 | 3/3 | Complete   | 2026-06-30 |
| 3. Seed del edificio ficticio | v1.1 | 0/2 | Not started | - |
