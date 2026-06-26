---
phase: 04-staging-observability-ci-cd
plan: 06
subsystem: infra
tags: [github-actions, ghcr, docker-buildx, ssh-deploy, sops, migrate-before-swap, rls, staging]

# Dependency graph
requires:
  - phase: 04-staging-observability-ci-cd
    provides: "04-04 secrets KEY CONTRACT (secrets/staging.env.example, .sops.yaml, staging.enc.yaml) — the env var NAMES deploy.sh decrypts"
  - phase: 04-staging-observability-ci-cd
    provides: "04-05 deploy/compose.staging.yml (service/role/db names, profiles deploy/observability, loopback binds), deploy/migrate.Dockerfile (the 4th image), packages/db/migrate.ts"
provides:
  - ".github/workflows/deploy-staging.yml — push:main + workflow_dispatch → GHCR matrix build (web/panel/worker/migrate, per-image type=gha cache) → SSH deploy"
  - "deploy/deploy.sh — sops decrypt → pull → migrate-before-swap gate → role bootstrap → staged bring-up + free -m"
  - "deploy/bootstrap-roles.sql — idempotent staging app_authenticated/anon password provisioning (Pattern 4)"
affects: [04-07-vps-bring-up]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GHCR matrix build with per-image type=gha Docker layer cache (cache scope = image name); Turbo task cache stays in the CI quality job"
    - "SSH deploy pins IMAGE_TAG to github.sha so the VPS pulls the exact images the run built (no stale latest)"
    - "Migrate-before-swap: one-off migrate container as a set -e exit-gate before any app container is swapped"
    - "Pattern 4: out-of-band app/anon role-password provisioning via owner-run psql -v (passwords never inlined or echoed)"

key-files:
  created:
    - .github/workflows/deploy-staging.yml
    - deploy/deploy.sh
    - deploy/bootstrap-roles.sql
  modified: []

key-decisions:
  - "Single build job with a 4-entry matrix include (image+dockerfile) builds web/panel/worker from apps/<app>/Dockerfile and migrate from deploy/migrate.Dockerfile — one job, per-image cache scope"
  - "metadata-action lowercases the image name, so the mixed-case owner LataroCaballero still yields ghcr.io/latarocaballero/imbau-* matching compose"
  - "Decrypted runtime secrets are written to deploy/.env (compose project dir = deploy/), so the same file serves env_file for app containers AND ${POSTGRES_PASSWORD}/${IMAGE_TAG} interpolation"
  - "deploy.sh anchors to repo root via BASH_SOURCE so it works regardless of invocation cwd; compose is always addressed as -f deploy/compose.staging.yml"
  - "bootstrap-roles.sql re-asserts imbau.env=production at the DATABASE level (belt-and-suspenders) so the dev-password block in 0001_rls.sql stays skipped even if the compose command is changed"

patterns-established:
  - "Pattern: per-image GHCR build cache (type=gha, scope=<image>) distinct from the Turbo task cache"
  - "Pattern: SSH deploy keyed on github.sha for exact-image pulls"
  - "Pattern: owner-run psql -v role-password bootstrap (Pattern 4) post-migrate / pre-swap"

requirements-completed: [CI-03, INFRA-02]

coverage:
  - id: T1
    description: "deploy-staging.yml builds 4 images to GHCR (SHA+latest) with per-image type=gha cache, then SSH-runs deploy.sh with IMAGE_TAG=github.sha"
    requirement: "CI-03"
    verification:
      - kind: other
        ref: "grep gate: ghcr.io, build-push-action, cache-to type=gha, imbau-migrate, ssh-action, deploy/deploy.sh; jobs: present (valid structure)"
        status: pass
    human_judgment: true
    rationale: "Real matrix build + GHCR push + SSH deploy only execute on GitHub Actions against the live VPS (no Docker daemon / runner here); authoring-time grep proves shape, the live run is the 04-07 gate."
  - id: T2
    description: "deploy.sh: sops decrypt → chmod600 .env → pull → data services → migrate gate → role bootstrap → app swap → observability, with free -m checks"
    requirement: "INFRA-02"
    verification:
      - kind: other
        ref: "bash -n clean; grep gate: set -euo pipefail, sops -d, run --rm migrate, free -m, --profile observability, up -d web panel worker"
        status: pass
    human_judgment: false
  - id: T3
    description: "bootstrap-roles.sql idempotently sets app_authenticated/anon passwords from psql :'app_pw'/:'anon_pw'; wired into deploy.sh with APP_DB_PASSWORD via -v"
    requirement: "INFRA-02"
    verification:
      - kind: other
        ref: "grep gate: ALTER ROLE app_authenticated/anon, app_pw, bootstrap-roles.sql + APP_DB_PASSWORD in deploy.sh; deploy.sh bash -n clean"
        status: pass
    human_judgment: true
    rationale: "app/anon pool authentication against the staging DB is only observable once the stack is brought up on the VPS (04-07)."

