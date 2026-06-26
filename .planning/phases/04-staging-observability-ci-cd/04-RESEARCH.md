# Phase 4: Staging, Observability & CI/CD - Research

**Researched:** 2026-06-25
**Domain:** CI/CD pipelines, container orchestration on a shared VPS, secrets management, observability
**Confidence:** HIGH on mechanics grounded in the repo + official docs; MEDIUM on exact third-party image/action version tags (drift fast — verify at plan time)

## Summary

This is a pure infrastructure / CI-CD / observability phase: no UI, no domain logic. The codebase is in
excellent shape to receive it — Dockerfiles for all three apps already exist (fase 3), the RLS test
harness is already parametrized by env (fase 2, reads `TEST_DATABASE_*` || `DATABASE_*`), `packages/config`
already has a clean preset pattern, and the Drizzle migration journal (`0000_init.sql` + idempotent
`0001_rls.sql`) already creates the `app_authenticated`/`anon` roles. The phase's job is to *wire* these
into (1) a GitHub Actions PR gate, (2) a build→GHCR→VPS deploy pipeline with migrate-before-swap, (3) a
staging Compose stack behind the host nginx, and (4) Sentry + pino→Loki + Uptime Kuma.

The **dominant risk is RAM** (D-04): ~4.9 GiB shared with a live prod box (chatwoot/n8n/waha/2×Postgres).
Every observability container must carry a `mem_limit`, brought up staged via Compose `profiles`, with a
documented Grafana Cloud fallback. The second load-bearing finding (discovered in the repo, not in
CONTEXT) is that `0001_rls.sql` only sets the `app_authenticated`/`anon` passwords when
`current_setting('imbau.env') <> 'production'` — so **CI gets working `:dev` credentials for free**, but
**staging must set `imbau.env='production'` and provision the real app/anon role passwords out-of-band
from SOPS**. The planner must not miss this or the app pools cannot authenticate on staging.

**Primary recommendation:** Two-subdomain nginx vhost (`staging.tours…` web + `panel.staging.tours…`
panel) with one SAN certbot cert via the **webroot** authenticator (never `--nginx`, never touch prod
vhosts); GHCR private images pulled with a `read:packages` PAT on the VPS; SOPS+age decrypted to a
gitignored runtime `.env` consumed by Compose; a dedicated `migrate` Compose service (profile `deploy`)
running the drizzle-orm migrator and gating the swap on its exit code; pino→Loki via the **pino-loki
transport** (no Promtail container — RAM-optimal and symmetric with the Grafana Cloud fallback);
`@sentry/nextjs` 10.x with `instrumentation.ts` + `onRequestError = Sentry.captureRequestError`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Drop Traefik on staging; integrate with the host nginx. Add ONE new server block for
  `staging.tours.andescode.com.ar` with a **certbot (HTTP-01)** cert, reverse-proxying to `panel` and
  `web` containers on **loopback ports** (`127.0.0.1:PORT`). Only ADD vhosts/certs; never edit existing
  ones. (Justified deviation from CLAUDE.md Traefik+ACME pattern — real blocker: Traefik on 80/443 would
  break prod sites. Traefik pattern deferred to a future dedicated box.)
- **D-02:** ImBau containers do NOT publish Postgres/Redis to the host (host already has pg:5432 /
  redis:6379) — they live on an internal docker network in ImBau's compose project. Only `panel` and
  `web` bind to loopback for nginx to proxy. Pick high loopback ports outside the taken set (e.g.
  8082/8083; planner fixes the values).
- **D-03:** Full self-hosted observability (Loki + Grafana + Promtail + Uptime Kuma) in the staging
  Compose, plus Sentry cloud (free) for errors and `onRequestError` (RSC). Separate Sentry for the worker.
- **D-04 (MANDATORY RAM mitigation):** (a) `mem_limit`/`deploy.resources.limits` per observability
  container; (b) staged/`profiles` bring-up; (c) verify RAM with `free -m` before/after, leave headroom
  for prod; (d) document a Grafana Cloud free fallback (push pino→Loki off-box, ~0 local RAM) if
  self-hosted exhausts memory. **Largest risk source of the phase.**
- **D-05:** GHCR (private/free, native Actions integration). Each merge to `main` builds+pushes the 3
  images (web/panel/worker) with **Turborepo cache (`type=gha`)**, tags by SHA + `latest`. Push from
  Actions uses the built-in `GITHUB_TOKEN`.
- **D-06:** Deploy by SSH from Actions: `root@` with `id_vps_andescode` (key as Actions secret) →
  `docker compose pull && up -d`. The VPS-side pull needs a PAT `read:packages` (or public images) —
  planner decides and documents it as a VPS secret.
- **D-07:** Migrate-before-swap: Drizzle migrations run in a one-off container
  (`docker compose run --rm migrate` or equivalent) against the staging DB BEFORE swapping app
  containers. If migration fails, the deploy aborts without swap.
- **D-08:** GitHub Actions: every PR runs `lint + typecheck + test`; red CI blocks merge (CI-01). RLS
  isolation tests run against an Actions **Postgres service** reusing the fase-2 endpoint-parametrizable
  harness — same config, same tests, no testcontainers (CI-02). Restore Turborepo cache before
  `turbo run lint typecheck test`.
- **D-09:** SOPS + age. Encrypted `.enc.yaml` files versioned in repo, separated by environment
  (staging; future prod). The age private key lives as an Actions secret AND in
  `~/.config/sops/age/keys.txt` on the VPS; deploy decrypts to a runtime `.env`. Satisfies INFRA-03
  literal (nothing sensitive in plaintext in repo). Real values the user provides: staging ImBau DB
  password, Sentry DSN(s), `RESEND_API_KEY`, SSH deploy key.

### Claude's Discretion
- Concrete loopback port values, service/network names in the staging Compose, exact YAML structure of
  the workflows, SOPS file layout, and the fine mechanics of the Turborepo cache in Actions — research/
  planner fix these following the decisions above.

### Deferred Ideas (OUT OF SCOPE)
- **Real prod** (prod domain, manual `workflow_dispatch` deploy): the pipeline is designed to support it
  but this phase delivers only staging.
- **Traefik + ACME + custom-domains-by-CNAME** pattern: deferred to a dedicated box/edge; staging uses
  host nginx + certbot.
- **Edge rate-limit for events/leads** (modelo-mvp §3.3): those tables are a future milestone; the
  mechanism (nginx vhost) is decided when they exist.
- **Postgres backups (pgBackRest/wal-g to B2/R2):** research confirms below — DEFER (staging DB is
  ephemeral/reconstructible from migrations + seed; FOUND-01 is explicitly "deferred foundation").

### User Prerequisites (block real-deploy verification, not authoring)
- Create the **DNS A record(s)** `staging.tours.andescode.com.ar` (and `panel.staging…`) → 31.97.175.128
  (certbot HTTP-01 issuance depends on this).
