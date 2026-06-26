---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: staging-observability-ci-cd
status: executing
stopped_at: Phase 4 context gathered
last_updated: "2026-06-26T12:22:19.696Z"
last_activity: 2026-06-26
last_activity_desc: Phase 04 execution started
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 18
  completed_plans: 14
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging con aislamiento multi-tenant verificable por RLS.
**Current focus:** Phase 04 — staging-observability-ci-cd

## Current Position

Phase: 04 (staging-observability-ci-cd) — EXECUTING
Plan: 4 of 7
Status: Ready to execute
Last activity: 2026-06-26 — Phase 04 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 6
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 03 P01 | 26min | 3 tasks | 13 files |
| Phase 3 P02 | 5min | 3 tasks | 11 files |
| Phase 03 P03 | 45min | 4 tasks | 20 files |
| Phase 03 P05 | 5min | 2 tasks | 8 files |
| Phase 04 P05 | 18min | 3 tasks | 7 files |
| Phase 04 P01 | 12m | 3 tasks | 10 files |
| Phase 04 P03 | 8min | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: v1 = solo fase 0 del modelo-mvp.md; estructura horizontal por capas en orden de dependencias (config → db/RLS → auth/api/apps → infra/CI/CD)
- [Roadmap]: DATA-04 (tests de ausencia cross-tenant) es la puerta de salida del milestone; corre en CI contra Postgres real (CI-02)
- [Phase ?]: A1 locked: Better Auth adapter uses createOwnerDb (owner pool) to write RLS-FORCED organization/member; app data path stays on withTenant/withAnon (03-01)
- [Phase ?]: Custom Better Auth AC must merge org-plugin defaultStatements; owner gets invitation:[create,cancel] so invite stays owner-only (03-01)
- [Phase ?]: Panel mirrors access-control to the client via a @imbau/api/access-control subpath so the Better Auth server runtime never bundles into the browser (03-03)
- [Phase ?]: Auth + tRPC handlers mount ONLY in apps/panel (D-03); apps/web stays anon-only with no auth route (03-03)
- [Phase ?]: Task-4 human-verify approved: human accepted the green Playwright auth e2e (login persistence + invite/accept vs live Postgres) in lieu of manual click-through (03-03)
- [Phase ?]: 03-05: web/panel/worker multi-stage Dockerfiles via turbo prune; no prod install in standalone/dist; created public/.gitkeep for build-valid COPY
- [Phase ?]: [04-05]: migrate.ts reads raw DATABASE_URL (owner, max:1), never src/env.ts; runs from source via Node type-stripping (no drizzle-kit/tsup) as a one-off migrate-before-swap image
- [Phase ?]: [04-05]: staging Postgres runs -c imbau.env=production so 0001_rls.sql skips :dev passwords; real app/anon passwords provisioned out-of-band from SOPS (Pattern 4, 04-06)
- [Phase ?]: [04-05]: staging topology = internal-only pg/redis (no host ports), web/panel loopback 8090/8091 behind host nginx, observability under profiles + per-service mem_limit; Grafana/Kuma SSH-tunnel only
- [Phase ?]: [04-05]: two DNS A records for one SAN cert (staging.tours + panel.staging.tours -> 31.97.175.128); cert via certbot --webroot never --nginx (04-07)
- [Phase 04]: pino-loki transport over Promtail (refines D-03): zero extra container, fallback-symmetric with D-04 via LOKI_URL swap
- [Phase 04]: Allow @sentry/cli native build (pnpm allowBuilds:true) — binary required for CI source-map upload (OBS-01)
- [Phase 04]: 04-03: CI quality gate (lint+typecheck+test) + RLS-in-CI via postgres:16-alpine service; branch protection on main requires the quality check (CI-01/CI-02)
- [Phase 04]: 04-03 finding: inaugural CI run failed on PRE-EXISTING gaps (monorepo ESLint 9 flat-config resolution; @imbau/db#test in CI postgres) — out-of-scope for 04-03, needs separate remediation before milestone PR merges

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2/3]: APIs relativamente nuevas (Drizzle `pgPolicy`/`pgRole`, Better Auth org plugin) — re-verificar contra versiones pineadas en planning; reconciliar `member` (org plugin) vs `memberships`
- [Control de fase 0]: si el milestone supera 1 semana, recalibrar todo el plan antes de seguir (regla del doc maestro; estimación 3-4 días con Fable)

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-26T12:22:02.048Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-staging-observability-ci-cd/04-CONTEXT.md
