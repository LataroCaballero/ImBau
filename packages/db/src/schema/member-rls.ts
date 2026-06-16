// member RLS overlay — the SECOND tenant table this phase (D-02/D-10).
//
// SCOPE BOUNDARY: `projects` AND `member` are the ONLY tenant-scoped tables in phase 2.
// `member` carries organization_id and is genuine tenant data, so the milestone exit gate
// must prove org A cannot read org B's `member` rows (not just projects). The other Better
// Auth tables — user / session / account / verification / invitation — are NOT scoped by
// organization_id and intentionally get NO tenant policy this phase (that is precisely why
// "every tenant table" == projects + member). This module pulls in NO SCHEMA-01 domain
// table; `member` was always in the D-10 phase-2 set.
//
// WHY A SEPARATE MODULE: auth-schema.ts is a faithful Better Auth fold and must not be
// hand-edited to add policies. Drizzle's `pgPolicy(...).link(table)` attaches the tenant
// policy to the already-defined `member` table from here; drizzle-kit then emits ENABLE
// ROW LEVEL SECURITY + the policy for `member` in the generated migration. FORCE ROW LEVEL
// SECURITY (which Drizzle cannot emit — FLAG-2) is hand-written in 0001_rls.sql.
import { pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { member } from "./auth-schema";
import { appAuthenticated } from "./roles";

// member tenant policy (D-02/D-05). The GUC cast is `::text` — IDENTICAL to projects_tenant
// (projects.ts) — because organization.id (hence member.organization_id) is TEXT, the
// reconciliation of D-05's literal `::uuid` against the real id type (Pitfall 2). `withCheck`
// rejects cross-tenant member writes; the second arg `true` (missing_ok) keeps default-deny
// when the GUC is unset. No anon policy: `member` is tenant-scoped only (the anon published
// path is a projects concern — D-06/D-11).
export const memberTenant = pgPolicy("member_tenant", {
  as: "permissive",
  for: "all",
  to: appAuthenticated,
  using: sql`${member.organizationId} = current_setting('app.current_organization_id', true)::text`,
  withCheck: sql`${member.organizationId} = current_setting('app.current_organization_id', true)::text`,
}).link(member);

// Re-export the policy-decorated `member` so the barrel/migration sees the RLS overlay.
export { member };

// NOTE on enableRLS: for an EXTERNALLY-defined table (member lives in the faithful
// auth-schema fold), the correct Drizzle API is `pgPolicy(...).link(member)` above — a
// linked policy makes drizzle-kit emit `ALTER TABLE "member" ENABLE ROW LEVEL SECURITY`
// in the generated migration (verified in migrations/0000_init.sql). We do NOT call
// `member.enableRLS()` here because that returns a divergent table instance and would
// break the policy's link to the canonical `member`. ENABLE RLS is thus driven by the
// link, not a separate enableRLS() call; FORCE RLS is hand-written in 0001_rls.sql (FLAG-2).
