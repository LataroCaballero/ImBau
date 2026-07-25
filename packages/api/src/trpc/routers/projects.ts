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
//
// getForOrg + updateSettings (phase 9, PANEL-01/PANEL-02) establish the panel write mold that
// D1/D2/hotspots clone: a single-project resolver and ONE real canary mutation gated by
// requireRole("owner","developer") over withTenant. Both take an untrusted `id` validated with
// z.uuid() at the boundary (so Postgres never raises 22P02), and both route exclusively through
// withTenant — never the elevated owner pool. updateSettings uses .returning() + a 0-row NOT_FOUND
// guard because a cross-org/non-existent id is INVISIBLE under RLS, so the UPDATE affects 0 rows
// WITHOUT erroring; the guard turns that silent no-op into NOT_FOUND (no-enumeration: identical to
// the cross-org response — D-07, RESEARCH Pitfall 1).
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, withAnon, schema } from "@imbau/db";
import { router, protectedProcedure, publicProcedure } from "../init";
import { requireRole } from "../middleware";

export const projectsRouter = router({
  // Active-org projects (RLS via the session-derived tenant). No client orgId is read.
  listForOrg: protectedProcedure.query(({ ctx }) =>
    withTenant(ctx.activeOrgId, (tx) => tx.select().from(schema.projects)),
  ),
  // Single active-org project by id. RLS filters to the active org, so a cross-org or
  // non-existent id yields zero rows → null (the RSC translates null → notFound — D-07).
  getForOrg: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await withTenant(ctx.activeOrgId, (tx) =>
        tx.select().from(schema.projects).where(eq(schema.projects.id, input.id)),
      );
      return rows[0] ?? null;
    }),
  // The panel write mold (SC-4): requireRole("owner","developer") over withTenant. Toggles
  // estado borrador↔publicado (the real, observable canary — D-05). A viewer is rejected with
  // FORBIDDEN by requireRole before the UPDATE ever runs. A cross-org/non-existent id is invisible
  // under RLS → 0 rows updated → NOT_FOUND via the .returning() guard (never a silent success).
  updateSettings: requireRole("owner", "developer")
    .input(
      z.object({
        id: z.uuid(),
        // estado is now optional so the mutation can also patch leadsNotifyEmail alone (D-05);
        // the Phase 9 canary always sends estado, so its path is unchanged.
        estado: z.enum(["borrador", "publicado"]).optional(),
        // Lead-notification recipient (D-05, phase 11). Zod .email() at the boundary (malformed →
        // 400); nullable so an owner can clear it back to the org-owners fallback. The actual send
        // recipient is resolved server-side in the worker — never client-controlled at send time.
        leadsNotifyEmail: z.email().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Write ONLY the provided keys so a partial patch never nulls a sibling column.
      const values: {
        estado?: "borrador" | "publicado";
        leadsNotifyEmail?: string | null;
      } = {};
      if (input.estado !== undefined) values.estado = input.estado;
      if (input.leadsNotifyEmail !== undefined)
        values.leadsNotifyEmail = input.leadsNotifyEmail;
      if (Object.keys(values).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No hay cambios para aplicar.",
        });
      }
      const rows = await withTenant(ctx.activeOrgId, (tx) =>
        tx
          .update(schema.projects)
          .set(values)
          .where(eq(schema.projects.id, input.id))
          .returning({
            id: schema.projects.id,
            estado: schema.projects.estado,
            leadsNotifyEmail: schema.projects.leadsNotifyEmail,
          }),
      );
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return rows[0];
    }),
  // Anonymous, published-only (no tenant GUC; anon policy filters to publicado).
  listPublished: publicProcedure.query(() =>
    withAnon((tx) => tx.select().from(schema.projects)),
  ),
});
