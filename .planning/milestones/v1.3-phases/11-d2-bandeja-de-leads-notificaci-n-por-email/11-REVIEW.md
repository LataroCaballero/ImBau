---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
reviewed: 2026-07-24T21:07:57Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - packages/db/migrations/0006_leads_desenlace_projects_notify_email.sql
  - packages/db/migrations/0007_org_owner_emails_security_definer.sql
  - packages/db/src/schema/leads.ts
  - packages/db/src/schema/projects.ts
  - packages/db/src/seed/content.ts
  - packages/db/src/seed/content-rows.ts
  - packages/storage/src/lead-email.ts
  - packages/storage/src/index.ts
  - packages/api/src/email/send-lead-notification.ts
  - packages/api/src/email/templates/lead-notification.tsx
  - packages/api/src/leads/runtime.ts
  - packages/api/src/trpc/routers/leads.ts
  - packages/api/src/trpc/routers/projects.ts
  - packages/api/src/trpc/routers/_app.ts
  - packages/api/tests/leads-role-gate.test.ts
  - packages/api/tests/send-lead-notification.test.ts
  - apps/worker/src/lead-email.ts
  - apps/worker/src/lead-email.test.ts
  - apps/worker/src/index.ts
  - apps/worker/src/env.ts
  - apps/panel/app/proyectos/[id]/leads/page.tsx
  - apps/panel/app/proyectos/[id]/leads/leads-board.tsx
  - apps/panel/app/proyectos/[id]/leads/lead-card.tsx
  - apps/panel/app/proyectos/[id]/leads/lead-drawer.tsx
  - apps/panel/app/proyectos/[id]/leads/desenlace-prompt.tsx
  - apps/panel/app/proyectos/[id]/leads/alta-lead-form.tsx
  - apps/panel/app/proyectos/[id]/leads/notify-email-field.tsx
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-07-24T21:07:57Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Phase 11 (D2 — leads bandeja + email notification) is well-built against the review's high-risk areas. The multi-tenant checks hold: every read and write in `leads.ts`, `projects.ts`, and the worker's `readLeadForEmail` routes through `withTenant` on the unprivileged `app_authenticated` pool — the owner/BYPASSRLS pool appears only in test seeding, never in production paths. The `updateEstado`/`addNote`/`create` mutations are gated by `requireRole("owner","developer")` with `.returning()` 0-row → NOT_FOUND no-enumeration, and the create→enqueue seam correctly places the enqueue *after* the committed persist and *outside* the tx (proven by the rollback test). The `org_owner_emails` SECURITY DEFINER function correctly `REVOKE`s EXECUTE from PUBLIC and grants only to `app_authenticated`, and pins `search_path`. The audit `events` insert is schema-valid (sessionId nullable, ts defaults). No SQL/command injection, no hardcoded secrets, no reachable cross-tenant read was found.

The findings below are hardening gaps and quality defects — no blocker-level defect is provable. The two most substantive: (1) the SECURITY DEFINER `search_path` is pinned to `public` but not hardened against `pg_temp` object-masking, and (2) the alta-manual `origen` dropdown is effectively dead UI. There are also two robustness gaps in the "lead never lost" delivery path (multi-owner recipient format, consumer at-least-once double-send) and one privacy gap (dev-fallback logs lead PII).

No `<structural_findings>` block was provided, so this report is entirely narrative.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `org_owner_emails` trusts its `p_org_id` argument — no cross-check against the tenant GUC

**File:** `packages/db/migrations/0007_org_owner_emails_security_definer.sql:24-44`
**Issue:** The SECURITY DEFINER function bypasses RLS and returns owner emails for *whatever* org id is passed as `p_org_id`. EXECUTE is granted to `app_authenticated` — the single role used for **every** tenant panel/worker query. The function does not verify that `p_org_id` matches the active tenant (`current_setting('app.current_organization_id', true)`). Today there is no reachable exploit (the only caller is the worker, which passes `job.data.organizationId` derived from the trusted producer, and the panel only issues fixed Drizzle queries — no raw SQL from user input), so this is defense-in-depth, not an active leak. But the entire cross-tenant PII guarantee now rests on every future caller passing the correct org id, with zero enforcement inside the door.
**Fix:** Add a guard so the door refuses a mismatched tenant, e.g.:
```sql
AS $$
  SELECT u.email
  FROM member m
  JOIN "user" u ON u.id = m.user_id
  WHERE m.organization_id = p_org_id
    AND m.organization_id = current_setting('app.current_organization_id', true)
    AND m.role = 'owner'
$$;
```
This keeps the caller-explicit argument but makes a foreign-org lookup return zero rows even if a future path calls it under the wrong tenant context.

