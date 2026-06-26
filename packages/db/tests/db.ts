// Shared test-harness DB plumbing — connection-string resolution + per-role client builders.
//
// PARAMETRIZED BY ENV (D-07): every connection string is read from process.env so phase 4
// (CI-02) re-points the same suite at the GitHub Actions Postgres service UNCHANGED. All
// three roles target a DEDICATED test DB (default `imbau_test`) — NEVER the dev/prod `imbau`
// DB — so the suite's migrate + seed can never touch real data. We read raw process.env here
// (not the package `env.ts`) because the test endpoint is intentionally a different DB and
// must be overridable per environment without tripping the app's fail-fast app/anon URLs.
//
// `migrationsFolder` is resolved from this file's location (import.meta.url) so it works the
// same whether run from the package dir or the repo root.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/schema";

const here = dirname(fileURLToPath(import.meta.url));
// packages/db/tests -> packages/db/migrations
export const migrationsFolder = resolve(here, "..", "migrations");

// Resolve a test connection string with a clear precedence:
//   1. an explicit test-only override (e.g. TEST_DATABASE_URL) if present,
//   2. otherwise the standard role URL (DATABASE_URL / DATABASE_APP_URL / DATABASE_ANON_URL).
// Throws with the variable NAME (never a value — V7) if neither is set, so a misconfigured
// CI/local run fails loudly instead of silently hitting the wrong DB.
function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  throw new Error(
    `Missing test DB connection string: set one of ${names.join(" / ")} to a dedicated test database (e.g. imbau_test).`,
  );
}

// WR-06: the precedence above intentionally allows a fallback to the prod-shaped DATABASE_URL
// (so phase-4 CI can point a single var set at its service). But the harness runs `migrate()`
// and seeds fixtures, so it must NEVER target the dev/prod `imbau` DB. Assert the resolved
// database name ends in `_test` before any connection string is handed out — a misconfigured
// run (only DATABASE_URL=...//imbau set) then fails loudly instead of silently writing fixture
// orgs/projects/members/users into real data. We parse the name (never log the value — V7).
function requireTestDb(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(
      "Test DB connection string is not a valid URL; refusing to run migrate/seed.",
    );
  }
  // pathname is "/<dbname>" (possibly with extra segments); take the db name segment.
  const dbName = pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against non-test database "${dbName}": the test DB name must end in "_test" (e.g. imbau_test). Set TEST_DATABASE_URL / TEST_DATABASE_APP_URL / TEST_DATABASE_ANON_URL to a dedicated test database.`,
    );
  }
  return url;
}

export const ownerUrl = () =>
  requireTestDb(requireEnv("TEST_DATABASE_URL", "DATABASE_URL"));
export const appUrl = () =>
  requireTestDb(requireEnv("TEST_DATABASE_APP_URL", "DATABASE_APP_URL"));
export const anonUrl = () =>
  requireTestDb(requireEnv("TEST_DATABASE_ANON_URL", "DATABASE_ANON_URL"));

export type RoleClient = {
  sql: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle<typeof schema>>;
};

// Build a drizzle instance + raw client for a given connection string. `max: 1` keeps the
// pool to a single connection so `current_user` / GUC behaviour is deterministic per role.
export function connectAs(url: string): RoleClient {
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
