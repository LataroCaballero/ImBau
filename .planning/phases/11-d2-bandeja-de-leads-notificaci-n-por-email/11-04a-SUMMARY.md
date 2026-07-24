---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 04a
subsystem: database
tags: [postgres, rls, security-definer, drizzle, multi-tenant, better-auth]

# Dependency graph
requires:
  - phase: 11-01
    provides: leads/desenlace schema + projects.leadsNotifyEmail column
  - phase: 00-foundation
    provides: app_authenticated/anon roles, member/user/organization Better Auth fold tables, app.current_organization_id tenant GUC
provides:
  - "public.org_owner_emails(p_org_id text) SECURITY DEFINER function — the single org-scoped door for app_authenticated to read an org's owner emails without a broad user-table grant"
  - "Migration 0007 (hand-written, no snapshot) registered at journal idx 7"
affects: [11-04, worker-email-notifications, leads-notify-fallback]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER function as a parameterized cross-boundary door: encapsulate a read of an intentionally un-RLS'd Better Auth fold table (user) behind an org-scoped function instead of granting the app role direct table access"
    - "REVOKE EXECUTE ... FROM PUBLIC immediately after CREATE FUNCTION to defeat the Postgres default PUBLIC-execute footgun before GRANTing to the intended role only"

key-files:
  created:
    - packages/db/migrations/0007_org_owner_emails_security_definer.sql
  modified:
    - packages/db/migrations/meta/_journal.json

key-decisions:
  - "Org id is passed as an explicit function ARGUMENT, not read from the tenant GUC inside the SECURITY DEFINER body — keeps org scoping caller-explicit and auditable (worker passes job.data.organizationId)"
  - "Pinned SET search_path = public on the SECURITY DEFINER function to prevent search_path hijacking"
  - "REVOKE EXECUTE FROM PUBLIC added (Rule 2 security fix) so anon cannot enumerate owner emails"
  - "Hand-written migration with NO snapshot file, mirroring the 0003_rls_domain.sql precedent (function-only migration touches no table)"

patterns-established:
  - "Cross-tenant PII door: SECURITY DEFINER + pinned search_path + REVOKE-FROM-PUBLIC + single-role GRANT is the sanctioned way to expose a narrow, parameterized read of an un-RLS'd table to app_authenticated"

requirements-completed: [LEADS-04]

coverage:
  - id: D1
    description: "public.org_owner_emails(p_org_id) SECURITY DEFINER function returns an org's owner email(s) via member⋈user, callable by app_authenticated only"
    requirement: "LEADS-04"
    verification:
      - kind: integration
        ref: "psql runtime probe: prosecdef=t; has_function_privilege(app_authenticated,EXECUTE)=t; SET ROLE app_authenticated + GUC set + SELECT org_owner_emails(<seed org>) returns owner email, no permission-denied"
        status: pass
    human_judgment: false
  - id: D2
    description: "anon and PUBLIC cannot execute the function (no cross-tenant owner-email enumeration); no broad GRANT on the user fold table anywhere in migrations"
    requirement: "LEADS-04"
    verification:
      - kind: integration
        ref: "psql: has_function_privilege(anon,EXECUTE)=false after REVOKE FROM PUBLIC"
        status: pass
      - kind: other
        ref: "grep -RE 'GRANT[^;]*ON +\"?user\"?' packages/db/migrations == 0 hits"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 04a: org_owner_emails SECURITY DEFINER door Summary

