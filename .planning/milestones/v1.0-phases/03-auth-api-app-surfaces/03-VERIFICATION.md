---
phase: 03-auth-api-app-surfaces
verified: 2026-06-18T22:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run the Playwright auth e2e against a live panel dev server (or confirm the green run recorded in 03-03-SUMMARY.md holds — both tests pass: 'login persists across a reload after signup' and 'invite accept creates member with the assigned role')"
    expected: "Both e2e tests pass: (1) signup -> dashboard loads -> reload -> still on dashboard (session persists, AUTH-01); (2) owner invites -> dev console logs the accept link -> invitee accepts at /accept-invitation/[id] -> member row created with viewer role (AUTH-03)"
    why_human: "Playwright e2e requires a live Next.js panel server (pnpm dev or built standalone) and a running Postgres+Redis stack. The tests cannot be verified with static grep alone. The SUMMARYs report both as green against live Postgres 16 but verifier cannot re-run them without a running server."
  - test: "Verify apps/web renders published projects correctly in a browser (or against a running dev server)"
    expected: "The page loads at '/', shows 'ImBau · Proyectos publicados', and lists only estado='publicado' rows (borrador rows are invisible). No login link or auth route is reachable."
    why_human: "The anon read via withAnon -> RLS is proven by the integration test (trpc-tenant.test.ts listPublished case), but the actual web page rendering requires a live Next dev server with a seeded database to confirm it displays correctly end-to-end."
  - test: "Confirm the worker smoke test passes against the Compose Redis (if Compose is up)"
    expected: "'pnpm --filter @imbau/worker test -t worker connects' passes: the BullMQ Worker reaches 'ready' and PING returns 'PONG' against the Compose Redis at redis://localhost:6380"
    why_human: "The smoke test requires the Compose Redis to be up at :6380. The SUMMARY reports it green against live Redis. Verifier cannot execute tests in this environment."
---

# Phase 3: Auth, API & App Surfaces — Verification Report

**Phase Goal:** Un usuario puede autenticarse, pertenecer a organizaciones con roles, e interactuar con las tres apps leyendo datos por el camino de tenant correcto de extremo a extremo.

