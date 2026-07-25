# Phase 10: D1 — Grilla de unidades editable + import/export Excel - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

El developer administra precios (matriz unidad × price_list), estados y bulk-edit desde una grilla editable en `proyectos/[id]/unidades`, con round-trip Excel (export → editar → import con preview dry-run) transaccional e idempotente, y los cambios se reflejan en la web pública al instante. Es la superficie de mayor valor del panel y la de mayor riesgo (dinero); establece el patrón `withTenant` + `requireRole` + parse puro que D2 (Phase 11) y hotspots (Phase 12) reutilizan.

Requirements: GRID-01 .. GRID-07.

Reemplaza únicamente el cuerpo del placeholder `proyectos/[id]/unidades/page.tsx` cableado en Phase 9 (contrato ya heredado: `params.id` validado, proyecto resuelto por RLS, layout de tabs montado). NO toca leads ni hotspots.

</domain>

<decisions>
## Implementation Decisions

### Vigencia e historial de precios
- **D-01:** El edit de precio es un **UPSERT de una sola fila por unidad×lista** (`UNIQUE(unit_id, price_list_id)` — migración Drizzle versionada). El edit pisa `precio` y actualiza `vigencia = now()` (semántica "vigente desde"). **No** se guarda historial multi-fila en `unit_prices` (rompería el UNIQUE y obligaría a reescribir el resolver del cotizador v1.2). El cotizador ya snapshotea el precio al emitir, así que no hace falta historial para cotizar.
- **D-02:** El rastro de cambios (audit: quién / cuándo / precio viejo→nuevo, transición de estado) se emite a la tabla **`events`**. Esto **resuelve la decisión abierta de STATE.md**: se emiten events por transición de precio/estado ahora (cheap, forward-compatible), no se difiere.

### Forma de la grilla editable
- **D-03:** Grilla **plana, una fila por unidad** (38 filas × 2 listas de precio = manejable, no explota en columnas). Columnas: `identificador`, piso, tipología/m2 (referencia read-only), **Financiado** (USD), **Contado** (USD), **Estado**.
- **D-04:** **Edición inline por celda**: click en celda de precio → editable inline, Enter/blur guarda (mutación por celda vía el molde `requireRole`+`withTenant`). Estado = **dropdown inline** (disponible/reservado/vendido). **Checkbox por fila** para armar la selección de bulk edit.
- **D-05:** **Sin design system esta fase** — UI funcional es-AR voseo, mismo patrón establecido en Phase 9. Un `/gsd-ui-phase 10` opcional puede correrse aparte si se quiere contrato de diseño (superficie UI-heavy, candidata legítima).

### Import: preview dry-run y reporte de errores
- **D-06:** Flujo de import en dos fases: subir Excel → **validar (dry-run)** → **preview** → confirmar. El preview lista las filas **clasificadas**: nuevas / con cambios (muestra **viejo→nuevo por campo**) / sin cambios. Resumen arriba (N nuevas, N cambios, N errores).
- **D-07:** Las filas inválidas se listan aparte con **número de fila + motivo es-AR** (ej. "Fila 12: precio no entero"). El botón **Aplicar queda deshabilitado hasta que el archivo esté 100% válido**.
- **D-08:** El apply es **all-or-nothing** en **una sola transacción `withTenant`**: una fila inválida aborta todo, sin escrituras parciales. Idempotente por clave natural (`UNIQUE(unit_id, price_list_id)`). El dinero nunca se contamina con floats: parse es-AR con `Number.isInteger` post-parse.

### Template Excel canónico (export/import)
- **D-09:** **Una hoja, una fila por unidad**, clave = **`identificador`** (ej. "4B"). Columnas de **referencia read-only** (orientan, no se importan): piso, tipología, m2. Columnas **editables**: Financiado (USD), Contado (USD), Estado.
- **D-10:** El export incluye **TODAS las unidades del proyecto** (el caso central es "bajar todo, editar, subir"; no export de selección).
- **D-11:** **Celdas sanitizadas** contra formula/CSV injection: prefijar con `'` toda celda que empiece con `=`, `+`, `-`, `@` (aplica en el build del Excel de export).

### Bulk edit de precios
- **D-12:** Sobre la **selección de unidades** (checkboxes de D-04): aplica **% o monto fijo** a **UNA lista elegida** (Financiado o Contado). Redondeo a **USD entero** (`Math.round`). No incluye estado (el cambio de estado es individual por dropdown, D-04).
- **D-13:** El bulk edit muestra un **preview antes de confirmar** (cuántas unidades + viejo→nuevo), reusando el patrón de confirmación del import. Nunca aplicación directa a ciegas (operación de dinero irreversible sobre muchas unidades).

