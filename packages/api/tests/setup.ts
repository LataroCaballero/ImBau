// Vitest globalSetup for @imbau/api — runs ONCE before the suite.
//
// Unlike packages/db's setup, this harness does NOT migrate and does NOT require the app/anon
// role URLs: the auth runtime's adapter only ever uses the OWNER pool (A1), and the phase-2
// migration journal already created every auth table in the dedicated `_test` DB. So setup's
// job is narrow: confirm the owner connection reaches a `_test` DB that already has the auth
// tables, failing loudly (with the table NAME, never a value — V7) if the journal was not
// applied. Migrations stay owned by packages/db; we never re-run or add one here.
import { ownerSql } from "./db";

export default async function setup(): Promise<void> {
  const sqlc = ownerSql();
  try {
    // The owner URL already passed the `_test` guard in ownerUrl(). Assert the auth tables the
    // runtime writes exist; a missing table means the phase-2 journal was not applied to this DB.
    const rows = await sqlc<{ present: number }[]>`
      select count(*)::int as present
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('user','session','organization','member','invitation')
    `;
    const present = rows[0]?.present ?? 0;
    if (present < 5) {
      throw new Error(
        `Auth tables missing in the test DB (found ${present}/5 of user/session/organization/member/invitation). Apply the phase-2 Drizzle migration journal to the _test DB first (pnpm --filter @imbau/db db:migrate against imbau_test).`,
      );
    }
  } finally {
    await sqlc.end({ timeout: 5 });
  }
}