**Verified:** 2026-06-18T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Registro/login email+password vía Better Auth; sesión persiste entre refrescos (AUTH-01) | VERIFIED | `packages/api/src/auth/runtime.ts`: emailAndPassword enabled, requireEmailVerification:false; `apps/panel/app/login/page.tsx` + `signup/page.tsx` exist as client forms; `nextCookies()` is last plugin in runtime.ts:54; e2e spec `auth-flow.spec.ts:25` "login persists across a reload" asserts session survives reload; SUMMARY 03-03 reports green |
| 2 | Orgs con roles owner/developer/viewer; org activa = tenant; owner invita por email; invitado acepta con su rol (AUTH-02, AUTH-03) | VERIFIED | `packages/api/src/auth/access-control.ts`: owner/developer/viewer roles defined with defaultStatements merged; `packages/api/src/trpc/middleware.ts`: requireRole reads member.role inside withTenant; `apps/panel/app/api/trpc/[trpc]/route.ts`: member.invite = requireRole("owner"); `packages/api/src/email/send-invitation.ts`: console.info fallback when RESEND_API_KEY absent (D-09); `send-invitation.test.ts` proves fallback logs accept link; Playwright e2e spec `auth-flow.spec.ts:53` "invite accept creates member" — SUMMARY 03-03 reports green |
| 3 | apps/panel: login + dashboard reads active-org RLS-protected projects; apps/web: only publicado via anon role (APP-01, APP-02) | VERIFIED | `apps/panel/app/(dashboard)/page.tsx:25,29`: createCaller → listForOrg() wired; `apps/web/app/page.tsx:25-26`: createCaller → listPublished() wired, force-dynamic set; `packages/api/tests/trpc-tenant.test.ts`: cross-tenant absence proven (A→B zero, B→A zero), listPublished returns only publicado (zero borrador); no toNextJsHandler/withTenant/@trpc client in web source |
| 4 | apps/worker BullMQ shell (no job logic); each app has multi-stage Dockerfile (turbo prune + standalone/tsup) (APP-03, APP-04) | VERIFIED | `apps/worker/src/index.ts:20`: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }); Queue + Worker on 'health', no job logic; `apps/worker/src/index.test.ts`: smoke test proves Redis connection and Worker ready; three Dockerfiles exist with turbo prune per app, no `install --prod`, node:22-alpine runner; .dockerignore per app |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/api/src/auth/runtime.ts` | betterAuth runtime, createOwnerDb pool (A1), nextCookies() last | VERIFIED | createOwnerDb:28, nextCookies():54 (last), sendInvitationEmail wired |
| `packages/api/src/auth/access-control.ts` | owner/developer/viewer roles, defaultStatements merged | VERIFIED | defaultStatements spread:20, ac + 3 roles exported, only owner has invitation:create |
| `packages/api/src/auth/env.ts` | authEnv preset, BETTER_AUTH_SECRET/URL, no onValidationError override | VERIFIED | SKIP_ENV_VALIDATION honored, no onValidationError override present |
| `packages/config/env/presets.ts` | authEnv preset with Zod schemas only | VERIFIED | authEnv.server.BETTER_AUTH_SECRET/URL/RESEND_API_KEY/INVITE_FROM with Zod schemas |
| `packages/api/src/trpc/init.ts` | protectedProcedure throws UNAUTHORIZED on null activeOrganizationId | VERIFIED | Line 22-36: session.session.activeOrganizationId check, activeOrgId injected server-side |
| `packages/api/src/trpc/context.ts` | session from auth.api.getSession, no client orgId read | VERIFIED | auth.api.getSession({headers}):24, no orgId read from input |
| `packages/api/src/trpc/middleware.ts` | requireRole reads member.role inside withTenant | VERIFIED | withTenant(ctx.activeOrgId, ...) on line 18, member.role query |
| `packages/api/src/trpc/routers/projects.ts` | listForOrg via withTenant, listPublished via withAnon, no app-layer WHERE | VERIFIED | withTenant:17, withAnon:21, no WHERE org_id in source |
| `packages/api/src/trpc/routers/org.ts` | setActive + list; server-side membership validation | VERIFIED | setActive validates membership via withTenant before delegating |
| `packages/api/src/trpc/routers/member.ts` | invite = requireRole("owner"), Zod input, default role viewer | VERIFIED | requireRole("owner"):17, z.object({email:z.email(), role:z.enum(...).default("viewer")}):18-24 |
| `packages/api/src/trpc/routers/invitation.ts` | accept on session-only gate (no active-org required) | VERIFIED | sessionProcedure (not protectedProcedure) gates accept:22-27 |
| `packages/api/src/trpc/routers/_app.ts` | appRouter + AppRouter type | VERIFIED | Confirmed via imports in index.ts |
| `packages/api/src/index.ts` | real barrel: auth, appRouter, createCaller, no apiPackage placeholder | VERIFIED | No apiPackage export; auth, appRouter, createCaller all exported; createCaller:34 |
| `packages/api/src/email/send-invitation.ts` | Resend or console.info fallback (D-09) | VERIFIED | if(!env.RESEND_API_KEY) console.info:33; Resend path with INVITE_FROM check |
| `packages/api/src/email/templates/invitation.tsx` | InvitationEmail, es-AR voseo | VERIFIED | React Email template with es-AR voseo copy, InvitationEmail exported |
| `packages/api/tests/fixtures.ts` | makeUserWithActiveOrg via real auth adapter | VERIFIED | Drives signUpEmail → createOrganization → setActiveOrganization through auth.api |
| `packages/api/tests/trpc-tenant.test.ts` | Cross-tenant absence, role enforcement, anon published-only | VERIFIED | 5 test cases: owner invite OK, viewer FORBIDDEN, A→B absence, B→A absence, publicado-only |
| `packages/api/tests/send-invitation.test.ts` | console.info fallback asserted | VERIFIED | vi.spyOn(console, "info"); asserts accept link logged, no RESEND string |
| `apps/panel/app/api/auth/[...all]/route.ts` | toNextJsHandler(auth), panel only | VERIFIED | toNextJsHandler(auth):10; not present under apps/web |
| `apps/panel/app/api/trpc/[trpc]/route.ts` | fetchRequestHandler mounting appRouter | VERIFIED | fetchRequestHandler + appRouter + createTRPCContext wired |
| `apps/panel/lib/auth-client.ts` | createAuthClient + organizationClient with ac/roles | VERIFIED | Imports from @imbau/api/access-control (browser-safe subpath) |
| `apps/panel/lib/trpc-client.tsx` | tRPC + TanStack Query v5 provider | VERIFIED | useMutation from @tanstack/react-query, httpBatchLink to /api/trpc |
| `apps/panel/app/login/page.tsx` | client form calling authClient.signIn.email | VERIFIED | "use client", authClient.signIn.email:24 |
| `apps/panel/app/signup/page.tsx` | client form, org create + setActive after signup (Pitfall 2) | VERIFIED | authClient.signUp.email → organization.create → organization.setActive:42-76 |
| `apps/panel/app/accept-invitation/[id]/page.tsx` | acceptInvitation call, session-then-accept flow | VERIFIED | authClient.organization.acceptInvitation:44, useRef one-shot guard |
| `apps/panel/app/(dashboard)/page.tsx` | RSC reads createCaller → listForOrg, client invite form | VERIFIED | createCaller({headers}):25, listForOrg():29, TRPCReactProvider + InviteForm |
| `apps/panel/e2e/auth-flow.spec.ts` | login persistence + invite accept e2e | VERIFIED | Two tests: "login persists across a reload" + "invite accept creates member with the assigned role" |
| `apps/web/app/page.tsx` | listPublished via createCaller, force-dynamic, no auth surface | VERIFIED | createCaller:25, listPublished():26, force-dynamic:11; grep confirms no toNextJsHandler/withTenant in web |
| `apps/worker/src/index.ts` | BullMQ Queue + Worker, maxRetriesPerRequest:null, no job logic | VERIFIED | new IORedis(env.REDIS_URL, {maxRetriesPerRequest: null}):20; no-op processor:29; auto-boot guarded |
| `apps/worker/src/index.test.ts` | Redis-connect smoke test, maxRetriesPerRequest assertion | VERIFIED | expect(connection.options.maxRetriesPerRequest).toBeNull():31; Worker ready event + PING |
| `apps/panel/Dockerfile` | turbo prune, Next standalone, node:22-alpine, no install --prod | VERIFIED | turbo prune @imbau/panel --docker:14; .next/standalone copy; no install --prod |
| `apps/web/Dockerfile` | turbo prune, Next standalone, node:22-alpine, no install --prod | VERIFIED | turbo prune @imbau/web --docker:14; .next/standalone copy; no install --prod |
| `apps/worker/Dockerfile` | turbo prune, tsup dist, node apps/worker/dist/index.js | VERIFIED | turbo prune @imbau/worker --docker:14; CMD node apps/worker/dist/index.js:43 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/api/src/auth/runtime.ts` | `@imbau/db createOwnerDb` | drizzleAdapter(createOwnerDb(env.DATABASE_URL).db) | WIRED | createOwnerDb import:22, usage:28 |
| `packages/api/src/trpc/context.ts` | `auth.api.getSession` | session derived from request headers | WIRED | auth.api.getSession({headers: opts.headers}):24 |
| `packages/api/src/trpc/routers/projects.ts` | `@imbau/db withTenant/withAnon` | withTenant for listForOrg, withAnon for listPublished | WIRED | Both calls confirmed in projects.ts:17,21 |
| `packages/api/src/trpc/middleware.ts` | `@imbau/db schema.member.role` | member.role read inside withTenant | WIRED | withTenant(ctx.activeOrgId,...).member.role:18-22 |
| `apps/panel/app/api/auth/[...all]/route.ts` | `@imbau/api auth` | toNextJsHandler(auth) | WIRED | Import + toNextJsHandler(auth):10 |
| `apps/panel/app/(dashboard)/page.tsx` | `@imbau/api createCaller` | createCaller({headers}).projects.listForOrg() | WIRED | createCaller:13,25; listForOrg():29 |
| `packages/api/src/auth/runtime.ts sendInvitationEmail` | `packages/api/src/email/send-invitation.ts` | sendInvitationEmail callback | WIRED | runtime.ts:24 imports send-invitation, callback on:48 |
| `apps/web/app/page.tsx` | `@imbau/api createCaller` | createCaller({headers}).projects.listPublished() | WIRED | createCaller import:2, listPublished():26 |
| `apps/worker/src/index.ts` | Redis (REDIS_URL) | new IORedis(env.REDIS_URL, {maxRetriesPerRequest:null}) | WIRED | IORedis import:4, usage:20 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `apps/panel/app/(dashboard)/page.tsx` | `projects` (ProjectRow[]) | `createCaller → listForOrg → withTenant → schema.projects` | Yes — withTenant runs a real SELECT via app_authenticated role against Postgres; RLS filters by GUC-set org | FLOWING |
| `apps/web/app/page.tsx` | `projects` (array) | `createCaller → listPublished → withAnon → schema.projects` | Yes — withAnon runs SELECT via anon role; projects_anon_published policy filters to publicado | FLOWING |
| `packages/api/tests/trpc-tenant.test.ts` | Cross-tenant absence | `seedProject → owner SQL → actual DB rows` | Yes — seeds real rows, reads via tRPC caller with real session fixture | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| authEnv preset accessible | `SKIP_ENV_VALIDATION=1 node --input-type=module -e "import('@imbau/config/env/presets').then(m=>{if(!m.authEnv?.server?.BETTER_AUTH_SECRET)throw new Error('authEnv missing');console.log('authEnv ok')})"` | "authEnv ok" | PASS |
| @imbau/api deps complete | node check of package.json for all required deps | "api deps ok" — all 8 required deps found | PASS |
| Dockerfiles: turbo prune present, no install --prod | grep + test commands | "all dockerfiles ok" — 3 Dockerfiles pass all checks | PASS |
| apps/web has no auth surface | find + grep for toNextJsHandler/withTenant/@trpc/client in web source files | No matches — exit code 1 (clean) | PASS |
| maxRetriesPerRequest:null in worker | grep apps/worker/src/index.ts | Found at line 20 | PASS |
| nextCookies() is last plugin | grep packages/api/src/auth/runtime.ts | nextCookies() at line 54 — last entry in plugins array | PASS |
| No owner pool import in routers | grep packages/api/src/trpc/routers/ for createOwnerDb/appDb | Only comment references found (not live imports) | PASS |
| e2e test names match VALIDATION.md | grep auth-flow.spec.ts | "login persists across a reload after signup" + "invite accept creates member" — match VALIDATION.md filter patterns | PASS |
| Invitation email unit test | grep send-invitation.test.ts | vi.spyOn(console,"info") + acceptUrl assertion — substantive test body confirmed | PASS |
| Worker BullMQ/ioredis versions | node check of package.json | bullmq: 5.78.1, ioredis: 5.10.1 | PASS |

