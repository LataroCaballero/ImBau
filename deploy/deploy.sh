#!/usr/bin/env bash
# deploy/deploy.sh — staging deploy orchestration (INFRA-02 / D-07).
#
# Invoked by .github/workflows/deploy-staging.yml on the VPS (root@) after the repo
# is reset to the just-built SHA:
#     IMAGE_TAG=<sha> bash deploy/deploy.sh
#
# Flow (the migrate-before-swap gate is the load-bearing invariant):
#   1. decrypt SOPS secrets -> a chmod-600 runtime .env (age key on the VPS keyfile)
#   2. source the .env so APP_DB_PASSWORD / ANON_DB_PASSWORD reach the role bootstrap
#   3. `free -m` baseline (RAM headroom on the co-tenant prod box — D-04)
#   4. pull the exact IMAGE_TAG images from GHCR
#   5. bring up ONLY data services (postgres + redis), wait for postgres health
#   6. MIGRATE-BEFORE-SWAP gate: run the one-off `migrate` container. A non-zero exit
#      aborts the whole script via `set -e` BEFORE any app container is swapped — the
#      old web/panel/worker keep running (D-07 / T-4-MIGRATE).
#   7. provision the real app_authenticated / anon role passwords (Pattern 4) — see
#      deploy/bootstrap-roles.sql — AFTER migrate (roles exist) and BEFORE the swap.
#   8. swap the app containers (web/panel/worker)
#   9. `free -m` after the app swap (confirm headroom)
#  10. staged observability profile (loki/grafana/uptime-kuma), then `free -m` again
#      to confirm prod headroom is retained.
#
# The migrate container is the ONLY schema-mutation path — no drizzle-kit, no manual
# schema SQL. bootstrap-roles.sql only sets role passwords + re-asserts the prod GUC.
#
# D-04 Grafana Cloud fallback: if local Loki exhausts RAM, swap LOKI_URL /
# LOKI_BASIC_AUTH in secrets/staging.enc.yaml (re-encrypt) and skip the observability
# profile here — the in-app pino-loki transport will ship to Grafana Cloud instead.

set -euo pipefail

# --- anchor to repo root regardless of invocation cwd ---------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE="docker compose -f deploy/compose.staging.yml"
# Compose's project directory is deploy/, so its env_file `.env` and `.env`
# interpolation source both resolve to deploy/.env — write the decrypted secrets there.
ENV_FILE="deploy/.env"

# IMAGE_TAG selects which GHCR images compose pulls (defaults to `latest` per compose).
: "${IMAGE_TAG:=latest}"
export IMAGE_TAG
echo ">> deploy: IMAGE_TAG=${IMAGE_TAG}"

# --- 1. decrypt SOPS secrets -> chmod-600 runtime .env --------------------------
# SOPS reads the age private key from ~/.config/sops/age/keys.txt on the VPS.
echo ">> decrypting secrets to ${ENV_FILE}"
sops -d --output-type dotenv secrets/staging.enc.yaml > "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

# --- 2. load secrets for this script (role-bootstrap needs the passwords) -------
set -a
# shellcheck disable=SC1090
. "./${ENV_FILE}"
set +a

# --- 3. RAM baseline ------------------------------------------------------------
echo ">> free -m (baseline)"
free -m

# --- 4. pull the exact images ---------------------------------------------------
echo ">> pulling images"
${COMPOSE} pull

# --- 5. bring up data services and wait for postgres health ---------------------
echo ">> starting data services (postgres, redis)"
${COMPOSE} up -d postgres redis
echo ">> waiting for postgres health"
for _ in $(seq 1 30); do
  if ${COMPOSE} exec -T postgres pg_isready -U imbau -d imbau >/dev/null 2>&1; then
    echo ">> postgres is ready"
    break
  fi
  sleep 2
done
${COMPOSE} exec -T postgres pg_isready -U imbau -d imbau >/dev/null

# --- 6. MIGRATE-BEFORE-SWAP gate ------------------------------------------------
# A non-zero exit here aborts the script (set -e) before any app container is
# swapped — the currently-running app containers are left untouched (D-07).
echo ">> running migrations (migrate-before-swap gate)"
${COMPOSE} run --rm migrate

# --- 7. provision app/anon role passwords (Pattern 4) ---------------------------
# AFTER migrate (the roles now exist) and BEFORE the app swap. Without real
# passwords the app/anon pools fail scram-sha-256 auth and boot-fail.
# Run as the owner role `imbau` inside the internal network; passwords are passed
# via psql `-v` from the decrypted .env and never echoed (no -a/-e).
echo ">> provisioning app/anon role passwords (Pattern 4)"
${COMPOSE} exec -T postgres \
  psql -U imbau -d imbau --no-psqlrc \
    -v app_pw="${APP_DB_PASSWORD}" \
    -v anon_pw="${ANON_DB_PASSWORD}" \
    -f - < deploy/bootstrap-roles.sql

# --- 8. swap app containers -----------------------------------------------------
echo ">> swapping app containers (web, panel, worker)"
${COMPOSE} up -d web panel worker

# --- 9. RAM after app swap ------------------------------------------------------
echo ">> free -m (after app swap)"
free -m

# --- 10. staged observability bring-up ------------------------------------------
echo ">> bringing up observability profile (loki, grafana, uptime-kuma)"
${COMPOSE} --profile observability up -d
echo ">> free -m (after observability — confirm prod headroom retained)"
free -m

echo ">> deploy complete"
