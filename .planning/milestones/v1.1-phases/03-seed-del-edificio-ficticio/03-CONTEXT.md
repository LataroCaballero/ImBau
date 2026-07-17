# Phase 3: Seed del edificio ficticio - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Un seed **determinista, idempotente y re-ejecutable** (`pnpm db:seed`) que puebla TODAS las tablas del schema (Phase 1) con el edificio ficticio **"Brigos Recoleta" (~13 pisos)** usando datos realistas — organización, proyecto `publicado`, floors, units, pricing con CAC, contenido (progress_posts, galleries, brokers), media procesada, y leads/events de muestra — suficiente para poblar panel, web pública y métricas futuras, y documentado en los comandos.

**Esto es una fase de DATOS/FIXTURE, no de superficies de producto.** No se construye: el motor de cotización (Fase 3 del modelo-mvp / próximo milestone GSD — acá solo se siembran pricing/payment_plans/cac_index que consumirá), ni panel/web/explorador/ficha (fases futuras), ni endpoints de ingestión. Se escribe contra el schema y los helpers que ya existen; no se crean tablas ni se toca el schema.

Se aclara CÓMO poblar lo ya scopeado (SEED-01..04). Toda nueva capacidad va a otra fase.
</domain>

<decisions>
## Implementation Decisions

> **Contexto de autoría:** el usuario decidió el **contenido** del seed (es el experto del mercado argentino de preventa en pozo y define qué tan creíble queda la base demo-grade). Las decisiones **técnicas/mecánicas** quedan a discreción del builder, fundamentadas — igual que la delegación explícita de Phase 1. Si la investigación contradice una decisión, señalarlo en RESEARCH.md, no silenciarlo.

### Fidelidad / realismo (D-01, D-02)
- **D-01: Demo-grade creíble, no fixture mínimo.** Nombres, mix de tipologías, copy es-AR y precios coherentes y plausibles para Recoleta; la data debe poder mostrarse en panel/web sin retoque posterior. Razón: la demo wow para Pablo va al final de fase 2-3, las superficies futuras renderizan ESTA data, y el cotizador del próximo milestone calcula sobre estos números — re-sembrar para corregir data es fricción. El esfuerzo de contenido se justifica.
- **D-02: Composición "torre Recoleta típica".** PB con amenities/locales, ~2-4 unidades por piso, mix de tipologías (monoambiente + 1/2/3 ambientes, semipiso/penthouse en los últimos pisos), ~30-40 unidades en total. Distribución de estados con **curva de venta realista de pozo**: pisos bajos más `vendido`, medios `reservado`/`disponible`, altos premium más `disponible`. Orientaciones/m2/ambientes variados y coherentes con la tipología.

### Media de galerías (D-03, D-04, D-05)
- **D-03: Imágenes de stock libre curado.** Fotos libres de arquitectura/interiores estilo Recoleta (Unsplash/Pexels u otra fuente de licencia libre), referenciadas de forma determinista, para galerías (amenities/exteriores/interiores) y avance de obra. El material real de Pablo (**Branch B**) entra después sin re-seed estructural. Documentar la procedencia/licencia de los assets usados.
- **D-04: Media sembrada por el PIPELINE REAL R2 + worker.** El seed sube los bytes originales a R2 (PutObject directo) y encola el procesamiento vía **`registerAndEnqueue`** (`packages/api/src/media/register.ts`, factoreado explícitamente en Phase 2 para el camino del seed); el worker genera variantes AVIF/WebP + blurhash/dims reales. Se ejercita el camino end-to-end — se descartan las filas `media` pre-horneadas y el híbrido por-entorno.
- **D-05: Fail-fast claro si falta infra.** Si se corre `pnpm db:seed` sin R2/worker disponibles, la fase de media **valida los prerequisitos al arrancar y aborta con un error explicativo** (qué falta, cómo proveerlo) — coherente con "errores observables, nunca silenciados". La media es parte del seed demo-grade, no opcional. La documentación del comando lista los prerequisitos (R2 creds + worker corriendo).

### Pricing y CAC (D-06)
- **D-06: Dos price_lists — "Contado" (USD, con descuento) y "Financiado" (USD, precio lista).** Precio realista Recoleta pozo (~USD 2.500-3.500/m2 como orden de magnitud, ajustado por piso/orientación/tipología). `payment_plans`: anticipo ~30% + saldo en cuotas con ajuste **CAC** + refuerzos semestrales (JSONB `Refuerzo[]`, montos USD enteros). `cac_index` con histórico de **12-24 meses** de valores decimales realistas. Dinero en enteros USD / decimal (nunca floats). El seed deja lista la data que el cotizador de Fase 3 consumirá; el motor de cálculo NO se construye acá.

