---
phase: 03-auth-api-app-surfaces
plan: 03
subsystem: auth
tags: [better-auth, trpc, nextjs, rsc, organization, invitations, resend, react-email, playwright, multi-tenancy]

# Dependency graph
requires:
  - phase: 03-auth-api-app-surfaces
    plan: 01
    provides: "Better Auth runtime (auth, toNextJsHandler target, sendInvitationEmail callback seam), owner/developer/viewer AC roles + ac, owner-pool adapter"
  - phase: 03-auth-api-app-surfaces
    plan: 02
    provides: "appRouter + createCaller + createTRPCContext (session-derived tenant), requireRole, projects.listForOrg / org.setActive / member.invite / invitation.accept"
  - phase: 02-data-layer-rls
    provides: "withTenant/withAnon, projects + member tenant RLS policies, schema barrel"
provides:
  - "apps/panel Better Auth catch-all route handler (toNextJsHandler(auth)) — mounted ONLY in panel (D-03)"
  - "apps/panel tRPC fetchRequestHandler route mounting appRouter with createTRPCContext({ headers })"
  - "apps/panel auth client (createAuthClient + organizationClient mirroring owner/developer/viewer)"
  - "@imbau/api ./access-control subpath export (browser-safe ac/roles, keeps server runtime out of the panel bundle)"
  - "apps/panel tRPC + TanStack Query v5 client provider"
  - "panel login / signup / accept-invitation pages + tenant dashboard RSC reading the active org's projects via the tRPC server caller"
  - "real invitation email module (Resend when RESEND_API_KEY set, else dev console-log fallback of the accept link) + es-AR voseo React Email template"
  - "Playwright config + auth-flow e2e (login persistence + invite→accept) green vs live Postgres"
affects: [03-04-web-anon-surface, 04-infra-ci-deploy, panel-feature-work]

# Tech tracking
tech-stack:
  added:
    - "@trpc/client@11.17.0, @trpc/tanstack-react-query@11.17.0, @tanstack/react-query@5, better-auth@1.6.18, @trpc/server, postgres (apps/panel deps)"
    - "@playwright/test@1.60.0 (apps/panel devDep)"
    - "react + @types/react + jsx config (packages/api — to compile the .tsx React Email template)"
  patterns:
    - "Auth + tRPC handlers mount ONLY in apps/panel (D-03); apps/web stays anon-only — no auth route under apps/web"
    - "Browser bundle imports ac/roles via the @imbau/api ./access-control subpath (NOT the barrel) so the server runtime never reaches the panel client bundle"
    - "Dashboard is an RSC that reads via createCaller({ headers: await headers() }).projects.listForOrg() → withTenant (RLS-scoped); client islands (invite form) wrapped in the tRPC client provider"
    - "Signup calls org.setActive on the first org so the dashboard RSC does not 401 on a null active org (Pitfall 2)"
    - "Invitation email: Resend when RESEND_API_KEY is set, else console.info the accept link (dev fallback D-09); real delivery is staging-only (03-VALIDATION Manual-Only)"
    - "accept-invitation page: useRef one-shot guard + hard navigate after accept to settle the accept-once + session-cookie-commit race"

key-files:
  created:
    - "apps/panel/app/api/auth/[...all]/route.ts"
    - "apps/panel/app/api/trpc/[trpc]/route.ts"
    - "apps/panel/lib/auth-client.ts"
    - "apps/panel/lib/trpc-client.tsx"
    - "apps/panel/app/login/page.tsx"
    - "apps/panel/app/signup/page.tsx"
    - "apps/panel/app/accept-invitation/[id]/page.tsx"
    - "apps/panel/app/(dashboard)/page.tsx"
    - "apps/panel/app/(dashboard)/invite-form.tsx"
    - "apps/panel/playwright.config.ts"
    - "apps/panel/e2e/auth-flow.spec.ts"
    - "packages/api/src/email/send-invitation.ts"
    - "packages/api/src/email/templates/invitation.tsx"
    - "packages/api/tests/send-invitation.test.ts"
  modified:
    - "apps/panel/env.ts"
    - "apps/panel/next.config.ts"
    - "apps/panel/package.json"
    - "packages/api/package.json"
    - "packages/api/tsconfig.json"
    - ".planning/phases/03-auth-api-app-surfaces/03-VALIDATION.md"

