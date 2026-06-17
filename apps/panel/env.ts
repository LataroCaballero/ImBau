import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { authEnv, baseEnv, dbEnv } from "@imbau/config/env/presets";

// panel env validation (D-01/D-03). The panel is the ONLY surface that mounts the Better Auth
// handler + the tRPC route handler, so it composes:
//   - baseEnv.server (NODE_ENV)
//   - authEnv.server (BETTER_AUTH_SECRET/URL, RESEND_API_KEY + INVITE_FROM optional — D-09)
//   - all three DB URLs: the server caller routes protected reads through withTenant
//     (DATABASE_APP_URL) and the anon path through withAnon (DATABASE_ANON_URL); the Better
//     Auth adapter writes the auth tables through the owner pool (DATABASE_URL — A1).
// The @imbau/db barrel constructs appDb/anonDb at import and thus requires all three URLs, so
// declaring them here keeps validation fail-fast at the panel boot/build boundary.
//
// We do NOT override onValidationError — the default formatter prints the variable NAME + reason,
// never the offending VALUE (security V7). SKIP_ENV_VALIDATION is honored only for the Docker
// image build (no DB/secret at build time); at runtime it is unset so validation fails closed.
export const env = createEnv({
  ...baseEnv,
  server: {
    ...baseEnv.server,
    ...authEnv.server,
    ...dbEnv.server,
  },
  client: {
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
