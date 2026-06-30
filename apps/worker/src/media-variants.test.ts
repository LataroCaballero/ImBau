import { describe, it, expect } from "vitest";
import { pickWidths, QUALITY, BREAKPOINTS } from "./media-variants";

// Unit tests for the PURE variant-selection helpers (MEDIA-02). No infra: pickWidths +
// QUALITY are side-effect-free, so the no-upscale rule, the dedupe/sort, and the encode
// params are provable without sharp, R2, or Postgres. Analog of partitions.test.ts.

describe("pickWidths", () => {
  it("returns [] for a non-positive source width (unknown dimensions → nothing to render)", () => {
    expect(pickWidths(0)).toEqual([]);
    expect(pickWidths(-1)).toEqual([]);
  });

  it("never emits a width >= srcWidth except the source clamp (no upscale)", () => {
    // Source 1000: breakpoints below 1000 are 384/640/768; the clamp is min(1000,2560)=1000.
    const widths = pickWidths(1000);
    expect(widths).toEqual([384, 640, 768, 1000]);
    // No breakpoint at or above the source leaks in (1024/1366/1920/2560 excluded).
    for (const w of widths) {
      expect(w <= 1000).toBe(true);
    }
  });

  it("clamps a source wider than the largest breakpoint to that breakpoint (no upscale beyond 2560)", () => {
    // Source 4000: all breakpoints are < 4000, and the clamp is min(4000,2560)=2560, which is
    // already the largest breakpoint → dedupe collapses it. Result is exactly BREAKPOINTS.
    expect(pickWidths(4000)).toEqual([...BREAKPOINTS]);
  });

  it("dedupes when the source clamp coincides with an existing breakpoint", () => {
    // Source exactly 2560: breakpoints < 2560 are all but the last; clamp = 2560. No 2560 from
    // the filter (strict <), so the set adds it once → full ascending list with no duplicate.
    const widths = pickWidths(2560);
    expect(widths).toEqual([...BREAKPOINTS]);
    expect(new Set(widths).size).toBe(widths.length);
  });

  it("returns a sorted ascending list", () => {
    const widths = pickWidths(1500);
    const sorted = [...widths].sort((a, b) => a - b);
    expect(widths).toEqual(sorted);
  });

  it("for a source narrower than the smallest breakpoint, returns just the source clamp", () => {
    // Source 200: no breakpoint < 200, clamp = min(200,2560) = 200.
    expect(pickWidths(200)).toEqual([200]);
  });
});

describe("QUALITY", () => {
  it("uses AVIF quality 50 / effort 4", () => {
    expect(QUALITY.avif).toEqual({ quality: 50, effort: 4 });
  });

  it("uses WebP quality 80", () => {
    expect(QUALITY.webp).toEqual({ quality: 80 });
  });
});