- Generate the **age keypair** and load real secret values (staging DB pw, Sentry DSN, Resend key).
- Load the **SSH deploy key** and the **GHCR PAT `read:packages`** (or make images public) as secrets.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Full Compose runs on the staging VPS behind a TLS proxy (web, panel, worker, Postgres, Redis, Loki/Grafana, Uptime Kuma) at `staging.tours.andescode.com.ar` | §nginx vhost + certbot (D-01); §Staging Compose topology (internal network, loopback binds, profiles); §Observability under RAM limits. NOTE: "behind Traefik" in REQUIREMENTS/ROADMAP wording is SUPERSEDED by D-01 (host nginx). |
| INFRA-02 | Each merge to main auto-deploys to staging (build → registry → VPS), migrations run before container swap | §GHCR build+push; §SSH deploy; §Migrate-before-swap (dedicated `migrate` service, exit-code gate) |
| INFRA-03 | Secrets live encrypted in repo (SOPS/age), env-separated; nothing sensitive in plaintext | §SOPS + age layout, decrypt-to-`.env` flow, `.gitignore` discipline |
| CI-01 | Every PR runs lint + typecheck + test in Actions; red CI blocks merge | §CI workflow (PR trigger, branch protection / required check) |
| CI-02 | RLS isolation tests run in CI against a real Postgres service | §CI Postgres service wiring (exact `TEST_DATABASE_*` env, role creation via migrate, `_test` DB name) |
| CI-03 | CI builds the 3 app images with Turborepo cache and pushes to the registry | §GHCR build+push, §two distinct caches (Turbo task cache vs Docker layer cache `type=gha`) |
| OBS-01 | Errors from web/panel/worker reach Sentry with context (incl. `onRequestError` for RSC) | §Sentry for Next 16 App Router (`instrumentation.ts`, `captureRequestError`); §Sentry for the worker (`@sentry/node`); §`sentryEnv` preset |
| OBS-02 | All three apps log structured pino; logs reach Grafana/Loki on staging | §pino + pino-loki transport (recommended) / Promtail alt; §Loki single-binary config |
| OBS-03 | Uptime Kuma monitors staging service availability | §Uptime Kuma container + monitors (HTTPS endpoints via nginx, internal container health) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TLS termination + public routing | Host nginx (VPS) | certbot (renewal) | Host already owns :80/:443; only ADD a vhost (D-01) |
| Reverse proxy → apps | Host nginx → loopback ports | Docker internal net | Apps bind 127.0.0.1 only; nginx is the sole public ingress (D-02) |
| App runtime (web/panel SSR/RSC) | Container (Next standalone) | — | Prod build, `next start`; no HMR/websocket on staging |
| Background jobs runtime | Container (worker) | Redis (internal) | BullMQ shell only this milestone |
| Persistence | Internal Postgres/Redis containers | named volumes | Not published to host; ImBau-owned ephemeral instances (D-02) |
| Schema migration | One-off `migrate` container (owner role) | — | Runs before swap; gates deploy (D-07) |
| Image build + registry | GitHub Actions runner → GHCR | Docker buildx (`type=gha`) | Build off-box; VPS only pulls (D-05/D-06) |
| CI quality gate | GitHub Actions + Postgres service | Turbo remote cache (`type=gha`) | PR gate; RLS tests vs real PG (D-08) |
| Secret storage/transport | SOPS+age in repo → runtime `.env` | Actions secret + VPS keyfile | No plaintext in repo (D-09/INFRA-03) |
| Error monitoring | Sentry cloud (per-app DSN) | `instrumentation.ts` register | RSC errors via `onRequestError` (OBS-01) |
| Log aggregation | Loki (container) | pino-loki transport in each app | RAM-optimal; symmetric with Grafana Cloud fallback (OBS-02/D-04) |
| Uptime monitoring | Uptime Kuma (container) | — | HTTP(S) probes of staging endpoints (OBS-03) |

## Standard Stack

### Core (new this phase)

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `@sentry/nextjs` | `10.61.0` (matrix pins `10.57.0`; both 10.x) | Error + perf monitoring for web/panel (App Router, RSC) | Official Next SDK; `onRequestError` since 8.28 [VERIFIED: npm registry + Sentry docs] |
| `@sentry/node` | `10.61.0` | Error monitoring for the worker (separate SDK, D-03) | Official Node SDK; same major as nextjs SDK [VERIFIED: npm registry] |
| `pino` | `10.3.1` | Structured JSON logging in all 3 apps (OBS-02) | Matrix-pinned; fastest Node logger; already the de-facto stdout JSON shape in the worker [VERIFIED: npm registry] |
| `pino-loki` | `3.0.0` | pino transport pushing logs to Loki's HTTP push API | RAM-optimal (no scraper container); same transport targets local Loki OR Grafana Cloud (D-04 fallback symmetry) [VERIFIED: npm registry] |
| `sops` | `~3.13.0` (binary) | Encrypt/decrypt env-separated secrets in repo (D-09/INFRA-03) | Industry standard; age backend [CITED: github.com/getsops/sops] |
| `age` | `~1.3.1` (binary) | Encryption backend for SOPS (modern, keyfile-based) | Simple keypair; `~/.config/sops/age/keys.txt` convention [CITED: github.com/FiloSottile/age] |

### Supporting (dev/CI only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino-pretty` | `13.1.3` | Human-readable pino output | Dev only — NEVER in the staging/prod transport chain [VERIFIED: npm registry] |

### Container images (verify exact tags at plan time — these drift)

| Image | Tag line | Purpose | Notes |
|-------|----------|---------|-------|
| `grafana/loki` | `3.x` (e.g. `3.5`) | Log store (single-binary, filesystem) | Pin a concrete minor; `mem_limit: 256m` [ASSUMED tag] |
| `grafana/grafana` | `11.x`/`12.x` OSS | Dashboards over Loki | `mem_limit: 256m`; disable analytics/alerting to save RAM [ASSUMED tag] |
| `louislam/uptime-kuma` | `1` | Uptime monitoring (OBS-03) | `mem_limit: 128m`; named volume for its SQLite [ASSUMED tag] |
| `grafana/promtail` *(only if NOT using pino-loki)* | `3.x` | Scrape container stdout → Loki | `mem_limit: 64m`. Note: Promtail is feature-frozen; Grafana now steers to **Alloy**. See Open Questions. [ASSUMED tag] |
| `postgres` | `16-alpine` | Staging DB (internal only) | Matrix-pinned; ImBau-owned instance, not the host's |
| `redis` | `7-alpine` | Staging Redis (internal only) | Matrix-pinned |

### GitHub Actions (verify majors at plan time)

| Action | Major (2026) | Purpose |
|--------|--------------|---------|
| `actions/checkout` | `v4` | Checkout |
| `pnpm/action-setup` + `actions/setup-node` | `v4` / `v4` | pnpm 11.6.0 via corepack + Node 22, npm cache |
| `dtinth/setup-github-actions-caching-for-turbo` | `v1` | Turbo remote cache backed by GH Actions cache (`type=gha` semantics, no Vercel token) [CITED] |
| `docker/setup-buildx-action` | `v3`/`v4` | Buildx for `type=gha` layer cache |
| `docker/login-action` | `v3`/`v4` | GHCR login (`GITHUB_TOKEN`) |
| `docker/metadata-action` | `v5`/`v6` | SHA + `latest` tag generation |
| `docker/build-push-action` | `v6`/`v7` | Build + push with `cache-from/to: type=gha` |
| `appleboy/ssh-action` *(or raw ssh)* | `v1` | SSH deploy step to the VPS |

