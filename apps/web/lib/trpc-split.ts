// Pure splitLink predicate — kept in its own JSX-free module so the unit test
// (tests/trpc-client-split.test.ts) can import and assert it without pulling the
// "use client" provider (lib/trpc-client.tsx) into Vitest. trpc-client.tsx
// imports this and uses it in the splitLink `condition`, and re-exports it.
//
// LOAD-BEARING (RESEARCH Pitfall 1 / threat T-06-02-DOS): only `quotes.*`
// procedures may take the dedicated batch link, so quotes requests keep the HTTP
// path prefix `/api/trpc/quotes.*` that the nginx `location ^~ /api/trpc/quotes`
// rate limit (QUOTE-03) matches on. If a non-quotes op matched, it could co-batch
// quotes onto a different path and escape the 429 throttle.
export const isQuotesOp = (path: string): boolean => path.startsWith("quotes.");
