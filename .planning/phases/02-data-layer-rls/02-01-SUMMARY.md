---
phase: 02-data-layer-rls
plan: 01
subsystem: database
tags: [docker-compose, postgres, redis, drizzle-kit, drizzle-orm, postgres-js, better-auth, t3-env, rls, multi-tenant]

# Dependency graph
requires:
  - phase: 01-monorepo-foundation
    provides: "@imbau/config env presets (baseEnv/dbEnv), per-app fail-fast createEnv pattern, packages/db skeleton, pnpm+turbo workspace"
provides:
  - "One-command local data-layer stack: docker compose up -d → Postgres 16-alpine + Redis 7-alpine with healthchecks (DATA-01)"
  - "Three-role connection-string contract in dbEnv preset: DATABASE_URL (owner/migration), DATABASE_APP_URL (app_authenticated), DATABASE_ANON_URL (anon)"
  - "packages/db data-layer toolchain: pinned drizzle-orm/postgres/better-auth deps, drizzle.config.ts with entities.roles:true on the owner URL, db:generate/db:migrate scripts (no push), fail-fast src/env.ts"
affects: [02-02 schema+migrations, 02-03 withTenant/withAnon+cross-tenant tests, 03 auth-runtime]

# Tech tracking
tech-stack:
  added: [drizzle-orm@0.45.2, postgres@3.4.9, better-auth@1.6.18, "@t3-oss/env-core@0.13.11", drizzle-kit@0.31.10, "@better-auth/cli@1.4.21", "@types/node@22.18.13", "postgres:16-alpine", "redis:7-alpine"]
  patterns: ["three-role DB connection-string contract (owner/app/anon)", "drizzle-kit entities.roles:true for RLS DDL emission", "fail-fast env composition mirroring apps/worker (no onValidationError override → never prints values)", "versioned-migrations-only toolchain (db:generate/db:migrate, never db:push)"]

key-files:
  created: [compose.yml, .env.example, packages/db/src/env.ts, packages/db/drizzle.config.ts, packages/db/.env.example]
  modified: [packages/config/env/presets.ts, packages/db/package.json, packages/db/tsconfig.json, pnpm-workspace.yaml, pnpm-lock.yaml]

key-decisions:
  - "Redis published on host port 6380:6379 — host 6379 is occupied by a local Homebrew redis-server (verified live); container port stays 6379. Resolves Assumption A4."
  - "@better-auth/cli pinned to 1.4.21 (1.4.x line, not 1.6.x) — no 1.6.x CLI exists (FLAG-1); dev-only offline generator."
  - "@prisma/client + better-sqlite3 marked allowBuilds:false — dev-only transitive deps of @better-auth/cli, native builds never run."
  - "drizzle.config.ts reads process.env.DATABASE_URL directly (the owner/migration string) — it is a CLI tool outside the app boot path."

patterns-established:
  - "Three connection strings, one per Postgres role, declared as Zod schemas in the shared dbEnv preset; each app composes only the URLs it uses."
  - "drizzle-kit config emits role/policy DDL via entities.roles:true and migrates as the privileged owner role (D-04)."
  - "Env modules never override onValidationError so the default t3-env formatter prints variable NAME + reason, never the offending value (V7)."

requirements-completed: [DATA-01, DATA-02]

# Metrics
duration: ~30min
completed: 2026-06-16
---

# Phase 02 Plan 01: Data-Layer Infra + packages/db Toolchain Summary

