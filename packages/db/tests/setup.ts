// Vitest globalSetup — runs ONCE before the whole @imbau/db suite (D-08, registered in
// vitest.config.ts as REQUIRED, not conditional).
//
// Steps (RESEARCH "Harness architecture" §502-509):
//   1. Connect as the OWNER role (TEST_DATABASE_URL / DATABASE_URL) to the dedicated test DB.
//   2. Apply the SAME Drizzle migration journal prod uses (0000_init + 0001_rls) via
//      `migrate(...)`. Because 0001_rls.sql is idempotent (DO/IF NOT EXISTS roles, FORCE RLS),
//      a re-run does not error — so the harness can re-apply on every CI run safely.
//   3. Build per-role app/anon clients (connecting DIRECTLY as those roles — never SET ROLE).
//   4. ROLE GUARD (Pitfall 1 / T-02-14): assert each role connection reports the expected
//      `current_user` AND that pg_roles.rolbypassrls=false AND rolsuper=false. A privileged
//      test role would make the absence assertions pass for the WRONG reason, so we fail the
//      whole suite loudly here before a single test runs.
//
// globalSetup runs in its own module graph (separate from the test files), so it cannot hand
// live client objects to the tests; it does the migrate + guard, then the test file/helpers
// open their own clients from the same env. That is the correct Vitest globalSetup contract.
//
// ENV CONTRACT (D-07, parametrizable for CI): the harness reads its connection strings from
// the environment via ./db — owner = TEST_DATABASE_URL || DATABASE_URL, app =
// TEST_DATABASE_APP_URL || DATABASE_APP_URL, anon = TEST_DATABASE_ANON_URL || DATABASE_ANON_URL.
// Point all of them at a dedicated test DB (e.g. imbau_test); phase 4 swaps them to the CI
// Postgres service unchanged.
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectAs, ownerUrl, appUrl, anonUrl, migrationsFolder } from "./db";

async function assertUnprivileged(
  url: string,
  expectedUser: string,
): Promise<void> {
  const { sql: client, db } = connectAs(url);
  try {
    // current_user as seen by THIS connection (must be the unprivileged role).
    // db.execute<T>() resolves to a directly-indexable RowList<T[]> — index it without
    // re-casting (WR-03: no `as unknown as`). The supplied generic IS the row type.
    const whoRows = await db.execute<{ current_user: string }>(
      sql`select current_user`,
    );
    const actualUser = whoRows[0]?.current_user;
    if (actualUser !== expectedUser) {
      throw new Error(
        `Role guard FAILED: connection reports current_user='${String(actualUser)}', expected '${expectedUser}'. The absence tests are meaningless under the wrong role.`,
      );
    }
    // rolsuper / rolbypassrls MUST both be false — otherwise RLS is silently bypassed.
    const attrRows = await db.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = ${expectedUser}`,
    );
    const attrs = attrRows[0];
    if (!attrs) {
      throw new Error(
        `Role guard FAILED: role '${expectedUser}' not found in pg_roles.`,
      );
    }
    if (attrs.rolsuper || attrs.rolbypassrls) {
      throw new Error(
        `Role guard FAILED: role '${expectedUser}' has rolsuper=${String(attrs.rolsuper)} rolbypassrls=${String(attrs.rolbypassrls)}; both MUST be false (Pitfall 1) or RLS is bypassed and the exit gate is invalid.`,
      );
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

export default async function setup(): Promise<void> {
  // 1 + 2: migrate as owner, applying the exact prod journal (idempotent on re-run).
  const owner = connectAs(ownerUrl());
  try {
    await migrate(owner.db, { migrationsFolder });
  } finally {
    await owner.sql.end({ timeout: 5 });
  }

  // 3 + 4: build app/anon connections and assert they CANNOT bypass RLS.
  await assertUnprivileged(appUrl(), "app_authenticated");
  await assertUnprivileged(anonUrl(), "anon");
}
