// Canonical Excel template — the SINGLE source of truth for both export (build) and import (parse).
// One sheet, one row per unit, key = identificador (D-09). Read-only reference columns (piso,
// tipología, m2) orient the editor but are not imported; the editable columns are Financiado (USD),
// Contado (USD) and Estado. Column ORDER here is load-bearing: parse reads cells by these indices.

export const TEMPLATE_SHEET = "Unidades";

// Header row, in canonical order. es-AR labels (docs/UI in Spanish, CLAUDE.md).
export const TEMPLATE_HEADERS = [
  "identificador",
  "piso",
  "tipología",
  "m2",
  "Financiado",
  "Contado",
  "Estado",
] as const;

// 1-based column indices (ExcelJS is 1-based). Import reads price/estado/identificador by these.
export const COLUMN = {
  identificador: 1,
  piso: 2,
  tipologia: 3,
  m2: 4,
  financiado: 5,
  contado: 6,
  estado: 7,
} as const;
