// projects router (D-07) — the panel/web read seam (RESEARCH Pattern 4).
//
// listForOrg: protected. Routes through withTenant(ctx.activeOrgId) so RLS returns ONLY the
// active org's rows. There is NO app-layer `where organization_id = ...` — the projects_tenant
// policy does the filtering, which is what the cross-tenant absence test proves (T-03-05).
// listPublished: public. Routes through withAnon so the anon policy returns ONLY
// estado='publicado' rows (borrador/archivado are invisible — D-06/D-11).
//
// This router imports ONLY withTenant/withAnon/schema from @imbau/db — never createOwnerDb/appDb
// (T-03-09); grep-verified in the plan's verification.
import { withTenant, withAnon, schema } from "@imbau/db";
import { router, protectedProcedure, publicProcedure } from "../init";

export const projectsRouter = router({
  // Active-org projects (RLS via the session-derived tenant). No client orgId is read.
  listForOrg: protectedProcedure.query(({ ctx }) =>
    withTenant(ctx.activeOrgId, (tx) => tx.select().from(schema.projects)),
  ),
  // Anonymous, published-only (no tenant GUC; anon policy filters to publicado).
  listPublished: publicProcedure.query(() =>
    withAnon((tx) => tx.select().from(schema.projects)),
  ),
});
