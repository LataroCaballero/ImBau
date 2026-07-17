# Phase 2: Data Layer + RLS - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

La capa de datos con aislamiento de tenant impuesto por la base de datos, **antes de cualquier código de aplicación**. `docker compose up -d` levanta Postgres 16 + Redis locales (DATA-01). El schema base — `organization` (extendida) → `projects` más las tablas de Better Auth — vive en `packages/db` y se aplica con migraciones Drizzle versionadas (`generate` + `migrate`, nunca `push` ni cambios manuales) (DATA-02). Toda tabla con tenant lleva `FORCE ROW LEVEL SECURITY` con roles de DB dedicados (app sin ownership ni BYPASSRLS; `anon` limitado a proyectos `publicado`) y el contexto de tenant fluye por transacción vía `withTenant()` con `SET LOCAL` (DATA-03). Los tests de ausencia cross-tenant corriendo como rol de app contra Postgres real son la **puerta de salida del milestone** (DATA-04). Requirements: DATA-01, DATA-02, DATA-03, DATA-04.

**Fuera de esta fase:** Better Auth runtime/endpoints/login (fase 3 — acá solo se generan y versionan las *tablas*), tRPC y las apps leyendo datos (fase 3), CI con Postgres service real / staging (fase 4), schema completo del dominio (floors/units/price_lists/payment_plans/quotes/brokers/leads/etc. = SCHEMA-01, milestone futuro), media pipeline, seed del edificio ficticio (SEED-01, milestone futuro).

</domain>

<decisions>
## Implementation Decisions

### Identidad del tenant y tablas de Better Auth
- **D-01:** La tabla `organization` de Better Auth (org plugin) ES el tenant canónico, extendida con la columna `plan` del modelo-mvp. `projects.organization_id` apunta a esa tabla. El GUC de RLS sale directo de `session.activeOrganizationId`. Una sola noción de organización — no hay una `organizations` de dominio separada que sincronizar.
- **D-02:** La tabla de pertenencia es `member` (la que crea el org plugin: `organization_id`, `user_id`, `role`), adoptada como canónica. Los roles `owner`/`developer`/`viewer` viven en `member.role` vía el access control de Better Auth. (El modelo-mvp §3.3 la llama `memberships`; se prioriza no pelear con el plugin. Resuelve el blocker `member` vs `memberships` que marcó STATE.md.)
- **D-03:** Para meter las tablas de Better Auth a la migración de fase 2 sin el runtime de auth (que es fase 3): parar una **config mínima** de Better Auth (adapter Drizzle + organization plugin, sin endpoints ni UI) únicamente para correr `@better-auth/cli generate`, plegar el output al schema Drizzle y versionarlo en la historia de migraciones. Fase 3 reusa esa misma config. Schema fiel a lo que BA espera, una sola historia de migraciones (consistente con CLAUDE.md: "fold Better Auth schema into Drizzle").

### Mecánica de `withTenant()` y role-switching
- **D-04:** El pool de la app se conecta **directamente** como `app_authenticated` (NOSUPERUSER, NOBYPASSRLS, sin ownership de las tablas). `withTenant()` solo abre una transacción y hace `SET LOCAL app.current_organization_id = <orgId>`. Las migraciones corren con un pool/role **owner separado**. El rol de runtime nunca es privilegiado — minimiza la superficie de fuga RLS.
- **D-05:** GUC de tenant: `app.current_organization_id` (namespace `app.*`, custom setting que sobrevive sin estar declarado en `postgresql.conf`). Las policies leen `current_setting('app.current_organization_id', true)::uuid` — el segundo arg `true` (`missing_ok`) evita error si no está seteado, dejando que el filtro caiga en default-deny.
- **D-06:** El camino de lectura pública anónima se expone con un helper **separado** `withAnon()`: abre transacción como rol `anon` (también NOSUPERUSER/NOBYPASSRLS) **sin** setear el GUC de tenant; las policies de `anon` filtran globalmente por `estado = 'publicado'`. API distinta deja explícito en cada call-site qué modelo de seguridad se usa (tenant-scoped vs published-only).