**Installation (npm, app deps):**
```bash
# web + panel
pnpm --filter @imbau/web --filter @imbau/panel add @sentry/nextjs@10.61.0 pino@10.3.1 pino-loki@3.0.0
pnpm --filter @imbau/web --filter @imbau/panel add -D pino-pretty@13.1.3
# worker
pnpm --filter @imbau/worker add @sentry/node@10.61.0 pino@10.3.1 pino-loki@3.0.0
# Consider a shared @imbau/observability package (Claude's discretion) to avoid 3× duplication.
```
sops/age are host/CI binaries (apt or GitHub release), not npm deps.

**Version verification:** `@sentry/nextjs`, `@sentry/node`, `pino`, `pino-loki`, `pino-pretty` confirmed
on the npm registry 2026-06-25 (see Package Legitimacy Audit). sops/age versions are from WebSearch only —
the planner should confirm the latest stable release before pinning.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pino-loki transport | Promtail/Alloy container scraping docker json-file logs | Decouples logging from app + captures non-pino stdout, but +1 container (~50–64 MB) and asymmetric with the Grafana Cloud fallback. D-03 names Promtail — see Open Questions. |
| pino-loki transport | Loki **docker log driver** plugin on the host | Zero extra container/RAM, but installs a host-level docker plugin on a shared prod box (more invasive). |
| GHCR private + PAT pull | Public GHCR images | Simpler (no VPS PAT) but exposes image contents publicly — not recommended for a SaaS. |
| Two subdomains (web + panel) | Path-based single host | Path-based needs Next `basePath` gymnastics and complicates Better Auth cookie scope; subdomains are cleaner. |
| `migrate` via drizzle-orm migrator | `drizzle-kit migrate` in a CI/runtime image | drizzle-kit is a devDep absent from runtime images; the drizzle-orm programmatic migrator (already used by the test harness) needs only `drizzle-orm` + the migrations folder. |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@sentry/nextjs` | npm | years (latest pub today) | ~7.57M/wk | github.com/getsentry/sentry-javascript | SUS (`too-new`) | Approved — false positive |
| `@sentry/node` | npm | years (latest pub today) | ~26.35M/wk | github.com/getsentry/sentry-javascript | SUS (`too-new`) | Approved — false positive |
| `pino` | npm | mature | ~37.85M/wk | github.com/pinojs/pino | OK | Approved |
| `pino-loki` | npm | mature | ~181K/wk | github.com/Julien-R44/pino-loki | OK | Approved |
| `pino-pretty` | npm | mature | high | github.com/pinojs/pino-pretty | OK | Approved (dev only) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@sentry/nextjs`, `@sentry/node` — the `too-new` signal fires
only because Sentry publishes the monorepo packages **daily**; both are years-old, official
(`getsentry/sentry-javascript`), with millions of weekly downloads and no postinstall script. This is a
**false positive**. Mitigation: pin an exact known-good version (10.57.0 per the matrix, or 10.61.0) —
do NOT float `latest`. No `checkpoint:human-verify` needed beyond pinning.

**Binary tools (not npm):** `sops`, `age` — install from official GitHub releases / distro packages and
verify checksums. Versions (sops 3.13.0, age 1.3.1) are `[ASSUMED]` from WebSearch; confirm latest.

## Architecture Patterns

### System Architecture Diagram

```
 Developer ──PR──► GitHub  ──(CI: lint+typecheck+test, RLS vs PG service)──► required check ✔/✗
     │                                                                            │ (✔ allows merge)
     └──merge to main──► GitHub Actions (deploy workflow)
                              │
              ┌───────────────┼─────────────────────────────┐
              │ 1. build 3 images (buildx, cache type=gha)   │
              │ 2. push → ghcr.io/<owner>/imbau-{web,panel,worker}:<sha>,:latest
              │ 3. ssh root@VPS (id_vps_andescode)           │
              └───────────────┬─────────────────────────────┘
                              ▼
   ┌──────────────────────── VPS (andescode.com.ar, shared w/ prod) ───────────────────────┐
   │  host nginx :80/:443  ── certbot SAN cert ──┐                                          │
   │     ├─ staging.tours…  ─► 127.0.0.1:8090 ───┼─► [web container]                        │
   │     └─ panel.staging…  ─► 127.0.0.1:8091 ───┴─► [panel container]                      │
   │                                                                                        │
   │  deploy.sh:  sops -d → .env (chmod600)                                                 │
   │    → docker compose pull                                                               │
   │    → docker compose run --rm migrate   (owner role; EXIT≠0 ⇒ ABORT, no swap) ──D-07    │
   │    → docker compose up -d  (profile app, then observability)                           │
   │                                                                                        │
   │  ImBau compose project (INTERNAL docker network, nothing published except loopback):   │
   │     web ─┐  panel ─┐  worker ─┐                                                         │
   │          ├─► postgres:16 (internal)   redis:7 (internal)                               │
   │     all apps ──pino-loki──► loki:3100 (internal) ◄── grafana (dashboards)              │
   │     uptime-kuma ──probes──► https endpoints + internal container health                │
   │  all apps ──Sentry SDK──────────────────────────────────────────► Sentry cloud (free) │
   │  RAM guard: mem_limit per obs container; profiles; free -m before/after                │
   └────────────────────────────────────────────────────────────────────────────────────────┘
        FALLBACK (D-04): pino-loki host/auth swapped ─► Grafana Cloud Loki (≈0 local RAM)
```

### Recommended Repo Structure (additions)
```
.github/workflows/
├── ci.yml                 # PR gate: lint + typecheck + test (Postgres service, Turbo cache)
└── deploy-staging.yml     # on push:main → build+push GHCR → ssh deploy (migrate-before-swap)
deploy/
├── compose.staging.yml    # full staging topology (internal net, loopback binds, profiles, mem_limits)
├── nginx/
│   └── staging.tours.andescode.com.ar.conf  # the ONE new vhost (applied by hand to host nginx)
├── loki/loki-config.yml   # single-binary filesystem config + retention
├── promtail/promtail.yml  # ONLY if pino-loki not chosen
├── migrate.Dockerfile     # tiny image: drizzle-orm migrator + packages/db/migrations
└── deploy.sh              # sops -d → .env → pull → migrate (gate) → up -d
secrets/
├── .sops.yaml             # creation_rules → age recipient
└── staging.enc.yaml       # encrypted; prod.enc.yaml later
packages/config/env/presets.ts   # ADD sentryEnv + lokiEnv presets
packages/observability/ (optional, Claude's discretion)  # shared pino+sentry init
```

### Pattern 1: nginx vhost + certbot (webroot) — D-01/D-02

**What:** One new `server` block per app subdomain on the host nginx, TLS via a single SAN cert issued
by certbot's **webroot** authenticator (does NOT mutate existing vhosts, unlike `--nginx`).

**Recommended hostnames:** `staging.tours.andescode.com.ar` → web; `panel.staging.tours.andescode.com.ar`
→ panel. One SAN cert covering both. (Subdomains avoid Next `basePath` and keep Better Auth's cookie/URL
scope clean: `BETTER_AUTH_URL=https://panel.staging.tours.andescode.com.ar`.)

**Loopback ports (recommended, outside the taken set 80,443,22,3000,3001,5432,5680,6379,5433):**
web → `127.0.0.1:8090`, panel → `127.0.0.1:8091`. In compose: `ports: ["127.0.0.1:8090:3000"]` (the
`127.0.0.1:` prefix is mandatory — a bare `8090:3000` would publish on all interfaces).

