// tRPC v11 init (RESEARCH Pattern 3) — the typed root for the @imbau/api router.
//
// `protectedProcedure` is the load-bearing seam (T-03-05): it rejects when there is no
// session OR when `activeOrganizationId` is null (the fresh-signup case — Pitfall 2, which
// org.setActive resolves), and otherwise injects `ctx.activeOrgId` derived SOLELY from
// `session.session.activeOrganizationId`. Downstream resolvers feed that into withTenant;
// a client-supplied orgId is never trusted.
//
// No transformer is configured: the only values crossing the boundary are JSON-native
// (project rows are strings/enums). Add superjson only if a Date/Map must cross.
import { initTRPC, TRPCError } from "@trpc/server";
import { QuoteError } from "@imbau/quoting";
import { createTRPCContext, type TRPCContext } from "./context";

// errorFormatter (RESEARCH Pattern 3 — trpc.io/docs/server/error-formatting) surfaces the
// quoting engine's MACHINE-READABLE code to the client without ever leaking the error object or
// stack (D-08, V7). When a resolver re-throws a TRPCError whose `cause` is a QuoteError, the
// client can read `error.data.quoteErrorCode` and map it to es-AR copy; for any other error the
// field is simply absent. This is the ONLY behavior added to the tRPC root.
const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        quoteErrorCode: cause instanceof QuoteError ? cause.code : undefined,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

// Authenticated + active-org gate. Throws UNAUTHORIZED for an anonymous caller or a session
// with no active organization (Pitfall 2), then narrows ctx with a server-derived activeOrgId.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const session = ctx.session;
  if (!session?.session?.activeOrganizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      // Authoritative tenant — derived server-side from the session only.
      activeOrgId: session.session.activeOrganizationId,
      // Narrowed, definitely-present session for downstream resolvers/middleware.
      session,
    },
  });
});

export { createTRPCContext };
export type { TRPCContext };
