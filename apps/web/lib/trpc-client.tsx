"use client";

// Client-side tRPC + TanStack Query v5 provider for the public showroom
// (cloned from apps/panel/lib/trpc-client.tsx — RESEARCH Pattern 3, D-08).
//
// `createTRPCContext<AppRouter>()` from @trpc/tanstack-react-query gives a
// `useTRPC()` proxy (`trpc.quotes.compute.mutationOptions()`, etc.) and a
// `TRPCProvider`. The cotizador island uses these; pure RSC reads use the server
// caller instead. v5 (NOT v4) is required by tRPC v11 (CLAUDE.md "What NOT to Use").
//
// LOAD-BEARING difference from the panel client (RESEARCH Pattern 1 / Pitfall 1):
// the links array is a single `splitLink` that routes every `quotes.*` procedure
// to a DEDICATED httpBatchLink. Because tRPC batches per-link, quotes requests can
// only co-batch with other quotes requests, so their HTTP path stays prefixed
// `/api/trpc/quotes.*` and never merges with a picker/projects read under a
// different prefix. That is exactly what the nginx `location ^~ /api/trpc/quotes`
// (QUOTE-03 rate limit) matches on — if quotes co-batched with a non-quotes op the
// combined request would escape the limit and the 429 throttle would never fire.
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@imbau/api";
import { isQuotesOp } from "./trpc-split";

// Re-exported so the split predicate is reachable from the client module and
// unit-testable in isolation (see lib/trpc-split.ts).
export { isQuotesOp } from "./trpc-split";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function getBaseUrl(): string {
  // In the browser a relative URL is correct; on the server (RSC island prerender) we need an
  // absolute origin. window.location.origin covers the only place this client actually runs.
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function TRPCReactProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => {
    const url = `${getBaseUrl()}/api/trpc`;
    return createTRPCClient<AppRouter>({
      links: [
        splitLink({
          // Keep quotes on their own batch so the request path stays
          // /api/trpc/quotes.* and nginx limit_req (QUOTE-03) throttles it.
          condition: (op) => isQuotesOp(op.path),
          true: httpBatchLink({ url }),
          false: httpBatchLink({ url }),
        }),
      ],
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
