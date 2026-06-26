# Phase 4: Staging, Observability & CI/CD - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 19 new/modified
**Analogs found:** 11 with in-repo analogs / 19 total (8 greenfield infra)

> This is a pure infra/CI/CD/observability phase. Most NEW files are config/YAML/shell with
> NO in-repo analog (greenfield) — the codebase analogs that DO exist are load-bearing for the
> few code files (migrate.ts, presets.ts, Sentry/pino wiring, Dockerfiles consumed by CI). For
> greenfield files the planner should copy the inline snippets in `04-RESEARCH.md` Patterns 1–9.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.github/workflows/ci.yml` | config (CI) | event-driven | none (no `.github/workflows/` yet) | greenfield → RESEARCH Pattern 7 |
| `.github/workflows/deploy-staging.yml` | config (CD) | event-driven | none | greenfield → RESEARCH Pattern 8/9 |
| `deploy/compose.staging.yml` | config | — | `compose.yml` (root) | role-match (local→staging) |
| `deploy/nginx/staging.tours…conf` | config | request-response | none (host nginx, not in repo) | greenfield → RESEARCH Pattern 1 |
| `deploy/loki/loki-config.yml` | config | — | none | greenfield → RESEARCH Pattern 6 |
| `deploy/migrate.Dockerfile` | config (build) | batch | `apps/worker/Dockerfile` | exact (prune→install pattern) |
| `deploy/deploy.sh` | utility (shell) | batch | none | greenfield → RESEARCH Pattern 3 |
| `packages/db/migrate.ts` | utility (migrator) | batch | `packages/db/tests/setup.ts` + `tests/db.ts` | exact (same `migrate()` call) |
| `secrets/.sops.yaml` | config | — | none | greenfield |
| `secrets/staging.enc.yaml` | config | — | none | greenfield |
| `packages/config/env/presets.ts` (MOD) | config | — | itself (`dbEnv`/`redisEnv`/`authEnv`) | exact (add `sentryEnv`/`lokiEnv`) |
| `apps/{web,panel}/instrumentation.ts` | provider (observability) | event-driven | none (new file type) | greenfield → RESEARCH Pattern 5 |
| `apps/{web,panel}/instrumentation-client.ts` | provider | event-driven | none | greenfield → RESEARCH Pattern 5 |
| `apps/{web,panel}/sentry.server.config.ts` + `.edge.config.ts` | config | — | none | greenfield → RESEARCH Pattern 5 |
| `apps/{web,panel}/next.config.ts` (MOD) | config | — | `apps/web/next.config.ts` | exact (wrap with `withSentryConfig`) |
| `apps/worker/src/instrument.ts` (new) | provider | — | none | greenfield → RESEARCH Pattern 5 |
| `apps/worker/src/index.ts` (MOD) | service | event-driven | itself | exact (swap `console.log` → pino) |
| `packages/observability/logger.ts` (optional) | utility | — | none | greenfield → RESEARCH Pattern 6 |
| `turbo.json` (MOD) | config | — | `turbo.json` | exact (add Sentry build vars to `passThroughEnv`) |

## Pattern Assignments

### `packages/db/migrate.ts` (NEW — utility/migrator, batch)

**Analog:** `packages/db/tests/setup.ts` (lines 24–26, 69–76) + `packages/db/tests/db.ts` (lines 18–20).
The test harness ALREADY runs the exact programmatic migrator this phase needs — copy its shape,
drop the role-guard (that's test-only), point at the OWNER `DATABASE_URL`.

**Migrator call to copy** (`tests/setup.ts:24-26, 72-75`):
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
// ...
const owner = connectAs(ownerUrl());
try {
  await migrate(owner.db, { migrationsFolder });
} finally {
  await owner.sql.end({ timeout: 5 });
}
```

**`migrationsFolder` resolution to copy** (`tests/db.ts:18-20`):
```ts
const here = dirname(fileURLToPath(import.meta.url));
// packages/db/tests -> packages/db/migrations  (for migrate.ts: .. -> migrations)
export const migrationsFolder = resolve(here, "..", "migrations");
```

