---
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
verified: 2026-07-17T22:10:00Z
status: human_needed
score: 13/15 must-haves verified
behavior_unverified: 0
overrides_applied: 0
behavior_unverified_items: []
human_verification:
  - test: "Forced-failure migrate drill: run `deploy/deploy.sh` (or a scoped equivalent) against staging with a deliberately broken migration so the `migrate` one-off container exits non-zero, and confirm `set -e` aborts before any app container is swapped (web/panel/worker keep serving the previous image)."
    expected: "Deploy script exits non-zero at the migrate step; `docker compose ps` shows web/panel/worker still on the pre-deploy image tag; no partial swap occurred."
    why_human: "This exact scenario (migrate failing) never actually occurred in this phase's run — migrate succeeded and applied migration 0004. The `must_haves.truths` item is tagged `verification: backstop` (non-inferable / edge case) and per the honest-verifier protocol, `set -e` + a documented design intent in deploy.sh is code presence, not directly-observed behavior. This exact same threat (T-4-MIGRATE, Phase 4/v1.0) was flagged 'Forced-failure test proves migrate-before-swap aborts' in 04-07-PLAN.md's threat register but 04-VERIFICATION.md only records the happy-path deploy runs (28257024112/28257321414) as evidence — the forced-failure drill has never been executed with recorded evidence across 3 milestones. Recommend either a one-time drill on a disposable branch/tag or accepting the risk explicitly via an override."
  - test: "Empty-migration deploy: trigger `deploy-staging.yml` on a merge to `main` that has zero new Drizzle migrations pending, and confirm the migrate container still exits 0 and the app containers still swap cleanly (no accidental abort or hang on a no-op migration set)."
    expected: "Migrate container run with 0 pending migrations exits 0; web/panel/worker swap to the new image tag without incident."
    why_human: "Not exercised this phase — the 22d1e96 deploy had migration 0004 pending, so this run only proves the non-empty-migration path. Tagged `verification: backstop` (edge case: empty input); no explicit evidence of the empty-input path exists in this phase's captured output. Low risk (idempotent `compose run --rm migrate` design), but per the never-silent-pass rule this must be flagged rather than assumed."
---

# Phase 8: Deuda v1.2 — merge a main + re-verificación en staging — Verification Report

**Phase Goal:** Todo v1.2 (cotizador) corre verificado en vivo en staging tras mergear `fase-0/foundation` a `main`, dejando la fundación limpia antes de construir cualquier superficie del panel encima. Staging hoy corre imagen pre-fase-5; ningún feature nuevo debe apoyarse en infra sin verificar.
**Verified:** 2026-07-17T22:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | `fase-0/foundation` merged to `main`, automatic deploy left 4 v1.2 images running on `staging.tours.andescode.com.ar` | ✓ VERIFIED | Independently confirmed locally: `gh pr view 5 --json state,mergedAt,mergeCommit` → `MERGED`, mergeCommit `22d1e967636561e269b1858e1ef2c79052ae204f`. `git cat-file -p 22d1e96` → 2 parents (`a599bb7`, `9e2f2e6`) confirms a real merge commit, NOT squash. `git merge-base --is-ancestor 22d1e96 origin/main` → YES. `git merge-base --is-ancestor v1.2 origin/main` → YES (tag preserved). `gh api repos/.../branches/fase-0/foundation` → 200 (branch retained, not deleted). `gh run list --workflow=deploy-staging.yml --branch main --limit 1` → `conclusion=success`, `headSha=22d1e96` (run 29614177375). Deploy of the 4 images to staging (web/panel/worker on merge SHA, migrate applying 0004) is corroborated by SSH-captured evidence in 08-01-SUMMARY.md (per verification_notes, treated as the source for live-VPS claims). |
| 2 | Burst of POSTs to `/api/trpc/quotes.*` yields 429 with zero 503, verified live | ✓ VERIFIED | 08-UAT.md Test 1: 100 parallel POSTs (curl `--parallel`) → 77×429 / 21×400 (real tRPC BAD_REQUEST, not the pre-merge 404) / 0×503 / 0×404. `/var/log/nginx/error.log` shows `limiting requests ... by zone "quotes"` (156 hits dated to the burst). Box vhost `diff`'d byte-identical (8581 bytes) against repo `deploy/nginx/staging.tours.andescode.com.ar.conf` — no drift, no sync-back needed (v1.2 D-12). Post-burst vhost intact: web 200 / panel 307. |
| 3 | Full PDF flow e2e on staging with correct es-AR accents | ✓ VERIFIED | 08-UAT.md Test 2: quote created (quoteId `5d67277a`) → `pdfStatus` ready on first poll → `cotizacion.pdf` downloaded from presigned R2 URL. `pdffonts` shows `Roboto-Bold`/`Roboto-Regular` embedded CID TrueType (no tofu). `pdftotext` contains "Cotización", "índice", "m²" (correct es-AR ó/í/² glyphs), full header, both legal legends. |
| 4 | PDF QR/deep-link points at the staging URL | ✓ VERIFIED (deep-link) / documented-optional (QR decode) | Deep-link extracted from PDF text: `https://staging.tours.andescode.com.ar/p/brigos-recoleta/cotizador?u=...&plan=...` — staging host, correct IDs, not localhost/pre-fase-5. QR decode was skipped (no local decoder available); D-11 explicitly designates the deep-link text assertion as the required check and the QR decode as optional/executor's-discretion — this is a documented scope decision in 08-CONTEXT.md, not a silently-dropped check. |