### Reflejo en la web pública (GRID-07)
- **D-14:** Todo cambio de precio/estado (inline, bulk, o import aplicado) se refleja en el picker/cotizador público **al instante**. Requisito de producto: **instantáneo**, sin esperar TTL.
  - **RESUELTO (research + user, 2026-07-21) — Path A:** `apps/web` ya es `force-dynamic` (`apps/web/app/page.tsx`, `apps/web/app/p/[slug]/cotizador/page.tsx`) → lee Postgres en vivo en cada request, así que el reflejo instantáneo **ya se cumple por construcción**; no hay cache ISR que revalidar y `revalidateTag` no cruza el límite de proceso panel→web (deploys Next separados). GRID-07 **no** agrega endpoint ni maquinaria de cache: se valida con un **test de integración cross-surface** (una mutación del panel es visible por el caller anon del picker en el request siguiente — clonar el patrón `estado→listPublished` de Phase 9). Descartado Path B (`"use cache"`+`cacheTag` + endpoint `/api/revalidate` con secret) — mayor scope, sin beneficio dado el estado `force-dynamic` actual; si la performance de la web pública bajo tráfico exige cachear, se revisita en una fase de perf dedicada.

### Claude's Discretion
- Nombre/API concreta de las mutaciones (`units.updatePrice`, `units.updateEstado`, `units.bulkUpdatePrice`, `units.importExcel`, etc.) y su granularidad — el planner elige, siguiendo el molde de Phase 9.
- Estructura interna del módulo puro `packages/api/src/excel/` (parse vs build, tipos de resultado del dry-run) — a criterio del planner/executor; requisito: I/O-free y testeable.
- Detalles de layout/estilo de la grilla y del wizard de import (posición de columnas, cómo se muestra el diff, componentes) — UI funcional, executor decide; `/gsd-ui-phase 10` opcional aparte.
- Mecanismo exacto de revalidación ISR (D-14) — research + planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y fase
- `.planning/ROADMAP.md` — Phase 10: goal + 5 success criteria + "UI hint: yes" + **research flag** (edge cases de parsing de dinero es-AR: separador de miles `.`, fecha DD/MM/YYYY, encoding; y UX del reporte de validación/error del import — hacer una pasada de research antes de escribir la mutación).
- `.planning/REQUIREMENTS.md` — GRID-01 (edit precio inline por lista), GRID-02 (cambio de estado), GRID-03 (export Excel sanitizado), GRID-04 (import + preview dry-run diff), GRID-05 (transaccional + idempotente + migración UNIQUE), GRID-06 (bulk edit % o monto), GRID-07 (reflejo instantáneo en web pública vía ISR).

### Molde de escritura del panel (clonar, NO reinventar — establecido en Phase 9)
- `.planning/phases/09-shell-del-panel-scoped-al-proyecto-role-gate/09-CONTEXT.md` — D-05/D-06: molde `requireRole("owner","developer")` + `withTenant` + `.returning()` 0-row → `NOT_FOUND`; matriz cross-rol vs Postgres real (owner✓/developer✓/viewer✗ 403 / otra org✗). D-04: contrato del placeholder que D1 reemplaza.
- `packages/api/src/trpc/middleware.ts` — `requireRole(...allowed)` ya implementado (lookup del rol dentro de `withTenant`/RLS, FORBIDDEN si no permitido).
- `packages/api/src/trpc/routers/projects.ts` — `projects.updateSettings` (mutación canary de Phase 9) = el ejemplo canónico verbatim a clonar para las mutaciones de la grilla.
- `packages/api/src/auth/access-control.ts` — roles owner/developer/viewer; developer sin delete, viewer solo read.
- `packages/api/src/trpc/routers/_app.ts` — registro del nuevo router de unidades.

### Schema de datos (leer antes de la migración/mutaciones)
- `packages/db/src/schema/unit-prices.ts` — `unit_prices`: `precio` es `integer` (USD entero, NUNCA float), `vigencia` timestamptz, **hoy SIN UNIQUE** (agregar `UNIQUE(unit_id, price_list_id)` — GRID-05). Triple composite-FK org-pinned + policy anon `publicado`.
- `packages/db/src/schema/units.ts` — `units`: `identificador` (clave del template Excel, ej. "4B"), `estado` enum default `disponible`, `tipologia`/`m2`/`orientacion` (ref read-only del export).
- `packages/db/src/schema/enums.ts` — `unidadEstadoEnum` = `disponible | reservado | vendido` (validar en import).
- `packages/db/src/schema/price-lists.ts` — 2 listas seed: "Financiado (precio de lista)" y "Contado (con descuento)", ambas USD (`packages/db/src/seed/content.ts` L137-138, `packages/db/src/seed/pricing.ts`).
- `packages/db/src/schema/events.ts` — tabla `events` (particionada por mes) para el audit trail de cambios de precio/estado (D-02).