**Issuance order (safe on a live box):**
```bash
# 1. Add an HTTP-only server block first, serving the ACME challenge from a webroot:
#    server { listen 80; server_name staging.tours… panel.staging…;
#             location /.well-known/acme-challenge/ { root /var/www/certbot; } ... }
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
# 2. Issue ONE SAN cert via webroot (no edits to existing vhosts):
sudo certbot certonly --webroot -w /var/www/certbot \
  -d staging.tours.andescode.com.ar -d panel.staging.tours.andescode.com.ar \
  --non-interactive --agree-tos -m <admin-email>
# 3. Add the :443 server blocks referencing /etc/letsencrypt/live/staging.tours…/{fullchain,privkey}.pem
sudo nginx -t && sudo systemctl reload nginx
# Renewal: the existing certbot.timer renews ALL certs; add a deploy-hook to reload nginx:
#   --deploy-hook "systemctl reload nginx"  (or in /etc/letsencrypt/renewal-hooks/deploy/)
```

**vhost proxy block (per app):**
```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name panel.staging.tours.andescode.com.ar;
    ssl_certificate     /etc/letsencrypt/live/staging.tours.andescode.com.ar/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.tours.andescode.com.ar/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8091;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }

    # SSE route(s): NOT used until phase 2 (explorador, LISTEN/NOTIFY). Pre-document so the
    # vhost is SSE-ready. Apply to the specific SSE path(s) only, NOT location / :
    # location /api/stream/ {
    #     proxy_pass http://127.0.0.1:8091;
    #     proxy_http_version 1.1;
    #     proxy_set_header Connection '';
    #     proxy_buffering off;          # critical: do not buffer the event stream
    #     proxy_cache off;
    #     proxy_read_timeout 3600s;     # keep the long-lived stream open
    #     proxy_set_header Host $host;
    #     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #     proxy_set_header X-Forwarded-Proto $scheme;
    # }
}
```
**HMR/websocket:** NOT needed — staging runs the prod build (`next start` via standalone `server.js`),
no Fast Refresh. Only the future SSE route needs the buffering-off treatment.

**Next standalone behind a proxy:** for correct request URLs / Sentry traces, the apps should trust the
proxy. Next reads `X-Forwarded-*`; no extra config needed for standalone, but ensure
`BETTER_AUTH_URL`/`NEXT_PUBLIC_*` point at the public https origin.

### Pattern 2: Staging Compose — internal network, loopback binds, profiles, mem_limits (D-02/D-04)

**What:** A `deploy/compose.staging.yml` separate from the local `compose.yml`. Postgres/Redis are
internal-only (no `ports:`); only web/panel bind loopback. Observability under `profiles` + `mem_limit`.

```yaml
# deploy/compose.staging.yml (skeleton — values are Claude's discretion within the decisions)
name: imbau-staging
networks:
  internal: {}
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: imbau
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}      # from decrypted .env
      POSTGRES_DB: imbau
    networks: [internal]            # NO ports: — never published to host (D-02)
    volumes: [pgdata:/var/lib/postgresql/data]
    mem_limit: 512m
    healthcheck: { test: ["CMD-SHELL","pg_isready -U imbau -d imbau"], interval: 5s, retries: 10 }
  redis:
    image: redis:7-alpine
    networks: [internal]            # NO ports:
    mem_limit: 128m
  web:
    image: ghcr.io/<owner>/imbau-web:${IMAGE_TAG:-latest}
    env_file: [.env]
    networks: [internal]
    ports: ["127.0.0.1:8090:3000"]  # loopback only — nginx proxies here
    mem_limit: 512m
    depends_on: { postgres: { condition: service_healthy } }
  panel:
    image: ghcr.io/<owner>/imbau-panel:${IMAGE_TAG:-latest}
    env_file: [.env]
    networks: [internal]
    ports: ["127.0.0.1:8091:3000"]
    mem_limit: 512m
  worker:
    image: ghcr.io/<owner>/imbau-worker:${IMAGE_TAG:-latest}
    env_file: [.env]
    networks: [internal]
    mem_limit: 384m
  migrate:                          # D-07 — one-off, never long-running
    build: { context: .., dockerfile: deploy/migrate.Dockerfile }
    image: ghcr.io/<owner>/imbau-migrate:${IMAGE_TAG:-latest}
    env_file: [.env]
    networks: [internal]
    profiles: ["deploy"]            # only runs via `compose run --rm migrate`
    restart: "no"
  loki:
    image: grafana/loki:3.5
    command: -config.file=/etc/loki/loki-config.yml
    volumes: [./loki/loki-config.yml:/etc/loki/loki-config.yml:ro, lokidata:/loki]
    networks: [internal]
    profiles: ["observability"]
    mem_limit: 256m
  grafana:
    image: grafana/grafana:11.6.0
    environment: { GF_ANALYTICS_REPORTING_ENABLED: "false", GF_AUTH_ANONYMOUS_ENABLED: "false" }
    volumes: [grafanadata:/var/lib/grafana]
    networks: [internal]
    profiles: ["observability"]
    mem_limit: 256m
  uptime-kuma:
    image: louislam/uptime-kuma:1
    volumes: [kumadata:/app/data]
    networks: [internal]
    profiles: ["observability"]
    mem_limit: 128m
volumes: { pgdata: {}, lokidata: {}, grafanadata: {}, kumadata: {} }
```

**Staged bring-up (D-04):**
```bash
free -m                                                   # baseline
docker compose -f deploy/compose.staging.yml up -d postgres redis
docker compose -f deploy/compose.staging.yml run --rm migrate   # gate (D-07)
docker compose -f deploy/compose.staging.yml up -d web panel worker
free -m                                                   # check headroom
docker compose -f deploy/compose.staging.yml --profile observability up -d
free -m                                                   # confirm prod still has headroom
```
**Grafana/Uptime-Kuma exposure:** do NOT publish them publicly in phase 4 (least attack surface). Access
via SSH tunnel (`ssh -L 3000:127.0.0.1:<kuma-loopback> …`) or, optionally, a password-protected nginx
vhost. Keep them on the internal network; bind to loopback only if a tunnel is wanted.

### Pattern 3: Migrate-before-swap (D-07)

**What:** A tiny `migrate` image running the **drizzle-orm programmatic migrator** (not drizzle-kit, which
is a devDep) against the staging DB as the **owner** role, gating the swap on its exit code.

```Dockerfile
# deploy/migrate.Dockerfile — minimal owner-role migration runner
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @imbau/db --docker
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# migrate.ts: import { migrate } from "drizzle-orm/postgres-js/migrator"; run vs DATABASE_URL (owner)
CMD ["node","--experimental-strip-types","packages/db/migrate.ts"]
```
```ts
// packages/db/migrate.ts (new) — runs the SAME journal the harness uses
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });   // OWNER role (DDL + CREATE ROLE)
await migrate(drizzle(sql), { migrationsFolder: "packages/db/migrations" });
await sql.end();
```
**Deploy gate (in `deploy.sh`):**
```bash
set -euo pipefail
sops -d --output-type dotenv secrets/staging.enc.yaml > .env && chmod 600 .env
docker compose -f deploy/compose.staging.yml pull
# migrate-before-swap: a non-zero exit ABORTS the script before `up -d` (set -e)
docker compose -f deploy/compose.staging.yml run --rm migrate
docker compose -f deploy/compose.staging.yml up -d web panel worker
```
Migrations are run, never `push` (CLAUDE.md). The owner role is the staging Postgres container's
`POSTGRES_USER` (superuser of that internal instance) so the `CREATE ROLE` statements in `0001_rls.sql`
succeed.

