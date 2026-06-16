import { createEnv } from "@t3-oss/env-core";
import { baseEnv, dbEnv } from "@imbau/config/env/presets";

// @imbau/db env validation (D-01, D-04): composes ONLY the presets the data layer
// uses — NODE_ENV plus the three connection strings (owner/migration DATABASE_URL,
// app_authenticated DATABASE_APP_URL, anon DATABASE_ANON_URL). No Redis here (the
// db package never touches Redis). t3-env aggregates every Zod issue by default,
// so a boot with several missing vars surfaces all their names at once. We do NOT
// override onValidationError: the default formatter prints the variable NAME +
// reason, never the offending VALUE (security requirement V7).
//
// SKIP_ENV_VALIDATION is honored only where the data layer must import without a
// live env (e.g. tooling); at runtime it is unset, so validation always runs and
// fails closed with the missing variable's name.
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...dbEnv.server,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
