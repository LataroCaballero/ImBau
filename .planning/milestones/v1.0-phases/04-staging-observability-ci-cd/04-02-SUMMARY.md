---
phase: 04-staging-observability-ci-cd
plan: 02
subsystem: observability
tags: [observability, sentry, pino, loki, instrumentation, next-app-router]
requires:
  - "@imbau/observability (shared pino logger, plan 04-01)"
  - "sentryEnv + lokiEnv presets in @imbau/config (plan 04-01)"
  - "@sentry/nextjs in web/panel, @sentry/node in worker (plan 04-01)"
provides:
  - "web/panel Sentry instrumentation (register + onRequestError=captureRequestError, RSC capture)"
  - "web/panel instrumentation-client.ts (client init + onRouterTransitionStart)"
  - "withSentryConfig wrap on both Next configs (CI source-map upload + RSC)"
  - "worker @sentry/node init (instrument.ts, imported first) + pino logging"
  - "sentryEnv/lokiEnv composed into all three apps' env.ts (all optional)"
affects:
  - "plan 04-06 (CI source-map upload uses the withSentryConfig wrap + passThroughEnv)"
  - "plan 04-07 (live Sentry/Loki verification on the VPS)"
tech-stack:
  added: []
  patterns:
    - "Next 16 App Router Sentry: instrumentation.ts register() + onRequestError, instrumentation-client.ts (NOT sentry.client.config.ts)"
    - "@sentry/node init imported on the FIRST line of the worker entrypoint (before ./env)"
    - "Observability env vars optional → dev/test boot with zero external deps"
key-files:
  created:
    - "apps/web/instrumentation.ts"
    - "apps/web/instrumentation-client.ts"
    - "apps/web/sentry.server.config.ts"
    - "apps/web/sentry.edge.config.ts"
    - "apps/panel/instrumentation.ts"
    - "apps/panel/instrumentation-client.ts"
    - "apps/panel/sentry.server.config.ts"
    - "apps/panel/sentry.edge.config.ts"
    - "apps/worker/src/instrument.ts"
  modified:
    - "apps/web/next.config.ts"
    - "apps/web/env.ts"
    - "apps/panel/next.config.ts"
    - "apps/panel/env.ts"
    - "apps/worker/src/index.ts"
    - "apps/worker/src/env.ts"
decisions:
  - "Client init lives in instrumentation-client.ts (deprecated sentry.client.config.ts NOT used)"
  - "Worker imports ./instrument before ./env so @sentry/node patches libs before they load"
  - "All Sentry/Loki env vars optional → SDK + logger are local no-ops without DSN/LOKI_URL"
metrics:
  duration_minutes: 9
  tasks_completed: 3
  files_created: 9
  files_modified: 6
  completed_date: 2026-06-26
status: complete
---

# Phase 4 Plan 02: App-Level Sentry + pino Wiring Summary

Wired Sentry (incl. the RSC `onRequestError` hook) and the shared `@imbau/observability` pino logger into web, panel, and worker — completing OBS-01 and OBS-02 at the code level while keeping dev/test boot dependency-free.

## What Was Built

- **Task 1 (commit `da4cb59`) — apps/web:** Added `instrumentation.ts` (`register()` dynamic-imports `sentry.server.config`/`sentry.edge.config` by `NEXT_RUNTIME`; `export const onRequestError = Sentry.captureRequestError` for RSC/route-handler/middleware error capture), `instrumentation-client.ts` (client `Sentry.init` with `NEXT_PUBLIC_SENTRY_DSN` + `onRouterTransitionStart`), and `sentry.server.config.ts`/`sentry.edge.config.ts` (server DSN init). Wrapped the existing `nextConfig` with `withSentryConfig(...)` — all original fields (`output:'standalone'`, `turbopack.root`, `outputFileTracingRoot`, `import "./env"`) preserved; added `@imbau/observability` to `transpilePackages`. Composed `sentryEnv` + `lokiEnv` into `env.ts` (server `SENTRY_DSN`/`LOKI_URL`/`LOKI_BASIC_AUTH`, client `NEXT_PUBLIC_SENTRY_DSN` wired through `experimental__runtimeEnv`), all optional.
- **Task 2 (commit `8deaf79`) — apps/panel:** Mirrored Task 1. Same four instrumentation files, `withSentryConfig` wrap preserving the existing `transpilePackages` (`@imbau/api`,`@imbau/ui`,`@imbau/config`) plus the new `@imbau/observability`, and `sentryEnv`/`lokiEnv` composed into the panel's `env.ts` alongside the existing `baseEnv`+`authEnv`+`dbEnv` blocks.
- **Task 3 (commit `7adb3e0`) — apps/worker:** Added `instrument.ts` (`@sentry/node` `Sentry.init`) and imported it on the FIRST line of `index.ts` (before `./env`) so the Node SDK patches libraries as they load. Replaced both `console.log(JSON.stringify({...}))` calls with `logger.info({ node_env, queue }, "<message>")` from `@imbau/observability` (same fields preserved). Composed `sentryEnv.server` + `lokiEnv.server` into the worker's `env.ts`, all optional; `REDIS_URL`+`NODE_ENV` still required. BullMQ wiring (`maxRetriesPerRequest: null`) untouched.

## Verification Results

- `pnpm --filter @imbau/web typecheck lint` → exit 0; greps confirm `captureRequestError`, `withSentryConfig`, `instrumentation-client.ts`.
- `pnpm --filter @imbau/panel typecheck lint` → exit 0; greps confirm `captureRequestError`, `withSentryConfig`, `@imbau/observability` in next.config.ts.
- `pnpm --filter @imbau/worker typecheck lint` → exit 0; grep confirms `instrument` import and NO `console.log` remaining.
- `pnpm --filter @imbau/worker test` → 3/3 passed with `REDIS_URL=redis://localhost:6380` (Compose Redis up); the BullMQ Redis-connect smoke test stays green.
- `pnpm -w typecheck` → 8/8 packages successful.

## Deviations from Plan

None — plan executed exactly as written. (The worker smoke test requires `REDIS_URL` in the environment, as the plan's Task-3 note flagged; set to `redis://localhost:6380` matching the Compose host port mapping `6380->6379`. Not a code change.)

## Authentication Gates

None.

## Cross-Plan Notes

- **04-06** CI performs the live source-map upload through the `withSentryConfig` wrap added here plus the `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` passThroughEnv from 04-01.
- **04-07** verifies live Sentry error capture and Loki log shipping on the VPS (set `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`/`LOKI_URL`/`LOKI_BASIC_AUTH`/`APP_NAME` in the decrypted runtime `.env`).

## Known Stubs

None. The instrumentation is fully wired to `process.env`; absent DSN/LOKI_URL the SDK and logger are intentional no-ops (dev runs with zero external deps), and live verification is gated to 04-07 by design.

## Self-Check: PASSED

All 9 created files and 6 modified files exist on disk; all three task commits (`da4cb59`, `8deaf79`, `7adb3e0`) are present in git history.
