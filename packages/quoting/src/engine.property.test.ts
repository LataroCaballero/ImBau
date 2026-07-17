import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { describe, expect } from "vitest";

import { calcQuote } from "./engine";
import { QuoteError } from "./errors";
import type { FinanciadoResult, QuoteInput } from "./types";

// INVARIANT properties (Pitfall 4): never re-derive the engine's arithmetic as an oracle, and never
// game coverage with a coverage-ignore pragma. Adversarial generators — precio to millions, cuotas
// 1..120, anticipoPct at the 0 and 100 boundaries, refuerzos consuming the balance, CAC far from 1.

function asFinanciado(result: ReturnType<typeof calcQuote>): FinanciadoResult {
  if (result.modalidad !== "financiado") {
    throw new Error(`expected financiado, got ${result.modalidad}`);
  }
  return result;
}

// Adversarial financiado generator. `anticipoPct` spans the full [0, 100] (boundaries included) and
// refuerzos carry UNIQUE, in-range cuota indices — so the only domain error a valid-structure input
// can raise is SALDO_NO_POSITIVO (asserted, never swallowed, when anticipo + Σrefuerzos ≥ precio).
const financiadoArb: fc.Arbitrary<QuoteInput> = fc
  .integer({ min: 1, max: 120 })
  .chain((cuotas) =>
    fc.record({
      modalidad: fc.constant("financiado" as const),
      precioContadoUsd: fc.integer({ min: 1_000, max: 10_000_000 }),
      precioFinanciadoUsd: fc.integer({ min: 1_000, max: 10_000_000 }),
      ajuste: fc.constantFrom("CAC" as const, "fijo" as const),
      anticipoPct: fc.integer({ min: 0, max: 100 }).map(String),
      cuotas: fc.constant(cuotas),
      refuerzos: fc.uniqueArray(
        fc.record({
          cuota: fc.integer({ min: 1, max: cuotas }),
          montoUsd: fc.integer({ min: 1, max: 500_000 }),
        }),
        { selector: (r) => r.cuota, maxLength: Math.min(cuotas, 6) },
      ),
      // CAC far from 1 (up to millions) to stress the ARS multiplier.
      cacValor: fc.integer({ min: 1, max: 5_000_000 }).map(String),
    }),
  )
  .map((g) => ({
    modalidad: g.modalidad,
    precioContadoUsd: g.precioContadoUsd,
    precioFinanciadoUsd: g.precioFinanciadoUsd,
    plan: {
      anticipoPct: g.anticipoPct,
      cuotas: g.cuotas,
      ajuste: g.ajuste,
      refuerzos: g.refuerzos,
    },
    cac: g.ajuste === "CAC" ? { periodo: "2026-07", valor: g.cacValor } : undefined,
  }));

