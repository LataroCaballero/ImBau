import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { baseEnv, redisEnv, r2Env } from "@imbau/config/env/presets";

// We exercise the SAME composed schema the app uses (baseEnv.server + the fase-7
// server-only REDIS_URL + R2_* the web process now needs for the PDF producer/
// presign, D-02 + the NEXT_PUBLIC_APP_ENV enum) via env-core so the test runs
// outside a Next runtime. t3-env aggregates issues by default and surfaces the
// failing variable NAME via onValidationError without leaking the offending value
// (D-04, V7). panel reuses this exact env pattern, so one test on web gates both
// (same composed schema).
const appEnvEnum = z.enum(["development", "staging", "production"]);

// Server-only schema the web env now composes (parity with env.ts): base + the
// fase-7 Redis + R2 vars. These live under `server` only — never NEXT_PUBLIC_.
const serverSchema = {
  ...baseEnv.server,
  ...redisEnv.server,
  ...r2Env.server,
};

// Dummy non-secret values so the valid case resolves (mirrors what SOPS injects
// at runtime). These are test fixtures — never real credentials.
const validServerRuntimeEnv = {
  NODE_ENV: "test",
  REDIS_URL: "redis://localhost:6380",
  R2_ACCOUNT_ID: "test",
  R2_ACCESS_KEY_ID: "test",
  R2_SECRET_ACCESS_KEY: "test",
  R2_BUCKET: "test",
  R2_PUBLIC_BASE_URL: "https://cdn.example.test",
} as const;

describe("web env validation", () => {
  it("surfaces NEXT_PUBLIC_APP_ENV when its value is invalid", () => {
    const failedNames: string[] = [];

    expect(() =>
      createEnv({
        server: serverSchema,
        client: { NEXT_PUBLIC_APP_ENV: appEnvEnum },
        clientPrefix: "NEXT_PUBLIC_",
        // Server vars supplied so the ONLY failing var is NEXT_PUBLIC_APP_ENV.
        runtimeEnv: { ...validServerRuntimeEnv, NEXT_PUBLIC_APP_ENV: "prod" },
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

  it("resolves without throwing when NEXT_PUBLIC_APP_ENV + the server vars are valid", () => {
    const env = createEnv({
      server: serverSchema,
      client: { NEXT_PUBLIC_APP_ENV: appEnvEnum },
      clientPrefix: "NEXT_PUBLIC_",
      runtimeEnv: {
        ...validServerRuntimeEnv,
        NEXT_PUBLIC_APP_ENV: "production",
      },
    });
    // Validation passing (no throw) is the parity check: the composed server schema
    // now includes REDIS_URL + R2_* and every one resolved from validServerRuntimeEnv.
    // We only READ a client var here — t3-env fences server-var access on the client
    // (jsdom), which is exactly the leak guard we want (T-07-05).
    expect(env.NEXT_PUBLIC_APP_ENV).toBe("production");
  });
});
