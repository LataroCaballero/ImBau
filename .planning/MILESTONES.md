# Milestones

## v1.1 Schema + Media + Seed (Shipped: 2026-07-01)

**Phases completed:** 3 phases, 12 plans, 30 tasks
**Git range:** `dae990d` → `16ddb84` · 94 commits, 204 files, +17.8k LOC · 5 días (2026-06-26 → 2026-07-01)
**Closeout:** verified_closeout (3/3 fases verificadas, 17/17 requirements, audit de artefactos limpio; sin milestone audit formal)

**Delivered:** El modelo de datos completo del producto (modelo-mvp §3.3) vive en migraciones Drizzle con RLS FORCE por tenant, el pipeline de media R2 + sharp opera de punta a punta con errores observables, y el seed determinista de "Brigos Recoleta" puebla todas las tablas — con media procesada por el pipeline real — listo para las superficies de producto de las próximas fases.

**Key accomplishments:**

- **Schema §3.3 completo (Fase 1)** — 13 tablas nuevas (floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events particionada por mes) en migraciones Drizzle versionadas (0002_domain + 0003_rls_domain), clonando el template RLS de v1.0: dinero en enteros/decimal, JSONB tipado con Zod, `FORCE ROW LEVEL SECURITY`, migrate-from-zero idempotente (SCHEMA-01..06).
- **Aislamiento probado (Fase 1)** — la suite cross-tenant de `@imbau/db` extendida a las 13 tablas: tenant isolation, anon published-only, tenant-private sin anon, y routing/aislamiento de particiones de events — 14 tests verdes en CI contra Postgres 16 real con roles NOBYPASSRLS (SCHEMA-07/08).
- **Pipeline de media R2 (Fase 2)** — `@imbau/storage` (S3 client checksum-opt-out + keys deterministas + contrato BullMQ), tRPC `createUpload`/`confirmUpload` con keys derivadas server-side, worker sharp generando variantes AVIF/WebP srcset + blurhash + dimensiones persistidas en un solo UPDATE `withTenant` como `app_authenticated`, y resolver `resolveMedia` consumible por web/panel (MEDIA-01/02/03/05).
- **Media a prueba de fallos (Fase 2)** — idempotencia (dos corridas → una fila, mismas variantes/keys), recoverabilidad (fallo inyectado deja la fila recuperable, re-run limpio la completa) y role-guard (write-back nunca como owner/BYPASSRLS) probados por harness de integración; todo fallo va a Sentry + pino, nunca silenciado. UAT live-R2 en staging confirmó round-trip + observabilidad de fallo (2026-06-30) (MEDIA-04).
- **Seed "Brigos Recoleta" (Fase 3)** — seed determinista e idempotente (`seedId = uuidv5` + `onConflictDoNothing`): org + proyecto `publicado`, 13 pisos / 38 unidades con curva de venta pozo, 2 price_lists USD, planes CAC con refuerzos semestrales, cac_index de 18 meses, 3 brokers, 14 leads con timeline, galerías/obra y events cruzando ≥2 particiones mensuales (SEED-01/02/03).
- **Seed con media real + gate de idempotencia (Fase 3)** — 13 imágenes de stock libre subidas por el pipeline REAL R2+worker con mediaId determinista y cycle-safe (compone `@imbau/storage`, sin ciclo db↔api); gate run-twice de invariancia de filas + RLS-correctness siempre encendido; UAT live-R2 2/2 verde (2026-07-01: 13/13 media con variants+blurhash+dims, segunda corrida sin filas nuevas) (SEED-04).

---

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
