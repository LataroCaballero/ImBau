---
phase: 04-staging-observability-ci-cd
plan: 05
subsystem: infra
tags: [docker-compose, nginx, certbot, loki, grafana, uptime-kuma, drizzle, migrations, staging]

# Dependency graph
requires:
  - phase: 01-schema-media-seed
    provides: packages/db Drizzle journal (0000_init + idempotent 0001_rls) and the postgres-js migrator shape (tests/setup.ts, tests/db.ts)
  - phase: 03-auth-api-apps
    provides: web/panel/worker multi-stage Dockerfiles via turbo prune (the analog for migrate.Dockerfile)
provides:
  - Programmatic owner-role drizzle-orm migrator (packages/db/migrate.ts) + db:migrate:deploy script
  - deploy/migrate.Dockerfile — runtime-image-buildable migrate runner (prune @imbau/db, run migrate.ts from source)
  - deploy/compose.staging.yml — full staging topology (internal net, loopback 8090/8091, profiles, per-service mem_limit, imbau.env=production)
  - deploy/loki/loki-config.yml — single-binary filesystem Loki, 168h retention
  - deploy/nginx/staging.tours.andescode.com.ar.conf — host-nginx vhost (web + panel subdomains, one SAN cert, webroot ACME)
affects: [04-06-deploy-pipeline, 04-07-vps-bring-up]

# Tech tracking
tech-stack:
  added: [grafana/loki:3.5, grafana/grafana:11.6.0, louislam/uptime-kuma:1]
  patterns:
    - "Migrate-before-swap: drizzle-orm programmatic migrator (not drizzle-kit) as a one-off image, gated on exit code"
    - "Internal-only data services + loopback app binds behind a shared host nginx"
    - "Observability under a Compose profile with per-container mem_limit for staged RAM-safe bring-up"

key-files:
  created:
    - packages/db/migrate.ts
    - deploy/migrate.Dockerfile
    - deploy/compose.staging.yml
    - deploy/loki/loki-config.yml
    - deploy/nginx/staging.tours.andescode.com.ar.conf
  modified:
    - packages/db/package.json
    - packages/db/tsconfig.json

key-decisions:
  - "migrate.ts reads raw process.env.DATABASE_URL (owner), never packages/db/src/env.ts, so the migrate image carries no app/anon URLs"
  - "migrate.Dockerfile runs migrate.ts from source via Node type-stripping in the install stage (pnpm symlinks intact); no separate slim runner, no tsup/drizzle-kit"
  - "Postgres staging runs -c imbau.env=production so 0001_rls.sql skips the :dev password block; real app/anon passwords provisioned out-of-band (Pattern 4, plan 04-06)"
  - "Two DNS A records required for one SAN cert: staging.tours and panel.staging.tours -> 31.97.175.128 (flagged for 04-07)"
  - "Grafana/Uptime-Kuma not host-published (internal net, SSH-tunnel access); observability gated behind profiles for staged bring-up"

patterns-established:
  - "Pattern: one-off owner-role migrator image as the deploy gate (migrate-before-swap)"
  - "Pattern: loopback-only app publish (127.0.0.1:809x) fronted by a shared host nginx via certbot --webroot (never --nginx)"
  - "Pattern: per-service mem_limit + observability profile for a RAM-constrained co-tenant VPS"

requirements-completed: [INFRA-01, INFRA-02, OBS-02, OBS-03]

