---
phase: 03-auth-api-app-surfaces
plan: 01
subsystem: auth
tags: [better-auth, trpc, rls, postgres, drizzle, access-control, organizations, vitest, multi-tenancy]

# Dependency graph
requires:
  - phase: 02-data-layer-rls
    provides: "RLS-FORCED organization/member tables, withTenant/withAnon, createOwnerDb owner pool, CLI-folded Better Auth schema (packages/db/auth.ts), Postgres test harness pattern"
  - phase: 01-foundation
    provides: "@imbau/config env presets (baseEnv/dbEnv), @t3-oss/env-core fail-fast contract, monorepo + vitest root config"
provides:
  - "Better Auth runtime in @imbau/api (auth, Auth type) booting against the phase-2 schema via the elevated owner pool (A1)"
  - "owner/developer/viewer access-control roles (ac + 3 roles) mapping to member.role; owner-only invite (D-12)"
  - "authEnv preset (@imbau/config) + validated @imbau/api auth env (BETTER_AUTH_SECRET/URL, RESEND_API_KEY/INVITE_FROM optional, owner DATABASE_URL)"
  - "@imbau/api Vitest harness (config + setup + db + fixtures) that mints a real user+org+active session through the owner-pool adapter"
  - "A1 integration test proving org-create + invite-accept write rows and creator resolves to owner"
  - "send-invitation.ts dev console stub (D-09), replaced by real Resend in plan 03-03"
affects: [03-02-trpc-context, 03-03-invitations-email, 03-04-panel-web-surfaces, panel-auth-handler, requireRole-middleware]

# Tech tracking
tech-stack:
  added: ["@trpc/server 11.17.0", "@trpc/client 11.17.0", "@trpc/tanstack-react-query 11.17.0", "@tanstack/react-query 5", "better-auth 1.6.18 (runtime)", "resend 6.12.4", "@react-email/components 1.0.12", "postgres 3.4.9 (api test devDep)", "@t3-oss/env-core 0.13.11 (api)"]
  patterns: ["A1: Better Auth adapter on the elevated owner pool (createOwnerDb); app data path stays on withTenant/withAnon", "Custom AC must merge org-plugin defaultStatements so built-in invitation/member checks resolve", "nextCookies() last in plugins array", "Package env composes only the vars it uses; no onValidationError override (name-only errors, V7)", "api test harness reuses phase-2 owner-connection + _test DB guard"]

key-files:
  created:
    - "packages/api/src/auth/runtime.ts"
    - "packages/api/src/auth/access-control.ts"
    - "packages/api/src/auth/env.ts"
    - "packages/api/src/email/send-invitation.ts"
    - "packages/api/vitest.config.ts"
    - "packages/api/tests/setup.ts"
    - "packages/api/tests/db.ts"
    - "packages/api/tests/fixtures.ts"
    - "packages/api/tests/auth-runtime.test.ts"
  modified:
    - "packages/config/env/presets.ts"
    - "packages/api/package.json"
    - "packages/api/tsconfig.json"
    - "packages/api/src/index.ts"

key-decisions:
  - "A1 locked: Better Auth Drizzle adapter connects via createOwnerDb(env.DATABASE_URL) (owner role imbau, superuser/BYPASSRLS) so it can write the RLS-FORCED organization/member tables; the app data path is untouched on app_authenticated/anon."
  - "Custom access-control statement spreads better-auth/plugins/organization/access defaultStatements (organization/member/invitation/team/ac) plus a domain `project` resource — required so owner's invitation:create check passes (the plugin checks invitation:create, not member:invite)."
  - "creatorRole left at the 1.6.18 default ('owner') since 'owner' is in our role set — org creator resolves to owner with no override (A3 confirmed)."
  - "send-invitation.ts is a non-async Promise-returning console stub for 03-01; plan 03-03 swaps the real Resend + React Email implementation as a drop-in."
  - "@imbau/api auth env declares only DATABASE_URL (owner) — A1 isolation at the env-contract level; importing @imbau/db's barrel still transitively requires DATABASE_APP_URL/ANON_URL, supplied by the panel/test env."

patterns-established:
  - "Owner-pool auth adapter (A1): the only elevated DB pool lives in runtime.ts; runtime.ts never imports appDb/anonDb/withTenant/withAnon (grep-verified)."
  - "Owner-pool test fixtures: mint user+org+active session through the REAL auth API (signUpEmail -> createOrganization -> setActiveOrganization), not a DB bypass."
  - "Custom Better Auth roles merge plugin defaultStatements; owner-only invite enforced by giving only owner invitation:[create,cancel]."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 26min
