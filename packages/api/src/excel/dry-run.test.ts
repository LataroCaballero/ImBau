import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildWorkbook } from "./build";
import { buildDryRun } from "./dry-run";
import { parseWorkbook } from "./parse";
import { COLUMN, TEMPLATE_HEADERS, TEMPLATE_SHEET } from "./template";
import type { CurrentUnit, ExportRow } from "./types";

// buildDryRun is the pure validation/diff engine (GRID-04). These tests craft RawRow[] via real
// workbook round-trips (so the money cells are genuine exceljs handles the classifier must parse
// defensively) and assert the four classifications, the es-AR error reasons, and idempotency.

function currentUnit(over: Partial<CurrentUnit>): CurrentUnit {
  return {
    unitId: "u-4B",
    identificador: "4B",
    estado: "disponible",
    financiado: 185000,
    contado: 170000,
    ...over,
  };
}

function exportRow(over: Partial<ExportRow>): ExportRow {
  return {
    identificador: "4B",
    piso: "4",
    tipologia: "Monoambiente",
    m2: 45,
    financiado: 185000,
    contado: 170000,
    estado: "disponible",
    ...over,
  };
}

// Build a real .xlsx from ExportRows, then parse it back to RawRow[] — the exact path Plan 03 feeds
// buildDryRun (an uploaded file parsed by parseWorkbook).
async function rawRowsFrom(rows: ExportRow[]) {
  return parseWorkbook(await buildWorkbook(rows));
}

// Craft a raw single-data-row workbook with an arbitrary (possibly adversarial) price cell, bypassing
// the sanitized buildWorkbook — for exercising malformed-price classification.
async function craftRaw(cells: {
  identificador?: ExcelJS.CellValue;
  financiado?: ExcelJS.CellValue;
  contado?: ExcelJS.CellValue;
  estado?: ExcelJS.CellValue;
}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(TEMPLATE_SHEET);
  ws.addRow([...TEMPLATE_HEADERS]);
  const row = ws.getRow(2);
  row.getCell(COLUMN.identificador).value = cells.identificador ?? "4B";
  row.getCell(COLUMN.piso).value = "4";
  row.getCell(COLUMN.tipologia).value = "Mono";
  row.getCell(COLUMN.m2).value = 45;
  row.getCell(COLUMN.financiado).value = cells.financiado ?? 185000;
  row.getCell(COLUMN.contado).value = cells.contado ?? 170000;
  row.getCell(COLUMN.estado).value = cells.estado ?? "disponible";
  row.commit();
  return parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
}

describe("buildDryRun — classification", () => {
  it("classifies an identical row as 'sin cambios' with no field diffs", async () => {
    const current = [currentUnit({})];
    const raw = await rawRowsFrom([exportRow({})]);
    const report = buildDryRun(raw, current);
    expect(report.summary).toEqual({ nuevas: 0, conCambios: 0, sinCambios: 1, conErrores: 0 });
    expect(report.rows[0]?.rowClass).toBe("sin cambios");
    expect(report.rows[0]?.changes).toEqual([]);
    expect(report.rows[0]?.unitId).toBe("u-4B");
  });

  it("classifies a changed price as 'con cambios' with a field-by-field old→new diff", async () => {
    const current = [currentUnit({ financiado: 185000 })];
    const raw = await rawRowsFrom([exportRow({ financiado: 200000 })]);
    const report = buildDryRun(raw, current);
    expect(report.summary.conCambios).toBe(1);
    expect(report.rows[0]?.rowClass).toBe("con cambios");
    expect(report.rows[0]?.changes).toEqual([{ field: "financiado", old: 185000, new: 200000 }]);
  });

  it("classifies a changed estado as 'con cambios'", async () => {
    const current = [currentUnit({ estado: "disponible" })];
    const raw = await rawRowsFrom([exportRow({ estado: "reservado" })]);
    const report = buildDryRun(raw, current);
    expect(report.rows[0]?.changes).toEqual([{ field: "estado", old: "disponible", new: "reservado" }]);
  });

  it("classifies a previously-unpriced unit that gains a price as 'nueva'", async () => {
    const current = [currentUnit({ financiado: null, contado: null })];
    const raw = await rawRowsFrom([exportRow({ financiado: 185000, contado: 170000 })]);
    const report = buildDryRun(raw, current);
    expect(report.summary.nuevas).toBe(1);
    expect(report.rows[0]?.rowClass).toBe("nueva");
    expect(report.rows[0]?.changes).toEqual([
      { field: "financiado", old: null, new: 185000 },
      { field: "contado", old: null, new: 170000 },
    ]);
  });

  it("treats an unpriced unit re-imported blank as 'sin cambios' (blank = no price, not an error)", async () => {
    const current = [currentUnit({ financiado: null, contado: null })];
    const raw = await rawRowsFrom([exportRow({ financiado: null, contado: null })]);
    const report = buildDryRun(raw, current);
    expect(report.summary).toEqual({ nuevas: 0, conCambios: 0, sinCambios: 1, conErrores: 0 });
    expect(report.rows[0]?.rowClass).toBe("sin cambios");
  });
});