All automated behavioral checks PASS.

---

### Probe Execution

No probes declared in PLAN files. Worker Redis smoke test and @imbau/api integration tests are CI-executed tests, not probe scripts. Step 7c: SKIPPED (no probe-*.sh scripts found in this phase).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUTH-01 | 03-01, 03-03 | Email/password signup+login, session persists across refresh | SATISFIED | runtime.ts emailAndPassword; login/signup pages; nextCookies() last; e2e spec "login persists" |
| AUTH-02 | 03-01, 03-02, 03-03 | Orgs with owner/developer/viewer roles; active org = tenant | SATISFIED | access-control.ts; protectedProcedure session-derived activeOrgId; requireRole middleware; trpc-tenant.test.ts |
| AUTH-03 | 03-01, 03-02, 03-03 | Owner invites by email; invitee accepts with assigned role | SATISFIED | member.invite = requireRole("owner"); send-invitation.ts dev fallback; accept-invitation page; e2e "invite accept creates member" |
| APP-01 | 03-03 | apps/panel has login + RLS-protected read of active org | SATISFIED | dashboard RSC createCaller → listForOrg → withTenant; login/signup pages exist |
| APP-02 | 03-02, 03-04 | apps/web reads via anon role, only publicado projects visible | SATISFIED | web page.tsx listPublished → withAnon; no auth surface in web; trpc-tenant.test.ts "listPublished returns only publicado" |
| APP-03 | 03-04 | apps/worker deployable shell (BullMQ connected to Redis, no job logic) | SATISFIED | worker/src/index.ts: IORedis + Queue + Worker on 'health', no-op processor, maxRetriesPerRequest:null; smoke test exists — NOTE: REQUIREMENTS.md checkbox unchecked (documentation gap only; code delivers APP-03 fully) |
| APP-04 | 03-05 | Each app has multi-stage Dockerfile (turbo prune + standalone) | SATISFIED | Three Dockerfiles: web/panel (Next standalone), worker (tsup dist); no install --prod; .dockerignore per app |

