import { describe, expect, it } from "vitest";

import {
  parsePolygon,
  polygonErrorMessage,
  serializePolygon,
  validatePolygon,
  type Point,
} from "./geometry";

// The geometry module is the SINGLE SOURCE OF TRUTH for HSPOT-04: blocking, no-autocorrect polygon
// validation (D-08) + the intrinsic viewBox-0-1000 serialize/parse contract (D-09) that panel-write
// and phase-2-read agree on byte-for-byte. Assertions are EXACT — a repaired/guessed polygon would
// be a silent product bug, so every bad shape maps to one typed reason and nothing is auto-fixed.

// A valid convex triangle well inside the viewBox (area >> EPSILON).
const TRIANGLE: Point[] = [
  { x: 100, y: 100 },
  { x: 900, y: 100 },
  { x: 500, y: 900 },
];
// A valid convex quad.
const QUAD: Point[] = [
  { x: 120, y: 880 },
  { x: 300, y: 880 },
  { x: 300, y: 650 },
  { x: 120, y: 650 },
];

describe("serializePolygon — locked '\"x,y x,y …\"' integer format (D-09)", () => {
  it("emits space-separated pairs, comma within a pair", () => {
    expect(serializePolygon([
      { x: 120, y: 880 },
      { x: 300, y: 880 },
      { x: 300, y: 650 },
    ])).toBe("120,880 300,880 300,650");
  });

  it("emits integers even if fed rounded-representable floats (defensive)", () => {
    expect(serializePolygon([
      { x: 10.0, y: 20.0 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ])).toBe("10,20 30,40 50,60");
  });
});

describe("parsePolygon — parses the locked format, rejects junk (T-12-05 injection guard)", () => {
  it("round-trips the serialized triangle", () => {
    expect(parsePolygon("100,100 900,100 500,900")).toEqual(TRIANGLE);
  });

  it("parse(serialize(p)) deep-equals p", () => {
    expect(parsePolygon(serializePolygon(QUAD))).toEqual(QUAD);
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["non-numeric", "abc,def 100,100 200,200"],
    ["non-integer coordinate", "100.5,100 200,200 300,300"],
    ["out-of-range coordinate", "100,100 200,200 1001,300"],
    ["negative coordinate", "100,100 200,200 -1,300"],
    ["missing y", "100 200,200 300,300"],
    ["extra component", "100,100,5 200,200 300,300"],
  ])("rejects malformed input (%s) rather than returning junk", (_label, bad) => {
    expect(() => parsePolygon(bad)).toThrow();
  });
});

describe("validatePolygon — blocking, no autocorrect (D-08)", () => {
  it("accepts a valid triangle", () => {
    expect(validatePolygon(TRIANGLE)).toEqual({ ok: true });
  });

  it("accepts a valid convex quad", () => {
    expect(validatePolygon(QUAD)).toEqual({ ok: true });
  });

  it("rejects fewer than 3 vertices → too_few_points", () => {
    expect(validatePolygon([{ x: 100, y: 100 }, { x: 200, y: 200 }])).toEqual({
      ok: false,
      reason: "too_few_points",
    });
  });

  it("rejects 3 collinear points (zero area) → degenerate", () => {
    expect(validatePolygon([
      { x: 0, y: 0 },
      { x: 500, y: 500 },
      { x: 1000, y: 1000 },
    ])).toEqual({ ok: false, reason: "degenerate" });
  });

  it("rejects a bowtie (self-crossing quad) → self_intersecting", () => {
    // Classic bowtie ordering: the two diagonals cross at (500,500). Note its shoelace area is 0,
    // so self-intersection MUST be tested before the degenerate/area check.
    expect(validatePolygon([
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
    ])).toEqual({ ok: false, reason: "self_intersecting" });
  });

  it("rejects a vertex outside [0,1000] → out_of_bounds", () => {
    expect(validatePolygon([
      { x: 100, y: 100 },
      { x: 1200, y: 100 },
      { x: 500, y: 900 },
    ])).toEqual({ ok: false, reason: "out_of_bounds" });
  });

  it("rejects a non-integer vertex → out_of_bounds", () => {
    expect(validatePolygon([
      { x: 100, y: 100 },
      { x: 900.5, y: 100 },
      { x: 500, y: 900 },
    ])).toEqual({ ok: false, reason: "out_of_bounds" });
  });
});

describe("polygonErrorMessage — es-AR voseo (12-UI-SPEC §Validation messages)", () => {
  it("maps each reason to its exact UI-SPEC string", () => {
    expect(polygonErrorMessage("too_few_points")).toBe("Un polígono necesita al menos 3 vértices.");
    expect(polygonErrorMessage("degenerate")).toBe(
      "El polígono no tiene área — los vértices están alineados. Movelos para que encierre una región.",
    );
    expect(polygonErrorMessage("self_intersecting")).toBe(
      "El polígono se cruza consigo mismo — corregilo antes de guardar.",
    );
    expect(polygonErrorMessage("out_of_bounds")).toBe(
      "Los vértices deben estar dentro del render (0 a 1000).",
    );
  });
});