### Harness de tests cross-tenant (DATA-04, puerta de salida)
- **D-07:** Los tests apuntan al **mismo Postgres 16 de Compose** (DATA-01), contra una DB de test dedicada. Cero infra nueva, paridad exacta con dev; en CI (fase 4) se reemplaza el endpoint por el Postgres service de GitHub Actions con la misma config y los mismos tests (sin testcontainers — evita una segunda ruta divergente).
- **D-08:** Aislamiento entre tests: aplicar migraciones + crear roles **una vez** al inicio de la suite; cada test crea sus propias orgs/projects (org A vs org B) con datos únicos y verifica. Refleja cómo corre prod — **no** se usa txn-con-rollback por test porque chocaría con el patrón `SET LOCAL` por transacción del propio código bajo prueba (`withTenant()`).
- **D-09:** El test de ausencia (la puerta de salida) corre **como rol `app_authenticated`** con el GUC seteado a org A y asevera: (a) SELECT sobre `projects` y toda tabla con tenant devuelve **cero filas** de org B (ausencia, no solo "no se rompe"); (b) el caso espejo (B no ve A); (c) un INSERT/UPDATE cross-tenant **falla**; (d) `anon` no ve proyectos en `borrador`. Verifica reads, writes y el camino anon/publicado.

### Alcance del schema en fase 2
- **D-10:** Tablas en la migración de fase 2 (mínimo que prueba la costura RLS de punta a punta): `organization` (extendida con `plan`), `member`, `user` / `session` / `account` / `verification`, `invitation` (Better Auth) y `projects`. floors/units/precios/quotes/leads/events/etc. NO entran — son SCHEMA-01 (milestone futuro).
- **D-11:** Entra ya `projects.estado` como enum `[borrador|publicado|archivado]` **más** la policy del rol `anon` que filtra `estado = 'publicado'` — es parte literal de DATA-03 y `withAnon()` necesita algo concreto que testear.
- **D-12:** Sin seed de dev en fase 2 — las orgs/projects de prueba las crean los fixtures de los tests. El seed del edificio ficticio "Brigos Recoleta" es SEED-01 (milestone futuro), no este.

### Claude's Discretion
- Nombres exactos de los roles más allá de `app_authenticated` / `anon` (p. ej. si el owner/migrador es el rol default de la conexión o uno nombrado), estructura interna de `drizzle.config.ts` (con `entities.roles: true`), y organización de carpetas dentro de `packages/db` (schema, policies, helpers, migraciones).
- Mecánica fina de cómo el pool `postgres` (porsager) abre/cierra la transacción dentro de `withTenant()`/`withAnon()` y cómo se inyecta el `orgId` de forma segura (parametrizado, nunca interpolado, para evitar inyección en el `SET LOCAL`).
- Versión/imagen exacta de Redis en Compose (el stack pide Redis 7) y si se expone health-check; Redis es solo contenedor en fase 2, ningún código de app lo toca todavía.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Producto y alcance
- `CLAUDE.md` — Estándar de calidad NO negociable (RLS en toda tabla con tenant; migraciones versionadas Drizzle; nunca superuser/BYPASSRLS en runtime), stack decidido, convenciones (idioma, commits, ramas `fase-N/descripcion`, dinero, fechas UTC). Ante conflicto con modelo-mvp.md, manda CLAUDE.md.
- `CLAUDE.md` §"RLS + Auth integration (the load-bearing decision)" — patrón transaction-scoped GUC + rol app dedicado no-superuser; config del organization plugin (`activeOrganizationId` → GUC); fold del schema BA en Drizzle.
- `CLAUDE.md` §"What NOT to Use" — footguns críticos: no correr como superuser/BYPASSRLS; `FORCE ROW LEVEL SECURITY` obligatorio (owner bypassea por default); `SET LOCAL`/`set_config(...,true)` nunca `SET` de sesión (pool leak); no dos historias de migración; no helpers Neon (`crudPolicy`/`authUid`).
- `docs/modelo-mvp.md` §3.3 (Modelo de datos) — esquema lógico de `organizations`/`memberships`/`projects` y la regla RLS por tenant + `anon` a `publicado`. §3.1 (multi-tenancy RLS en schema compartido).

### Planning
- `.planning/REQUIREMENTS.md` — DATA-01, DATA-02, DATA-03, DATA-04 (alcance exacto de esta fase). v2 SCHEMA-01/SEED-01 = explícitamente fuera (no adelantar).
- `.planning/ROADMAP.md` — Success criteria de la fase 2 y dependencias hacia fase 3 (auth runtime, apps).
- `.planning/STATE.md` — Blocker registrado: reconciliar `member` (org plugin) vs `memberships` → resuelto en D-02. Re-verificar APIs nuevas (Drizzle `pgPolicy`/`pgRole`, Better Auth org plugin) contra versiones pineadas.
- `.planning/phases/01-monorepo-foundation/01-CONTEXT.md` — Decisiones de fase 1 que esta fase hereda (presets de env, JIT packages, flujo de ramas).