# Metrics
duration: 5min
completed: 2026-06-26
status: complete
---

# Phase 4 Plan 06: Build→GHCR→VPS Deploy Pipeline Summary

**Authored the full staging deploy pipeline — a GitHub Actions workflow that matrix-builds the 4 staging images (web/panel/worker + the one-off migrate runner) to GHCR with per-image Docker layer cache and SSH-deploys the exact SHA, plus a `deploy.sh` that decrypts SOPS secrets, runs migrations as an exit-gate BEFORE swapping any app container, provisions the staging app/anon role passwords (Pattern 4), and stages the bring-up with `free -m` RAM checks.**

This plan is AUTHORING ONLY. No real deploy, SSH, or image push was performed — the live end-to-end bring-up is the phase gate in 04-07 (gated on user prerequisites: VPS_SSH_KEY / SOPS_AGE_KEY Actions secrets, GHCR PAT on the VPS, age keyfile, and `/opt/imbau` clone).

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-26
- **Completed:** 2026-06-26
- **Tasks:** 3
- **Files modified:** 3 (3 created, 0 modified)

## Accomplishments
- `.github/workflows/deploy-staging.yml`: triggers on `push: [main]` + `workflow_dispatch` (the manual hook the future prod deploy reuses). A `build` job (`permissions: packages: write`) with a 4-entry matrix (`include` mapping `image`→`dockerfile`) builds web/panel/worker from `apps/<app>/Dockerfile` and migrate from `deploy/migrate.Dockerfile`, logging in to GHCR with `GITHUB_TOKEN`, tagging via `metadata-action` (`type=sha` + `latest` on the default branch), and pushing with `build-push-action@v6` under a per-image `type=gha` cache (`scope=<image>`). A `deploy` job `needs: build` and uses `appleboy/ssh-action@v1` to `cd /opt/imbau`, `git reset --hard origin/main`, and run `IMAGE_TAG=${{ github.sha }} bash deploy/deploy.sh` so the VPS pulls the exact images just built. Optional `SENTRY_AUTH_TOKEN` is passed as a build-arg for source-map upload.
- `deploy/deploy.sh`: `set -euo pipefail`, repo-root-anchored. Decrypts `secrets/staging.enc.yaml` → chmod-600 `deploy/.env` (compose project dir), sources it so `APP_DB_PASSWORD`/`ANON_DB_PASSWORD` reach the role bootstrap, then: `free -m` baseline → `compose pull` → `up -d postgres redis` + health wait → **migrate-before-swap gate** (`compose run --rm migrate`; a non-zero exit aborts via `set -e` before any app swap) → role-password bootstrap → `up -d web panel worker` → `free -m` → `--profile observability up -d` → `free -m`. The migrate container is the only schema-mutation path. A comment documents the D-04 Grafana Cloud LOKI fallback.
- `deploy/bootstrap-roles.sql`: idempotently `ALTER ROLE app_authenticated/anon WITH PASSWORD :'app_pw'/:'anon_pw'` from psql variables (never inlined/echoed) and re-asserts `ALTER DATABASE imbau SET "imbau.env" = 'production'`. Wired into `deploy.sh` as an owner-run (`psql -U imbau`) `exec -T postgres ... -v app_pw=... -v anon_pw=... -f -` AFTER migrate (roles exist) and BEFORE the app swap. This closes the repo-discovered gap: 0001_rls.sql's dev-password block is `imbau.env=production`-skipped on staging, so the roles would otherwise have no password and the app/anon pools would scram-auth-fail.

## Task Commits

Each task was committed atomically:

1. **Task 1: deploy-staging.yml (build+push GHCR + SSH deploy)** - `e749e5e` (feat)
2. **Task 2: deploy.sh (migrate-before-swap + staged bring-up)** - `1fec949` (feat)
3. **Task 3: bootstrap-roles.sql + wire into deploy.sh (Pattern 4)** - `1e7d782` (feat)