### WR-02: SECURITY DEFINER `search_path` not hardened against `pg_temp` masking

**File:** `packages/db/migrations/0007_org_owner_emails_security_definer.sql:29-36`
**Issue:** `SET search_path = public` pins the path, but Postgres implicitly searches the caller's `pg_temp` schema **first** for relation names when `pg_temp` is not explicitly placed in the path. `app_authenticated` retains the default PUBLIC `TEMP` privilege (0001_rls.sql creates the role `NOSUPERUSER NOBYPASSRLS NOCREATEDB` but never `REVOKE TEMP ... FROM PUBLIC`), so a caller can create `pg_temp.member` / `pg_temp."user"` temp tables that mask the bare, unqualified `member` and `"user"` references in the function body. Direct privilege escalation is limited here (a masking view runs with the attacker's own privileges, and the only operator used — `=` on text — resolves in `pg_catalog` first), but the migration's own comment claims the door is "hardened," and this is exactly the documented SECURITY DEFINER footgun.
**Fix:** Schema-qualify the references and neutralize `pg_temp`:
```sql
SET search_path = pg_catalog, public, pg_temp
...
  FROM public.member m
  JOIN public."user" u ON u.id = m.user_id
```
Placing `pg_temp` last (and qualifying `public.member`/`public."user"`) removes the masking vector; optionally `REVOKE TEMPORARY ON DATABASE ... FROM PUBLIC`.

### WR-03: Multi-owner fallback recipient is a comma-joined string, not `string[]` — risks the "lead never lost" delivery

**File:** `apps/worker/src/lead-email.ts:178-195`, `packages/api/src/email/send-lead-notification.ts:39-72`
**Issue:** When `leadsNotifyEmail` is null the worker falls back to the org owners and passes `to: recipients.join(", ")` into `sendLeadNotification`, whose `to: string` type forwards it straight to `resend.emails.send({ to })`. Resend's documented multi-recipient contract is a `string[]`; a single comma-joined string is undocumented behavior. If Resend rejects or mis-parses it, the D-05 "lead never lost" fallback silently fails to deliver **precisely** for organizations with more than one owner — the case the fallback exists to protect.
**Fix:** Widen the contract to an array and pass owners as a list:
```ts
// send-lead-notification.ts
export interface LeadNotificationData { to: string | string[]; /* ... */ }
// lead-email.ts
const recipients = lead.leadsNotifyEmail ? [lead.leadsNotifyEmail] : [...lead.ownerEmails];
await sendLeadNotification({ to: recipients, /* ... */ });
```

### WR-04: Consumer is at-least-once — the send is not idempotent against a worker crash after send

**File:** `apps/worker/src/lead-email.ts:5-8, 170-204`
**Issue:** The producer's `jobId=lead:{id}:created` correctly dedups *re-enqueues* (BullMQ ignores an add for an existing jobId, and the default queue retains completed jobs). But the consumer runs with `attempts: 5` and no send-level idempotency key: if `sendLeadNotification` succeeds and the worker then crashes/times out before the job is acked, BullMQ retries the whole job and the email is sent **again**. The module comment ("a retried/duplicate created-event drains to exactly one send") overstates the guarantee — enqueue is exactly-once, delivery is at-least-once.
**Fix:** Either soften the comment to state at-least-once delivery, or add real send idempotency (e.g. persist a `notified_at` timestamp on the lead inside a `withTenant` guard and short-circuit if already set — the same "short-circuit if already exists" pattern the quote-pdf processor uses for `pdfKey`).

### WR-05: Alta-manual `origen` dropdown has no observable effect (Broker/Unidad/Cotización all render "Directo")

