import { createEnv } from "@t3-oss/env-core";
import {
  baseEnv,
  redisEnv,
  r2Env,
  dbEnv,
  sentryEnv,
  lokiEnv,
  webEnv,
  authEnv,
} from "@imbau/config/env/presets";

// Worker env validation (D-01, D-02), EXTENDED for the media pipeline (A8). The worker is no
// longer the Redis-only BullMQ shell of phase 0/1: plan 02-02 gives it the MEDIA_QUEUE
// consumer, which reads originals from + writes variants to R2 (r2Env) AND writes the
// variants/blurhash/dims back to Postgres as `app_authenticated` via @imbau/db's withTenant
// (dbEnv). So this schema now composes:
//   - baseEnv  : NODE_ENV
//   - redisEnv : REDIS_URL (BullMQ connection, unchanged)
//   - r2Env    : R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL — the
//                media-runtime S3Client (get original / put variants).
//   - dbEnv    : the THREE connection strings (DATABASE_URL/DATABASE_APP_URL/DATABASE_ANON_URL).
//                CRITICAL: importing @imbau/db (which media-store does) eagerly constructs the
//                app + anon pools from its OWN env validation at import time — that validation
//                requires all three URLs present. So the worker must carry all three even
//                though the write-back itself only uses DATABASE_APP_URL (the role-bearing
//                app_authenticated string fed through withTenant). Declaring them here makes
//                the worker's boot fail loudly (with the missing variable NAME) rather than
//                deferring to @imbau/db's import-time throw.
//
// t3-env aggregates every Zod issue by default (A2/Pitfall 4), so a boot with several bad vars
// surfaces all their names at once (D-04). We do NOT override onValidationError: the default
// formatter prints the variable NAME + reason, never the offending VALUE (security requirement
// V7, T-03-02 / T-02-09).
//
// SKIP_ENV_VALIDATION is honored ONLY for the fase-3 Docker image build (D-03); at container
// boot it is unset, so validation always runs and fails closed.
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    // A8: the worker now reaches R2 (media-runtime) and Postgres as app_authenticated
    // (media-store → withTenant). dbEnv carries all three URLs because importing @imbau/db
    // validates them at import (not just DATABASE_APP_URL, though that is the role-bearing
    // write-back string).
    ...r2Env.server,
    ...dbEnv.server,
    // Observability (OBS-01/OBS-02): server Sentry DSN + Loki shipping target. All optional —
    // with no DSN/LOKI_URL Sentry + the pino logger are local no-ops, so the worker still boots
    // with zero external observability deps in dev.
    ...sentryEnv.server,
    ...lokiEnv.server,
    // fase 7 (PDF): WEB_PUBLIC_BASE_URL — the public origin of apps/web the worker prepends to
    // build the cotizador deep-link + QR embedded in the generated PDF footer (D-08). Required at
    // boot so a misconfigured worker fails loudly (with the NAME) instead of shipping a broken link.
    ...webEnv.server,
    // fase 11 (leads): BETTER_AUTH_URL — the apps/panel base origin the lead-email worker prepends
    // to build the bandeja deep-link `${BETTER_AUTH_URL}/proyectos/${projectId}/leads` (D-07).
    // Cherry-picked from authEnv (NOT `...authEnv.server`) on purpose: the worker must NOT be
    // forced to carry BETTER_AUTH_SECRET — the send module keeps a minimal email env for the same
    // reason. Required (url) so a misconfigured worker fails loudly with the NAME, not a broken link.
    BETTER_AUTH_URL: authEnv.server.BETTER_AUTH_URL,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