key-decisions:
  - "Mirror ac/roles to the panel client via a new @imbau/api ./access-control subpath export instead of the barrel, so importing the auth client never pulls the Better Auth server runtime (owner pool, node-postgres) into the browser bundle."
  - "Removed the placeholder apps/panel/app/page.tsx: it collided with the new (dashboard)/page.tsx route group at '/'. The dashboard is now the panel root."
  - "Added react + @types/react and JSX config to @imbau/api so the invitation React Email template (.tsx) typechecks in the package; the template is server-rendered by Resend, not shipped to any client bundle."
  - "accept-invitation uses a useRef one-shot guard plus a hard navigation after a successful accept to avoid double-accept and to let the session cookie commit before the dashboard RSC read — fixes the accept-once + cookie-commit race surfaced by the e2e."
  - "Human accepted the green Playwright auth e2e (login persistence + invite→accept against live Postgres) as sufficient verification in lieu of the manual click-through at Task 4."

patterns-established:
  - "Panel-only auth surface: toNextJsHandler(auth) + fetchRequestHandler live under apps/panel/app/api/*; apps/web has none"
  - "Browser-safe access-control import via @imbau/api/access-control subpath"
  - "RSC dashboard read through createCaller → withTenant; mutations through the client provider + useMutation(...mutationOptions())"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, APP-01]

# Metrics
duration: ~45min (across build + Task-4 human-verify checkpoint)
completed: 2026-06-18
---

# Phase 3 Plan 03: Panel Auth Surface Summary

**The `apps/panel` auth surface end-to-end: a panel-only Better Auth catch-all handler and tRPC route handler, an auth client mirroring owner/developer/viewer via a browser-safe `@imbau/api/access-control` subpath, login/signup/accept-invitation pages and a tenant-scoped dashboard RSC reading the active org's projects through `createCaller → withTenant`, a real Resend-or-console invitation email with an es-AR voseo React Email template, and a green Playwright e2e proving login persistence + invite→accept against live Postgres.**

## Performance
- **Duration:** ~45 min (build + Task-4 human-verify checkpoint)
- **Tasks:** 4 (3 auto + 1 human-verify checkpoint, approved)
- **Files created/modified:** 20 (14 created, 6 modified)

## Accomplishments
- **The full panel happy path is wired and proven.** login → Better Auth session cookie → dashboard RSC → tRPC server caller → `withTenant` → RLS-filtered projects, all in `apps/panel`. The Playwright e2e asserts the session persists across a reload (AUTH-01) and that an owner invite → dev-console accept link → accept yields a member with the assigned role (AUTH-02/AUTH-03).
- **Auth is panel-only (D-03).** `toNextJsHandler(auth)` and the tRPC `fetchRequestHandler` mount under `apps/panel/app/api/*`; `apps/web` has no auth route — it stays anonymous.
- **The browser bundle stays clean.** the auth client imports `ac`/roles through the new `@imbau/api/access-control` subpath, so the Better Auth server runtime (owner pool, postgres driver) never reaches the panel client bundle.
- **Invitations work without a Resend key in dev.** `sendInvitationEmail` console-logs the accept link when `RESEND_API_KEY` is unset (D-09 fallback) and sends via Resend with the es-AR voseo `InvitationEmail` template when the key is present; real delivery stays staging-only.
- **The null-active-org chicken-and-egg is closed in the UI:** signup calls `org.setActive` on the first org so the dashboard RSC does not 401 (Pitfall 2); the accept-invitation page settles the accept-once + cookie-commit race with a one-shot guard + hard navigate.
- All gates green: panel typecheck + build + lint, api typecheck + lint, the invitation-fallback unit test, and both auth e2e tests against live Postgres 16.

## Task Commits

Each task was committed atomically:

1. **Task 1: panel auth+tRPC handlers, clients, real invitation email** — `2a185fe` (feat)
2. **Task 2: panel login/signup/accept-invitation pages + tenant dashboard** — `0315b2f` (feat)
3. **Task 3: Playwright auth e2e — login persistence + invite/accept** — `85160d8` (test)
4. **Task 4: human-verify the panel auth happy path** — APPROVED (no code; human accepted the green e2e as verification)

