# Phase 5: Emisión y persistencia server-side (API + RLS + rate limit) - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Un comprador anónimo dispara la emisión de una cotización cuyo cómputo y persistencia corren server-side: un `quotesRouter` nuevo en `packages/api` con `publicProcedure`s tRPC que resuelven la org del proyecto `publicado` (revalidada en cada request), leen precios/plan/CAC vía `withTenant`, corren `calcQuote` (fase 4) y persisten el snapshot completo (inputs resueltos + outputs + `ENGINE_VERSION`) en `quotes.snapshot` — sin agregar ninguna policy anon a `quotes`/`cac_index` (quedan tenant-private) y con rate limit nginx `limit_req` en el edge (QUOTE-01/02/03). Incluye resolver la Key Decision A1-vs-A2 (dónde vive el pool `app`) y definir el contrato de queue PDF en `packages/storage` del que depende la fase 7.

Fuera de esta fase: UI del cotizador y cliente tRPC de `apps/web` como superficie visible (fase 6 — acá solo se monta el route handler), render/worker de PDF y el enqueue real de jobs (fase 7), creación de leads (milestone futuro). Sin cambios de schema.

</domain>

<decisions>
## Implementation Decisions

> El usuario delegó explícitamente todas las decisiones técnicas de esta fase a Claude ("son cosas muy técnicas que se escapan"). Las decisiones siguientes son elecciones de Claude fundadas en el research del milestone (ARCHITECTURE/PITFALLS, confianza HIGH) y las convenciones ya validadas del proyecto — el planner las trata como locked igual que decisiones de usuario.

### Superficie del API y semántica de emisión
- **D-01 Dos procedures:** `quotesRouter` expone `quotes.compute` (efímero: resuelve, computa y devuelve `QuoteResult` — **sin escritura a DB**) y `quotes.create` (computa Y persiste el snapshot, devuelve `quoteId` + `QuoteResult`). Sigue el diseño del research (ARCHITECTURE.md §flow). "Cotización emitida" (QUOTE-02) = las creadas por `create`; los computes interactivos de la UI (fase 6) no persisten — evita el write-amplifier de spam (Pitfall 6).
- **D-02 Cuándo se emite:** `create` se dispara cuando el comprador acciona (CTA WhatsApp / pedido de PDF — el cableado UI llega en fase 6). Esta fase entrega ambos procedures funcionando y testeados vía caller; la fase 6 decide desde qué interacción llama a cada uno.
- **D-03 Resolución de org server-side:** ambos procedures reciben IDs (proyecto/unidad/plan) + parámetros del comprador (anticipo/plazo dentro de bounds), resuelven la org con `withAnon` (`SELECT ... FROM projects WHERE id = ? AND estado = 'publicado'`) **revalidando en cada request**, y recién entonces abren `withTenant(orgId)` para leer `unit_prices`/`payment_plans`/`cac_index` e insertar. Jamás un orgId provisto por el cliente; jamás precios/CAC del request body (el server re-lee siempre — Pitfall 5).
- **D-04 Snapshot PII-free:** `snapshot` = inputs financieros resueltos + `QuoteResult` + `ENGINE_VERSION` + período CAC usado. Ningún dato de contacto del comprador entra al snapshot — el contacto vive en `leads` (fase futura) linkeado por `quotes.leadId` (Pitfall 6).
- **D-05 Validación al borde:** inputs con Zod en el procedure; el insert pasa por `quoteInsertSchema` (envelope `{version: 1}` ya fijado). Errores del motor (`QuoteError` tipado de fase 4) se propagan como errores de dominio, nunca se normalizan en silencio.

### A1 vs A2 — dónde vive el pool `app` (Key Decision abierta desde v1.2 roadmap)
- **D-06 Se resuelve A1:** `apps/web` gana `DATABASE_APP_URL` en el bloque `server` de su `env.ts` y monta su propio route handler tRPC (`app/api/trpc/[trpc]/route.ts`, espejo del panel). Amplía D-03 de v1.1: web deja de ser "anon-only" pero SOLO a través de `withTenant` dentro de procedures del `quotesRouter` — el fence es que `apps/web` (y todo router) sigue importando únicamente `withTenant`/`withAnon`/`schema` de `@imbau/db`, nunca `appDb`/`createOwnerDb` (grep-verificable, mismo patrón T-03-09). Registrar como Key Decision en PROJECT.md al cerrar la fase, actualizando el comentario de `apps/web/env.ts` que hoy documenta el anon-only.

