// Worker integration-test DB plumbing (MEDIA-04) — connection-string resolution + the dedicated
// `_test` guard, mirroring packages/db/tests/db.ts so the same env contract (D-07) re-points the
// suite at the GitHub Actions Postgres service unchanged in CI.
//
// We reuse @imbau/db's createOwnerDb factory to build the OWNER client (used by the harness to
// migrate + seed fixtures) and to open a directly-connected app_authenticated client for the
// role guard. createOwnerDb connects DIRECTLY as whatever role the URL carries — never SET ROLE
// — which is exactly what makes RLS apply (an owner/BYPASSRLS connection would silently defeat
// the tenant policies; the role guard in setup.ts proves the app URL is NOT privileged).
//
// migrationsFolder resolves the SHARED @imbau/db journal by a fixed monorepo-relative path
// (apps/worker/tests -> repo root -> packages/db/migrations) so the worker applies the exact
// same DDL prod uses, idempotently.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createOwnerDb } from "@imbau/db";

const here = dirname(fileURLToPath(import.meta.url));
// apps/worker/tests -> apps/worker -> apps -> <repo root> -> packages/db/migrations
export const migrationsFolder = resolve(
  here,
  "..",
  "..",
  "..",
  "packages",
  "db",
  "migrations",
);

// Resolve a test connection string: an explicit test-only override (TEST_DATABASE_*) wins,
// otherwise the standard role URL (DATABASE_*). Throws with the variable NAME (never a value —
// V7) so a misconfigured CI/local run fails loudly instead of silently hitting the wrong DB.
function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  throw new Error(
    `Missing test DB connection string: set one of ${names.join(" / ")} to a dedicated test database (e.g. imbau_test).`,
  );
}

// The harness runs migrate() + seeds fixtures, so it must NEVER target the dev/prod `imbau` DB.
// Assert the resolved database name ends in `_test` before any connection string is handed out.
// We parse the name (never log the value — V7).
function requireTestDb(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(
      "Test DB connection string is not a valid URL; refusing to run migrate/seed.",
    );
  }
  const dbName = pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run worker integration tests against non-test database "${dbName}": the test DB name must end in "_test" (e.g. imbau_test). Set TEST_DATABASE_URL / TEST_DATABASE_APP_URL to a dedicated test database.`,
    );
  }
  return url;
}

export const ownerUrl = () =>
  requireTestDb(requireEnv("TEST_DATABASE_URL", "DATABASE_URL"));
export const appUrl = () =>
  requireTestDb(requireEnv("TEST_DATABASE_APP_URL", "DATABASE_APP_URL"));

// Build a drizzle + raw client for a given role URL via @imbau/db's createOwnerDb factory. The
// returned shape is { client, db } — `client` is the postgres-js handle (call .end() to close),
// `db` is the schema-typed drizzle instance.
export function connectAs(url: string) {
  return createOwnerDb(url);
}
