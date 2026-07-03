// The domain-rejection idiom for the quoting engine (D-07, RESEARCH Open Question 1).
//
// A degenerate / out-of-domain QuoteInput must be REJECTED with a typed error, never normalized
// silently into a plausible-but-wrong quote (threat T-04-01). `calcQuote` (plan 03) throws a
// `QuoteError` carrying an exhaustive `QuoteErrorCode`; each surface decides how to present it in
// es-AR — the engine only rejects, it does NOT observe. No logging or observability coupling
// lives here: rejection is the engine's job, reporting belongs to the caller (CLAUDE.md).

/**
 * The exhaustive set of domain conditions the PURE engine can detect and reject. Every code is
 * reachable from a specific degenerate QuoteInput and is unit-tested for the 100% coverage gate.
 *
 * - `PLAN_REQUERIDO`               — modalidad `financiado` with no `plan`.
 * - `CAC_REQUERIDO`                — `ajuste:'CAC'` with no `cac` value.
 * - `ANTICIPO_PCT_FUERA_DE_RANGO`  — `anticipoPct` not in [0, 100].
 * - `CUOTAS_INVALIDAS`             — `cuotas` < 1.
 * - `REFUERZO_FUERA_DE_PLAZO`      — a `refuerzo.cuota` outside [1, cuotas].
 * - `REFUERZO_DUPLICADO`           — two refuerzos on the same cuota index.
 * - `SALDO_NO_POSITIVO`            — precio − anticipo − Σrefuerzos ≤ 0.
 */
export type QuoteErrorCode =
  | 'PLAN_REQUERIDO'
  | 'CAC_REQUERIDO'
  | 'ANTICIPO_PCT_FUERA_DE_RANGO'
  | 'CUOTAS_INVALIDAS'
  | 'REFUERZO_FUERA_DE_PLAZO'
  | 'REFUERZO_DUPLICADO'
  | 'SALDO_NO_POSITIVO';

/**
 * A typed domain-rejection error thrown by the engine for an out-of-domain QuoteInput (D-07).
 * Carries a machine-readable `code` (the surface maps it to es-AR copy) and an optional English
 * message for developers. `name` is fixed to `'QuoteError'` so it is recognizable across bundles.
 */
export class QuoteError extends Error {
  readonly code: QuoteErrorCode;

  constructor(code: QuoteErrorCode, message?: string) {
    super(message);
    this.name = 'QuoteError';
    this.code = code;
  }
}
