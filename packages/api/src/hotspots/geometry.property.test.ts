import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { describe, expect } from "vitest";

import { parsePolygon, serializePolygon, validatePolygon, type Point } from "./geometry";

// INVARIANT properties (mirrors engine.property.test.ts / parseMoneyEsAr): never re-derive the
// module's own arithmetic as an oracle. Three load-bearing invariants:
//   1. serialize→parse round-trips for ANY integer point list in [0,1000] (panel-write == phase-2-read).
//   2. a genuinely convex polygon (vertices on a circle in angular order) is ALWAYS { ok:true }.
//   3. a constructed bowtie is ALWAYS { ok:false, reason:'self_intersecting' }.

const intCoord = fc.integer({ min: 0, max: 1000 });
const point: fc.Arbitrary<Point> = fc.record({ x: intCoord, y: intCoord });

describe("serialize→parse round-trip (D-09 intrinsic-coordinate contract)", () => {
  test.prop([fc.array(point, { minLength: 1, maxLength: 40 })])(
    "parsePolygon(serializePolygon(p)) deep-equals p for any integer point list",
    (points) => {
      expect(parsePolygon(serializePolygon(points))).toEqual(points);
    },
  );
});

// A convex polygon generator: N distinct angles sorted ascending, each vertex on a circle of a
// fixed (per-polygon) radius around a center kept fully inside the viewBox. Points on a circle in
// angular order are always convex ⇒ non-self-intersecting with strictly positive area — the exact
// invariant "a real hotspot polygon always validates". Radius ≥ 200 keeps area >> EPSILON.
const convexPolygon: fc.Arbitrary<Point[]> = fc
  .record({
    n: fc.integer({ min: 3, max: 12 }),
    radius: fc.integer({ min: 200, max: 450 }),
    cx: fc.integer({ min: 450, max: 550 }),
    cy: fc.integer({ min: 450, max: 550 }),
    angles: fc.uniqueArray(fc.integer({ min: 0, max: 3599 }), {
      minLength: 3,
      maxLength: 12,
    }),
  })
  .map(({ radius, cx, cy, angles }) => {
    const sorted = [...angles].sort((a, b) => a - b);
    return sorted.map((deciDeg) => {
      const rad = (deciDeg / 3600) * 2 * Math.PI;
      const x = Math.round(cx + radius * Math.cos(rad));
      const y = Math.round(cy + radius * Math.sin(rad));
      return { x: Math.min(1000, Math.max(0, x)), y: Math.min(1000, Math.max(0, y)) };
    });
  });

describe("a genuinely convex polygon always validates", () => {
  test.prop([convexPolygon])("validatePolygon(convex) === { ok:true }", (points) => {
    // Guard against the rare case where rounding/clamping collapsed two adjacent angles onto the
    // same integer point (would drop below a real 3-gon); skip only those degenerate draws.
    fc.pre(points.length >= 3);
    expect(validatePolygon(points)).toEqual({ ok: true });
  });
});

describe("a constructed bowtie is always self_intersecting", () => {
  // Build a guaranteed self-crossing quad: two opposite corners then the OTHER two swapped, so the
  // diagonals cross. Uses a well-separated axis-aligned box to keep the crossing unambiguous.
  test.prop([
    fc.integer({ min: 0, max: 400 }),
    fc.integer({ min: 0, max: 400 }),
    fc.integer({ min: 500, max: 1000 }),
    fc.integer({ min: 500, max: 1000 }),
  ])("a swapped-diagonal quad crosses itself", (x0, y0, x1, y1) => {
    const bowtie: Point[] = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      { x: x1, y: y0 },
      { x: x0, y: y1 },
    ];
    expect(validatePolygon(bowtie)).toEqual({ ok: false, reason: "self_intersecting" });
  });
});
