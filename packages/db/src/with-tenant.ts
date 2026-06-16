// withTenant / withAnon — the ONLY sanctioned data-access helpers (DATA-03, D-04/D-05/D-06).
//
// withTenant runs `fn` inside a single transaction on the app pool. Its FIRST statement
// sets the tenant GUC `app.current_organization_id` via `set_config(name, ${orgId}, true)`
// with `orgId` bound as a PARAMETER — never string-concatenated into a `SET LOCAL`
// statement (FLAG-3 / Pitfall 4 / Specific Ideas). `SET LOCAL` cannot bind a parameter;
// `set_config(..., true)` (is_local=true) can, and is equally transaction-scoped — the GUC
// auto-clears at commit/rollback, so it can NEVER bleed across requests on a pooled
// connection (Pitfall 4). Every query inside `fn` runs as `app_authenticated` filtered to
// the active org by the projects_tenant / member_tenant policies.
//
// withAnon runs `fn` inside an anon-pool transaction with NO tenant GUC; the anon policy
// filters projects to estado='publicado' globally (D-06).
//
// RESEARCH Pattern 3 §345-362 is the source of truth.
import { sql } from "drizzle-orm";
import { appDb, anonDb } from "./client";

type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];
type AnonTx = Parameters<Parameters<typeof anonDb.transaction>[0]>[0];

export async function withTenant<T>(
  orgId: string,
  fn: (tx: AppTx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    // PARAMETERIZED bind — orgId is a value, never interpolated SQL (FLAG-3). The third
    // arg `true` (is_local) scopes the GUC to this transaction only.
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${orgId}, true)`,
    );
    return fn(tx);
  });
}

export async function withAnon<T>(fn: (tx: AnonTx) => Promise<T>): Promise<T> {
  // No GUC set; anon policies filter estado='publicado' globally (D-06).
  return anonDb.transaction(async (tx) => fn(tx));
}
