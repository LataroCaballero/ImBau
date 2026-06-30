import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, redisEnv, r2Env, dbEnv } from "@imbau/config/env/presets";

describe("worker env validation", () => {
  it("reports every missing/invalid var at once (aggregated error)", () => {
    // t3-env aggregates ALL Zod issues by default (A2/Pitfall 4): the thrown Error message is
    // generic, but the per-variable issues are surfaced via `onValidationError`. We capture the
    // aggregated issues and assert the failing variable NAMES appear — NODE_ENV invalid,
    // REDIS_URL missing, AND a missing R2 var (R2_BUCKET) must all surface (D-04, D-10, A8). The
    // issues carry only the variable NAME (path) + a reason, never the offending VALUE (V7).
    // Plan 02-02 (A8) extended the worker schema with r2Env + dbEnv, so we mirror the full
    // composed surface here.
    const failedNames: string[] = [];

    expect(() =>
      createEnv({
        server: {
          ...baseEnv.server,
          ...redisEnv.server,
          ...r2Env.server,
          ...dbEnv.server,
        },
        // NODE_ENV invalid AND REDIS_URL + every R2_*/DATABASE_* missing — all must aggregate.
        runtimeEnv: { NODE_ENV: "not-an-env" },
        onValidationError: (issues) => {
          for (const issue of issues) {
            const name = issue.path?.[0];
            if (typeof name === "string") failedNames.push(name);
            else if (
              name !== undefined &&
              typeof name === "object" &&
              "key" in name
            ) {
              failedNames.push(String(name.key));
            }
          }
          throw new Error("Invalid environment variables");
        },
      }),
    ).toThrow();

    expect(failedNames).toContain("NODE_ENV");
    expect(failedNames).toContain("REDIS_URL");
    // A8: a missing R2 var surfaces by NAME too (never its value).
    expect(failedNames).toContain("R2_BUCKET");
  });

  it("resolves without throwing when env is valid", () => {
    const env = createEnv({
      server: {
        ...baseEnv.server,
        ...redisEnv.server,
        ...r2Env.server,
        ...dbEnv.server,
      },
      runtimeEnv: {
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
        // r2Env: credentials + bucket + public base URL (dummy values; no R2 contacted here).
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "ak",
        R2_SECRET_ACCESS_KEY: "sk",
        R2_BUCKET: "bucket",
        R2_PUBLIC_BASE_URL: "https://cdn.example.test",
        // dbEnv: all three connection strings (A8) — owner/app/anon.
        DATABASE_URL: "postgres://owner@localhost:5432/imbau_test",
        DATABASE_APP_URL: "postgres://app_authenticated@localhost:5432/imbau_test",
        DATABASE_ANON_URL: "postgres://anon@localhost:5432/imbau_test",
      },
    });
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
    expect(env.R2_BUCKET).toBe("bucket");
  });
});
