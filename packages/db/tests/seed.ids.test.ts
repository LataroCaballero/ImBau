// seed.ids — unit tests for the deterministic-idempotency core (SEED-04).
//
// These are pure-function tests (no DB), but they run under the @imbau/db suite whose
// globalSetup migrates the test DB + runs the role guard once; that is fine — the assertions
// here touch no connection. The point is to lock the determinism contract that every downstream
// seed module depends on: same name → same id, different name → different id, valid UUID shape,
// and a reproducible PRNG stream.
import { describe, it, expect } from "vitest";
import { seedId, makePrng, SEED_NS, SEED_REFERENCE_DATE } from "../src/seed/ids";

// RFC-4122 UUID (any version). uuidv5 emits a version-5 (…-5xxx-…) lowercase-hex UUID.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("seed ids — deterministic idempotency core", () => {
  it("seedId is stable: same name → same id across calls", () => {
    expect(seedId("x")).toBe(seedId("x"));
    expect(seedId("brigos:unit:04-B")).toBe(seedId("brigos:unit:04-B"));
  });

  it("seedId is distinct: different names → different ids", () => {
    expect(seedId("x")).not.toBe(seedId("y"));
    expect(seedId("brigos:org")).not.toBe(seedId("brigos:project"));
  });

  it("seedId returns a valid UUID string", () => {
    expect(seedId("x")).toMatch(UUID_RE);
    // SEED_NS itself is a well-formed UUID (the namespace must never change).
    expect(SEED_NS).toMatch(UUID_RE);
  });

  it("makePrng is reproducible: same seed → identical stream", () => {
    const a = makePrng(1);
    const b = makePrng(1);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    // Different seeds diverge.
    const c = makePrng(2);
    expect(c()).not.toBe(makePrng(1)());
    // Values are in [0, 1).
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("SEED_REFERENCE_DATE is a fixed instant (never the wall clock)", () => {
    expect(SEED_REFERENCE_DATE.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
