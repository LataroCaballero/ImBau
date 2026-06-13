# CLAUDE.md — Showroom 3D para preventa en pozo

Contexto para Claude Code. Leer antes de cualquier tarea. El documento maestro es `docs/modelo-mvp.md` (copiar desde la carpeta del proyecto de Cowork); ante conflicto, manda este archivo.

## Qué es este proyecto

SaaS para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: showroom web mobile-first (explorador del edificio por pisos, ficha de unidad, cotizador con financiación argentina, avance de obra, leads por WhatsApp) + panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Competidores: Urbania3D, Hauzd, Web3D. Diferenciales: entrega en semanas (no meses), cotizador financiero argentino (USD + cuotas CAC), alertas de interés accionables.

**Regla de alcance A/B:** solo se construye lo marcado `[A]` en modelo-mvp.md (table stakes + cotizador, válido para cualquier cliente). Lo `[B]` (específico del design partner Pablo) NO se construye hasta tener su feedback. Ante la duda, preguntar antes de agregar alcance.

## Estándar de calidad — NO negociable

El código es la carta de presentación del producto. Nunca elegir el atajo de prototipo:

- TypeScript estricto (`strict: true`, sin `any` salvo justificación comentada).
- Todo cambio pasa lint + type-check + tests antes de commit. CI roja = no se mergea.
- `packages/quoting` (motor de cotización): funciones puras sin I/O, cobertura 100% exigida, property-based tests además de unitarios. Un error de cálculo acá mata el producto.
- Migraciones de DB versionadas (Drizzle), nunca cambios manuales al schema.
- RLS en toda tabla con tenant. La web pública solo lee proyectos `publicado` vía rol `anon`.
- Performance es feature: presupuesto de peso por página, imágenes AVIF/WebP con srcset, Lighthouse budget en CI. Target: <3s en 4G en gama media.
- Errores manejados y observables (Sentry + logs estructurados con pino), nunca silenciados.

## Stack (decidido — no proponer alternativas salvo bloqueo real)

- Monorepo pnpm + Turborepo. Apps: `apps/web` (pública), `apps/panel`, `apps/worker`. Packages: `packages/db`, `packages/api`, `packages/quoting`, `packages/ui`, `packages/config`.
- Next.js App Router (RSC; ISR en la web pública), tRPC + Zod, PostgreSQL 16 + Drizzle (RLS multi-tenant: organizations → projects), Better Auth, BullMQ + Redis, Cloudflare R2 + sharp (variantes de imagen en worker), SSE vía Postgres LISTEN/NOTIFY (precios/estados en vivo), PDFs server-side en worker, React Email + Resend.
- Visor 360: Photo Sphere Viewer (lazy). Hotspots: polígonos SVG como datos (editor en panel). Sin motores 3D tipo game engine — decisión de producto, no técnica.
- Testing: Vitest + Playwright. Observabilidad: Sentry + OpenTelemetry, Grafana/Loki, Uptime Kuma.
- Infra: Docker Compose + Traefik (TLS on-demand para dominios custom). CI/CD GitHub Actions: deploy automático a staging (`staging.tours.andescode.com.ar`), manual a prod. Backups Postgres con pgBackRest/wal-g a B2/R2.

## Modelo de datos

Esquema lógico completo en `docs/modelo-mvp.md` §3.3: organizations, memberships, users, projects, floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events (particionada por mes).

## Convenciones