### CAC vigente y superficie de errores
- **D-07 "CAC vigente" = último período cargado:** se toma `max(periodo)` de `cac_index` para la org (no el mes calendario estricto) — el índice CAC se publica con rezago y la carga es manual en el MVP (COTIZ-F04 difiere la ingesta automática); exigir el mes corriente rompería la cotización la mitad del tiempo. El `periodo` usado queda registrado en los inputs del snapshot.
- **D-08 Errores claros, tipados, observables:** sin ningún CAC cargado para la org → `TRPCError` con código semántico (`PRECONDITION_FAILED`) y mensaje es-AR accionable ("No hay índice CAC cargado para este proyecto..."); inputs inválidos / plan degenerado → `BAD_REQUEST` reusando los códigos de `QuoteError` (fase 4) como código machine-readable en `data`. Nunca un 500 críptico (success criterion 1); el error se loguea (pino) y se reporta (Sentry) sin filtrar internals al cliente.
- **D-09 Sin cutoff de staleness:** si el último CAC es viejo, se cotiza igual — la leyenda "no vinculante" + el período visible (fase 6) cubren el caso. No inventar validaciones de frescura en el MVP.

### Rate limit en el edge (QUOTE-03)
- **D-10 Solo nginx en el MVP:** `limit_req` per-IP (`limit_req_zone $binary_remote_addr` en el contexto `http{}`) aplicado en un `location` dedicado al path tRPC de quotes (`^~ /api/trpc/quotes`) del vhost **web** únicamente — sigue el patrón ya pre-documentado (comentado) en `deploy/nginx/staging.tours.andescode.com.ar.conf`. Sin token bucket Redis in-app (defensa en profundidad diferida). Vhosts existentes y prod intactos, igual que en 04-07.
- **D-11 Valores punto-de-partida:** zona `quotes` con `rate=10r/s burst=20 nodelay` (el ejemplo ya documentado en el vhost) — soporta el uso interactivo de compute (fase 6) y corta ráfagas de bot; respuesta 429. Los números exactos son ajustables en planning/UAT sin cambiar la decisión.
- **D-12 Verificación:** aplicación a mano en el VPS (como 04-07: sites-available + `nginx -t` + reload), y un burst de `curl` que demuestre el 429 como paso de UAT humano — el limit vive en infra, no es automatizable en CI. El archivo de conf versionado en `deploy/nginx/` es la fuente de verdad.

### Contrato de queue PDF (dependencia de fase 7)
- **D-13 Contrato sí, producer no:** esta fase agrega a `packages/storage` el contrato del pipeline PDF — `QUOTE_PDF_QUEUE`, `QuotePdfJobData` (`{quoteId, organizationId, projectId}`), `quotePdfKey()`, `quotePdfJobOptions()` — con el mismo patrón "shared contract, no bullmq import" de `queue.ts`. `quotes.create` **NO encola jobs todavía**: el enqueue se cablea en fase 7 junto con el processor (evita jobs huérfanos acumulándose en Redis mientras no existe consumidor).

### Claude's Discretion
- Números finales de rate/burst del `limit_req` (D-11 es punto de partida).
- Forma exacta del shape de error tRPC (`data` payload, mapping QuoteError→TRPCError code por código).
- Nombres de funciones/archivos, estructura interna del router, helper compartido de resolución proyecto→org si compute/create lo repiten.
- Estrategia de tests (caller de integración contra Postgres real reusando el patrón de `trpc-tenant.test.ts` + seed "Brigos Recoleta"; qué se mockea y qué no).
- Si `compute` y `create` comparten un core interno único (recomendado: sí, una función privada `resolveAndQuote` que create extiende con el insert).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec de producto y requirements
- `docs/modelo-mvp.md` §3.4 — spec del cotizador: cómputo server-side, snapshot completo, auditabilidad
- `.planning/REQUIREMENTS.md` — QUOTE-01/02/03 + Out of Scope (nunca policies anon sobre `quotes`/`cac_index`; un quote no es lead)
- `.planning/ROADMAP.md` — Phase 5 goal + 3 success criteria verificables + la nota A1-vs-A2

