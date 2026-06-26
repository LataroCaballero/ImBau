// requireRole (D-06) — role enforcement on top of protectedProcedure.
//
// The caller's role is read from `member.role` for the ACTIVE org, inside
// `withTenant(ctx.activeOrgId, ...)` — so the lookup itself runs as the unprivileged
// app_authenticated role, scoped by the member_tenant RLS policy (defense in depth: the
// query can only ever see the caller's own org's member rows). If the caller has no
// membership in the active org, or its role is not in `allowed`, we throw FORBIDDEN
// (T-03-06). member.invite is built on `requireRole("owner")`.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@imbau/db";
import { protectedProcedure } from "./init";

export type AppRole = "owner" | "developer" | "viewer";

export function requireRole(...allowed: AppRole[]) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const rows = await withTenant(ctx.activeOrgId, (tx) =>
      tx
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(eq(schema.member.userId, ctx.session.user.id)),
    );
    const role = rows[0]?.role;
    if (!role || !allowed.includes(role as AppRole)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx: { ...ctx, role: role as AppRole } });
  });
}