- Idioma: código, identificadores y commits en inglés; UI y docs en español (es-AR, trato de "vos").
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`...). Ramas: `fase-N/descripcion`.
- Moneda: precios en USD enteros (centavos no aplican al rubro); cuotas en ARS. Nunca floats para dinero — enteros o decimal.
- Fechas/horas en UTC en DB, render en `America/Argentina/Buenos_Aires`.
- Seed de desarrollo: edificio ficticio ~13 pisos estilo "Brigos Recoleta" con unidades, listas de precios y planes de pago realistas.

## Plan de fases (orden ventana-Fable)

0 infra+auth+multitenancy → 1 schema+media+seed → 3 cotizador → 4 panel → 2 explorador+ficha → 5 portada/obra/galería/brokers → 6 métricas+alertas+QA. Detalle y estimaciones en `docs/modelo-mvp.md` §3.6. Cada fase termina desplegada en staging, no "funcionando en mi máquina".

## Comandos (mantener actualizado a medida que existan)

- `pnpm dev` — levanta todo (turbo). `pnpm test` / `pnpm lint` / `pnpm typecheck`.
- `pnpm db:migrate` / `pnpm db:seed` — migraciones y seed.
- `docker compose up -d` — Postgres, Redis y servicios locales.

<!-- GSD:project-start source:PROJECT.md -->

## Project

**ImBau — Showroom 3D para preventa en pozo**

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra, leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Lo construye Lautaro (Andescode) con desarrollo AI-first; el documento maestro de producto es `docs/modelo-mvp.md`.

**Este ciclo GSD (milestone v1) cubre únicamente la fase 0 del plan maestro:** monorepo, CI/CD, Docker Compose + staging, observabilidad, y auth + multi-tenancy + RLS. Cada fase del modelo-mvp.md será su propio milestone GSD, en el orden ventana-Fable: 0 → 1 → 3 → 4 → 2 → 5 → 6.

**Core Value:** La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging (`staging.tours.andescode.com.ar`) con aislamiento multi-tenant verificable por RLS — no "funciona en mi máquina".

### Constraints

- **Tech stack**: Decidido y no negociable salvo bloqueo real — monorepo pnpm + Turborepo, Next.js App Router (RSC/ISR), tRPC + Zod, PostgreSQL 16 + Drizzle (RLS), Better Auth, BullMQ + Redis, Cloudflare R2 + sharp, SSE vía LISTEN/NOTIFY, Vitest + Playwright, Sentry + OTel + pino, Docker Compose + Traefik, GitHub Actions.
- **Calidad**: TypeScript estricto sin `any` injustificado; todo cambio pasa lint + type-check + tests antes de commit; RLS en toda tabla con tenant; errores observables, nunca silenciados. NO negociable.
- **Performance**: <3s en 4G en gama media; presupuesto de peso por página y Lighthouse budget en CI (aplica desde que haya web pública).
- **Idioma**: código, identificadores y commits en inglés; UI y docs en español (es-AR, voseo).
- **Convenciones**: Conventional Commits; ramas `fase-N/descripcion`; dinero en enteros/decimal (nunca floats), USD enteros para precios, ARS para cuotas; UTC en DB, render en America/Argentina/Buenos_Aires.
- **Timeline**: fase 0 estimada en 3-4 días con Fable; regla de control si supera la semana.
- **Presupuesto**: staging ~USD 0 sobre infra existente; free tiers de Sentry/Resend suficientes para el MVP.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies (versions verified on npm, 2026-06-12)

| Technology | Version | Purpose | Why / phase-0 note |
|------------|---------|---------|--------------------|
| **pnpm** | `11.6.0` | Package manager + workspaces | Pin via `packageManager` field in root `package.json` + Corepack so CI and local match exactly. |
| **Turborepo** | `2.9.18` | Monorepo task orchestration + caching | `turbo.json` with `tasks` (not the legacy `pipeline` key). Use `turbo prune` for Docker (see Architecture). |
| **TypeScript** | `5.9.x` | Strict typing end-to-end | **Do NOT jump to TS 6.x blindly** (npm `latest` shows `6.0.3`). TS 6 is the new native/perf line; verify every tool (ESLint TS plugin, Drizzle Kit, Next) supports it before adopting. **Pin TS `5.9.x` for phase 0** — safest with the rest of the matrix. `strict: true`, `noUncheckedIndexedAccess: true`. |
| **Node.js** | `22 LTS` (`>=20.9` required by Next) | Runtime | Use Node 22 LTS in CI and Docker base images. Pin in `.nvmrc` + `engines`. |
| **Next.js** | `16.2.x` | `apps/web` (public, RSC + ISR) and `apps/panel` | App Router. Set `output: 'standalone'` for Docker. Requires React 19. |
| **React** | `19.2.x` | UI runtime for both Next apps | Matches Next 16. tRPC v11 + TanStack Query v5 are React-19 compatible. |
| **tRPC** | `11.17.0` (`@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`) | Typed API in `packages/api` | v11 has first-class App Router + RSC support and native TanStack Query v5 integration. No codegen. |
| **Zod** | `4.4.x` | Validation at the tRPC boundary + env parsing | tRPC v11 supports Zod 4. Use `z.input`/`z.output` awareness; Zod 4 changed some error/format APIs vs v3 — write new code against v4 idioms. |
| **PostgreSQL** | `16.x` | Primary DB, multi-tenant via RLS | Pin the **Postgres 16** image tag (`postgres:16-alpine`) in Compose — do not float to 17/18. |
| **Drizzle ORM** | `drizzle-orm 0.45.2` | Schema, queries, **RLS policies as code** | Native `pgPolicy` / `pgRole` support. See RLS pattern below. |
| **Drizzle Kit** | `drizzle-kit 0.31.10` | Versioned migrations + role/policy generation | Set `entities.roles: true` in `drizzle.config.ts` so policies/roles are emitted into migrations. |
| **Better Auth** | `better-auth 1.6.18` | Sessions + organizations + memberships + email invites | Use the built-in **organization plugin** + **access control** for roles. CLI: `@better-auth/cli`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **postgres** (porsager) | `3.4.9` | Postgres driver for Drizzle | **Recommended driver.** Lightweight, fast, clean transaction API ideal for the per-request RLS transaction pattern. Use this over `pg` for app queries. |
| **drizzle-zod** | `0.8.3` | Derive Zod schemas from Drizzle tables | Keep tRPC input/output validation in sync with the schema without duplication. |
| **@tanstack/react-query** | `5.101.0` | Client cache for tRPC in the panel | Required peer for `@trpc/tanstack-react-query`. v5 (not v4 — v4 is for tRPC v10). |
| **bullmq** | `5.78.0` | Background jobs in `apps/worker` | Phase 0 only needs the wiring/skeleton + a health job; heavy jobs (sharp, PDFs) land in later phases. |
| **ioredis** | `5.11.1` | Redis client for BullMQ | BullMQ's expected client. |
| **pino** | `10.3.1` | Structured logging | Phase-0 observability requirement. JSON logs → Loki via Promtail/Alloy. Use `pino-pretty` only in dev. |
| **@sentry/nextjs** | `10.57.0` | Error + perf monitoring (web/panel) | Wire from first deploy. Free tier is sufficient for MVP. Use a separate Sentry SDK for the worker. |
| **@opentelemetry/sdk-node** | `0.219.0` | Tracing (worker + API) | Phase-0: minimal trace exporter; deepen in later phases. |
| **resend** + **react-email** | `resend 6.12.4`, `@react-email/components 1.0.12` | Transactional email (org invitations) | Phase 0 needs invitation emails for memberships. |
| **@aws-sdk/client-s3** | `3.10xx` | S3-compatible client for Cloudflare R2 | Skeleton/config in phase 0; media pipeline is phase 1. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **ESLint** | Lint gate in CI | npm `latest` is `10.x`. **Verify flat-config + `typescript-eslint` support** for whatever ESLint major you pick; if the TS-ESLint stack lags, pin ESLint `9.x` (flat config) for stability in phase 0. |
| **Vitest** | `4.1.8` — unit tests (later: quoting at 100%) | Phase 0 sets up the runner + coverage gate; the quoting suite is phase 3. |
| **@playwright/test** | `1.60.0` — e2e of auth/tenancy flows | Phase-0 e2e: login, create org, invite member, RLS isolation smoke test. |
| **Docker + Compose** | Local + staging parity | Compose: Postgres 16, Redis, web, panel, worker, Traefik, Loki/Grafana, Uptime Kuma. |
| **Traefik** | `v3.x` | Reverse proxy + ACME TLS (incl. on-demand for custom client domains) | See Architecture for cert-resolver config. |
| **GitHub Actions** | CI/CD | Lint+typecheck+test → build Docker images → registry → auto-deploy staging, manual prod. |

## Installation

# Pin pnpm via corepack (root package.json: "packageManager": "pnpm@11.6.0")

# --- Core (workspace root / shared) ---

# --- apps/web & apps/panel ---

# --- packages/db ---

# --- auth (likely packages/api or apps/* depending on layout) ---

# --- apps/worker ---

# --- dev / tooling (root) ---

## RLS + Auth integration (the load-bearing decision)

### Pattern: transaction-scoped session variable + a dedicated non-superuser app role

### Better Auth organization plugin config (verified against official docs)

- Plugin creates `organization`, `member`, `invitation` tables and adds `activeOrganizationId` to `session`. The session's `activeOrganizationId` is exactly the value to feed into the RLS GUC.
- Mirror `ac`/roles in the client via `organizationClient`.
- Run Better Auth's migration/generate (`@better-auth/cli`) and **commit the generated schema into your Drizzle schema** so all DDL stays versioned in one migration history (don't let two migration systems fight).

## Alternatives Considered (configuration-level, within the decided stack)

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `postgres` (porsager) driver | `pg` (`8.21.0`) | If a dependency requires the `pg` pool interface specifically. `pg` works with Drizzle too, but `postgres` has a cleaner transaction API for the per-request RLS pattern. |
| TS `5.9.x` for phase 0 | TS `6.0.x` (npm latest) | Once the whole tool matrix (typescript-eslint, drizzle-kit, next) confirms TS 6 support. Adopt deliberately, not by floating `latest`. |
| ESLint `9.x` flat config (if TS-ESLint lags) | ESLint `10.x` | Once `typescript-eslint` ships a stable major for ESLint 10. |
| HTTP-01 ACME challenge for custom domains | DNS-01 challenge | Use DNS-01 only if you need a **wildcard** cert (ACME wildcards require DNS-01). For per-client custom domains via CNAME, HTTP-01 on-demand is simpler. |
| Transaction-scoped `SET LOCAL` GUC RLS | Schema-per-tenant / DB-per-tenant | Only if a future enterprise client demands physical isolation. For MVP, RLS in a shared schema is correct (matches modelo-mvp.md §3.1). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Turborepo `pipeline` key in `turbo.json` | Renamed to `tasks` in Turborepo 2.x; `pipeline` is removed. | `"tasks": { ... }` |
| TanStack Query **v4** with tRPC v11 | v4 pairs with tRPC v10; v11 needs v5. Mixing causes type/runtime breakage. | `@tanstack/react-query@5` + `@trpc/tanstack-react-query@11` |
| Running app/tests as Postgres **superuser** or a `BYPASSRLS` role | Silently bypasses RLS — broken policies look like they work; tenant leak ships. | Dedicated `app_authenticated` / `anon` NOSUPERUSER NOBYPASSRLS roles. |
| Letting the app role **own** RLS tables without `FORCE ROW LEVEL SECURITY` | Table owners bypass RLS by default → policies ignored. | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table (or separate owner role). |
| `SET` (session-level) for the tenant GUC | Persists on a pooled connection → cross-request tenant leak. | `set_config(..., true)` / `SET LOCAL` inside a transaction. |
| `pnpm install --prod` inside `.next/standalone` | Breaks the @vercel/nft-traced `node_modules` (pnpm symlinks). | Trust `output: 'standalone'` tracing; copy the traced tree as-is. |
| Two competing migration histories (Better Auth auto-migrate **and** Drizzle Kit both writing DDL at runtime) | Drift + conflicts between systems. | Generate Better Auth schema, fold it into Drizzle schema, run **all** DDL through Drizzle Kit migrations. |
| Neon-only helpers (`crudPolicy`, `authUid()`) | They target Neon/Supabase managed roles; this is self-hosted Postgres. | Raw `pgPolicy` + `current_setting()` expressions. |
| Manual schema edits in Postgres | Violates CLAUDE.md (versioned migrations only). | Drizzle Kit migrations, reviewed in PR. |

## Architecture-adjacent configuration notes (phase 0)

- `next.config`: `output: 'standalone'`.
- Multi-stage Dockerfile per app: a **prune stage** runs `turbo prune <app> --docker` → `./out` (pruned workspace + pruned lockfile); an **install/build stage** runs `pnpm install --frozen-lockfile` then `turbo build`; a slim **runner stage** copies `.next/standalone`, `.next/static`, and `public`. Do not re-run `pnpm install --prod` inside standalone.
- Use a Node 22 Alpine base for the runner.
- One ACME **certResolver** using **HTTP-01** challenge (Let's Encrypt). Persist `acme.json` (chmod 600) on a volume.
- Per-app routers derive their cert from the router's `Host()` rule — so a new client custom domain (added via CNAME → label/dynamic config) triggers an on-demand cert request with no infra change. This delivers the "dominios custom por CNAME sin tocar infra" requirement.
- For a single wildcard (`*.tours.andescode.com.ar`) you'd need DNS-01 instead; for arbitrary client domains, stick with per-domain HTTP-01.
- Anonymous insert endpoints (`events`, `leads`) get a Traefik rate-limit middleware at the edge (per modelo-mvp.md §3.3).
- Cache Turborepo via the GitHub Actions cache (or self-hosted remote cache) keyed on lockfile + `turbo` hash; restore before `turbo run lint typecheck test build`.
- Build images with Buildx + layer cache (`cache-from/cache-to: type=gha`), push to a registry, then deploy to the VPS (SSH `docker compose pull && up -d`). Auto on merge to `main` → staging; manual `workflow_dispatch` → prod.

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `next@16.2` | `react@19.2`, `react-dom@19.2` | Next 16 requires React 19. Node `>=20.9` (use 22 LTS). |
| `@trpc/*@11.17` | `@tanstack/react-query@5`, `zod@4`, React 19 | v11 = TanStack Query **v5** only; Zod 4 supported. |
| `drizzle-orm@0.45` | `drizzle-kit@0.31`, Postgres 16, `postgres@3` / `pg@8` | Keep ORM + Kit majors aligned; `entities.roles:true` needed for RLS DDL. |
| `better-auth@1.6` | `drizzle-orm@0.45` via `drizzleAdapter`, Postgres 16 | Organization plugin tables; adapter `joins` opt-in since 1.4. Use matching `@better-auth/cli`. |
| `bullmq@5.78` | `ioredis@5.11`, Redis 7 | Pin Redis 7 image in Compose. |
| `typescript@5.9` | typescript-eslint, drizzle-kit, next 16 | **Do not** float to TS 6 until each tool confirms support. |
| `vitest@4` / `@playwright/test@1.60` | Node 22 | Standard. |

## Sources

- npm registry (`npm view <pkg> version`), 2026-06-12 — exact current versions of every package above. **HIGH**
- [Drizzle ORM — Row-Level Security](https://orm.drizzle.team/docs/rls) — `pgRole`, `pgPolicy`, `using`/`withCheck`, `entities.roles`, default-deny, self-hosted caveats. **HIGH**
- [Better Auth — Organization plugin](https://better-auth.com/docs/plugins/organization) — plugin setup, `createAccessControl`, roles, `creatorRole`, tables created, `activeOrganizationId`, session hooks. **HIGH**
- [Better Auth — Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — adapter config, `experimental.joins` (since 1.4). **HIGH**
- [PostgreSQL docs — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) + [Bytebase — RLS footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — owner bypass, `FORCE ROW LEVEL SECURITY`, BYPASSRLS/superuser, testing gotcha. **HIGH**
- [ECOSIRE — Drizzle + Postgres RLS multi-tenancy (2026)](https://ecosire.com/blog/drizzle-orm-postgres-rls-multitenancy) + [OneUptime — RLS for multi-tenant](https://oneuptime.com/blog/post/2026-01-25-row-level-security-postgresql/view) — `SET LOCAL` / `set_config(...,true)` transaction-scoped GUC, pooling safety. **MEDIUM** (cross-checked against PG docs → effectively HIGH).
- [Turborepo — Docker guide](https://turborepo.dev/docs/guides/tools/docker) + [pnpm + Next standalone + Docker](https://dev.to/kochan/pnpm-nextjs-standalone-docker-5-failures-before-success-part-9-g3o) — `turbo prune --docker`, standalone tracing, avoid `pnpm install --prod` in standalone. **HIGH** (official) / **MEDIUM** (blog).
- [Traefik — ACME cert resolvers](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/) — HTTP-01 vs DNS-01, per-router cert derivation, wildcard requires DNS-01. **HIGH**
- [tRPC v11 + Next App Router setup](https://trpc.io/docs) (and 2026 RSC guides) — v11 RSC support, TanStack Query v5 pairing, Zod 4. **MEDIUM/HIGH**

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
