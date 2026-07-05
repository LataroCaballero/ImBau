import { describe, it, expect } from "vitest";
import { sortPlans, planToIndex, indexToPlan, isSingle } from "./plan-snap";

// Unsorted on purpose: two plans tie on anticipoPct (10) → tie-break by cuotas asc.
const plans = [
  { id: "p30", anticipoPct: "30", cuotas: 12 },
  { id: "p10-24", anticipoPct: "10", cuotas: 24 },
  { id: "p10-12", anticipoPct: "10", cuotas: 12 },
];
// Deterministic order: p10-12 (10/12), p10-24 (10/24), p30 (30/12)

describe("sortPlans", () => {
  it("orders by anticipoPct ascending, tie-break by cuotas ascending", () => {
    expect(sortPlans(plans).map((p) => p.id)).toEqual(["p10-12", "p10-24", "p30"]);
  });

  it("does not mutate the input array", () => {
    const before = plans.map((p) => p.id);
    sortPlans(plans);
    expect(plans.map((p) => p.id)).toEqual(before);
  });
});

describe("planToIndex", () => {
  it("returns the index of the plan in the sorted array", () => {
    expect(planToIndex(plans, "p10-12")).toBe(0);
    expect(planToIndex(plans, "p10-24")).toBe(1);
    expect(planToIndex(plans, "p30")).toBe(2);
  });

  it("returns -1 for an unknown planId", () => {
    expect(planToIndex(plans, "nope")).toBe(-1);
  });
});

describe("indexToPlan", () => {
  it("returns the plan at the sorted index", () => {
    expect(indexToPlan(plans, 0)?.id).toBe("p10-12");
    expect(indexToPlan(plans, 2)?.id).toBe("p30");
  });

  it("clamps an out-of-range index into the array bounds", () => {
    expect(indexToPlan(plans, -5)?.id).toBe("p10-12");
    expect(indexToPlan(plans, 99)?.id).toBe("p30");
  });

  it("returns undefined for an empty plans array", () => {
    expect(indexToPlan([], 0)).toBeUndefined();
  });
});

describe("isSingle (degenerate case, D-04)", () => {
  it("is true for a single-plan project", () => {
    expect(isSingle([{ id: "only", anticipoPct: "20", cuotas: 12 }])).toBe(true);
  });

  it("is true for an empty plans array", () => {
    expect(isSingle([])).toBe(true);
  });

  it("is false for two or more plans", () => {
    expect(isSingle(plans)).toBe(false);
  });
});
