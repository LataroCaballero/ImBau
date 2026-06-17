// organization RLS overlay — CR-01 fix: close the cross-tenant read leak on the tenant
// identity table itself.
//
// SCOPE: `organization` IS the tenant boundary — its own `id` equals the active tenant GUC.
// Before this overlay, `organization` was granted SELECT/INSERT to app_authenticated with NO
// RLS, so any tenant could `SELECT * FROM organization` and read every OTHER tenant's name,
// slug, plan, logo and metadata (CR-01). CLAUDE.md mandates "RLS en toda tabla con tenant";
// organization is exactly such a table, scoped by its own id.
//
// WHY A SEPARATE MODULE (identical rationale to member-rls.ts): auth-schema.ts is a faithful
// Better Auth fold and must not be hand-edited to add policies. Drizzle's
// `pgPolicy(...).link(table)` attaches the tenant policy to the already-defined `organization`
// table from here; drizzle-kit then emits ENABLE ROW LEVEL SECURITY + the policy for
// `organization` in the generated migration. FORCE ROW LEVEL SECURITY (which Drizzle cannot
// emit — FLAG-2) is hand-written in 0001_rls.sql alongside the projects/member FORCE statements.
//
// Fixture path is unaffected: makeOrg seeds via the OWNER, which bypasses RLS for setup.
import { pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { appAuthenticated } from "./roles";

// organization self policy (CR-01). The tenant key is the row's OWN id (TEXT, Better Auth
// default), compared against the GUC cast `::text` — IDENTICAL cast to member_tenant /
// projects_tenant (Pitfall 2). `using` blocks cross-tenant reads; `withCheck` blocks a tenant
// from inserting/updating an organization row that is not its own active org. The second arg
// `true` (missing_ok) keeps default-deny when the GUC is unset (e.g. unauthenticated path).
export const organizationSelf = pgPolicy("organization_self", {
  as: "permissive",
  for: "all",
  to: appAuthenticated,
  using: sql`${organization.id} = current_setting('app.current_organization_id', true)::text`,
  withCheck: sql`${organization.id} = current_setting('app.current_organization_id', true)::text`,
}).link(organization);

// Re-export the policy-decorated `organization` so the barrel/migration sees the RLS overlay.
export { organization };

// NOTE on enableRLS: same as member-rls.ts — for an EXTERNALLY-defined table (organization
// lives in the faithful auth-schema fold), the correct Drizzle API is
// `pgPolicy(...).link(organization)` above, which makes drizzle-kit emit `ALTER TABLE
// "organization" ENABLE ROW LEVEL SECURITY` in the generated migration. We do NOT call
// `organization.enableRLS()` (that returns a divergent table instance and would break the
// policy link). FORCE RLS is hand-written in 0001_rls.sql (FLAG-2).
