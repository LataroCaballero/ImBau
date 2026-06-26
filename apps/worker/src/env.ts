import { createEnv } from "@t3-oss/env-core";
import { baseEnv, redisEnv, sentryEnv, lokiEnv } from "@imbau/config/env/presets";

// Worker env validation (D-01, D-02): composes ONLY the presets the worker uses
// — NODE_ENV + REDIS_URL. No client-side browser vars here (those are
// web/panel-only), and NO DATABASE_URL: the worker is a BullMQ↔Redis shell
// (APP-03) that opens zero Postgres connections — it never touches @imbau/db,
// appDb, anonDb, or withTenant. Requiring DATABASE_URL would force the container
// to carry an unused DB credential and would fail the worker's boot in any
// deployment that correctly separates worker secrets from the DB owner creds
// (WR-01). t3-env aggregates every Zod issue by default (A2/Pitfall 4), so a
// boot with several bad vars surfaces all their names at once (D-04). We do NOT
// override onValidationError: the default formatter prints variable NAME +
// reason, never the offending VALUE (security requirement V7, T-03-02).
//
// SKIP_ENV_VALIDATION is honored ONLY for the fase-3 Docker image build (D-03);
// at container boot it is unset, so validation always runs and fails closed.
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    // DATABASE_URL removed — the worker has no Postgres connections (APP-03
    // shell). Only NODE_ENV + REDIS_URL are required to boot.
    // Observability (OBS-01/OBS-02): server Sentry DSN + Loki shipping target.
    // All optional — with no DSN/LOKI_URL Sentry + the pino logger are local
    // no-ops, so the worker still boots with zero external deps in dev.
    ...sentryEnv.server,
    ...lokiEnv.server,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
