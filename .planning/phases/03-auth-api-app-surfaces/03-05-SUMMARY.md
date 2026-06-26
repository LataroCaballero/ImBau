---
phase: 03-auth-api-app-surfaces
plan: 05
subsystem: infra
tags: [docker, dockerfile, turborepo, turbo-prune, nextjs-standalone, tsup, multi-stage, pnpm]

# Dependency graph
requires:
  - phase: 03-auth-api-app-surfaces
    provides: "apps/web + apps/panel with output:'standalone' set (03-03/03-04); apps/worker with tsup dist build (03-04)"
provides:
  - "Multi-stage Dockerfile for apps/web (turbo prune + Next standalone)"
  - "Multi-stage Dockerfile for apps/panel (turbo prune + Next standalone)"
  - "Multi-stage Dockerfile for apps/worker (turbo prune + tsup dist)"
  - "Per-app .dockerignore excluding node_modules/.next/.turbo/dist/.git/.env*/logs"
  - "apps/{web,panel}/public/.gitkeep so the standalone `COPY public` is build-valid"
affects: [04-ci-cd, infra, staging-deploy]

# Tech tracking
tech-stack:
  added: [docker-multi-stage, node22-alpine]
  patterns:
    - "prune -> install/build -> slim runner per CLAUDE.md (turbo prune <app> --docker)"
    - "web/panel package Next standalone (.next/standalone + .next/static + public)"
    - "worker packages tsup dist + traced node_modules; node apps/worker/dist/index.js"

key-files:
  created:
    - apps/web/Dockerfile
    - apps/panel/Dockerfile
    - apps/worker/Dockerfile
    - apps/web/.dockerignore
    - apps/panel/.dockerignore
    - apps/worker/.dockerignore
    - apps/web/public/.gitkeep
    - apps/panel/public/.gitkeep
  modified: []

key-decisions:
  - "SKIP_ENV_VALIDATION=1 only for the build stage; env validated at container boot (MONO-03/D-03)"
  - "Reworded the no-prod-install warning comment to avoid the literal `install --prod` string the acceptance grep treats as a violation"
  - "Created apps/{web,panel}/public/.gitkeep so the canonical `COPY public` does not fail the CI build (no public/ dirs existed yet)"
  - "Worker runner copies traced node_modules (bullmq/ioredis are external to the tsup bundle) instead of a prod install"

patterns-established:
  - "Multi-stage Dockerfile: pruner (turbo prune --docker) -> builder (pnpm install --frozen-lockfile + turbo build) -> node:22-alpine runner"
  - "No production-only pnpm install inside any traced/standalone tree (Pitfall 5 discipline applied to both Next standalone and tsup dist)"

requirements-completed: [APP-04]

# Metrics
duration: 5min
completed: 2026-06-18
---

# Phase 3 Plan 5: App Dockerfiles Summary

**Three multi-stage Dockerfiles (web/panel via Next standalone, worker via tsup dist) using `turbo prune <app> --docker` on node:22-alpine, plus per-app .dockerignore — authored and statically valid for the CI build (Phase 4).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-18T20:25:28Z
- **Completed:** 2026-06-18T20:29:59Z
- **Tasks:** 2
- **Files modified:** 8 (all created)

## Accomplishments
- `apps/web/Dockerfile` and `apps/panel/Dockerfile`: pruner -> builder -> slim runner; each runs `turbo prune @imbau/<app> --docker`, `pnpm install --frozen-lockfile`, `pnpm turbo build --filter=@imbau/<app>`, then copies `.next/standalone` + `.next/static` + `public` and `CMD`s `node apps/<app>/server.js`.
- `apps/worker/Dockerfile`: same pruner/builder skeleton, builds the tsup `dist/`, and runs `node apps/worker/dist/index.js`; copies the traced `node_modules` so the external `bullmq`/`ioredis` deps are present.
- Per-app `.dockerignore` excludes `node_modules`, `.next`, `.turbo`, `dist`, `.git`, `.env*`, logs and test artifacts (T-03-20 mitigation).
- No Dockerfile runs a production-only pnpm install inside the standalone/dist tree (T-03-21 mitigation; grep-verified absent).

## Task Commits

Each task was committed atomically:

1. **Task 1: web + panel multi-stage Dockerfiles + .dockerignore** - `675ef81` (feat)
2. **Task 2: worker multi-stage Dockerfile + .dockerignore** - `9eabced` (feat)

