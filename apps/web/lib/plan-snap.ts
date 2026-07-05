// Snap-to-preset map for the anticipo/plazo slider (UI-04, RESEARCH Pattern 4, D-04).
//
// The slider value is an INTEGER INDEX into the project's sorted `payment_plans[]` — never a free
// anticipo/plazo value. The API only accepts a `paymentPlanId` (quotes.ts), so free terms are
// structurally impossible; these helpers are the only bridge between a slider index and a plan id.
//
// Ordering note: plans are compared by `anticipoPct` and `cuotas` for DISPLAY ORDER only. `Number()`
// is used strictly to order the presets — it never computes or renders money (money stays string/int
// per CLAUDE.md's money rule; the amounts come pre-formatted from @imbau/quoting elsewhere).

/** The minimal plan shape the snap helpers need. Richer plan objects flow through the generic. */
export type SnapPlan = {
  id: string;
  anticipoPct: string;
  cuotas: number;
};

/**
 * Return a NEW array of the plans in deterministic slider order: `anticipoPct` ascending, tie-broken
 * by `cuotas` ascending. Does not mutate the input.
 */
export function sortPlans<T extends SnapPlan>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) => {
    const ap = Number(a.anticipoPct);
    const bp = Number(b.anticipoPct);
    if (ap !== bp) return ap - bp;
    return a.cuotas - b.cuotas;
  });
}

/**
 * The integer slider index of `planId` within the sorted plans, or `-1` if it is not present.
 */
export function planToIndex(plans: readonly SnapPlan[], planId: string): number {
  return sortPlans(plans).findIndex((p) => p.id === planId);
}

/**
 * The plan at the given slider index (over the sorted plans). The index is clamped into the array
 * bounds so an out-of-range slider value never yields `undefined` for a non-empty project; an empty
 * plans array returns `undefined`.
 */
export function indexToPlan<T extends SnapPlan>(
  plans: readonly T[],
  index: number,
): T | undefined {
  const sorted = sortPlans(plans);
  if (sorted.length === 0) return undefined;
  const clamped = Math.min(Math.max(index, 0), sorted.length - 1);
  return sorted[clamped];
}

/**
 * The degenerate case (D-04): a project with fewer than 2 plans has a single fixed stop — the slider
 * is rendered disabled and never synthesizes plans.
 */
export function isSingle(plans: readonly SnapPlan[]): boolean {
  return plans.length < 2;
}