### Pattern 4: CRITICAL — staging app/anon role passwords (repo-discovered, NOT in CONTEXT)

`packages/db/migrations/0001_rls.sql` sets the `app_authenticated`/`anon` passwords to `'dev'` **only when**
`current_setting('imbau.env', true) <> 'production'`. Consequences the planner MUST handle:

- **CI:** `imbau.env` is unset ⇒ migrate sets `:dev` passwords automatically ⇒ the harness's
  `DATABASE_APP_URL`/`DATABASE_ANON_URL` (`…:dev@…`) authenticate with no extra setup. **Free.**
- **Staging:** the box is a real prod machine. Recommended: set the GUC `imbau.env='production'` on the
  staging Postgres (e.g. `command: postgres -c imbau.env=production`, or `ALTER SYSTEM`/`ALTER DATABASE …
  SET imbau.env='production'`) so the dev password block is **skipped**, then **provision the real
  app/anon passwords out-of-band** from SOPS — e.g. a one-time/idempotent bootstrap SQL run as owner:
  `ALTER ROLE app_authenticated PASSWORD '${APP_DB_PASSWORD}'; ALTER ROLE anon PASSWORD '${ANON_DB_PASSWORD}';`
  Then `DATABASE_APP_URL`/`DATABASE_ANON_URL` in the decrypted `.env` use those real passwords.
- If skipped, the app/anon pools cannot connect on staging (scram-sha-256 requires a credential) — the
  apps boot-fail. This is a guaranteed deploy break if missed.

### Pattern 5: Sentry for Next 16 App Router (OBS-01)

```ts
// apps/{web,panel}/instrumentation.ts
import * as Sentry from "@sentry/nextjs";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge")   await import("./sentry.edge.config");
}
// Captures Server Component / route-handler / middleware errors incl. RSC (needs SDK ≥8.28, Next ≥15).
export const onRequestError = Sentry.captureRequestError;
```
```ts
// apps/{web,panel}/instrumentation-client.ts  (Next ≥15.3 moved client init here from sentry.client.config.ts)
import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_APP_ENV });
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```
```ts
// sentry.server.config.ts / sentry.edge.config.ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NEXT_PUBLIC_APP_ENV });
```
```ts
// next.config.ts — wrap the existing config (keep output:'standalone', transpilePackages, turbopack root)
import { withSentryConfig } from "@sentry/nextjs";
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,   // source-map upload in CI (optional, recommended)
  silent: !process.env.CI, widenClientFileUpload: true,
});
```
```ts
// apps/worker — @sentry/node BEFORE other imports (instrument.ts imported first)
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
```
**Preset:** add `sentryEnv` to `packages/config/env/presets.ts` — `SENTRY_DSN` (optional),
`NEXT_PUBLIC_SENTRY_DSN` (optional), `SENTRY_ENVIRONMENT`/reuse `NEXT_PUBLIC_APP_ENV`. Build-time vars
(`SENTRY_ORG/PROJECT/AUTH_TOKEN`) belong to CI, not the runtime env schema. Add the Sentry build vars to
`turbo.json` `passThroughEnv` if source-map upload runs inside `turbo build`.
**Per-app vs single project:** recommend 3 Sentry projects (imbau-web/panel/worker) → 3 DSNs for clean
issue separation; single-project + environment tag is an acceptable simpler fallback.

### Pattern 6: pino → Loki (OBS-02, recommended path)

```ts
// shared logger (e.g. packages/observability/logger.ts) used by all 3 apps
import { pino } from "pino";
export const logger = pino(
  process.env.LOKI_URL
    ? { transport: { target: "pino-loki", options: {
          host: process.env.LOKI_URL,                 // internal http://loki:3100  OR Grafana Cloud URL
          basicAuth: process.env.LOKI_BASIC_AUTH ? JSON.parse(process.env.LOKI_BASIC_AUTH) : undefined,
          labels: { app: process.env.APP_NAME, env: process.env.NODE_ENV },
          batching: true, interval: 5,
      } } }
    : undefined,  // dev: plain stdout JSON (pino-pretty optional)
);
```
**Why this serves D-04:** the SAME transport points at the local Loki container (self-hosted) OR Grafana
Cloud's Loki push endpoint (fallback, ~0 local RAM) by swapping `LOKI_URL` + `LOKI_BASIC_AUTH` — no
Promtail/Alloy reconfig. The worker should replace its current `console.log(JSON.stringify(...))` calls
with this logger.

**Loki single-binary config (`deploy/loki/loki-config.yml`) — filesystem, RAM-trimmed:**
```yaml
auth_enabled: false
server: { http_listen_port: 3100 }
common:
  ring: { kvstore: { store: inmemory } }
  replication_factor: 1
  path_prefix: /loki
schema_config:
  configs:
    - { from: 2024-01-01, store: tsdb, object_store: filesystem, schema: v13, index: { prefix: index_, period: 24h } }
storage_config:
  filesystem: { directory: /loki/chunks }
limits_config:
  retention_period: 168h            # 7 days — tight box
  ingestion_rate_mb: 4
  ingestion_burst_size_mb: 8
compactor:
  retention_enabled: true
  working_directory: /loki/compactor
  delete_request_store: filesystem
```
Footprint: Loki ~256 MB, Grafana ~256 MB, Uptime Kuma ~128 MB, pino-loki ~0 (in-app). Total
~640 MB → fits with headroom in ~4.9 GiB shared with prod. (If Promtail is used instead of pino-loki,
add ~64 MB.) [CITED: grafana.com/docs/loki — Promtail ~50 MB, Loki 256–512 MB on small docker stacks]

### Pattern 7: CI workflow — Postgres service + RLS harness (CI-01/02/D-08)

```yaml
# .github/workflows/ci.yml
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: imbau_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d imbau_test" --health-interval 5s
          --health-timeout 3s --health-retries 10
    env:
      # owner/superuser runs migrate + CREATE ROLE; harness then sets app/anon :dev passwords (imbau.env unset).
      TEST_DATABASE_URL:      postgres://postgres:postgres@localhost:5432/imbau_test
      TEST_DATABASE_APP_URL:  postgres://app_authenticated:dev@localhost:5432/imbau_test
      TEST_DATABASE_ANON_URL: postgres://anon:dev@localhost:5432/imbau_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4         # reads packageManager pnpm@11.6.0
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtinth/setup-github-actions-caching-for-turbo@v1   # Turbo cache via GH Actions cache
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test    # harness globalSetup migrates + role-guards vs the service
```
**Why this works out of the box:** the harness `setup.ts` runs `migrate()` (creating `app_authenticated`/
`anon`), and because `imbau.env` is unset in the CI Postgres, `0001_rls.sql` sets their `:dev` passwords —
exactly the credentials in `TEST_DATABASE_APP_URL`/`ANON_URL`. The harness's `requireTestDb` guard
demands a `_test` DB name (`imbau_test` satisfies it) and the role-guard asserts `rolbypassrls=false` /
`rolsuper=false`, so RLS cannot silently pass. No testcontainers, no divergence from fase 2 (D-08).
**Branch protection:** mark `quality` a required status check on `main` so red CI blocks merge (CI-01).

