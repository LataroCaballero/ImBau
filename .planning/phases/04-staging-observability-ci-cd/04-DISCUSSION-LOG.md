# Phase 4: Staging, Observability & CI/CD - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 4-Staging, Observability & CI/CD
**Areas discussed:** Proxy & TLS, Observabilidad, Registry & deploy, Secrets (SOPS/age)

---

## Proxy & TLS

| Option | Description | Selected |
|--------|-------------|----------|
| nginx vhost + certbot | Dropear Traefik; server block nuevo en nginx host + cert certbot (HTTP-01), proxy a panel/web en loopback. Solo agrega, no toca prod. | ✓ |
| Traefik en puertos altos detrás de nginx | Traefik en contenedor (:8081), nginx host le hace proxy_pass. Más fiel a CLAUDE.md pero doble proxy + más RAM. | |
| Migrar nginx → Traefik en 80/443 | Reemplazar nginx host por Traefik. Máxima fidelidad pero TOCA prod — riesgo alto. | |

**User's choice:** nginx vhost + certbot (recomendado)
**Notes:** El VPS es un box de prod en vivo con nginx host dueño de 80/443. Desviación de stack justificada por "bloqueo real" (CLAUDE.md). Solo se agregan vhosts/certs, nunca se editan los existentes.

---

## Observabilidad

| Option | Description | Selected |
|--------|-------------|----------|
| Grafana Cloud free + Uptime Kuma local | pino→Loki push afuera (~0 RAM local) + Uptime Kuma liviano + Sentry cloud. | |
| Loki+Grafana self-hosted minimal | Loki+Grafana sin Promtail + Uptime Kuma + Sentry cloud. ~0.5–1GB RAM. | |
| Stack completo self-hosted | Loki+Grafana+Promtail+Uptime Kuma como CLAUDE.md, todo local. Mayor RAM. | ✓ |

**User's choice:** Stack completo self-hosted
**Notes:** Elegido deliberadamente pese al riesgo de RAM señalado en la opción. CONTEXT.md D-04 fija mitigaciones obligatorias (límites de memoria por contenedor, bring-up escalonado con profiles, monitoreo con `free -m`, fallback documentado a Grafana Cloud) en vez de cambiar la decisión.

---

## Registry & deploy

| Option | Description | Selected |
|--------|-------------|----------|
| GHCR + SSH pull | Actions buildea+pushea a GHCR (gratis/privado, integra con Actions); deploy SSH root@ → compose pull && up -d; migrate one-off antes del swap. | ✓ |
| Docker Hub + SSH pull | Igual flujo con Docker Hub (free 1 repo privado, límites de pull). | |
| Build en el VPS (sin registry) | Actions SSH → git pull + docker build en VPS. Quema RAM/CPU de prod. | |

**User's choice:** GHCR + SSH pull (recomendado)
**Notes:** Push desde Actions con GITHUB_TOKEN built-in. Pull desde el VPS necesita PAT read:packages o imágenes públicas (planner decide). Migrate-before-swap en contenedor one-off; aborta deploy si falla.

---

## Secrets (SOPS/age)

| Option | Description | Selected |
|--------|-------------|----------|
| SOPS + age, key en VPS + Actions | .enc.yaml en repo; age key como secret de Actions y en ~/.config/sops/age del VPS; deploy desencripta a .env runtime. | ✓ |
| SOPS + age, key solo en VPS | Igual pero CI no desencripta; solo el VPS tiene la key. Menos superficie. | |
| GitHub Secrets + .env en VPS (sin SOPS) | Más simple pero viola INFRA-03 (sin secrets cifrados versionados). | |

**User's choice:** SOPS + age, key en VPS + Actions (recomendado)
**Notes:** Cumple INFRA-03 literal. Separación por entorno (staging/prod futura). Valores reales a proveer por el usuario: DB pw staging, Sentry DSN, Resend key, SSH deploy key.

## Claude's Discretion

- Puertos loopback concretos, nombres de servicios/red del Compose de staging, estructura de los workflows YAML, layout de archivos SOPS, mecánica fina del cache de Turborepo en Actions.

## Deferred Ideas

- Prod real (deploy manual `workflow_dispatch`).
- Patrón Traefik+ACME+dominios-custom-por-CNAME (diferido hasta box/edge dedicado).
- Rate-limit edge para events/leads (tablas de milestone futuro).
- Backups Postgres (pgBackRest/wal-g) — research confirma si entra acá o se difiere.
- Prerequisitos del usuario: DNS A record, age keypair + valores de secrets, SSH deploy key + PAT.
