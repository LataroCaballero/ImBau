# Phase 12: Editor de hotspots - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 12-editor-de-hotspots
**Areas discussed:** Modelo de dibujo y edición, Navegación exterior↔plantas, Origen de los renders de fondo, Vinculación y validación

---

## Modelo de dibujo y edición

| Option | Description | Selected |
|--------|-------------|----------|
| Click vértices + editar arrastrando | Click para colocar cada vértice, cerrar en el primero; editar = arrastrar vértices individuales; borrar polígono/vértice con controles | ✓ |
| Solo re-dibujar (sin edición de vértices) | Dibujar por clicks igual, pero 'editar' = borrar y volver a dibujar. Más simple, menos preciso | |

**User's choice:** Click vértices + editar arrastrando
**Notes:** Editor de polígonos estándar con edición a nivel de vértice — precisión para ajuste fino.

---

## Navegación exterior↔plantas

| Option | Description | Selected |
|--------|-------------|----------|
| Drill-down desde el render exterior | Click en el polígono de un piso abre su planta para dibujar unidades. Espeja el explorador | ✓ |
| Selector de piso separado | Dropdown/lista independiente del canvas exterior | |

**User's choice:** Drill-down desde el render exterior
**Notes:** Complementado por follow-up — la lista de pisos queda **siempre visible** como red de seguridad (evita el huevo-y-gallina antes de que existan polígonos de piso).

---

## Origen de los renders de fondo

| Option | Description | Selected |
|--------|-------------|----------|
| Asume renders existentes (fondo solo lectura) | El editor solo muestra renders ya subidos como fondo; la subida es otra superficie. Research resuelve dónde vive el render exterior | ✓ |
| Incluye subir/elegir renders desde el editor | El developer sube/elige renders dentro del editor. Suma scope de upload/media | |

**User's choice:** Asume renders existentes (fondo solo lectura)
**Notes:** Follow-up — si falta el render, el canvas muestra **empty-state es-AR**, no deja dibujar sobre vacío. Research flag: campo en `projects` vs fila `media` para el render exterior.

---

## Vinculación y validación

| Option | Description | Selected |
|--------|-------------|----------|
| Dibujar→vincular; inválido bloquea guardado | Se dibuja primero, luego se elige piso/unidad. Degenerado/auto-intersecado bloquea con mensaje es-AR | |
| Elegir→dibujar; inválido bloquea guardado | Se elige piso/unidad primero (de la lista existente) y luego se dibuja. Misma validación bloqueante | ✓ |

**User's choice:** Elegir→dibujar; inválido bloquea guardado
**Notes:** Follow-up — persistencia por **guardado explícito** (botón), no autosave; ahí corre la validación bloqueante y la mutación (molde requireRole+withTenant). Sin autocorrección de polígonos inválidos.

---

## Claude's Discretion

- Formato exacto del string SVG guardado (`polygon points` vs `path d`) — requisito: coords viewBox 0-1000, parseable por el explorador de fase 2.
- Nombre/API concreta de las mutaciones (`floors.setPoligono`, `units.setPoligono`, o router `hotspots.*`) y su granularidad.
- Estructura interna del módulo puro de validación de geometría (I/O-free, testeable).
- Detalles de layout/estilo/UX del canvas; `/gsd-ui-phase 12` opcional aparte.
- Multi-selección / orden de polígonos.

## Deferred Ideas

- Subir/elegir renders de fondo desde el editor (fuera de scope — pipeline de media).
- Contrato de diseño / `/gsd-ui-phase 12` (opcional, UI-heavy).
- Multi-selección / reordenamiento / capas de polígonos.
- Autosave / historial de versiones de polígonos.
