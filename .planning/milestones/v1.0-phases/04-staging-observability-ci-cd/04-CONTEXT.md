# Phase 4: Staging, Observability & CI/CD - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Cierra la fundación operable: cada merge a `main` termina en software corriendo en
`staging.tours.andescode.com.ar`, observable y con el aislamiento de tenant verificado
automáticamente. Cubre INFRA-01/02/03 (Compose en el VPS detrás de proxy con TLS,
auto-deploy build→registry→VPS con migrate-before-swap, secrets cifrados en repo),
CI-01/02/03 (lint+typecheck+test en cada PR con Postgres service real para los tests RLS,
build+push de las 3 imágenes con cache de Turborepo) y OBS-01/02/03 (Sentry con contexto
incl. `onRequestError` para RSC, pino→Loki, Uptime Kuma).

**Fuera de esta fase:** lógica de jobs del worker (BullMQ solo conecta a Redis desde fase 3),
schema de dominio / media / seed (milestones futuros), prod real (esta fase entrega *staging*;
prod queda como `workflow_dispatch` manual sobre el mismo pipeline).

**Realidad del entorno (load-bearing):** el VPS de staging es `andescode.com.ar`
(31.97.175.128, Ubuntu 24.04, SSH `root@` con `~/.ssh/id_vps_andescode`). Es un **box de
producción en vivo** (chatwoot, n8n, waha, 2x Postgres) con **nginx host dueño de :80/:443**,
~4.9Gi RAM disponibles compartidos con prod, y puertos tomados: 80,443,22,3000,3001,5432,5680,6379,5433.
Docker 29 + compose v2.40. **Nunca tocar servicios existentes; solo AGREGAR.**

</domain>

<decisions>
## Implementation Decisions

### Proxy & TLS en el VPS
- **D-01:** **Dropear Traefik en staging; integrar con el nginx host.** Se agrega UN server
  block nuevo al nginx del host para `staging.tours.andescode.com.ar`, con cert **certbot
  (HTTP-01)**, reverse-proxy a los contenedores `panel` y `web` en **puertos loopback**
  (`127.0.0.1:PUERTO`). Solo se AGREGAN vhosts/certs; jamás se editan los existentes.
  Desviación de stack justificada por "bloqueo real" (CLAUDE.md permite salvo bloqueo): Traefik
  en 80/443 rompería los sitios de prod. El patrón Traefik+ACME del CLAUDE.md queda diferido a
  una eventual migración de box / prod dedicada.
- **D-02:** Los contenedores ImBau **no publican** Postgres/Redis al host (el host ya tiene
  pg en :5432 y redis en :6379) — viven en una **red docker interna** del proyecto compose ImBau.
  Solo `panel` y `web` exponen a loopback para que nginx les haga proxy. Elegir puertos loopback
  altos fuera del set tomado (ej. 8082/8083; el planner fija los valores).

### Observabilidad
- **D-03:** **Stack completo self-hosted** (Loki + Grafana + Promtail + Uptime Kuma) en el
  Compose de staging, como describe CLAUDE.md, más Sentry cloud (free) para errores y
  `onRequestError` (RSC). Sentry separado para el worker.
- **D-04 (mitigación obligatoria de RAM):** dado el box ajustado compartido con prod, el plan
  DEBE: (a) fijar `mem_limit`/`deploy.resources.limits` por contenedor de observabilidad;
  (b) traer la observabilidad **escalonada / con `profiles`** para no levantar todo de golpe;
  (c) verificar RAM con `free -m` antes/después y dejar headroom para prod; (d) documentar un
  **fallback a Grafana Cloud free** (push pino→Loki afuera, ~0 RAM local) si el self-hosted
  agota memoria. Esta es la mayor fuente de riesgo de la fase.

### Registry & deploy
- **D-05:** **GHCR** (GitHub Container Registry, privado/gratis, integra nativo con Actions).
  Cada merge a `main` buildea+pushea las 3 imágenes (web/panel/worker) con **cache de Turborepo**
  (`type=gha`) y tags por SHA + `latest`. El push desde Actions usa el `GITHUB_TOKEN` built-in.
