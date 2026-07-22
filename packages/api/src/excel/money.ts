// The single load-bearing invariant of Phase 10: parse an Excel price cell into a NON-NEGATIVE
// INTEGER USD, or reject it with an es-AR reason. It is the inverse of `packages/quoting` `formatUsd`
// (185000 → "US$ 185.000") and NEVER yields a float. Float contamination of USD is a product-killing
// bug (D-08), so this function is property-tested (money.test.ts) to prove no input ever produces a
// non-integer.
//
// WHY IT IGNORES `cell.value as number`: exceljs faithfully surfaces heterogeneous OOXML cell types —
// a "number-looking" cell can actually be a Formula ({formula,result}), a Date, RichText, or an Error
// object (Pitfall 1). We branch on `cell.type` (ExcelJS.ValueType) and reject every non-plain-number
// type for a price column, then gate the remaining Number/String on `Number.isInteger` and `>= 0`.
//
// WHY FRACTIONS ARE ALWAYS INVALID: USD prices are whole integers — "centavos no aplican al rubro"
// (CLAUDE.md). That domain rule DISSOLVES the es-AR `.`-thousands vs `,`-decimal ambiguity: a valid
// price is a non-negative integer, full stop. `.` is only ever a THOUSANDS grouper (in groups of 3),
// so "185.000" → 185000 but "185.5" (a lone 1-digit group) and "185,50" (a decimal comma) are both
// rejected.
import ExcelJS from "exceljs";

import type { MoneyParseResult } from "./types";

// es-AR grouped integer: 1–3 leading digits then one-or-more `.`-separated 3-digit groups. Matches
// "185.000", "1.234.567"; rejects "185.5", "1.23", "12.3456".
const ES_AR_GROUPED = /^\d{1,3}(\.\d{3})+$/;
// Plain unseparated integer: "185000".
const PLAIN_INTEGER = /^\d+$/;

/**
 * Parse an ExcelJS price cell → `{ ok: true, value }` (non-negative integer USD) or
 * `{ ok: false, reason }` (es-AR). The `reason` strings mirror 10-UI-SPEC §Copywriting Contract.
 */
export function parseMoneyEsAr(cell: ExcelJS.Cell): MoneyParseResult {
  const t = cell.type;

  // Reject non-numeric cell TYPES outright — never trust a formula's cached result or a date's number.
  if (t === ExcelJS.ValueType.Formula) {
    return { ok: false, reason: "el precio es una fórmula; pegá solo el número" };
  }
  if (t === ExcelJS.ValueType.Error) {
    return { ok: false, reason: "la celda de precio tiene un error de Excel" };
  }
  if (t === ExcelJS.ValueType.Date) {
    return { ok: false, reason: "el precio no puede ser una fecha" };
  }
  if (t === ExcelJS.ValueType.RichText) {
    return { ok: false, reason: "el precio tiene formato de texto enriquecido; pegá solo el número" };
  }
  if (t === ExcelJS.ValueType.Boolean || t === ExcelJS.ValueType.Hyperlink) {
    return { ok: false, reason: "el precio no es un número entero" };
  }
  if (t === ExcelJS.ValueType.Null || t === ExcelJS.ValueType.Merge) {
    return { ok: false, reason: "falta el precio" };
  }

  // Number cell: accept only a non-negative INTEGER (Number.isInteger gate — the money invariant).
  if (t === ExcelJS.ValueType.Number) {
    const n = cell.value as number;
    if (!Number.isInteger(n)) return { ok: false, reason: "el precio no es un número entero" };
    if (n < 0) return { ok: false, reason: "el precio no puede ser negativo" };
    return { ok: true, value: n };
  }

  // String / SharedString: normalize es-AR and re-gate on integer.
  const raw = cell.text.trim();
  if (raw === "") return { ok: false, reason: "falta el precio" };
  if (raw.startsWith("-")) return { ok: false, reason: "el precio no puede ser negativo" };

  const noSpace = raw.replace(/\s/g, "");
  if (!PLAIN_INTEGER.test(noSpace) && !ES_AR_GROUPED.test(noSpace)) {
    return { ok: false, reason: "el precio no es un número entero" };
  }
  const n = Number(noSpace.replace(/\./g, ""));
  // Defensive re-gate (a maliciously huge string could overflow to a non-integer/Infinity).
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: "el precio no es un número entero" };
  }
  return { ok: true, value: n };
}
