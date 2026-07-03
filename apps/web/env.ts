import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { baseEnv, dbEnv, sentryEnv, lokiEnv } from "@imbau/config/env/presets";

// web env validation (D-01, D-02): declares ONLY what it uses. NODE_ENV (server)
// comes from the shared baseEnv preset; NEXT_PUBLIC_APP_ENV is the single client
// var, listed under `client` so t3-env's split guards against leaking a
// server-only secret into the browser bundle (Pitfall 3, T-03-01). web does NOT
// declare the worker-only Redis connection var.
//
// Phase-5 A1 widening (D-06): web is no longer anon-only. It now ALSO validates
// DATABASE_APP_URL because the quotesRouter's publicProcedures run withTenant(orgId)
// server-side for the anonymous quote path (QUOTE-01) — the org is resolved from the
// `publicado` project, never trusted from the client. Importing @imbau/api in the web
// tRPC route handler boots the @imbau/db barrel (appDb/anonDb constructed at import),
// so both the app-pool and anon-pool URLs must exist at boot or the container fails
// fast (Pitfall 6). Both stay in the `server` block, so the connection strings are
// validated at boot and never reach the client bundle (T-03-19).
//
// The fence that keeps A1 safe (T-03-09, grep-verified): apps/web reaches data ONLY
// through withTenant/withAnon inside packages/api routers — it never constructs or
// imports the elevated/owner-pool clients from @imbau/db directly. web does NOT declare
// DATABASE_URL (owner pool); it never needs it.
//
// Next inlines NEXT_PUBLIC_* at build, so each must be wired explicitly in
// `experimental__runtimeEnv`.
export const env = createEnv({
  ...baseEnv,
  server: {
    ...baseEnv.server,
    // anon published-only read path (D-06/D-14): the server caller's withAnon
    // path needs this validated at boot. Server-only — never NEXT_PUBLIC_.
    DATABASE_ANON_URL: dbEnv.server.DATABASE_ANON_URL,
    // app_authenticated runtime pool (D-06/A1): the quotesRouter publicProcedures run
    // withTenant(orgId) server-side for the anonymous quote path (QUOTE-01). Server-only
    // — never NEXT_PUBLIC_. Reached ONLY via withTenant inside packages/api (T-03-09).
    DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL,
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
