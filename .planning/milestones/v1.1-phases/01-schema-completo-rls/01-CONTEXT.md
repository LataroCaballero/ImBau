# Phase 1: Schema completo + RLS - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Crear las 13 tablas del modelo de datos de `docs/modelo-mvp.md` §3.3 — floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events — en **migraciones Drizzle versionadas**, cada tabla con tenant bajo `FORCE ROW LEVEL SECURITY` + policy por tenant, la web pública (rol `anon` sin BYPASSRLS) leyendo solo filas de proyectos `publicado`, y la **suite de aislamiento cross-tenant existente extendida a todas las tablas nuevas**, verde en CI contra Postgres 16 real.

**Esto es una fase de DATOS, no de superficies de producto.** No se construye: motor de cotización (Fase 3, acá solo el schema de `quotes`), pipeline de media (Fase 2, acá solo la tabla `media`), seed (Fase 3), ni endpoints/UI de ingestión anónima (acá solo las policies que los habilitan a nivel DB).

Se aclara CÓMO implementar lo ya scopeado; toda nueva capacidad va a otra fase.
</domain>

<decisions>
## Implementation Decisions

> **Contexto de autoría:** el usuario delegó explícitamente estas decisiones técnicas ("no tengo tanto conocimiento, tomá vos cuidadosamente las decisiones más óptimas"). Todas las decisiones abajo son discreción del builder, fundamentadas y alineadas con el patrón RLS heredado de v1.0. El researcher/planner pueden ejecutarlas; si la investigación contradice una, debe señalarlo, no silenciarlo.

### Tenant scoping de las tablas project-scoped (D-01)
- **D-01:** Toda tabla con tenant lleva **`organization_id` denormalizado** (columna `text`, FK → `organization.id`, igual tipo que `projects.organization_id` por A1/Pitfall 2) **además** de su FK natural a `project`/parent. La policy de tenant es un **clon plano de `projects_tenant`**: `using`/`withCheck` = `organization_id = current_setting('app.current_organization_id', true)::text`. Se descarta el filtrado por join (`project_id IN (select id from projects where organization_id = GUC)`): mete una subconsulta correlacionada en cada acceso de fila y acopla cada policy a la policy de `projects` (riesgo de cascada). El patrón "tenant_id en cada tabla" mantiene toda policy idéntica, plana y rápida.
- **D-02:** La consistencia del `organization_id` denormalizado se garantiza **estructuralmente con FKs compuestas**, no con triggers ni confianza en la app. `projects` recibe un `UNIQUE (id, organization_id)`; cada tabla hija referencia el par — p.ej. `floors (project_id, organization_id) → projects (id, organization_id)`, `units (floor_id, organization_id) → floors (id, organization_id)`, y así para toda la jerarquía (`unit_prices → unit` y `→ price_list`, ambas compuestas con `organization_id`). Resultado: es imposible insertar una fila cuyo `organization_id` no coincida con el de su parent. La FK compuesta requiere `UNIQUE` en el par del parent.
- **D-03:** Jerarquía de tenencia: `organization` → `projects` (v1.0) → {`floors`, `price_lists`, `payment_plans`, `cac_index`*, `quotes`, `brokers`, `leads`, `progress_posts`, `galleries`, `media`, `events`} → {`units` (vía floor), `unit_prices` (vía unit+price_list)}. Cada una con su `organization_id` denormalizado. (*`cac_index` ver D-09.)