### Pattern 8: GHCR build+push with two distinct caches (CI-03/D-05)

```yaml
# .github/workflows/deploy-staging.yml (build job)
permissions: { contents: read, packages: write }   # packages:write for GHCR
strategy: { matrix: { app: [web, panel, worker] } }
steps:
  - uses: actions/checkout@v4
  - uses: docker/setup-buildx-action@v3
  - uses: docker/login-action@v3
    with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
  - uses: docker/metadata-action@v5
    with: { images: ghcr.io/${{ github.repository_owner }}/imbau-${{ matrix.app }},
            tags: "type=sha\ntype=raw,value=latest,enable={{is_default_branch}}" }
  - uses: docker/build-push-action@v6
    with:
      context: .
      file: apps/${{ matrix.app }}/Dockerfile
      push: true
      tags: ${{ steps.meta.outputs.tags }}
      cache-from: type=gha,scope=${{ matrix.app }}
      cache-to:   type=gha,mode=max,scope=${{ matrix.app }}
```
**Two distinct caches (clarified):**
1. **Turbo task cache** (`type=gha` via `dtinth/setup-github-actions-caching-for-turbo`) — accelerates the
   `quality` job's `turbo run lint typecheck test` by reusing task outputs across runs.
2. **Docker layer cache** (`cache-from/to: type=gha` on build-push-action) — caches the image build's
   install/build layers across runs. `scope=<app>` keeps the 3 apps' caches separate.
   These are independent; the `turbo build` that runs *inside* the Dockerfile is covered by the Docker
   layer cache, not the host Turbo cache.

### Pattern 9: SSH deploy (INFRA-02/D-06)
```yaml
  - uses: appleboy/ssh-action@v1
    with:
      host: 31.97.175.128
      username: root
      key: ${{ secrets.VPS_SSH_KEY }}        # id_vps_andescode
      script: cd /opt/imbau && IMAGE_TAG=${{ github.sha }} bash deploy/deploy.sh
```
On the VPS, `docker login ghcr.io` must already be done with a **PAT `read:packages`** (recommended over
public images) so `docker compose pull` can fetch private images. Store the PAT in the VPS root's docker
config (one-time setup) or pass it via the decrypted `.env`.

### Anti-Patterns to Avoid
- **`certbot --nginx`** on the shared box — it edits the running nginx config and can disturb prod
  vhosts. Use `certonly --webroot`.
- **Publishing Postgres/Redis to the host** (`5432:5432`) — collides with the host's own pg/redis and
  violates D-02. Internal network only.
- **Bare `8090:3000`** in compose — publishes on all interfaces. Always `127.0.0.1:8090:3000`.
- **`drizzle-kit migrate` in a runtime image** — drizzle-kit is a devDep; use the drizzle-orm migrator.
- **Floating `@sentry/*` on `latest`** — daily releases; pin an exact version.
- **`pino-pretty` in the staging transport** — dev-only; staging emits raw JSON to Loki.
- **Running CI/staging app queries as the Postgres superuser** — RLS silently passes; always use the
  unprivileged `app_authenticated`/`anon` roles (the harness role-guard enforces this).
- **Assuming the migration sets staging app/anon passwords** — it does NOT in production mode (Pattern 4).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret encryption in repo | Custom encrypt script / base64 | SOPS + age | Field-level encryption, key rotation, `.sops.yaml` rules (D-09) |
| Log shipping to Loki | Custom HTTP pusher | pino-loki transport (or Promtail/Alloy) | Batching, retries, label handling |
| RSC error capture | try/catch in every server fn | `onRequestError = Sentry.captureRequestError` | Official Next hook captures RSC/middleware/route errors |
| Docker build caching | Manual layer scripts | buildx `type=gha` | Native GH Actions cache backend |
| Turbo CI caching | Custom cache upload | `setup-github-actions-caching-for-turbo` | Wires TURBO_API/TOKEN to GH cache, no Vercel |
| Migration runner image | Bash psql loop | drizzle-orm programmatic migrator | Same journal + checksums as the harness; no drift |
| TLS cert renewal | cron + openssl | certbot.timer + deploy-hook | Auto-renews all certs, reloads nginx |
| Uptime checks | Custom curl cron | Uptime Kuma | UI, history, notifications (OBS-03) |

**Key insight:** every piece here has a battle-tested tool; the engineering is in *wiring them to a
shared prod box without disturbing it* (internal networks, loopback binds, webroot certs, mem_limits),
not in building anything new.

## Runtime State Inventory

> This phase is greenfield infra authoring, but it INTRODUCES runtime state on the VPS. Documented so the
> planner accounts for it.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Staging Postgres (named volume `pgdata`), Loki chunks (`lokidata`), Grafana (`grafanadata`), Uptime Kuma SQLite (`kumadata`) | Named volumes in compose; ephemeral/reconstructible — backups deferred (FOUND-01) |
| Live service config | Host nginx new vhost; certbot cert + renewal hook; VPS `docker login ghcr.io` (PAT); `~/.config/sops/age/keys.txt` | One-time VPS bootstrap tasks; documented in deploy runbook |
| OS-registered state | certbot.timer (already present — renews the new cert too); no new systemd units required (compose-managed) | Verify certbot.timer active; add nginx reload deploy-hook |
| Secrets/env vars | New: `POSTGRES_PASSWORD`, `DATABASE_*_URL` (incl. real app/anon pw), `BETTER_AUTH_SECRET/URL`, `RESEND_API_KEY`, `INVITE_FROM`, `SENTRY_DSN`×3, `NEXT_PUBLIC_SENTRY_DSN`, `LOKI_URL`/`LOKI_BASIC_AUTH`, `REDIS_URL`; Actions: `VPS_SSH_KEY`, `SOPS_AGE_KEY`, `SENTRY_AUTH_TOKEN`, GHCR PAT | Encrypt in `secrets/staging.enc.yaml`; load Actions secrets + VPS keyfile (Pattern 4 is load-bearing) |
| Build artifacts | GHCR images `imbau-{web,panel,worker,migrate}:<sha>,:latest` | Tag by SHA; `latest` on main; consider a retention policy later |

## Common Pitfalls

### Pitfall 1: Staging app/anon roles have no password in production mode
**What goes wrong:** apps boot-fail with auth errors on staging; CI passes (masking it).
**Why:** `0001_rls.sql` only sets `:dev` passwords when `imbau.env <> 'production'`.
**How to avoid:** set `imbau.env='production'` on staging PG AND provision real app/anon passwords from
SOPS (Pattern 4). Verify the app pool connects post-deploy.
**Warning signs:** `password authentication failed for user "app_authenticated"` in container logs.

### Pitfall 2: Disturbing prod nginx / ports
**What goes wrong:** prod sites (chatwoot/n8n/waha) go down.
**Why:** `certbot --nginx`, editing existing vhosts, or publishing container ports onto taken host ports.
**How to avoid:** `certonly --webroot`; only ADD a vhost file; internal docker network; loopback binds on
free ports (8090/8091). Run `nginx -t` before every reload.
**Warning signs:** `nginx -t` errors; `ss -ltnp` shows a container on an occupied host port.

### Pitfall 3: RAM exhaustion takes down prod
**What goes wrong:** OOM killer reaps a prod container.
**Why:** observability stack brought up all at once with no limits on a ~4.9 GiB shared box.
**How to avoid:** D-04 — per-container `mem_limit`, staged `profiles` bring-up, `free -m` before/after,
documented Grafana Cloud fallback (swap `LOKI_URL`).
**Warning signs:** `free -m` available < ~1 GiB; `dmesg | grep -i oom`.

