---
status: passed
phase: 04-staging-observability-ci-cd
verified: 2026-06-26
method: live staging verification on the VPS (operational, not just task-complete)
---

# Phase 04 Verification — Staging, Observability & CI/CD

**Goal:** the foundation is deployed and operable — every commit to `main` ends in software running on staging (`staging.tours.andescode.com.ar`) with multi-tenant isolation verifiable by RLS, observable, and behind TLS. **Achieved.**

## Must-haves (verified live, not assumed)

| Req | Evidence |
|-----|----------|
| INFRA-01 (full Compose behind TLS) | web `https://staging.tours...` → 200, panel → 307; SAN cert valid (TLS verify=0); 9 services up, DB/Redis internal-only, web/panel loopback 8092/8093 |
| INFRA-02 (migrate-before-swap deploy) | `deploy.sh` runs `compose run --rm migrate` before app swap; deploy runs 28257024112 / 28257321414 → success |
| INFRA-03 (SOPS+age secrets) | `secrets/staging.enc.yaml` encrypted; `sops -d` on the VPS produces the runtime `.env`; `SOPS_AGE_KEY` in Actions + VPS keyfile |
| CI-01/CI-02 (PR quality gate) | branch protection on `main` requires `quality`; lint+typecheck+test green (postgres+redis services, migrate step) |
| CI-03 (build→GHCR→VPS) | `deploy-staging.yml` builds 4 images → GHCR → SSH deploy; auto-runs on merge to main |
| OBS-01 (Sentry) | worker Sentry smoke test flushed OK to the real DSN; apps instrumented incl. RSC `onRequestError` |
| OBS-02 (Loki) | Loki has the `worker` app label — pino→Loki transport shipping |
| OBS-03 (Uptime-Kuma) | container healthy and reachable (monitors added manually via tunnel) |

## Pattern 4 / RLS

App `app_authenticated` / `anon` pools authenticate against the production-GUC postgres (role passwords provisioned by `bootstrap-roles.sql`); 0 auth-failure lines in app logs.

## Non-blocking follow-ups

- Manual confirmation of the Sentry issue in the dashboard and Uptime-Kuma monitor setup (both verified reachable; final visual confirmation is the operator's).
- `Node.js 20 deprecated` annotation on marketplace actions (non-fatal; bump action versions at convenience).

**Verdict: PASSED — staging is live and the pipeline is operable end-to-end.**
