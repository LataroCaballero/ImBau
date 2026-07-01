# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Schema + Media + Seed (Fase 1)** — Phases 1-3 (shipped 2026-07-01) — [archivo](milestones/v1.1-ROADMAP.md)
- 📋 **v1.2 Cotizador (Fase 3 del plan maestro)** — por definir con `/gsd-new-milestone`

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

### 📋 v1.2 Cotizador (Planned)

Próximo milestone según el orden ventana-Fable: fase 3 del plan maestro — motor `packages/quoting` (funciones puras, cobertura 100%, property-based tests) + UI del cotizador + PDF server-side + handoff a WhatsApp. Se define con `/gsd-new-milestone`.

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