### Particionado de `events` por mes (D-04)
- **D-04:** `events` es **RANGE-partitioned por mes sobre `ts`**, con el DDL escrito a mano en una migración SQL siguiendo el patrón ya establecido de `migrations/0001_rls.sql` (Drizzle no emite `PARTITION BY`). La tabla padre se declara en el schema Drizzle para tipos/consumo, pero el `PARTITION BY RANGE (ts)` y las particiones viven en SQL a mano en la MISMA historia de migraciones (single journal, una sola ruta `db:migrate` — invariante heredado de v1.0).
- **D-05:** La migración crea las particiones del mes actual + los próximos 2-3 meses, **más una `DEFAULT PARTITION`** como red de seguridad: ningún insert falla nunca por falta de partición (observabilidad sobre pérdida silenciosa — un insert que cae en la default es un evento a monitorear, no un error 500).
- **D-06:** Un **job repetible de BullMQ en `apps/worker`** (que ya es un shell BullMQ desde v1.0) pre-crea la partición del mes entrante (idempotente). En Phase 1 alcanza con el skeleton del job + las particiones de la migración; retención/detach de particiones viejas es trabajo posterior. **Se descarta `pg_partman`**: extensión extra innecesaria a escala MVP; particiones mensuales a mano + job chico quedan 100% dentro de nuestra historia de migraciones.
- **D-07:** RLS sobre `events`: `FORCE ROW LEVEL SECURITY` + policy de tenant se declaran sobre la **tabla padre particionada** (Postgres propaga RLS a las particiones vía el padre). `organization_id` denormalizado también en `events`.

### Insert anónimo de `leads` y `events` (D-08)
- **D-08:** `anon` recibe **GRANT INSERT-only** (sin SELECT) sobre `leads` y `events`. Son tablas privadas del tenant: el sitio público las escribe (captación de leads / analytics) pero **nunca las lee**; solo el rol `app_authenticated` las lee/actualiza vía su policy de tenant. Esto cierra de raíz la enumeración cross-tenant de leads/eventos por el rol público.
- **D-09:** La **policy INSERT del rol `anon`** lleva un `WITH CHECK` que solo permite insertar filas cuyo `project_id` pertenezca a un proyecto **`publicado`** (p.ej. `EXISTS (select 1 from projects p where p.id = project_id and p.organization_id = events.organization_id and p.estado = 'publicado')`). Anon no puede escribir contra proyectos `borrador`/`archivado`. El par `(project_id, organization_id)` ya está garantizado íntegro por la FK compuesta (D-02); la policy agrega la compuerta `publicado`.
- **D-10:** Validación **Zod en el boundary** (drizzle-zod donde aplique) para los payloads de insert anónimo, como defensa en profundidad antes de llegar a la DB. (El endpoint de ingestión en sí NO se construye en esta fase — es API de Fase 2+; acá quedan las policies + los schemas Zod listos.)
- **D-11:** **Rate-limit: NO se implementa en esta fase** (no hay todavía endpoint público de ingestión). Se documenta para downstream: con staging en nginx-host, no Traefik (D-01 de v1.0), el rate-limit de los endpoints anónimos irá en **nginx (`limit_req`)** y/o un limiter app-level respaldado por Redis/ioredis (ya en el stack) en los procedimientos tRPC anónimos. La garantía de Phase 1 es a nivel DB: `WITH CHECK publicado-only` + sin SELECT para anon.

### JSONB tipado + alcance de `quotes` (D-12)
- **D-12:** **Todo JSONB es tipado** vía Drizzle `jsonb().$type<T>()` + schema Zod co-localizado (nada de `jsonb` suelto). Los schemas Zod viven en `packages/db` y se re-exportan para que API/panel validen antes de escribir.
  - `payment_plans.refuerzos`: `$type<Refuerzo[]>()` — array de refuerzos `{ cuota: number; montoUsd: number }` (montos USD enteros, regla de dinero).
  - `leads.timeline`: `$type<LeadNote[]>()` — timeline append-only `{ ts: string; autor?: string; nota: string; estadoPrev?: LeadEstado; estadoNuevo?: LeadEstado }`.
- **D-13:** `quotes.snapshot` se bloquea como **envelope versionado**: `jsonb().$type<QuoteSnapshot>()` con `QuoteSnapshot = { version: 1; ... }`. Phase 1 fija el contrato del sobre (campo `version` + FKs estructurales: `project`, `unit`, `payment_plan`, `lead?`, `pdf` storage key) **sin** definir la forma interna del cálculo — esa la posee `packages/quoting` en Fase 3 y puede evolucionarla bumpeando `version` **sin migración** de la tabla. "Bloquear lo justo": estructura estable hoy, cálculo flexible mañana. El motor de cálculo NO se construye acá.

