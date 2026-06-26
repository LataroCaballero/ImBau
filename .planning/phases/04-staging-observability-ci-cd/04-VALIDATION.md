---
phase: 4
slug: staging-observability-ci-cd
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` §Validation Architecture. This is an infra phase:
> most "tests" are **operational verifications**, split into (A) CI/local-automatable
> vs (B) gated on the real VPS + user prerequisites (DNS A record, age key, secrets, SSH key).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (unit/integration) + the fase-2 RLS harness; operational checks via shell/curl |
| **Config file** | `vitest.config.ts` (root); RLS harness `packages/db/tests/setup.ts` |
| **Quick run command** | `pnpm turbo run lint typecheck test` |
| **Full suite command** | `pnpm turbo run lint typecheck test` (Turbo orchestrates all packages) |
| **Estimated runtime** | ~60–120 seconds (cold; faster with Turbo cache restore) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm turbo run lint typecheck test`
- **After every plan wave:** Full suite + (for infra waves) the relevant operational check
- **Before `/gsd-verify-work`:** Full suite green in CI on a PR
- **Phase gate:** CI green on a PR **and** one real merge-to-main deploy verified end-to-end on the VPS
  (200 over TLS, Sentry test error, Loki log line, Kuma green, `free -m` headroom, forced-migration-fail aborts swap)
- **Max feedback latency:** ~120 seconds (CI quick path)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Rows below map each phase requirement to its
> verification method; the planner/executor binds them to concrete `{N}-PP-TT` task IDs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | CI | — | CI-01 | — | PR runs lint+typecheck+test; red blocks merge (branch protection) | automated | `pnpm turbo run lint typecheck test` (in CI) | ❌ W0 | ⬜ pending |
| TBD | CI | — | CI-02 | T-4-RLS | RLS isolation green vs real `postgres:16` service; role-guard `rolbypassrls=false` | automated | RLS harness against Actions Postgres service | ❌ W0 | ⬜ pending |
| TBD | CI | — | CI-03 | — | 3 images built w/ Turbo cache + pushed to GHCR (`<sha>`+`latest`) | automated | deploy workflow run; cache hit on rerun | ❌ W0 | ⬜ pending |
| TBD | INFRA | — | INFRA-03 | T-4-SECRET | No plaintext secrets in repo; `sops -d` round-trips; `.env` gitignored | automated (A) | `git grep` scan + `sops -d` round-trip | ❌ W0 | ⬜ pending |
| TBD | INFRA | — | INFRA-01 | — | Compose behind TLS proxy; `curl -I https://staging…`+`https://panel.staging…` → 200 | operational (B) | `curl -I` over TLS; `docker compose ps` healthy | ❌ W0 | ⬜ pending |
| TBD | INFRA | — | INFRA-02 | — | merge → auto-deploy; forced bad migration aborts swap (old containers stay up) | operational (B) | merge-to-main deploy; forced-fail migration test | ❌ W0 | ⬜ pending |
| TBD | OBS | — | OBS-01 | — | Errors (web/panel/worker incl. RSC) reach Sentry with stack+context | operational (B) | trigger test error → appears in Sentry | ❌ W0 | ⬜ pending |
| TBD | OBS | — | OBS-02 | — | pino structured logs reach Loki | operational (B) | LogQL `{app="panel"}` returns recent lines | ❌ W0 | ⬜ pending |
| TBD | OBS | — | OBS-03 | — | Uptime Kuma monitors staging endpoints | operational (B) | Kuma shows green monitors | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.github/workflows/ci.yml` — PR gate (lint/typecheck/test + `postgres:16` service) [CI-01/CI-02]
- [ ] `.github/workflows/deploy-staging.yml` — build+push 3 images + SSH deploy [CI-03/INFRA-02]
- [ ] `packages/db/migrate.ts` + `deploy/migrate.Dockerfile` — migrate-before-swap runner (programmatic drizzle-orm migrator) [INFRA-02/D-07]
- [ ] `deploy/compose.staging.yml`, `deploy/nginx/*.conf`, `deploy/loki/loki-config.yml`, `deploy/deploy.sh`
- [ ] `secrets/.sops.yaml` + `secrets/staging.enc.yaml`; `.env` added to `.gitignore` [INFRA-03]
- [ ] `packages/config/env/presets.ts` — `sentryEnv` + `lokiEnv` presets [OBS-01/OBS-02]
- [ ] Sentry files in web/panel (`instrumentation.ts`, `instrumentation-client.ts`, server/edge config, `withSentryConfig`) + worker (`@sentry/node` init); pino logger wired in all 3 apps [OBS-01/OBS-02]
- [ ] Branch protection: require the `quality` check on `main` [CI-01]

*Note: the RLS harness itself (fase-2) already exists — no new test framework install needed; it is endpoint-parametrizable and only needs CI env vars pointed at the Postgres service.*

---

## Manual-Only Verifications

> These require the real VPS and are GATED on user prerequisites (DNS A record for
> `staging.tours.andescode.com.ar`, age keypair + real secret values, SSH deploy key,
> GHCR PAT or public images). Authoring is not blocked; only the live end-to-end
> verification is.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TLS reachability of web + panel | INFRA-01 | Needs DNS + certbot cert on live box | `curl -I https://staging.tours.andescode.com.ar` and `…/panel.staging…` → 200 + valid cert; `docker compose ps` all healthy |
| Auto-deploy + migrate-before-swap | INFRA-02 | Needs SSH deploy key + live DB | Merge to main; confirm deploy runs; force a bad migration → deploy aborts, old containers stay up |
| Errors reach Sentry (incl. RSC) | OBS-01 | Needs live Sentry DSN + deployed apps | Trigger test error in each app → appears in Sentry with stack + RSC context |
| pino logs reach Loki | OBS-02 | Needs running Loki/Grafana on VPS | LogQL `{app="panel"}` in Grafana returns recent pino lines |
| Uptime Kuma green | OBS-03 | Needs Kuma running + endpoints live | Kuma dashboard shows green monitors for staging endpoints |
| RAM headroom after observability bring-up | D-04 | Needs live box | `free -m` before/after staged bring-up shows headroom retained for prod |

---

## Validation Sign-Off

- [ ] All CI-automatable tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (operational/VPS-gated tasks documented as manual)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
