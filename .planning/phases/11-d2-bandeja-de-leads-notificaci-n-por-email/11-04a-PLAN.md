---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 04a
type: execute
wave: 2
depends_on: ["11-01"]
files_modified:
  - packages/db/migrations/0007_org_owner_emails_security_definer.sql
  - packages/db/migrations/meta/_journal.json
autonomous: true
requirements: [LEADS-04]
gap_closure: false
must_haves:
  truths:
    - "A `public.org_owner_emails(p_org_id text) RETURNS setof text` SQL function exists as `SECURITY DEFINER`, owned by the migration/owner role, with a pinned `SET search_path = public`, that internally does `member ⋈ user` filtered to `organization_id = p_org_id AND role = 'owner'` and returns the owners' emails — this is the ONLY door by which `app_authenticated` can read an owner email, parameterized per-org, so no cross-tenant enumeration is possible (T-11-09/T-11-10)."
    - "`EXECUTE` on the function is granted to `app_authenticated` ONLY (never to `anon`); there is NO broad `GRANT ... ON \"user\"` anywhere — `grep -R 'GRANT[^;]*ON \"user\"' packages/db/migrations` returns 0, preserving the intentionally un-RLS'd Better Auth `user` table's non-exposure."
    - "The migration is a hand-written SQL file `0007_org_owner_emails_security_definer.sql` registered in `meta/_journal.json` as idx 7 (following the 0003 hand-written-no-snapshot precedent — a function-only migration touches no table, so NO `0007_snapshot.json` is added), and is idempotent (guarded so a second `db:migrate`/test-harness re-apply is a clean no-op: `CREATE OR REPLACE FUNCTION` + a re-runnable `GRANT`)."
    - "Applied to the live dev `imbau` DB via `pnpm --filter @imbau/db db:migrate`, verified idempotent on a second run, and verified at runtime: the function exists with `prosecdef = true`, `EXECUTE` is held by `app_authenticated`, and a call `SELECT * FROM public.org_owner_emails('<seed-org-id>')` under the `app_authenticated` role (with the tenant GUC set via the project's `withTenant` convention `app.current_organization_id`) returns the seed org's owner email(s) without raising `permission denied for table user`."
  artifacts:
    - packages/db/migrations/0007_org_owner_emails_security_definer.sql
  key_links:
    - "org_owner_emails(p_org_id) ← called by the Plan 11-04 worker under withTenant(job.data.organizationId) to resolve the owner-email fallback WITHOUT the owner pool and WITHOUT a broad user-table grant."
    - "member.role='owner' ⋈ user.email ← the internal join the SECURITY DEFINER boundary encapsulates so app_authenticated never touches \"user\" directly."
  prohibitions:
    - statement: "Do NOT add a broad `GRANT SELECT ON \"user\" TO app_authenticated` (or to anon) and do NOT enable RLS on the Better Auth `user`/`session`/`account` fold tables — the whole point of the SECURITY DEFINER door is to avoid exposing that table. The only grant is `EXECUTE` on the new function, to `app_authenticated`."
      category: security
      verification: command
    - statement: "Do NOT change table schema, columns, enums, or any other migration; this migration adds exactly one function + one EXECUTE grant. No DROP/ALTER TABLE/TYPE DDL."
      category: scope
      verification: command
---

<objective>
Land the security boundary that Plan 11-04 (the worker email consumer) needs but cannot author within its
worker-only scope: a `SECURITY DEFINER` SQL function `public.org_owner_emails(p_org_id text)` that lets the
`app_authenticated` role read an org's owner emails (for the "lead never lost" notification fallback) through
a single, org-parameterized door — instead of a broad `GRANT ON "user"` that would let any tenant enumerate
every user's email across all tenants (the exact cross-tenant Information Disclosure T-11-09/T-11-10 and
CLAUDE.md "RLS en toda tabla con tenant" forbid).

This is the user-approved mechanism (Option 1), split out as a companion DB plan so the migration is a
separate, atomically-reviewable change and Plan 11-04 stays worker-only.

Purpose: unblock 11-04's owner-email fallback path with zero cross-tenant PII exposure and zero use of the
owner pool. Output: migration `0007_*.sql` + journal entry, applied and verified on the live dev DB.
</objective>

<context>
- The tenant GUC in this codebase is `app.current_organization_id` (see `0000_init.sql` policies), set by the
  app's `withTenant` transaction helper. The function is PARAMETERIZED (`p_org_id`), so its correctness does
  not depend on the GUC — the worker passes `job.data.organizationId` explicitly. Passing the org id as an
  argument (not reading the GUC inside the SECURITY DEFINER body) keeps the org scoping caller-explicit and
  auditable.