- **D-06:** **Deploy por SSH** desde Actions: `root@` con `id_vps_andescode` (key como secret de
  Actions) → `docker compose pull && up -d` en el proyecto compose de ImBau en el VPS. El **pull
  desde el VPS** necesita un PAT read:packages (o imágenes públicas) — el planner decide y lo
  documenta como secret del VPS.
- **D-07:** **Migrate-before-swap:** las migraciones Drizzle corren en un **contenedor one-off**
  (`docker compose run --rm migrate` o equivalente) contra la DB de staging **antes** de swapear
  los contenedores de app. Si la migración falla, el deploy aborta sin swap.

### CI
- **D-08:** GitHub Actions: en **cada PR** corre `lint + typecheck + test`; CI roja bloquea merge
  (CI-01). Los **tests de aislamiento RLS** corren contra un **Postgres service** de Actions
  reusando el harness parametrizable por endpoint de fase 2 (02-CONTEXT D-07) — misma config,
  mismos tests, sin testcontainers (CI-02). Restaurar cache de Turborepo antes de
  `turbo run lint typecheck test`.

### Secrets
- **D-09:** **SOPS + age.** Archivos `.enc.yaml` cifrados versionados en el repo, separados por
  entorno (staging; prod futura). La **age key privada** vive como secret de Actions **y** en
  `~/.config/sops/age/keys.txt` del VPS; el deploy desencripta a un `.env` runtime. Cumple
  INFRA-03 literal (nada sensible en texto plano en el repo). Valores reales a proveer por el
  usuario: password de la DB de staging ImBau, Sentry DSN(s), `RESEND_API_KEY`, y la SSH deploy key.

### Claude's Discretion
- Valores concretos de puertos loopback, nombres de servicios/red en el Compose de staging,
  estructura exacta de los workflows YAML, layout de archivos SOPS, y mecánica fina del cache
  de Turborepo en Actions — los fija research/planner siguiendo estas decisiones.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plan de fase y requirements
- `.planning/ROADMAP.md` — Phase 4: goal + 4 success criteria (Compose detrás de proxy con TLS;
  CI con Postgres real; deploy con migrate-before-swap; Sentry/pino→Loki/Uptime Kuma).
- `.planning/REQUIREMENTS.md` — texto literal de INFRA-01/02/03, CI-01/02/03, OBS-01/02/03.

### Stack y notas de arquitectura (con desviaciones de esta fase)
- `CLAUDE.md` §"Architecture-adjacent configuration notes (phase 0)" — Dockerfile multi-stage
  prune→build→standalone-runner, cache de Turborepo (`type=gha`), deploy SSH `compose pull && up -d`,
  auto-staging-on-merge / manual-prod. **NOTA:** la parte Traefik/ACME HTTP-01 queda SUPERSEDED
  por D-01 (nginx host + certbot) por bloqueo real del box.
- `CLAUDE.md` §"Stack" — observabilidad (Sentry+OTel, Grafana/Loki, Uptime Kuma), infra (Compose,
  GitHub Actions), backups Postgres (pgBackRest/wal-g — evaluar si entra acá o se difiere).
- `docs/modelo-mvp.md` §3.3 — rate-limit en el edge para inserts anónimos (events/leads): hoy lo
  preveía Traefik; con D-01 el rate-limit pasa a configurarse en el vhost nginx (o se difiere con
  esas tablas, que son de milestone futuro — confirmar en research).

### Decisiones de fases previas que esta fase consume
- `.planning/phases/03-auth-api-app-surfaces/03-CONTEXT.md` — Dockerfiles autorados (web/panel/worker)
  cuyo build se verifica acá en CI; presets de env (falta agregar preset Sentry); worker shell que
  esta fase instrumenta con Sentry/pino/OTel; fix `turbo.json passThroughEnv [SKIP_ENV_VALIDATION,
  NEXT_PUBLIC_APP_ENV]`.
- `.planning/phases/02-data-layer-rls/02-CONTEXT.md` §D-07 — harness de tests RLS parametrizable por
  endpoint/env: CI lo apunta al Postgres service de Actions sin divergir.

