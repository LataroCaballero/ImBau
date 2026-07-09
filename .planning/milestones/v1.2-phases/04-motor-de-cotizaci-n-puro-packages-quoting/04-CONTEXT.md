# Phase 4: Motor de cotización puro (`packages/quoting`) - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

`packages/quoting` pasa de placeholder a motor completo: puro, determinista, sin I/O, emitiendo un `QuoteResult` tipado por modalidad (contado / financiado CAC) que es el contrato del que dependen UI (fase 6), PDF (fase 7) y WhatsApp. Incluye los serializers puros (`toWhatsAppText`, `toPdfModel`), el helper de comparación (`compareQuotes`) y el formateador es-AR compartido — todo dentro del perímetro de 100% cobertura + property-based tests (fast-check). Exporta `ENGINE_VERSION`.

Fuera de esta fase: cualquier I/O (DB, tRPC, persistencia de snapshot — fase 5), UI (fase 6), render/worker de PDF (fase 7). Sin cambios de schema.

</domain>

<decisions>
## Implementation Decisions

### Regla de redondeo y asignación de resto (ENGINE-05)
- **D-01 Granularidad USD:** anticipo, cuota-parte USD y refuerzos se expresan en **USD enteros** (dólares completos, sin centavos) — consistente con `unit_prices.precio` int y "centavos no aplican al rubro" (CLAUDE.md). La reconciliación exacta (anticipo + Σcuotas + Σrefuerzos = precio financiado) se verifica en enteros.
- **D-02 Asignación de resto:** cuota base = **floor(saldo / N)**; las N−1 primeras cuotas son iguales a la base y la **última cuota absorbe el resto** (última ≥ base, nunca menor). Regla nombrada, documentada y testeada como función pura.
- **D-03 Redondeo del anticipo:** anticipo = precio financiado × `anticipoPct`, redondeado **half-up a dólar entero**; el saldo compensa (saldo = precio − anticipo − Σrefuerzos), de modo que la reconciliación cierra exacta.
- **D-04 Cuota ARS:** la cuota expresada en ARS "al valor del mes" (cuota USD × `cac_index.valor`) se emite en `QuoteResult` como **decimal exacto a 2 decimales** (regla "ARS decimal" de CLAUDE.md; decimal.js, nunca float). Las tres superficies muestran ese valor sin re-redondear.

### Semántica de refuerzos
- **D-05 Moneda de refuerzos:** los refuerzos se pagan en **USD fijo** tal como los declara el plan (`refuerzos[].montoUsd` int) — **sin ajuste CAC**. `QuoteResult` los lista en USD.
- **D-06 Posición en el cálculo:** los refuerzos **descuentan del saldo financiado antes de dividir en cuotas** (saldo = precio − anticipo − Σrefuerzos), como ya implica el invariante de ENGINE-04.
- **D-07 Planes degenerados:** el motor **rechaza con error tipado de dominio** (ej. `SALDO_NO_POSITIVO`, `REFUERZO_FUERA_DE_PLAZO`, índices duplicados). Nunca emite una cotización dudosa ni normaliza silenciosamente; la superficie decide cómo presentarlo.
- **D-08 Forma en el resultado:** cronograma de refuerzos = índice de cuota + monto USD. **Sin fechas calendario** (dependerían del boleto; no se proyecta nada).

### Contrato QuoteInput / QuoteResult
- **D-09 Precio contado:** `QuoteInput` recibe **dos precios ya resueltos** (precio de la lista contado y precio de la lista financiado, según el modelo real `price_lists` + `unit_prices`). El motor **no calcula descuentos** — el "descuento contado" es la diferencia entre listas, política del developer expresada en sus precios. Cero lógica de pricing en el motor.
- **D-10 Un resultado por modalidad:** `calcQuote` emite **un `QuoteResult` por modalidad** (contado: sin plan/cuotas; financiado: anticipo + cuotas CAC + refuerzos). La comparación contado-vs-financiado son **dos corridas** del motor (coincide con la redacción de UI-03).
- **D-11 Cifras de comparación:** el paquete exporta un **helper puro `compareQuotes(contado, financiado)`** que calcula las cifras derivadas (ahorro USD y %) tipadas y 100% cubiertas — las superficies nunca recomputan.

### Alcance del paquete en esta fase
- **D-12 Motor completo:** esta fase entrega `calcQuote` + `compareQuotes` + `toWhatsAppText` + `toPdfModel` + **formateador es-AR compartido** (server y cliente, mismo output en ambos runtimes — pitfall ICU/U+202F). Todo puro, todo dentro del gate de 100% cobertura. Front-loadea la lógica densa en la ventana Fable; el copy puede ajustarse en las fases de superficie sin romper el contrato.
- **D-13 Política de ENGINE_VERSION:** **solo bumpean la versión los cambios de semántica de cálculo** (fórmula, redondeo, regla de resto). Cambios de copy en serializers NO bumpean. Garantía: misma versión + mismos inputs ⇒ mismos números.

