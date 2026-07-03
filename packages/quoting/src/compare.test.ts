import { describe, expect, it } from "vitest";

import { compareQuotes } from "./compare";
import type { ContadoResult, FinanciadoResult } from "./types";

// The ahorro figures are EXACT (toEqual), never approximate (Pitfall 1 / threat T-04-02): a
// mis-rounded percentage is exactly the drift this helper is the single source of truth against.

// Minimal fixtures — compareQuotes only reads `precioUsd` off each arm (D-11).
function contado(precioUsd: number): ContadoResult {
  return { modalidad: "contado", precioUsd, version: 1 };
}

function financiado(precioUsd: number): FinanciadoResult {
  return {
    modalidad: "financiado",
    precioUsd,
    anticipoUsd: 0,
    saldoUsd: precioUsd,
    cuotas: [],
    refuerzos: [],
    cac: null,
    totals: { cuotasUsd: precioUsd, refuerzosUsd: 0, totalUsd: precioUsd },
    version: 1,
  };
}

describe("compareQuotes — derived ahorro figures (D-11)", () => {
  it("computes ahorroUsd and a 2-decimal ahorroPct with repeating-decimal rounding", () => {
    // 20000 / 120000 × 100 = 16.666… → half-up "16.67".
    expect(compareQuotes(contado(100000), financiado(120000))).toEqual({
      ahorroUsd: 20000,
      ahorroPct: "16.67",
    });
  });

  it("returns zero ahorro and '0.00' when both prices are equal", () => {
    expect(compareQuotes(contado(100000), financiado(100000))).toEqual({
      ahorroUsd: 0,
      ahorroPct: "0.00",
    });
  });

  it("keeps ahorroPct exact for a clean (non-repeating) ratio", () => {
    // 25000 / 100000 × 100 = 25 → "25.00".
    expect(compareQuotes(contado(75000), financiado(100000))).toEqual({
      ahorroUsd: 25000,
      ahorroPct: "25.00",
    });
  });
});
