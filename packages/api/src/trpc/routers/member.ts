// member router (D-07 / D-12, AUTH-03) — owner-only member invitation.
//
// invite is built on requireRole("owner"): a developer/viewer caller is rejected with FORBIDDEN
// (T-03-06) before any work happens. For an owner, it delegates to the org plugin's
// createInvitation (the 1.6.18 endpoint that the owner's invitation:create permission gates —
// see 03-01 access-control), which fires sendInvitationEmail (console stub in dev, real Resend
// in 03-03). The invited role DEFAULTS to "viewer" (least privilege — D-12); the owner may pick
// developer/viewer/owner. Input is Zod-4 validated (T-03-07): a malformed email never reaches
// the plugin. The target org is the caller's ACTIVE org (derived server-side); a client orgId is
// never read here.
import { z } from "zod";
import { auth } from "../../auth/runtime";
import { router } from "../init";
import { requireRole } from "../middleware";

export const memberRouter = router({
  invite: requireRole("owner")
    .input(
      z.object({
        email: z.email(),
        role: z.enum(["owner", "developer", "viewer"]).default("viewer"),
      }),
    )
    .mutation(({ ctx, input }) =>
      auth.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: ctx.activeOrgId,
        },
        headers: ctx.headers,
      }),
    ),
});
