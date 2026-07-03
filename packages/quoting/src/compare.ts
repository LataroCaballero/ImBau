// The SINGLE derived comparison between a contado and a financiado quote (D-11).
//
// SIGN CONVENTION: a POSITIVE `ahorroUsd` means paying CONTADO is cheaper than FINANCIADO — it is
// exactly what the buyer saves by paying cash: `financiado.precioUsd − contado.precioUsd`.
// `ahorroPct` expresses that saving as a share of the financiado price. Both figures are computed
// HERE and only here: every surface (fase 6 UI-03, WhatsApp, PDF) READS this result, never
// recomputes it — so the "ahorro" a buyer sees can never drift between screens (D-11).
//
// The percentage goes through decimal.js (never a JS float): a mis-rounded ahorro is precisely the
// calc drift this package exists to prevent (CLAUDE.md: "un error de cálculo mata el producto").

import Decimal from "decimal.js";

import type { ContadoResult, FinanciadoResult, QuoteComparison } from "./types";

// Fixed half-up rounding, mirroring money.ts — one visible rounding decision for the whole package.
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });

/**
 * Derive the ahorro figures between the two modalidades (D-11).
 *
 * `ahorroUsd` = `financiado.precioUsd − contado.precioUsd` (whole USD — both prices are integers).
 * `ahorroPct` = `ahorroUsd / financiado.precioUsd × 100`, as a 2-decimal string via decimal.js
 * (e.g. 20000/120000×100 = 16.666… → "16.67"); equal prices yield `0` / `"0.00"`.
 */
export function compareQuotes(
  contado: ContadoResult,
  financiado: FinanciadoResult,
): QuoteComparison {
  const ahorroUsd = financiado.precioUsd - contado.precioUsd;
  const ahorroPct = new D(ahorroUsd).div(financiado.precioUsd).times(100).toFixed(2);
  return { ahorroUsd, ahorroPct };
}
