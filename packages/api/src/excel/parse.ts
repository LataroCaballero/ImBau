// Pure Excel import: read the canonical single-sheet workbook from a Buffer into `RawRow[]`. Money
// cells are kept as raw ExcelJS handles (never coerced here) so the caller runs `parseMoneyEsAr`
// defensively per cell (Pitfall 1). Identificador/estado are read as display text and un-sanitized
// (the exact inverse of build.ts `sanitizeCell`) so a round-trip is lossless. I/O-free: loads from a
// Buffer, never from disk.
import ExcelJS from "exceljs";

import { COLUMN, TEMPLATE_SHEET } from "./template";
import type { RawRow } from "./types";

// Inverse of build.ts `sanitizeCell`: strip a leading `'` only when it escapes an injection lead
// (`'=`, `'+`, `'-`, `'@`, `'\t`, `'\r`). Identificadores/estados never legitimately start with `'`.
const ESCAPED_LEAD = /^'[=+\-@\t\r]/;

export function unsanitizeCell(v: string): string {
  return ESCAPED_LEAD.test(v) ? v.slice(1) : v;
}

/**
 * Parse the uploaded `.xlsx` Buffer into `RawRow[]` (header row skipped). Throws a friendly es-AR
 * error if the workbook has no readable sheet. Money cells are returned unparsed by design.
 */
export async function parseWorkbook(buf: Buffer): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs augments the global Buffer as a non-generic `interface Buffer extends ArrayBuffer`, which
  // clashes with Node 22's generic `Buffer<ArrayBufferLike>`. A Node Buffer is accepted at runtime;
  // this cast bridges the purely-typial mismatch (no `any`).
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.getWorksheet(TEMPLATE_SHEET) ?? wb.worksheets[0];
  if (!ws) {
    throw new Error("No pudimos leer el archivo. Subí el Excel exportado desde acá, sin cambiar las columnas.");
  }

  const rows: RawRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const identificador = unsanitizeCell(row.getCell(COLUMN.identificador).text.trim());
    const estado = unsanitizeCell(row.getCell(COLUMN.estado).text.trim());
    rows.push({
      rowNumber,
      identificador,
      financiadoCell: row.getCell(COLUMN.financiado),
      contadoCell: row.getCell(COLUMN.contado),
      estado,
    });
  });
  return rows;
}
