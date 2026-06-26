import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { baseEnv, dbEnv, sentryEnv, lokiEnv } from "@imbau/config/env/presets";

// web env validation (D-01, D-02): declares ONLY what it uses. NODE_ENV (server)
// comes from the shared baseEnv preset; NEXT_PUBLIC_APP_ENV is the single client
// var, listed under `client` so t3-env's split guards against leaking a
// server-only secret into the browser bundle (Pitfall 3, T-03-01). web does NOT
// declare the worker-only Redis connection var nor the tenant DATABASE_APP_URL —
// it is anon-only (D-03): the RSC read goes through withAnon, which uses the anon
// pool fed by DATABASE_ANON_URL. That var stays in the `server` block so only the
// anon connection string is validated at boot and never reaches the client bundle
// (T-03-19). Next inlines NEXT_PUBLIC_* at build, so each must be wired explicitly
// in `experimental__runtimeEnv`.
export const env = createEnv({
  ...baseEnv,
  server: {
    ...baseEnv.server,
    // anon published-only read path (D-06/D-14): the server caller's withAnon
    // path needs this validated at boot. Server-only — never NEXT_PUBLIC_.
    DATABASE_ANON_URL: dbEnv.server.DATABASE_ANON_URL,
    // Observability (OBS-01/OBS-02): server Sentry DSN + Loki shipping target.
    // All optional — with no DSN/LOKI_URL the SDK + logger are local no-ops, so
    // dev still boots with zero external deps.
    ...sentryEnv.server,
    ...lokiEnv.server,
  },
  client: {
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
    // Public browser Sentry DSN (OBS-01) — kept under `client` so t3-env's split
    // guards server-only secrets from the browser bundle (T-4-CLIENTLEAK accept).
    ...sentryEnv.client,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    // Next inlines NEXT_PUBLIC_* at build, so each must be wired explicitly.
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  // SKIP_ENV_VALIDATION=1 is honored ONLY for the fase-3 Docker image build (D-03/
  // D-16): the image is built without live secrets, so env validation must not run
  // at `next build`. At container boot the flag is unset, so validation always runs
  // and fails closed on a missing/invalid var. Mirrors the worker/db/api env wiring.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
