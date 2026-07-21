// Project resolver for the panel shell (PANEL-01 / D-07) — the single-project read seam.
//
// resolveProject builds the tRPC server caller (session cookie → active org → RLS) and calls
// projects.getForOrg (Plan 01), which returns null when the row is invisible under RLS
// (cross-org OR non-existent — indistinguishable, D-07). The RSC translates null → notFound().
//
// It is wrapped in React `cache()` HERE, at the panel boundary, NOT inside createTRPCContext:
// `@imbau/api` is a JIT package with no `react` dependency (see packages/api/src/trpc/context.ts),
// so the per-request dedup must live in the app. App Router cannot prop-drill layout→page, so the
// layout and every child tab page call resolveProject(id) and share ONE getForOrg query per
// request thanks to cache().
//
// The catch is copied verbatim from (dashboard)/page.tsx (WR-03): only a TRPCError with code
// UNAUTHORIZED/FORBIDDEN means "you must log in" → redirect("/login"); ANY other error (DB down,
// driver panic) is re-thrown so it surfaces to Next's error boundary instead of masquerading as a
// logout. redirect() throws NEXT_REDIRECT, which is not a TRPCError, so it propagates cleanly.
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { createCaller } from "@imbau/api";

export const resolveProject = cache(async (id: string) => {
  const caller = await createCaller({ headers: await headers() });
  try {
    return await caller.projects.getForOrg({ id });
  } catch (err) {
    if (
      err instanceof TRPCError &&
      (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")
    ) {
      redirect("/login");
    }
    throw err;
  }
});
