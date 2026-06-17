# Phase 3: Auth, API & App Surfaces - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Un usuario puede autenticarse, pertenecer a organizaciones con roles, e interactuar con las tres apps leyendo datos por el camino de tenant correcto de extremo a extremo. Esta fase pone el **runtime de auth + la capa de API + las superficies de app** sobre la capa de datos ya cerrada en fase 2 (tablas Better Auth, RLS, `withTenant()`/`withAnon()` son producción y NO se tocan, salvo fixtures de test).

Cubre: AUTH-01 (registro/login email+password vía Better Auth, sesión persistente), AUTH-02 (orgs con roles owner/developer/viewer; la org activa de la sesión determina el tenant), AUTH-03 (owner invita por email con Resend + React Email; el invitado acepta y entra con su rol), APP-01 (`apps/panel` con login + página que lee datos protegidos por RLS de la org activa), APP-02 (`apps/web` lee vía rol `anon` y solo ve proyectos `publicado`), APP-03 (`apps/worker` como shell deployable: BullMQ conectado a Redis, **sin lógica de jobs**), APP-04 (Dockerfile multi-stage por app con `turbo prune` + Next.js standalone que produce imágenes deployables).

**Fuera de esta fase (guardas anti-scope-creep):**
- **Observabilidad** (Sentry, pino→Loki, Uptime Kuma, OTel) = OBS-01/02/03 → **fase 4**. El worker de fase 3 solo conecta BullMQ a Redis; nada de Sentry/pino/OTel todavía.
- **CI build+push de imágenes** (CI-03) y **deploy a staging** (INFRA-01/02/03) = **fase 4**. Fase 3 solo *autora* los Dockerfiles; el build de la imagen se **verifica en CI (fase 4)** porque el entorno local no tiene Docker daemon.
- **CRUD completo** de projects/orgs/members → milestones futuros. Acá solo el set mínimo de procedimientos que prueba cada camino.
- **Diseño visual / design system del showroom** → milestones futuros (ventana-Fable difiere el trabajo dependiente de ojo humano). Las páginas de fase 3 son UI funcional mínima.
- **Schema de dominio completo** (floors/units/precios/quotes/leads/etc.) = SCHEMA-01, milestone futuro.

</domain>

<decisions>
## Implementation Decisions

### Auth runtime & session wiring
- **D-01:** El **runtime de Better Auth vive en `packages/api`**, colocado con tRPC para que el context de tRPC lea la sesión directo. Reusa el mismo Drizzle adapter + organization plugin parados en fase 2 (`packages/db/auth.ts`, hoy CLI-only) — se evoluciona esa config a runtime (baseURL, endpoints, email/password provider) sin duplicar el shape del schema.
- **D-02:** **Sesiones en DB** — la tabla `session` ya existe de fase 2. No se mete Redis como session store en esta fase (optimización diferible).
- **D-03:** El handler de auth y la **UI de login/signup/aceptar-invitación se montan solo en `apps/panel`**. `apps/web` queda anon-only público, sin auth.
- **D-04:** **Sin gate de verificación de email** para fase 0 — la columna `emailVerified` existe pero el login no se bloquea por ella; signup→login sin fricción. Las invitaciones son el camino de email que importa.

### tRPC API shape & tenant/role context
- **D-05:** El **context de tRPC deriva el tenant de la sesión**: `session.activeOrganizationId` → los procedimientos corren dentro de `withTenant(orgId, …)`. Un `protectedProcedure` exige sesión + org activa; un `publicProcedure` usa `withAnon()` para el camino anónimo.
- **D-06:** **Roles owner/developer/viewer se imponen en middleware de tRPC** (`requireRole`) leyendo `member.role` para la org activa, apoyándose en el access control del organization plugin de Better Auth donde calce.
- **D-07:** **Set mínimo de procedimientos** que prueba cada camino — `projects.listForOrg` (protected, tenant-scoped), `projects.listPublished` (public/anon), `org.setActive`/list, `member.invite` (owner-only) + `invitation.accept`. **Sin CRUD completo.**
- **D-08:** **RSC + cliente**: tRPC server-side caller para reads en RSC (dashboard de panel, listado de web); hooks de TanStack Query v5 en cliente para mutations interactivas (invitar). Consistente con stack (tRPC v11 + TanStack Query v5, App Router/RSC).

### Invitations & transactional email
- **D-09:** **Fallback de email en dev**: cuando `RESEND_API_KEY` está ausente, se loguea el link/email de invitación a consola (vía el logger disponible); Resend real solo en staging. Mantiene el dev local funcionando con cero dependencias externas (mismo espíritu que diferir tests de DB a CI / no Docker local).
- **D-10:** **Flujo de aceptación con el plugin**: el link cae en panel `/accept-invitation/[id]` y usa el `acceptInvitation` built-in del organization plugin. Usuarios nuevos hacen signup primero y luego aceptan; usuarios existentes loguean y aceptan.
- **D-11:** **Una plantilla React Email mínima** (es-AR, voseo) para la invitación — funcional, nivel fundación, sin diseño branded.
- **D-12:** **Solo el owner invita** (AUTH-03); el invitador elige el rol entre owner/developer/viewer; default sugerido = `viewer`.

