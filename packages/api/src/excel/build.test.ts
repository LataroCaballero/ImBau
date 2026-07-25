import { test as fcTest } from "@fast-check/vitest";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildWorkbook, sanitizeCell } from "./build";
import { parseMoneyEsAr } from "./money";
import { parseWorkbook } from "./parse";
import type { ExportRow } from "./types";

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

describe("sanitizeCell — neutralizes formula/CSV injection (D-11, GRID-03)", () => {
  it("prefixes a leading '=' formula", () => {
    expect(sanitizeCell("=cmd|calc")).toBe("'=cmd|calc");
  });
  it("prefixes a leading '+'", () => {
    expect(sanitizeCell("+1")).toBe("'+1");
  });
  it("prefixes a leading '-'", () => {
    expect(sanitizeCell("-1")).toBe("'-1");
  });
  it("prefixes a leading '@'", () => {
    expect(sanitizeCell("@x")).toBe("'@x");
  });
  it("prefixes a leading tab", () => {
    expect(sanitizeCell("\tx")).toBe("'\tx");
  });
  it("prefixes a leading carriage return", () => {
    expect(sanitizeCell("\rx")).toBe("'\rx");
  });
  it("leaves a normal identificador '4B' unchanged", () => {
    expect(sanitizeCell("4B")).toBe("4B");
  });
  it("leaves 'disponible' unchanged", () => {
    expect(sanitizeCell("disponible")).toBe("disponible");
  });
});

describe("buildWorkbook → parseWorkbook — lossless round-trip for valid rows", () => {
  it("round-trips integer USD prices and estado (identity)", async () => {
    const buf = await buildWorkbook([exportRow({ identificador: "10A", financiado: 320000, contado: 300000 })]);
    const [parsed] = await parseWorkbook(buf);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(parsed.identificador).toBe("10A");
    expect(parsed.estado).toBe("disponible");
    expect(parseMoneyEsAr(parsed.financiadoCell)).toEqual({ ok: true, value: 320000 });
    expect(parseMoneyEsAr(parsed.contadoCell)).toEqual({ ok: true, value: 300000 });
  });

  it("an adversarial identificador exports sanitized and reads back as the ORIGINAL text", async () => {
    const buf = await buildWorkbook([exportRow({ identificador: "=SUM(A1:A9)" })]);
    const [parsed] = await parseWorkbook(buf);
    expect(parsed?.identificador).toBe("=SUM(A1:A9)"); // unsanitize is the exact inverse of sanitize
  });

  it("an unpriced unit (null price) reads back as a blank cell → falta el precio", async () => {
    const buf = await buildWorkbook([exportRow({ financiado: null })]);
    const [parsed] = await parseWorkbook(buf);
    expect(parsed).toBeDefined();
    if (!parsed) return;
    expect(parseMoneyEsAr(parsed.financiadoCell)).toEqual({ ok: false, reason: "falta el precio" });
  });

  // Safe visible-ASCII alphabet (incl. the injection leads = + - @ to exercise the sanitize
  // round-trip) — avoids XML-illegal control chars that exceljs would strip, which would make the
  // identity comparison flaky for reasons unrelated to the round-trip logic.
  const SAFE_ID = fc
    .array(fc.constantFrom(..."ABCXYZabcxyz0189=+-@#. ".split("")), { minLength: 1, maxLength: 12 })
    .map((a) => a.join(""))
    .filter((s) => !s.startsWith("'") && s.trim().length > 0);

  fcTest.prop([
    fc.record({
      identificador: SAFE_ID,
      financiado: fc.nat({ max: 100_000_000 }),
      contado: fc.nat({ max: 100_000_000 }),
    }),
  ])("property: build→parse preserves identificador and integer prices", async (row) => {
    const buf = await buildWorkbook([exportRow(row)]);
    const [parsed] = await parseWorkbook(buf);
    if (!parsed) return false;
    const fin = parseMoneyEsAr(parsed.financiadoCell);
    const con = parseMoneyEsAr(parsed.contadoCell);
    return (
      parsed.identificador === row.identificador.trim() &&
      fin.ok &&
      fin.value === row.financiado &&
      con.ok &&
      con.value === row.contado
    );
  });
});
