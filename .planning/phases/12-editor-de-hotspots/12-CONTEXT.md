# Phase 12: Editor de hotspots - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

El developer dibuja, edita y borra polígonos SVG de **piso** (sobre el render exterior del edificio) y de **unidad** (sobre la planta de cada piso) desde `proyectos/[id]/hotspots`, y los vincula a piso/unidad. Los polígonos se guardan en **coordenadas viewBox intrínsecas (0-1000, no atadas a píxeles)** y **validados** (no degenerados ni auto-intersecados) en los campos ya existentes `floors.poligonoSvg` / `units.poligonoSvg` (**cero migración de schema**), consumibles tal cual por el explorador de fase 2 (milestone futuro) vía las policies anon existentes de `floors`/`units`.

Requirements: HSPOT-01 .. HSPOT-04.

Reemplaza únicamente el cuerpo del placeholder `apps/panel/app/proyectos/[id]/hotspots/page.tsx` cableado en Phase 9 (contrato ya heredado: `params.id` validado, proyecto resuelto por RLS, layout de tabs montado con la tab "hotspots"). NO toca unidades (D1/Phase 10) ni leads (D2/Phase 11). Es la superficie más UI-heavy pero de menor riesgo de cronograma: su único consumidor es un milestone posterior, y no depende de D1/D2.

</domain>

<decisions>
## Implementation Decisions

### Modelo de dibujo y edición (HSPOT-01/02/03)
- **D-01:** **Editor de polígonos estándar por vértices:** click para colocar cada vértice, cerrar el polígono clickeando el primer vértice (o doble-click). **Editar = arrastrar vértices individuales** (no solo re-dibujar); borrar vértice y borrar polígono completo vía controles. Precisión para ajuste fino, es lo que espera un editor visual de hotspots.
- **D-02:** El borrado de un polígono existente limpia el campo `poligonoSvg` correspondiente (piso o unidad) — es una edición del registro `floors`/`units`, no un delete de fila.

### Navegación del editor (exterior ↔ plantas)
- **D-03:** **Drill-down desde el render exterior:** click en el polígono de un piso (en el render exterior) abre la **planta de ese piso** para dibujar/editar sus polígonos de unidad. Espeja el modelo mental del explorador de fase 2 (exterior → piso → planta → unidad, modelo §P2).
- **D-04:** **Lista/selector de pisos siempre visible como red de seguridad.** El drill-down por click es el atajo; la lista permite abrir la planta de **cualquier** piso directamente, incluso antes de que su polígono exterior exista. Resuelve el huevo-y-gallina (no se puede clickear un polígono que aún no se dibujó).

### Origen de los renders de fondo
- **D-05:** **Esta fase ASUME que los renders ya existen** (subidos vía media/seed). El editor los muestra como **fondo de solo lectura**; **NO incluye subir/elegir renders** — la carga de renders es otra superficie (pipeline de media). Mantiene el scope ajustado a "dibujar polígonos".
- **D-06:** **Si falta el render** (exterior del proyecto o planta de un piso) → **empty-state con mensaje es-AR voseo** claro (ej. "Falta el render exterior de este proyecto" / "Falta la planta de este piso"); **no se dibuja sobre vacío**. No rompe, orienta al operador a cargar el render primero.

### Vinculación y validación (HSPOT-04)
- **D-07:** **Elegir primero, dibujar después:** el developer elige el piso/unidad (de la lista de pisos/unidades ya existentes del proyecto) y **luego dibuja** su polígono. La asociación es explícita, sin heurística de "adivinar" a qué unidad pertenece un polígono.
- **D-08:** **Validación bloqueante:** un polígono degenerado (menos de 3 vértices, área ~0, vértices colineales) o **auto-intersecado** **bloquea el guardado** con mensaje es-AR; **no se autocorrige** silenciosamente. La validación es lógica pura (patrón `packages/quoting`: I/O-free, testeable) — corre antes de la mutación.
- **D-09:** **Coordenadas viewBox intrínsecas 0-1000**, independientes del tamaño de píxel del render mostrado. El canvas transforma coordenadas de pantalla ↔ viewBox al dibujar/leer; lo persistido nunca depende del ancho de render en pantalla. Consumible tal cual por el explorador de fase 2.

### Persistencia
- **D-10:** **Guardado explícito por polígono** (botón "Guardar"), no autosave. Ahí corre la validación bloqueante (D-08) y **una** mutación por el molde `requireRole("owner","developer")` + `withTenant` (clonado de Phase 9/10). Control claro para el operador y superficie fácil de testear (validación + matriz cross-rol).