### Convenciones y dependencia net-new
- `CLAUDE.md` — dinero en enteros (USD) nunca floats; `packages/quoting` y motor de cotización intactos; RLS en toda tabla con tenant; TS estricto; migraciones Drizzle versionadas; idioma código/commits inglés, UI/docs es-AR voseo; ramas `fase-N/descripcion`.
- STATE.md "Decisions" (`.planning/STATE.md`) — **`exceljs@4.4.0` (MIT) es la única dependencia runtime net-new; NO instalar `xlsx`/SheetJS** (CVE-2023-30533 sin patch en el path de import). Excel parse/build en módulo puro `packages/api/src/excel/` (I/O-free, testeable).

### Web pública a revalidar (GRID-07)
- `apps/web/` — el picker/cotizador público lee precios/estados vía policies anon (`unit_prices_anon_published`, `units_anon_published`); investigar el punto de cache/ISR a invalidar on-demand tras cada mutación de la grilla.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`requireRole` + `withTenant` mold (Phase 9)**: las 4 mutaciones de esta fase (edit precio, edit estado, bulk price, apply import) clonan `projects.updateSettings` verbatim — `requireRole("owner","developer")` sobre `withTenant`, `.returning()` con 0-row → `NOT_FOUND`. SC-4 se cumple usando el molde, no creándolo.
- **Matriz cross-rol vs Postgres real (Phase 9)**: la suite `projects-role-gate.test.ts` es el patrón para probar owner✓/developer✓/viewer✗ 403 / otra org✗ sobre las mutaciones de la grilla.
- **Patrón RSC del shell (`proyectos/[id]/unidades/page.tsx`)**: ya resuelve el proyecto scoped por RLS y valida `params.id`; D1 solo reemplaza el cuerpo del placeholder.
- **Seed "Brigos Recoleta"**: 38 unidades × 2 listas de precio — dataset determinista para tests de la grilla y del round-trip Excel.

### Established Patterns
- **`withTenant` como único seam de escritura**: toda mutación scoped al proyecto pasa por `requireRole` + `withTenant(ctx.activeOrgId, ...)`; nunca `createOwnerDb`/`appDb` en routers de dominio.
- **Módulo puro I/O-free para lógica de riesgo** (patrón `packages/quoting`): el parse/build de Excel vive en `packages/api/src/excel/` sin I/O, con tests unitarios exhaustivos (dinero es-AR, sanitización, dry-run diff) antes de cablear la mutación.
- **Dinero entero, nunca float**: parse es-AR (separador de miles `.`) con `Number.isInteger` post-parse; celdas Excel jamás se confían tipadas como número.

### Integration Points
- Nuevo router de unidades registrado en `packages/api/src/trpc/routers/_app.ts`; viaja al panel por type-safety (sin codegen).
- Migración Drizzle `UNIQUE(unit_id, price_list_id)` en `unit_prices` — desbloquea el upsert idempotente y protege el resolver del cotizador v1.2 (una fila por unidad×lista).
- Emisión a `events` en cada transición de precio/estado (D-02).
- Revalidación ISR on-demand hacia `apps/web` tras cada mutación (D-14) — punto de integración a resolver en research/planning.

</code_context>

<specifics>
## Specific Ideas

- Motivos de error del import en **es-AR voseo, tono del producto** (ej. "Fila 12: el precio no es un número entero", "Fila 7: identificador '4Z' no existe en el proyecto").
- El diff del preview debe mostrar **viejo→nuevo por campo** para que el developer nunca aplique un cambio de dinero a ciegas.
- Preview obligatorio también en el **bulk edit** (misma filosofía de confirmación que el import): una operación de dinero irreversible sobre muchas unidades nunca se aplica sin ver el impacto.

</specifics>

<deferred>
## Deferred Ideas

- **Descarga de reporte de errores del import (Excel/CSV anotado)** — útil si hay muchas filas inválidas; se puede agregar después si aparece la necesidad. Esta fase muestra los errores inline por fila (D-07), sin descarga.
- **Historial multi-fila de precios en `unit_prices`** — descartado en favor de UPSERT + audit por `events` (D-01/D-02); el cotizador ya snapshotea. Si en el futuro se requiere reconstruir la línea de tiempo de precios, se hace desde `events`, no cambiando el schema de `unit_prices`.
- **Bulk edit de estado** — el cambio de estado en bulk quedó fuera (D-12); estado se cambia individual por dropdown. Candidato si aparece la necesidad operativa.
- **Export de selección** — el export es de todas las unidades (D-10); export filtrado por selección se puede sumar después.
- **Contrato de diseño / `/gsd-ui-phase 10`** — opcional aparte; esta fase usa UI funcional sin design system (D-05).

</deferred>

---

*Phase: 10-d1-grilla-de-unidades-editable-import-export-excel*
*Context gathered: 2026-07-21*
