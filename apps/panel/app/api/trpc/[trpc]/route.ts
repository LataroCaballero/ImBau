// tRPC fetch route handler (RESEARCH Pattern 3) — mounts appRouter under /api/trpc/* in panel.
//
// The client provider (lib/trpc-client.tsx) batches client-side queries/mutations to this
// endpoint. createTRPCContext reads the Better Auth session from the request headers, so the
// tenant is derived server-side (T-03-05); a client-supplied orgId is never trusted.
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@imbau/api";

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });
}

export { handler as GET, handler as POST };
