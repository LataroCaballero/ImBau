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
// Both procedures gate on a SESSION-ONLY procedure (authenticated user, NOT an active org) —
// the exact opposite of protectedProcedure (WR-02). The whole point of list/setActive is to
// serve the null-active-org caller (a just-signed-up or just-invited user picking their first
// org); protectedProcedure throws UNAUTHORIZED for that caller before the input is ever read,
// making setActive unreachable for the very case it exists to handle. This mirrors the
// session-only gate invitation.accept uses for the same chicken-and-egg reason.
//
// All org/membership state lives in Better Auth; this router delegates to auth.api with the
// request headers (so nextCookies() can re-issue the session cookie on the route-handler path).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { withTenant, schema } from "@imbau/db";
import { auth } from "../../auth/runtime";
import { router, publicProcedure } from "../init";

// Session-only gate: requires an authenticated user but NOT an active org (the caller may have
// none yet — picking one is exactly what setActive does). Distinct from protectedProcedure,
// which requires an active org. Same pattern as invitation.accept's sessionProcedure.
const sessionProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const orgRouter = router({
  // The caller's organizations (memberships resolved by the org plugin). Session-only: a caller
  // with no active org must still be able to list orgs in order to pick one.
  list: sessionProcedure.query(({ ctx }) =>
    auth.api.listOrganizations({ headers: ctx.headers }),
  ),

  // Set the active organization for the session. Validates membership server-side first.
  setActive: sessionProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Membership check inside the CURRENT active tenant is not enough (we may be switching
      // away from it, or have no active tenant at all), so verify membership of the TARGET org
      // through the APP path — NOT the elevated owner pool (A1). withTenant scopes RLS to the
      // target org, so confirming a member row for this user exists there is a self-scoped read
      // that cannot leak across tenants.
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
