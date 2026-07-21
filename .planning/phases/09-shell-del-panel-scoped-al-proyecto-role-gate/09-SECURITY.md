---
phase: 09
slug: shell-del-panel-scoped-al-proyecto-role-gate
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 09 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Merged register from `09-01-PLAN.md` (api write mold + role gate) and `09-02-PLAN.md`
(panel shell). Register authored at plan-time; verified at ASVS L1 (grep-depth) plus the
41-test cross-role authorization matrix and the 3/3 human UAT (shell navigation,
no-enumeration 404, viewer write-gating).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → panel RSC | `params.id` from the URL is untrusted; validated with `z.uuid()` before any query. | project id (uuid) |
| panel RSC → tRPC caller | Session cookie in headers; `createCaller({ headers })` derives the active org server-side. | session / active org id |
| tRPC caller → tRPC procedure | `id`/`estado` inputs untrusted; validated with `z.uuid()` / `z.enum` at the boundary. | project id, estado enum |
| tRPC procedure → Postgres | Runs as `app_authenticated` (NOSUPERUSER/NOBYPASSRLS) inside `withTenant`; `projects_tenant` RLS is the tenant barrier. | tenant-scoped project rows |
| caller role → write authority | `member.role` for the active org is the authorization signal; `requireRole` is the enforcement point. | role (owner/developer/viewer) |
| RSC role prop → write affordance | `canWrite` from `org.activeMemberRole` gates rendering; cosmetic, not the authority. | role (UI hint only) |
| canary write → anon web surface | `estado` toggle changes what `projects_anon_published` exposes via `listPublished` (intentional). | published project visibility |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-09-01 | Elevation of Privilege | Viewer forges a write (`projects.updateSettings` / UI affordance) | high | mitigate | Server `requireRole("owner","developer")` throws FORBIDDEN before the UPDATE (`packages/api/src/trpc/routers/projects.ts:46`); UI `canWrite` gating is defense-in-depth only. Verified: integration viewer-FORBIDDEN case + UAT test 3 (viewer sees no affordance). | closed |
| T-09-02 | Information Disclosure / EoP | Cross-org read/deep-link of a project by id (BOLA/IDOR) | high | mitigate | `withTenant` + `projects_tenant` RLS makes the row invisible; `getForOrg` → `rows[0] ?? null` (`projects.ts:40`) → RSC `notFound()`. Client id never trusted. Verified: other-org integration case + UAT test 2. | closed |
| T-09-04 | Tampering | Silent 0-row UPDATE under RLS on a cross-tenant id | high | mitigate | `.returning()` + `if (rows.length === 0) throw NOT_FOUND` (`projects.ts:54-57`) — never a silent success. Verified: other-org + non-existent-id integration cases. | closed |
| T-09-03 | Information Disclosure | Enumeration via 403-vs-404 distinction (api + shell) | medium | mitigate | Cross-org and non-existent both return an identical NOT_FOUND / `notFound()` (D-07); uniform es-AR boundary at `apps/panel/app/proyectos/not-found.tsx`. Verified: matrix asserts both codes NOT_FOUND + UAT test 2 (both URLs identical). | closed |
| T-09-05 | Denial of Service | Malformed `id` → Postgres 22P02 → 500 | medium | mitigate | `z.uuid().safeParse(id)` before any query in the layout and all three tab pages (`layout.tsx:28`, `unidades/leads/hotspots page.tsx:18-26`) + `z.uuid()` on both procedure inputs. | closed |
| T-09-06 | Spoofing (of evidence) | Test runs as owner pool/superuser → false green | medium | mitigate | Cross-role matrix asserts only via `createCaller` → `app_authenticated`; owner pool used only to seed (RESEARCH Pitfall 4). Verified: 41/41 tests green. | closed |
| T-09-08 | Information Disclosure | RSC error masquerading a DB failure as a login bounce | low | mitigate | Narrow catch: only `UNAUTHORIZED`/`FORBIDDEN` → `redirect("/login")`; all other errors re-thrown (`apps/panel/lib/project-caller.ts:30-34,50-54`). | closed |
| T-09-07 | Information Disclosure | Tenant GUC bleed on a pooled connection | low | accept | Already mitigated by the transaction-scoped `set_config('app.current_organization_id',$1,true)` in `with-tenant.ts`; no net-new surface this phase. | closed |
| T-09-SC | Tampering | npm/pip/cargo installs (supply chain) | low | accept | No net-new packages installed this phase (RESEARCH Package Legitimacy Audit: N/A) — zero supply-chain surface. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09-01 | T-09-07 | Tenant GUC isolation is enforced by the existing transaction-scoped `set_config(..., true)` in `with-tenant.ts`; this phase adds no new pooled-connection surface. | Lautaro | 2026-07-21 |
| AR-09-02 | T-09-SC | No net-new dependencies added this phase; supply-chain surface unchanged. | Lautaro | 2026-07-21 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 9 | 9 | 0 | gsd-secure-phase (L1 grep + UAT/matrix evidence) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-21
