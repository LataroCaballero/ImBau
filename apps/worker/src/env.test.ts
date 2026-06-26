import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, redisEnv } from "@imbau/config/env/presets";

describe("worker env validation", () => {
  it("reports every missing/invalid var at once (aggregated error)", () => {
    // t3-env aggregates ALL Zod issues by default (A2/Pitfall 4): the thrown
    // Error message is generic, but the per-variable issues are surfaced via
    // `onValidationError`. We capture the aggregated issues and assert BOTH
    // failing variable names appear — NODE_ENV invalid AND REDIS_URL missing
    // must both surface (D-04, D-10). The issues carry only the variable NAME
    // (path) + a reason, never the offending VALUE (V7). The worker schema has
    // no DATABASE_URL (WR-01): it is a BullMQ↔Redis shell with zero Postgres
    // connections, so we mirror only baseEnv + redisEnv here.
    const failedNames: string[] = [];

    expect(() =>
      createEnv({
        server: {
          ...baseEnv.server,
          ...redisEnv.server,
        },
        // NODE_ENV invalid AND REDIS_URL missing — both must aggregate.
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
  });

  it("resolves without throwing when env is valid", () => {
    const env = createEnv({
      server: {
        ...baseEnv.server,
        ...redisEnv.server,
      },
      runtimeEnv: {
        NODE_ENV: "test",
        REDIS_URL: "redis://localhost:6379",
      },
    });
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
  });
});