### Claude's Discretion
- Tipado de `QuoteResult` como **unión discriminada por `modalidad`** (`'contado' | 'financiado'`) con campos específicos por variante (elección técnica derivada de D-10).
- Formato de `ENGINE_VERSION`: **entero incremental**, arranca en 1.
- Modelo de error tipado (union de códigos vs clase de error vs Result type) — elegir el idioma más natural para TS estricto + tRPC downstream; lo importante es D-07 (rechazo explícito, tipado, exhaustivo).
- Nombres exactos de funciones/tipos, estructura interna del paquete, estrategia de generadores fast-check.
- Copy inicial de `toWhatsAppText` (resumen corto, WA-01: resumen + link, no la tabla completa) y forma del modelo de `toPdfModel` — borradores razonables; se validan contra sus superficies en fases 6/7.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec de producto y requirements
- `docs/modelo-mvp.md` §3.4 — spec del motor: entrada (unidad + lista de precios + plan + CAC vigente), cálculo (precio base → anticipo → cuotas CAC → refuerzos), salida tipada única, snapshot completo
- `.planning/REQUIREMENTS.md` — ENGINE-01..06 (los 6 requirements de esta fase) + Out of Scope (nunca proyectar CAC, nunca FX inventado, no tabla de amortización completa)
- `.planning/ROADMAP.md` — Phase 4 goal + success criteria (5 criterios verificables)

### Research del milestone (completo, confianza HIGH — no repetir research)
- `.planning/research/SUMMARY.md` — decisión CAC-como-multiplicador, stack (decimal.js@10.6.0, fast-check@4.8.0 + @fast-check/vitest@0.4.1), arquitectura del motor
- `.planning/research/PITFALLS.md` — float en boundary numeric→string de Drizzle (parsear directo a Decimal, jamás parseFloat), regla de resto sin nombre, property tests que se auto-validan, drift es-AR ICU
- `.planning/research/STACK.md` — versiones exactas y anti-patrones (no dinero.js v2, no coverage global 100%, gate scoped a `packages/quoting/vitest.config.ts`)
- `.planning/research/ARCHITECTURE.md` — componente 1: superficie del paquete (calcQuote, serializers, ENGINE_VERSION)

### Schema consumido (tipos de entrada — sin cambios de schema en esta fase)
- `packages/db/src/schema/payment-plans.ts` — `anticipoPct` numeric (llega como string), `cuotas` int, `ajuste` enum CAC|fijo, `refuerzos` JSONB tipado
- `packages/db/src/schema/json-schemas.ts` — `refuerzoSchema` ({cuota: int, montoUsd: int}), `quoteSnapshotSchema` (envelope `{version: 1}` passthrough — el interior lo posee este paquete)
- `packages/db/src/schema/cac-index.ts` — `valor` numeric(12,4) (llega como string), `periodo` "YYYY-MM"
- `packages/db/src/schema/unit-prices.ts` — `precio` int USD, un precio por unidad por lista
- `packages/db/src/schema/price-lists.ts` — listas por proyecto con `moneda` (el par contado/financiado del que salen los dos precios de D-09)
- `packages/db/src/schema/quotes.ts` — la tabla donde fase 5 persistirá el snapshot (contexto del consumidor)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/quoting` ya existe como esqueleto (package.json con lint/typecheck/test, tsconfig, vitest): el placeholder `roundUsd` + su test se reemplazan por el motor real.
- `@imbau/config` ya es devDependency del paquete (tsconfig/eslint compartidos).
- Vitest 4 ya configurado en el workspace; falta agregar `@vitest/coverage-v8` gate al 100% **scoped al paquete** y las devDeps de property testing.

### Established Patterns
- Dinero: `unit_prices.precio` int USD; `anticipoPct` y `cac_index.valor` son `numeric` → **llegan como string desde Drizzle** — el contrato de `QuoteInput` debe aceptar esos tipos tal cual salen del schema (string decimal / int) y parsear directo a decimal.js.
- JSONB tipado con Zod hand-authored (D-12/D-13 de v1.1): el interior del snapshot lo define este paquete; el envelope `{version: 1}` ya está fijado en `quoteSnapshotSchema`.
- Convención de idioma: código/identificadores en inglés, output de usuario (texto WhatsApp, labels del modelo PDF) en es-AR voseo.

### Integration Points
- Fase 5 consume `calcQuote` + `ENGINE_VERSION` desde el `publicProcedure` tRPC y persiste el snapshot en `quotes.snapshot`.
- Fase 6 consume `QuoteResult`, `compareQuotes`, `toWhatsAppText` y el formateador es-AR (server + cliente).
- Fase 7 consume `toPdfModel` desde el worker (render desde snapshot congelado, nunca recompute).
- El paquete NO importa `@imbau/db` en runtime (puro, sin I/O) — pero sus tipos de entrada deben ser estructuralmente compatibles con lo que el schema entrega (los llamadores mapean filas → `QuoteInput`).

</code_context>

<specifics>
## Specific Ideas

- La regla de resto elegida (última cuota absorbe, base floor) fue una elección deliberada del usuario **contra** la recomendación del research (distribuir en las primeras k cuotas) — respetarla; es la práctica bancaria clásica y deja las N−1 cuotas idénticas.
- Cuota ARS con 2 decimales (no peso entero): el usuario prefirió fidelidad al cálculo por sobre la limpieza visual; las superficies muestran el decimal tal cual viene en `QuoteResult`.
- `QuoteResult` por modalidad (no ambas en un objeto): elección deliberada del usuario contra la recomendación — la comparación es responsabilidad de `compareQuotes`, no de un objeto contenedor.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Las superficies consumidoras — persistencia/API, UI, PDF — ya están planificadas como fases 5-7 de este milestone.)

</deferred>

---

*Phase: 4 - Motor de cotización puro (`packages/quoting`)*
*Context gathered: 2026-07-02*
