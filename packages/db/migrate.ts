// packages/db/migrate.ts — programmatic drizzle-orm migrator for runtime images (INFRA-02 / D-07).
//
// Applies the SAME Drizzle journal the test harness uses (packages/db/migrations: 0000_init +
// idempotent 0001_rls) against the staging DB, connecting as the OWNER role from the raw
// DATABASE_URL. This is the migrate-before-swap gate: deploy.sh (plan 04-06) runs this image via
// `docker compose run --rm migrate` and a non-zero exit ABORTS the deploy before the app swap.
//
// Why the OWNER role: 0001_rls.sql runs CREATE ROLE / ALTER ROLE / FORCE ROW LEVEL SECURITY,
// which only the table-owning migration role may execute (the staging Postgres POSTGRES_USER).
//
// Why raw process.env.DATABASE_URL (and NOT packages/db/src/env.ts): the env module fails closed
// unless ALL THREE role URLs (owner/app/anon) are present, but this one-off runner only ever needs
// the owner URL. Reading the raw var keeps the migrate image minimal — it does not carry the
// app/anon connection strings.
//
// Why the drizzle-orm migrator (and NOT the drizzle-kit CLI): drizzle-kit is a devDependency,
// absent from the pruned runtime image. drizzle-orm/postgres-js/migrator only needs the
// migrations folder, which ships in the pruned @imbau/db tree.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// packages/db/migrate.ts -> packages/db/migrations (resolved from import.meta.url so it works the
// same whether invoked from the package dir, the repo root, or inside the container's /app).
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Fail loudly with the variable NAME (never the value — V7) so a misconfigured deploy aborts
  // the migrate gate instead of silently no-op'ing and letting a half-configured app swap in.
  throw new Error(
    "Missing DATABASE_URL: the migrate runner needs the OWNER-role connection string to apply the journal.",
  );
}

// OWNER role, single connection (max: 1) keeps DDL + CREATE ROLE execution deterministic.
const sql = postgres(databaseUrl, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder });
} finally {
  await sql.end({ timeout: 5 });
}