**Connection shape to copy** (`tests/db.ts:76-80` / `src/client.ts:28-31` `createOwnerDb`):
```ts
const sql = postgres(process.env.DATABASE_URL!, { max: 1 }); // OWNER role — DDL + CREATE ROLE
const db = drizzle(sql, { schema });
```

**Migrations dir:** `packages/db/migrations/` (journal `0000_init.sql` + idempotent `0001_rls.sql`).
**CRITICAL (RESEARCH Pattern 4):** `0001_rls.sql` only sets `app_authenticated`/`anon` `:dev`
passwords when `imbau.env <> 'production'`. Staging must set `imbau.env='production'` AND provision
real role passwords out-of-band from SOPS, or the app/anon pools cannot authenticate.

---

### `deploy/migrate.Dockerfile` (NEW — build config, batch)

**Analog:** `apps/worker/Dockerfile` (lines 7–30) — exact `prune → install → build` multi-stage.
Reuse the pruner+builder stages verbatim, targeting `@imbau/db`; the CMD runs `migrate.ts`.

**Pruner+install to copy** (`apps/worker/Dockerfile:7-23`):
```dockerfile
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @imbau/db --docker   # <- @imbau/db instead of @imbau/worker
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
```
**Difference:** migrate runs the source directly (`node --experimental-strip-types
packages/db/migrate.ts`) — no tsup build needed (RESEARCH Pattern 3 line 445).

---

### `deploy/compose.staging.yml` (NEW — config)

**Analog:** root `compose.yml` (lines 9–38). Keep the pinned `postgres:16-alpine` /
`redis:7-alpine` + healthcheck shapes; the staging deviations are: NO host `ports:` on
postgres/redis (internal network, D-02), loopback binds on web/panel (`127.0.0.1:8090:3000`),
`mem_limit` per service (D-04), and observability under `profiles` (D-04).

**Healthcheck/env to keep** (`compose.yml:10-24`):
```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: imbau
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # staging: real value from decrypted .env
    POSTGRES_DB: imbau
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U imbau -d imbau"]
    interval: 5s
    timeout: 3s
    retries: 10
```
NOTE: `compose.yml:4-5` says Phase 4 "extends THIS file with Traefik" — SUPERSEDED by D-01
(host nginx, separate `deploy/compose.staging.yml`). Service names `postgres`/`redis` stay stable.
Full staging skeleton: RESEARCH Pattern 2 (lines 344–410).

---

### `packages/config/env/presets.ts` (MODIFY — config)

**Analog:** the file itself — `dbEnv`/`redisEnv`/`authEnv` (lines 19–44) establish the exact
"NAMES + Zod schemas only, never values" preset convention. Add `sentryEnv` + `lokiEnv` in the
same shape. The header comment line 36 already flags "Sentry = phase 4".

**Pattern to copy** (`presets.ts:27-29` `redisEnv` is the minimal template):
```ts
export const sentryEnv = {
  server: {
    SENTRY_DSN: z.string().url().optional(),            // server/worker DSN
  },
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  },
} as const;

export const lokiEnv = {
  server: {
    LOKI_URL: z.string().url().optional(),               // internal http://loki:3100 OR Grafana Cloud
    LOKI_BASIC_AUTH: z.string().optional(),              // JSON string, parsed by pino-loki
  },
} as const;
```
Build-time Sentry vars (`SENTRY_ORG`/`PROJECT`/`AUTH_TOKEN`) belong in CI + `turbo.json`
`passThroughEnv`, NOT the runtime schema (RESEARCH Pattern 5 line 523). Apps compose presets via
`createEnv` per `apps/worker/src/env.ts` — same pattern for adding Sentry/Loki to web/panel/worker.

---

### `turbo.json` (MODIFY — config)

**Analog:** `turbo.json:6` — `passThroughEnv` already lists `SKIP_ENV_VALIDATION`,
`NEXT_PUBLIC_APP_ENV`. Append the Sentry build vars if source-map upload runs inside `turbo build`:
```json
"passThroughEnv": ["SKIP_ENV_VALIDATION", "NEXT_PUBLIC_APP_ENV",
  "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN", "NEXT_PUBLIC_SENTRY_DSN"]
```

