// Test-harness DB plumbing for @imbau/api — reuses the phase-2 owner-connection contract.
//
// Like packages/db/tests/db.ts, every connection string is read from process.env so phase 4
// (CI-02) re-points the suite at the GitHub Actions Postgres service unchanged. The harness
// connects as the OWNER role only (the auth runtime's A1 pool); it migrates nothing (the
// phase-2 journal already created the auth tables) and asserts the target DB name ends in
// `_test` so a misconfigured run can never write fixtures into the dev/prod `imbau` DB.
import postgres from "postgres";

// Resolve the owner test URL: an explicit TEST_DATABASE_URL wins, else DATABASE_URL. Throws
// with the variable NAME (never a value — V7) when neither is set.
function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  throw new Error(
    `Missing test DB connection string: set one of ${names.join(" / ")} to a dedicated test database (e.g. imbau_test).`,
  );
}

// The harness writes fixtures, so it must NEVER target the dev/prod `imbau` DB. Assert the
// resolved database name ends in `_test` before any connection string is handed out (parse
// the name, never log the value — V7).
function requireTestDb(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(
      "Test DB connection string is not a valid URL; refusing to run fixtures.",
    );
  }
  const dbName = pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against non-test database "${dbName}": the test DB name must end in "_test" (e.g. imbau_test). Set TEST_DATABASE_URL / DATABASE_URL to a dedicated test database.`,
    );
  }
  return url;
}

// The owner/migration URL — the SAME role the auth runtime's adapter uses (A1). The auth
// runtime reads it from env.DATABASE_URL; the harness reads it (with a test override) here.
export const ownerUrl = (): string =>
  requireTestDb(requireEnv("TEST_DATABASE_URL", "DATABASE_URL"));

// A raw postgres client on the owner URL — used by fixtures to assert rows landed and to
// clean up. `max: 1` keeps behaviour deterministic.
export function ownerSql(): ReturnType<typeof postgres> {
  return postgres(ownerUrl(), { max: 1 });
}