## Files Created/Modified
- `apps/web/Dockerfile` - 3-stage build (turbo prune @imbau/web), Next standalone runner, `CMD node apps/web/server.js`
- `apps/panel/Dockerfile` - 3-stage build (turbo prune @imbau/panel), Next standalone runner, `CMD node apps/panel/server.js`
- `apps/worker/Dockerfile` - 3-stage build (turbo prune @imbau/worker), tsup dist runner, `CMD node apps/worker/dist/index.js`
- `apps/web/.dockerignore`, `apps/panel/.dockerignore`, `apps/worker/.dockerignore` - exclude dev artifacts + secrets from the build context
- `apps/web/public/.gitkeep`, `apps/panel/public/.gitkeep` - keep `public/` present so the standalone `COPY public` is build-valid

## Decisions Made
- **Build-only `SKIP_ENV_VALIDATION=1`:** the Next/worker `env.ts` validates at import time; env vars are supplied at container boot, not bake time, so the build stage skips validation to avoid needing runtime secrets in CI.
- **No-prod-install comment wording:** the original warning comment contained the literal phrase the acceptance grep flags as a violation; reworded to "re-run a production-only pnpm install" so the discipline is documented without tripping the negative grep.
- **Worker runtime deps:** tsup `noExternal` inlines `@imbau/*`, but `bullmq`/`ioredis` remain external — the runner copies the builder's traced `node_modules` rather than running a prod install, keeping the same no-prod-install discipline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created missing `apps/{web,panel}/public/` directories**
- **Found during:** Task 1 (web + panel Dockerfiles)
- **Issue:** The canonical Pattern 7 runner does `COPY ... /public ./apps/<app>/public`, but neither app had a `public/` directory. Docker `COPY` fails when the source path does not exist, so the CI build (Phase 4) would have failed at the runner stage.
- **Fix:** Added `apps/web/public/.gitkeep` and `apps/panel/public/.gitkeep` so the directory exists and the `COPY public` is valid; static assets land here in later phases.
- **Files modified:** apps/web/public/.gitkeep, apps/panel/public/.gitkeep
- **Verification:** Directories present; Dockerfile `COPY public` lines reference an existing source. (Image build itself is CI-only — no local Docker daemon.)
- **Committed in:** 675ef81 (Task 1 commit)

**2. [Rule 1 - Bug] Reworded no-prod-install warning comment to pass the acceptance grep**
- **Found during:** Task 1 (verification step)
- **Issue:** My explanatory comment used the literal string `pnpm install --prod`, which the acceptance criterion's negative grep (`! grep -q "install --prod"`) flagged as a violation even though the directive was never actually run.
- **Fix:** Reworded both web and panel comments to "re-run a production-only pnpm install" — same documented intent, no flagged string.
- **Files modified:** apps/web/Dockerfile, apps/panel/Dockerfile
- **Verification:** `! grep -q "install --prod"` now passes for all three Dockerfiles.
- **Committed in:** 675ef81 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both necessary for a correct, CI-buildable image. No scope creep — the `public/.gitkeep` files are inert placeholders and the comment change is cosmetic.

## Issues Encountered
- `gsd-tools` is not on this shell's PATH; the CLI lives at `.claude/gsd-core/bin/gsd-tools.cjs` and must be invoked via `node`. State/roadmap updates use that path.

## Threat Flags
None — no new security surface beyond the build-context boundary already in the plan's threat model. T-03-20 (secret/dev-artifact leakage) and T-03-21 (broken standalone via prod install) are both mitigated; T-03-22 (build validated in CI) is accepted by design.

## User Setup Required
None - no external service configuration required. Image build occurs in CI (Phase 4).

## Next Phase Readiness
- All three apps are now packageable: Phase 4 CI-03 can `docker build` + push these images and INFRA can deploy them to staging.
- Phase 3 is complete with this plan (APP-04 done) — the auth/API/app-surface phase delivers deployable artifacts for every app target.
- Note for Phase 4: the build context for `turbo prune` is the repo root; ensure the CI `docker build` runs from the repo root and that a root `.dockerignore` (or these per-app ones, depending on build path) is honored.

## Self-Check: PASSED

All 8 created files and the SUMMARY exist on disk; both task commits (`675ef81`, `9eabced`) are present in git history.

---
*Phase: 03-auth-api-app-surfaces*
*Completed: 2026-06-18*
