// Pure placeholder for the quoting engine. The full financial model (USD prices,
// ARS installments, CAC index) lands in phase 3 under QUOT-01, where this package
// requires 100% coverage + property-based tests (CLAUDE.md). No I/O — ever.

/**
 * Rounds an amount to the nearest whole USD. Prices are integer USD in this
 * domain (cents do not apply), so quotes never carry fractional dollars.
 */
export function roundUsd(amount: number): number {
  return Math.round(amount);
}
