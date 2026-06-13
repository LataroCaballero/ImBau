import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { baseEnv } from "@imbau/config/env/presets";

// panel env validation — mirrors web (D-01, D-02): NODE_ENV (server) +
// NEXT_PUBLIC_APP_ENV (client). Does NOT declare the worker-only Redis var.
export const env = createEnv({
  ...baseEnv,
  server: {
    ...baseEnv.server,
  },
  client: {
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  },
});
