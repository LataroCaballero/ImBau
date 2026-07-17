// tRPC fetch route handler (RESEARCH Pattern 3) — mounts appRouter under /api/trpc/* in web.
//
// This mount exists for the anonymous quote path (quotes.compute / quotes.create,
// QUOTE-01 / D-06-A1): the public web surface must serve the quote procedures server-side.
// An anonymous request carries no Better Auth session, so createTRPCContext resolves
// session = null and the quotesRouter publicProcedures resolve the org server-side from
// the `publicado` project (T-03-05) — a client-supplied orgId is never trusted. The
// endpoint prefix "/api/trpc" must match the nginx location `/api/trpc/quotes` (plan 05-05).
// No client provider/link is wired here — the browser client is fase 6.
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