### Pitfall 4: GH Actions cache v1 shutdown / cache backend mismatch
**What goes wrong:** `type=gha` cache silently no-ops or errors.
**Why:** the legacy cache service API v1 was shut down (Apr 2025); only v2 is supported.
**How to avoid:** use current `docker/build-push-action` (v6/v7) + `setup-buildx-action` (v3/v4) which
target v2. [CITED: docs.docker.com/build/cache/backends/gha]
**Warning signs:** `cache export` warnings; build times not improving.

### Pitfall 5: RLS test passes for the wrong reason in CI
**What goes wrong:** isolation "passes" because tests ran as superuser.
**Why:** pointing the app/anon URLs at the `postgres` superuser.
**How to avoid:** distinct `TEST_DATABASE_APP_URL`/`ANON_URL` as `app_authenticated`/`anon`; the harness
role-guard already asserts `rolbypassrls=false`/`rolsuper=false` and fails loudly otherwise.
**Warning signs:** role-guard error in globalSetup, or absence tests green with wrong `current_user`.

## Code Examples

(Primary copy-pasteable snippets are inline in Patterns 1–9 above, each tagged with its source.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `sentry.client.config.ts` | `instrumentation-client.ts` (+ `onRouterTransitionStart`) | Next 15.3 / Sentry SDK 8.x→9/10 | Use the new client file for web/panel |
| Promtail | Grafana **Alloy** (Promtail feature-frozen, EOL track) | 2025–2026 | If a scraper is wanted, prefer Alloy; or skip both via pino-loki |
| GH cache API v1 | API v2 only | Apr 2025 | Must use current docker actions for `type=gha` |
| `_app`/`pages` Sentry init | App Router `register()` + `captureRequestError` | Next 13+/SDK 8.28+ | Required for RSC error capture (OBS-01) |
| Traefik + ACME (CLAUDE.md) | Host nginx + certbot (this phase) | D-01 (real blocker) | Traefik pattern deferred to a future box |

**Deprecated/outdated for this phase:** `sentry.client.config.ts` (use instrumentation-client.ts);
Promtail (prefer pino-loki transport, or Alloy if scraping); drizzle-kit inside runtime images.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | sops ~3.13.0 / age ~1.3.1 are current | Standard Stack | Low — pin the actual latest at install; API stable |
| A2 | Image tags grafana/loki:3.5, grafana/grafana:11.6, uptime-kuma:1 are current/valid | Container images | Low/Med — verify tags; config keys may shift between Loki minors |
| A3 | GH action majors (login@v3/4, buildx@v3/4, metadata@v5/6, build-push@v6/7) current | Standard Stack | Low — verify majors; YAML inputs stable across recent majors |
| A4 | DNS will be `staging.tours…` + `panel.staging.tours…` (two subdomains) | Pattern 1 | Med — if user wants path-based or different host, vhost/cert/`BETTER_AUTH_URL` change. User decision. |
| A5 | Staging runs ImBau's OWN internal Postgres/Redis (not the host's) | Pattern 2 | Med — D-02 implies this; if user wants to reuse host PG, the migrate/owner story changes |
| A6 | Loopback ports 8090/8091 are free on the VPS | Pattern 1/2 | Low — verify `ss -ltn` before binding; trivially changed |
| A7 | pino-loki transport preferred over Promtail (D-03 names Promtail) | Pattern 6 | Med — a refinement of D-03; needs planner/user confirm (see Open Questions) |
| A8 | 3 Sentry projects/DSNs vs 1 | Pattern 5 | Low — cosmetic; either works |
| A9 | VPS pulls via PAT `read:packages` (private images) | Pattern 9 | Low — recommended over public; user provides the PAT |

## Open Questions

