import { test as fcTest } from "@fast-check/vitest";
import ExcelJS from "exceljs";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseMoneyEsAr } from "./money";

// The es-AR money parser is the single load-bearing invariant of the phase (float contamination of
// USD is a product-killing bug, D-08). Assertions are EXACT — a successful parse is a non-negative
// INTEGER, always, and every rejection carries an es-AR reason (10-UI-SPEC copy).

// Build a fresh single cell carrying `value`, exactly as exceljs surfaces it on read.
function cellOf(value: ExcelJS.CellValue): ExcelJS.Cell {
  const ws = new ExcelJS.Workbook().addWorksheet("t");
  const cell = ws.getCell("A1");
  cell.value = value;
  return cell;
}

describe("parseMoneyEsAr — accepts whole-USD integers (inverse of formatUsd)", () => {
  it("accepts a raw Number cell (185000 → 185000)", () => {
    expect(parseMoneyEsAr(cellOf(185000))).toEqual({ ok: true, value: 185000 });
  });

  it("accepts an es-AR grouped string '185.000' → 185000", () => {
    expect(parseMoneyEsAr(cellOf("185.000"))).toEqual({ ok: true, value: 185000 });
  });

  it("accepts a plain unseparated string '185000' → 185000", () => {
    expect(parseMoneyEsAr(cellOf("185000"))).toEqual({ ok: true, value: 185000 });
  });

  it("accepts a multi-group es-AR string '1.234.567' → 1234567", () => {
    expect(parseMoneyEsAr(cellOf("1.234.567"))).toEqual({ ok: true, value: 1234567 });
  });

  it("accepts 0", () => {
    expect(parseMoneyEsAr(cellOf(0))).toEqual({ ok: true, value: 0 });
  });
});

describe("parseMoneyEsAr — rejects non-integer / malformed / negative with an es-AR reason", () => {
  it("rejects a fractional Number 185.5 (not an integer)", () => {
    const r = parseMoneyEsAr(cellOf(185.5));
    expect(r).toEqual({ ok: false, reason: "el precio no es un número entero" });
  });

  it("rejects a lone 1-digit group '185.5' (invalid es-AR grouping, would misread as 1855)", () => {
    const r = parseMoneyEsAr(cellOf("185.5"));
    expect(r).toEqual({ ok: false, reason: "el precio no es un número entero" });
  });

  it("rejects a decimal-comma string '185,50'", () => {
    expect(parseMoneyEsAr(cellOf("185,50")).ok).toBe(false);
  });

  it("rejects a mixed thousands+decimal string '185.000,00'", () => {
    expect(parseMoneyEsAr(cellOf("185.000,00")).ok).toBe(false);
  });

  it("rejects a negative Number -1", () => {
    expect(parseMoneyEsAr(cellOf(-1))).toEqual({ ok: false, reason: "el precio no puede ser negativo" });
  });

  it("rejects a negative string '-1'", () => {
    expect(parseMoneyEsAr(cellOf("-1"))).toEqual({ ok: false, reason: "el precio no puede ser negativo" });
  });

  it("rejects an empty string (falta el precio)", () => {
    expect(parseMoneyEsAr(cellOf(""))).toEqual({ ok: false, reason: "falta el precio" });
  });

  it("rejects a null/blank cell (falta el precio)", () => {
    expect(parseMoneyEsAr(cellOf(null))).toEqual({ ok: false, reason: "falta el precio" });
  });

  it("rejects a Formula-typed cell (pegá solo el número)", () => {
    const r = parseMoneyEsAr(cellOf({ formula: "1+1", result: 2 }));
    expect(r).toEqual({ ok: false, reason: "el precio es una fórmula; pegá solo el número" });
  });

  it("rejects a Date-typed cell", () => {
    const r = parseMoneyEsAr(cellOf(new Date(2020, 0, 1)));
    expect(r).toEqual({ ok: false, reason: "el precio no puede ser una fecha" });
  });

  it("rejects a RichText-typed cell even when the text looks numeric", () => {
    const r = parseMoneyEsAr(cellOf({ richText: [{ text: "185000" }] }));
    expect(r).toEqual({
      ok: false,
      reason: "el precio tiene formato de texto enriquecido; pegá solo el número",
    });
  });

  it("rejects an Error-typed cell", () => {
    const r = parseMoneyEsAr(cellOf({ error: "#DIV/0!" }));
    expect(r).toEqual({ ok: false, reason: "la celda de precio tiene un error de Excel" });
  });

  it("rejects a Boolean-typed cell", () => {
    expect(parseMoneyEsAr(cellOf(true)).ok).toBe(false);
  });

  it("rejects arbitrary non-numeric text", () => {
    expect(parseMoneyEsAr(cellOf("no disponible")).ok).toBe(false);
  });

  it("rejects a Number cell above the int4 cap (WR-01 — 3e9 would 22003 the INSERT)", () => {
    const r = parseMoneyEsAr(cellOf(3_000_000_000));
    expect(r).toEqual({ ok: false, reason: "el precio es demasiado grande" });
  });

  it("rejects a grouped string above the int4 cap '999.999.999.999' (WR-01)", () => {
    const r = parseMoneyEsAr(cellOf("999.999.999.999"));
    expect(r).toEqual({ ok: false, reason: "el precio es demasiado grande" });
  });
});

describe("parseMoneyEsAr — property: a successful parse is ALWAYS a non-negative integer", () => {
  // Adversarial generator spanning every exceljs cell shape the parser must survive: raw numbers
  // (int + float + negative), es-AR strings, decimal-comma strings, formulas, dates, richText,
  // errors, booleans, null. The load-bearing invariant: parse.ok ⇒ Number.isInteger && >= 0.
  const cellValueArb: fc.Arbitrary<ExcelJS.CellValue> = fc.oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000_000 }),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.integer({ min: 0, max: 1_000_000_000 }).map((n) => n.toLocaleString("es-AR")),
    fc.integer({ min: 0, max: 1_000_000_000 }).map(String),
    fc.string(),
    fc.float({ noNaN: true }).map((n) => n.toString().replace(".", ",")),
    fc.constant<ExcelJS.CellValue>({ formula: "A1+1", result: 5 }),
    fc.date().map((d): ExcelJS.CellValue => d),
    fc.constant<ExcelJS.CellValue>({ richText: [{ text: "185000" }] }),
    fc.constant<ExcelJS.CellValue>({ error: "#DIV/0!" }),
    fc.boolean(),
    fc.constant<ExcelJS.CellValue>(null),
  );

  fcTest.prop([cellValueArb])("no cell input ever yields a non-integer or negative value", (value) => {
    const ws = new ExcelJS.Workbook().addWorksheet("t");
    const cell = ws.getCell("A1");
    cell.value = value;
    const r = parseMoneyEsAr(cell);
    if (r.ok) {
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
    }
  });
});
