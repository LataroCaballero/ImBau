# Milestones

## v1.0 Fundación (Fase 0) (Shipped: 2026-06-26)

**Phases completed:** 4 phases, 18 plans, 39 tasks
**Git range:** `1a209a7` → `cb2a030` · 682 files, +142k LOC · 14 días (2026-06-12 → 2026-06-26)
**Closeout:** override_closeout (1 verification override — see Known Verification Overrides)

**Delivered:** La fundación técnica multi-tenant de ImBau queda desplegada y operable — cada merge a `main` termina en software corriendo en `staging.tours.andescode.com.ar` detrás de TLS, observable, con aislamiento de tenant impuesto por RLS y verificado automáticamente en CI contra Postgres real.

**Key accomplishments:**

- **Monorepo (Fase 1)** — pnpm 11.6.0 + Turborepo con toolchain pinneada (Corepack, Node 22), `@imbau/config` como raíz del DAG (TS 5.9 estricto, ESLint 9 flat, env presets Zod) y las tres apps + cinco packages compilando de punta a punta con env tipada que falla rápido al boot (MONO-01/02/03).
- **Data layer + RLS (Fase 2)** — Compose Postgres 16 + Redis con un comando, schema base (orgs → projects + tablas Better Auth) en migraciones Drizzle versionadas, `FORCE ROW LEVEL SECURITY` como código sobre tablas con tenant, helpers `withTenant`/`withAnon` con `SET LOCAL`, y la suite de ausencia cross-tenant (DATA-04, puerta de salida) probando que org A no lee datos de org B (DATA-01/02/03/04).
- **Auth + API (Fase 3)** — Better Auth 1.6 (orgs, roles owner/developer/viewer, invitaciones por email Resend/React Email) y la capa tRPC v11 con contexto derivado de sesión, `requireRole`, y routers que enrutan lecturas protegidas por `withTenant` y públicas por `withAnon` (AUTH-01/02/03).
- **App surfaces (Fase 3)** — `apps/panel` con login + dashboard RSC leyendo proyectos de la org activa, `apps/web` con lectura anon de solo proyectos `publicado`, `apps/worker` como shell BullMQ deployable, y tres Dockerfiles multi-stage (`turbo prune` + Next standalone / tsup) (APP-01/02/03/04).
- **CI/CD + secrets (Fase 4)** — gate `quality` en GitHub Actions corriendo la suite RLS contra postgres:16 real con roles sin privilegios (branch-protection en `main`), SOPS+age para secrets de staging, y deploy automático a staging en cada merge (build 4 imágenes → GHCR → SSH, migrate-before-swap) (CI-01/02/03, INFRA-02/03).
- **Staging vivo + observabilidad (Fase 4)** — Compose completo corriendo en el VPS detrás de nginx-host + certbot con TLS (SUPERSEDED D-01: Traefik diferido a box dedicado), Sentry (incl. `onRequestError` RSC), pino → Loki y Uptime Kuma, todo verificado en vivo sobre staging (INFRA-01, OBS-01/02/03).

### Known Verification Overrides

Cerrado como `override_closeout` con 1 override aceptado por el operador (ver STATE.md → Deferred Items):

- **Phase 03 verification** quedó en `human_needed`: las 4 must-haves están VERIFICADAS por evidencia de código; sólo restan las re-corridas de los Playwright e2e (login persistence, invite→accept) y el smoke de Redis del worker contra un stack vivo. Los SUMMARYs los reportan en verde durante la ejecución. Diferido a re-corrida con el stack levantado.

---
