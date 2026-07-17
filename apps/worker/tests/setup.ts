// Vitest globalSetup for the worker integration suite (MEDIA-04) — runs ONCE before the whole
// @imbau/worker suite. Mirrors packages/db/tests/setup.ts:
//   1. Connect as the OWNER role (TEST_DATABASE_URL / DATABASE_URL) to the dedicated `_test` DB.
//   2. Apply the SAME shared @imbau/db migration journal prod uses via migrate(...). The RLS
//      migrations are idempotent (DO/IF NOT EXISTS roles, FORCE RLS), so re-running is safe.
//   3. ROLE GUARD (Pitfall 1 / A8 / T-02-12): assert the app connection reports
//      current_user='app_authenticated' AND rolsuper=false AND rolbypassrls=false. A privileged
//      role would make the write-back's RLS scoping meaningless, so we fail the WHOLE suite here
//      before a single test runs.
//
// globalSetup runs in its own module graph (separate from the test files), reading its connection
// strings from process.env via ./db — so the env contract (D-07) is parametrizable: owner =
// TEST_DATABASE_URL || DATABASE_URL, app = TEST_DATABASE_APP_URL || DATABASE_APP_URL.
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectAs, ownerUrl, appUrl, migrationsFolder } from "./db";

async function assertUnprivileged(
  url: string,
  expectedUser: string,
): Promise<void> {
  const { client, db } = connectAs(url);
  try {
    // current_user as seen by THIS connection (must be the unprivileged app role).
    const whoRows = await db.execute<{ current_user: string }>(
      sql`select current_user`,
    );
    const actualUser = whoRows[0]?.current_user;
    if (actualUser !== expectedUser) {
      throw new Error(
        `Role guard FAILED: connection reports current_user='${String(actualUser)}', expected '${expectedUser}'. The worker write-back's RLS scoping is meaningless under the wrong role.`,
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
        `Role guard FAILED: role '${expectedUser}' has rolsuper=${String(attrs.rolsuper)} rolbypassrls=${String(attrs.rolbypassrls)}; both MUST be false (Pitfall 1) or the media write-back silently bypasses RLS.`,
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
    await owner.client.end({ timeout: 5 });
  }

  // 3: the worker's write-back runs as app_authenticated (A8) — assert it CANNOT bypass RLS.
  await assertUnprivileged(appUrl(), "app_authenticated");
}