### Claude's Discretion
- **Formato exacto del string SVG** guardado en `poligonoSvg` (ej. lista de puntos `"x,y x,y ..."` de un `<polygon points>` vs `path d`) — el planner/executor elige; requisito: coords viewBox 0-1000, parseable por el explorador de fase 2. Documentar el formato elegido para que fase 2 lo consuma sin ambigüedad.
- **Nombre/API concreta de las mutaciones** (ej. `floors.setPoligono`, `units.setPoligono`, o un router `hotspots.*`) y su granularidad — el planner elige, siguiendo el molde de Phase 9/10.
- **Estructura interna del módulo puro de validación de geometría** (`packages/api/src/...` o `packages/quoting`-style) — I/O-free, con tests unitarios (degenerado, auto-intersección, área mínima) antes de cablear la mutación.
- **Detalles de layout/estilo/UX del canvas** (cómo se renderiza el vértice arrastrable, colores de polígono seleccionado, cursores) — UI funcional es-AR voseo sin design system, mismo patrón que Phase 9/10. `/gsd-ui-phase 12` es candidato legítimo aparte (superficie UI-heavy) pero opcional.
- **Multi-selección / orden de polígonos** — no se discutió como requisito; queda a criterio del executor si aparece necesidad trivial, sin sumar scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y fase
- `.planning/ROADMAP.md` — Phase 12: goal + 4 success criteria + "UI hint: yes" + **Research flag** (resolver dónde vive el render exterior del edificio: campo en `projects` vs fila de `media` designada, ANTES de cablear el canvas del editor de pisos — bloqueante pero de bajo riesgo; `--research-phase` o spike de arquitectura corto).
- `.planning/REQUIREMENTS.md` — HSPOT-01 (polígonos de piso sobre render exterior + vínculo a piso), HSPOT-02 (polígonos de unidad sobre planta + vínculo a unidad), HSPOT-03 (editar y borrar polígonos existentes), HSPOT-04 (viewBox intrínseco + validados no degenerados + consumibles por explorador fase 2 vía policies anon existentes).
- `docs/modelo-mvp.md` §P2 (explorador: render exterior → piso → planta → unidad, hotspots SVG sobre renders estáticos) y §3.3 (schema `floors`: render de planta + polígono sobre render exterior; `units`: plano + polígono). "Los polígonos son datos, no código" — editor visual en el panel, parte del pipeline de carga <1 semana.

### Schema de datos (leer antes de las mutaciones — CERO migración esperada)
- `packages/db/src/schema/floors.ts` — `floors.poligonoSvg` (text, hoy nullable) = destino del polígono de piso; `floors.renderKey` (text) = **render de planta** por piso (fondo para dibujar unidades). Tenant policy `floors_tenant` + anon `floors_anon_published` (SELECT gated en `projects.estado='publicado'`) ya existentes — el explorador de fase 2 consume por acá.
- `packages/db/src/schema/units.ts` — `units.poligonoSvg` (text, hoy nullable) = destino del polígono de unidad; `units.planoKey` (plano amoblado). `identificador` (ej. "4B"), `floorId`, composite-FKs org-pinned. Policy anon análoga.
- `packages/db/src/schema/projects.ts` — **hoy NO tiene campo de render exterior del edificio** (donde se dibujan los polígonos de piso). Esta es la incógnita del Research flag: agregar campo en `projects` vs designar una fila de `media`.
- `packages/db/src/schema/media.ts` — `media` (project-scoped: `originalKey`, `variants` jsonb, `blurhash`) — candidata a alojar el render exterior como fila designada (alternativa al campo en `projects`). Resolver en research.

### Molde de escritura del panel (clonar, NO reinventar — establecido en Phase 9, reusado en 10/11)
- `.planning/phases/09-shell-del-panel-scoped-al-proyecto-role-gate/09-CONTEXT.md` — molde `requireRole("owner","developer")` + `withTenant` + `.returning()` 0-row → `NOT_FOUND`; matriz cross-rol vs Postgres real (owner✓/developer✓/viewer✗ 403 / otra org✗). Contrato del placeholder de tab que esta fase reemplaza.
- `.planning/phases/10-d1-grilla-de-unidades-editable-import-export-excel/10-CONTEXT.md` — patrón de módulo puro I/O-free para lógica de riesgo (validación de geometría clona la filosofía del parse Excel / motor de cotización), UI funcional sin design system, emisión opcional a `events`.
- `packages/api/src/trpc/middleware.ts` — `requireRole(...allowed)` ya implementado.
- `packages/api/src/trpc/routers/projects.ts` — `projects.updateSettings` = ejemplo canónico verbatim a clonar para las mutaciones de polígono.
- `packages/api/src/trpc/routers/_app.ts` — registro del nuevo router (hotspots / floors / units).
- `packages/api/src/auth/access-control.ts` — roles owner/developer/viewer.

