// Pure Excel export: build a single-sheet workbook to an in-memory Buffer (no fs — keeps the module
// I/O-free, matching the packages/quoting discipline). Every user-derived STRING cell is sanitized
// against formula/CSV injection (D-11, GRID-03): a cell whose text starts with `= + - @` (also a tab
// or CR, per OWASP) is prefixed with a single quote so a spreadsheet app treats it as literal text,
// not an executable formula. Prices are written as NUMBER cells; an unpriced unit writes a blank
// (null) cell, never 0.
import ExcelJS from "exceljs";

import { TEMPLATE_HEADERS, TEMPLATE_SHEET } from "./template";
import type { ExportRow } from "./types";

// Leading formula/CSV-injection metacharacters (D-11 + OWASP tab/CR).
const INJECTION_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralize formula/CSV injection: prefix a `'` when the string starts with `= + - @` / tab / CR.
 * Applied UNIFORMLY to every string cell (defense in depth), not selectively. `parse.ts`
 * `unsanitizeCell` is its exact inverse for the round-trip.
 */
export function sanitizeCell(v: string): string {
  return INJECTION_LEAD.test(v) ? `'${v}` : v;
}

/** Build the canonical "Unidades" workbook to a Buffer. I/O-free (writeBuffer, never writeFile). */
export async function buildWorkbook(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TEMPLATE_SHEET);
  ws.addRow([...TEMPLATE_HEADERS]);
  for (const r of rows) {
    ws.addRow([
      sanitizeCell(r.identificador),
      sanitizeCell(r.piso),
      sanitizeCell(r.tipologia),
      r.m2, // numeric reference (read-only)
      r.financiado, // integer USD as a NUMBER cell; null → blank
      r.contado,
      sanitizeCell(r.estado),
    ]);
  }
  // exceljs types writeBuffer() as its own ambient `Buffer` (≈ ArrayBuffer); wrap it in a Node
  // Buffer so callers (Plan 03 mutations) can stream/persist it directly.
  return Buffer.from(await wb.xlsx.writeBuffer());
}
