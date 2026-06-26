"use client";

// Client-side tRPC + TanStack Query v5 provider (RESEARCH Pattern 3, D-08).
//
// `createTRPCContext<AppRouter>()` from @trpc/tanstack-react-query gives a `useTRPC()` proxy
// (`trpc.member.invite.mutationOptions()`, etc.) and a `TRPCProvider`. Interactive panel
// islands (e.g. the invite form) use these; pure RSC reads use the server caller instead.
// httpBatchLink points at the panel's own /api/trpc handler. v5 (NOT v4) is required by tRPC
// v11 (CLAUDE.md "What NOT to Use").
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@imbau/api";

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
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${getBaseUrl()}/api/trpc` })],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