completed: 2026-06-17
---

# Phase 3 Plan 01: Auth Foundation Summary

**Better Auth 1.6.18 runtime in `@imbau/api` booting against the phase-2 schema via the elevated owner pool (A1), with owner/developer/viewer access-control roles, a validated auth env preset, and a Postgres-backed test harness whose integration test proves org-create and invite-accept actually write rows.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-06-17T16:30Z (continuation after human-verify approval)
- **Completed:** 2026-06-17T16:40Z
- **Tasks:** 3
- **Files modified/created:** 13 (9 created, 4 modified)

## Accomplishments
- Locked and proved A1: the Better Auth Drizzle adapter writes the RLS-FORCED `organization`/`member` tables through `createOwnerDb`, while the app data path stays on `withTenant`/`withAnon`. Confirmed against the live DB that `organization`/`member` are RLS-FORCED with policies scoped to `app_authenticated` only, and the owner role (`imbau`, superuser/BYPASSRLS) can write them — exactly the A1 isolation.
- owner/developer/viewer roles defined; org creator resolves to `owner`; invite is owner-only (only `owner` carries `invitation:[create,cancel]`).
- `authEnv` preset + validated `@imbau/api` auth env, fail-fast and name-only on bad input (no value leak — verified the bad-secret path does not print the value).
- `@imbau/api` Vitest harness + fixtures that mint a real user+org+active session via the owner-pool adapter; the A1 integration test (2 cases) passes against the live `imbau_test` Postgres.

## Task Commits

1. **Task 1: add @imbau/api auth + tRPC + email dependency set** - `311f5fd` (chore)
2. **Task 2: authEnv preset + validated @imbau/api auth env** - `6368f3b` (feat)
3. **Task 3: auth runtime (A1) + AC roles + Vitest harness + integration test** - `1fe43cd` (feat)

_TDD note: Task 3 was implemented and verified RED→GREEN within a single commit — the first test run was RED (env-shape blocker, then the invite-permission failure), then GREEN after the access-control merge fix. Both gate commits land in `1fe43cd`._

## Files Created/Modified
- `packages/api/src/auth/runtime.ts` - betterAuth() runtime: emailAndPassword (no verify gate, D-04) + organization plugin (ac/roles, additionalFields.plan verbatim from phase 2, sendInvitationEmail) + nextCookies() last; adapter on the owner pool (A1).
- `packages/api/src/auth/access-control.ts` - statement merging org-plugin defaultStatements + a `project` resource; ac + owner/developer/viewer roles.
- `packages/api/src/auth/env.ts` - validated env composing baseEnv + authEnv + owner DATABASE_URL; honors SKIP_ENV_VALIDATION; no onValidationError override.
- `packages/api/src/email/send-invitation.ts` - dev console stub for the invite link (D-09); 03-03 swaps real Resend.
- `packages/api/vitest.config.ts` / `tests/setup.ts` / `tests/db.ts` / `tests/fixtures.ts` / `tests/auth-runtime.test.ts` - the api harness + the A1 integration test.
- `packages/config/env/presets.ts` - added `authEnv` (names + Zod schemas only).
- `packages/api/package.json` / `tsconfig.json` / `src/index.ts` - deps, test script, tests in tsconfig, barrel re-exports auth/Auth + roles.

