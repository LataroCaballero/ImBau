// Pure, dependency-free hotspot geometry — the SINGLE SOURCE OF TRUTH for HSPOT-04's blocking
// polygon validation (D-08) and the intrinsic viewBox-0-1000 serialize/parse contract (D-09).
// Deliberately imports NOTHING (no @imbau/db, no exceljs, no network, no node built-ins): exactly
// like packages/api/src/excel/money-core.ts, it is safe to bundle into the panel CLIENT island so
// the editor can pre-validate before "Guardar polígono" — while the Plan-02 router RE-VALIDATES
// through the same functions server-side (never trust a client `isValid` flag). Panel-write and the
// future phase-2 explorer both go through serialize/parse here, so a persisted string never drifts.
//
// LOCKED persisted format (resolves the UI-SPEC coordinate-normalization item): a `<polygon points>`
// string `"x,y x,y x,y …"` — space between vertex pairs, comma within a pair, ALL integers in
// [0,1000], minimum 3 pairs to be a valid polygon. Coordinates are intrinsic viewBox units on a
// square-normalized `0 0 1000 1000` box (aspect NOT preserved in the mapping); they never depend on
// the render's on-screen pixel width — the "dinero entero nunca float" analog for coordinates.

/** A vertex in intrinsic viewBox space. Both coordinates are integers in [0,1000] when valid. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Why a polygon is invalid. Blocking + typed (D-08): the caller maps this to an es-AR message. */
export type PolygonReason =
  | "too_few_points"
  | "degenerate"
  | "self_intersecting"
  | "out_of_bounds";

/** Result of validatePolygon — a discriminated union so callers cannot forget the failure branch. */
export type PolygonValidation = { ok: true } | { ok: false; reason: PolygonReason };

/** Thrown by parsePolygon when a stored/user string is not the locked integer-pair format. */
export class PolygonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolygonParseError";
  }
}

// Intrinsic viewBox bounds (D-09). A vertex must be an integer in [0, VIEWBOX_MAX].
const VIEWBOX_MIN = 0;
const VIEWBOX_MAX = 1000;

// Minimum polygon area (in viewBox² units) below which the shape is treated as degenerate. A real
// hotspot always encloses a visible region; a sub-1-unit² triangle is sub-pixel at any render size
// and unusable, while an exactly-collinear polygon has area 0 — both are caught here. Chosen small
// enough that any genuinely visible triangle passes, large enough that near-zero area is rejected.
const MIN_AREA_EPSILON = 1;

/** Is `n` a valid intrinsic viewBox coordinate (an integer in [0,1000])? */
function isValidCoord(n: number): boolean {
  return Number.isInteger(n) && n >= VIEWBOX_MIN && n <= VIEWBOX_MAX;
}

/**
 * Serialize a point list to the LOCKED `"x,y x,y …"` integer format. `Math.round` is defensive: the
 * editor already rounds screen→viewBox coordinates, but rounding here guarantees the emitted string
 * is always integer pairs so parse/round-trip is exact regardless of a float sneaking in.
 */
export function serializePolygon(points: readonly Point[]): string {
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" ");
}

/**
 * Parse the LOCKED `"x,y x,y …"` format into a point list, accepting ONLY integer pairs in [0,1000]
 * (the T-12-05 injection guard: a tampered stored string can carry arbitrary text destined for a
 * future `<polygon points>` render, so anything that is not a clean integer pair is REJECTED, never
 * repaired or returned as junk). Throws PolygonParseError on any malformed token or an empty string.
 */
export function parsePolygon(svg: string): Point[] {
  const trimmed = svg.trim();
  if (trimmed === "") {
    throw new PolygonParseError("El polígono está vacío.");
  }
  const pairs = trimmed.split(/\s+/);
  return pairs.map((pair) => {
    const parts = pair.split(",");
    if (parts.length !== 2) {
      throw new PolygonParseError(`Par de coordenadas inválido: "${pair}".`);
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    // Number("") === 0 and Number("1e3") === 1000, so re-gate strictly: each part must be a plain
    // integer literal within bounds. isValidCoord rejects NaN, floats, and out-of-range values.
    if (parts[0] === "" || parts[1] === "" || !isValidCoord(x) || !isValidCoord(y)) {
      throw new PolygonParseError(`Coordenada inválida en "${pair}" (se esperan enteros 0–1000).`);
    }
    return { x, y };
  });
}

// Twice the signed area of the polygon (shoelace). Sign encodes winding; we only use |area|/2.
function signedDoubleArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

// Orientation of the ordered triple (a, b, c): >0 CCW, <0 CW, 0 collinear (2D cross product).
function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// Do segments (p1,p2) and (p3,p4) PROPERLY cross (interiors intersect)? Endpoint-touching and
// collinear overlap are intentionally NOT counted — adjacent polygon edges share an endpoint by
// construction and are skipped by the caller, so only a true self-crossing trips this.
function segmentsProperlyIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

// Does the closed polygon have any pair of NON-ADJACENT edges that properly cross? O(n²), which is
// fine — polygons here are a handful of vertices and the Plan-02 router caps the count at the Zod
// boundary (T-12-04). Edges are v[i]→v[i+1]; edge i and edge j are adjacent when they share a
// vertex, i.e. j === i+1 or the wrap pair (i === 0 and j === n-1).
function hasSelfIntersection(points: readonly Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1) continue; // consecutive edges share a vertex
      if (i === 0 && j === n - 1) continue; // closing edge is adjacent to the first edge
      const b1 = points[j]!;
      const b2 = points[(j + 1) % n]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Validate a polygon — BLOCKING and NO AUTOCORRECT (D-08). Returns a typed reason; nothing is
 * silently repaired. Check order is load-bearing: self-intersection is tested BEFORE the area check
 * because a classic bowtie has shoelace area 0 (it would otherwise be mislabeled `degenerate`);
 * an exactly-collinear polygon has no non-adjacent crossing, so it correctly falls through to
 * `degenerate`.
 */
export function validatePolygon(points: readonly Point[]): PolygonValidation {
  if (points.length < 3) {
    return { ok: false, reason: "too_few_points" };
  }
  for (const p of points) {
    if (!isValidCoord(p.x) || !isValidCoord(p.y)) {
      return { ok: false, reason: "out_of_bounds" };
    }
  }
  if (hasSelfIntersection(points)) {
    return { ok: false, reason: "self_intersecting" };
  }
  const area = Math.abs(signedDoubleArea(points)) / 2;
  if (area < MIN_AREA_EPSILON) {
    return { ok: false, reason: "degenerate" };
  }
  return { ok: true };
}

// es-AR voseo copy (12-UI-SPEC §"Validation messages — blocking, es-AR, no autocorrect"). The
// out_of_bounds string has no explicit UI-SPEC row (the editor's screen→viewBox transform clamps to
// [0,1000], so it is a defensive server-side reason); it stays in the same voseo tone.
const REASON_MESSAGES: Record<PolygonReason, string> = {
  too_few_points: "Un polígono necesita al menos 3 vértices.",
  degenerate:
    "El polígono no tiene área — los vértices están alineados. Movelos para que encierre una región.",
  self_intersecting: "El polígono se cruza consigo mismo — corregilo antes de guardar.",
  out_of_bounds: "Los vértices deben estar dentro del render (0 a 1000).",
};

/** Map a typed validation reason to its es-AR voseo message (shown in the panel's validation banner). */
export function polygonErrorMessage(reason: PolygonReason): string {
  return REASON_MESSAGES[reason];
}
