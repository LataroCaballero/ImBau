# Roadmap: ImBau

SaaS multi-tenant de showroom 3D para preventa en pozo. El plan maestro (`docs/modelo-mvp.md`) se entrega como milestones GSD en orden ventana-Fable: **0 → 1 → 3 → 4 → 2 → 5 → 6**. Cada milestone GSD cubre una fase del plan maestro.

## Milestones

- ✅ **v1.0 Fundación (Fase 0)** — Phases 1-4 (shipped 2026-06-26) — [archivo](milestones/v1.0-ROADMAP.md)
- 📋 **v1.1 Schema + Media + Seed (Fase 1)** — próximo milestone (sin planear)

## Phases

<details>
<summary>✅ v1.0 Fundación (Fase 0) — Phases 1-4 — SHIPPED 2026-06-26</summary>

Monorepo + config compartida → data layer con RLS multi-tenant → auth/API/app surfaces → staging vivo con observabilidad y CI/CD. Cada merge a `main` deploya a `staging.tours.andescode.com.ar` con aislamiento de tenant verificado por tests de ausencia cross-tenant en CI contra Postgres real.

- [x] Phase 1: Monorepo Foundation (3/3 plans) — completed 2026-06-13
- [x] Phase 2: Data Layer + RLS (3/3 plans) — completed 2026-06-17
- [x] Phase 3: Auth, API & App Surfaces (5/5 plans) — completed 2026-06-18
- [x] Phase 4: Staging, Observability & CI/CD (7/7 plans) — completed 2026-06-26

Full detail: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) · Requirements: [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)

</details>

### 📋 v1.1 Schema + Media + Seed (Fase 1) — Not started

Próxima fase del plan maestro (modelo-mvp.md §3.3): schema completo (floors, units, price_lists, payment_plans, quotes, brokers, leads, etc.), pipeline de media (R2 + sharp + blurhash, variantes AVIF/WebP) y seed del edificio ficticio. Se define con `/gsd-new-milestone`.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Monorepo Foundation | v1.0 | 3/3 | Complete | 2026-06-13 |
| 2. Data Layer + RLS | v1.0 | 3/3 | Complete | 2026-06-17 |
| 3. Auth, API & App Surfaces | v1.0 | 5/5 | Complete | 2026-06-18 |
| 4. Staging, Observability & CI/CD | v1.0 | 7/7 | Complete | 2026-06-26 |
