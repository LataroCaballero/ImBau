import { describe, expect, it } from "vitest";

import { calcQuote } from "./engine";
import { QuoteError, type QuoteErrorCode } from "./errors";
import type { FinanciadoResult, QuoteInput } from "./types";

// Money assertions are EXACT (toBe/toEqual) — never approximate float matchers (Pitfall 1 /
// threat T-04-02). A cent that does not reconcile is the class of bug this package exists to prevent.

// Narrowing helper: every financiado assertion runs against the financiado arm.
function financiado(result: ReturnType<typeof calcQuote>): FinanciadoResult {
  if (result.modalidad !== "financiado") {
    throw new Error(`expected a financiado result, got ${result.modalidad}`);
  }
  return result;
}

describe("calcQuote — contado (ENGINE-01, D-09/D-10)", () => {
  it("returns the resolved CONTADO price, versioned, with no cuotas or discount math", () => {
    const result = calcQuote({
      modalidad: "contado",
      precioContadoUsd: 100000,
      precioFinanciadoUsd: 120000,
    });
    // Exact ContadoResult — uses the contado price (not the financiado one), engine does no math.
    expect(result).toEqual({ modalidad: "contado", precioUsd: 100000, version: 1 });
  });
});

describe("calcQuote — financiado CAC (ENGINE-02, D-02/D-03/D-04)", () => {
  const input: QuoteInput = {
    modalidad: "financiado",
    precioContadoUsd: 100000,
    precioFinanciadoUsd: 120000,
    plan: { anticipoPct: "30", cuotas: 12, ajuste: "CAC", refuerzos: [] },
    cac: { periodo: "2026-07", valor: "1000" },
  };

  it("computes anticipo (half-up), saldo, 12 cuotas, and reconciles to precio exactly", () => {
    const result = financiado(calcQuote(input));
    expect(result.anticipoUsd).toBe(36000); // 120000 × 30% = 36000
    expect(result.saldoUsd).toBe(84000); // 120000 − 36000 − 0
    expect(result.cuotas).toHaveLength(12);
    // 84000 / 12 = 7000 exactly — last cuota absorbs a 0 remainder here.
    expect(result.cuotas[0]?.usd).toBe(7000);
    expect(result.cuotas[11]?.usd).toBe(7000);
    // The founding invariant, asserted EXACTLY.
    expect(result.totals.totalUsd).toBe(120000);
    expect(result.totals.cuotasUsd).toBe(84000);
    expect(result.totals.refuerzosUsd).toBe(0);
  });

  it("gives the primera cuota en ARS = usd × CAC as a 2-decimal string (ENGINE-02)", () => {
    const result = financiado(calcQuote(input));
    // 7000 × 1000 = 7000000.00
    expect(result.cuotas[0]?.ars).toBe("7000000.00");
    expect(result.cac).toEqual({ periodo: "2026-07", valor: "1000" });
  });

  it("puts the remainder on the LAST cuota when the split is uneven (D-02)", () => {
    const result = financiado(
      calcQuote({
        modalidad: "financiado",
        precioContadoUsd: 100000,
        precioFinanciadoUsd: 100000,
        // anticipo 0 → saldo 100000; 100000 / 3 → [33333, 33333, 33334].
        plan: { anticipoPct: "0", cuotas: 3, ajuste: "fijo", refuerzos: [] },
      }),
    );
    expect(result.cuotas.map((c) => c.usd)).toEqual([33333, 33333, 33334]);
    expect(result.totals.totalUsd).toBe(100000);
  });
});

describe("calcQuote — financiado fijo (A1: no ARS on cuotas)", () => {
  it("sets every cuota.ars to null and keeps USD reconciliation, cac null", () => {
    const result = financiado(
      calcQuote({
        modalidad: "financiado",
        precioContadoUsd: 100000,
        precioFinanciadoUsd: 120000,
        plan: { anticipoPct: "25", cuotas: 6, ajuste: "fijo", refuerzos: [] },
      }),
    );
    expect(result.anticipoUsd).toBe(30000);
    expect(result.saldoUsd).toBe(90000);
    expect(result.cuotas.every((c) => c.ars === null)).toBe(true);
    expect(result.cac).toBeNull();
    expect(result.totals.totalUsd).toBe(120000);
  });
});

