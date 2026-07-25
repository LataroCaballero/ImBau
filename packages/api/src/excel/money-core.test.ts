import { describe, expect, it } from "vitest";

import {
  MAX_PRECIO_USD,
  isValidPrecio,
  parseMoneyStringEsAr,
} from "./money-core";

// money-core is the SINGLE SOURCE OF TRUTH shared by the Excel import parser (money.ts) AND the
// panel's inline price editor (units-grid PriceCell). These tests pin the exact es-AR string→integer
// contract both paths depend on — most importantly that an es-AR grouped number "185.000" becomes
// 185000 (not 185), the CR-01 money-corruption hole.

describe("parseMoneyStringEsAr — accepts whole-USD integers (es-AR grouped or plain)", () => {
  it("maps es-AR grouped '185.000' → 185000 (the CR-01 case: NOT 185)", () => {
    expect(parseMoneyStringEsAr("185.000")).toBe(185000);
  });

  it("maps multi-group '1.234.567' → 1234567", () => {
    expect(parseMoneyStringEsAr("1.234.567")).toBe(1234567);
  });

  it("maps a plain unseparated '185000' → 185000", () => {
    expect(parseMoneyStringEsAr("185000")).toBe(185000);
  });

  it("accepts 0", () => {
    expect(parseMoneyStringEsAr("0")).toBe(0);
  });

  it("trims surrounding + internal whitespace", () => {
    expect(parseMoneyStringEsAr("  1.500  ")).toBe(1500);
  });

  it("accepts exactly the int4 cap", () => {
    expect(parseMoneyStringEsAr(String(MAX_PRECIO_USD))).toBe(MAX_PRECIO_USD);
  });
});

describe("parseMoneyStringEsAr — rejects (→ null) everything that is not a whole-USD price", () => {
  it("rejects a decimal-comma '185,50'", () => {
    expect(parseMoneyStringEsAr("185,50")).toBeNull();
  });

  it("rejects a lone 1-digit group '1.5' (would misread as 15)", () => {
    expect(parseMoneyStringEsAr("1.5")).toBeNull();
  });

  it("rejects a lone group '185.5'", () => {
    expect(parseMoneyStringEsAr("185.5")).toBeNull();
  });

  it("rejects a mixed thousands+decimal '185.000,00'", () => {
    expect(parseMoneyStringEsAr("185.000,00")).toBeNull();
  });

  it("rejects a negative '-1'", () => {
    expect(parseMoneyStringEsAr("-1")).toBeNull();
  });

  it("rejects the empty string", () => {
    expect(parseMoneyStringEsAr("")).toBeNull();
  });

  it("rejects whitespace-only", () => {
    expect(parseMoneyStringEsAr("   ")).toBeNull();
  });

  it("rejects garbage text", () => {
    expect(parseMoneyStringEsAr("no disponible")).toBeNull();
  });

  it("rejects scientific notation '1e6'", () => {
    expect(parseMoneyStringEsAr("1e6")).toBeNull();
  });

  it("rejects hex notation '0x10'", () => {
    expect(parseMoneyStringEsAr("0x10")).toBeNull();
  });

  it("rejects a value above the int4 cap (WR-01 overflow guard)", () => {
    expect(parseMoneyStringEsAr(String(MAX_PRECIO_USD + 1))).toBeNull();
  });

  it("rejects a huge grouped value '999.999.999.999'", () => {
    expect(parseMoneyStringEsAr("999.999.999.999")).toBeNull();
  });
});

describe("isValidPrecio — the writable whole-USD predicate", () => {
  it("accepts 0, a mid value, and exactly the cap", () => {
    expect(isValidPrecio(0)).toBe(true);
    expect(isValidPrecio(185000)).toBe(true);
    expect(isValidPrecio(MAX_PRECIO_USD)).toBe(true);
  });

  it("rejects negatives, fractions, above-cap, and non-finite", () => {
    expect(isValidPrecio(-1)).toBe(false);
    expect(isValidPrecio(185.5)).toBe(false);
    expect(isValidPrecio(MAX_PRECIO_USD + 1)).toBe(false);
    expect(isValidPrecio(Infinity)).toBe(false);
    expect(isValidPrecio(Number.NaN)).toBe(false);
  });
});
