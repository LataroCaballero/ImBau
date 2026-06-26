// Public barrel for @imbau/api — auth runtime + the tRPC API surface (D-01/D-07/D-08).
//
// The Better Auth runtime (auth), the composed appRouter + its AppRouter type, the tRPC
// primitives (procedures + context factory), and a convenience `createCaller` that builds the
// session-derived context and returns a fully-typed server caller (RSC reads in panel/web,
// integration tests). JIT package: raw .ts re-exports, `export type` for type-only surface
// (verbatimModuleSyntax).
import { createCallerFactory, createTRPCContext } from "./trpc/init";
import { appRouter } from "./trpc/routers/_app";
import type { CreateContextOptions } from "./trpc/context";

export { auth } from "./auth/runtime";
export type { Auth } from "./auth/runtime";
export { ac, owner, developer, viewer } from "./auth/access-control";

export { appRouter } from "./trpc/routers/_app";
export type { AppRouter } from "./trpc/routers/_app";

export {
  router,
  publicProcedure,
  protectedProcedure,
  createCallerFactory,
  createTRPCContext,
} from "./trpc/init";
export { requireRole } from "./trpc/middleware";
export type { AppRole } from "./trpc/middleware";
export type { CreateContextOptions, TRPCContext } from "./trpc/context";

const callerFactory = createCallerFactory(appRouter);

// Build a server-side caller from request headers: resolves the Better Auth session (and thus
// the server-derived tenant) then returns a typed caller. Used by RSC reads and tests.
export async function createCaller(opts: CreateContextOptions) {
  const ctx = await createTRPCContext(opts);
  return callerFactory(ctx);
}