### App-surface UI scope & Docker delivery
- **D-13:** **UI funcional mínima** (plana, accesible, es-AR voseo) — NO el diseño del showroom. El pulido visual se difiere (ventana-Fable). Reuso mínimo de `packages/ui`.
- **D-14:** **`apps/web`**: una **lista de proyectos publicados** (nombre/slug/estado) vía `withAnon`/rol `anon` — lo justo para probar el camino anónimo (APP-02). Página de detalle opcional.
- **D-15:** **`apps/panel`**: login → **dashboard con los proyectos de la org activa** (read tenant-scoped) + sección de miembros/invitar. Prueba APP-01 + AUTH-02/03.
- **D-16:** **Dockerfile multi-stage por app** (stage prune `turbo prune <app> --docker` → install/build → runner slim Node 22 Alpine; Next standalone para web/panel, output de tsup para worker). Autorados en fase 3; el **build de imagen se verifica en CI (fase 4)** porque no hay Docker daemon local.

### Claude's Discretion
- Estructura interna de la carpeta tRPC en `packages/api` (routers, context, middleware), nombres exactos de los routers/procedimientos más allá del set mínimo de D-07.
- Forma concreta de evolucionar `packages/db/auth.ts` a runtime en `packages/api` (re-export vs nueva instancia que importa la misma config de plugin/adapter), siempre que el schema no diverja de fase 2.
- Layout exacto de las páginas de panel/web, qué componentes mínimos van a `packages/ui` vs locales a la app.
- Detalles del catch-all route handler de Better Auth en Next App Router y del cliente de auth (`organizationClient`) en el panel.
- Mecánica fina de los Dockerfiles (orden de capas, cache mounts) dentro del patrón prune→build→standalone-runner de CLAUDE.md.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Producto y alcance
- `CLAUDE.md` — Estándar de calidad NO negociable (TS estricto sin `any`; lint+typecheck+tests antes de commit; RLS en toda tabla con tenant; errores observables). Stack decidido (tRPC v11 + Zod 4 + TanStack Query v5; Better Auth org plugin; Next 16 App Router RSC; `output: 'standalone'`). Convenciones (idioma EN en código/commits, UI/docs es-AR voseo; ramas `fase-N/descripcion`).
- `CLAUDE.md` §"RLS + Auth integration (the load-bearing decision)" — `session.activeOrganizationId` → GUC; organization plugin (`createAccessControl`, roles); fold del schema BA en Drizzle (ya hecho en fase 2).
- `CLAUDE.md` §"What NOT to Use" — TanStack Query **v5** con tRPC v11 (no v4); no dos historias de migración; no helpers Neon; no `pnpm install --prod` dentro de `.next/standalone` (confiar en el tracing de standalone).
- `CLAUDE.md` §"Architecture-adjacent configuration notes (phase 0)" — Dockerfile multi-stage: prune (`turbo prune <app> --docker`) → install/build (`pnpm install --frozen-lockfile` + `turbo build`) → runner slim copiando `.next/standalone` + `.next/static` + `public`; base Node 22 Alpine.

### Planning
- `.planning/REQUIREMENTS.md` — AUTH-01/02/03, APP-01/02/03/04 (alcance exacto). OBS-* / CI-03 / INFRA-* = fase 4 (no adelantar). v2 = fuera.
- `.planning/ROADMAP.md` — Success criteria de la fase 3 y dependencia hacia fase 4 (staging/CI/observabilidad).
- `.planning/STATE.md` — Blocker registrado: re-verificar APIs nuevas (Better Auth org plugin runtime) contra versiones pineadas; `member` vs `memberships` ya resuelto en fase 2 (D-02). Regla de control de fase 0: si el milestone supera 1 semana, recalibrar.
- `.planning/phases/02-data-layer-rls/02-CONTEXT.md` — Decisiones de la capa de datos que esta fase consume: `organization` (BA org plugin) ES el tenant (IDs TEXT, no UUID); `member` canónica con roles; `withTenant()`/`withAnon()`; GUC `app.current_organization_id`; config mínima de BA en `packages/db/auth.ts` reusable por el runtime.