**Score (ROADMAP SCs):** 4/4 verified.

### Observable Truths — Plan `must_haves.truths`

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | PR #5 merged via merge commit (not squash), preserving history + v1.2 tag (08-01, D-01) | ✓ VERIFIED | See ROADMAP SC1 evidence above (independently re-derived via `gh`/`git`, not just trusted from SUMMARY). |
| 2 | `deploy-staging.yml` run finishes `success`, pushes 4 GHCR images tagged with merge SHA (08-01, DEBT-01) | ✓ VERIFIED | `gh run list --workflow=deploy-staging.yml --branch main --limit 1` → conclusion=success, headSha=22d1e96 (run 29614177375), independently confirmed. |
| 3 | migrate container exits 0, applies 0004+ BEFORE swap; role bootstrap runs between migrate and swap (08-01, D-05/D-07) | ✓ VERIFIED | 08-01-SUMMARY.md D3 coverage: SSH — `/opt/imbau` HEAD=22d1e96; web/panel/worker `Config.Image` tagged 22d1e96; `drizzle.__drizzle_migrations` count=5 (incl. `0004_project_whatsapp`). deploy.sh source confirms ordering (migrate step precedes `up -d web panel worker`, role bootstrap SQL runs between). Treated as recorded live evidence per verification_notes. |
| 4 | Seed 'Brigos Recoleta' exists and is `publicado` in staging (08-01, D-05) | ✓ VERIFIED | 08-01-SUMMARY.md D4 coverage: psql staging — `projects.estado='publicado'`; 13 floors/38 units/2 price_lists/76 unit_prices/2 payment_plans/18 cac/3 brokers/13 leads/3 galleries/3 progress/13 media/18 events. |
| 5 | GSD-tooling working-tree changes + 6 pending local commits committed `chore:` and pushed (08-01, D-02) | ✓ VERIFIED | `git log -1 a6ac44a` → `chore: sync GSD tooling (agents + commands + core)`, present on `origin/fase-0/foundation` and folded into the merge. |
| 6 | (backstop) Empty-migration deploy still swaps app containers cleanly | ⚠️ INSUFFICIENT_SPEC → human_needed | Not exercised — this run had a real pending migration (0004). No recorded evidence of a 0-pending-migration deploy in this phase. See Human Verification. |
| 7 | (backstop) Migrate container non-zero exit aborts under `set -e`, leaves old images serving (08-01, D-07) | ⚠️ INSUFFICIENT_SPEC → human_needed | `set -euo pipefail` + step ordering confirmed by static read of `deploy/deploy.sh` (code presence), but no forced-failure drill was run this phase (migrate succeeded). Same threat (T-4-MIGRATE) was flagged for a "forced-failure test" back in Phase 4/v1.0 and never closed with recorded evidence (04-VERIFICATION.md only cites happy-path runs). See Human Verification. |
| 8 | Burst → 429/zero 503, real tRPC responses (08-02, DEBT-02 crit. 2) | ✓ VERIFIED | Same evidence as ROADMAP SC2. |
| 9 | nginx `quotes` zone hit logged; box vhost == repo source of truth; vhost survives burst (08-02, D-12) | ✓ VERIFIED | Same evidence as ROADMAP SC2 (error.log grep + byte-identical diff + post-burst 200/307). |
| 10 | PDF e2e with embedded Roboto + es-AR accents (08-02, DEBT-02 crit. 3) | ✓ VERIFIED | Same evidence as ROADMAP SC3. |
| 11 | PDF deep-link + QR point to staging (08-02, D-11) | ✓ VERIFIED | Same evidence as ROADMAP SC4 (deep-link verified; QR decode documented-optional). |
| 12 | Surface smoke: web 200, cotizador 200, panel 307, worker alive, Sentry/Loki receiving (08-02, D-04) | ✓ VERIFIED | 08-UAT.md Test 3: all 3 HTTP checks pass; `docker inspect` worker restarts=0/running; Loki query returns a structured pino line containing the real quoteId `5d67277a`; 0 Sentry init errors. |
| 13 | Full run captured as command+output in `08-UAT.md` (08-02, D-10) | ✓ VERIFIED | `.planning/phases/08-.../08-UAT.md` exists, `status: complete`, 3 test blocks each with `expected`/`result: pass`/multiline `evidence: \|` containing real captured commands+output. Summary totals reconcile (3 total / 3 passed / 0 issues / 0 pending / 0 skipped / 0 blocked). |
| 14 | (backstop) Concurrent burst never surfaces 503 — every rejection is 429 | ✓ VERIFIED | Direct evidence: 100-parallel burst → 0×503 across all trials; UAT text explicitly notes "Bajo concurrencia toda rechazo fue 429, nunca 503." This is directly-observed behavior, not symbol presence — satisfies the backstop tier. |
| 15 | (backstop) One request within budget passes, next over-budget request rejected 429 (edge boundary) | ✓ VERIFIED | Direct evidence: UAT Test 1 "BORDE" note — post-cooldown, a single in-budget POST → 400 (passes to app); the same burst run shows over-budget requests rejected 429. Both sides of the threshold directly observed. |

