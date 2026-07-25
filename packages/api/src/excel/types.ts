// Shared types for the pure, I/O-free Excel round-trip module (packages/api/src/excel).
//
// This module clones the packages/quoting discipline: pure functions, no fs/DB/network, exhaustively
// tested (money is property-tested). Plan 03's four mutations are thin wrappers that supply the
// current DB snapshot and stream/persist the Buffers these functions produce/consume.
import type ExcelJS from "exceljs";

/** Result of the defensive es-AR money parse — never trust a cell typed as number (D-08). */
export type MoneyParseResult = { ok: true; value: number } | { ok: false; reason: string };

/** One exported unit row (the shape `buildWorkbook` writes; read-only ref columns included). */
export interface ExportRow {
  identificador: string;
  piso: string;
  tipologia: string;
  m2: number | null;
  /** Whole-USD integer or null (unpriced unit → blank cell, never 0). */
  financiado: number | null;
  contado: number | null;
  estado: string;
}

/**
 * A parsed import row. The money cells are kept as raw ExcelJS handles (never coerced blind) so the
 * caller runs `parseMoneyEsAr` defensively per cell. `rowNumber` is the 1-based sheet row for es-AR
 * error messages ("Fila 12: ...").
 */
export interface RawRow {
  rowNumber: number;
  identificador: string;
  financiadoCell: ExcelJS.Cell;
  contadoCell: ExcelJS.Cell;
  estado: string;
}

/** The current DB state of one project unit (per unit×list), supplied by Plan 03 — no I/O here. */
export interface CurrentUnit {
  unitId: string;
  identificador: string;
  estado: string;
  financiado: number | null;
  contado: number | null;
}

export type RowClass = "nueva" | "con cambios" | "sin cambios";

/** A single field-level change carried by a "con cambios" (or the new values of a "nueva") row. */
export interface FieldDiff {
  field: "financiado" | "contado" | "estado";
  old: number | string | null;
  new: number | string | null;
}

/** A row that passed validation, classified against the current snapshot. */
export interface ClassifiedRow {
  rowNumber: number;
  identificador: string;
  unitId: string;
  rowClass: RowClass;
  /** Field-by-field old→new for "con cambios"; the provided values for "nueva"; empty for "sin cambios". */
  changes: FieldDiff[];
}

/** A row that failed validation, with a 1-based row number and an es-AR reason (D-07). */
export interface ValidationError {
  rowNumber: number;
  reason: string;
}

export interface DryRunSummary {
  nuevas: number;
  conCambios: number;
  sinCambios: number;
  conErrores: number;
}

export interface DryRunResult {
  summary: DryRunSummary;
  rows: ClassifiedRow[];
  errors: ValidationError[];
}

export type BulkList = "financiado" | "contado";
export type BulkMode = "percent" | "fixed";

/** One selected unit for a bulk price edit; `current` is its existing price on the chosen list. */
export interface BulkSelectionUnit {
  unitId: string;
  identificador: string;
  current: number | null;
}

export interface BulkPreviewRow {
  unitId: string;
  identificador: string;
  old: number | null;
  new: number;
}

/** A bulk-preview error (e.g. a negative result, or an unpriced unit), with an es-AR reason. */
export interface BulkError {
  identificador: string;
  reason: string;
}

export interface BulkPreview {
  rows: BulkPreviewRow[];
  errors: BulkError[];
}