- `member`, `user`, `organization` already exist (0000_init) and `app_authenticated`/`anon` roles + their
  scoped GRANTs exist (0000/0001). `user` is intentionally un-RLS'd and has NO grant to `app_authenticated`.
- Hand-written migrations that change no table carry NO snapshot: `0003_rls_domain.sql` is the precedent
  (there is no `0003_snapshot.json`). Follow that exactly for 0007.
- VERIFY the exact SQL identifiers against the real schema before writing the function body: read
  `packages/db/src/schema/*` (Better Auth fold tables) to confirm the physical column names for member→user
  (e.g. `user_id`, `organization_id`, `role`) and the user email column. Do not assume — the generated
  Better Auth column casing must match the migration SQL exactly, or the function will fail at CREATE time.
- Idempotency: use `CREATE OR REPLACE FUNCTION` and a `GRANT EXECUTE` that is safe to re-run. Guard/qualify as
  the existing hand-written migrations do so the test-harness second-apply path is a clean no-op.
</context>

<tasks>
<task id="1" name="Author migration 0007 (SECURITY DEFINER function + EXECUTE grant) + journal entry">
Read the existing schema (`packages/db/src/schema/*`) and `migrations/0003_rls_domain.sql` /
`migrations/meta/_journal.json` to match conventions and confirm the real column identifiers.

Write `packages/db/migrations/0007_org_owner_emails_security_definer.sql` containing EXACTLY:
  1. `CREATE OR REPLACE FUNCTION public.org_owner_emails(p_org_id text) RETURNS setof text LANGUAGE sql
     STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT <user.email> FROM member m JOIN "user" u
     ON u.<id> = m.<user_id> WHERE m.<organization_id> = p_org_id AND m.<role> = 'owner' $$;`
     (substitute the verified real column identifiers; keep the pinned `search_path`).
  2. `GRANT EXECUTE ON FUNCTION public.org_owner_emails(text) TO app_authenticated;`
Use `--> statement-breakpoint` between statements to match the repo's migration format. Do NOT add any
`GRANT ... ON "user"`, any RLS on fold tables, or any table/type DDL.

Add the idx-7 entry to `migrations/meta/_journal.json` with tag `0007_org_owner_emails_security_definer`
(match the shape of the existing entries; do NOT create a snapshot file — mirror the 0003 no-snapshot case).

Commit atomically: `feat(11-04a): add org_owner_emails SECURITY DEFINER fn (migration 0007)`.
</task>

<task id="2" name="Apply + verify on live dev DB (idempotent, prosecdef, EXECUTE grant, callable, no user-table grant)">
Apply with `pnpm --filter @imbau/db db:migrate` against the live dev `imbau` DB. Then verify:
  - Second `db:migrate` run is a clean no-op (idempotent).
  - `SELECT proname, prosecdef FROM pg_proc WHERE proname = 'org_owner_emails'` → `prosecdef = t`.
  - `EXECUTE` on the function is held by `app_authenticated` (and not `anon`):
    `SELECT has_function_privilege('app_authenticated', 'public.org_owner_emails(text)', 'EXECUTE')` → true;
    same check for `anon` → false.
  - Assume the `app_authenticated` role (`SET ROLE app_authenticated; SET LOCAL app.current_organization_id = '<seed org id>';`)
    inside a transaction and call `SELECT * FROM public.org_owner_emails('<seed org id>')` — it returns the
    seed org's owner email(s) and does NOT raise `permission denied for table user`. Reset role after.
  - `grep -RE 'GRANT[^;]*ON +"?user"?' packages/db/migrations` returns 0 hits (no broad user grant slipped in).
Capture these results in the SUMMARY verification section. No repo change from this task beyond what Task 1
committed (db:migrate mutates only the live DB + drizzle's `__drizzle_migrations` table, not the repo).

Commit any doc/SUMMARY as the plan-completion commit.
</task>
</tasks>

<verification>
- `pnpm --filter @imbau/db typecheck` green (no schema regression).
- Migration applies + re-applies idempotently on the live dev DB.
- Function is `SECURITY DEFINER`, `EXECUTE` to `app_authenticated` only, callable under the app role with the
  tenant GUC set, returns owner emails, raises no `permission denied`.
- No broad `GRANT ON "user"`, no fold-table RLS, no table/type DDL.
</verification>