### Tipos de dinero y enums (D-14, D-15)
- **D-14:** Dinero (regla CLAUDE.md, se pinea acá): precios USD = `integer` (USD enteros, sin centavos en el rubro). `cac_index.valor` = `numeric`/decimal (el índice CAC es un valor decimal). Las cuotas ARS las computa el cotizador (Fase 3) — en el schema no hay columnas de cuota ARS sueltas; lo que persista ARS va como decimal/`numeric`, nunca float.
- **D-15:** Estados como `pgEnum` (patrón heredado; valores de DATO en español, identificadores en inglés): `unidad_estado [disponible|reservado|vendido]`, `lead_estado [nuevo|contactado|negociacion|cerrado]`, `galeria_seccion [amenities|exteriores|interiores]`, `ajuste_tipo [CAC|fijo]`, `moneda [USD|ARS]` (price_lists). Reusa el `estado` de projects ya existente.

### Suite de aislamiento (D-16)
- **D-16:** La suite `packages/db/tests/cross-tenant.test.ts` se **extiende a toda tabla nueva** manteniendo el patrón actual: asertar AUSENCIA (cero filas de la otra org) como rol app/anon NO privilegiado, casos (a) read A→B, (b) read B→A, (c) write cross-tenant falla (INSERT lanza 42501 / UPDATE afecta 0 filas), (d) anon ve `publicado`, cero `borrador`. Para `leads`/`events`: agregar el caso de **insert anónimo permitido contra `publicado` y rechazado contra `borrador`**, y que anon NO tenga SELECT. Esta suite verde en CI es la puerta de salida (SCHEMA-08).

### Claude's Discretion
Las 16 decisiones de arriba fueron tomadas por el builder bajo delegación explícita del usuario. El researcher debe **re-verificar contra versiones pineadas** (Drizzle `pgPolicy`/`pgRole`, FKs compuestas, sintaxis de partición declarativa + RLS sobre tabla particionada en Postgres 16, `$type` + drizzle-zod) y señalar cualquier conflicto en RESEARCH.md en vez de silenciarlo. Si alguna decisión resulta inviable con el stack pineado, escalar antes de planear, no improvisar.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Modelo de datos (fuente de verdad del schema)
- `docs/modelo-mvp.md` §3.3 — esquema lógico completo de las 13 tablas (campos, enums, relaciones, qué tablas aceptan insert anónimo + rate limit). Fuente de verdad de QUÉ tablas/campos existen.
- `docs/modelo-mvp.md` §3.4 — el cotizador; contexto de qué consumirá `quotes.snapshot` en Fase 3 (informa D-13, no se implementa acá).
- `CLAUDE.md` — estándar de calidad NO negociable, regla de dinero (enteros/decimal, USD/ARS), RLS en toda tabla con tenant, migraciones versionadas. Ante conflicto con modelo-mvp, manda CLAUDE.md.