**Plan metadata:** docs commit (this SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `.github/workflows/deploy-staging.yml` - GHCR matrix build (web/panel/worker/migrate, per-image type=gha cache) → SSH deploy of the exact SHA
- `deploy/deploy.sh` - sops decrypt → pull → migrate-before-swap gate → role bootstrap → staged bring-up + free -m
- `deploy/bootstrap-roles.sql` - idempotent staging app/anon password provisioning (Pattern 4)

## Decisions Made
- **One build job, 4-entry matrix `include`** (`{ image, dockerfile }`) rather than two jobs — keeps the migrate image on the same per-image cache discipline as the apps and reads cleanly.
- **Image name via `metadata-action`** which auto-lowercases, so `github.repository_owner = LataroCaballero` resolves to `ghcr.io/latarocaballero/imbau-*` — matching the literals already pinned in `compose.staging.yml`.
- **Decrypted secrets written to `deploy/.env`** (not repo-root `.env`): Compose's project directory is `deploy/` (first `-f` file's dir), so its `env_file: [.env]` and `${POSTGRES_PASSWORD}`/`${IMAGE_TAG}` interpolation both resolve there. One file, double duty; already gitignored by `.env`/`.env.*`.
- **`deploy.sh` anchors to repo root via `BASH_SOURCE`** so it is cwd-independent; compose is always `-f deploy/compose.staging.yml`.
- **`ALTER DATABASE imbau SET imbau.env=production`** added to bootstrap-roles.sql as a belt-and-suspenders so the production gate persists at the DB level even if the compose `command` is later changed.

## Deviations from Plan

None — all three artifacts authored exactly as specified. The plan's deploy.sh action text said `> .env`; I wrote to `deploy/.env` to match Compose's project directory (the file the app containers' `env_file` and `${...}` interpolation actually resolve to). This is a path correctness clarification, not a behavioral deviation — the same decrypted secrets, same chmod 600, same gitignore coverage.

## Issues Encountered
- `python3 -c "import yaml"` is unavailable in this environment, so the Task 1 verify gate took its documented fallback (`grep -q "jobs:"`) for YAML structure. Hand-review confirms the workflow is well-formed (jobs `build`/`deploy`, matrix include, steps). Real YAML/action validation happens when GitHub parses the workflow on first push (04-07).
- No Docker daemon / GitHub runner / VPS available locally, so image build, GHCR push, SSH deploy, migrate run, and app/anon authentication are all gated to the live 04-07 run — by design (authoring-only plan).

## Known Stubs
None. All three files are complete, self-consistent deploy artifacts. The `<< BOOTSTRAP_ROLES_PLACEHOLDER >>` marker that existed transiently in deploy.sh after Task 2 was replaced by the real psql invocation in Task 3 (final state has no placeholder).

## Threat Flags
None — no new security surface beyond the plan's `<threat_model>`. The pipeline's trust boundaries (GitHub Actions → GHCR via GITHUB_TOKEN, Actions → VPS via VPS_SSH_KEY, deploy.sh → DB owner DDL) and their mitigations (scoped token, secret SSH key, psql `-v` passwords never logged, chmod-600 gitignored `.env`, migrate exit-gate) are all implemented as specified.

## User Setup Required
Flagged for 04-07 (the live run), not this plan:
- GitHub Actions secrets: `VPS_SSH_KEY` (id_vps_andescode private key), `SOPS_AGE_KEY` (already loaded in 04-04), optional `SENTRY_AUTH_TOKEN`.
- VPS one-time bootstrap (root@): `git clone` repo to `/opt/imbau`; `docker login ghcr.io` with a PAT scoped `read:packages`; place the age key at `~/.config/sops/age/keys.txt`.
- Two DNS A records (from 04-05) must resolve before nginx cert issuance.

## Next Phase Readiness
- **04-07 (VPS bring-up)** can now: push to `main` (or `workflow_dispatch`) to exercise the build→GHCR→SSH pipeline, and trust `deploy.sh` to enforce migrate-before-swap, provision the Pattern-4 role passwords, and stage the RAM-safe bring-up. The must_haves (auto-deploy, migrate gate, app/anon authentication) are verified live there.

## Self-Check: PASSED
- All 3 created artifact files exist on disk (`.github/workflows/deploy-staging.yml`, `deploy/deploy.sh`, `deploy/bootstrap-roles.sql`).
- All 3 task commits (`e749e5e`, `1fec949`, `1e7d782`) found in git history.

---
*Phase: 04-staging-observability-ci-cd*
*Completed: 2026-06-26*
