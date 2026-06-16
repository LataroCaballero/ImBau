// Postgres connection pools + drizzle instances, one per Postgres ROLE (D-04 / D-06).
//
// The app pool connects DIRECTLY as `app_authenticated` (D-04) — we NEVER `SET ROLE`.
// The anon pool connects DIRECTLY as `anon` (D-06). Both URLs come from the validated
// `env` (./env), NOT raw process.env, so a missing/invalid URL fails closed at import
// with the variable NAME (never the value — V7). Connecting as the unprivileged role is
// what makes RLS actually apply: a superuser/BYPASSRLS connection would silently defeat
// the tenant policies (Pitfall 1).
//
// RESEARCH Pattern 3 §332-343 is the source of truth for this shape.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "./env";

// App pool: user=app_authenticated. Tenant-scoped via the GUC set in withTenant().
const appClient = postgres(env.DATABASE_APP_URL);
// Anon pool: user=anon. Sees only estado='publicado' projects (no tenant GUC).
const anonClient = postgres(env.DATABASE_ANON_URL);

export const appDb = drizzle(appClient, { schema });
export const anonDb = drizzle(anonClient, { schema });

// Owner/migration-pool factory. The app module must NOT hard-depend on the owner URL
// (only the migration tooling + the test harness need owner privileges), so we expose a
// small factory that takes an explicit URL. The test harness uses this to build an owner
// client for programmatic migrate + fixture seeding (D-08); the app runtime never calls it.
export function createOwnerDb(url: string) {
  const ownerClient = postgres(url);
  return { client: ownerClient, db: drizzle(ownerClient, { schema }) };
}