describe("calcQuote — refuerzos (D-05/D-06/D-08)", () => {
  it("discounts refuerzos from the saldo, carries USD lines with no dates, and reconciles", () => {
    const result = financiado(
      calcQuote({
        modalidad: "financiado",
        precioContadoUsd: 100000,
        precioFinanciadoUsd: 120000,
        plan: {
          anticipoPct: "30",
          cuotas: 12,
          ajuste: "fijo",
          refuerzos: [
            { cuota: 6, montoUsd: 10000 },
            { cuota: 12, montoUsd: 14000 },
          ],
        },
      }),
    );
    expect(result.anticipoUsd).toBe(36000);
    // saldo = 120000 − 36000 − (10000 + 14000) = 60000
    expect(result.saldoUsd).toBe(60000);
    // Refuerzo lines: index + montoUsd only, no date field.
    expect(result.refuerzos).toEqual([
      { indice: 6, montoUsd: 10000 },
      { indice: 12, montoUsd: 14000 },
    ]);
    expect(result.totals.refuerzosUsd).toBe(24000);
    // anticipo + Σcuotas + Σrefuerzos === precio
    expect(result.totals.totalUsd).toBe(120000);
  });
});

// One rejection test per QuoteErrorCode — every throw branch in engine.ts is exercised (D-07).
describe("calcQuote — typed rejections (D-07, threat T-04-01)", () => {
  function expectCode(input: QuoteInput, code: QuoteErrorCode): void {
    expect(() => calcQuote(input)).toThrow(QuoteError);
    try {
      calcQuote(input);
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteError);
      expect((err as QuoteError).code).toBe(code);
      return;
    }
    throw new Error(`expected calcQuote to throw ${code}`);
  }

  const base = { precioContadoUsd: 100000, precioFinanciadoUsd: 120000 } as const;

  it("PLAN_REQUERIDO — financiado with no plan", () => {
    expectCode({ modalidad: "financiado", ...base }, "PLAN_REQUERIDO");
  });

  it("CAC_REQUERIDO — ajuste CAC with no cac value", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: { anticipoPct: "30", cuotas: 12, ajuste: "CAC", refuerzos: [] },
      },
      "CAC_REQUERIDO",
    );
  });

  it("ANTICIPO_PCT_FUERA_DE_RANGO — anticipoPct above 100", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: { anticipoPct: "150", cuotas: 12, ajuste: "fijo", refuerzos: [] },
      },
      "ANTICIPO_PCT_FUERA_DE_RANGO",
    );
  });

  it("ANTICIPO_PCT_FUERA_DE_RANGO — anticipoPct below 0", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: { anticipoPct: "-1", cuotas: 12, ajuste: "fijo", refuerzos: [] },
      },
      "ANTICIPO_PCT_FUERA_DE_RANGO",
    );
  });

  it("CUOTAS_INVALIDAS — cuotas < 1", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: { anticipoPct: "30", cuotas: 0, ajuste: "fijo", refuerzos: [] },
      },
      "CUOTAS_INVALIDAS",
    );
  });

  it("REFUERZO_FUERA_DE_PLAZO — a refuerzo.cuota beyond the plan length", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: {
          anticipoPct: "30",
          cuotas: 12,
          ajuste: "fijo",
          refuerzos: [{ cuota: 13, montoUsd: 1000 }],
        },
      },
      "REFUERZO_FUERA_DE_PLAZO",
    );
  });

  it("REFUERZO_DUPLICADO — two refuerzos on the same cuota index", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        plan: {
          anticipoPct: "30",
          cuotas: 12,
          ajuste: "fijo",
          refuerzos: [
            { cuota: 6, montoUsd: 1000 },
            { cuota: 6, montoUsd: 2000 },
          ],
        },
      },
      "REFUERZO_DUPLICADO",
    );
  });

  it("SALDO_NO_POSITIVO — anticipo + Σrefuerzos leaves no positive saldo", () => {
    expectCode(
      {
        modalidad: "financiado",
        ...base,
        // 100% anticipo → saldo 0.
        plan: { anticipoPct: "100", cuotas: 12, ajuste: "fijo", refuerzos: [] },
      },
      "SALDO_NO_POSITIVO",
    );
  });
});