**NOTE on APP-03:** REQUIREMENTS.md still shows `- [ ]` for APP-03 (Pending) while the implementation fully delivers it. This is a documentation tracking gap — the checkbox was not updated after plan 03-04 was completed. The code is complete.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/worker/src/index.ts` | 45, 55 | console.log | Info | Intentional structured JSON boot logs (JSON.stringify) — not a debug stub; these are the documented observability output for the shell phase. Not a defect. |
| `packages/api/src/email/send-invitation.ts` | 33 | console.info | Info | Intentional D-09 dev fallback — logs the accept link (no secret) when RESEND_API_KEY is absent. Documented design decision, unit-tested. Not a defect. |
| `.planning/REQUIREMENTS.md` | APP-03 row | Unchecked checkbox `- [ ]` | Warning | APP-03 is marked Pending in REQUIREMENTS.md traceability table but the code fully delivers it. Documentation gap only — no code action needed, but the checkbox should be updated to `[x]` and Traceability table changed to "Complete". |

No TBD/FIXME/XXX debt markers found in phase 3 source files. No unreferenced placeholder patterns.

---

### Human Verification Required

#### 1. Panel Playwright E2E — Login Persistence (AUTH-01)

**Test:** Run `pnpm --filter @imbau/panel test:e2e -g "login persists"` with Compose Postgres + Redis up and the panel running at the configured Playwright webServer port.
**Expected:** Test passes — signup creates account + org, dashboard shows "Panel · Proyectos", page reload keeps the user on the dashboard without redirecting to /login.
**Why human:** Requires a live Next.js panel server (webServer in playwright.config.ts) and the Compose database stack. Cannot verify through static analysis alone. SUMMARY 03-03 reports green but verifier cannot re-run.

#### 2. Panel Playwright E2E — Invite Accept Flow (AUTH-03)

**Test:** Run `pnpm --filter @imbau/panel test:e2e -g "invite accept"` with the same stack.
**Expected:** Owner invites a viewer → dev console logs the accept link (no Resend key) → invitee accepts at /accept-invitation/[id] → member row created with role 'viewer' → invitee lands on dashboard.
**Why human:** Same dependency on live server + live Postgres. The test reads invitation.id directly from Postgres, then drives the accept page in a fresh browser context. SUMMARY 03-03 reports both auth e2e tests green.

#### 3. Worker Redis Smoke Test (APP-03)

**Test:** Run `pnpm --filter @imbau/worker test -t "worker connects"` with Compose Redis up at redis://localhost:6380.
**Expected:** Test passes — BullMQ Worker reaches 'ready', PING returns 'PONG', maxRetriesPerRequest is null.
**Why human:** Requires live Compose Redis. SUMMARY 03-04 reports green against live Redis 7 at :6380.

---

### Gaps Summary

No blockers found. All must-have truths are VERIFIED through codebase evidence. The only outstanding item is documentation:

**Documentation gap (warning, not blocker):** REQUIREMENTS.md APP-03 checkbox remains `[ ]` (Pending) despite the worker BullMQ shell being fully implemented and tested. Update the checkbox to `[x]` and the traceability row to "Complete" before the milestone closes.

All phase 3 requirements (AUTH-01/02/03, APP-01/02/03/04) are implemented, wired, and backed by integration tests or e2e specs that ran green during execution. Three items require human confirmation (the two Playwright e2e tests and the worker Redis smoke test) because they depend on a live server/database stack that cannot be validated through static analysis.

---

_Verified: 2026-06-18T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
