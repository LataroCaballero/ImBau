// PURE variant-selection helpers (MEDIA-02). Mirrors the partitions.ts split: these are
// side-effect-free (no sharp, no R2, no DB) so the width math + the quality table are
// unit-testable without any running infra (see media-variants.test.ts). The impure render
// loop that consumes them lives in media.ts.
//
// RESEARCH §358-374 is the source of truth for pickWidths + QUALITY.

// Candidate srcset widths (CSS px), ascending. [ASSUMED — product-tunable]: covers small
// phones (384) through retina desktop (2560). pickWidths never emits a width >= the source
// (no upscale), so an original narrower than 2560 simply yields a shorter list.
export const BREAKPOINTS = [384, 640, 768, 1024, 1366, 1920, 2560] as const;

// The widest breakpoint — the upper clamp for any source. Computed once from BREAKPOINTS so
// the tuple stays the single source of truth (and sidesteps noUncheckedIndexedAccess on a
// computed last-index access).
const LARGEST_BREAKPOINT = Math.max(...BREAKPOINTS);

// sharp encode parameters per output format (RESEARCH §358-374). readonly constant — the
// render loop passes QUALITY[fmt] straight into sharp's .avif()/.webp().
//   - avif: quality 50 / effort 4 — good size/quality for architectural renders. [ASSUMED]
//   - webp: quality 80 — broadly-supported fallback. [ASSUMED]
export const QUALITY = {
  avif: { quality: 50, effort: 4 },
  webp: { quality: 80 },
} as const;

/**
 * Select the variant widths to generate for a source of `srcWidth` px — NEVER upscaling.
 *
 * Returns every BREAKPOINT strictly smaller than `srcWidth`, plus a single source clamp
 * (`min(srcWidth, largest breakpoint)`) so the largest variant matches the original instead
 * of enlarging it. The result is deduped and sorted ascending. `srcWidth <= 0` (unknown
 * dimensions) yields `[]` — nothing to render.
 *
 * Invariant (no upscale): the only width that may equal `srcWidth` is the source clamp; no
 * breakpoint >= srcWidth is ever emitted.
 */
export function pickWidths(srcWidth: number): number[] {
  if (srcWidth <= 0) return [];
  const usable = BREAKPOINTS.filter((w) => w < srcWidth);
  // Clamp the source to the largest breakpoint so we never produce a variant wider than our
  // top srcset entry; for a source narrower than the top breakpoint this is srcWidth itself.
  const sourceClamp = Math.min(srcWidth, LARGEST_BREAKPOINT);
  return [...new Set([...usable, sourceClamp])].sort((a, b) => a - b);
}