**Score:** 13/15 truths verified, 2 flagged `insufficient_spec` (non-inferable backstop truths lacking recorded evidence for this specific run — routed to human verification, never silently passed).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| Merge commit on `main` | PR #5 merged, 2 parents, v1.2 tag + branch preserved | ✓ VERIFIED | Independently confirmed via `git cat-file -p 22d1e96`, `git merge-base --is-ancestor`. |
| `chore:` commit of GSD tooling | Committed + pushed to `origin/fase-0/foundation` | ✓ VERIFIED | `a6ac44a` present in `git log origin/fase-0/foundation`. |
| 4 GHCR images tagged by merge SHA | web/panel/worker/migrate @ `22d1e96` | ✓ VERIFIED (via deploy run) | `deploy-staging.yml` run 29614177375 conclusion=success for headSha=22d1e96 (build matrix job for all 4 images is part of that workflow). |
| Migrations 0004+ applied in staging Postgres | `drizzle.__drizzle_migrations` count reflects new migration | ✓ VERIFIED (recorded) | 08-01-SUMMARY.md: count=5, includes `0004_project_whatsapp`. |
| Seed rows for 'Brigos Recoleta' present + publicado | project row `estado='publicado'` + full content | ✓ VERIFIED (recorded) | 08-01-SUMMARY.md D4 coverage table. |
| `.planning/.../08-UAT.md` | Evidence doc, 3 checks, `status: complete` | ✓ VERIFIED | Read directly — frontmatter correct, 3/3 passed, Gaps section lists only the documented-deferred items (QR decode tooling absence, fase-6 visual pass). |
| `packages/db/vitest.config.ts` (fix-forward, deviation) | `fileParallelism: false` serializes shared-DB suite | ✓ VERIFIED | Read directly — present, well-commented, matches SUMMARY claim. |
| `apps/worker/vitest.config.ts` (fix-forward, deviation) | `testTimeout`/`hookTimeout` raised for real sharp/PG suites | ✓ VERIFIED | Read directly — present, well-commented, matches SUMMARY claim. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| merge → push to `main` | `deploy-staging.yml` trigger | push-to-main workflow trigger | ✓ WIRED | Run 29614177375 created at 21:16:56Z, ~10s after `mergedAt: 21:16:47Z` — trigger fired. |
| IMAGE_TAG=merge SHA | GHCR images → VPS `git reset --hard` + `docker compose pull` | deploy.sh IMAGE_TAG env + `/opt/imbau` HEAD reset | ✓ WIRED (recorded) | 08-01-SUMMARY.md: VPS HEAD=22d1e96, containers Config.Image tagged 22d1e96. |
| migrate-before-swap gate | role bootstrap → app container swap | `deploy.sh` step ordering (steps 6→7→8) | ✓ WIRED | Confirmed by direct read of `deploy/deploy.sh` (migrate runs before role bootstrap, role bootstrap before `up -d web panel worker`) + 08-01-SUMMARY.md recorded confirmation that migrate count reflects 0004 applied before swap completed. |
| `quotes.compute` path | nginx `quotes` zone throttle (429, not 503) | `location ^~ /api/trpc/quotes { limit_req zone=quotes ... limit_req_status 429; }` | ✓ WIRED | 08-UAT.md Test 1 — box vhost byte-identical to repo source of truth; live burst confirms 429 fires, 0×503. |
| quote create → worker BullMQ job → R2 PDF → presigned GET → download | pdfStatus poll → ready → download | tRPC `quotes.create`/`quotes.pdfStatus` → worker job → R2 | ✓ WIRED | 08-UAT.md Test 2 — quoteId 5d67277a traced end-to-end with real IDs and a downloaded, inspected PDF. |