describe("buildDryRun — es-AR invalid-row reasons (D-07)", () => {
  it("reports a non-integer price with the es-AR reason", async () => {
    const current = [currentUnit({})];
    const raw = await craftRaw({ financiado: 185.5 });
    const report = buildDryRun(raw, current);
    expect(report.summary.conErrores).toBe(1);
    expect(report.errors).toEqual([{ rowNumber: 2, reason: "el precio no es un número entero" }]);
    expect(report.rows).toHaveLength(0);
  });

  it("reports an unknown identificador with the es-AR reason", async () => {
    const current = [currentUnit({ identificador: "4B" })];
    const raw = await craftRaw({ identificador: "4Z" });
    const report = buildDryRun(raw, current);
    expect(report.errors).toEqual([
      { rowNumber: 2, reason: "el identificador '4Z' no existe en el proyecto" },
    ]);
  });

  it("reports an invalid estado naming the valid enum values", async () => {
    const current = [currentUnit({})];
    const raw = await craftRaw({ estado: "ocupado" });
    const report = buildDryRun(raw, current);
    expect(report.errors).toEqual([
      { rowNumber: 2, reason: "el estado 'ocupado' no es válido (usá disponible, reservado, vendido)" },
    ]);
  });

  it("reports a missing identificador with 'falta el identificador'", async () => {
    const current = [currentUnit({})];
    const raw = await craftRaw({ identificador: "" });
    const report = buildDryRun(raw, current);
    expect(report.errors).toEqual([{ rowNumber: 2, reason: "falta el identificador" }]);
  });

  it("rejects a Formula-typed price cell (never trusts a cached result)", async () => {
    const current = [currentUnit({})];
    const raw = await craftRaw({ financiado: { formula: "100+85", result: 185 } });
    const report = buildDryRun(raw, current);
    expect(report.errors).toEqual([
      { rowNumber: 2, reason: "el precio es una fórmula; pegá solo el número" },
    ]);
  });
});

describe("buildDryRun — idempotency (GRID-05 signal)", () => {
  it("classifies EVERY row of an unchanged export as 'sin cambios' (zero changes)", async () => {
    const current: CurrentUnit[] = [
      currentUnit({ unitId: "u-4B", identificador: "4B", financiado: 185000, contado: 170000 }),
      currentUnit({ unitId: "u-5A", identificador: "5A", financiado: 320000, contado: 300000, estado: "reservado" }),
      currentUnit({ unitId: "u-6C", identificador: "6C", financiado: null, contado: null, estado: "vendido" }),
    ];
    const exported: ExportRow[] = current.map((u) =>
      exportRow({
        identificador: u.identificador,
        financiado: u.financiado,
        contado: u.contado,
        estado: u.estado,
      }),
    );
    const raw = await rawRowsFrom(exported);
    const report = buildDryRun(raw, current);
    expect(report.summary).toEqual({ nuevas: 0, conCambios: 0, sinCambios: 3, conErrores: 0 });
    expect(report.rows.every((r) => r.rowClass === "sin cambios")).toBe(true);
    expect(report.errors).toHaveLength(0);
  });
});
