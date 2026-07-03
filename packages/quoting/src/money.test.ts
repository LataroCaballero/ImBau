import { describe, expect, it } from "vitest";

import { allocateCuotas, decimal2, roundHalfUpUsd } from "./money";

// Money assertions are EXACT — never `toBeCloseTo` (Pitfall 1). A cent that does not
// reconcile is the class of bug this package exists to prevent.

describe("roundHalfUpUsd (D-03 — anticipo, half-up whole USD)", () => {
  it("computes precio × pct / 100 as a whole USD (100000 × 30% = 30000)", () => {
    expect(roundHalfUpUsd(100000, "30")).toBe(30000);
  });

  it("rounds HALF-UP when the product has a .5 fractional dollar (x.5 → x+1)", () => {
    // 101 × 50 / 100 = 50.5 → rounds up to 51
    expect(roundHalfUpUsd(101, "50")).toBe(51);
  });

  it("accepts anticipoPct as a decimal string and never coerces via parseFloat/Number", () => {
    // 100000 × 33.5% = 33500 exactly
    expect(roundHalfUpUsd(100000, "33.5")).toBe(33500);
  });

  it("returns 0 for a 0% anticipo", () => {
    expect(roundHalfUpUsd(100000, "0")).toBe(0);
  });

  it("returns the full precio for a 100% anticipo", () => {
    expect(roundHalfUpUsd(100000, "100")).toBe(100000);
  });
});

describe("allocateCuotas (D-02 — last cuota absorbs the remainder; N-1 identical)", () => {
  it("splits with the LAST cuota absorbing the resto: (100, 3) → [33, 33, 34]", () => {
    expect(allocateCuotas(100, 3)).toEqual([33, 33, 34]);
  });

  it("splits evenly when there is no remainder: (90, 3) → [30, 30, 30]", () => {
    expect(allocateCuotas(90, 3)).toEqual([30, 30, 30]);
  });

  it("returns the whole saldo as a single cuota: (100, 1) → [100]", () => {
    expect(allocateCuotas(100, 1)).toEqual([100]);
  });

  it("Σcuotas === saldo and the last cuota is never smaller than the base (resto owner)", () => {
    const cases: Array<[number, number]> = [
      [100, 3],
      [1000, 7],
      [123456, 120],
      [1, 1],
      [999, 4],
    ];
    for (const [saldo, n] of cases) {
      const cuotas = allocateCuotas(saldo, n);
      expect(cuotas).toHaveLength(n);
      const sum = cuotas.reduce((a, b) => a + b, 0);
      expect(sum).toBe(saldo);
      const last = cuotas[n - 1] ?? 0;
      const base = cuotas[0] ?? 0;
      expect(last).toBeGreaterThanOrEqual(base);
    }
  });
});

describe("decimal2 (D-04 — ARS 'al valor del mes', exact 2 decimals, never a float)", () => {
  it("multiplies usd × cacValor into an exact 2-decimal string: (1000, '1234.5600') → '1234560.00'", () => {
    expect(decimal2(1000, "1234.5600")).toBe("1234560.00");
  });

  it("always returns a string with exactly 2 decimal places", () => {
    const result = decimal2(1, "1234.5678");
    expect(typeof result).toBe("string");
    expect(result).toBe("1234.57");
  });

  it("accepts cacValor as a numeric string without parseFloat drift", () => {
    expect(decimal2(3, "0.10")).toBe("0.30");
  });
});
