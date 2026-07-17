---
phase: 02-data-layer-rls
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - compose.yml
  - .env.example
  - packages/config/env/presets.ts
  - apps/worker/src/env.ts
  - apps/worker/src/env.test.ts
  - packages/db/.env.example
  - packages/db/auth.ts
  - packages/db/drizzle.config.ts
  - packages/db/src/env.ts
  - packages/db/src/client.ts
  - packages/db/src/with-tenant.ts
  - packages/db/src/index.ts
  - packages/db/src/schema/auth-schema.ts
  - packages/db/src/schema/projects.ts
  - packages/db/src/schema/member-rls.ts
  - packages/db/src/schema/roles.ts
  - packages/db/src/schema/index.ts
  - packages/db/migrations/0000_init.sql
  - packages/db/migrations/0001_rls.sql
  - packages/db/tests/cross-tenant.test.ts
  - packages/db/tests/setup.ts
  - packages/db/tests/db.ts
  - packages/db/tests/helpers.ts
  - packages/db/vitest.config.ts
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

This is a multi-tenant Postgres data layer with RLS. The core RLS plumbing is, on the whole, soundly built: the tenant GUC is set via a **parameterized** `set_config('app.current_organization_id', ${orgId}, true)` (no string interpolation, transaction-scoped — Pitfall 4 avoided), roles are created `NOSUPERUSER NOBYPASSRLS`, both tenant tables get `FORCE ROW LEVEL SECURITY`, the app connects directly as the unprivileged role (no `SET ROLE`), and the harness has a real role guard asserting `rolbypassrls=false`/`rolsuper=false` before any assertion runs. The `::uuid → ::text` reconciliation is correct and documented.

However, there is one genuine cross-tenant read leak (the `organization` table is granted to the app role with no RLS), one exit-gate test that does not actually prove what it claims (the `member` cross-tenant INSERT can be rejected by the FK rather than by RLS), and several type-safety violations of the project's "no unjustified casts" standard concentrated in the test harness. None of the RLS policies themselves are broken, but the exit gate's evidentiary value is weaker than the prose claims.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `organization` table is readable cross-tenant by the app role (no RLS, broad GRANT)

**File:** `packages/db/migrations/0001_rls.sql:48-50`
**Issue:** `organization` receives `GRANT SELECT, INSERT ... TO app_authenticated` but is **never** RLS-enabled or `FORCE`d. Every authenticated tenant can therefore `SELECT * FROM organization` and read **every other tenant's** `name`, `slug`, `plan`, `logo`, and `metadata`. The inline comment justifies this as "the tenant identity table, not tenant-scoped BY organization_id," but that reasoning is incorrect for a read path: org A can enumerate the full customer list of the platform (names, plans, slugs) of org B. For a multi-tenant SaaS where competitor developers may share the platform, leaking the tenant roster and their commercial `plan` tier is a confidentiality breach. CLAUDE.md states "RLS en toda tabla con tenant" — `organization` *is* the tenant table; its own `id` is the tenant boundary.