### Patrón RLS heredado de v1.0 (el código ES el contrato — clonar, no reinventar)
- `packages/db/src/with-tenant.ts` — helpers `withTenant`/`withAnon`, GUC transaction-scoped vía `set_config(..., true)` parametrizado. Únicos accesos sancionados; las tablas nuevas se consultan a través de ellos.
- `packages/db/src/schema/projects.ts` — patrón de referencia de `pgPolicy` tenant (`projects_tenant`) + anon published-only (`projects_anon_published`). Las policies nuevas son clones planos de estas.
- `packages/db/src/schema/roles.ts` — `appAuthenticated`/`anonRole` como `pgRole(...).existing()` para targetear policies con `to:`.
- `packages/db/migrations/0001_rls.sql` — SQL a mano para lo que Drizzle no emite: `CREATE ROLE` (LOGIN NOSUPERUSER NOBYPASSRLS), GRANTs scopeados, `FORCE ROW LEVEL SECURITY`. El DDL de partición de `events` (D-04) sigue ESTE patrón de migración a mano en el mismo journal.
- `packages/db/src/schema/index.ts` — barrel; toda tabla/enum/policy/role nuevos se re-exportan acá. Ojo: `drizzle.config.ts` apunta a los archivos fuente concretos (no al barrel) para evitar policies duplicadas — agregar cada archivo de schema nuevo al array `schema:`.
- `packages/db/drizzle.config.ts` — `entities.roles: true`, `out: ./migrations`, lista explícita de archivos de schema (actualizar al agregar tablas).
- `packages/db/tests/cross-tenant.test.ts` + `tests/helpers.ts` + `tests/setup.ts` — suite de ausencia + fixtures (`makeOrg`/`makeProject`/...) + guard de rol no privilegiado. Se extiende (D-16), no se reescribe.
- `packages/db/migrate.ts` — única ruta de migración (`db:migrate`).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withTenant` / `withAnon` (`packages/db/src/with-tenant.ts`): acceso de datos para toda tabla nueva; las nuevas policies funcionan automáticamente bajo el GUC que estos setean. No crear helpers nuevos.
- `pgPolicy` tenant + anon de `projects.ts`: plantilla literal para las ~12 policies nuevas (clonar `using`/`withCheck` con el cast `::text`).
- Roles `.existing()` de `roles.ts`: reusar `appAuthenticated`/`anonRole` como targets; no redeclarar roles en Drizzle (atributos reales viven en SQL a mano).
- Fixtures de tests (`makeOrg`, `makeProject`, `makeMember`): extender con `makeFloor`, `makeUnit`, `makeLead`, etc., mismo estilo (insert vía owner, ids únicos sin rollback).

### Established Patterns
- **Split de migraciones:** `000N_init.sql` generado por drizzle-kit + `000N+1_*.sql` a mano para DDL que Drizzle no expresa (roles, FORCE RLS, particiones), TODO en un único journal Drizzle, una sola `db:migrate`. Nunca `push` ni cambios manuales.
- **Cast `::text` del GUC:** `organization.id` es TEXT (default Better Auth), no uuid — toda policy de tenant castea `current_setting(...)::text`. Un `::uuid` haría pasar los tests de ausencia por la razón equivocada (Pitfall 2). `organization_id` denormalizado es TEXT en toda tabla nueva.
- **Idempotencia del SQL a mano:** bloques `DO/IF NOT EXISTS`, password DEV-only env-guardado (`imbau.env <> 'production'`) — replicar para el SQL de particiones/grants nuevos.
- **Valores de enum en español, identificadores en inglés.**

### Integration Points
- `apps/worker` (shell BullMQ de v1.0): host del job repetible de mantenimiento de particiones de `events` (D-06).
- `packages/db/src/schema/*` + barrel + `drizzle.config.ts`: cada tabla nueva se suma en los tres lugares.
- CI (gate `quality`, Postgres 16 real, roles sin BYPASSRLS): la suite extendida (D-16) corre acá; verde = puerta de salida.
</code_context>

<specifics>
## Specific Ideas

- El usuario no tiene preferencias técnicas sobre el schema y delegó las decisiones al builder; el norte es "lo más óptimo" respetando el estándar de calidad NO negociable de CLAUDE.md (sin atajos de prototipo, RLS real, migraciones versionadas, errores observables).
- "Bloquear lo justo" en `quotes.snapshot`: envelope versionado estable hoy, forma interna del cálculo flexible para Fase 3 sin re-migrar (D-13).
- Preferencia por garantías **estructurales** (FK compuestas, DEFAULT partition, INSERT-only sin SELECT) sobre garantías por convención/confianza-en-la-app.
</specifics>

<deferred>
## Deferred Ideas

- **Endpoints/API de ingestión anónima de leads/events** + su rate-limit (nginx `limit_req` y/o limiter Redis app-level) — Fase 2+ cuando exista la superficie pública; acá solo quedan las policies DB + schemas Zod (D-11).
- **Retención/detach/archivado de particiones viejas de `events`** — posterior; Phase 1 solo crea particiones + job de pre-creación del mes entrante (D-06).
- **Motor de cotización (`packages/quoting`)** y la forma interna de `quotes.snapshot` — Fase 3 (D-13).
- **Pipeline de media (R2 + sharp + blurhash)** — Fase 2; acá solo la tabla `media` con sus columnas (original/variantes keys, dims, blurhash) y RLS.
- **Seed del edificio "Brigos Recoleta"** — Fase 3.
- **Scraping automático del CAC** — modelo-mvp §3.3: carga manual mensual primero.

None — la discusión se mantuvo dentro del scope de la fase (datos + RLS).
</deferred>

---

*Phase: 1-Schema completo + RLS*
*Context gathered: 2026-06-26*