### Research del milestone (confianza HIGH — no repetir research)
- `.planning/research/ARCHITECTURE.md` — flujo compute/create con withTenant, componente `quotesRouter`, Pattern 1 (snapshot versionado server-authoritative), estructura recomendada (`packages/api/src/trpc/routers/quotes.ts`)
- `.planning/research/PITFALLS.md` — Pitfall 1 (numeric→string, jamás parseFloat), **Pitfall 5 (el #1 de integración: anon no puede leer CAC ni escribir quotes — todo server-side vía withTenant)**, Pitfall 6 (spam/PII: rate limit + snapshot PII-free + persistir solo al commit), Pitfall 7 (nunca recompute desde IDs — snapshot es la verdad)
- `.planning/research/STACK.md` — versiones y anti-patrones del milestone
- `.planning/research/SUMMARY.md` — decisión CAC-como-multiplicador y arquitectura general

### Contrato del motor (fase 4 — consumidor directo)
- `.planning/phases/04-motor-de-cotizaci-n-puro-packages-quoting/04-CONTEXT.md` — D-01..D-13 del motor (QuoteResult por modalidad, QuoteError tipado, ENGINE_VERSION entero, D-09: el motor recibe precios ya resueltos)
- `packages/quoting/src/` — `calcQuote`, `QuoteInput`/`QuoteResult`, `QuoteError` (7 códigos), `ENGINE_VERSION` — la fase 5 mapea filas de DB → `QuoteInput` (numeric strings directo a decimal)

### Seams RLS y API existentes (patrones a clonar)
- `packages/db/src/with-tenant.ts` — `withTenant`/`withAnon`, los ÚNICOS helpers de acceso a datos sancionados (GUC parametrizado transaction-scoped)
- `packages/api/src/trpc/routers/projects.ts` — el patrón publicProcedure + withAnon (listPublished) y protectedProcedure + withTenant a espejar
- `packages/api/src/trpc/context.ts` + `packages/api/src/trpc/init.ts` — contexto/procedures base; el quotesRouter se registra en `routers/_app.ts`
- `packages/api/tests/trpc-tenant.test.ts` — patrón de caller de integración contra Postgres real para los tests del router
- `packages/db/src/schema/quotes.ts` — tabla + `quoteInsertSchema` (envelope validado); tenant-private, NO tocar policies
- `packages/db/src/schema/cac-index.ts`, `payment-plans.ts`, `unit-prices.ts`, `price-lists.ts`, `json-schemas.ts` — los inputs que el server re-lee vía withTenant
- `apps/panel/app/api/trpc/[trpc]/route.ts` + `apps/web/env.ts` — el mount tRPC a espejar en web y el env.ts cuyo comentario anon-only (D-03 v1.1) se amplía con A1

### Infra (rate limit)
- `deploy/nginx/staging.tours.andescode.com.ar.conf` — vhost staging con el patrón `limit_req` pre-documentado (zona en http{}, location dedicado); reglas de aplicación a mano (jamás `certbot --nginx`, prod intacto)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withTenant`/`withAnon` (`packages/db/src/with-tenant.ts`): exactamente el seam que QUOTE-01 exige — cero código RLS nuevo.
- `quoteInsertSchema` (`packages/db/src/schema/quotes.ts`): validación del snapshot envelope ya lista para el insert.
- `packages/quoting` completo (fase 4): `calcQuote` + `QuoteError` + `ENGINE_VERSION`; el router solo mapea filas → `QuoteInput`.
- Seed "Brigos Recoleta" (unidades publicadas + listas + planes CAC + cac_index): fixtures reales para los tests de integración del router.
- Mount tRPC del panel (`app/api/trpc/[trpc]/route.ts`): plantilla directa para el mount de web (A1).
- Patrón "shared contract, no bullmq import" de `packages/storage/src/queue.ts`: molde para el contrato `QUOTE_PDF_QUEUE` (D-13).

### Established Patterns
- Routers importan SOLO `withTenant`/`withAnon`/`schema` de `@imbau/db` — nunca `appDb`/`createOwnerDb` (T-03-09, grep-verificado). El quotesRouter y el fence A1 heredan esta regla.
- `numeric` de Drizzle llega como string (`anticipoPct`, `cac_index.valor`) — parsear directo a decimal, jamás `parseFloat` (Pitfall 1).
- Env tipado con presets por app (`@imbau/config`): agregar `DATABASE_APP_URL` a web sigue el molde de `dbEnv`.
- Cambios al vhost nginx se versionan en `deploy/nginx/` y se aplican a mano en el VPS (04-07); `nginx -t` + reload, prod intacto.

### Integration Points
- `quotesRouter` se registra en `packages/api/src/trpc/routers/_app.ts`; fase 6 lo consume desde el cliente tRPC nuevo de `apps/web` (que estrena mount en esta fase).
- Fase 7 consume `quotes.snapshot` persistido + el contrato `QUOTE_PDF_QUEUE` de `packages/storage`; el enqueue en `create` se agrega recién ahí (D-13).
- El `location ^~ /api/trpc/quotes` del vhost web es el punto de aplicación del rate limit; la UI de fase 6 debe tolerar 429 (retry/mensaje).

</code_context>

<specifics>
## Specific Ideas

- El usuario delegó todas las decisiones de esta fase a Claude por ser puramente técnicas — no hay preferencias de producto adicionales a las ya locked en REQUIREMENTS/ROADMAP.
- La nota abierta de STATE.md ("sub-decisión A1-vs-A2 debe resolverse como Key Decision documentada") se resuelve acá con D-06 (A1); el planner debe incluir la actualización de PROJECT.md Key Decisions y del comentario de `apps/web/env.ts`.

</specifics>

<deferred>
## Deferred Ideas

- Token bucket Redis in-app como segunda capa de rate limiting (defensa en profundidad) — reevaluar si el nginx `limit_req` resulta insuficiente en producción.
- Enqueue del job PDF desde `quotes.create` — fase 7 (junto con el processor, D-13).
- Creación de lead al accionar WhatsApp/contacto — fase 5 del plan maestro (milestone futuro); `quotes.leadId` ya deja el slot.
- Ingesta automática del índice CAC (COTIZ-F04) — ya trackeado en Future Requirements.

</deferred>

---

*Phase: 5 - Emisión y persistencia server-side (API + RLS + rate limit)*
*Context gathered: 2026-07-03*
