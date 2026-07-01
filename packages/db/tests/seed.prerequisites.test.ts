// seed.prerequisites — the D-05 fail-fast guard must abort naming the missing var, never leaking
// a secret value. We run in skipMedia mode so the assertion needs no R2/Redis network access:
// it exercises the env-presence branch, which is the security-relevant one (V7 names-not-values).
import { describe, it, expect, afterEach } from "vitest";
import { assertSeedPrerequisites } from "../src/seed/prerequisites";

// Save/restore only the keys we mutate so we never disturb the rest of the suite's env.
const KEYS = ["DATABASE_URL", "DATABASE_APP_URL", "DATABASE_ANON_URL"] as const;
const saved = new Map<string, string | undefined>();
for (const k of KEYS) saved.set(k, process.env[k]);

afterEach(() => {
  for (const k of KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Await a promise expected to reject and return its Error (typed, so message access is safe).
async function captureError(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the guard to throw, but it resolved");
}

describe("assertSeedPrerequisites — D-05 fail-fast guard", () => {
  it("throws naming a missing DB var, without leaking a present var's secret value", async () => {
    const secret = "postgres://super:s3cr3t-do-not-leak@db:5432/imbau_test";
    process.env.DATABASE_URL = secret; // present (holds a secret)
    delete process.env.DATABASE_APP_URL; // missing → must be named

    const err = await captureError(assertSeedPrerequisites({ skipMedia: true }));
    expect(err.message).toContain("DATABASE_APP_URL");
    // The secret VALUE of a present var must never appear in the message (ASVS V7).
    expect(err.message).not.toContain("s3cr3t-do-not-leak");
  });

  it("names ALL missing DB vars at once", async () => {
    delete process.env.DATABASE_APP_URL;
    delete process.env.DATABASE_ANON_URL;

    const err = await captureError(assertSeedPrerequisites({ skipMedia: true }));
    expect(err.message).toContain("DATABASE_APP_URL");
    expect(err.message).toContain("DATABASE_ANON_URL");
  });

  it("resolves when all DB vars are present (skipMedia skips R2/Redis probes)", async () => {
    // saved values are the live test-DB URLs from the harness env; they are all present.
    await expect(assertSeedPrerequisites({ skipMedia: true })).resolves.toBeUndefined();
  });
});