describe("calcQuote — invariants (ENGINE-04)", () => {
  test.prop([financiadoArb])(
    "reconciles exactly: anticipo + Σcuotas + Σrefuerzos === precio (or rejects SALDO_NO_POSITIVO)",
    (input) => {
      let result: FinanciadoResult;
      try {
        result = asFinanciado(calcQuote(input));
      } catch (err) {
        // The only domain error a valid-structure financiado can raise is a non-positive saldo.
        expect(err).toBeInstanceOf(QuoteError);
        expect((err as QuoteError).code).toBe("SALDO_NO_POSITIVO");
        return;
      }
      const sum =
        result.anticipoUsd +
        result.cuotas.reduce((s, c) => s + c.usd, 0) +
        result.refuerzos.reduce((s, r) => s + r.montoUsd, 0);
      expect(sum).toBe(input.precioFinanciadoUsd); // EXACT — no tolerance
      expect(result.totals.totalUsd).toBe(input.precioFinanciadoUsd);
    },
  );

  test.prop([financiadoArb])("Σcuotas.usd === saldoUsd and no cuota is negative", (input) => {
    let result: FinanciadoResult;
    try {
      result = asFinanciado(calcQuote(input));
    } catch (err) {
      expect((err as QuoteError).code).toBe("SALDO_NO_POSITIVO");
      return;
    }
    const cuotasSum = result.cuotas.reduce((s, c) => s + c.usd, 0);
    expect(cuotasSum).toBe(result.saldoUsd);
    expect(result.cuotas.every((c) => c.usd >= 0)).toBe(true);
    // Last cuota owns the remainder → never smaller than the base first cuota.
    const first = result.cuotas[0]?.usd ?? 0;
    const last = result.cuotas[result.cuotas.length - 1]?.usd ?? 0;
    expect(last).toBeGreaterThanOrEqual(first);
  });

  // CAC monotonicity: hold the plan, raise the CAC value → primera cuota en ARS strictly larger.
  // Generators keep saldo ≫ cuotas so cuota[0].usd ≥ 1 and the comparison is strict.
  test.prop([
    fc.integer({ min: 100_000, max: 10_000_000 }), // precio (large → base cuota ≥ 1)
    fc.integer({ min: 0, max: 50 }), // anticipoPct (kept low → saldo stays large)
    fc.integer({ min: 1, max: 120 }), // cuotas
    fc.integer({ min: 1, max: 1_000_000 }), // cac1
    fc.integer({ min: 1, max: 1_000_000 }), // positive delta → cac2 > cac1
  ])("CAC↑ ⇒ primera cuota ARS↑ (strict)", (precio, pct, cuotas, cac1, delta) => {
    const cac2 = cac1 + delta;
    const build = (valor: number): QuoteInput => ({
      modalidad: "financiado",
      precioContadoUsd: precio,
      precioFinanciadoUsd: precio,
      plan: { anticipoPct: String(pct), cuotas, ajuste: "CAC", refuerzos: [] },
      cac: { periodo: "2026-07", valor: String(valor) },
    });
    const low = asFinanciado(calcQuote(build(cac1)));
    const high = asFinanciado(calcQuote(build(cac2)));
    const arsLow = Number(low.cuotas[0]?.ars ?? "0");
    const arsHigh = Number(high.cuotas[0]?.ars ?? "0");
    expect(arsHigh).toBeGreaterThan(arsLow);
  });

  // Anticipo monotonicity: more anticipo ⇒ smaller-or-equal saldo ⇒ smaller-or-equal Σcuotas.
  // pct kept in [0, 99] so both runs keep a positive saldo.
  test.prop([
    fc.integer({ min: 1_000, max: 10_000_000 }), // precio
    fc.integer({ min: 1, max: 120 }), // cuotas
    fc.integer({ min: 0, max: 99 }), // pctA
    fc.integer({ min: 0, max: 99 }), // pctB
  ])("anticipo↑ ⇒ saldo↓ and Σcuotas↓ (monotone)", (precio, cuotas, pctA, pctB) => {
    const lowPct = Math.min(pctA, pctB);
    const highPct = Math.max(pctA, pctB);
    const build = (pct: number): QuoteInput => ({
      modalidad: "financiado",
      precioContadoUsd: precio,
      precioFinanciadoUsd: precio,
      plan: { anticipoPct: String(pct), cuotas, ajuste: "fijo", refuerzos: [] },
    });
    const low = asFinanciado(calcQuote(build(lowPct)));
    const high = asFinanciado(calcQuote(build(highPct)));
    expect(high.saldoUsd).toBeLessThanOrEqual(low.saldoUsd);
    const sum = (r: FinanciadoResult) => r.cuotas.reduce((s, c) => s + c.usd, 0);
    expect(sum(high)).toBeLessThanOrEqual(sum(low));
  });

  test.prop([financiadoArb])("determinism — same input ⇒ byte-identical result", (input) => {
    // Two calls with the same input must deep-equal (no clock/random/env influence).
    let first: FinanciadoResult;
    try {
      first = asFinanciado(calcQuote(input));
    } catch (err) {
      expect((err as QuoteError).code).toBe("SALDO_NO_POSITIVO");
      // A degenerate input rejects deterministically too.
      expect(() => calcQuote(input)).toThrow(QuoteError);
      return;
    }
    expect(calcQuote(input)).toEqual(first);
  });

  test.prop([
    fc.integer({ min: 1, max: 10_000_000 }), // contado price
    fc.integer({ min: 1, max: 10_000_000 }), // financiado price
  ])("determinism — contado is a pure versioned echo of the contado price", (contado, financiado) => {
    const input: QuoteInput = {
      modalidad: "contado",
      precioContadoUsd: contado,
      precioFinanciadoUsd: financiado,
    };
    expect(calcQuote(input)).toEqual({ modalidad: "contado", precioUsd: contado, version: 1 });
    expect(calcQuote(input)).toEqual(calcQuote(input));
  });
});
