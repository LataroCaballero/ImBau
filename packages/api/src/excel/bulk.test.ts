import { test as fcTest } from "@fast-check/vitest";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { computeBulkPreview } from "./bulk";
import { MAX_PRECIO_USD } from "./money-core";
import type { BulkSelectionUnit } from "./types";

// computeBulkPreview is the pure bulk-price engine (GRID-06, D-12). It applies a % or fixed change to
// ONE list's current price per selected unit, rounds to integer USD (Math.round), and rejects any
// result < 0 with an es-AR reason. The preview equals exactly what Plan 03's apply would write.

function sel(over: Partial<BulkSelectionUnit>): BulkSelectionUnit {
  return { unitId: "u-4B", identificador: "4B", current: 185000, ...over };
}

describe("computeBulkPreview — percent mode", () => {
  it("applies +10% and rounds to integer USD", () => {
    const preview = computeBulkPreview([sel({ current: 185000 })], "percent", 10);
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toEqual([{ unitId: "u-4B", identificador: "4B", old: 185000, new: 203500 }]);
  });

  it("rounds a fractional percent result to the nearest integer (Math.round)", () => {
    // 185000 * 1.035 = 191475 exactly; use a value that yields a .5 to prove Math.round.
    const preview = computeBulkPreview([sel({ current: 12345 })], "percent", 10);
    // 12345 * 1.10 = 13579.5 → Math.round → 13580
    expect(preview.rows[0]?.new).toBe(13580);
    expect(Number.isInteger(preview.rows[0]?.new)).toBe(true);
  });

  it("applies a negative percent that stays >= 0", () => {
    const preview = computeBulkPreview([sel({ current: 100000 })], "percent", -25);
    expect(preview.rows[0]?.new).toBe(75000);
  });
});

describe("computeBulkPreview — fixed mode", () => {
  it("adds a fixed integer amount", () => {
    const preview = computeBulkPreview([sel({ current: 185000 })], "fixed", 5000);
    expect(preview.rows).toEqual([{ unitId: "u-4B", identificador: "4B", old: 185000, new: 190000 }]);
  });

  it("subtracts a fixed integer amount that stays >= 0", () => {
    const preview = computeBulkPreview([sel({ current: 185000 })], "fixed", -85000);
    expect(preview.rows[0]?.new).toBe(100000);
  });
});

describe("computeBulkPreview — rejects invalid results with an es-AR reason", () => {
  it("rejects a negative result from an absurd percent (-100% minus more)", () => {
    const preview = computeBulkPreview([sel({ current: 100000 })], "percent", -150);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([{ identificador: "4B", reason: "el precio no puede ser negativo" }]);
  });

  it("rejects a negative result from a large negative fixed amount", () => {
    const preview = computeBulkPreview([sel({ current: 50000 })], "fixed", -60000);
    expect(preview.errors).toEqual([{ identificador: "4B", reason: "el precio no puede ser negativo" }]);
  });

  it("rejects a non-finite result (Infinity percent) with 'demasiado grande' (WR-02)", () => {
    const preview = computeBulkPreview([sel({ current: 100000 })], "percent", Number.POSITIVE_INFINITY);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([{ identificador: "4B", reason: "el precio es demasiado grande" }]);
  });

  it("rejects a result above the int4 cap (WR-02 overflow guard)", () => {
    const preview = computeBulkPreview([sel({ current: MAX_PRECIO_USD })], "fixed", MAX_PRECIO_USD);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([{ identificador: "4B", reason: "el precio es demasiado grande" }]);
  });

  it("rejects an unpriced unit (current === null) with an es-AR reason", () => {
    const preview = computeBulkPreview([sel({ current: null })], "percent", 10);
    expect(preview.rows).toEqual([]);
    expect(preview.errors).toEqual([
      { identificador: "4B", reason: "la unidad no tiene precio en la lista elegida" },
    ]);
  });

  it("partitions a mixed selection into rows and errors independently", () => {
    const preview = computeBulkPreview(
      [
        sel({ unitId: "u-4B", identificador: "4B", current: 100000 }),
        sel({ unitId: "u-5A", identificador: "5A", current: null }),
        sel({ unitId: "u-6C", identificador: "6C", current: 200000 }),
      ],
      "percent",
      10,
    );
    expect(preview.rows.map((r) => r.identificador)).toEqual(["4B", "6C"]);
    expect(preview.errors.map((e) => e.identificador)).toEqual(["5A"]);
  });
});

describe("computeBulkPreview — property: a previewed price is ALWAYS a non-negative integer", () => {
  const pricedUnit = fc.record({
    unitId: fc.string({ minLength: 1, maxLength: 8 }),
    identificador: fc.string({ minLength: 1, maxLength: 6 }),
    current: fc.integer({ min: 0, max: 100_000_000 }),
  });

  fcTest.prop([
    fc.array(pricedUnit, { maxLength: 20 }),
    fc.constantFrom("percent" as const, "fixed" as const),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
  ])("every emitted row.new is Number.isInteger && >= 0; rejects go to errors", (selection, mode, value) => {
    const preview = computeBulkPreview(selection, mode, value);
    for (const row of preview.rows) {
      expect(Number.isInteger(row.new)).toBe(true);
      expect(row.new).toBeGreaterThanOrEqual(0);
    }
    // Every selected priced unit is accounted for exactly once (row XOR error).
    expect(preview.rows.length + preview.errors.length).toBe(selection.length);
  });
});
