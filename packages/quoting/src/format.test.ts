import { describe, expect, it } from "vitest";

import { formatArs, formatUsd } from "./format";

// The es-AR formatter is the deterministic string contract fase 6 (browser) and fase 7 (Node/worker)
// both rely on (D-12). Assertions are EXACT string equality — an invisible-char divergence (U+202F)
// would silently break "UI == PDF == WhatsApp" (Pitfall 5 / threat T-04-04). The USD label is
// `US$ ` and the ARS label is `$ ` — a USD amount must never render with a bare `$` (1000x misread).

const NARROW_NBSP = " ";

describe("formatUsd (US$, whole USD, dot thousands, hand-owned label)", () => {
  it("groups thousands with a dot: formatUsd(1234) === 'US$ 1.234'", () => {
    expect(formatUsd(1234)).toBe("US$ 1.234");
  });

  it("groups millions: formatUsd(1000000) === 'US$ 1.000.000'", () => {
    expect(formatUsd(1000000)).toBe("US$ 1.000.000");
  });

  it("renders zero: formatUsd(0) === 'US$ 0'", () => {
    expect(formatUsd(0)).toBe("US$ 0");
  });

  it("renders sub-thousand values without a grouping separator: formatUsd(999) === 'US$ 999'", () => {
    expect(formatUsd(999)).toBe("US$ 999");
  });

  it("uses the US$ label with a normal ASCII space, never a bare $", () => {
    const out = formatUsd(1234);
    expect(out.startsWith("US$ ")).toBe(true);
    expect(out).not.toMatch(/^\$/);
  });
});

describe("formatArs ($, 2 decimals with comma, dot thousands, hand-owned label)", () => {
  it("formats the 2-decimal ARS string: formatArs('1234560.00') === '$ 1.234.560,00'", () => {
    expect(formatArs("1234560.00")).toBe("$ 1.234.560,00");
  });

  it("preserves small values with decimals: formatArs('0.50') === '$ 0,50'", () => {
    expect(formatArs("0.50")).toBe("$ 0,50");
  });

  it("preserves exactly the 2 decimals from the input string (no rounding drift)", () => {
    expect(formatArs("1234.57")).toBe("$ 1.234,57");
  });
});

describe("determinism guard — no ICU narrow no-break space (U+202F)", () => {
  it("formatUsd output contains no U+202F", () => {
    expect(formatUsd(1234567)).not.toContain(NARROW_NBSP);
  });

  it("formatArs output contains no U+202F", () => {
    expect(formatArs("1234567.89")).not.toContain(NARROW_NBSP);
  });
});
