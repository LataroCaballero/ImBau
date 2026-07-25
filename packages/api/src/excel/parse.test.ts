import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { parseMoneyEsAr } from "./money";
import { parseWorkbook, unsanitizeCell } from "./parse";
import { COLUMN, TEMPLATE_HEADERS, TEMPLATE_SHEET } from "./template";

// parseWorkbook must NEVER coerce a price cell blind — it hands raw cell handles to parseMoneyEsAr.
// These tests craft adversarial workbooks (formula/date/richText/error/empty price cells) that
// bypass the sanitized `buildWorkbook`, then assert the returned cells are rejected defensively.

// Craft a raw single-data-row workbook Buffer with the given editable cell values.
async function craft(cells: {
  identificador?: ExcelJS.CellValue;
  financiado?: ExcelJS.CellValue;
  contado?: ExcelJS.CellValue;
  estado?: ExcelJS.CellValue;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TEMPLATE_SHEET);
  ws.addRow([...TEMPLATE_HEADERS]);
  const row = ws.getRow(2);
  row.getCell(COLUMN.identificador).value = cells.identificador ?? "4B";
  row.getCell(COLUMN.piso).value = "4";
  row.getCell(COLUMN.tipologia).value = "Mono";
  row.getCell(COLUMN.m2).value = 45;
  if (cells.financiado !== undefined) row.getCell(COLUMN.financiado).value = cells.financiado;
  if (cells.contado !== undefined) row.getCell(COLUMN.contado).value = cells.contado;
  row.getCell(COLUMN.estado).value = cells.estado ?? "disponible";
  row.commit();
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("unsanitizeCell — exact inverse of build.ts sanitizeCell", () => {
  it("strips a leading escape quote only when it guards an injection lead", () => {
    expect(unsanitizeCell("'=x")).toBe("=x");
    expect(unsanitizeCell("'+1")).toBe("+1");
    expect(unsanitizeCell("'@a")).toBe("@a");
  });
  it("leaves a normal value and a non-escape apostrophe untouched", () => {
    expect(unsanitizeCell("4B")).toBe("4B");
    expect(unsanitizeCell("'hello")).toBe("'hello");
  });
});

describe("parseWorkbook — cell-type-safe reads (never trust cell.value as number)", () => {
  it("skips the header and returns one RawRow per data row", async () => {
    const buf = await craft({ identificador: "4B", financiado: 185000, contado: 170000 });
    const rows = await parseWorkbook(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowNumber).toBe(2);
    expect(rows[0]?.identificador).toBe("4B");
  });

  it("returns a Formula-typed price cell that parseMoneyEsAr then rejects", async () => {
    const buf = await craft({ financiado: { formula: "100+85", result: 185 } });
    const rows = await parseWorkbook(buf);
    const cell = rows[0]?.financiadoCell;
    expect(cell).toBeDefined();
    if (!cell) return;
    expect(parseMoneyEsAr(cell)).toEqual({ ok: false, reason: "el precio es una fórmula; pegá solo el número" });
  });

  it("returns a Date-typed price cell that is rejected", async () => {
    const buf = await craft({ financiado: new Date(2021, 5, 1) });
    const rows = await parseWorkbook(buf);
    const cell = rows[0]?.financiadoCell;
    if (!cell) throw new Error("expected a cell");
    expect(parseMoneyEsAr(cell).ok).toBe(false);
  });

  it("returns a RichText-typed price cell that is rejected even when numeric-looking", async () => {
    const buf = await craft({ financiado: { richText: [{ text: "185000" }] } });
    const rows = await parseWorkbook(buf);
    const cell = rows[0]?.financiadoCell;
    if (!cell) throw new Error("expected a cell");
    expect(parseMoneyEsAr(cell).ok).toBe(false);
  });

  it("returns an Error-typed price cell that is rejected", async () => {
    const buf = await craft({ financiado: { error: "#REF!" } });
    const rows = await parseWorkbook(buf);
    const cell = rows[0]?.financiadoCell;
    if (!cell) throw new Error("expected a cell");
    expect(parseMoneyEsAr(cell)).toEqual({ ok: false, reason: "la celda de precio tiene un error de Excel" });
  });

  it("returns an empty (blank) price cell that parses as 'falta el precio'", async () => {
    const buf = await craft({ financiado: undefined });
    const rows = await parseWorkbook(buf);
    const cell = rows[0]?.financiadoCell;
    if (!cell) throw new Error("expected a cell");
    expect(parseMoneyEsAr(cell)).toEqual({ ok: false, reason: "falta el precio" });
  });

  it("throws a friendly es-AR error when the workbook has no readable sheet", async () => {
    const empty = Buffer.from(await new ExcelJS.Workbook().xlsx.writeBuffer());
    await expect(parseWorkbook(empty)).rejects.toThrow(/No pudimos leer el archivo/);
  });
});
