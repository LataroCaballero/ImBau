import { describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "./version";

describe("ENGINE_VERSION", () => {
  it("equals 1 — the quoteSnapshotSchema envelope literal (z.literal(1)) so a snapshot needs no migration", () => {
    expect(ENGINE_VERSION).toBe(1);
  });
});
