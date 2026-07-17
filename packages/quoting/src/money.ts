import Decimal from "decimal.js";

// Money discipline for the quoting engine (ENGINE-05, CLAUDE.md D-14): a JS `number` never
// sits in a money position beyond whole-USD integers, and a Drizzle `numeric` string is wrapped
// DIRECTLY in Decimal — never through a string→float coercion, which reintroduces drift (Pitfall 1).
//
// One module-local Decimal clone fixes the rounding mode as a single, visible decision.
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });

/**
 * D-03 — anticipo, half-up to a whole USD.
 * `anticipoPct` arrives from Drizzle as a numeric STRING (e.g. "30", "33.5"); it is wrapped
 * directly in Decimal, never float-coerced first. Returns `precioUsd × anticipoPct / 100`
 * rounded half-up to an integer USD (via decimal.js `.toNumber()` — the sole Decimal→number step).
 */
export function roundHalfUpUsd(precioUsd: number, anticipoPct: string): number {
  return new D(precioUsd).times(new D(anticipoPct)).div(100).round().toNumber();
}

/**
 * D-02 — installment split where the LAST cuota absorbs the remainder.
 * base = floor(saldo / n); the first n-1 cuotas are identical `base`, and the last cuota is
 * `base + resto`, so `Σcuotas === saldo` exactly and no cent is left without an owner. This is
 * the user's deliberate rule OVER research's "distribute across the first k" suggestion.
 * USD is integer throughout — no float division of money.
 */
export function allocateCuotas(saldoUsd: number, n: number): number[] {
  const base = Math.floor(saldoUsd / n);
  const resto = saldoUsd - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + resto : base));
}

/**
 * D-04 — ARS "al valor del mes" as an exact 2-decimal string.
 * `cacValor` arrives from Drizzle as a numeric STRING (e.g. "1234.5600"); it is wrapped directly
 * in Decimal. Returns `usd × cacValor` as a string with exactly 2 decimals — never a JS float.
 */
export function decimal2(usd: number, cacValor: string): string {
  return new D(usd).times(new D(cacValor)).toFixed(2);
}
