import { describe, it, expect } from "vitest";
// Imported from the pure predicate module (not the "use client" trpc-client.tsx)
// so the unit test asserts the split condition without pulling the JSX provider
// into Vitest. trpc-client.tsx imports + re-exports this same `isQuotesOp` and
// uses it in the splitLink `condition`, so this is the exact predicate that ships.
import { isQuotesOp } from "../lib/trpc-split";

// Guards RESEARCH Pitfall 1 / threat T-06-02-DOS: only `quotes.*` procedures may
// take the dedicated splitLink batch. If a non-quotes op ever matched, its
// request could co-batch quotes onto a path outside `/api/trpc/quotes.*` and
// escape the nginx limit_req (QUOTE-03) rate limit. This asserts the predicate
// the splitLink `condition` uses, without booting a client.
describe("isQuotesOp splitLink predicate", () => {
  it("returns true for quotes.* procedures", () => {
    expect(isQuotesOp("quotes.compute")).toBe(true);
    expect(isQuotesOp("quotes.create")).toBe(true);
  });

  it("returns false for non-quotes procedures", () => {
    expect(isQuotesOp("picker.listUnits")).toBe(false);
    expect(isQuotesOp("projects.listPublished")).toBe(false);
  });
});