### Stack pineado (research 2026-06-12, sección "Technology Stack" de `CLAUDE.md`)
- Versiones exactas verificadas: Postgres `16-alpine`, Redis 7, `drizzle-orm 0.45.2`, `drizzle-kit 0.31.10` (`entities.roles: true`), driver `postgres` 3.4.9 (porsager), `drizzle-zod 0.8.3`, `better-auth 1.6.18` + `@better-auth/cli`, Vitest 4.1.8. Tabla "Version Compatibility Matrix" para alineación ORM/Kit/PG/driver.
- `CLAUDE.md` "Sources" — Drizzle RLS docs, Better Auth organization/drizzle-adapter docs, PostgreSQL Row Security docs + Bytebase RLS footguns, ECOSIRE/OneUptime `SET LOCAL` GUC pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/config/env/presets.ts`: ya exporta `dbEnv` (`DATABASE_URL`) y `redisEnv` (`REDIS_URL`) como presets parciales Zod. Fase 2 los consume; **nota:** D-04 implica dos connection strings (rol owner/migrador vs `app_authenticated`), así que probablemente haga falta extender `dbEnv` con un segundo string (p. ej. `DATABASE_MIGRATION_URL` o `DATABASE_APP_URL`) — el preset hoy solo tiene `DATABASE_URL`.
- `packages/db/src/index.ts`: hoy es placeholder tipado (D-12 de fase 1). Acá aterriza el schema Drizzle, el driver `postgres`, las policies RLS y los helpers `withTenant()`/`withAnon()`.
- `packages/db/package.json` (`@imbau/db`, type module, JIT exports a `src/*.ts`, sin `dist/`). Agregar deps: `drizzle-orm`, `drizzle-kit` (dev), `postgres`, `better-auth` + `@better-auth/cli`, `drizzle-zod`.

### Established Patterns (de fase 1, a respetar)
- **JIT packages** (D-05 fase 1): los exports apuntan a `src/*.ts` crudo, sin build interno. El schema y los helpers de `packages/db` se consumen así.
- **Env por app, fail-fast** (D-02/D-03 fase 1): cada app declara solo las vars que usa, componiendo presets de `packages/config`. Validación al boot con Zod.
- **Migraciones versionadas, nunca `push`/manual** (CLAUDE.md): `drizzle-kit generate` + `migrate` revisados en PR.
- **Rama de fase:** `fase-0/data-rls` (D-16 fase 1).

### Integration Points
- Fase 3 (auth + apps) reusa la config mínima de Better Auth parada en D-03 para el runtime real, y consume `withTenant()`/`withAnon()` desde `packages/db`. El GUC `app.current_organization_id` lo alimenta `session.activeOrganizationId`.
- Fase 4 (CI) corre exactamente estos mismos tests de aislamiento contra el Postgres service de GitHub Actions (CI-02) — el harness debe ser parametrizable por endpoint/env (D-07).

</code_context>

<specifics>
## Specific Ideas

- El test de ausencia (DATA-04) tiene que ser **de ausencia, no solo de presencia**: conteo cero de filas de la otra org, caso espejo, y writes cross-tenant que fallan. Es la puerta de salida del milestone — no alcanza con "el SELECT no rompe".
- El `orgId` que entra al `SET LOCAL` debe inyectarse de forma segura (parametrizado, no interpolado) — `SET LOCAL` no acepta placeholders directos en todos los drivers, así que usar `set_config('app.current_organization_id', $1, true)` antes que string-building.
- Idioma: identificadores y commits en inglés; el enum de `estado` usa los valores del dominio (`borrador`/`publicado`/`archivado`) tal como los nombra modelo-mvp §3.3.

</specifics>

<deferred>
## Deferred Ideas

- `events` y `leads` con insert anónimo + rate-limit en el edge (Traefik) — se evaluó incluirlos para ejercitar el camino de escritura anónima, pero el modelo los ubica en fases posteriores; quedan para SCHEMA-01 (milestone futuro). El patrón RLS de escritura anónima se valida igual con writes cross-tenant que fallan en D-09.
- Seed de dev mínimo (`pnpm db:seed` con orgs/projects de ejemplo) — diferido; el seed real es SEED-01 (edificio "Brigos Recoleta", milestone futuro).
- Schema completo del dominio (floors, units, price_lists, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events) — SCHEMA-01, milestone futuro.

</deferred>

---

*Phase: 2-Data Layer + RLS*
*Context gathered: 2026-06-15*