### Leads/events de muestra (D-07)
- **D-07: Narrativa realista variada.** ~10-20 `leads` en distintos estados (`nuevo`/`contactado`/`negociacion`/`cerrado`) con `timeline` de notas (append-only `LeadNote[]`), algunos vía `broker` y otros directos/WhatsApp, con distintos orígenes. `events` distribuidos en los últimos ~2-3 meses (vistas de unidad, aperturas de cotización) **cruzando límites de partición mensual** (ejercita el particionado de Phase 1) para que las métricas muestren tendencias y las futuras alertas de interés — el diferencial del producto — tengan de qué alimentarse. Sembrar algunos `brokers` con slug/whatsapp/email realistas.

### Claude's Discretion (técnico — delegado)
- **Mecanismo de idempotencia (SEED-04):** UUIDs determinísticos (semilla fija) vs upsert por clave natural vs pre-check + skip. Elegir el patrón que garantice que re-ejecutar `pnpm db:seed` no duplica filas, respetando el estándar de calidad.
- **⚠ Tensión a resolver — media + idempotencia:** `registerAndEnqueue` mintea `randomUUID()` para el `mediaId` (`packages/api/src/media/register.ts:52`) → **no determinista**. Re-ejecutar el seed con esa función tal cual duplicaría filas `media` y re-subiría a R2. El planner debe resolverlo: p.ej. un camino de seed que use `insertMediaRow` con un `mediaId` determinístico + `enqueueMedia` (jobId=mediaId dedup ya garantiza que el worker no reprocese), o un pre-check de existencia por clave natural antes de sembrar media. Definir en el PLAN.
- **Estructura y ubicación del script:** dónde vive el seed (`packages/db` es el candidato natural — ya tiene `migrate.ts` y los scripts `db:*`), cómo se expone `pnpm db:seed`, orden de inserción respetando las FKs compuestas `(id, organization_id)` de Phase 1, y cómo el seed obtiene un pool con privilegios de owner para el bootstrap de la org/proyecto vs `withTenant` para las escrituras RLS-scoped.
- **Bytes de las imágenes:** cómo se empaquetan/obtienen los assets de stock (commiteados en el repo vs descargados en build) y el PutObject directo a R2 antes de `registerAndEnqueue`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fuente de verdad del contenido y del schema
- `docs/modelo-mvp.md` §3.3 — esquema lógico de las 13 tablas (campos, enums, relaciones); qué sembrar en cada una. Fuente de verdad de QUÉ columnas existen.
- `docs/modelo-mvp.md` §3.4 — el cotizador; contexto de qué consumirá el pricing/payment_plans/cac_index sembrado (informa D-06; no se implementa acá).
- `CLAUDE.md` — estándar de calidad NO negociable, regla de dinero (enteros USD / decimal ARS), idempotencia/migraciones versionadas, errores observables. Menciona el seed de desarrollo ("edificio ficticio ~13 pisos estilo Brigos Recoleta"). Ante conflicto con modelo-mvp, manda CLAUDE.md.

### Schema + RLS heredado (Phase 1) — clonar patrones, no reinventar
- `.planning/phases/01-schema-completo-rls/01-CONTEXT.md` — las 16 decisiones de schema (FKs compuestas `(id, organization_id)`, JSONB tipado `Refuerzo[]`/`LeadNote[]`, `quotes.snapshot` versionado, enums es-AR, insert anónimo de leads/events). El seed debe respetar estas estructuras.
- `packages/db/src/schema/` — todas las tablas destino: `floors.ts`, `units.ts`, `price-lists.ts`, `unit-prices.ts`, `payment-plans.ts`, `cac-index.ts`, `quotes.ts`, `brokers.ts`, `leads.ts`, `progress-posts.ts`, `galleries.ts`, `media.ts`, `events.ts`, `projects.ts`, `enums.ts`, `json-schemas.ts`.
- `packages/db/src/with-tenant.ts` — `withTenant`/`withAnon`: los accesos RLS-correctos. Las escrituras del seed scopeadas por tenant van por acá (setea el GUC `app.current_organization_id`).

### Pipeline de media (Phase 2) — el seed lo reusa
- `packages/api/src/media/register.ts` — **`registerAndEnqueue`** (camino del seed, factoreado en Phase 2) e `insertMediaRow`. ⚠ Ver tensión de idempotencia en Claude's Discretion (`randomUUID` en línea 52).
- `packages/api/src/media/runtime.ts` — `presignPut`/`headOriginal`/`enqueueMedia` + `r2Bucket()`; clientes S3/BullMQ construidos on-first-use con env fail-closed.
- `packages/storage/src/queue.ts` — `MediaJobData` (payload) y `originalKey(...)` (derivación de la key server-side); jobId=mediaId dedup.
- `packages/db/src/resolve-media.ts` — `resolveMedia` (srcset + blurhash + dims): cómo se leerá la media sembrada desde web/panel; el seed debe dejar las filas resolubles por este helper.
- `apps/worker/src/media.ts` — `processMedia`/`renderVariants`/`reportMediaFailure`: el worker que consumirá los jobs encolados por el seed.

