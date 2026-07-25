---
phase: 11
slug: d2-bandeja-de-leads-notificaci-n-por-email
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
created: 2026-07-24
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> D2 — bandeja de leads + notificación por email. Register authored at plan time
> across 11-01…11-05; verified against implemented code by gsd-security-auditor.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| migration author → live DB | additive DDL crosses into the shared multi-tenant schema | schema DDL |
| seed batch → DB | fictitious lead rows inserted via the owner pool | fictitious lead PII |
| panel client → tRPC leads mutations | untrusted input (estado, desenlace, notifyEmail, PII) | client-supplied writes |
| leads.create → Redis (enqueue) | job payload (ids only) pushed after persist | lead/org/project ids |
| Redis job → worker | queued created-event drains into the processor | ids-only payload |
| worker → DB (withTenant) | tenant-scoped read of lead + project + owner emails as app_authenticated | lead PII, owner emails |
| worker → Resend API | outbound email to the resolved recipient, verified sender | recipient email, lead summary |
| browser → RSC / tRPC | client renders + writes; `canWrite` is cosmetic only | tenant-scoped lead PII |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-11-01 | Tampering | migration 0006 DDL (leads columns) | medium | mitigate | Two additive nullable `ADD COLUMN` only; generated (not manual); idempotent — `migrations/0006_*.sql` | closed |
| T-11-02 | Information Disclosure | seeded lead PII | low | accept | Fictitious Brigos data; anon INSERT-only (no anon SELECT policy); seed bypasses email seam — `schema/leads.ts`, `seed/content.ts` | closed |
| T-11-03 | Information Disclosure | Resend dispatch + dev console log | medium | mitigate | Dev fallback logs only `to :: nombre — origen`, never key; env via t3-env NAME-only — `send-lead-notification.ts:55-58` | closed |
| T-11-04 | Spoofing | email `From` header | medium | mitigate | `from: env.INVITE_FROM` only; throws when INVITE_FROM absent + key present — `send-lead-notification.ts:62-72` | closed |
| T-11-05 | Elevation of Privilege | create/updateEstado/addNote | high | mitigate | `requireRole("owner","developer")` on every write; FORBIDDEN pre-next — `leads.ts:147,220,271`, `middleware.ts:24-27` | closed |
| T-11-06 | Information Disclosure | cross-tenant lead PII | high | mitigate | `withTenant` on every read+write; 0-row → NOT_FOUND (no enumeration) — `leads.ts:75,162,206,229,258,286` | closed |
| T-11-07 | Tampering | `leadsNotifyEmail` input | high | mitigate | `z.email().nullable().optional()` at boundary + requireRole; recipient never client-controlled at send — `projects.ts:46,56` | closed |
| T-11-08 | Denial of Service | notification-spam amplification | medium | mitigate | `jobId = lead:{id}:created` dedups retries; enqueue only on create — `storage/lead-email.ts:38-41`, `leads.ts:318` | closed |
| T-11-09 | Information Disclosure | recipient resolution | high | mitigate | recipient = `leadsNotifyEmail ?? ownerEmails`, both under `withTenant(orgId)`; owners via SECURITY DEFINER `org_owner_emails` (REVOKE PUBLIC, pinned search_path) — `worker/lead-email.ts:178-187`, `migrations/0007_*.sql:29,43-44` | closed |
| T-11-10 | Information Disclosure | job payload + failure logs | medium | mitigate | Payload ids-only; failure log emits leadId/attempts/queue only — `storage/lead-email.ts:20-24`, `worker/lead-email.ts:203,217-228` | closed |
| T-11-11 | Elevation of Privilege | worker DB access | medium | mitigate | Reads via `withTenant` app_authenticated (RLS), never owner pool; tenant from payload orgId — `worker/lead-email.ts:74,137-139,173` | closed |
| T-11-12 | Elevation of Privilege | UI write affordances | medium | mitigate | `canWrite` cosmetic defense-in-depth only; server requireRole is authority — `leads/page.tsx:31-32`, `leads-board.tsx:177,182,339` | closed |
| T-11-13 | Information Disclosure | rendered lead PII | medium | mitigate | Board data solely from tenant-scoped `leads.listForProject` (RLS); zero direct DB imports in panel island — `leads-board.tsx:99-102` | closed |
| T-11-SC | Tampering | npm/pnpm installs | low | mitigate | Only external dep added phase-wide is `react-dom@19.2.7` (already-vetted transitive, now direct worker dep); every plan `tech-stack.added: []` — `apps/worker/package.json` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats ≥ high count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-02 | Fictitious Brigos seed data inserted via the owner pool; no real buyer PII. Anon role is INSERT-only with no anon SELECT policy, so seeded leads are never publicly readable. | Lautaro (Andescode) | 2026-07-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-24 | 14 | 14 | 0 | gsd-security-auditor (opus), ASVS L1, block_on=high |

Note: build-config fix `18246be` (externalize react/react-dom in the worker
bundle) reviewed — build-only change; reopens no threat. Recipient resolution,
RLS, role gates, idempotency, and logging are all unchanged.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-24
