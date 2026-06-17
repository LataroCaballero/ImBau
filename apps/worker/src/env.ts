import { createEnv } from "@t3-oss/env-core";
import { baseEnv, dbEnv, redisEnv } from "@imbau/config/env/presets";

// Worker env validation (D-01, D-02): composes ONLY the presets the worker uses
// — NODE_ENV, DATABASE_URL, REDIS_URL. No client-side browser vars here (those
// are web/panel-only). t3-env aggregates
// every Zod issue by default (A2/Pitfall 4), so a boot with several bad vars
// surfaces all their names at once (D-04). We do NOT override onValidationError:
// the default formatter prints variable NAME + reason, never the offending VALUE
// (security requirement V7, T-03-02).
//
// SKIP_ENV_VALIDATION is honored ONLY for the fase-3 Docker image build (D-03);
// at container boot it is unset, so validation always runs and fails closed.
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    // Worker composes ONLY the owner/migration DATABASE_URL it uses — NOT the
    // whole dbEnv preset. DATABASE_APP_URL / DATABASE_ANON_URL (added in phase 2
    // for the role split, D-04/D-06) are consumed only by the request path and
    // the test harness; requiring them here would break the worker's boot for
    // connection strings it never touches.
    DATABASE_URL: dbEnv.server.DATABASE_URL,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