coverage:
  - id: D1
    description: "Programmatic owner-role drizzle-orm migrator (migrate.ts) + db:migrate:deploy script applying the prod journal"
    requirement: "INFRA-02"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/db typecheck (exit 0)"
        status: pass
      - kind: other
        ref: "grep gate: drizzle-orm/postgres-js/migrator + process.env.DATABASE_URL in migrate.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "deploy/migrate.Dockerfile prunes @imbau/db and runs migrate.ts (no drizzle-kit/tsup)"
    requirement: "INFRA-02"
    verification:
      - kind: other
        ref: "grep gate: turbo prune @imbau/db + CMD packages/db/migrate.ts"
        status: pass
    human_judgment: true
    rationale: "Image build + run is exercised only on the VPS / CI (no local Docker daemon here); authoring-time grep proves shape, not a successful build."
  - id: D3
    description: "deploy/compose.staging.yml — internal net, loopback 8090/8091, per-service mem_limit, profiles, imbau.env=production, no host ports on pg/redis"
    requirement: "INFRA-01"
    verification:
      - kind: integration
        ref: "docker compose -f deploy/compose.staging.yml --profile deploy --profile observability config (VALID YAML/topology)"
        status: pass
      - kind: other
        ref: "grep gate: loopback binds, imbau.env=production, >=8 mem_limit, profiles, no 5432/6379 publish"
        status: pass
    human_judgment: false
  - id: D4
    description: "deploy/loki/loki-config.yml — single-binary filesystem Loki, 168h retention (OBS-02) + Uptime Kuma service (OBS-03)"
    requirement: "OBS-02"
    verification:
      - kind: other
        ref: "grep gate: retention_period: 168h + louislam/uptime-kuma in compose"
        status: pass
    human_judgment: true
    rationale: "Loki ingest + Grafana/Kuma runtime behavior only observable once the stack is brought up on the VPS (04-07)."
  - id: D5
    description: "deploy/nginx/staging.tours.andescode.com.ar.conf — two subdomains, one SAN cert, webroot ACME, loopback proxy"
    requirement: "INFRA-01"
    verification:
      - kind: other
        ref: "grep gate: both server_names, 127.0.0.1:8090/8091, acme-challenge, fullchain.pem"
        status: pass
    human_judgment: true
    rationale: "nginx -t + live cert issuance + proxy reachability are gated on the VPS host nginx (04-07); not testable locally."

# Metrics
duration: 18min
completed: 2026-06-26
status: complete
---

# Phase 4 Plan 05: Staging Runtime Artifacts Summary

**Authored the full staging runtime surface — an owner-role drizzle-orm migrate runner + image, a RAM-safe internal-network Compose topology (loopback app binds, observability profiles, mem_limits, imbau.env=production), single-binary Loki config, and a host-nginx vhost (two subdomains, one SAN cert via webroot ACME).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- `packages/db/migrate.ts`: programmatic drizzle-orm migrator that applies the SAME journal the test harness uses, connecting as the OWNER role from raw `DATABASE_URL` (max:1) — never importing `src/env.ts` (which would force app/anon URLs into a one-off runner). `db:migrate:deploy` runs it via Node type-stripping; `typecheck` passes.
- `deploy/migrate.Dockerfile`: mirrors the worker prune→install multi-stage targeting `@imbau/db`, then runs `migrate.ts` from source — no drizzle-kit (a devDep absent from runtime images), no tsup.
- `deploy/compose.staging.yml`: 9-service staging topology — Postgres/Redis internal-only (no host ports), web/panel on loopback `127.0.0.1:8090/8091`, worker internal, a `deploy`-profiled one-off `migrate`, and Loki/Grafana/Uptime-Kuma under an `observability` profile. Every RAM consumer carries a `mem_limit`; Postgres boots with `-c imbau.env=production` so the RLS migration skips the dev-password block. `docker compose config` validates the topology.
- `deploy/loki/loki-config.yml`: single-binary, filesystem-backed Loki with inmemory ring, 168h retention, and a compactor — RAM-trimmed for the shared VPS; logs are pushed by the in-app pino-loki transport (no Promtail).
- `deploy/nginx/staging.tours.andescode.com.ar.conf`: `:80` webroot ACME + https redirect, two `:443` blocks proxying to the loopback app ports with X-Forwarded-* headers and one SAN cert, plus commented SSE and `limit_req` deferral blocks; header documents hand-apply + `certonly --webroot` (never `--nginx`) + the two required DNS A records.

## Task Commits

Each task was committed atomically:

1. **Task 1: Programmatic migrate runner + migrate.Dockerfile** - `0892224` (feat)
2. **Task 2: Staging Compose topology + Loki config** - `c9d79d2` (feat)
3. **Task 3: Host-nginx staging vhost** - `6b854b1` (feat)