### Stack pineado (verificado en el repo por el scout, 2026-06-17)
- pnpm `11.6.0`, Turborepo `2.9.18`, TypeScript `5.9.3` (NO subir a 6.x), Node `>=22`, Next `16.2.9`, React `19.2.7`, `better-auth 1.6.18` (runtime) + `@better-auth/cli 1.4.21` (dev), `drizzle-orm 0.45.2`, driver `postgres 3.4.9`, Zod `4.4.3`. **tRPC NO instalado todavía** (lo agrega fase 3: `@trpc/server`+`@trpc/client`+`@trpc/tanstack-react-query` `11.17.0`, `@tanstack/react-query 5`). Resend `resend 6.x` + `@react-email/components 1.x` (invitación).
- `pnpm-workspace.yaml` tiene `overrides.better-call: 1.3.6` (fix de peer compat BA CLI 1.4.21 + runtime 1.6.18) y `allowBuilds` (sharp/esbuild). Respetar.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/db` (cerrado, no tocar salvo fixtures): exporta `withTenant`, `withAnon`, `appDb`, `anonDb`, `createOwnerDb`, `schema`. La config CLI-only de Better Auth vive en `packages/db/auth.ts` (Drizzle adapter + organization plugin con `additionalFields.plan`). IDs de org son **TEXT**. Policies: `projects_tenant`, `projects_anon_published`, `member_tenant`, `organization_self`. Roles `app_authenticated` (DML) y `anon` (SELECT-only publicado).
- `packages/api`: hoy placeholder tipado (`apiPackage`). Acá aterriza el runtime de Better Auth + el router/context/middleware de tRPC.
- `packages/config/env/presets.ts`: presets `baseEnv` (NODE_ENV), `dbEnv` (`DATABASE_URL` owner, `DATABASE_APP_URL` app, `DATABASE_ANON_URL` anon), `redisEnv` (`REDIS_URL`). **Faltan** presets de auth (Better Auth secret/baseURL, `RESEND_API_KEY`) — fase 3 los agrega. Sentry preset = fase 4.
- `apps/web` y `apps/panel`: Next 16 ya scaffoldeados, `output: 'standalone'` ya seteado, `transpilePackages` + turbopack root pinned, env validado al import. Solo tienen una status page. `apps/panel` corre en :3001, `apps/web` en :3000.
- `apps/worker`: shell que valida env y loguea boot ok; build con tsup. **Sin** BullMQ/ioredis todavía (los agrega fase 3 como shell).
- `packages/ui`: solo `AppStatus`; design system stub. UI funcional mínima de fase 3 reusa/extiende mínimamente.

### Established Patterns (a respetar)
- **JIT packages**: exports apuntan a `src/*.ts(x)` crudo, sin build interno. tRPC en `packages/api` se consume así desde las apps.
- **Env por app, fail-fast** (Zod al boot): cada app declara solo las vars que usa, componiendo presets. `apps/panel` necesitará el preset de auth; `apps/web` el de anon DB; `apps/worker` el de redis.
- **Migraciones versionadas, nunca push/manual**. Si fase 3 necesita tocar el schema (no debería: las tablas BA ya están), va por `drizzle-kit generate` + `migrate`.
- **Rama de fase**: `fase-0/...` (el milestone v1 corre sobre `fase-0/foundation`).
- **Compose**: Postgres 16 (`:5432`) y Redis 7 (host `:6380`→`6379`) ya levantan con `docker compose up -d`.

### Integration Points
- Fase 4 (CI/staging/observabilidad) consume los Dockerfiles autorados acá (CI-03 los buildea/pushea; INFRA los deploya), corre los tests de aislamiento RLS contra el Postgres service de GitHub Actions, y agrega Sentry/pino/Uptime Kuma sobre las apps que fase 3 deja corriendo.
- El context de tRPC alimenta `withTenant()`/`withAnon()` desde `packages/db` con `session.activeOrganizationId`.
- El worker (BullMQ+ioredis) se conecta al `REDIS_URL` del Compose.

</code_context>

<specifics>
## Specific Ideas

- **Guarda de scope dura**: el worker de fase 3 es solo shell (BullMQ↔Redis, sin jobs); Sentry/pino/OTel y Uptime Kuma son fase 4. Los Dockerfiles se autoran pero su build se verifica en CI (fase 4) — el entorno local no tiene Docker daemon (no intentar `docker build` local).
- **Colisión de puertos local**: `apps/web`:3000 y `apps/panel`:3001 chocan con otro proyecto del usuario (CLINICAL) que ocupa esos puertos. Si hace falta correr ambas apps localmente para validar el login/flow, parar CLINICAL o reasignar puertos de dev — no es bloqueante para el build/CI.
- **IDs TEXT, no UUID**: el tenant GUC y todo FK contra `organization` castea `::text` (decisión cerrada en fase 2). El runtime de tRPC pasa el `activeOrganizationId` (text) a `withTenant`.
- **Idioma**: identificadores, código y commits en inglés; copy de UI y el email de invitación en es-AR voseo.
- **Versiones**: pinear tRPC `11.17.0` + TanStack Query `5` (no v4 con v11). No subir TS a 6.x ni ESLint a 10. Respetar `overrides.better-call` del workspace.

</specifics>

<deferred>
## Deferred Ideas

- Redis como secondary storage de sesiones de Better Auth — optimización; fase 3 usa sesiones en DB (D-02).
- Verificación de email obligatoria en signup — diferida (D-04); la columna existe para activarla después.
- CRUD completo de projects/orgs/members, página de detalle de proyecto en web, gestión avanzada de roles — milestones futuros; fase 3 solo el set mínimo.
- Build/push de imágenes Docker y deploy a staging (CI-03, INFRA-01/02/03) y observabilidad (OBS-01/02/03) — **fase 4**.
- Design system real / pulido visual del showroom — milestones futuros (ventana-Fable).

</deferred>

---

*Phase: 3-Auth, API & App Surfaces*
*Context gathered: 2026-06-17 (smart discuss, autonomous mode)*