## Files Created/Modified
- `apps/panel/app/api/auth/[...all]/route.ts` — `export const { GET, POST } = toNextJsHandler(auth)`; panel-only auth surface.
- `apps/panel/app/api/trpc/[trpc]/route.ts` — `fetchRequestHandler` mounting `appRouter` with `createTRPCContext({ headers })`; GET+POST.
- `apps/panel/lib/auth-client.ts` — `createAuthClient` + `organizationClient` mirroring `ac`/owner/developer/viewer imported from `@imbau/api/access-control` (browser-safe subpath).
- `apps/panel/lib/trpc-client.tsx` — `"use client"` tRPC + TanStack Query v5 provider (`httpBatchLink` → `/api/trpc`, QueryClient).
- `apps/panel/app/login/page.tsx` / `signup/page.tsx` — client form islands calling `authClient.signIn.email` / `signUp.email`; signup sets the first org active.
- `apps/panel/app/accept-invitation/[id]/page.tsx` — `"use client"`; signup/login then `organization.acceptInvitation`, one-shot guard + hard navigate.
- `apps/panel/app/(dashboard)/page.tsx` — RSC reading `createCaller({ headers: await headers() }).projects.listForOrg()` (RLS-scoped) + members/invite section.
- `apps/panel/app/(dashboard)/invite-form.tsx` — `"use client"` invite form calling `member.invite` via `useMutation(trpc.member.invite.mutationOptions())` (owner-only, default role viewer).
- `apps/panel/env.ts` — composes `authEnv.server` (BETTER_AUTH_SECRET/URL, RESEND_API_KEY optional, INVITE_FROM) + DB URLs for the server caller; keeps NEXT_PUBLIC_APP_ENV.
- `apps/panel/next.config.ts` — `transpilePackages` includes `@imbau/api`.
- `apps/panel/package.json` — adds `@imbau/api`, `@trpc/client`, `@trpc/server`, `@trpc/tanstack-react-query`, `@tanstack/react-query`, `better-auth`, `postgres`; `@playwright/test` devDep + `test:e2e` script.
- `apps/panel/playwright.config.ts` — `webServer` booting panel against the Compose DB with `RESEND_API_KEY` unset (dev fallback fires).
- `apps/panel/e2e/auth-flow.spec.ts` — (1) signup→dashboard read→reload→session persists (AUTH-01); (2) owner invite→dev-console accept link→accept→member-with-role (AUTH-03).
- `packages/api/src/email/send-invitation.ts` — Resend send OR dev `console.info` of the accept link (D-09); `runtime.ts` already dispatches via this seam.
- `packages/api/src/email/templates/invitation.tsx` — `InvitationEmail` React Email component (es-AR voseo), props `{ acceptUrl, orgName, inviter }`.
- `packages/api/tests/send-invitation.test.ts` — asserts the dev fallback logs the accept link when `RESEND_API_KEY` is absent.
- `packages/api/package.json` — adds the `./access-control` subpath export + react/@types/react.
- `packages/api/tsconfig.json` — JSX config so the `.tsx` template compiles.
- `.planning/phases/03-auth-api-app-surfaces/03-VALIDATION.md` — AUTH-01/AUTH-03 verification-map rows reference the new e2e spec.
- Removed `apps/panel/app/page.tsx` — collided with the new `(dashboard)/page.tsx` at `/`.

## Decisions Made
See `key-decisions` in frontmatter. The load-bearing ones: (1) mirror access-control to the client via a dedicated browser-safe subpath so the auth server runtime never bundles into the browser; (2) the dashboard is the panel root (old placeholder page removed to resolve the route collision); (3) accept-invitation uses a one-shot guard + hard navigate to settle the accept-once + cookie-commit race; (4) the human accepted the green e2e as Task-4 verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] access-control must be importable by the browser without the auth server runtime**
- **Found during:** Task 1 (auth-client wiring)
- **Issue:** The auth client mirrors `ac`/owner/developer/viewer, but importing them from the `@imbau/api` barrel pulls the Better Auth server runtime (owner pool, `postgres` driver) into the panel client bundle — a build/runtime hazard and a leak of server-only code into the browser.
- **Fix:** Added a dedicated `./access-control` subpath export to `@imbau/api` (`"./access-control": "./src/auth/access-control.ts"`) and imported `ac`/roles from it in `lib/auth-client.ts`.
- **Files modified:** packages/api/package.json, apps/panel/lib/auth-client.ts
- **Verification:** panel typecheck + build pass; no server runtime in the client bundle.
- **Committed in:** `2a185fe` (Task 1) / `0315b2f` (Task 2 import wiring)

**2. [Rule 3 - Blocking] @imbau/api could not compile the .tsx React Email template**
- **Found during:** Task 1 (invitation template)
- **Issue:** `invitation.tsx` uses JSX, but `@imbau/api` had no `react`/`@types/react` dep nor JSX config, so the package typecheck failed on the template.
- **Fix:** Added `react` + `@types/react` and JSX config to `@imbau/api`. The template is server-rendered by Resend (or unused in the console fallback), never shipped to a client bundle.
- **Files modified:** packages/api/package.json, packages/api/tsconfig.json
- **Verification:** `pnpm --filter @imbau/api typecheck` passes; the invitation-fallback unit test is green.
- **Committed in:** `2a185fe` (Task 1)

**3. [Rule 3 - Blocking] panel route collision at '/'**
- **Found during:** Task 2 (dashboard page)
- **Issue:** The new `(dashboard)/page.tsx` route group resolves to `/`, colliding with the leftover placeholder `apps/panel/app/page.tsx`.
- **Fix:** Removed `apps/panel/app/page.tsx`; the tenant dashboard is now the panel root.
- **Files modified:** apps/panel/app/page.tsx (deleted)
- **Verification:** `pnpm --filter @imbau/panel build` succeeds.
- **Committed in:** `0315b2f` (Task 2)