The phase scope deliberately limited tenant policies to `projects` + `member`, so this may be an accepted scope decision — but it ships a real cross-tenant read surface that the DATA-04 absence gate does **not** test (the gate never asserts org A cannot read org B's `organization` row). At minimum this must be a recorded, accepted risk with a follow-up; preferably `organization` gets a self-referential policy now.

**Fix:** Add a tenant policy + FORCE RLS so a tenant can only read/insert its own organization row:
```sql
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organization_self" ON "organization"
  AS PERMISSIVE FOR ALL TO "app_authenticated"
  USING ("organization"."id" = current_setting('app.current_organization_id', true)::text)
  WITH CHECK ("organization"."id" = current_setting('app.current_organization_id', true)::text);
```
Note the fixture path (`makeOrg` via owner) is unaffected — seeding runs as owner, which still bypasses. If a real reason to read sibling orgs exists, document it as an explicitly accepted risk in the phase summary and add a cross-tenant absence assertion for `organization` so the decision is at least under test.

## Warnings

### WR-01: Exit-gate `member` cross-tenant INSERT test can pass for the wrong reason (FK rejects before RLS)

**File:** `packages/db/tests/cross-tenant.test.ts:144-154`
**Issue:** Case (c) inserts a `member` row with `userId: "nonexistent-user-but-rls-rejects-first"` and asserts only `.rejects.toThrow()`. But `member.user_id` has a FK to `user`, and that user id does not exist, so the INSERT throws on the **foreign-key violation** regardless of whether the RLS `withCheck` is correct. If `member_tenant`'s `withCheck` were silently broken (e.g. dropped, or mis-cast), this test would *still pass*. For an adversarial exit gate whose entire purpose is to prove RLS rejects cross-tenant writes, this assertion proves nothing about RLS for `member`. The in-comment claim "RLS rejects first" is not guaranteed by Postgres ordering and is not asserted.
**Fix:** Seed a valid `user` via the owner first, then insert the `member` with a **valid** `userId` but a foreign `organizationId`, so the only possible rejection cause is the RLS `withCheck`. Optionally assert the error is a policy violation (SQLSTATE `42501`) rather than any throw:
```ts
const uid = await makeUser(); // owner-seeded, valid FK
await expect(withTenant(s.orgA, async (tx) => {
  await tx.insert(member).values({ id: `m-${Date.now()}`, organizationId: s.orgB, userId: uid, role: "member", createdAt: new Date() });
})).rejects.toThrow(/row-level security|42501/);
```

### WR-02: UPDATE row-count assertions depend on an untyped driver internal via double-cast

**File:** `packages/db/tests/cross-tenant.test.ts:163-165, 169-176`
**Issue:** `(res as unknown as { count: number }).count` reads the postgres-js `RowList.count` off a Drizzle update result whose type does not expose `count`. This happens to work at runtime (postgres-js `RowList` carries `.count`), but it is a `as unknown as` escape hatch that defeats the type checker on a *correctness-critical* assertion. If a future Drizzle/driver upgrade changes the result shape to not carry `count`, `count` becomes `undefined`, and `expect(undefined).toBe(0)` **fails loudly** — but if it changes to `undefined` and the code were `>= 0` style, it could pass silently. The exit gate's "affects 0 rows" proof rests on an untyped property access.
**Fix:** Use `.returning()` and assert on the returned array length, which is fully typed:
```ts
const rows = await tx.update(projects).set({ nombre: "hijacked" })
  .where(eq(projects.id, s.projectB)).returning({ id: projects.id });
return rows.length; // typed number, no cast
```

### WR-03: Pervasive `as unknown as` casts in test harness violate the project's strict-typing standard

**File:** `packages/db/tests/cross-tenant.test.ts:64-72, 79-88`; `packages/db/tests/setup.ts:38-54`
**Issue:** `tx.execute<{ current_user: string }>(...)` is immediately re-cast `as unknown as { current_user: string }[]` to index `[0]`. The generic on `execute` is being supplied *and then thrown away* with a double-cast, which is exactly the "unjustified cast" CLAUDE.md prohibits ("sin `any` salvo justificación comentada" — these casts have no justification comment, only the surrounding RLS comments). The double-cast also silently absorbs the `noUncheckedIndexedAccess` `[0]` undefined risk in some spots while `?.` is used in others — inconsistent.
**Fix:** Type `execute`'s return once and read it without re-casting. With postgres-js, `db.execute<T>()` resolves to a `RowList<T[]>` you can index directly:
```ts
const rows = await tx.execute<{ current_user: string }>(sql`select current_user`);
const user = rows[0]?.current_user; // no cast needed
```
If the Drizzle typing genuinely requires a cast, narrow with a single typed helper and a `// justification:` comment, not a per-call-site `as unknown as`.

### WR-04: App/anon roles are created with `LOGIN` but no password; connection auth is undefined

**File:** `packages/db/migrations/0001_rls.sql:28-33`; `packages/db/.env.example:13-18`
**Issue:** `CREATE ROLE app_authenticated LOGIN ...` creates a login-capable role with **no password**. The `.env.example` connection strings embed `app_authenticated:dev` / `anon:dev`, implying password `dev`, but nothing ever sets that password. The `postgres:16-alpine` image with `POSTGRES_PASSWORD` set defaults `pg_hba` host connections to `scram-sha-256`, so a passwordless role cannot authenticate over TCP from the app/anon pools — the runtime path (`appDb`/`anonDb` in `client.ts`) would fail to connect. The migration comment says credentials are set "out-of-band," but no such step exists in this phase's deliverables, and the example file actively misleads by suggesting `:dev` works. This is a latent runtime break the moment `withTenant`/`withAnon` is exercised against Compose (the tests use owner for seeding and may mask it depending on local pg_hba).
**Fix:** Either set passwords in the idempotent migration block for local/dev parity, e.g.:
```sql
ALTER ROLE app_authenticated WITH PASSWORD 'dev';
ALTER ROLE anon WITH PASSWORD 'dev';
```
(guarded so it only runs in non-prod), or document the exact out-of-band `ALTER ROLE ... PASSWORD` step in the phase summary and make `.env.example` reflect reality. Confirm the runtime app/anon connection actually succeeds against Compose before declaring the path working.

### WR-05: `anon` lacks `USAGE`/`SELECT` to satisfy a published-project read with related data, and is granted enum USAGE it cannot reach

**File:** `packages/db/migrations/0001_rls.sql:38-43`
**Issue:** `anon` gets `GRANT SELECT ON "projects"` and `USAGE ON TYPE estado`, but the realistic public read path (a published project showroom) will need to read related rows (e.g. floors/units in later phases, and possibly `organization` for branding). More immediately: `anon` has `USAGE ON SCHEMA public` and can therefore *attempt* `SELECT` on any table, but only `projects` is granted — which is correct default-deny, yet there is no test asserting `anon` is **denied** on `member`/`organization`. The absence gate for anon (case d) only checks `projects` estado filtering, never that anon cannot read `member` or sibling `organization` rows. Combined with CR-01, an anon path that joins to `organization` would either error (no grant) or, if a grant is later added casually, leak.
**Fix:** Add an explicit negative assertion that `anon` cannot read `member`/`organization` (expect throw or zero rows), so the deny boundary is under test, not assumed. Keep grants minimal and re-confirm each new public-read table gets an explicit anon policy.

### WR-06: `requireEnv` precedence can silently point tests at the production `imbau` DB

**File:** `packages/db/tests/db.ts:27-41`
**Issue:** `ownerUrl()` falls back from `TEST_DATABASE_URL` to `DATABASE_URL`, `appUrl()` to `DATABASE_APP_URL`, etc. If a developer runs the suite locally with only the standard `DATABASE_URL` set (the normal dev env from `.env`), the harness runs `migrate()` and seeds fixtures against the **dev `imbau` database**, not a dedicated `imbau_test`. The comment claims the suite "can never touch real data," but the fallback defeats that guarantee — the only thing separating test from dev/prod is an env var the fallback makes optional. Migrations are idempotent so it won't corrupt schema, but it will write fixture orgs/projects/members/users into the dev DB.
**Fix:** Require the `TEST_*` variant explicitly (no fallback to the prod-shaped names), or assert the resolved database name ends in `_test` before running `migrate`/seed:
```ts
const url = new URL(resolved);
if (!url.pathname.endsWith("_test")) throw new Error(`Refusing to run tests against non-test DB: ${url.pathname}`);
```

## Info

### IN-01: `verbatimModuleSyntax` is on but barrel re-exports values and types without `export type` separation guarantee

**File:** `packages/db/src/index.ts:5-7`; `packages/db/src/schema/index.ts:9-25`
**Issue:** The base tsconfig sets `verbatimModuleSyntax: true`. The barrels re-export only values (tables, policies, functions), which is fine, but `index.ts`'s comment promises `export type` "for any type-only surface" while none is currently emitted — harmless now, but if a type-only symbol is later added to these `export {}` lists it will fail to compile under `verbatimModuleSyntax`. No action needed today; note for future re-exports.

### IN-02: Anon error message and guard rely on `current_user` equality without schema-qualification robustness

**File:** `packages/db/tests/setup.ts:40-44`
**Issue:** The role guard compares `current_user` string-equal to `app_authenticated`/`anon`. This is correct, but if connection pooling or a future `SET ROLE` sneaks in, `current_user` vs `session_user` can diverge. The guard checks the right one (`current_user`) for now; just be aware that adding any `SET ROLE` later would require re-checking `session_user` too. Informational.

### IN-03: `auth.ts` passes an empty object to `drizzleAdapter({}, ...)` relying on CLI-only usage

**File:** `packages/db/auth.ts:19-21`
**Issue:** `drizzleAdapter({}, { provider: "pg" })` passes `{}` as the db instance, justified by "generate only, never runtime." This is fine for the CLI generate path, but the file is exported as `auth` and the comment says phase-3 runtime "reuses this same config" — at that point `{}` as the db will break at runtime. Leave a hard guard or split the generate-only config from the runtime config before phase 3 to avoid a future foot-gun. No phase-2 impact.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
