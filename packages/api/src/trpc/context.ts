// tRPC context (D-05/D-08) — the ONLY place the tenant becomes authoritative.
//
// `createTRPCContext` reads the Better Auth session from the request headers via
// `auth.api.getSession({ headers })` and exposes it (plus the raw headers, needed by
// org-plugin mutations like setActive that re-issue the session cookie). The tenant is
// derived DOWNSTREAM, ONLY from `session.activeOrganizationId` (see trpc/init.ts
// `protectedProcedure`) — a client-supplied orgId is NEVER read here or in any router
// (T-03-05). This factory is consumed both by the RSC/route-handler path and by the
// integration-test `createCaller`.
//
// NOTE on `cache()`: RESEARCH Pattern 3 wraps this in React's `cache()` for per-request
// RSC dedup, but `@imbau/api` is a JIT package with no direct `react` dependency and the
// factory must also run in plain Node (the tRPC caller tests). We keep it a plain async
// function; an RSC consumer can wrap the call in `cache()` at its own boundary if desired.
import { auth } from "../auth/runtime";

export interface CreateContextOptions {
  headers: Headers;
}

export async function createTRPCContext(opts: CreateContextOptions) {
  // The session is the sole source of tenant + identity. activeOrganizationId lives on
  // session.session.activeOrganizationId; the authenticated user on session.user.
  const session = await auth.api.getSession({ headers: opts.headers });
  return { session, headers: opts.headers };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
