---
phase: 03-auth-api-app-surfaces
plan: 02
subsystem: api
tags: [trpc, rls, multi-tenancy, better-auth, zod, drizzle, access-control, vitest]

# Dependency graph
requires:
  - phase: 03-auth-api-app-surfaces
    plan: 01
    provides: "Better Auth runtime (auth, auth.api.getSession/createInvitation/acceptInvitation/setActiveOrganization/listOrganizations), owner/developer/viewer AC roles, @imbau/api Vitest harness + makeUserWithActiveOrg fixtures, owner-pool adapter (A1)"
  - phase: 02-data-layer-rls
    provides: "withTenant/withAnon, projects + member tenant RLS policies, schema barrel"
provides:
  - "tRPC v11 init: publicProcedure/protectedProcedure/router/createCallerFactory + createTRPCContext (session-derived tenant; activeOrgId injected only from session.activeOrganizationId)"
  - "requireRole(...allowed) middleware reading member.role inside withTenant(ctx.activeOrgId)"
  - "minimal D-07 router set: projects.listForOrg/listPublished, org.list/setActive, member.invite (owner-only), invitation.accept"
  - "appRouter + AppRouter type; real @imbau/api barrel re-exporting auth + router + createCaller"
  - "tRPC caller integration test proving cross-tenant absence, role enforcement, and anon published-only reads against live Postgres"
affects: [03-03-invitations-email, 03-04-panel-web-surfaces, panel-trpc-route-handler, web-rsc-reads]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "protectedProcedure derives activeOrgId ONLY from session.session.activeOrganizationId (server-side); UNAUTHORIZED when null (Pitfall 2) — client orgId never trusted"
    - "Routers import ONLY withTenant/withAnon/schema from @imbau/db (grep-verified: no createOwnerDb/appDb/anonDb import) — the owner pool cannot leak into a router (T-03-09)"
    - "requireRole reads member.role inside withTenant so the role lookup itself runs as app_authenticated, scoped by member_tenant RLS (defense in depth)"
    - "createTRPCContext is a plain async factory (no React cache()) — @imbau/api has no direct react dep and the factory must run in plain Node for the caller path"
    - "invitation.accept uses a session-only gate (not protectedProcedure) so a just-signed-up invitee with a null active org can accept (org becomes active as a side effect)"
    - "org.setActive validates target-org membership server-side via a self-scoped withTenant read before delegating to the plugin (closes Pitfall 2)"

key-files:
  created:
    - "packages/api/src/trpc/init.ts"
    - "packages/api/src/trpc/context.ts"
    - "packages/api/src/trpc/middleware.ts"
    - "packages/api/src/trpc/routers/projects.ts"
    - "packages/api/src/trpc/routers/org.ts"
    - "packages/api/src/trpc/routers/member.ts"
    - "packages/api/src/trpc/routers/invitation.ts"
    - "packages/api/src/trpc/routers/_app.ts"
    - "packages/api/tests/trpc-tenant.test.ts"
  modified:
    - "packages/api/src/index.ts"
    - ".planning/phases/03-auth-api-app-surfaces/03-VALIDATION.md"

key-decisions:
  - "createTRPCContext is a plain async function, NOT React cache()-wrapped (RESEARCH Pattern 3 used cache()): @imbau/api has no direct `react` dependency (it is not resolvable from the package) and the context factory must also run under the integration-test caller in plain Node. RSC consumers can wrap the call in cache() at their own boundary. Deviation Rule 3."
  - "member.invite delegates to auth.api.createInvitation (NOT inviteMember) — matches 03-01's access-control where the owner's invitation:create permission gates the plugin endpoint."
  - "invitation.accept runs on a bespoke session-only gate (publicProcedure + session check) rather than protectedProcedure, because a freshly-signed-up invitee has a null activeOrganizationId; requiring an active org would be a chicken-and-egg (accepting is what gives the first org)."
  - "org.setActive validates membership of the TARGET org (a self-scoped withTenant read) before delegating, so the input orgId is only ever used after a server-side membership proof — never trusted blindly."

requirements-completed: [AUTH-02, AUTH-03, APP-01, APP-02]

# Metrics
duration: 5min
completed: 2026-06-17
---

# Phase 3 Plan 02: tRPC API Layer Summary

**The tRPC v11 API layer in `@imbau/api`: a session-derived context that injects `activeOrgId` only from `session.activeOrganizationId`, a `requireRole` middleware, the minimal D-07 router set routing protected reads through `withTenant` and the anon path through `withAnon`, the real barrel with `createCaller`, and an integration test that proves cross-tenant absence + owner-only invite + anon published-only reads through the tRPC caller against live Postgres.**

