# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Schema + Media + Seed (Fase 1)** — Phases 1-3 (shipped 2026-07-01) — [archivo](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Cotizador (Fase 3 del plan maestro)** — Phases 4-7 (shipped 2026-07-09) — [archivo](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Panel de autogestión (Fase 4 del plan maestro)** — Phases 8-12 (shipped 2026-07-25) — [archivo](milestones/v1.3-ROADMAP.md)

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

<details>
<summary>✅ v1.3 Panel de autogestión (Fase 4 del plan maestro) — Phases 8-12 — SHIPPED 2026-07-25 (archivado)</summary>

El developer administra su proyecto sin tocar código: deuda v1.2 saldada + staging re-verificado en vivo → shell del panel scoped a `proyectos/[id]` con role-gate server-side → D1 grilla de unidades editable + import/export Excel transaccional e idempotente → D2 bandeja de leads (pipeline 4 estados + notas) + notificación por email queued idempotente → editor de hotspots SVG hand-rolled (draw/edit/delete + vínculo piso/unidad, coords viewBox intrínsecas, validación bloqueante). Las tres superficies de escritura (D1/D2/hotspots) clonan el molde `requireRole("owner","developer")` + `withTenant`. Mergeado a `main` vía PR #6 (CI `quality` verde).

- [x] Phase 8: Deuda v1.2 — merge a main + re-verificación en staging (2/2 plans) — completed 2026-07-20
- [x] Phase 9: Shell del panel scoped al proyecto + role gate (2/2 plans) — completed 2026-07-21
- [x] Phase 10: D1 — Grilla de unidades editable + import/export Excel (4/4 plans) — completed 2026-07-24
- [x] Phase 11: D2 — Bandeja de leads + notificación por email (6/6 plans) — completed 2026-07-24
- [x] Phase 12: Editor de hotspots (3/3 plans) — completed 2026-07-25

Directorios archivados en `milestones/v1.3-phases/`. Full detail: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md) · Requirements: [milestones/v1.3-REQUIREMENTS.md](milestones/v1.3-REQUIREMENTS.md)

</details>

## Progress

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
| 8. Deuda v1.2 — merge + re-verificación staging | v1.3 | 2/2 | Complete | 2026-07-20 |
| 9. Shell del panel scoped al proyecto + role gate | v1.3 | 2/2 | Complete | 2026-07-21 |
| 10. D1 — Grilla de unidades + Excel | v1.3 | 4/4 | Complete | 2026-07-24 |
| 11. D2 — Bandeja de leads + email | v1.3 | 6/6 | Complete | 2026-07-24 |
| 12. Editor de hotspots | v1.3 | 3/3 | Complete | 2026-07-25 |
