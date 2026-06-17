// org router (D-07, Pitfall 2) — organization listing + active-org selection.
//
// list: the caller's organizations, via the org plugin's listOrganizations (reads the
// caller's memberships through the auth runtime). Used by the panel org-picker.
// setActive: closes the fresh-signup gap (Pitfall 2) — Better Auth does NOT auto-set
// session.activeOrganizationId, so a just-signed-up user has a null active org and cannot
// reach any protectedProcedure. setActive writes it. We validate server-side that the caller
// is a MEMBER of the target org before delegating (the plugin also enforces membership, but we
// fail fast with a clear FORBIDDEN and never trust the input beyond the membership check).
//
// All org/membership state lives in Better Auth; this router delegates to auth.api with the
// request headers (so nextCookies() can re-issue the session cookie on the route-handler path).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { withTenant, schema } from "@imbau/db";
import { auth } from "../../auth/runtime";
import { router, protectedProcedure } from "../init";

export const orgRouter = router({
  // The caller's organizations (memberships resolved by the org plugin).
  list: protectedProcedure.query(({ ctx }) =>
    auth.api.listOrganizations({ headers: ctx.headers }),
  ),

  // Set the active organization for the session. Validates membership server-side first.
  setActive: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Membership check inside the CURRENT active tenant is not enough (we may be switching
      // away from it), so verify membership of the TARGET org via the elevated read the auth
      // runtime owns. We do it through the app path by scoping withTenant to the target org and
      // confirming a member row for this user exists there (RLS makes this a self-scoped read).
      const rows = await withTenant(input.organizationId, (tx) =>
        tx
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.userId, ctx.session.user.id),
              eq(schema.member.organizationId, input.organizationId),
            ),
          ),
      );
      if (rows.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return auth.api.setActiveOrganization({
        body: { organizationId: input.organizationId },
        headers: ctx.headers,
      });
    }),
});
