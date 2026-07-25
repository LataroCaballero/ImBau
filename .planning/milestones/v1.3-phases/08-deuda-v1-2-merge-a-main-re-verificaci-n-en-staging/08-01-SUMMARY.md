---
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
plan: 01
subsystem: infra
tags: [ci, cd, github-actions, docker, ghcr, drizzle, postgres, vitest, staging, rls, seed]

# Dependency graph
requires:
  - phase: v1.2 (fases 05-07)
    provides: quotes API + rate-limit, cotizador UI, async PDF worker — the code being landed on main
provides:
  - Merge commit on `main` (PR #5, merge-commit strategy, 397-commit history + v1.2 tag preserved)
  - 4 GHCR images (imbau-web/panel/worker/migrate) tagged by the merge SHA 22d1e96
  - Migrations 0000–0004 applied on staging via the migrate-before-swap gate (0004_project_whatsapp is new)
  - Seed 'Brigos Recoleta' fully present + publicado on staging (38 units, 76 unit_prices, media/content rows)
  - Green CI (`quality`) after fixing two shared-DB test flakes
affects: [08-02, phase-09, staging, panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Serialize shared-DB Vitest suites (fileParallelism:false) to avoid concurrent partition DDL races"
    - "Match real-encoding suite timeouts to the @imbau/db harness (testTimeout 30s / hookTimeout 60s)"
    - "Seed staging via a one-off migrate-image container (docker compose run --rm migrate pnpm --filter @imbau/db db:seed)"

key-files:
  created:
    - .planning/phases/08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging/08-01-SUMMARY.md
  modified:
    - packages/db/vitest.config.ts (fileParallelism:false — kill the concurrent partition-DDL race)
    - apps/worker/vitest.config.ts (testTimeout 30s / hookTimeout 60s for real sharp + PG media suites)
    - .gitignore (ignore the GSD updater's transient user-files backup)
    - .claude/** (GSD tooling framework sync — chore)

key-decisions:
  - "Merged PR #5 with a merge commit (not squash) — preserves the 397-commit history and the v1.2 tag (D-01)"
  - "Kept the fase-0/foundation branch after merge (D-03)"
  - "Fixed two blocking CI flakes fix-forward on the PR head (D-07) rather than re-running and hoping"
  - "Ran the full media seed against staging (not skipMedia) — the cotizador needs galleries/media (D-05)"

patterns-established:
  - "Shared _test-DB Vitest suites run serially — IF NOT EXISTS DDL is not atomic under concurrency"
  - "Real image-encoding / real-PG test suites need generous timeouts, not the 5s Vitest default"

requirements-completed: [DEBT-01]

coverage:
  - id: D1
    description: "PR #5 merged to main via a merge commit (2 parents), v1.2 tag + fase-0/foundation branch preserved"
    requirement: "DEBT-01"
    verification:
      - kind: automated
        ref: "gh pr view 5 --json state => MERGED; git cat-file -p 22d1e96 => 2 parents (a599bb7, 9e2f2e6); gh api branches/fase-0/foundation => 200; git rev-parse v1.2 => 06c556d"
        status: pass
    human_judgment: false
  - id: D2
    description: "deploy-staging.yml run for the merge SHA green — 4 GHCR images built + SSH deploy"
    requirement: "DEBT-01"
    verification:
      - kind: automated
        ref: "gh run 29614177375 => conclusion=success, headSha=22d1e96, all 5 jobs (4 build + deploy) success"
        status: pass
    human_judgment: false
  - id: D3
    description: "Staging runs the merge-SHA images with migrations 0004+ applied via migrate-before-swap"
    requirement: "DEBT-01"
    verification:
      - kind: integration
        ref: "ssh VPS: /opt/imbau HEAD=22d1e96; web/panel/worker Config.Image tagged 22d1e96; drizzle.__drizzle_migrations count=5 (incl 0004_project_whatsapp)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Seed 'Brigos Recoleta' present + publicado on staging (cotizador prerequisite for 08-02)"
    requirement: "DEBT-01"
    verification:
      - kind: integration
        ref: "psql staging: projects.estado='publicado'; floors=13 units=38 price_lists=2 unit_prices=76 payment_plans=2 cac=18 brokers=3 leads=13 galleries=3 progress=3 media=13 events=18"
        status: pass
    human_judgment: false

# Metrics
duration: ~27min
completed: 2026-07-17
status: complete
---

# Phase 8 Plan 1: Merge v1.2 to main + re-verify on staging Summary

**PR #5 merged to `main` via a merge commit (history + v1.2 tag intact), the deploy-staging pipeline built the 4 v1.2 GHCR images and swapped staging to the merge SHA behind the migrate-before-swap gate (migrations 0000–0004), and the full 'Brigos Recoleta' seed is publicado — DEBT-01 done.**

## Performance

- **Duration:** ~27 min
- **Started:** 2026-07-17T21:02Z (approx)
- **Completed:** 2026-07-17T21:29Z
- **Tasks:** 3
- **Files modified:** 3 source files (+ .claude tooling sync)

## Accomplishments

- Landed all of v1.2 on `main`: PR #5 merged with a **merge commit** (`22d1e96`, 2 parents `a599bb7`+`9e2f2e6`), preserving the 397-commit Conventional-Commits history, the `v1.2` tag (`06c556d`), and the `fase-0/foundation` branch (D-01, D-03).
- Drove `deploy-staging.yml` run `29614177375` to green — all 4 images (web/panel/worker/migrate) built + pushed to GHCR tagged by the merge SHA, and the SSH deploy swapped staging to those exact images.
- Verified over SSH that the migrate-before-swap gate applied migrations 0000–0004 (`0004_project_whatsapp` is the new one; `drizzle.__drizzle_migrations` count = 5) BEFORE the app swap, and that web/panel/worker all run the `22d1e96`-tagged images.
- Ran the full deterministic seed against staging: `brigos-recoleta` is `publicado` with 13 floors / 38 units / 2 price lists / 76 unit_prices / 2 payment plans / 18 cac / 3 brokers / 13 leads / 3 galleries / 3 progress / 13 media / 18 events.
- Made CI green by fixing two pre-existing shared-DB test flakes that were blocking the required `quality` check.

## Task Commits

1. **Task 1: Pre-merge repo hygiene — commit tooling, push, PR #5 up-to-date + green** — chore `a6ac44a`, plus two fix-forward deviation commits: `bd5b9d4` (test), `9e2f2e6` (test)
2. **Task 2: Merge PR #5 with a merge commit + drive staging deploy to green** — merge commit `22d1e96` on `main` (no repo file modified; drives deploy-staging.yml)
3. **Task 3: Verify migrate-before-swap + seed on staging over SSH** — staging DB/container state (no repo file modified; seed run as a one-off migrate container)

**Plan metadata:** committed with STATE/ROADMAP/REQUIREMENTS updates.

## Files Created/Modified

- `packages/db/vitest.config.ts` — `fileParallelism: false` so the shared `_test`-DB suite runs serially (kills the concurrent partition-DDL race).
- `apps/worker/vitest.config.ts` — `testTimeout: 30_000` / `hookTimeout: 60_000` for the real sharp/PG media suites.
- `.gitignore` — ignore `.claude/gsd-user-files-backup/` (GSD updater's transient backup).
- `.claude/**` — GSD tooling framework sync (agents + flat commands + core), committed as `chore:` so `main` reflects the real repo state.

## Decisions Made

- Merge-commit (not squash) strategy for PR #5 to preserve history + the v1.2 tag (D-01).
- Kept `fase-0/foundation` (D-03); v1.3 work branches fresh from post-merge `main`.
- Full media seed (not `skipMedia`) on staging so the cotizador has galleries/media (D-05).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] db suite flake — concurrent partition-DDL race blocked the `quality` gate**
- **Found during:** Task 1 (getting PR #5 green)
- **Issue:** The prior CI run on the PR head failed: `tests/seed.idempotency.test.ts` → `PostgresError: relation "events_2026_04" already exists` (SQLSTATE 42P07). Four `@imbau/db` test files call `runSeed` in parallel against the shared `_test` DB; their owner DDL pre-creates the monthly `events` partitions with `CREATE TABLE IF NOT EXISTS … PARTITION OF events`, which is NOT atomic against a concurrent creator, so a parallel worker lost the race.
- **Fix:** Set `fileParallelism: false` in `packages/db/vitest.config.ts` — the shared-DB suite runs serially. Zero production impact (prod/staging seed once, no concurrency).
- **Files modified:** packages/db/vitest.config.ts
- **Verification:** CI run `29614010093` → `@imbau/db#test` green.
- **Committed in:** `bd5b9d4`

**2. [Rule 3 - Blocking] worker suite flake — real sharp/PG media tests timed out at the 5s default**
- **Found during:** Task 1 (getting PR #5 green)
- **Issue:** With the db race fixed, the next CI run failed on `@imbau/worker#test`: `media.test.ts` (real AVIF/WebP encoding) and `tests/media-integration.test.ts` (real PG16) timed out at Vitest's 5000ms default under CI CPU contention (turbo runs worker + db test tasks in parallel).
- **Fix:** Added `testTimeout: 30_000` / `hookTimeout: 60_000` to `apps/worker/vitest.config.ts`, matching the `@imbau/db` harness. Test-only; no production path affected.
- **Files modified:** apps/worker/vitest.config.ts
- **Verification:** CI run `29614010093` → `quality` conclusion=success.
- **Committed in:** `9e2f2e6`

**3. [Rule 3 - Blocking / D-02] GSD tooling working-tree changes committed as chore**
- **Found during:** Task 1 (pre-merge hygiene)
- **Issue:** ~490 uncommitted `.claude/**` GSD-framework changes plus 6 pending local commits meant `main` would not reflect the real repo state after merge (D-02).
- **Fix:** Committed all `.claude/**` framework changes as `chore:`; ignored the transient `.claude/gsd-user-files-backup/`. Left unrelated untracked `docs/marca/`, `docs/mockup.html` alone (out of scope).
- **Files modified:** .claude/**, .gitignore
- **Verification:** `git status` clean of `.claude` M/D; branch pushed; `quality` green; PR mergeStateStatus CLEAN.
- **Committed in:** `a6ac44a`

---

**Total deviations:** 3 auto-fixed (2 blocking CI flakes, 1 planned-but-notable hygiene commit). All fix-forward on the PR head (D-07); no scope creep beyond making the required `quality` gate green and the repo state truthful.
**Impact on plan:** Both flake fixes were necessary to satisfy Task 1's "do not proceed until `quality` is green" acceptance. They are test-config-only and touch no shipping code path.

## Issues Encountered

- **First seed run partially completed then timed out on `seedMedia`.** The seed inserted org/project/floors/units/pricing, then `seedMedia` threw after 90s: "4 media asset(s) still unprocessed — the worker is not consuming the media-processing queue." Investigation showed the worker WAS running and actively consuming (60% CPU, `media-processing:completed` present) — it was simply slow encoding real AVIF variants on the CPU/RAM-tight co-tenant prod VPS (the same real-encoding slowness class as the CI timeout). All 13 media rows reached `processed` shortly after. The **idempotent re-run** then no-op'd existing rows, passed `seedMedia` immediately (variants populated), and completed `seedContentRows` (brokers/leads/galleries/progress/events). No code change — this is the seed's designed idempotency working as intended on a constrained box. Operational note for future staging seeds: expect the media wait to need a second pass on this VPS.
- **VPS safety (D-08):** only read-only inspection of imbau compose containers + one-off `migrate` seed container; no process killed, prod nginx/host untouched, no secret values echoed.

## User Setup Required

None - no external service configuration required. (The human visual pass of fase 6 stays deferred to `/gsd-verify-work 6` per D-06 — out of scope here.)

## Next Phase Readiness

- **08-02 unblocked:** staging runs the exact v1.2 images with the seed present, so the DEBT-02 live re-verification (rate-limit 429, PDF e2e, QR/deep-link) can run against real staging URLs. Captured evidence (merge SHA `22d1e96`, deploy run `29614177375`, migration count 5, seed row counts) is carried forward for 08-02's UAT (D-10).
- No blockers.

## Self-Check: PASSED

- Commits verified present: `bd5b9d4`, `a6ac44a`, `9e2f2e6` (fase-0/foundation), `22d1e96` (merge on origin/main).
- Files verified present: `packages/db/vitest.config.ts`, `apps/worker/vitest.config.ts`, `.gitignore`.
- Deploy verified: run `29614177375` conclusion=success; staging containers + DB state confirmed over SSH.

---
*Phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging*
*Completed: 2026-07-17*
