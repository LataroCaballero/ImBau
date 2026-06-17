import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, dbEnv, redisEnv } from "@imbau/config/env/presets";

describe("worker env validation", () => {
  it("reports every missing/invalid var at once (aggregated error)", () => {
    // t3-env aggregates ALL Zod issues by default (A2/Pitfall 4): the thrown
    // Error message is generic, but the per-variable issues are surfaced via
    // `onValidationError`. We capture the aggregated issues and assert BOTH
    // failing variable names appear — DATABASE_URL invalid AND REDIS_URL
    // missing must both surface (D-04, D-10). The issues carry only the
    // variable NAME (path) + a reason, never the offending VALUE (V7).
    const failedNames: string[] = [];

    expect(() =>
      createEnv({
        server: {
          ...baseEnv.server,
          ...redisEnv.server,
          // Mirror env.ts: worker uses only the owner DATABASE_URL.
          DATABASE_URL: dbEnv.server.DATABASE_URL,
        },
        // DATABASE_URL invalid AND REDIS_URL missing — both must aggregate.
        runtimeEnv: { DATABASE_URL: "not-a-url", NODE_ENV: "test" },
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

    expect(failedNames).toContain("DATABASE_URL");
    expect(failedNames).toContain("REDIS_URL");
  });

  it("resolves without throwing when env is valid", () => {
    const env = createEnv({
      server: {
        ...baseEnv.server,
        ...redisEnv.server,
        // Mirror env.ts: worker uses only the owner DATABASE_URL.
        DATABASE_URL: dbEnv.server.DATABASE_URL,
      },
      runtimeEnv: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://user:pass@localhost:5432/imbau",
        REDIS_URL: "redis://localhost:6379",
      },
    });
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
  });
});