**4. [Rule 1 - Bug] accept-once + session-cookie-commit race on accept-invitation**
- **Found during:** Task 3 (auth e2e)
- **Issue:** The accept-invitation page could fire `acceptInvitation` twice (re-render) and navigate to the dashboard before the session cookie committed, intermittently 401-ing the dashboard RSC read.
- **Fix:** Added a `useRef` one-shot guard around the accept call plus a hard navigation after success so the cookie is committed before the dashboard RSC reads.
- **Files modified:** apps/panel/app/accept-invitation/[id]/page.tsx, apps/panel/app/signup/page.tsx
- **Verification:** the invite→accept e2e is green and stable against live Postgres.
- **Committed in:** `85160d8` (Task 3)

**5. [Rule 2 - Missing Critical] panel needed @trpc/server + postgres as direct deps**
- **Found during:** Task 1 (tRPC route handler / server caller)
- **Issue:** The panel's tRPC route handler and the RSC server caller require `@trpc/server` and the `postgres` driver at the app boundary; they were not declared as panel deps.
- **Fix:** Added `@trpc/server` and `postgres` to `apps/panel` dependencies.
- **Files modified:** apps/panel/package.json
- **Verification:** panel typecheck + build pass.
- **Committed in:** `2a185fe` (Task 1)

---

**Total deviations:** 5 auto-fixed (3 blocking, 1 bug, 1 missing-critical).
**Impact on plan:** All within the plan's intent — wiring/build correctness and one race fix; no scope creep beyond the planned artifacts (the `./access-control` subpath and panel deps are mechanics of the same wiring). No new product surface added.

## Issues Encountered
- The auth e2e initially flaked on the accept→dashboard transition (deviation #4) — resolved with the one-shot guard + hard navigate; both tests are now stable against live Postgres 16.

## User Setup Required
None for dev — the invitation email falls back to a console-logged accept link when `RESEND_API_KEY` is unset. Real Resend delivery is staging-only and requires `RESEND_API_KEY` + `INVITE_FROM` (tracked under 03-VALIDATION Manual-Only); no action needed for this milestone's automated gates.

## Next Phase Readiness
- AUTH-01/AUTH-02/AUTH-03 and APP-01 are satisfied and proven by the panel auth surface + e2e. The Phase-3 auth/api/app-surface trio (03-01 → 03-02 → 03-03) is complete on the panel side.
- Plan 03-04 (web anon surface) consumes `createCaller(...).projects.listPublished` via `withAnon` for the public read (APP-02) — `apps/web` stays anon-only, no auth route.
- Phase 4 (infra/CI/deploy) inherits the e2e: the Playwright spec reads connection strings from env, so CI re-points it at the GitHub Actions Postgres service unchanged.
- No blockers.

## Known Stubs
None new. `send-invitation.ts` is now the real Resend-or-console module (the 03-01/03-02 console stub is resolved). The console-log path is an intentional dev fallback (D-09), not a stub — real delivery is wired behind `RESEND_API_KEY`.

## Threat Model Verification
- **T-03-10 (session not persisting):** `nextCookies()` is the last plugin (03-01); the e2e asserts the session persists across a reload (AUTH-01). ✅
- **T-03-11 (cookie flags):** Better Auth default httpOnly/secure cookies; no custom cookie handling. ✅
- **T-03-12 (auth handler on apps/web):** handler mounted ONLY in panel (D-03); grep confirms no `toNextJsHandler` under `apps/web`. ✅
- **T-03-13 (invitation link guessing):** org-plugin invitation ids are non-sequential; accept requires an authenticated session (signup/login first). ✅
- **T-03-14 (real email/secret in dev):** dev logs only the accept link (no secret); real Resend delivery is staging-only behind a validated key. ✅ (accepted)
- **T-03-15 (non-owner reaching invite):** `member.invite` = `requireRole("owner")` (03-02); the invite form is owner-gated server-side. ✅

## Threat Flags
None — no security surface beyond the plan's threat model. The panel auth/tRPC handlers, the access-control subpath, and the invitation email all sit behind the gates the threat register specifies.

## Self-Check: PASSED

All 14 created files + 6 modified files present on disk; all 3 task commits (`2a185fe`, `0315b2f`, `85160d8`) in git history; the `@imbau/api` `./access-control` subpath export present; the leftover `apps/panel/app/page.tsx` removed; Task 4 human-verify approved.

---
*Phase: 03-auth-api-app-surfaces*
*Completed: 2026-06-18*
