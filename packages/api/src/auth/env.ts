import { createEnv } from "@t3-oss/env-core";
import { authEnv, baseEnv, dbEnv } from "@imbau/config/env/presets";

// Validated env for the @imbau/api auth runtime (D-01). Composes ONLY the vars the
// runtime uses: NODE_ENV (baseEnv), the Better Auth secret/baseURL + invitation email
// vars (authEnv), and the OWNER/migration DATABASE_URL — NOT the app/anon URLs.
//
// A1 (the load-bearing decision): the Better Auth Drizzle adapter connects via the
// elevated owner pool so it can write the RLS-FORCED organization/member tables.
// DATABASE_URL is exactly that owner role (the same one drizzle-kit uses for DDL).
// The application data path stays on withTenant/withAnon (app_authenticated/anon),
// which this file deliberately does NOT import — keeping the elevated pool isolated
// to the auth runtime (T-03-01/T-03-02).
//
// t3-env aggregates every Zod issue and its DEFAULT formatter prints the variable
// NAME + reason, never the offending VALUE (security V7 / T-03-03). We do NOT
// override onValidationError. SKIP_ENV_VALIDATION=1 is honored only for the
// fase-3 Docker image build (no DB/secret at build time); at runtime it is unset so
// validation always runs and fails closed.
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...authEnv.server,
    DATABASE_URL: dbEnv.server.DATABASE_URL, // owner pool for the BA adapter (A1)
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
