# Phase 10: D1 — Grilla de unidades editable + import/export Excel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 10-d1-grilla-de-unidades-editable-import-export-excel
**Areas discussed:** Vigencia / historial de precios, Forma de la grilla editable, Preview y errores del import, Template Excel + bulk edit

---

## Vigencia / historial de precios

| Option | Description | Selected |
|--------|-------------|----------|
| UPSERT + events audit | Una fila por unidad×lista (UNIQUE), el edit pisa el precio y actualiza vigencia; audit va a `events`. | ✓ |
| UPSERT sin events | Igual pero sin emitir events (se pierde el audit trail). | |
| Historial multi-fila | Cada cambio inserta fila nueva; rompe UNIQUE y obliga a reescribir el resolver del cotizador. | |

**User's choice:** UPSERT + events audit (Recomendado)
**Notes:** Resuelve además la decisión abierta de STATE.md sobre emisión de events por transición de precio/estado → se emiten ahora. El cotizador v1.2 ya snapshotea el precio, así que no hace falta historial para cotizar.

---

## Forma de la grilla editable

| Option | Description | Selected |
|--------|-------------|----------|
| Inline por celda | Fila por unidad; click-to-edit por celda de precio, estado dropdown inline, checkbox por fila para bulk. | ✓ |
| Edición por fila (draft + guardar) | Editar varias celdas y botón Guardar por fila/global; introduce estado sucio. | |
| Panel/drawer lateral por unidad | Grilla read-only, drawer editable por unidad; más clicks para la tarea central. | |

**User's choice:** Inline por celda (Recomendado)
**Notes:** Confirmado que el seed tiene 2 listas de precio (Financiado/Contado) → 38 filas × 2 columnas de precio, matriz plana manejable. Sin design system esta fase (UI funcional es-AR, patrón de Phase 9).

---

## Preview y errores del import

| Option | Description | Selected |
|--------|-------------|----------|
| Diff clasificado + errores por fila | Filas nuevas/cambios (viejo→nuevo)/sin cambios; errores por fila con nº+motivo; Aplicar deshabilitado hasta 100% válido. | ✓ |
| Solo resumen + bloqueo | Contadores + lista de errores sin diff campo-por-campo (cambios de dinero a ciegas). | |
| Diff + descarga de reporte de errores | Como la recomendada más Excel/CSV anotado descargable. | |

**User's choice:** Diff clasificado + errores por fila (Recomendado)
**Notes:** All-or-nothing ya fijado por SC. La descarga de reporte de errores quedó como idea diferida.

---

## Template Excel canónico

| Option | Description | Selected |
|--------|-------------|----------|
| Clave identificador + ref read-only + editables | Una hoja, clave identificador, ref read-only (piso/tipología/m2), editables (Financiado/Contado/Estado), exporta todas, celdas sanitizadas. | ✓ |
| Solo clave + editables (mínimo) | Sin columnas de referencia; edición a ciegas. | |
| Export de selección | Solo unidades seleccionadas; confunde el round-trip "bajar todo". | |

**User's choice:** Clave identificador + ref read-only + editables (Recomendado)
**Notes:** Export de todas las unidades del proyecto. Sanitización contra formula injection (prefijo `'` si empieza con =/+/-/@).

---

## Bulk edit de precios

| Option | Description | Selected |
|--------|-------------|----------|
| Precio, lista elegida, % o monto, con preview | Sobre selección: % o monto fijo a una lista, redondeo USD entero, preview antes de confirmar; sin estado. | ✓ |
| Precio + estado en bulk | Además del precio, cambio de estado en bulk; más riesgo de cambio masivo accidental. | |
| Sin preview (aplicación directa) | Aplica sin confirmación; peligroso en dinero irreversible. | |

**User's choice:** Precio, lista elegida, % o monto, con preview (Recomendado)
**Notes:** Redondeo con Math.round a USD entero. El estado se cambia individual por dropdown (no en bulk).

---

## Claude's Discretion

- Nombre/API y granularidad concreta de las mutaciones (editar precio, editar estado, bulk price, apply import).
- Estructura interna del módulo puro `packages/api/src/excel/` (parse vs build, tipos del resultado dry-run).
- Detalles de layout/estilo de la grilla y del wizard de import; `/gsd-ui-phase 10` opcional aparte.
- Mecanismo exacto de revalidación ISR on-demand (`revalidateTag`/`revalidatePath`, tags por proyecto/slug) — research + planning.

## Deferred Ideas

- Descarga de reporte de errores del import (Excel/CSV anotado).
- Historial multi-fila de precios en `unit_prices` (descartado; audit por `events`).
- Bulk edit de estado.
- Export de selección (en vez de todas las unidades).
- Contrato de diseño / `/gsd-ui-phase 10`.