**Plan metadata:** docs commit (this SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `packages/db/migrate.ts` - owner-role drizzle-orm programmatic migrator (raw DATABASE_URL, max:1)
- `packages/db/package.json` - added `db:migrate:deploy` script (Node type-stripping)
- `packages/db/tsconfig.json` - added `migrate.ts` to `include` so typecheck covers it
- `deploy/migrate.Dockerfile` - prune `@imbau/db` → install → run migrate.ts from source
- `deploy/compose.staging.yml` - full staging topology (internal net, loopback binds, profiles, mem_limits, imbau.env=production)
- `deploy/loki/loki-config.yml` - single-binary filesystem Loki, 168h retention
- `deploy/nginx/staging.tours.andescode.com.ar.conf` - host-nginx vhost (web + panel, one SAN cert, webroot ACME)

## Decisions Made
- **migrate.ts reads raw `process.env.DATABASE_URL`** (with a fail-loud guard naming the var, never the value) instead of `src/env.ts`, keeping the migrate image free of app/anon URLs it does not need.
- **No separate slim runner stage in migrate.Dockerfile**: the migrator runs from source in the install stage where pnpm's symlinked `node_modules` is intact — copying pnpm symlinks into a runner would break the linked tree (the same footgun the standalone/worker images avoid). The container is one-off and internal-only.
- **GHCR namespace `ghcr.io/latarocaballero/imbau-*`** derived from the git remote owner `LataroCaballero` (lowercased), matching the plan.
- **Image pins** taken from 04-RESEARCH Pattern 2/6: `grafana/loki:3.5`, `grafana/grafana:11.6.0`, `louislam/uptime-kuma:1`, `postgres:16-alpine`, `redis:7-alpine`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `migrate.ts` to `packages/db/tsconfig.json` include**
- **Found during:** Task 1 (migrate runner)
- **Issue:** The package `tsconfig.json` `include` listed `src`, `tests`, configs — but NOT a package-root `migrate.ts`. The plan's verify gate is `pnpm --filter @imbau/db typecheck`; without adding the file to `include`, typecheck would silently NOT cover migrate.ts, defeating the gate.
- **Fix:** Added `"migrate.ts"` to the `include` array.
- **Files modified:** packages/db/tsconfig.json
- **Verification:** `pnpm --filter @imbau/db typecheck` exits 0 and now type-checks migrate.ts (strict, noUncheckedIndexedAccess → the `DATABASE_URL` guard is required, not a `!` assertion).
- **Committed in:** `0892224` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The tsconfig include is required for the plan's own verify gate to be meaningful; no scope creep. All other artifacts authored exactly as specified.

## Issues Encountered
- `docker compose config` initially failed only because `deploy/.env` does not exist (it is decrypted at deploy time by deploy.sh in plan 04-06). Re-ran with a temporary empty `.env` (removed afterward) to confirm the YAML/topology is valid — it parses cleanly.
- No local `nginx` binary, so `nginx -t` is deferred to the VPS (04-07) per the plan; structural grep gate passes.

## Known Stubs
None — all artifacts are complete, self-consistent config. The commented SSE and `limit_req` blocks in the nginx vhost are intentional, documented deferrals (phase 2 / future milestone), not stubs blocking this plan's goal.

## User Setup Required
None in this plan. Downstream (04-07) prerequisites flagged for the user: two DNS A records (`staging.tours` + `panel.staging.tours` → 31.97.175.128), SOPS-provisioned real app/anon DB passwords, and SSH/GHCR credentials.

## Next Phase Readiness
- **04-06 (deploy pipeline)** can now consume `deploy/migrate.Dockerfile` (build the migrate image), `deploy/compose.staging.yml` (pull + `run --rm migrate` gate + `up -d`), and provision the real `imbau.env=production` role passwords out-of-band (Pattern 4).
- **04-07 (VPS bring-up)** can hand-apply the nginx vhost (after the two DNS A records resolve), issue the SAN cert via `certonly --webroot`, and do the staged Compose bring-up.
- Live verification (`nginx -t`, image build/run, Loki ingest, RLS auth on staging) is gated on the VPS and out-of-band secrets — by design.

## Self-Check: PASSED
- All 5 created artifact files exist on disk.
- All 3 task commits (`0892224`, `c9d79d2`, `6b854b1`) found in git history.

---
*Phase: 04-staging-observability-ci-cd*
*Completed: 2026-06-26*