### Superficie del panel a completar
- `apps/panel/app/proyectos/[id]/hotspots/page.tsx` — placeholder actual ("Editor de hotspots — próximamente") = el cuerpo que esta fase reemplaza.
- `apps/panel/app/proyectos/[id]/layout.tsx` + `tab-bar.tsx` — layout de tabs y tab "hotspots" ya montados (Phase 9); la ficha de unidades (Phase 10) es el molde RSC del cuerpo de tab.

### Convenciones
- `CLAUDE.md` — visor 360/hotspots: **polígonos SVG como datos (editor en panel)**, sin motores 3D (decisión de producto); RLS en toda tabla con tenant; TS estricto; migraciones Drizzle versionadas; idioma código/commits inglés, UI/docs es-AR voseo; ramas `fase-N/descripcion`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`requireRole` + `withTenant` mold (Phase 9/10)**: la(s) mutación(es) de guardado de polígono clonan `projects.updateSettings` verbatim — `requireRole("owner","developer")` sobre `withTenant`, `.returning()` con 0-row → `NOT_FOUND`. SC de autorización se cumple usando el molde, no creándolo.
- **Matriz cross-rol vs Postgres real (Phase 9/10)**: patrón `projects-role-gate.test.ts` para probar owner✓/developer✓/viewer✗ 403 / otra org✗ sobre las mutaciones de polígono.
- **Campos `poligonoSvg` ya existen** en `floors` y `units` (text, nullable) — HSPOT-04 exige **cero migración de schema** para persistir polígonos. La única incógnita de schema es el render exterior del proyecto (Research flag), no los polígonos.
- **Policies anon ya existentes** (`floors_anon_published` / análoga en `units`) — el explorador de fase 2 lee los polígonos sin cambios; esta fase solo los escribe.
- **Patrón RSC del shell** (`proyectos/[id]/unidades/page.tsx`, Phase 10) — molde para el cuerpo del tab de hotspots (resuelve proyecto scoped por RLS, valida `params.id`).
- **Seed "Brigos Recoleta"** (~13 pisos, 38 unidades) — dataset determinista para probar drill-down, dibujo, validación y consumo.

### Established Patterns
- **`withTenant` como único seam de escritura**: toda mutación scoped al proyecto pasa por `requireRole` + `withTenant(ctx.activeOrgId, ...)`; nunca `createOwnerDb`/`appDb` en routers de dominio.
- **Módulo puro I/O-free para lógica de riesgo** (patrón `packages/quoting`): la validación de geometría (degenerado, auto-intersección, área mínima, normalización a viewBox 0-1000) vive sin I/O, con tests unitarios exhaustivos antes de cablear la mutación.
- **Coordenadas intrínsecas, nunca atadas a píxeles**: el canvas transforma pantalla↔viewBox; lo persistido es 0-1000 (análogo a "dinero entero nunca float" — la representación canónica no depende de la vista).

### Integration Points
- Nuevo router (hotspots/floors/units) registrado en `packages/api/src/trpc/routers/_app.ts`; viaja al panel por type-safety (sin codegen).
- Escritura a `floors.poligonoSvg` / `units.poligonoSvg` (cero migración). Lectura futura por el explorador de fase 2 vía policies anon existentes — este es el contrato de consumo a respetar (formato del string SVG documentado, D-Discretion).
- **Render exterior del edificio**: punto de integración con el schema a resolver en research (campo `projects` vs fila `media`) antes de cablear el canvas de pisos.

</code_context>

<specifics>
## Specific Ideas

- Mensajes de validación y empty-states en **es-AR voseo, tono del producto** (ej. "El polígono se cruza consigo mismo — corregilo antes de guardar", "Falta el render exterior de este proyecto — cargalo para dibujar los pisos").
- El drill-down debe **espejar el explorador de fase 2** (exterior → piso → planta → unidad) para que el operador construya el mismo modelo mental que verá el comprador final.
- La lista de pisos siempre visible es **red de seguridad deliberada**: el operador nunca debe quedar trabado sin poder llegar a una planta por no haber dibujado todavía el polígono exterior del piso.

</specifics>

<deferred>
## Deferred Ideas

- **Subir/elegir renders de fondo desde el editor de hotspots** — fuera de scope (D-05); la carga de renders es el pipeline de media, superficie aparte. Esta fase asume renders existentes y solo dibuja polígonos sobre ellos.
- **Contrato de diseño / `/gsd-ui-phase 12`** — opcional aparte; esta fase usa UI funcional sin design system (consistente con Phase 9/10). Candidata legítima por ser UI-heavy.
- **Multi-selección / reordenamiento de polígonos, capas, z-index** — no requerido; se puede sumar si aparece necesidad operativa, sin bloquear esta fase.
- **Autosave / historial de versiones de polígonos** — descartado en favor de guardado explícito (D-10); si aparece necesidad de deshacer, se evalúa después.

</deferred>

---

*Phase: 12-editor-de-hotspots*
*Context gathered: 2026-07-24*