## Decisions Made
See `key-decisions` in frontmatter. The load-bearing one: A1 (owner-pool adapter) was proven, not assumed — the integration test asserts rows land in `organization`/`member` and that the creator's role is `owner`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Access-control statement must merge org-plugin `defaultStatements`**
- **Found during:** Task 3 (integration test — invite case)
- **Issue:** The plan's Pattern-2 statement only declared `project` + `member:[invite,remove]`. better-auth@1.6.18's `createInvitation` checks `invitation:["create"]` (not `member:invite`) against the inviter's role, so the owner got `APIError: You are not allowed to invite users to this organization`.
- **Fix:** Spread `defaultStatements` (from `better-auth/plugins/organization/access`) into the statement and gave `owner` the built-in org/member/invitation/team/ac permissions (mirroring the plugin's `ownerAc`); kept `developer`/`viewer` without invitation/member powers so invite stays owner-only (D-12).
- **Files modified:** packages/api/src/auth/access-control.ts
- **Verification:** invite-accept test case now passes; member row lands with role `developer`.
- **Committed in:** `1fe43cd` (Task 3 commit)

**2. [Rule 3 - Blocking] `postgres` not resolvable in @imbau/api test harness**
- **Found during:** Task 3 (typecheck)
- **Issue:** `tests/db.ts` imports `postgres` directly, but it was only a transitive dep via `@imbau/db` — `TS2307: Cannot find module 'postgres'`.
- **Fix:** Added `postgres@3.4.9` as a devDep of `@imbau/api` (matches packages/db's direct pin). NOT a package-substitution — same pinned version already in the workspace.
- **Files modified:** packages/api/package.json, pnpm-lock.yaml
- **Verification:** typecheck passes.
- **Committed in:** `1fe43cd` (Task 3 commit)

**3. [Rule 1 - Lint gate] Two CLAUDE.md lint-gate violations**
- **Found during:** Task 3 (lint, the CLAUDE.md pre-commit gate)
- **Issue:** `send-invitation.ts` was `async` with no `await` (`@typescript-eslint/require-await`); the test imported an unused `sql` symbol (`@typescript-eslint/no-unused-vars`).
- **Fix:** Made the stub return `Promise.resolve()` (still awaitable, drop-in for 03-03) and removed the unused import.
- **Files modified:** packages/api/src/email/send-invitation.ts, packages/api/tests/auth-runtime.test.ts
- **Verification:** `pnpm --filter @imbau/api lint` clean.
- **Committed in:** `1fe43cd` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 blocking, 1 lint-gate).
**Impact on plan:** All necessary for correctness and the CLAUDE.md gate. No scope creep — every change stays within the plan's files plus a same-version devDep.

## Issues Encountered
- **`@imbau/db` barrel eagerly requires all three DB URLs.** Importing `createOwnerDb` pulls `@imbau/db/src/index.ts` → `client.ts`, which constructs `appDb`/`anonDb` at module load and so validates `DATABASE_APP_URL`/`DATABASE_ANON_URL`. The auth runtime conceptually needs only the owner URL, and its own env (`auth/env.ts`) declares only `DATABASE_URL` (A1 isolation at the contract level). At runtime/test the app/anon URLs must still be present because the barrel imports them. Resolved by supplying all three test URLs (the panel app already provides them in production). Restructuring `@imbau/db` to lazy-init the app/anon pools would be a phase-2 change (Rule 4) and was deliberately NOT done.

## User Setup Required
Auth env vars are introduced (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY` optional in dev, `INVITE_FROM` optional). Dev needs `BETTER_AUTH_SECRET` (32+ chars) and `BETTER_AUTH_URL`; `RESEND_API_KEY`/`INVITE_FROM` only matter once real email lands (03-03, staging). No external dashboard config required for this plan.

## Validation / CI Notes
- The auth-runtime integration test ran GREEN locally against the live Postgres 16 `imbau_test` DB (2/2 cases). The harness reads connection strings from env (`TEST_DATABASE_URL`/`DATABASE_URL` etc.), so CI (CI-02, phase 4) re-points it at the GitHub Actions Postgres service unchanged.
- Required env at test time: `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL` (all on a `_test` DB), `BETTER_AUTH_SECRET` (32+), `BETTER_AUTH_URL`.

## Next Phase Readiness
- Plan 03-02 (tRPC context/routers) can now import `auth` for `auth.api.getSession`, use `makeUserWithActiveOrg()` fixtures for `protectedProcedure` tests, and route via the phase-2 `withTenant`/`withAnon` pools — the app data path is untouched here.
- Plan 03-03 (invitations email) swaps `send-invitation.ts` for the real Resend + React Email implementation (signature is already compatible).
- No blockers.

## Known Stubs
- `packages/api/src/email/send-invitation.ts` — intentional dev console stub (D-09). Resolved by plan 03-03 (real Resend + React Email). The org plugin's `sendInvitationEmail` callback wires to it so the runtime imports and invitations dispatch (to console) cleanly.

## Threat Flags
None — no new security surface beyond the plan's threat model. The owner pool is constructed only in `runtime.ts` (grep-verified: no `appDb`/`withTenant`/`anonDb`/`withAnon` in runtime code); env errors print names not values (verified).

## Self-Check: PASSED

All 9 created source/test files + SUMMARY.md present on disk; all 3 task commits (`311f5fd`, `6368f3b`, `1fe43cd`) found in git history.

---
*Phase: 03-auth-api-app-surfaces*
*Completed: 2026-06-17*