---

### `apps/{web,panel}/next.config.ts` (MODIFY — config)

**Analog:** `apps/web/next.config.ts` (lines 13–22). The existing config MUST be preserved
(`output: 'standalone'`, `transpilePackages`, `turbopack.root`, `outputFileTracingRoot`,
`import "./env"`) and wrapped — do not replace:
```ts
import { withSentryConfig } from "@sentry/nextjs";
// ...existing nextConfig unchanged...
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, silent: !process.env.CI, widenClientFileUpload: true,
});
```

---

### `apps/worker/src/index.ts` (MODIFY) + `apps/worker/src/instrument.ts` (NEW)

**Analog:** `apps/worker/src/index.ts` (lines 44–57). The worker currently emits
`console.log(JSON.stringify({...}))` (lines 45–51, 55–57) — replace those with the shared pino
logger (RESEARCH Pattern 6). The header comment lines 9–11 ("No Sentry / pino / OTel here —
observability is phase 4") is the explicit handoff point this phase fulfils.

`instrument.ts` must be imported FIRST (before `./env`) so `@sentry/node` instruments before any
other module — analogous to how `index.ts:3` imports `./env` first for fail-closed validation.
```ts
// apps/worker/src/instrument.ts (NEW)
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
```
Add `SENTRY_DSN`/`LOKI_*` to `apps/worker/src/env.ts` via the new presets (mirror its current
`baseEnv`/`redisEnv` composition).

---

### `apps/{web,panel}/instrumentation.ts` + `instrumentation-client.ts` + `sentry.{server,edge}.config.ts` (NEW)

**Greenfield — no in-repo analog** (new Next.js file convention). Copy RESEARCH Pattern 5
verbatim (lines 487–508). Key: `export const onRequestError = Sentry.captureRequestError;` is the
RSC error hook OBS-01 requires. Use `instrumentation-client.ts` (NOT deprecated
`sentry.client.config.ts`).

---

### `packages/observability/logger.ts` (NEW, optional — Claude's discretion)

**Greenfield — no analog.** Shared pino + pino-loki transport for all 3 apps (RESEARCH Pattern 6,
lines 532–545). The worker's existing `console.log(JSON.stringify(...))` is the de-facto JSON shape
this replaces. Recommended to avoid 3× duplication; if skipped, inline per-app.

---

### `.github/workflows/ci.yml` (NEW — greenfield)

**No analog** (no workflows exist). Copy RESEARCH Pattern 7 (lines 580–612). Load-bearing wiring:
the fase-2 RLS harness is reused UNCHANGED via env — `TEST_DATABASE_URL` /
`TEST_DATABASE_APP_URL` (`app_authenticated:dev`) / `TEST_DATABASE_ANON_URL` (`anon:dev`) pointed
at the Actions Postgres service (`imbau_test`, satisfies the harness `requireTestDb` `_test` guard
in `tests/db.ts:43-60`). Because `imbau.env` is unset in CI, `0001_rls.sql` sets the `:dev`
passwords for free. Runner: `pnpm/action-setup` (reads `packageManager pnpm@11.6.0`) + Node 22 +
`dtinth/setup-github-actions-caching-for-turbo` → `pnpm turbo run lint typecheck test`.

---

### `.github/workflows/deploy-staging.yml` (NEW — greenfield)

**No analog.** Copy RESEARCH Patterns 8+9 (lines 617–656). Builds the 3 EXISTING Dockerfiles
(`apps/{web,panel,worker}/Dockerfile`) via matrix → GHCR with two distinct caches (Turbo task
cache + Docker layer `type=gha,scope=<app>`) → SSH deploy runs `deploy/deploy.sh`. The Dockerfiles
were authored fase-3 specifically to be CI-built (see their header comments: "image build is
verified in CI (Phase 4)").

---

### `deploy/deploy.sh` + `deploy/nginx/*.conf` + `deploy/loki/loki-config.yml` + `secrets/.sops.yaml` + `secrets/staging.enc.yaml` (NEW)

**All greenfield — no in-repo analogs.** Copy the inline snippets:
- `deploy.sh` → RESEARCH Pattern 3 (lines 457–464): `sops -d → .env` → `compose pull` →
  `compose run --rm migrate` (exit-code gate, `set -e`) → `compose up -d`.
- nginx vhost → RESEARCH Pattern 1 (lines 300–331): `certonly --webroot` (NEVER `--nginx`),
  loopback `proxy_pass http://127.0.0.1:8091`, SSE block pre-documented but commented.
- Loki config → RESEARCH Pattern 6 (lines 552–572): single-binary filesystem, 168h retention.
- SOPS → RESEARCH §D-09: `.sops.yaml` creation_rules → age recipient; `staging.enc.yaml` encrypted.
  `.gitignore` already excludes `.env`/`.env.*` (allows `.env.example`) — the decrypted runtime
  `.env` is covered; verify `secrets/*.enc.yaml` is NOT gitignored (it must be committed).

## Shared Patterns

### Programmatic Drizzle migrator (NOT drizzle-kit)
**Source:** `packages/db/tests/setup.ts:24-26,72-75`, `tests/db.ts:18-20`, `src/client.ts:28-31`.
**Apply to:** `packages/db/migrate.ts` (deploy) AND the CI harness (already uses it).
`drizzle-kit` is a devDep absent from runtime images — always use
`drizzle-orm/postgres-js/migrator` against the OWNER URL.

### Multi-stage prune→install→runner Dockerfile
**Source:** `apps/worker/Dockerfile` / `apps/web/Dockerfile` (lines 7–30).
**Apply to:** `deploy/migrate.Dockerfile`. `corepack enable` → `turbo prune <pkg> --docker` →
`pnpm install --frozen-lockfile` on `out/json` → copy `out/full`. NEVER re-run `pnpm install --prod`.

### Env preset convention (names + Zod, never values)
**Source:** `packages/config/env/presets.ts` (`dbEnv`/`redisEnv`/`authEnv`, lines 19–44) composed
per-app via `createEnv` (`apps/worker/src/env.ts`).
**Apply to:** new `sentryEnv`/`lokiEnv` presets + their composition into web/panel/worker `env.ts`.

### Staging app/anon role passwords (load-bearing, RESEARCH Pattern 4)
**Source:** `packages/db/migrations/0001_rls.sql` (dev-password block gated on
`current_setting('imbau.env') <> 'production'`).
**Apply to:** staging Postgres config + SOPS bootstrap. Set `imbau.env='production'` and provision
real `app_authenticated`/`anon` passwords from SOPS, else the pools fail scram auth on staging.

### pino-loki transport (RAM-optimal, D-04 fallback-symmetric)
**Source:** RESEARCH Pattern 6 (greenfield). Same transport targets local `loki:3100` OR Grafana
Cloud by swapping `LOKI_URL`/`LOKI_BASIC_AUTH` — replaces worker `console.log(JSON.stringify(...))`.

## No Analog Found (greenfield — use RESEARCH snippets)

| File | Role | Reason |
|------|------|--------|
| `.github/workflows/ci.yml` | CI | No `.github/workflows/` directory exists yet |
| `.github/workflows/deploy-staging.yml` | CD | No workflows exist |
| `deploy/nginx/*.conf` | proxy config | Host nginx lives on the VPS, not in repo |
| `deploy/loki/loki-config.yml` | obs config | First observability config |
| `deploy/deploy.sh` | shell | First deploy script |
| `apps/*/instrumentation*.ts` + `sentry.*.config.ts` | Sentry wiring | First Sentry integration |
| `packages/observability/logger.ts` | logger | First shared observability package |
| `secrets/.sops.yaml` + `secrets/staging.enc.yaml` | secrets | First SOPS/age setup |

## Metadata

**Analog search scope:** root (`compose.yml`, `turbo.json`, `package.json`, `.gitignore`),
`packages/config/env/`, `packages/db/` (drizzle.config, migrations, tests, src/client),
`apps/worker/` (Dockerfile, src/index, src/env), `apps/web/` (Dockerfile, next.config), `.github/`.
**Files scanned:** ~15
**Pattern extraction date:** 2026-06-25