## Performance
- **Duration:** ~5 min
- **Tasks:** 3
- **Files created/modified:** 11 (9 created, 2 modified)

## Accomplishments
- **The load-bearing seam is proven, not assumed.** `protectedProcedure` derives the tenant solely from `session.session.activeOrganizationId` and runs every protected read inside `withTenant(ctx.activeOrgId)`. The integration test asserts that an org-A caller sees ZERO org-B project rows through the tRPC caller (and the mirror) — RLS isolation holds end to end via the unprivileged `app_authenticated` path, never the owner pool.
- `requireRole('owner')` rejects a viewer caller with FORBIDDEN and admits an owner; `member.invite` is built on it (owner-only, default invited role `viewer` — D-12).
- `projects.listPublished` via `withAnon` returns only `publicado` rows (zero `borrador`), proven through the caller (APP-02).
- `org.setActive` closes the Pitfall-2 null-active-org gap (validates target-org membership server-side first); `org.list` lists the caller's orgs; `invitation.accept` accepts on a session-only gate so a just-signed-up invitee (null active org) can accept.
- Real `@imbau/api` barrel re-exports `auth`, `appRouter`/`AppRouter`, the tRPC primitives, `requireRole`, and a `createCaller` helper; the placeholder `apiPackage` export is gone.
- All 7 `@imbau/api` tests green against the live `imbau_test` Postgres 16; typecheck + lint clean under Node 22.

## Task Commits
1. **Task 1: tRPC init + session context + requireRole middleware** — `0cbc6b3` (feat)
2. **Task 2: minimal D-07 router set + real @imbau/api barrel** — `fd4baa3` (feat)
3. **Task 3: tRPC tenant-isolation + role + anon-published integration test** — `373ede7` (test)

_TDD note: the three tasks were implemented and verified RED→GREEN as a unit (the test file is the shared Task-1/Task-3 artifact; the `requireRole` describe block satisfies Task 1's `-t "requireRole"` filter, the `tenant`/`anon` blocks satisfy Task 3). First full run was green after typecheck/lint passes._

## Files Created/Modified
- `packages/api/src/trpc/init.ts` — initTRPC v11 root: `router`, `publicProcedure`, `protectedProcedure` (UNAUTHORIZED when `activeOrganizationId` null; injects server-derived `ctx.activeOrgId` + narrowed `session`), `createCallerFactory`, re-exported `createTRPCContext`.
- `packages/api/src/trpc/context.ts` — `createTRPCContext({ headers })` reads the Better Auth session via `auth.api.getSession`; tenant derived only from the session. Plain async factory (no React `cache()` — see Decisions).
- `packages/api/src/trpc/middleware.ts` — `requireRole(...allowed)` reads `member.role` inside `withTenant(ctx.activeOrgId)`, throws FORBIDDEN for missing/disallowed role; injects `ctx.role`.
- `packages/api/src/trpc/routers/projects.ts` — `listForOrg` (protected/withTenant), `listPublished` (public/withAnon); no app-layer org filter.
- `packages/api/src/trpc/routers/org.ts` — `list` (listOrganizations), `setActive` (Zod input, server-side membership check, delegates to setActiveOrganization).
- `packages/api/src/trpc/routers/member.ts` — `invite` = `requireRole("owner")` + Zod 4 (`email`, `role` default `viewer`), delegates to `createInvitation`.
- `packages/api/src/trpc/routers/invitation.ts` — `accept` on a session-only gate, Zod `invitationId`, delegates to `acceptInvitation`.
- `packages/api/src/trpc/routers/_app.ts` — `appRouter` + `AppRouter` type.
- `packages/api/src/index.ts` — real barrel (auth, appRouter/AppRouter, tRPC primitives, requireRole, `createCaller`); placeholder removed.
- `packages/api/tests/trpc-tenant.test.ts` — 5 caller-path integration cases (owner invite OK, viewer invite FORBIDDEN, A→B absence, B→A absence, anon publicado-only).
- `.planning/phases/03-auth-api-app-surfaces/03-VALIDATION.md` — Per-Task Verification Map rows for AUTH-02/AUTH-03/APP-01/APP-02 now reference the new test file and are marked green.

## Decisions Made
See `key-decisions` in frontmatter. The load-bearing ones: (1) the tenant is authoritative ONLY at `protectedProcedure` from the session; (2) `createTRPCContext` is React-`cache()`-free to keep `@imbau/api` free of a `react` dependency and runnable in plain Node; (3) `invitation.accept` uses a session-only gate to resolve the null-active-org chicken-and-egg.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `createTRPCContext` cannot use React `cache()` — `react` is not resolvable in `@imbau/api`**
- **Found during:** Task 1 (init/context design)
- **Issue:** RESEARCH Pattern 3 wraps `createTRPCContext` in `cache()` imported from `react`, but `@imbau/api` has no direct `react` dependency (`require.resolve('react')` fails from the package), and the same factory must run in plain Node for the integration-test caller (no RSC request scope).
- **Fix:** Made `createTRPCContext` a plain `async` function. The RSC per-request dedup benefit is minor and any RSC consumer can wrap the call in `cache()` at its own boundary. Did NOT add `react` as a dependency (would be scope creep into the app layer, plan 03-04).
- **Files modified:** packages/api/src/trpc/context.ts (no extra dep added)
- **Verification:** typecheck + the caller-path tests pass.
- **Committed in:** `0cbc6b3` (Task 1)

**2. [Rule 2 - Missing Critical] `invitation.accept` must not require an active org**
- **Found during:** Task 2 (invitation router)
- **Issue:** The plan said `accept = protectedProcedure...`, but a freshly-signed-up invitee has `activeOrganizationId === null`, so `protectedProcedure` would throw UNAUTHORIZED and the invitee could never accept their first invitation (D-10 new-user path).
- **Fix:** Introduced a bespoke session-only gate (publicProcedure + session-presence check) for `accept`. The org becomes active as a side effect of accepting in 1.6.18. This is a correctness requirement for the AUTH-03 invite→accept flow, not a scope change.
- **Files modified:** packages/api/src/trpc/routers/invitation.ts
- **Verification:** the viewer-mint helper in the test signs up, accepts, then sets the org active — exercising this exact gate; the suite is green.
- **Committed in:** `fd4baa3` (Task 2)

---
**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical). No scope creep — both stay within the plan's files; no new dependency was added.

