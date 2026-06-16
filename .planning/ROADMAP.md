# Roadmap: ImBau — Milestone v1 (Fase 0: Fundación)

## Overview

Este milestone construye la fundación técnica multi-tenant de ImBau en estricto orden de dependencias del grafo de paquetes: primero el monorepo y la config compartida (todo importa `packages/config`), luego la capa de datos con RLS (la unidad de mayor riesgo — retrofitearla sería reescribir, así que precede a todo el código de app), después auth + API + las superficies de app que prueban la costura de extremo a extremo, y finalmente staging con observabilidad y el pipeline de CI/CD que cierra el lazo. Al terminar, cada merge a main deploya automáticamente a `staging.tours.andescode.com.ar` con aislamiento multi-tenant verificable por tests de ausencia cross-tenant corriendo en CI contra Postgres real.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Monorepo Foundation** - Workspace pnpm + Turborepo, config compartida (tsconfig, ESLint 9, env Zod) y esqueletos de paquetes que compilan (completed 2026-06-13)
- [ ] **Phase 2: Data Layer + RLS** - Postgres 16 + Redis vía Compose, schema base con migraciones Drizzle y aislamiento de tenant verificado por tests de ausencia cross-tenant
- [ ] **Phase 3: Auth, API & App Surfaces** - Better Auth (orgs, roles, invitaciones), costura tRPC y las tres apps (panel, web, worker) leyendo datos con el contexto de tenant correcto
- [ ] **Phase 4: Staging, Observability & CI/CD** - Topología completa en el VPS detrás de Traefik, observabilidad (Sentry, pino → Loki, Uptime Kuma) y auto-deploy a staging en cada merge a main

## Phase Details

### Phase 1: Monorepo Foundation

**Goal**: El monorepo compila de punta a punta con la config compartida que todo lo demás importa, sobre una rama de milestone limpia.
**Depends on**: Nothing (first phase)
**Requirements**: PROC-01, MONO-01, MONO-02, MONO-03
**Success Criteria** (what must be TRUE):

  1. El estado inicial del repo está commiteado y existe la rama `fase-0/foundation` desde donde arranca el desarrollo del milestone
  2. `pnpm install` y un build de Turborepo completan con apps (`web`, `panel`, `worker`) y packages (`db`, `api`, `quoting`, `ui`, `config`) esqueleto, con dependencias estrictamente descendentes (apps → api → db/ui → config)
  3. `pnpm lint` y `pnpm typecheck` corren desde `packages/config` compartido (TypeScript 5.9 estricto sin `any` injustificado, ESLint 9 flat config) y pasan en todo el workspace
  4. Arrancar cualquier app con una variable de entorno faltante o inválida falla rápido al boot con un mensaje claro generado por el schema Zod tipado

**Plans**: TBD

### Phase 2: Data Layer + RLS

**Goal**: La capa de datos existe con aislamiento de tenant impuesto por la base de datos y demostrado por tests, antes de escribir cualquier código de aplicación.
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):

  1. `docker compose up -d` levanta Postgres 16 y Redis locales con un solo comando
  2. El schema base (organizations → projects + tablas de Better Auth) vive en `packages/db` y se aplica con migraciones Drizzle versionadas (`generate` + `migrate`, nunca `push` ni cambios manuales)
  3. Toda tabla con tenant tiene `FORCE ROW LEVEL SECURITY` con roles de DB dedicados (app sin ownership ni BYPASSRLS, `anon` limitado a proyectos `publicado`) y el contexto de tenant fluye por transacción vía `withTenant()` con `SET LOCAL`
  4. Los tests de aislamiento cross-tenant corriendo como rol de app contra Postgres real demuestran que la org A no puede leer datos de la org B (test de ausencia — puerta de salida del milestone)

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Compose (Postgres 16 + Redis 7) + `packages/db` toolchain: deps, drizzle.config (entities.roles), three-URL env contract

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Better Auth offline generate + fold, `projects`/`estado` + RLS policies/roles, generated migration + hand-written roles/GRANT/FORCE SQL, applied

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-03-PLAN.md — `withTenant`/`withAnon` helpers + cross-tenant absence test harness (the DATA-04 exit gate)

### Phase 3: Auth, API & App Surfaces

**Goal**: Un usuario puede autenticarse, pertenecer a organizaciones con roles, e interactuar con las tres apps leyendo datos por el camino de tenant correcto de extremo a extremo.
**Depends on**: Phase 2
**Requirements**: AUTH-01, AUTH-02, AUTH-03, APP-01, APP-02, APP-03, APP-04
**Success Criteria** (what must be TRUE):

  1. Un usuario puede registrarse y loguearse con email/contraseña vía Better Auth y su sesión persiste entre refrescos
  2. Un usuario pertenece a organizaciones con roles owner/developer/viewer, y la organización activa de su sesión determina su contexto de tenant; un owner puede invitar miembros por email (Resend + React Email) y el invitado acepta y entra con el rol asignado
  3. `apps/panel` tiene login funcionando y una página que lee datos protegidos por RLS de la organización activa; `apps/web` lee vía rol `anon` y solo ve proyectos en estado `publicado`
  4. `apps/worker` corre como shell deployable (BullMQ conectado a Redis, sin lógica de jobs) y cada app produce una imagen Docker deployable con Dockerfile multi-stage (`turbo prune` + Next.js standalone)

**Plans**: TBD

### Phase 4: Staging, Observability & CI/CD

**Goal**: Cada merge a main termina en software corriendo en staging, observable y con el aislamiento de tenant verificado automáticamente — la fundación operable desde el día uno.
**Depends on**: Phase 3
**Requirements**: INFRA-01, INFRA-02, INFRA-03, CI-01, CI-02, CI-03, OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):

  1. El Compose completo corre en el VPS de staging detrás de Traefik con TLS (web, panel, worker, Postgres, Redis, Loki/Grafana, Uptime Kuma) en `staging.tours.andescode.com.ar`, con secrets cifrados en el repo (SOPS/age) y separación por entorno
  2. Cada PR corre lint + type-check + tests en GitHub Actions con un Postgres service real para los tests de aislamiento RLS; CI roja bloquea el merge
  3. Cada merge a main buildea las imágenes Docker de las tres apps (cache de Turborepo), las pushea al registry y deploya a staging corriendo las migraciones antes del swap de contenedores
  4. Los errores de web, panel y worker llegan a Sentry con contexto (incl. `onRequestError` para RSC), los logs estructurados de pino llegan a Grafana/Loki, y Uptime Kuma monitorea la disponibilidad de los servicios de staging

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Monorepo Foundation | 3/3 | Complete    | 2026-06-13 |
| 2. Data Layer + RLS | 2/3 | In Progress|  |
| 3. Auth, API & App Surfaces | 0/TBD | Not started | - |
| 4. Staging, Observability & CI/CD | 0/TBD | Not started | - |
