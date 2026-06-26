---
status: complete
plan: 04-07
phase: 04-staging-observability-ci-cd
completed: 2026-06-26
---

# 04-07 Summary — Live staging bring-up (phase gate)

The staging stack is **deployed and live on the VPS** and the full CI/CD→deploy pipeline works end-to-end. This plan was operational (no app code of its own); it exercises the artifacts authored in 04-01..04-06.

## Outcome (verified live)

- **TLS (INFRA-01):** https://staging.tours.andescode.com.ar → 200, https://panel.staging.tours.andescode.com.ar → 307, single SAN cert via certbot **webroot** (no prod vhost touched).
- **Auto-deploy + migrate-before-swap (INFRA-02 / CI-03):** merge to `main` → build 4 images → GHCR → SSH → `deploy.sh` (sops decrypt → migrate → role bootstrap → staged bring-up). Verified across runs 28257024112 / 28257321414 (deploy: success).
- **App-pool auth (Pattern 4 / D-04):** 0 `password authentication failed` lines; app_authenticated/anon pools authenticate against the production-GUC postgres.
- **Observability (OBS-01/02/03):** Sentry smoke test from the worker flushed OK (DSN valid); Loki has the `worker` app label (pino-loki transport shipping); Grafana + Uptime-Kuma containers healthy.
- **RAM (D-04):** ~4.5 GB free of 7.9 GB after the observability profile; the 6 prod containers (chatwoot/n8n/waha) untouched.

## VPS provisioning (one-time, done over SSH)

- `sops` + `age` installed; age keyfile at `~/.config/sops/age/keys.txt`.
- `/opt/imbau` cloned via a **read-only GitHub deploy key** (`id_imbau_github` on the VPS).
- `docker login ghcr.io` with a user `read:packages` PAT.
- Host-nginx vhost added **additively** (sites-available + symlink), `nginx -t`-gated reloads; certbot SAN cert + renewal deploy-hook.
- GitHub Actions secrets: `VPS_SSH_KEY`, `SOPS_AGE_KEY` (+ `SENTRY_AUTH_TOKEN` optional).

## Deviations applied during bring-up (real VPS constraints)

1. **Ports 8092/8093** instead of 8090/8091 (taken by prod pocketbase). — `22d003a`
2. **nginx `listen 443 ssl http2;`** form (VPS runs nginx 1.24, no `http2 on;`). — `b8aadf0`
3. **Deploy images tagged by full `github.sha`** + unconditional `latest` (the repo default branch is `fase-0/foundation`, so `type=sha` `sha-<short>` + `is_default_branch` latest never matched on `main` → "manifest unknown"). — `263603d`
4. **panel `vitest.config.ts` self-contained** (its `../../vitest.config` root import is pruned by `turbo prune --docker`, breaking `next build`). — `ccc921c`
5. **worker keeps `pino`/`pino-loki` external AND lists them as direct deps** (transitive via `@imbau/observability`; bundling them into the ESM single-file broke pino's CJS `require` + the pino-loki worker-thread transport). — `263603d` + `616f251`

## Remaining (manual, non-blocking)

- Confirm the Sentry smoke-test issue in the dashboard (OBS-01).
- Add the two HTTPS monitors in Uptime-Kuma via SSH tunnel (OBS-03).

## Requirements

INFRA-01, INFRA-02, CI-03, OBS-01, OBS-02, OBS-03 — satisfied operationally on live staging.

## Self-Check: PASSED