### Anti-Patterns Found

Scanned all files claimed as modified in 08-01-SUMMARY.md (`packages/db/vitest.config.ts`, `apps/worker/vitest.config.ts`, `.gitignore`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — clean, no matches. No stub patterns (`return null`/`return {}`/empty handlers) apply — both files are Vitest config only.

No blockers. The code-review agent (08-REVIEW.md) flagged 2 non-blocking WARNINGs (WR-01: `fileParallelism: false` masks a latent non-atomic partition-DDL race in `runSeed` rather than fixing it at the DB level; WR-02: worker's global `testTimeout: 30_000` weakens fast-failure for unrelated pure/mocked tests) — both are scope/breadth concerns about test-harness tuning, not defects that block DEBT-01/DEBT-02. Tracked as technical debt, not phase-blocking.

### Documentation Sync Finding (non-blocking, informational)

`.planning/ROADMAP.md` line 61 still shows `Phase 8: ... (0/2 plans) — not started` in the milestone overview list, while the same file's "Phase Details" section (lines 84/88) correctly shows both `08-01-PLAN.md` and `08-02-PLAN.md` checked `[x]`. `.planning/STATE.md` (lines 27-34) still reads "Phase: 8 — EXECUTING / Plan: 2 of 2 (08-01 complete)" as if 08-02 were not yet done, even though 08-02-SUMMARY.md is complete and 08-UAT.md is 3/3 passed. This is a planning-doc sync lag (expected to be corrected by the orchestrator's post-verification bookkeeping step), not a gap in the phase's actual deliverable — flagged here for completeness so it isn't missed before the next phase starts.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| DEBT-01 | 08-01 | `fase-0/foundation` merged to `main` with all of v1.2 deployed on staging | ✓ SATISFIED | Merge commit + deploy run + migration/seed state all independently or recorded-evidence confirmed above. |
| DEBT-02 | 08-02 | Live re-verification: 429 rate-limit, full PDF flow, QR/deep-link to staging | ✓ SATISFIED | 08-UAT.md 3/3 passed with real captured command+output evidence. |

REQUIREMENTS.md traceability table (lines 82-83) already marks both `DEBT-01`/`DEBT-02` as `Complete` for Phase 8 — consistent with this verification. No orphaned requirements: REQUIREMENTS.md maps only DEBT-01/DEBT-02 to Phase 8, and both are claimed by the phase's plans.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| PR #5 is MERGED with a real merge commit (not squash) | `gh pr view 5 --json state,mergeCommit`; `git cat-file -p 22d1e96` | state=MERGED; 2 parent lines (`a599bb7`, `9e2f2e6`) | ✓ PASS |
| v1.2 tag + fase-0/foundation branch survived the merge | `git merge-base --is-ancestor v1.2 origin/main`; `gh api .../branches/fase-0/foundation` | YES; 200 | ✓ PASS |
| deploy-staging.yml run for the merge SHA succeeded | `gh run list --workflow=deploy-staging.yml --branch main --limit 1` | conclusion=success, headSha=22d1e96 | ✓ PASS |
| No debt markers in phase-modified files | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` on the 2 vitest configs | no matches | ✓ PASS |
| Both vitest config claims match actual file content | `Read` both files | `fileParallelism: false` present; `testTimeout`/`hookTimeout` present | ✓ PASS |
| All cited commit SHAs exist in git history | `git log -1 <sha>` for a6ac44a/bd5b9d4/9e2f2e6/e4c3f3e/22d1e96 | all 5 resolve to the exact commits claimed in the SUMMARYs | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or PLAN-declared probes found for this phase (it is an ops/infra merge+verification phase, not a code-migration phase with probe scripts). SKIPPED.

### Human Verification Required

#### 1. Forced-failure migrate drill (deploy.sh safe-abort behavior)

**Test:** Deliberately introduce a broken/failing migration and run `deploy/deploy.sh` (or the `docker compose run --rm migrate` step in isolation against a disposable staging-like environment) to confirm the migrate container exits non-zero and `set -e` aborts the script BEFORE any app container swap — old web/panel/worker images keep serving.
**Expected:** Script exits non-zero at the migrate step; `docker compose ps` shows app containers still on the previous image tag; no partial/broken swap.
**Why human:** Tagged `verification: backstop` in the plan frontmatter (non-inferable edge case). This exact scenario was never exercised in this phase's actual run (migrate succeeded, applying 0004) and — notably — this same threat (T-4-MIGRATE) was already flagged as needing a "forced-failure test" back in Phase 4/v1.0 (`04-07-PLAN.md` threat register) but 04-VERIFICATION.md only records happy-path deploy evidence. The gap has persisted across 3 milestones without a recorded drill. `set -euo pipefail` + step ordering are visible in the script (necessary but not sufficient per the honest-verifier protocol — code presence is not directly-observed behavior for a non-inferable truth).

#### 2. Empty-migration deploy (idempotent no-op swap)

**Test:** Trigger a deploy on a merge to `main` with zero pending Drizzle migrations and confirm the migrate container still exits 0 and the app swap proceeds normally.
**Expected:** Migrate step is a clean no-op (exit 0); web/panel/worker swap to the new image tag without incident.
**Why human:** Tagged `verification: backstop`; not exercised this phase (0004 was pending). Low operational risk given `compose run --rm migrate` is inherently idempotent by design, but no recorded evidence exists for this specific input shape.

### Gaps Summary

No functional gaps. All primary DEBT-01/DEBT-02 must-haves and all 4 ROADMAP success criteria are verified with either independently-reproduced evidence (git/gh commands run directly by this verifier) or recorded live-staging evidence (SSH/curl output captured in 08-01/08-02-SUMMARY.md and 08-UAT.md, per this verification's explicit instruction to treat that as the source for live checks rather than re-running against the shared VPS).

The only open items are two **non-inferable backstop truths** in 08-01 (forced-migration-failure abort, empty-migration no-op swap) that describe deploy-pipeline edge cases which simply did not occur during this phase's real run. Per the honest-verifier protocol these must not be silently passed on code-presence alone — they are routed to human verification. Neither blocks DEBT-01 or DEBT-02: the phase's actual deploy succeeded end-to-end on the happy path, which is the path this phase needed to prove before panel work (Phase 9+) can safely build on the foundation.

One documentation-sync finding (ROADMAP.md overview line + STATE.md position) is noted as non-blocking — informational for the next phase's kickoff.

---

_Verified: 2026-07-17T22:10:00Z_
_Verifier: Claude (gsd-verifier)_