**One-command Postgres 16 + Redis 7 Compose stack (Redis remapped to host 6380), the three-role owner/app/anon connection-string contract in dbEnv, and the pinned Drizzle/postgres/Better-Auth toolchain in packages/db with `entities.roles:true` and `db:generate`/`db:migrate` (no push).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-16
- **Completed:** 2026-06-16
- **Tasks:** 3 (code complete; live Docker verification of Task 1 awaiting a daemon — see User Setup Required)
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments
- `compose.yml`: `postgres:16-alpine` (owner role `imbau`, named `pgdata` volume, `pg_isready` healthcheck) + `redis:7-alpine` (`redis-cli ping` healthcheck), remapped to host `6380:6379` to dodge the occupied host 6379. `docker compose config` validates clean.
- `dbEnv` preset extended to the three-role contract: `DATABASE_URL` (owner/migration), `DATABASE_APP_URL` (app_authenticated, D-04), `DATABASE_ANON_URL` (anon published-only, D-06) — all `z.string().url()`, `as const` preserved, no values.
- `packages/db` toolchain: exact-pinned deps (drizzle-orm 0.45.2, postgres 3.4.9, better-auth 1.6.18, @t3-oss/env-core 0.13.11, zod 4.4.3; dev: drizzle-kit 0.31.10, @better-auth/cli 1.4.21, @types/node 22.18.13), `db:generate`/`db:migrate` scripts (no `db:push`), fail-fast `src/env.ts`, `drizzle.config.ts` with `entities.roles:true`, widened tsconfig, `.env.example`.
- Verified fail-fast: importing `src/env.ts` without the URLs throws naming `DATABASE_APP_URL`/`DATABASE_ANON_URL` (values never printed); with `SKIP_ENV_VALIDATION=1` it imports clean. `@imbau/db` typecheck + lint pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: compose.yml + root .env.example** - `b54837f` (feat)
2. **Task 2: extend dbEnv preset (owner/app/anon)** - `cf49ea4` (feat)
3. **Task 3: packages/db toolchain (deps/scripts/env/config/tsconfig/.env.example + lockfile + allowBuilds)** - `9f68b44` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created/Modified
- `compose.yml` - Postgres 16 + Redis 7 services with healthchecks; Redis host 6380:6379; named pgdata volume.
- `.env.example` (root) - documents `POSTGRES_PASSWORD` placeholder for the Compose env.
- `packages/config/env/presets.ts` - `dbEnv.server` extended to three connection-string schemas.
- `packages/db/package.json` - pinned data-layer deps + `db:generate`/`db:migrate`/`test` scripts.
- `packages/db/src/env.ts` - fail-fast `createEnv` composing `baseEnv` + `dbEnv` (no onValidationError override).
- `packages/db/drizzle.config.ts` - `entities.roles:true`, owner `DATABASE_URL`, schema glob + migrations out dir.
- `packages/db/tsconfig.json` - `include` widened to `drizzle.config.ts`/`auth.ts`/`tests`.
- `packages/db/.env.example` - three connection strings with placeholder localhost values.
- `pnpm-workspace.yaml` - `allowBuilds` for `@prisma/client`/`better-sqlite3` set to `false`.
- `pnpm-lock.yaml` - updated for the new db deps.

## Decisions Made
- **Redis host port 6380** (not 6379): host 6379 is held by a local Homebrew `redis-server` (confirmed via `lsof`). Container port stays 6379; only the host binding moves. Resolves Assumption A4.
- **`@better-auth/cli@1.4.21`** (1.4.x, not 1.6.x): no 1.6.x CLI exists (FLAG-1). Dev-only offline generator; runtime `better-auth@1.6.18` is unaffected.
- **`@prisma/client` + `better-sqlite3` `allowBuilds:false`**: dev-only transitive deps of the CLI; their native build scripts are intentionally not run.
- **`drizzle.config.ts` uses the owner `DATABASE_URL`** read straight from `process.env` (CLI tool, outside app boot), per D-04 (migrations run as the privileged owner).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pnpm 11.6 `allowBuilds` stub blocked every workspace task**
- **Found during:** Task 3 (db typecheck)
- **Issue:** After adding `@better-auth/cli`, pnpm 11.6 auto-wrote `pnpm-workspace.yaml` stub entries `@prisma/client: set this to true or false` and `better-sqlite3: set this to true or false` (invalid values). This made every `pnpm`/turbo task fail its pre-task deps-status check with `ERR_PNPM_IGNORED_BUILDS`, blocking typecheck/lint.
- **Fix:** Set both `allowBuilds` entries to `false` (dev-only transitive deps of the offline generator; native builds never needed) and re-ran `pnpm install`.
- **Files modified:** `pnpm-workspace.yaml`
- **Verification:** `pnpm install` clean (no ignored-builds error); `@imbau/db typecheck` + `lint` pass.
- **Committed in:** `9f68b44` (Task 3 commit)