1. **pino-loki transport vs Promtail (D-03 wording).**
   - What we know: D-03 lists Promtail; pino-loki is RAM-optimal and symmetric with the Grafana Cloud
     fallback (D-04), removing a container.
   - What's unclear: whether the user wants the decoupled docker-stdout-scraping model (captures non-pino
     output too) enough to keep a scraper.
   - Recommendation: use pino-loki as primary; offer Promtail/Alloy as a documented alternative. Surface
     for confirmation in planning (it refines, not contradicts, D-03's intent of "pino → Loki").

2. **Postgres backups in scope?**
   - What we know: FOUND-01 ("backups pgBackRest/wal-g") is explicitly *deferred foundation*; staging DB
     is ImBau-owned, ephemeral, reconstructible from migrations (+future seed).
   - Recommendation: **DEFER**. Use a named volume so restarts persist; no pgBackRest/wal-g this phase.

3. **Edge rate-limit for events/leads.**
   - What we know: those tables are a future milestone; the mechanism (nginx `limit_req`) exists.
   - Recommendation: **DEFER** the actual rule; note the nginx mechanism for when the tables land.

4. **Grafana/Uptime-Kuma public exposure.**
   - Recommendation: do NOT expose publicly in phase 4; access via SSH tunnel (least attack surface).
     Optional password-protected vhost is a later nicety.

5. **One SAN cert vs two certs.**
   - Recommendation: one SAN cert (`-d staging… -d panel.staging…`) — fewer renewals, one cert path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + Compose (VPS) | staging runtime | ✓ (recon) | Docker 29 / compose v2.40 | — |
| host nginx (VPS) | TLS/proxy (D-01) | ✓ owns :80/:443 | — | — |
| certbot (VPS) | cert issuance | ? verify (likely present w/ certbot.timer) | — | snap/apt install |
| sops + age (VPS + CI) | secret decrypt | ✗ likely not installed | — | install from release/apt (no fallback — required) |
| GHCR | image registry | ✓ (GitHub) | — | — |
| Local Docker daemon (dev) | image build | ✗ (none locally) | — | builds happen in CI only (per fase 3) |
| DNS A record `staging.tours…`/`panel.…` | certbot HTTP-01 | ✗ user must create | — | none — blocks real cert/deploy verification |
| age keypair + secret values | SOPS/runtime | ✗ user must provide | — | none — blocks deploy |

**Missing dependencies with no fallback (block real-deploy verification, not authoring):** DNS A
record(s), age keypair + secret values, VPS SSH key + GHCR PAT, sops/age binaries on VPS+CI.
**Missing with fallback:** local Docker (use CI); certbot (install if absent).

## Validation Architecture

This is an infra phase: most "tests" are **operational verifications**. Split into (A) automatable in
CI/locally vs (B) gated on the real VPS + user prerequisites.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (unit/integration) + the fase-2 RLS harness; operational checks via shell/curl |
| Config file | `vitest.config.ts` (root); harness `packages/db/tests/setup.ts` |
| Quick run command | `pnpm turbo run lint typecheck test` |
| Full suite command | same (Turbo orchestrates all packages) |

### Phase Requirements → Verification Map
| Req ID | Behavior | Type | Verification (command/observable) | Where |
|--------|----------|------|-----------------------------------|-------|
| CI-01 | PR runs lint+typecheck+test; red blocks merge | automated | CI run on a PR shows the `quality` check; merge blocked when red (branch protection) | CI |
| CI-02 | RLS isolation vs real Postgres service | automated | `quality` job green with the Postgres service; harness role-guard + absence tests pass | CI |
| CI-03 | 3 images built w/ Turbo cache + pushed | automated | deploy workflow run shows 3 GHCR packages tagged `<sha>`+`latest`; cache hit on rerun | CI |
| INFRA-01 | Compose behind TLS proxy at staging | operational (B) | `curl -I https://staging.tours.andescode.com.ar` → 200 + valid cert; `curl -I https://panel.staging…` → 200; `docker compose ps` all healthy | VPS |
| INFRA-02 | merge → auto-deploy, migrate-before-swap | operational (B) | merge to main triggers deploy; forced bad migration ⇒ deploy aborts, old containers stay up (no swap) | VPS+CI |
| INFRA-03 | secrets encrypted, no plaintext | automated (A) | `git grep`/scan finds no plaintext secrets; `sops -d` round-trips; `.env` gitignored | CI/local |
| OBS-01 | errors reach Sentry incl. RSC | operational (B) | trigger a test error in web/panel/worker → appears in Sentry with stack + RSC context | VPS |
| OBS-02 | pino logs reach Loki | operational (B) | LogQL query in Grafana (`{app="panel"}`) returns recent pino lines | VPS |
| OBS-03 | Uptime Kuma monitors services | operational (B) | Uptime Kuma shows green monitors for the staging endpoints | VPS |

### Sampling Rate
- **Per task commit:** `pnpm turbo run lint typecheck test`
- **Per wave merge:** full suite + (for infra waves) the relevant operational check
- **Phase gate:** CI green on a PR; one real merge-to-main deploy verified end-to-end on the VPS
  (200 over TLS, Sentry test error, Loki log line, Kuma green, `free -m` headroom, forced-migration-fail
  aborts swap)

### Wave 0 Gaps
- [ ] `.github/workflows/ci.yml` — PR gate (lint/typecheck/test + Postgres service) [CI-01/02]
- [ ] `.github/workflows/deploy-staging.yml` — build+push+deploy [CI-03/INFRA-02]
- [ ] `packages/db/migrate.ts` + `deploy/migrate.Dockerfile` — migrate-before-swap runner [INFRA-02/D-07]
- [ ] `deploy/compose.staging.yml`, `deploy/nginx/*.conf`, `deploy/loki/loki-config.yml`, `deploy/deploy.sh`
- [ ] `secrets/.sops.yaml` + `secrets/staging.enc.yaml`; `.env` added to `.gitignore`
- [ ] `packages/config/env/presets.ts` — `sentryEnv` + `lokiEnv` presets
- [ ] Sentry files in web/panel (`instrumentation.ts`, `instrumentation-client.ts`, server/edge config,
      `withSentryConfig`) + worker (`@sentry/node` init); pino logger wired in all 3 apps
- [ ] Branch protection: require the `quality` check on `main`

## Security Domain

> `security_enforcement` not explicitly false in config → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Least-privilege roles (app/anon NOSUPERUSER NOBYPASSRLS — fase 2); internal-only DB/Redis |
| V2 Authentication | partial | Better Auth (fase 3); staging DB role credentials from SOPS, not plaintext |
| V6 Cryptography / Secrets | yes | SOPS+age field encryption; TLS via certbot; `.env` chmod 600, gitignored |
| V7 Error handling / Logging | yes | pino structured logs → Loki; Sentry; never log secret values (existing harness convention V7) |
| V9 Communications | yes | TLS termination at nginx; HTTPS-only public origins; internal network for backends |
| V14 Configuration | yes | Pinned versions; no superuser at runtime; mem_limits; non-root containers (fase-3 `USER node`) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leak via repo plaintext | Information Disclosure | SOPS+age; gitignore `.env`; scan in CI (INFRA-03) |
| Tenant leak via RLS bypass in CI | Information Disclosure | unprivileged test roles + harness role-guard (CI-02) |
| Disturbing prod / DoS the shared box | Denial of Service | mem_limits, staged bring-up, webroot certs, loopback binds (D-02/D-04) |
| Exposed admin UIs (Grafana/Kuma) | Elevation/Info Disclosure | not public; SSH tunnel; Grafana anon auth off |
| Stolen GHCR/SSH/age secret | Spoofing/Tampering | Actions secrets + VPS keyfile; PAT scoped `read:packages`; rotate age key if leaked |
| Supply-chain (slopsquat) | Tampering | pinned exact versions; legitimacy audit; Sentry SUS = false positive (pin, don't float) |

## Sources

### Primary (HIGH confidence)
- Repo inspection (2026-06-25): `compose.yml`, `apps/*/Dockerfile`, `apps/panel/next.config.ts`,
  `packages/config/env/presets.ts`, `packages/db/drizzle.config.ts`,
  `packages/db/migrations/0001_rls.sql` (password-gating finding), `packages/db/tests/{db,setup,helpers}.ts`,
  `packages/db/tests/cross-tenant.test.ts`, `apps/worker/src/index.ts`, `turbo.json`,
  `pnpm-workspace.yaml`, `package.json` — exact integration points & versions
- npm registry (`npm view`, 2026-06-25): `@sentry/nextjs` 10.61.0, `@sentry/node` 10.61.0, `pino` 10.3.1,
  `pino-loki` 3.0.0, `pino-pretty` 13.1.3
- gsd-tools package-legitimacy (2026-06-25): pino/pino-loki/pino-pretty OK; @sentry/* SUS=too-new (false positive)
- CLAUDE.md "Technology Stack" + "Architecture-adjacent configuration notes" — pinned matrix
- CONTEXT.md (D-01..D-09), REQUIREMENTS.md, ROADMAP.md, 02/03-CONTEXT.md

### Secondary (MEDIUM confidence)
- Sentry docs (via WebSearch): `instrumentation.ts` + `onRequestError = captureRequestError`, Next 15+/SDK
  8.28+ — https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
- Docker docs: GH Actions cache `type=gha`, v1 shutdown — https://docs.docker.com/build/cache/backends/gha/
- Turborepo CI docs + `dtinth/setup-github-actions-caching-for-turbo` — turbo cache via GH cache
- Grafana Loki docs/community: Loki single-binary sizing, Promtail ~50 MB / Loki 256–512 MB —
  https://grafana.com/docs/loki/latest/setup/size/
- SOPS/age (getsops, FiloSottile/age): `.sops.yaml` creation_rules, `SOPS_AGE_KEY`/`SOPS_AGE_KEY_FILE`

### Tertiary (LOW confidence — verify at plan time)
- Exact current versions of sops (3.13.0) / age (1.3.1) and container image tags (WebSearch only)
- Exact current majors of docker/* and ssh GitHub Actions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (npm-verified) — except sops/age/image-tag/action majors (MEDIUM, verify)
- Architecture / integration: HIGH — grounded in actual repo files (Dockerfiles, harness, migration, presets)
- CI wiring: HIGH — the harness's existing env-parametrization + role-guard make the Postgres-service path exact
- Staging role-password finding (Pattern 4): HIGH — read directly from `0001_rls.sql`
- Observability RAM figures: MEDIUM — community/docs estimates; D-04 mandates `free -m` verification
- Sentry Next-16 specifics: MEDIUM — docs say Next 15+; Next 16 App Router uses the same hooks

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 for npm versions; image tags / action majors drift faster — re-verify in ~2 weeks
</content>
</invoke>
