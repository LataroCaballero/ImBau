-- deploy/bootstrap-roles.sql — staging app/anon role-password provisioning (Pattern 4).
--
-- WHY THIS EXISTS (the repo-discovered deploy break it closes):
--   The RLS migration (packages/db/migrations/0001_rls.sql) CREATEs app_authenticated
--   and anon with LOGIN, but its dev-only `ALTER ROLE ... PASSWORD 'dev'` block is
--   GUARDED by `imbau.env <> 'production'`. Staging Postgres boots with
--   `-c imbau.env=production` (deploy/compose.staging.yml), so that block is SKIPPED
--   and the two roles end up with NO password. Because postgres:16-alpine uses
--   scram-sha-256 for host (TCP) connections, a passwordless LOGIN role cannot
--   authenticate — the app/anon connection pools would boot-fail. This script sets
--   the REAL passwords from SOPS so DATABASE_APP_URL / DATABASE_ANON_URL authenticate.
--
-- HOW IT IS RUN (deploy/deploy.sh, AFTER migrate, BEFORE the app swap):
--   docker compose ... exec -T postgres psql -U imbau -d imbau --no-psqlrc \
--     -v app_pw="$APP_DB_PASSWORD" -v anon_pw="$ANON_DB_PASSWORD" -f - < this file
--   Run as the owner/superuser role `imbau` (POSTGRES_USER), so ALTER ROLE / ALTER
--   DATABASE succeed. The passwords arrive via psql `:'var'` variables (never inlined
--   into the SQL text, never echoed — deploy.sh runs psql without -a/-e), and MUST
--   match the credentials embedded in DATABASE_APP_URL / DATABASE_ANON_URL.
--
-- Idempotent: ALTER ROLE ... PASSWORD is safe to re-run on every deploy.

-- App + anon role passwords from SOPS (psql variables, quoted as literals via :'...').
ALTER ROLE app_authenticated WITH PASSWORD :'app_pw';
ALTER ROLE anon WITH PASSWORD :'anon_pw';

-- Belt-and-suspenders: persist the production gate at the DATABASE level so
-- 0001_rls.sql's dev-password block stays skipped even if the compose `command`
-- (-c imbau.env=production) is ever dropped. A database-scoped setting survives
-- restarts and applies to every new connection to `imbau`.
ALTER DATABASE imbau SET "imbau.env" = 'production';