### Comandos / scripts
- `packages/db/package.json` — scripts `db:generate`/`db:migrate`/`db:migrate:deploy`; acá se agrega `db:seed`. Root `package.json` no tiene aún `db:seed`.
- `packages/db/migrate.ts` — patrón de script Node standalone del package db (referencia de estructura para el seed).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`registerAndEnqueue`** (`packages/api/src/media/register.ts`): factoreado EXPLÍCITAMENTE en Phase 2 para el camino del seed ("the seed calls registerAndEnqueue"). El seed sube bytes con PutObject directo y luego llama esto. ⚠ mintea `randomUUID` → resolver idempotencia.
- **`withTenant`** (`packages/db/src/with-tenant.ts`): toda escritura scopeada por tenant del seed pasa por acá (GUC + rol app_authenticated). No crear helpers nuevos.
- **`resolveMedia`** (`packages/db/src/resolve-media.ts`): valida que la media sembrada quede resoluble; útil como aserción de que el seed dejó todo consistente.
- **Fixtures de tests** (`packages/db/tests/helpers.ts`: `makeOrg`/`makeProject`/`makeFloor`/`makeUnit`/...): mismo estilo de construcción de filas; posible base o referencia para el seed (aunque el seed es data demo-grade, no fixtures de test).
- **`originalKey` / `MediaJobData`** (`packages/storage/src/queue.ts`): derivación de key y payload del job.

### Established Patterns
- **FKs compuestas `(id, organization_id)`** (Phase 1 D-02): el seed debe insertar respetando el orden jerárquico `organization → projects → floors → units → ...` y con el `organization_id` denormalizado coincidente, o la FK compuesta rechaza el insert. Esto ordena el seed.
- **Dinero enteros USD / decimal** — nunca floats (CLAUDE.md, Phase 1 D-14).
- **Valores de enum en español, identificadores en inglés** (Phase 1 D-15): `disponible|reservado|vendido`, `nuevo|contactado|negociacion|cerrado`, `amenities|exteriores|interiores`, `CAC|fijo`, `USD|ARS`, `estado` de projects.
- **JSONB tipado + Zod co-localizado** (Phase 1 D-12): `payment_plans.refuerzos` = `Refuerzo[]`, `leads.timeline` = `LeadNote[]`, `quotes.snapshot` = envelope versionado. El seed rellena estas formas.
- **Idempotencia por diseño** (patrón del proyecto): SQL a mano usa `DO/IF NOT EXISTS`; el seed necesita su equivalente re-ejecutable.

### Integration Points
- `packages/db` — host natural del script de seed y del script `db:seed` (junto a `migrate.ts` y `drizzle.config.ts`).
- `apps/worker` — consume los jobs de media encolados por el seed (debe estar corriendo, D-05).
- Cloudflare R2 — destino de los bytes originales + variantes (creds requeridas, D-05).
- `pnpm db:seed` documentado en README/comandos (SEED-04).
</code_context>

<specifics>
## Specific Ideas

- **"Brigos Recoleta"** como nombre/estilo del edificio ficticio (viene de CLAUDE.md y del contexto del proyecto).
- **Demo-grade > fixture:** la vara es "mostrar a un cliente sin retoque", porque la demo wow para Pablo depende de esta base y las superficies futuras la renderizan.
- **Curva de venta de pozo** como criterio para distribuir estados (bajos vendidos → altos disponibles), no reparto al azar.
- **Pipeline real, no atajo:** el usuario eligió ejercitar R2+worker de punta a punta con fail-fast, coherente con "el código es la carta de presentación, sin atajos de prototipo".
- El usuario mantiene la delegación de decisiones técnicas al builder (patrón de Phase 1); el contenido es suyo, la mecánica es del builder.
</specifics>

<deferred>
## Deferred Ideas

- **Material real de Pablo (Branch B)** — renders/fotos/planos reales del edificio: entran post-reunión con Pablo, sin re-seed estructural (el seed usa stock libre curado como stand-in).
- **Motor de cotización (`packages/quoting`)** y la forma interna de `quotes.snapshot` — Fase 3 del modelo-mvp / próximo milestone GSD; el seed solo deja pricing/payment_plans/cac_index consumibles.
- **Superficies de producto** (panel CRUD, web pública, explorador, ficha, métricas, alertas) — fases futuras; el seed las alimenta, no las construye.
- **Scraping automático del CAC** — modelo-mvp §3.3: carga manual mensual primero; el seed carga histórico a mano.
- **Alcance multi-tenant del seed** (segundo org / proyecto `borrador` para ejercitar visualmente published-only) — considerado pero no discutido en profundidad; el seed base es una org + un proyecto `publicado` (SEED-01). Si el planner ve valor demostrativo, puede proponer un proyecto `borrador` adicional, pero no es requisito.

None — la discusión se mantuvo dentro del scope de la fase (poblar el schema existente con contenido demo-grade).
</deferred>

---

*Phase: 3-Seed del edificio ficticio*
*Context gathered: 2026-07-01*
