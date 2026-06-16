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
--      does not error on a second run.
--   2. Scoped GRANTs: app gets DML on projects AND member (member is a tenant table, D-02/D-10)
--      plus the fixtures it must read; anon gets SELECT-only on projects (Pitfall 5). Never
--      ownership (D-04).
--   3. ALTER TABLE ... FORCE ROW LEVEL SECURITY on EVERY tenant table — projects AND member
--      (Pitfall 1: the owner/migration role owns the tables and would otherwise bypass RLS).
--
-- PASSWORDS (A5): NO password literal is committed here. drizzle-kit `migrate` runs this SQL
-- through the `postgres` driver, which does NOT support psql client variables (colon-prefixed),
-- so a credential cannot be injected at migrate time via this file. Roles are created with LOGIN
-- but no credential; the actual credential is set OUT-OF-BAND at apply time (an owner-run ALTER
-- ROLE statement, or local trust auth in Compose). Real secret management (SOPS) is phase 4.
-- This keeps zero secrets in the repo.

-- 1. Roles (idempotent; attributes Drizzle pgRole cannot express).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
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

-- organization: app needs read + insert for fixtures (the tenant root rows). Not FORCE-RLS'd
-- this phase (organization is the tenant identity table, not tenant-scoped BY organization_id).
GRANT SELECT, INSERT ON "organization" TO app_authenticated;--> statement-breakpoint

-- 3. FORCE ROW LEVEL SECURITY on EVERY tenant table (Pitfall 1). NON-optional for member.
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;
