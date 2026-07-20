---
phase: 08
slug: deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
created: 2026-07-20
---

# Phase 08 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Debt-closure / infra-ops phase: merge v1.2 → `main`, live staging re-verification
> (edge rate-limit, PDF flow, surface smoke), no-op deploy drill, and the
> migrate-before-swap failure drill (T-4-MIGRATE). Most mitigations were exercised
> **live** during the phase-08 UAT (2026-07-17 / 2026-07-20), which is stronger
> evidence than static grep.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| git branch → `main` (CI/CD) | The merge decides exactly what the deploy pipeline builds and ships. | Source code, deploy manifests |
| CI runner → GHCR → VPS | Image supply chain: what is built, tagged, pulled, and swapped. | Container images (SHA-tagged) |
| operator SSH → shared prod VPS | Privileged root access to a box that also hosts live prod (`andescode.com.ar`). | Shell commands, container/log inspection |
| anonymous client → nginx edge → quotes tRPC | Untrusted burst traffic crosses the edge into the anonymous quotes funnel. | Anonymous HTTP POST bursts |
| SOPS-decrypted `deploy/.env` on VPS | Runtime secrets materialized on disk during deploy. | DB/role passwords, R2 creds |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Tampering | merge to `main` / deploy-staging.yml | high | mitigate | `quality` check green + branch protection (`enforce_admins`) gate the merge; no direct push; deploy builds the exact merge SHA. **Verified live:** `origin/main` = `22d1e96`, fase-5 alive post-merge (UAT test 1). | closed |
| T-08-02 | Tampering | GHCR image tag → VPS pull | medium | mitigate | IMAGE_TAG pinned to the exact merge SHA (workflow invariant). **Verified live:** deployed web/worker containers tagged `imbau-web:22d1e96` / `imbau-worker:22d1e96` over SSH. | closed |
| T-08-03 | Elevation of Privilege | SSH `root@` shared prod VPS | high | mitigate | Read-only inspection of imbau compose containers only; never touch prod nginx/host; inspect process identity before any kill (D-08). **Verified live:** all phase-08 SSH was read-only (`docker compose ps`, `psql` read-only, `git rev-parse`); zero prod-nginx writes, zero kills. | closed |
| T-08-04 | Information Disclosure | SOPS-decrypted `deploy/.env` on VPS | medium | mitigate | `deploy.sh` writes the env `chmod 600`; secret values never echoed to logs/evidence. **Verified:** `deploy/deploy.sh:52` `chmod 600 "${ENV_FILE}"`; no secret value appears in any UAT evidence. | closed |
| T-08-05 | Denial of Service | migrate-before-swap on shared box | low | accept | migrate failure aborts under `set -euo pipefail` leaving old images running (safe state, D-07); `free -m` headroom checked. **Drilled live (UAT test 5, 2026-07-20):** injected `SELECT 1/0` migration → migrate exited non-zero → deploy aborted BEFORE swap → staging unchanged, zero downtime. Accepted residual risk empirically proven safe. | closed |
| T-08-06 | Denial of Service | `/api/trpc/quotes*` anonymous funnel | high | mitigate | Edge `quotes` zone (10r/s + burst=20, `limit_req_status 429`) rejects excess with 429 / zero 503; box vhost == repo source of truth. **Verified live (UAT test 1):** 100-POST burst → 77×429, 0×503; box↔repo conf identical (8581 B, `diff` clean). Repo: `deploy/nginx/staging.tours.andescode.com.ar.conf:44,84,85`. | closed |
| T-08-07 | Information Disclosure | generated PDF deep-link / QR | low | accept | Deep-link is a public showroom URL by design; targets the staging host only (D-11); no secrets in the PDF. **Verified (UAT test 2):** deep-link starts `https://staging.tours.andescode.com.ar/...`; pdftotext shows only public quote data. | closed |
| T-08-08 | Spoofing / Tampering | staging host response provenance | low | mitigate | Responses come from `staging.tours.andescode.com.ar` over TLS; vhost intact after the burst. **Verified live (UAT tests 1,3,5):** web 200 / panel 307 post-burst and post-migrate-drill; single-SAN staging cert. | closed |
| T-08-09 | Elevation of Privilege | SSH `root@` shared prod VPS (log reads) | medium | mitigate | Read-only log/container inspection of imbau services; never touch prod nginx/host (D-08). **Verified live:** Loki/error.log reads were query-only; no host mutation. | closed |
| T-08-SC | Tampering | npm/pip/cargo installs (supply chain) | low | accept | No package installs in this phase — v1.2 lockfile already merged and audited during v1.2; no new dependencies. PDF-inspection tools (pdffonts/pdftotext) are local OS tooling, not project deps. No `[ASSUMED]`/`[SUS]` installs. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `security_block_on` (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-1 | T-08-05 | migrate-before-swap failure aborts the deploy under `set -e` leaving the prior images running (safe state, D-07). Residual risk was **drilled live** in UAT test 5 and confirmed to leave staging untouched with zero downtime. | Lautaro (owner) | 2026-07-20 |
| AR-08-2 | T-08-07 | PDF deep-link/QR encodes a public showroom URL by design (D-11); no secrets embedded. Asserted to target the staging host only. | Lautaro (owner) | 2026-07-20 |
| AR-08-3 | T-08-SC | No package installs in this verification/ops phase; v1.2 lockfile already merged and audited. No new supply-chain surface. | Lautaro (owner) | 2026-07-20 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-20 | 10 | 10 | 0 | Claude (gsd-secure-phase, ASVS L1, short-circuit: register authored at plan time, threats_open=0) |

Method: State B (create) — register consolidated from both PLAN `<threat_model>` blocks
(08-01, 08-02). ASVS L1 + plan-time register + `threats_open: 0` → L1 grep-depth
sufficient per the secure-phase short-circuit rule; no separate auditor pass required.
Code-level mitigations grep-confirmed (`deploy/deploy.sh`, `deploy/nginx/*.conf`) and,
uniquely for this phase, the operational mitigations were exercised end-to-end during
the phase-08 UAT (rate-limit burst, migrate-abort drill, SHA-pinned image inspection,
read-only SSH) — first-hand evidence recorded in `08-UAT.md`.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-20
