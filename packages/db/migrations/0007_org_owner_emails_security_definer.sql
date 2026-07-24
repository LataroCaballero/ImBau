-- 0007_org_owner_emails_security_definer.sql — hand-written SECURITY DEFINER door (LEADS-04).
--
-- WHY (T-11-09 / T-11-10 / CLAUDE.md "RLS en toda tabla con tenant"): the Plan 11-04 worker must
-- resolve an org's owner email(s) for the "lead never lost" notification fallback
-- (project.leadsNotifyEmail ?? <org owners>), running under `withTenant` as the app_authenticated
-- role. The owner emails live in the Better Auth `user` table, which is intentionally un-RLS'd and
-- has NO grant to app_authenticated (0001_rls.sql grants app DML only on member/organization/projects
-- + the domain tables — never the auth fold table). A naive broad SELECT grant on that fold table would
-- let ANY tenant enumerate EVERY user's email across all tenants — the exact cross-tenant Information
-- Disclosure the threat model forbids.
--
-- The user-approved mechanism (Option 1) is this single, org-parameterized SECURITY DEFINER function:
-- it runs as its owner (the migration/owner role, which CAN read "user"), so app_authenticated never
-- touches "user" directly. The org id is passed as an ARGUMENT (not read from the tenant GUC inside the
-- body), so org scoping is caller-explicit and auditable — the worker passes job.data.organizationId.
-- `SET search_path = public` is pinned so a SECURITY DEFINER function cannot be hijacked via a caller's
-- search_path. EXECUTE is granted to app_authenticated ONLY (never anon).
--
-- NO snapshot file (mirrors the 0003_rls_domain.sql precedent): a function-only migration touches no
-- table, so drizzle-kit emits no snapshot. Idempotent: CREATE OR REPLACE FUNCTION + a re-runnable GRANT
-- make a second db:migrate / test-harness apply a clean no-op.

-- 1. The org-scoped door. `member ⋈ "user"` filtered to the org's owners; returns their emails.
CREATE OR REPLACE FUNCTION public.org_owner_emails(p_org_id text)
RETURNS setof text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT u.email
	FROM member m
	JOIN "user" u ON u.id = m.user_id
	WHERE m.organization_id = p_org_id
		AND m.role = 'owner'
$$;--> statement-breakpoint

-- 2. The ONLY grant: EXECUTE to app_authenticated (never anon). No broad grant on "user".
GRANT EXECUTE ON FUNCTION public.org_owner_emails(text) TO app_authenticated;
