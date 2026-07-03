// The crown-jewel calc (ENGINE-01/02, RESEARCH Pattern 1): `calcQuote` turns a resolved
// `QuoteInput` into exactly one `QuoteResult` per modalidad. It is PURE — no clock, no random,
// no env, no `@imbau/db`, no network. Every money step goes through `money.ts` (decimal.js) so a
// cent always reconciles; CAC enters ONLY as `input.cac` (never projected, never a fabricated FX).
// Every result embeds `ENGINE_VERSION` so a persisted snapshot is self-describing (ENGINE-06/D-13).
//
// "Un error de cálculo acá mata el producto" (CLAUDE.md): a degenerate plan is REJECTED with a
// typed `QuoteError` (D-07) before any money math — never normalized into a plausible-but-wrong quote.

import { QuoteError } from "./errors";
import { allocateCuotas, decimal2, roundHalfUpUsd } from "./money";
import type {
  CuotaLine,
  FinanciadoResult,
  QuoteInput,
  QuoteResult,
  QuoteTotals,
  RefuerzoLine,
} from "./types";
import { ENGINE_VERSION } from "./version";

/**
 * The pure contado/financiado quoting core (ENGINE-01/02).
 *
 * Contado (D-09/D-10): returns the resolved contado USD price stamped with the version — the engine
 * does NO discount math (the "descuento" is simply that the contado list is lower than the financiado).
 *
 * Financiado (order per D-07 → D-03 → D-06 → D-02 → D-04): validate-first (throwing the exact
 * `QuoteError` for every degenerate plan), then anticipo (half-up whole USD), saldo (precio −
 * anticipo − Σrefuerzos), N cuotas (last absorbs the remainder), each cuota's ARS "al valor del mes"
 * (usd × CAC for `ajuste:'CAC'`, `null` for `fijo`), and reconciliation totals whose `totalUsd`
 * equals `precioFinanciadoUsd` exactly — the founding invariant.
 */
export function calcQuote(input: QuoteInput): QuoteResult {
  if (input.modalidad === "contado") {
    return {
      modalidad: "contado",
      precioUsd: input.precioContadoUsd,
      version: ENGINE_VERSION,
    };
  }

  const precio = input.precioFinanciadoUsd;
  const { plan, cac } = input;

  // D-07 — reject, never normalize. Validate BEFORE any money math, in a fixed order so each
  // degenerate input surfaces its own code.
  if (!plan) throw new QuoteError("PLAN_REQUERIDO");

  // Bound check on the STRING via Number — the actual money math keeps the string (D-14).
  const anticipoPctNum = Number(plan.anticipoPct);
  if (anticipoPctNum < 0 || anticipoPctNum > 100) {
    throw new QuoteError("ANTICIPO_PCT_FUERA_DE_RANGO");
  }
  if (plan.cuotas < 1) throw new QuoteError("CUOTAS_INVALIDAS");
  if (plan.ajuste === "CAC" && !cac) throw new QuoteError("CAC_REQUERIDO");

  const seenCuotas = new Set<number>();
  for (const refuerzo of plan.refuerzos) {
    if (refuerzo.cuota < 1 || refuerzo.cuota > plan.cuotas) {
      throw new QuoteError("REFUERZO_FUERA_DE_PLAZO");
    }
    if (seenCuotas.has(refuerzo.cuota)) throw new QuoteError("REFUERZO_DUPLICADO");
    seenCuotas.add(refuerzo.cuota);
  }

  // D-03 — anticipo, half-up whole USD (keeps the raw pct string for the Decimal math).
  const anticipoUsd = roundHalfUpUsd(precio, plan.anticipoPct);
  // D-05/D-06 — refuerzos are USD-fixed and discount the saldo BEFORE the cuota split.
  const refuerzosTotal = plan.refuerzos.reduce((sum, refuerzo) => sum + refuerzo.montoUsd, 0);
  const saldoUsd = precio - anticipoUsd - refuerzosTotal;
  if (saldoUsd <= 0) throw new QuoteError("SALDO_NO_POSITIVO");

  // After validation, `cac` is guaranteed present whenever `ajuste === 'CAC'` (CAC_REQUERIDO above).
  const cacValor: string | null = plan.ajuste === "CAC" ? cac!.valor : null;

  // D-02 — last cuota absorbs the remainder; D-04/A1/A3 — ARS "al valor del mes" (null for fijo).
  const cuotasUsd = allocateCuotas(saldoUsd, plan.cuotas);
  const cuotas: CuotaLine[] = cuotasUsd.map((usd, i) => ({
    indice: i + 1,
    usd,
    ars: cacValor === null ? null : decimal2(usd, cacValor),
  }));

  // D-08 — refuerzo lines carry the cuota index + USD amount, no calendar dates.
  const refuerzos: RefuerzoLine[] = plan.refuerzos.map((refuerzo) => ({
    indice: refuerzo.cuota,
    montoUsd: refuerzo.montoUsd,
  }));

  const cuotasSum = cuotas.reduce((sum, cuota) => sum + cuota.usd, 0);
  const totals: QuoteTotals = {
    cuotasUsd: cuotasSum,
    refuerzosUsd: refuerzosTotal,
    // The founding invariant: this MUST equal precioFinanciadoUsd exactly.
    totalUsd: anticipoUsd + cuotasSum + refuerzosTotal,
  };

  const result: FinanciadoResult = {
    modalidad: "financiado",
    precioUsd: precio,
    anticipoUsd,
    saldoUsd,
    cuotas,
    refuerzos,
    cac: plan.ajuste === "CAC" ? cac! : null,
    totals,
    version: ENGINE_VERSION,
  };
  return result;
}
