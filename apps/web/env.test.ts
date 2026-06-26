import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { baseEnv } from "@imbau/config/env/presets";

// We exercise the SAME composed schema the app uses (baseEnv.server + the
// NEXT_PUBLIC_APP_ENV enum) via env-core so the test runs outside a Next runtime.
// t3-env aggregates issues by default and surfaces the failing variable NAME via
// onValidationError without leaking the offending value (D-04, V7). panel reuses
// this exact env pattern, so one test on web gates both (same composed schema).
const appEnvEnum = z.enum(["development", "staging", "production"]);

describe("web env validation", () => {
  it("surfaces NEXT_PUBLIC_APP_ENV when its value is invalid", () => {
    const failedNames: string[] = [];

    expect(() =>
      createEnv({
        server: { ...baseEnv.server },
        client: { NEXT_PUBLIC_APP_ENV: appEnvEnum },
        clientPrefix: "NEXT_PUBLIC_",
        runtimeEnv: { NODE_ENV: "test", NEXT_PUBLIC_APP_ENV: "prod" },
        onValidationError: (issues) => {
          for (const issue of issues) {
            const name = issue.path?.[0];
            if (typeof name === "string") failedNames.push(name);
          }
          throw new Error("Invalid environment variables");
        },
      }),
    ).toThrow();

    expect(failedNames).toContain("NEXT_PUBLIC_APP_ENV");
  });

  it("resolves without throwing when NEXT_PUBLIC_APP_ENV is valid", () => {
    const env = createEnv({
      server: { ...baseEnv.server },
      client: { NEXT_PUBLIC_APP_ENV: appEnvEnum },
      clientPrefix: "NEXT_PUBLIC_",
      runtimeEnv: { NODE_ENV: "test", NEXT_PUBLIC_APP_ENV: "production" },
    });
    expect(env.NEXT_PUBLIC_APP_ENV).toBe("production");
  });
});
