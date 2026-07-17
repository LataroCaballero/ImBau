"use client";

// The anticipo/plazo control (UI-04, RESEARCH Pattern 4, D-04).
//
// A native `<input type="range">` whose value is an INTEGER INDEX into the sorted payment plans —
// it snaps to preset planIds ONLY and never emits a free anticipo/plazo value (the API only accepts
// a paymentPlanId). Index ↔ plan mapping lives in lib/plan-snap. The degenerate case (a single-plan
// project) renders the control disabled — plans are never synthesized.
import { planToIndex, indexToPlan, isSingle, type SnapPlan } from "../lib/plan-snap";

export type PlanSliderProps<T extends SnapPlan> = {
  /** The project's payment plans (any order — the slider sorts them deterministically). */
  plans: T[];
  /** The currently selected plan id. */
  planId: string;
  /** Called with the newly selected plan id when the slider moves. */
  onSelect: (planId: string) => void;
};

/**
 * Snap-to-preset slider. `min=0 max=plans.length-1 step=1`; the value is the current plan's sorted
 * index. `onChange` maps the integer index back to `plans[index].id` (via plan-snap) and calls
 * `onSelect` — never a numeric anticipo/plazo term. Disabled when there are fewer than 2 plans.
 */
export function PlanSlider<T extends SnapPlan>({
  plans,
  planId,
  onSelect,
}: PlanSliderProps<T>) {
  const single = isSingle(plans);
  const index = Math.max(0, planToIndex(plans, planId));
  const current = indexToPlan(plans, index);
  const max = Math.max(0, plans.length - 1);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = indexToPlan(plans, Number(event.target.value));
    if (next) onSelect(next.id);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-hormigon/70">Plan de pago</span>
        <span className="font-mono text-sm text-hormigon">
          {current ? `${current.anticipoPct}% anticipo · ${current.cuotas} cuotas` : "—"}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={index}
        disabled={single}
        onChange={handleChange}
        aria-label="Plan de pago"
        className="w-full accent-cobre disabled:opacity-50"
      />
    </div>
  );
}
