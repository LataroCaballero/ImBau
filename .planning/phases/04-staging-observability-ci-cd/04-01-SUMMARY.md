---
phase: 04-staging-observability-ci-cd
plan: 01
subsystem: observability
tags: [observability, sentry, pino, loki, env-presets, supply-chain]
requires:
  - "@imbau/config (tsconfig/node.json, env preset convention)"
  - "@imbau/db / @imbau/api (JIT workspace package convention)"
provides:
  - "@imbau/observability shared pino+pino-loki logger package"
  - "sentryEnv + lokiEnv env presets (names + Zod, never values)"
  - "turbo.json build.passThroughEnv Sentry build vars"
  - "@sentry/nextjs in web/panel, @sentry/node in worker (exact 10.61.0)"
affects:
  - "plan 04-02 (wires the logger + Sentry config into the three apps)"
  - "plan 04-06 (CI source-map upload uses @sentry/cli + passThroughEnv)"
tech-stack:
  added:
    - "pino@10.3.1"
    - "pino-loki@3.0.0"
    - "pino-pretty@13.1.3 (dev-only)"
    - "@sentry/nextjs@10.61.0"
    - "@sentry/node@10.61.0"
  patterns:
    - "JIT workspace package: exports raw ./src/*.ts, type:module, extends @imbau/config tsconfig"
    - "Env preset = variable NAMES + Zod schemas only, never values"
    - "Single pino-loki transport repoints local Loki OR Grafana Cloud via LOKI_URL swap (D-04)"
key-files:
  created:
    - "packages/observability/package.json"
    - "packages/observability/src/logger.ts"
    - "packages/observability/tsconfig.json"
  modified:
    - "packages/config/env/presets.ts"
    - "turbo.json"
    - "apps/web/package.json"
    - "apps/panel/package.json"
    - "apps/worker/package.json"
    - "pnpm-workspace.yaml"
    - "pnpm-lock.yaml"
decisions:
  - "pino-loki transport over Promtail (refines D-03): zero extra container, fallback-symmetric with D-04"
  - "Allow @sentry/cli native build (pnpm allowBuilds: true) — binary needed for CI source-map upload (OBS-01)"
  - "Build-time Sentry vars (ORG/PROJECT/AUTH_TOKEN) live in turbo passThroughEnv, NOT the runtime env schema"
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 3
  files_modified: 7
  completed_date: 2026-06-26
status: complete
---

# Phase 4 Plan 01: Staging Observability Foundation Summary

Shared `@imbau/observability` pino+pino-loki logger package, `sentryEnv`/`lokiEnv` env presets, Sentry build-var passthrough, and exact-pinned Sentry SDKs installed into the three apps — the observability foundation that plan 04-02 wires into app source.

## What Was Built

- **Task 1 (checkpoint:human-verify, gate=blocking-human):** Package-legitimacy gate for `@sentry/nextjs@10.61.0` and `@sentry/node@10.61.0`. The auditor's `too-new` SUS signal was confirmed a false positive (Sentry publishes its monorepo daily; both are official `getsentry/sentry-javascript`, millions of weekly downloads, no surprising postinstall). **Approved by the human** before any install. Exact pins, never floated.
- **Task 2 (commit `95e496c`):** Created `packages/observability` as a JIT workspace package mirroring the `@imbau/db`/`@imbau/api` convention (`type:module`, `exports "." → ./src/logger.ts`, tsconfig extends `@imbau/config/tsconfig/node.json`). `src/logger.ts` exports a pino `logger`: when `LOKI_URL` is set it ships to Loki via the `pino-loki` transport (`host`, validated `basicAuth` from `LOKI_BASIC_AUTH` JSON, `labels {app, env}`, `batching:true`, `interval:5`); when unset it emits plain stdout JSON. `pino-pretty` is a devDependency only and is intentionally absent from the runtime transport path.
- **Task 3 (commit `1e6adf3`):** Installed `@sentry/nextjs@10.61.0` into `apps/web` + `apps/panel`, `@sentry/node@10.61.0` into `apps/worker`, and added `@imbau/observability: workspace:*` to all three. Added `sentryEnv` (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`) and `lokiEnv` (`LOKI_URL`, `LOKI_BASIC_AUTH`) — all optional, names+Zod only — to `packages/config/env/presets.ts`. Appended the four Sentry build vars to `turbo.json` `build.passThroughEnv`. No app `env.ts`/`next.config.ts` touched (that is 04-02).

## Verification Results

- `pnpm --filter @imbau/observability typecheck` → exit 0; `lint` → clean.
- `pnpm -w typecheck` → 8/8 packages successful.
- Greps confirmed: `sentryEnv`, `lokiEnv` in presets; `SENTRY_AUTH_TOKEN` in turbo.json; `@sentry/nextjs@10.61.0` in web+panel; `@sentry/node@10.61.0` in worker; `@imbau/observability` workspace dep in all three apps.
- All versions exact-pinned (no `^`/`~`/`latest`); `pnpm-lock.yaml` updated and supply-chain policy passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resolve pnpm build-script decision for `@sentry/cli`**
- **Found during:** Task 3
- **Issue:** pnpm 11.6 detected `@sentry/cli@2.58.6`'s postinstall and rewrote `pnpm-workspace.yaml` `allowBuilds` with a placeholder (`'@sentry/cli': set this to true or false`). This made `pnpm install` exit 1, which in turn broke `pnpm -w typecheck` (turbo's pre-run deps-status check), blocking all verification.
- **Fix:** Set `'@sentry/cli': true` in `allowBuilds` (with a documenting comment). `@sentry/cli` is the official Sentry toolchain (transitive dep of `@sentry/nextjs`, legitimacy-gated by the approved Task-1 checkpoint); its binary is required for CI source-map upload (OBS-01, plans 04-02/04-06). The Sentry 10.61.0 packages were already whitelisted in the file's `minimumReleaseAgeExclude` — the planner pre-staged the `too-new` policy bypass.
- **Files modified:** `pnpm-workspace.yaml`
- **Commit:** `1e6adf3`

## Authentication Gates

None.

## Cross-Plan Notes

- **04-02** composes `sentryEnv`/`lokiEnv` into `apps/{web,panel,worker}/env.ts`, wraps the Next configs with `withSentryConfig`, transpiles `@imbau/observability`, and replaces the worker's `console.log(JSON.stringify(...))` calls with the shared `logger`.
- **04-06** CI build performs the actual source-map upload; it relies on the `@sentry/cli` build (now allowed) plus the `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` passThroughEnv added here.

## Known Stubs

None. The logger and presets are fully wired to `process.env`; only app-side composition is intentionally deferred to 04-02 (documented above).

## Self-Check: PASSED

All created files exist on disk (`packages/observability/{package.json,src/logger.ts,tsconfig.json}`, `04-01-SUMMARY.md`) and both task commits (`95e496c`, `1e6adf3`) are present in git history.
