// The single output contract every downstream surface consumes (ENGINE-03).
//
// This module is DECLARATION-ONLY: pure `type` declarations, no runtime code. It defines the
// one `QuoteResult` shape that `calcQuote` (plan 03) produces and that the serializers (plan 04),
// fase-5 persistence, fase-6 UI/WhatsApp and fase-7 PDF all read — "ninguna superficie puede
// construirse hasta que la forma de salida esté finalizada" (ROADMAP goal).
//
// The engine is PURE and never imports @imbau/db (CLAUDE.md: no I/O in packages/quoting). The
// input types below are STRUCTURALLY COMPATIBLE with the Drizzle row shapes so callers in fase
// 5/6 can map rows straight in: numeric columns arrive from Drizzle as STRINGS (anticipoPct,
// cac.valor), integer columns as NUMBERS (precio, cuotas, montoUsd). Two resolved USD prices are
// always supplied (D-09/A2) — the engine does NO pricing math; the contado discount is the
// difference between the two supplied prices.

// ---------------------------------------------------------------------------------------------
// Input contract (mirrors Drizzle rows; the engine never imports @imbau/db)
// ---------------------------------------------------------------------------------------------

/**
 * A single balloon payment inside a payment plan (D-08). Mirrors the db `Refuerzo` JSONB shape:
 * both fields are integers (`cuota` = installment index, `montoUsd` = whole-USD amount). No dates —
 * refuerzos are cuota-indexed and USD-fixed (D-05).
 */
export type RefuerzoInput = {
  cuota: number;
  montoUsd: number;
};

/**
 * A payment plan as consumed by the engine (mirrors `payment_plans`). `anticipoPct` is a STRING
 * because Drizzle emits `numeric` as a string (never float-coerced, D-14). `ajuste` selects the
 * installment basis: `'CAC'` cuotas carry an ARS value at the month's index, `'fijo'` cuotas do not.
 */
export type PlanInput = {
  anticipoPct: string;
  cuotas: number;
  ajuste: 'CAC' | 'fijo';
  refuerzos: RefuerzoInput[];
};

/**
 * The CAC index value for the quote's período (mirrors `cac_index`). `valor` is a STRING —
 * `numeric(12,4)` from Drizzle — wrapped directly in Decimal by the engine, never parseFloat'd.
 */
export type CacInput = {
  periodo: string;
  valor: string;
};

/**
 * The ONLY input surface of the engine. Both resolved USD prices are always supplied even for a
 * single-modalidad run (D-09/A2): the engine performs NO discount math — the contado discount is
 * `precioFinanciadoUsd - precioContadoUsd`. `plan` is required for `financiado`; `cac` is required
 * for `financiado` + `ajuste:'CAC'`. The types stay permissive with optionals; the engine (plan 03)
 * enforces presence at runtime by throwing a typed `QuoteError` (D-07).
 */
export type QuoteInput = {
  modalidad: 'contado' | 'financiado';
  precioContadoUsd: number;
  precioFinanciadoUsd: number;
  plan?: PlanInput;
  cac?: CacInput;
};

// ---------------------------------------------------------------------------------------------
// Output contract (discriminated union on `modalidad`, D-10)
// ---------------------------------------------------------------------------------------------

/**
 * One installment line. Every cuota carries an `ars` field (A1/A3): for `ajuste:'CAC'` it is the
 * 2-decimal ARS string (`usd × CAC`, via `decimal2`); for `ajuste:'fijo'` it is `null` (the CAC
 * multiplier applies only to the CAC path). The "primera cuota en ARS" (ENGINE-02) is `cuotas[0].ars`.
 */
export type CuotaLine = {
  indice: number;
  usd: number;
  ars: string | null;
};

/**
 * One balloon-payment line (D-08): cuota index + USD amount. NO calendar dates — refuerzos are
 * USD-fixed and cuota-indexed (D-05).
 */
export type RefuerzoLine = {
  indice: number;
  montoUsd: number;
};

/**
 * Reconciliation totals for a financiado quote — all integers. `totalUsd` reconciles to the
 * financiado price (anticipo + Σcuotas + Σrefuerzos === precioFinanciadoUsd), the founding invariant.
 */
export type QuoteTotals = {
  cuotasUsd: number;
  refuerzosUsd: number;
  totalUsd: number;
};

/**
 * The `contado` arm of `QuoteResult`. A single resolved USD price stamped with the engine version.
 */
export type ContadoResult = {
  modalidad: 'contado';
  precioUsd: number;
  version: number;
};

/**
 * The `financiado` arm of `QuoteResult`: anticipo + saldo split into cuotas, the refuerzo schedule,
 * the CAC context (or `null` for `ajuste:'fijo'`), and the reconciliation totals.
 */
export type FinanciadoResult = {
  modalidad: 'financiado';
  precioUsd: number;
  anticipoUsd: number;
  saldoUsd: number;
  cuotas: CuotaLine[];
  refuerzos: RefuerzoLine[];
  cac: CacInput | null;
  totals: QuoteTotals;
  version: number;
};

/**
 * The single output contract: exactly one result per modalidad, discriminated on `modalidad`
 * (D-10) — never a container object holding both arms. Downstream surfaces narrow on `modalidad`.
 */
export type QuoteResult = ContadoResult | FinanciadoResult;

// ---------------------------------------------------------------------------------------------
// Derived / serializer-model shapes (consumed in plan 04 — drafts OK per D-12, no ENGINE_VERSION bump)
// ---------------------------------------------------------------------------------------------

/**
 * Comparison figures between contado and financiado (D-11). `ahorroUsd` is the whole-USD saving;
 * `ahorroPct` is a 2-decimal string (derived, never a float).
 */
export type QuoteComparison = {
  ahorroUsd: number;
  ahorroPct: string;
};

/**
 * A plain data object the fase-7 worker renders into a PDF. Data only — the worker owns the JSX.
 * All string fields are es-AR-ready (already formatted); this shape carries no numbers to re-format.
 */
export type PdfModel = {
  modalidad: string;
  lineas: { label: string; valor: string }[];
  leyendas: string[];
};