**Migration 0007 lands `public.org_owner_emails(p_org_id text)` — a pinned-search_path SECURITY DEFINER function that lets `app_authenticated` read an org's owner emails through one parameterized door, with EXECUTE revoked from PUBLIC so no tenant (and no anon) can enumerate owner emails across orgs.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-24T20:07Z (approx)
- **Completed:** 2026-07-24T20:27:25Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Authored hand-written migration `0007_org_owner_emails_security_definer.sql`: `CREATE OR REPLACE FUNCTION public.org_owner_emails(p_org_id text) RETURNS setof text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`, joining `member` owners (`role='owner'`) to `"user".email`, filtered to `organization_id = p_org_id`.
- Registered the migration at journal idx 7 with NO snapshot file (mirrors the 0003 no-snapshot precedent — a function-only migration touches no table).
- Applied and verified idempotent on the live dev `imbau` DB: second `db:migrate` is a clean no-op.
- Runtime-verified: `prosecdef = true`, pinned `search_path=public`, `EXECUTE` held by `app_authenticated` only (anon = false), and a call under `SET ROLE app_authenticated` with the tenant GUC set returns the seed org's owner email (`e2e-ncg50hr8@example.test`) with no `permission denied for table user`.
- Confirmed zero broad user-table grants: `grep -RE 'GRANT[^;]*ON +"?user"?' packages/db/migrations` returns 0 hits.

## Task Commits

1. **Task 1: Author migration 0007 (SECURITY DEFINER fn + EXECUTE grant) + journal entry** - `280a6e7` (feat)
2. **Task 2 / Rule-2 fix: REVOKE EXECUTE FROM PUBLIC (lock out anon)** - `950410c` (fix)

## Files Created/Modified
- `packages/db/migrations/0007_org_owner_emails_security_definer.sql` - The SECURITY DEFINER door: function + REVOKE-FROM-PUBLIC + EXECUTE grant to app_authenticated.
- `packages/db/migrations/meta/_journal.json` - Added idx-7 entry `0007_org_owner_emails_security_definer`.

## Decisions Made
- **Org id as explicit argument, not GUC-read:** the function is parameterized (`p_org_id`); the worker passes `job.data.organizationId`. This keeps org scoping caller-explicit and auditable rather than implicit inside the definer body.
- **Pinned `search_path = public`:** standard SECURITY DEFINER hardening against search_path hijacking.
- **No snapshot file:** followed the 0003_rls_domain.sql hand-written precedent; drizzle emits no snapshot for a function-only migration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical / Security] REVOKE EXECUTE ... FROM PUBLIC on the function**
- **Found during:** Task 2 (live-DB verification)
- **Issue:** Postgres grants `EXECUTE` to `PUBLIC` by default on every new function. Runtime probe showed `has_function_privilege('anon', ..., 'EXECUTE') = true` after only `GRANT ... TO app_authenticated`. Since `anon` is a real LOGIN role serving the public web, it could call this SECURITY DEFINER function and enumerate any org's owner emails by org id — the exact cross-tenant PII disclosure (T-11-09/T-11-10) this plan exists to prevent, and a direct violation of the plan's must-have ("EXECUTE granted to app_authenticated ONLY, never anon").
- **Fix:** Added `REVOKE EXECUTE ON FUNCTION public.org_owner_emails(text) FROM PUBLIC;` before the `GRANT` in the migration; applied to the live DB. Both statements are idempotent.
- **Files modified:** packages/db/migrations/0007_org_owner_emails_security_definer.sql
- **Verification:** Re-probed live DB: `anon` EXECUTE = false, `app_authenticated` EXECUTE = true.
- **Committed in:** 950410c

---

**Total deviations:** 1 auto-fixed (1 missing-critical/security)
**Impact on plan:** The REVOKE is essential for the plan's own security invariant — without it the SECURITY DEFINER door was open to anon, defeating the purpose. No scope creep; the migration still adds exactly one function + one EXECUTE grant (plus its guarding REVOKE). No table/type DDL, no fold-table RLS, no broad user grant.

## Issues Encountered
- Running ad-hoc `postgres`-driver node scripts from `/tmp` failed ESM resolution (`Cannot find package 'postgres'`); resolved by executing the probe from within `packages/db` so the workspace `node_modules` resolves. Temp probe files were removed; nothing left in the working tree.

## User Setup Required
None - no external service configuration required. The migration is applied to the live dev DB; CI/staging apply it on the normal `db:migrate` path.

## Next Phase Readiness
- **11-04 unblocked:** the worker's owner-email fallback (`project.leadsNotifyEmail ?? org_owner_emails(job.data.organizationId)`) can now run under `withTenant` as `app_authenticated` with zero cross-tenant exposure and without the owner pool.
- No blockers.

## Self-Check: PASSED

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