## Threat Model Verification
- **T-03-05 (cross-tenant read via forged orgId):** `protectedProcedure` injects `activeOrgId` only from the session; routers never read an orgId from input. The test asserts org-A→org-B and org-B→org-A project-row ABSENCE through the caller. ✅
- **T-03-06 (non-owner invites):** `member.invite` = `requireRole("owner")`; test proves FORBIDDEN for a viewer, OK for an owner. ✅
- **T-03-07 (input injection):** every mutating procedure validates input with Zod 4 (`z.email()`, `z.enum`, `z.string().min(1)`). ✅
- **T-03-08 (GUC bleed):** unchanged — `withTenant` uses transaction-scoped `set_config(...,true)` from phase 2. ✅
- **T-03-09 (router importing owner pool):** grep-verified — no `createOwnerDb`/`appDb`/`anonDb` import in any router (only the documented comments mention them). ✅

## Validation / CI Notes
- Ran GREEN locally against the live Postgres 16 `imbau_test` DB (7/7 `@imbau/api` tests; the 5 new tRPC cases + the 2 pre-existing auth-runtime cases). The harness reads connection strings from env, so CI (CI-02, phase 4) re-points it at the GitHub Actions Postgres service unchanged.
- Required env at test time: `DATABASE_URL` (owner), `DATABASE_APP_URL` (app_authenticated), `DATABASE_ANON_URL` (anon) — all on the `_test` DB — plus `BETTER_AUTH_SECRET` (32+) and `BETTER_AUTH_URL`. Verified locally with `imbau:dev@…/imbau_test`, `app_authenticated:dev@…`, `anon:dev@…`.

## Next Phase Readiness
- Plan 03-03 (invitations email) swaps `send-invitation.ts` for real Resend; the `member.invite` path already fires `sendInvitationEmail` through `createInvitation`.
- Plan 03-04 (panel/web surfaces) imports `createCaller` for RSC reads (`projects.listPublished` in web, `projects.listForOrg` in panel) and the `AppRouter` type for the TanStack Query client; the panel route-handler wires `createTRPCContext({ headers })`.
- No blockers.

## Known Stubs
None new. (`send-invitation.ts` remains the 03-01 console stub, resolved by 03-03.)

## Threat Flags
None — no security surface beyond the plan's threat model. New endpoints (`org.*`, `member.invite`, `invitation.accept`) all sit behind the session/role gates the threat register specifies.

## Self-Check: PASSED

All 9 created files + 2 modified files present on disk; all 3 task commits (`0cbc6b3`, `fd4baa3`, `373ede7`) in git history; routers grep-clean of owner-pool imports; 7/7 tests green; typecheck + lint clean.

---
*Phase: 03-auth-api-app-surfaces*
*Completed: 2026-06-17*
