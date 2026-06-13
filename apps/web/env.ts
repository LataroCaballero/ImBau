import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { baseEnv } from "@imbau/config/env/presets";

// web env validation (D-01, D-02): declares ONLY what it uses. NODE_ENV (server)
// comes from the shared baseEnv preset; NEXT_PUBLIC_APP_ENV is the single client
// var, listed under `client` so t3-env's split guards against leaking a
// server-only secret into the browser bundle (Pitfall 3, T-03-01). web does NOT
// declare the worker-only Redis connection var. Next inlines NEXT_PUBLIC_* at
// build, so each must be wired explicitly in `experimental__runtimeEnv`.
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