### Entorno (hechos de recon, no hay doc en repo)
- VPS staging: `andescode.com.ar` / 31.97.175.128, Ubuntu 24.04, `root@` + `~/.ssh/id_vps_andescode`.
  nginx host dueño de 80/443; puertos tomados 80,443,22,3000,3001,5432,5680,6379,5433; ~4.9Gi RAM
  disponibles; Docker 29 + compose v2.40. **Box de prod en vivo — solo agregar, nunca tocar.**

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Dockerfiles multi-stage por app** (fase 3, web/panel/worker): patrón `turbo prune --docker` →
  install/build → runner slim Node 22 Alpine (Next standalone para web/panel; output tsup para worker).
  CI los buildea/pushea sin re-autoría.
- **Harness de tests de aislamiento RLS** (fase 2): parametrizable por endpoint → se reapunta al
  Postgres service de Actions (CI-02) tal cual.
- **`docker-compose.yml` local** (Postgres 16, Redis 7): base para el Compose de staging, pero éste
  usa red interna (no publica DB/Redis) y agrega web/panel/worker + observabilidad.
- **`packages/config` env presets** (`dbEnv`, `redisEnv`, auth): esta fase agrega el preset de Sentry
  y las vars de observabilidad/registry/deploy.
- **Logger pino** ya disponible en las apps: esta fase conecta su salida a Loki (Promtail) y agrega
  Sentry (`onRequestError` en web/panel; SDK separado en worker).

### Established Patterns
- Migraciones SOLO vía Drizzle Kit versionado (nunca `push`/manual) → el contenedor migrate del
  deploy corre `drizzle-kit migrate` / runner equivalente.
- Una rama por fase GSD (`fase-0/...`); merges a main por pieza verificada. Cuando esta fase active
  el auto-deploy, los merges siguientes ya disparan staging (01-CONTEXT D-13).

### Integration Points
- nginx host (server block nuevo) → loopback → contenedores `panel`/`web`.
- GitHub Actions → GHCR (push) y → VPS por SSH (deploy + migrate).
- Apps → Sentry cloud + Loki (Promtail) + Uptime Kuma (todo en el Compose de staging).

</code_context>

<specifics>
## Specific Ideas

- El usuario eligió deliberadamente el **stack de observabilidad completo self-hosted** pese al
  riesgo de RAM señalado — por eso D-04 fija mitigaciones obligatorias (límites de memoria,
  bring-up escalonado, monitoreo, fallback a Grafana Cloud documentado) en vez de cambiar la decisión.
- Preferencia consistente con fases previas: cero infra nueva innecesaria, paridad dev↔CI↔staging,
  y desviaciones de stack solo ante bloqueo real (acá: Traefik → nginx host).

</specifics>

<deferred>
## Deferred Ideas

- **Prod real** (dominio prod, deploy manual `workflow_dispatch`): el pipeline se diseña para
  soportarlo pero esta fase solo entrega staging.
- **Patrón Traefik + ACME + dominios-custom-por-CNAME** del CLAUDE.md: diferido hasta un box/edge
  dedicado; en staging lo cubre nginx host + certbot.
- **Rate-limit edge para events/leads** (modelo-mvp §3.3): esas tablas son de milestone futuro; el
  mecanismo (vhost nginx) se decide cuando existan.
- **Backups Postgres (pgBackRest/wal-g a B2/R2)**: research confirma si entra en esta fase o se
  difiere (la DB de staging es efímera/reconstruible desde migraciones+seed).

### Prerequisitos del usuario (bloquean la verificación de deploy real, no la autoría)
- Crear el registro **DNS A** `staging.tours.andescode.com.ar` → 31.97.175.128 (la emisión del cert
  certbot depende de esto).
- Generar el **age keypair** y cargar valores reales de secrets (DB pw staging, Sentry DSN, Resend key).
- Cargar la **SSH deploy key** y el **PAT read:packages** (o hacer las imágenes públicas) como secrets.

</deferred>

---

*Phase: 4-Staging, Observability & CI/CD*
*Context gathered: 2026-06-25*
