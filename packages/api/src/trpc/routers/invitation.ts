// invitation router (D-07 / D-10, AUTH-03) — accept a pending invitation.
//
// accept is protected (the invitee must be signed in — D-10: new users sign up first, then
// accept). It delegates to the org plugin's acceptInvitation, which writes the member row with
// the invited role and (in 1.6.18) sets the accepted org active. The invitationId is Zod-4
// validated (T-03-07). Note: a freshly-signed-up invitee may have a null active org, so accept
// must NOT require an active org — but protectedProcedure does require one. We therefore gate on
// session presence only here via a dedicated procedure (see comment) rather than activeOrg.
//
// Reconciliation: the panel accept page signs the user in (giving a session) and the org-plugin
// acceptInvitation sets the org active as part of accepting, so requiring activeOrg on accept
// would be a chicken-and-egg. We expose accept on a session-only gate (sessionProcedure) so a
// just-signed-up invitee (null active org) can accept; the org becomes active as a side effect.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { auth } from "../../auth/runtime";
import { router, publicProcedure } from "../init";

// Session-only gate: requires an authenticated user but NOT an active org (the invitee may have
// none yet — accepting is exactly what gives them their first org). Distinct from
// protectedProcedure, which requires an active org.
const sessionProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const invitationRouter = router({
  accept: sessionProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      auth.api.acceptInvitation({
        body: { invitationId: input.invitationId },
        headers: ctx.headers,
      }),
    ),
});