**2. [Rule 3 - Blocking] Verification adapted: active runtime was Node 20; `@imbau/config` has no `typecheck` script**
- **Found during:** Tasks 2 & 3 (typecheck verification)
- **Issue:** (a) The shell's default `node` was v20.19.6, on which the corepack pnpm shim crashes (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`); the repo requires Node 22. (b) The plan's Task 2 verify command (`pnpm --filter @imbau/config typecheck`) references a `typecheck` script that does not exist on the config package (it ships configs + a `.ts` preset, no own tsconfig).
- **Fix:** Put the installed Node 22.22.3 (nvm) on PATH for all pnpm/tsx invocations. Verified the preset via a direct strict `tsc --noEmit` on `presets.ts` (clean) plus the authoritative downstream `@imbau/db typecheck` (which imports `dbEnv` and passes).
- **Files modified:** none (verification-only adaptation; no source change)
- **Verification:** `presets.ts` tsc clean; `@imbau/db typecheck` passes (consumes `dbEnv`).
- **Committed in:** n/a (no file change; recorded for transparency)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). One touched `pnpm-workspace.yaml`; the other was verification-only.
**Impact on plan:** Both were environment/tooling blockers, not scope changes. No new functionality added beyond the plan; the three-role contract, Compose stack, and toolchain match the plan exactly.

## Issues Encountered
- **Docker daemon not available (blocks live Compose verification).** `docker compose version` reports CLI 5.1.0, but no daemon provider (Docker Desktop / Colima / OrbStack / Rancher) is installed or running — `/var/run/docker.sock` does not exist. `compose.yml` is statically validated (`docker compose config` passes) and the port analysis is confirmed against the live host (6379 occupied, 5432/6380 free), but `docker compose up -d` + the `pg_isready`/`redis-cli ping` healthchecks cannot run here. This is a human-action gate, documented below — it does not affect the committed artifacts.

## User Setup Required

**A Docker daemon must be running to verify the live Compose stack (DATA-01 runtime check).**

This machine has the `docker` CLI but no daemon provider. To complete the live verification:

1. Install/start a Docker daemon provider (e.g. Docker Desktop, Colima `brew install colima && colima start`, or OrbStack).
2. From the repo root, run:
   ```bash
   docker compose up -d
   docker compose exec -T postgres pg_isready -U imbau -d imbau   # expect: accepting connections
   docker compose exec -T redis redis-cli ping                    # expect: PONG
   ```
3. Expected: both services healthy; Postgres on host `5432`, Redis on host `6380`.

No other external service configuration is required this phase (real secrets/SOPS are phase 4).

## Next Phase Readiness
- Ready for **02-02** (schema + Better-Auth fold + RLS migration): `drizzle.config.ts` with `entities.roles:true` and the owner URL is in place; `db:generate`/`db:migrate` scripts exist; schema glob `./src/schema/*.ts` and `migrations/` out dir are wired (the schema folder is created in 02-02).
- Ready for **02-03** (`withTenant`/`withAnon` + cross-tenant tests): `DATABASE_APP_URL`/`DATABASE_ANON_URL` env contract and fail-fast `env.ts` are available for the app/anon clients and the test harness.
- **Blocker for runtime work:** a Docker daemon must be running locally (and for 02-03's tests, which point at the Compose Postgres). See User Setup Required.

## Self-Check: PASSED
- Files: all 10 created/modified files present on disk (verified).
- Commits: `b54837f`, `cf49ea4`, `9f68b44` all present in git log (verified).

---
*Phase: 02-data-layer-rls*
*Completed: 2026-06-16*
