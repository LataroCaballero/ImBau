import { describe, expect, it } from "vitest";

import { roundUsd } from "./index";

describe("roundUsd", () => {
  it("rounds up to the nearest whole USD", () => {
    expect(roundUsd(1234.6)).toBe(1235);
  });

  it("rounds down to the nearest whole USD", () => {
    expect(roundUsd(1234.4)).toBe(1234);
  });
});