**File:** `apps/panel/app/proyectos/[id]/leads/alta-lead-form.tsx:16-21, 51-57`, `packages/api/src/trpc/routers/leads.ts:116-135`
**Issue:** The form lets the user pick `origen` ∈ {directo, broker, unidad, cotizacion} and sends it as free text, but sends **no** `brokerId`/`unitId`/`quoteId`. `listForProject` computes `origenResuelto` purely from those pointer joins, and the lead card renders only `origenChipLabel(origenResuelto)` — the raw `origen` string is never displayed. So a lead created with `origen: "broker"` still shows the "Directo" chip (and the notification email's `resolveOrigen` also returns "Directo"). Choosing anything other than "Directo" produces zero visible difference — misleading UI.
**Fix:** Either (a) drop the non-"Directo" options from the alta form until pointer selection exists, or (b) surface the stored `origen` text as a fallback chip when no pointer resolves, or (c) let the form collect and pass the actual `brokerId`/`unitId`/`quoteId`.

### WR-06: Dev-fallback logs lead PII (recipient email + lead name), contradicting the "only ids" rule

**File:** `packages/api/src/email/send-lead-notification.ts:55-58`
**Issue:** The no-`RESEND_API_KEY` branch does `console.info(\`[lead] ${to} :: ${nombre} — ${origen}\`)`, writing a recipient email address and the lead's `nombre` (both PII) to the console. The phase requirement and the worker's own `reportLeadEmailFailure` path deliberately log ids only. This path is scoped to dev/test, but if `RESEND_API_KEY` is ever unset in a staging/prod-like environment, that PII is shipped to Loki via the structured-log pipeline.
**Fix:** Log ids/counts only, e.g. `console.info(\`[lead] notify recipients=${recipientCount} origen=${origen}\`)`, or gate the PII summary behind `NODE_ENV === "development"` explicitly rather than on the absence of a secret.

## Info

### IN-01: Notification email exposes the raw quote UUID as `origen` for cotización-origin leads

**File:** `apps/worker/src/lead-email.ts:52-57`
**Issue:** `resolveOrigen` returns `lead.quoteRefId` (the quote's UUID) as the human-readable origen string for a quote-origin lead, whereas the board chip renders the friendly "Cotización". The email would show `Origen: <uuid>`. Latent this phase (the `create` seam never sets `quoteId`), but inconsistent with the UI and unfriendly if a quote-origin lead ever reaches the notification path.
**Fix:** Return a friendly literal (e.g. `"Cotización"`) instead of the UUID, matching `origenChipLabel`.

### IN-02: Dead timeline special-case for "Lead recibido desde el showroom"

**File:** `apps/panel/app/proyectos/[id]/leads/lead-drawer.tsx:51`
**Issue:** `entryText` special-cases the note text `"Lead recibido desde el showroom"`, but no code path in this phase produces that note (the anon public ingestion endpoint is deferred — D-11). Harmless dead branch.
**Fix:** Remove until the showroom ingestion lands, or leave with a `// TODO(fase-2)` marker.

### IN-03: `leads.create` can attach a broker/unit/quote from another project within the same org

**File:** `packages/api/src/trpc/routers/leads.ts:271-307`
**Issue:** The composite FKs on `leads` pin `(pointer_id, organization_id)` — org, but not project. So a lead in project A could reference a broker/unit/quote belonging to project B of the same tenant. No cross-tenant leak (org is enforced), and unreachable via the alta form (it sends no pointers), but a future caller passing arbitrary pointer ids could create cross-project references.
**Fix:** If cross-project attachment is undesirable, validate that the pointer's `project_id` matches `input.projectId` before insert, or extend the composite FK to include project.

### IN-04: `desenlace` stored as free `text` with no DB CHECK constraint

**File:** `packages/db/migrations/0006_leads_desenlace_projects_notify_email.sql:2`, `packages/db/src/schema/leads.ts:55`
**Issue:** `desenlace` accepts any string at the DB level; only the Zod `z.enum(["ganado","perdido"])` at the router boundary constrains it. This is a documented deliberate choice (forward-compatible sidecar), and all write paths validate — noted only so a future direct/raw write path is known to be unguarded.
**Fix:** Optional: add a `CHECK (desenlace IN ('ganado','perdido'))` (nullable) to enforce the invariant at the storage layer.

---

_Reviewed: 2026-07-24T21:07:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
