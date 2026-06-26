-- 0001_rls.sql — hand-written RLS hardening that Drizzle CANNOT emit (FLAG-2).
--
-- FILENAME RECONCILIATION (W4): RESEARCH §211/§309 names this file "0000_rls.sql" (or
-- "appended"). This plan instead splits it as drizzle-kit-generated 0000_init.sql +
-- hand-written 0001_rls.sql in the SAME single Drizzle journal (RESEARCH §578). This is a
-- naming reconciliation only — the single-history, one-`migrate`-path decision is unchanged.
--
-- Contents (everything pgRole/.enableRLS() cannot express):
--   1. CREATE ROLE app_authenticated / anon with LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
--      NOCREATEROLE (D-04). Idempotent (DO/IF NOT EXISTS) so the test-harness re-apply path
--      does not error on a second run. NOTE (ordering fix): the SAME idempotent CREATE ROLE
--      block is now ALSO prepended to 0000_init.sql, because 0000's generated CREATE POLICY
--      statements reference these roles and 0000 runs first on a fresh DB. Re-creating here is
--      a no-op (IF NOT EXISTS); this block's enduring job on the second pass is the DEV-ONLY
--      env-guarded PASSWORD below, which 0000 deliberately does not set.
--   2. Scoped GRANTs: app gets DML on projects AND member (member is a tenant table, D-02/D-10)
--      plus the fixtures it must read; anon gets SELECT-only on projects (Pitfall 5). Never
--      ownership (D-04).
--   3. ALTER TABLE ... FORCE ROW LEVEL SECURITY on EVERY tenant table — projects AND member
--      (Pitfall 1: the owner/migration role owns the tables and would otherwise bypass RLS).
--
-- PASSWORDS (A5 / WR-04): the app_authenticated and anon roles are created with LOGIN but
-- need a credential to authenticate over TCP from the runtime pools (postgres:16-alpine with
-- POSTGRES_PASSWORD set uses scram-sha-256 for host connections, so a passwordless LOGIN role
-- cannot connect — the .env.example `:dev` strings would otherwise be a lie). drizzle-kit
-- `migrate` runs this SQL through the `postgres` driver (no psql client variables), so we set
-- a DEV-ONLY literal password in an idempotent, env-guarded block below: the ALTER ROLE ...
-- PASSWORD runs ONLY when the server is NOT marked production (current_setting('imbau.env',
-- true) <> 'production'; unset/empty => dev/CI => apply). In production, set the Postgres GUC
-- `imbau.env = 'production'` (e.g. ALTER SYSTEM / postgresql.conf) so this block is skipped and
-- the real credential is provisioned out-of-band via SOPS (phase 4 / INFRA-03). No production
-- secret is ever committed; 'dev' only ever reaches a non-production server.

-- 1. Roles (idempotent; attributes Drizzle pgRole cannot express).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  -- DEV-ONLY credential (WR-04): apply the 'dev' password so the local/CI app & anon pools can
  -- authenticate against Compose Postgres. Guarded to NEVER run in production.
  IF coalesce(current_setting('imbau.env', true), '') <> 'production' THEN
    ALTER ROLE app_authenticated WITH PASSWORD 'dev';
    ALTER ROLE anon WITH PASSWORD 'dev';
  END IF;
END
$$;--> statement-breakpoint

-- 2. Scoped GRANTs (no ownership — D-04).
GRANT USAGE ON SCHEMA public TO app_authenticated, anon;--> statement-breakpoint
GRANT USAGE ON TYPE "public"."estado" TO app_authenticated, anon;--> statement-breakpoint

-- projects: app full DML (RLS scopes it to the active org); anon SELECT-only (Pitfall 5).
GRANT SELECT, INSERT, UPDATE, DELETE ON "projects" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "projects" TO anon;--> statement-breakpoint

-- member: app full DML so plan-03 absence tests can seed-and-assert under RLS (tenant table, D-02/D-10).
GRANT SELECT, INSERT, UPDATE, DELETE ON "member" TO app_authenticated;--> statement-breakpoint

-- organization: app needs read + insert for fixtures (the tenant root rows). The
-- organization_self policy (organization-rls.ts, emitted into 0000_init.sql) scopes both
-- read AND write to the active org's OWN row — `organization` IS a tenant table, keyed by
-- its own id (CR-01 fix). A broad un-RLS'd GRANT here previously let any tenant enumerate
-- every other tenant's name/slug/plan; the policy + FORCE below close that read leak.
GRANT SELECT, INSERT ON "organization" TO app_authenticated;--> statement-breakpoint

-- 3. FORCE ROW LEVEL SECURITY on EVERY tenant table (Pitfall 1). NON-optional for member.
-- organization is FORCE-RLS'd too (CR-01): the owner/migration role owns it and would
-- otherwise bypass the organization_self policy.
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
