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
// fixed (per-polygon) radius around a center kept WELL inside the viewBox. Center ∈ [470,530] with
// radius ≤ 430 ⇒ every coordinate lands in [40,960]: no clamp ever fires, so each vertex is a true
// (rounded) circle point and the polygon stays convex ⇒ non-self-intersecting and in-bounds — the
// exact invariant "a real hotspot polygon always validates". Integer rounding of clustered angles
// can still yield a sub-EPSILON sliver; the area precondition below drops exactly those.
const convexPolygon: fc.Arbitrary<Point[]> = fc
  .record({
    radius: fc.integer({ min: 200, max: 430 }),
    cx: fc.integer({ min: 470, max: 530 }),
    cy: fc.integer({ min: 470, max: 530 }),
    angles: fc.uniqueArray(fc.integer({ min: 0, max: 3599 }), {
      minLength: 3,
      maxLength: 12,
    }),
  })
  .map(({ radius, cx, cy, angles }) => {
    const sorted = [...angles].sort((a, b) => a - b);
    return sorted.map((deciDeg) => {
      const rad = (deciDeg / 3600) * 2 * Math.PI;
      return { x: Math.round(cx + radius * Math.cos(rad)), y: Math.round(cy + radius * Math.sin(rad)) };
    });
  });

// Independent |2·signed area| (shoelace), used ONLY to FILTER degenerate draws in the precondition
// below — never as the assertion oracle (the test still asserts the full validatePolygon result).
function twiceAbsArea(pts: readonly Point[]): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if (!p || !q) continue;
    acc += p.x * q.y - q.x * p.y;
  }
  return Math.abs(acc);
}

describe("a genuinely convex polygon always validates", () => {
  test.prop([convexPolygon])("validatePolygon(convex) === { ok:true }", (points) => {
    // Integer rounding of clustered angles can still collapse vertices into a sub-EPSILON sliver
    // (coincident or near-collinear) that validatePolygon RIGHTLY rejects as `degenerate`. This
    // invariant is about real, visible polygons, so skip exactly those: validatePolygon treats
    // area < MIN_AREA_EPSILON (=1) as degenerate, i.e. |2·area| < 2. With exact integer coords the
    // threshold is boundary-exact, so requiring |2·area| ≥ 2 keeps precisely the non-degenerate draws.
    fc.pre(twiceAbsArea(points) >= 2);
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
