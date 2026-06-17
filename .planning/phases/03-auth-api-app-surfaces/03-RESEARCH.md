# Phase 3: Auth, API & App Surfaces - Research

**Researched:** 2026-06-17
**Domain:** Better Auth runtime (sessions + organizations + invitations), tRPC v11 + Next 16 App Router/RSC, RLS-aware API context, multi-stage monorepo Dockerfiles
**Confidence:** MEDIUM-HIGH (versions HIGH/verified on npm; runtime API surface MEDIUM — official docs fetched this session, not version-locked snapshots)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Auth runtime & session wiring**
- **D-01:** Better Auth runtime lives in `packages/api`, colocated with tRPC so the tRPC context reads the session directly. Reuses the same Drizzle adapter + organization plugin stood up in phase 2 (`packages/db/auth.ts`, today CLI-only) — that config is evolved to a runtime (baseURL, endpoints, email/password provider) without duplicating the schema shape.
- **D-02:** Sessions in DB — the `session` table already exists from phase 2. No Redis session store this phase (deferred optimization).
- **D-03:** The auth handler and the login/signup/accept-invitation UI mount **only in `apps/panel`**. `apps/web` stays anon-only public, no auth.
- **D-04:** **No email-verification gate** for phase 0 — `emailVerified` column exists but login is not blocked by it; signup→login frictionless. Invitations are the email path that matters.

**tRPC API shape & tenant/role context**
- **D-05:** tRPC context derives the tenant from the session: `session.activeOrganizationId` → procedures run inside `withTenant(orgId, …)`. A `protectedProcedure` requires session + active org; a `publicProcedure` uses `withAnon()` for the anonymous path.
- **D-06:** Roles owner/developer/viewer enforced in tRPC middleware (`requireRole`) reading `member.role` for the active org, leaning on the organization plugin's access control where it fits.
- **D-07:** Minimal procedure set proving each path — `projects.listForOrg` (protected, tenant-scoped), `projects.listPublished` (public/anon), `org.setActive`/list, `member.invite` (owner-only) + `invitation.accept`. **No full CRUD.**
- **D-08:** RSC + client: tRPC server-side caller for RSC reads (panel dashboard, web listing); TanStack Query v5 hooks on the client for interactive mutations (invite). Consistent with the stack (tRPC v11 + TanStack Query v5, App Router/RSC).

**Invitations & transactional email**
- **D-09:** Dev email fallback: when `RESEND_API_KEY` is absent, log the invitation link/email to console (via the available logger); real Resend only in staging. Keeps local dev running with zero external deps.
- **D-10:** Acceptance flow with the plugin: link lands at panel `/accept-invitation/[id]` and uses the org plugin's built-in `acceptInvitation`. New users sign up first then accept; existing users log in and accept.
- **D-11:** One minimal React Email template (es-AR, voseo) for the invitation — functional, foundation-level, no branded design.
- **D-12:** Only the owner invites (AUTH-03); the inviter picks the role among owner/developer/viewer; suggested default = `viewer`.

**App-surface UI scope & Docker delivery**
- **D-13:** Minimal functional UI (flat, accessible, es-AR voseo) — NOT the showroom design. Visual polish deferred (ventana-Fable). Minimal reuse of `packages/ui`.
- **D-14:** `apps/web`: a list of published projects (name/slug/estado) via `withAnon`/`anon` role — just enough to prove the anonymous path (APP-02). Detail page optional.
- **D-15:** `apps/panel`: login → dashboard with the active org's projects (tenant-scoped read) + members/invite section. Proves APP-01 + AUTH-02/03.
- **D-16:** Multi-stage Dockerfile per app (prune stage `turbo prune <app> --docker` → install/build → slim Node 22 Alpine runner; Next standalone for web/panel, tsup output for worker). Authored in phase 3; image build verified in CI (phase 4) because there is no local Docker daemon.

### Claude's Discretion
- Internal layout of the tRPC folder in `packages/api` (routers, context, middleware); exact router/procedure names beyond the D-07 minimal set.
- Concrete shape of evolving `packages/db/auth.ts` to a runtime in `packages/api` (re-export vs new instance importing the same plugin/adapter config), as long as the schema does not diverge from phase 2.
- Exact layout of panel/web pages; which minimal components go to `packages/ui` vs local to the app.
- Details of the Better Auth catch-all route handler in Next App Router and of the auth client (`organizationClient`) in the panel.
- Fine mechanics of the Dockerfiles (layer order, cache mounts) within CLAUDE.md's prune→build→standalone-runner pattern.

### Deferred Ideas (OUT OF SCOPE)
- Redis as Better Auth secondary session storage — optimization; phase 3 uses DB sessions (D-02).
- Mandatory email verification at signup — deferred (D-04).
- Full CRUD of projects/orgs/members, project detail page in web, advanced role management — future milestones.
- Docker image build/push and staging deploy (CI-03, INFRA-01/02/03) and observability (OBS-01/02/03) — **phase 4**.
- Real design system / showroom visual polish — future milestones.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Email/password register+login via Better Auth; session persists across refresh | `emailAndPassword:{enabled:true}` server config + DB `session` table (phase 2) + `nextCookies()` plugin; client `signUp.email`/`signIn.email`. See Standard Stack + Pattern 1. |
| AUTH-02 | User belongs to orgs with owner/developer/viewer roles; active org of session determines tenant | organization plugin + `createAccessControl` roles; `session.activeOrganizationId` → `withTenant(orgId)`. See Pattern 2 + Pattern 4. |
| AUTH-03 | Owner invites members by email (Resend + React Email); invitee accepts and enters with assigned role | `organization({sendInvitationEmail})` + `inviteMember`/`acceptInvitation`; Resend + React Email with dev console fallback. See Pattern 5. |
| APP-01 | `apps/panel` has working login + page reading RLS-protected data of the active org | Better Auth handler in panel + tRPC `protectedProcedure` → `withTenant` → `projects.listForOrg`. See Pattern 3 + Pattern 4. |
| APP-02 | `apps/web` reads via `anon` role and only sees `publicado` projects | tRPC `publicProcedure` → `withAnon()` → `projects.listPublished`; no auth handler in web. See Pattern 3. |
| APP-03 | `apps/worker` is a deployable shell (BullMQ connected to Redis, no job logic) | BullMQ Queue/Worker wiring to `REDIS_URL` + a no-op/health job; tsup build. See Pattern 6. |
| APP-04 | Each app has multi-stage Dockerfile with `turbo prune` + Next.js standalone producing deployable images | prune→install/build→runner pattern from CLAUDE.md; Next `output:'standalone'` already set. See Pattern 7. |
</phase_requirements>

## Summary

This phase puts the **auth runtime + API layer + app surfaces** on top of the data layer closed in phase 2 (`packages/db` exports `withTenant`/`withAnon`/`appDb`/`anonDb`; org IDs are TEXT; `member`/`organization`/`projects` carry RLS; the Better Auth tables already exist via the CLI-generated, version-controlled migration). All five surfaces are well-trodden with official patterns; the load-bearing integration is wiring **`session.activeOrganizationId` → `withTenant(orgId)`** inside the tRPC context, and being deliberate about which Postgres role Better Auth itself uses.

The single biggest landmine: **Better Auth's Drizzle adapter writes to `member`/`organization`/`session`/`user`/etc., but `member` and `organization` have RLS policies and the app pool connects as `app_authenticated` (NOSUPERUSER, NOBYPASSRLS, no table ownership).** Better Auth's own operations (create org, accept invitation → insert `member`, set active org) must run on a connection that can satisfy or bypass those policies. Phase 2 deliberately gave Better Auth no runtime DB; phase 3 must choose the adapter's pool consciously (see Pitfall 1 — this is the decision the planner most needs to lock).

Everything else is mechanical and version-confirmed: TS 5.9.3, Next 16.2.9 (`output:'standalone'` set), React 19.2.7, better-auth 1.6.18, drizzle-orm 0.45.2, postgres 3.4.9, Zod 4.4.3, and the new tRPC 11.17.0 + TanStack Query 5 + Resend + React Email + BullMQ + ioredis additions — all verified on the npm registry this session and already pinned in CLAUDE.md.

**Primary recommendation:** Build a single `auth` runtime in `packages/api` that imports the exact plugin/adapter config from `packages/db/auth.ts` (no schema divergence), adds `emailAndPassword`, `baseURL`, the access-control roles, `sendInvitationEmail`, and `nextCookies()` **last**; give its Drizzle adapter a dedicated **owner/elevated** pool (Better Auth manages auth tables outside the tenant-RLS read path) while application reads/writes continue through `withTenant`/`withAnon`. Mount the catch-all handler only in `apps/panel`. Wire the tRPC context to read the session and route protected procedures through `withTenant(session.activeOrganizationId)` and public ones through `withAnon()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Email/password auth, session issuance | API / Backend (Better Auth runtime in `packages/api`, mounted in panel route handler) | DB (`session`/`user`/`account`) | Sessions are DB-backed (D-02); credential handling is server-only. Never client-side. |
| Organization membership + roles | API / Backend (org plugin + access control) | DB (`member`/`organization` w/ RLS) | Role is `member.role`; tenant identity is `organization.id` (TEXT). |
| Active-org → tenant resolution | API / Backend (tRPC context) | DB (`withTenant` GUC) | Tenant is derived server-side from `session.activeOrganizationId`; never trust a client-supplied orgId. |
| Tenant-scoped reads (panel dashboard) | API / Backend (`protectedProcedure` → `withTenant`) | DB (RLS policies) | RLS enforces isolation; the procedure just sets the GUC. |
| Anonymous published reads (web) | API / Backend (`publicProcedure` → `withAnon`) | DB (anon role, `publicado` filter) | `apps/web` has no auth; anon role + policy is the only path. |
| Invitation send | API / Backend (org plugin `sendInvitationEmail`) → Email service | — | Resend in staging; console-log fallback in dev (D-09). |
| Invitation accept | API / Backend (org plugin `acceptInvitation`) | DB (`member` insert) | Inserts a `member` row — RLS interaction (see Pitfall 1). |
| Login/signup/accept-invitation UI | Frontend Server (panel RSC) + Client (forms) | — | Minimal functional UI (D-13); panel only (D-03). |
| Web published-projects page | Frontend Server (web RSC, server caller) | API | RSC read via server caller; no client interactivity needed (D-14). |
| Background job runtime | Worker (BullMQ Worker process) | Redis | Shell only this phase (D-16/APP-03); no job logic. |
| Container packaging | Build/CI (Dockerfiles) | — | Authored here; built in CI phase 4 (no local Docker). |

## Standard Stack

### Core (already pinned in repo / CLAUDE.md — verify, do NOT upgrade)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-auth` | `1.6.18` | Auth runtime: email/password, sessions, organization plugin, invitations | Already installed; CLI config exists in `packages/db/auth.ts`. [VERIFIED: npm registry — `better-auth@1.6.18` exists, latest line is 2.0.x but stack is pinned to 1.6.18] |
| `@better-auth/cli` | `1.4.21` (dev) | Schema generate only (phase 2 used it); not run at runtime | Pinned; `overrides.better-call: 1.3.6` reconciles its peer with runtime 1.6.18. [VERIFIED: repo `pnpm-workspace.yaml`] |
| `next` | `16.2.9` | `apps/panel` (auth UI + dashboard) and `apps/web` (anon listing) | App Router, RSC, `output:'standalone'` already set. [VERIFIED: repo] |
| `react` / `react-dom` | `19.2.7` | UI runtime | Matches Next 16. [VERIFIED: repo] |
| `drizzle-orm` | `0.45.2` | Schema + queries + RLS policies (phase 2, not re-touched) | [VERIFIED: repo] |
| `postgres` (porsager) | `3.4.9` | Driver behind `appDb`/`anonDb`/owner pool | [VERIFIED: repo] |
| `zod` | `4.4.3` | tRPC input validation + env parsing | tRPC v11 supports Zod 4. [VERIFIED: repo] |

### Supporting (phase 3 ADDS these — verify legitimacy before install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@trpc/server` | `11.17.0` | tRPC router/init in `packages/api` | Typed API boundary. [VERIFIED: npm registry — `11.17.0`, 3.9M/wk, repo github.com/trpc/trpc] |
| `@trpc/client` | `11.17.0` | Client transport (`httpBatchLink`) in panel | [VERIFIED: npm registry — `11.17.0`, 3.2M/wk] |
| `@trpc/tanstack-react-query` | `11.17.0` | `createTRPCOptionsProxy` (RSC) + `createTRPCContext` (client) | v11 native TanStack Query v5 integration. [VERIFIED: npm registry — `11.17.0`, 700k/wk] |
| `@tanstack/react-query` | `5.x` (latest `5.101.0`) | Client cache; peer of the tRPC integration | Pin v5 — NOT v4 (v4 is for tRPC v10). [VERIFIED: npm registry — `5.101.0`, 58M/wk] |
| `resend` | `6.x` (latest `6.14.0`) | Transactional email (invitation) | Used only in staging (D-09). [VERIFIED: npm registry — `6.14.0`, 7.3M/wk, repo resend/resend-node] |
| `@react-email/components` | `1.0.12` | Invitation email template (es-AR voseo) | One minimal template (D-11). [VERIFIED: npm registry — `1.0.12` is `latest`; see Audit re: deprecation flag] |
| `bullmq` | `5.x` (latest `5.78.1`) | Worker Queue/Worker wiring to Redis (shell) | No job logic this phase (APP-03). [VERIFIED: npm registry — `5.78.1`, 6.4M/wk, repo taskforcesh/bullmq] |
| `ioredis` | `5.x` (latest `5.11.1`) | Redis client for BullMQ | BullMQ's expected client. [VERIFIED: npm registry — `5.11.1`, 22M/wk] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@trpc/tanstack-react-query` proxy | Classic `createTRPCReact` (`@trpc/react-query`) | The TanStack-Query proxy is the v11-blessed App Router/RSC path (`queryOptions` + `createTRPCOptionsProxy`); the classic React adapter still works but the proxy is the current idiom and pairs cleanly with RSC prefetch. Use the proxy. |
| Server caller via `createTRPCOptionsProxy` + prefetch/Hydration | `appRouter.createCaller(ctx)` direct call in RSC | For pure RSC reads that don't need client hydration (web listing, D-14), a direct `createCaller` is simpler. For panel pages that hydrate into client mutations, use the proxy + HydrationBoundary. Both are valid; pick per page. |
| Better Auth `sendInvitationEmail` callback | Hand-rolled invite tokens | None — the org plugin owns invitation lifecycle (create/accept/expire). Hand-rolling re-implements `invitation` table semantics already migrated in phase 2. |

**Installation (verify each package via the legitimacy gate first):**
```bash
# packages/api
pnpm --filter @imbau/api add @trpc/server@11.17.0 @trpc/client@11.17.0 @trpc/tanstack-react-query@11.17.0 @tanstack/react-query@5 zod@4.4.3 resend @react-email/components
# apps/panel (client transport + auth client)
pnpm --filter @imbau/panel add @trpc/client@11.17.0 @trpc/tanstack-react-query@11.17.0 @tanstack/react-query@5 better-auth@1.6.18
# apps/worker (BullMQ shell)
pnpm --filter @imbau/worker add bullmq ioredis
```
(`server-only` / `client-only` marker packages may be added per the tRPC RSC pattern.)

## Package Legitimacy Audit

> Run via `gsd-tools query package-legitimacy check --ecosystem npm <pkgs>` (executed 2026-06-17).

| Package | Registry | Age (publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------|-----------|-------------|---------|-------------|
| `@trpc/server` | npm | 2026-04-28 | 3.9M/wk | github.com/trpc/trpc | OK | Approved |
| `@trpc/client` | npm | 2026-04-28 | 3.2M/wk | github.com/trpc/trpc | OK | Approved |
| `@trpc/tanstack-react-query` | npm | 2026-04-28 | 700k/wk | github.com/trpc/trpc | OK | Approved |
| `@tanstack/react-query` | npm | 2026-06-02 | 58M/wk | github.com/TanStack/query | SUS (too-new) | Approved — false positive (58M/wk, mainstream; recent patch) |
| `resend` | npm | 2026-06-17 | 7.3M/wk | github.com/resend/resend-node | SUS (too-new) | Approved — false positive (7.3M/wk; recent patch, same day) |
| `@react-email/components` | npm | 2026-04-09 | 3.9M/wk | github.com/resend/react-email | SUS (deprecated) | Approved with verify — see note below |
| `bullmq` | npm | 2026-06-13 | 6.4M/wk | github.com/taskforcesh/bullmq | SUS (too-new) | Approved — false positive (6.4M/wk; recent patch) |
| `ioredis` | npm | 2026-06-04 | 22M/wk | github.com/luin/ioredis | SUS (too-new) | Approved — false positive (22M/wk; recent patch) |
| `better-auth` | npm | — | — | github.com/better-auth/better-auth | OK | Already installed (1.6.18) |

**Packages removed due to [SLOP] verdict:** none.

**Packages flagged as suspicious [SUS]:** `@tanstack/react-query`, `resend`, `bullmq`, `ioredis` are all flagged **`too-new`** — the heuristic fires on a recent publish *date*, but each is a mainstream package with millions of weekly downloads and an authoritative source repo; these are recent **patch** releases of long-lived libraries, not new packages. Treated as false positives. `@react-email/components@1.0.12` carries a **`deprecated`** flag, but the deprecation string is npm's generic boilerplate ("Package no longer supported. Contact Support…") and `1.0.12` is still the **`latest`** tag — this looks like a registry-metadata quirk on the current version, not a real abandonment. None of `postinstall` scripts are present on any package (all `null`).

> **Planner action:** Add ONE `checkpoint:human-verify` task before the first install of `@react-email/components` to confirm the package is healthy at install time (the deprecation flag on the `latest` version warrants a 30-second human glance at npm/GitHub). The `too-new` packages need no checkpoint — they are CLAUDE.md-pinned, high-trust libraries. All other packages are clean.

## Architecture Patterns

### System Architecture Diagram

```
                          apps/web (Next 16, RSC)            apps/panel (Next 16, RSC + client)
                          NO auth handler                    Better Auth handler mounted here
                                 |                                    |
                          published-projects page          login / signup / dashboard / invite UI
                                 |                                    |
                                 |  RSC read                          |  RSC read + client mutations
                                 v                                    v
              ┌──────────────────────────── packages/api ────────────────────────────┐
              |                                                                        |
              |   tRPC router  ──────────────────────────────────────────────────┐    |
              |     publicProcedure ── withAnon() ────────────► anonDb (role anon) |    |
              |     protectedProcedure ── ctx.session ──┐                          |    |
              |        │ requireRole(member.role)        │                         |    |
              |        └─ withTenant(activeOrgId) ───────┼──► appDb (app_authenticated, GUC set)
              |                                          │                         |    |
              |   tRPC context: reads Better Auth session│ via auth.api.getSession │    |
              |                                          │                         |    |
              |   Better Auth runtime (betterAuth(...)) ─┘                         |    |
              |     emailAndPassword + organization plugin + access control        |    |
              |     + sendInvitationEmail (Resend | dev console) + nextCookies()    |    |
              |     Drizzle adapter ──► OWNER/elevated pool (manages auth tables) ──┼──► Postgres 16
              └────────────────────────────────────────────────────────────────────┘    |
                                                                                          |
   apps/worker (BullMQ Worker shell) ──── ioredis ──► Redis 7  (no job logic)             |
                                                                                          |
                          Resend API (staging only) ◄── invitation email                 |
                                                                                          v
                          Postgres 16: user/session/account/organization/member/invitation/projects
                          RLS on: organization, member, projects (FORCE ROW LEVEL SECURITY)
```

Trace the panel happy path: browser → panel login form → `signIn.email` (Better Auth handler) → session cookie set (via `nextCookies`) → dashboard RSC → tRPC server caller → `protectedProcedure` reads `session.activeOrganizationId` → `withTenant(orgId)` → `appDb` with GUC set → RLS returns only that org's `projects`.

### Recommended Project Structure
```
packages/api/src/
├── auth/
│   ├── runtime.ts          # betterAuth({...}) — imports plugin/adapter config from @imbau/db, adds email/pw, roles, sendInvitationEmail, nextCookies()
│   └── access-control.ts   # createAccessControl(statement) + owner/developer/viewer roles
├── trpc/
│   ├── init.ts             # initTRPC.create(); createTRPCContext = cache(...); publicProcedure/protectedProcedure/createCallerFactory
│   ├── context.ts          # builds ctx: { session, headers } from auth.api.getSession
│   ├── middleware.ts       # requireRole(...); enforceTenant
│   └── routers/
│       ├── _app.ts         # appRouter = router({ projects, org, member, invitation })
│       ├── projects.ts     # listForOrg (protected/withTenant), listPublished (public/withAnon)
│       ├── org.ts          # list, setActive
│       ├── member.ts       # invite (owner-only)
│       └── invitation.ts   # accept
├── email/
│   ├── send-invitation.ts  # Resend if RESEND_API_KEY else console.log link (D-09)
│   └── templates/invitation.tsx   # React Email, es-AR voseo (D-11)
└── index.ts                # re-export auth, appRouter, AppRouter type, createCaller helper

apps/panel/app/
├── api/auth/[...all]/route.ts     # toNextJsHandler(auth) → { GET, POST }  (D-03)
├── api/trpc/[trpc]/route.ts       # fetchRequestHandler for tRPC
├── login/page.tsx, signup/page.tsx
├── accept-invitation/[id]/page.tsx
└── (dashboard)/page.tsx           # RSC read of org projects + members/invite section

apps/web/app/
└── page.tsx                        # RSC published-projects list via server caller → withAnon
  # NO api/auth route — web is anon-only (D-03)

apps/worker/src/
└── index.ts                        # BullMQ Queue + Worker wired to REDIS_URL, no-op/health job
```

### Pattern 1: Better Auth runtime evolved from the CLI config (D-01)
**What:** Promote `packages/db/auth.ts` (CLI-only) into a real runtime in `packages/api`, importing the SAME `organization({schema:{...additionalFields.plan}})` config so the schema never diverges from phase 2.
**When:** Foundation of the whole phase.
```typescript
// Source: better-auth.com/docs/integrations/next + /docs/authentication/email-password
// packages/api/src/auth/runtime.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { ac, owner, developer, viewer } from "./access-control";
// IMPORTANT: this adapter pool must be able to write member/organization (RLS tables).
// See Pitfall 1 — phase 2 gave Better Auth NO runtime db; choose the pool here.
import { createOwnerDb } from "@imbau/db";
import { sendInvitationEmail } from "../email/send-invitation";

const { db } = createOwnerDb(env.DATABASE_URL); // elevated/owner pool — NOT appDb

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true, requireEmailVerification: false }, // D-04
  plugins: [
    organization({
      ac,
      roles: { owner, developer, viewer },
      schema: { organization: { additionalFields: { plan: { type: "string", required: false } } } }, // matches phase 2
      async sendInvitationEmail(data) {
        // data: { id, email, role, organization, inviter: { user } }
        await sendInvitationEmail(data);
      },
    }),
    nextCookies(), // MUST be last — enables cookie setting from server actions
  ],
});
export type Auth = typeof auth;
```

### Pattern 2: Access control roles owner/developer/viewer (AUTH-02, D-06)
**What:** Define a statement + three roles via `createAccessControl`; pass to both server plugin and client.
```typescript
// Source: better-auth.com/docs/plugins/organization (access control)
// packages/api/src/auth/access-control.ts
import { createAccessControl } from "better-auth/plugins/access";

const statement = {
  project: ["read", "create", "update", "delete"],
  member: ["invite", "remove"],
} as const;

export const ac = createAccessControl(statement);
export const owner = ac.newRole({ project: ["read","create","update","delete"], member: ["invite","remove"] });
export const developer = ac.newRole({ project: ["read","create","update"] });
export const viewer = ac.newRole({ project: ["read"] });
```
> Default org-plugin roles are `owner`/`admin`/`member`. We override `roles` to `owner`/`developer`/`viewer` to match the domain. Verify the `creatorRole` (org creator) default is `owner` and set it explicitly if needed.

### Pattern 3: tRPC v11 + Next 16 — server caller (RSC) + TanStack Query v5 client (D-08)
**What:** `initTRPC` with `cache`d context; RSC reads via server caller / options proxy; client mutations via `useMutation`.
```typescript
// Source: trpc.io/docs/client/tanstack-react-query/server-components
// packages/api/src/trpc/init.ts
import { initTRPC, TRPCError } from "@trpc/server";
import { cache } from "react";
// No transformer needed unless Dates/Maps must cross the boundary; add superjson only if so.

export const createTRPCContext = cache(async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({ headers: opts.headers });
  return { session, headers: opts.headers };
});
const t = initTRPC.context<Awaited<ReturnType<typeof createTRPCContext>>>().create();
export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.session || !ctx.session.session.activeOrganizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, activeOrgId: ctx.session.session.activeOrganizationId } });
});
```
```typescript
// RSC read (web/panel): direct caller is simplest for pure reads (D-14)
// apps/web/app/page.tsx
import { createCaller } from "@imbau/api"; // wraps createCallerFactory(appRouter)(ctx)
export default async function Page() {
  const caller = await createCaller({ headers: await headers() });
  const projects = await caller.projects.listPublished();
  return <ul>{projects.map(p => <li key={p.id}>{p.name} · {p.slug}</li>)}</ul>;
}
```
```typescript
// Client mutation (panel invite form)
// Source: trpc.io/docs/.../server-components
"use client";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
function InviteForm() {
  const trpc = useTRPC();
  const invite = useMutation(trpc.member.invite.mutationOptions());
  // invite.mutate({ email, role });
}
```
> tRPC route handler in panel: `app/api/trpc/[trpc]/route.ts` using `fetchRequestHandler({ endpoint: '/api/trpc', req, router: appRouter, createContext: () => createTRPCContext({ headers: req.headers }) })`.

### Pattern 4: tenant/anon routing inside procedures (D-05, the load-bearing seam)
**What:** Protected procedures pass `activeOrgId` into `withTenant`; public ones use `withAnon`.
```typescript
// packages/api/src/trpc/routers/projects.ts
import { withTenant, withAnon, schema } from "@imbau/db";
export const projectsRouter = router({
  listForOrg: protectedProcedure.query(({ ctx }) =>
    withTenant(ctx.activeOrgId, (tx) => tx.select().from(schema.projects))
  ), // RLS returns only the active org's rows
  listPublished: publicProcedure.query(() =>
    withAnon((tx) => tx.select().from(schema.projects))
  ), // anon policy returns only estado='publicado'
});
```
```typescript
// requireRole middleware (D-06) — reads member.role for the active org
export const requireRole = (...allowed: Array<"owner"|"developer"|"viewer">) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const [m] = await withTenant(ctx.activeOrgId, (tx) =>
      tx.select({ role: schema.member.role }).from(schema.member)
        .where(eq(schema.member.userId, ctx.session.user.id)));
    if (!m || !allowed.includes(m.role as any)) throw new TRPCError({ code: "FORBIDDEN" });
    return next();
  });
// member.invite = requireRole("owner").mutation(...)  → AUTH-03 owner-only (D-12)
```

### Pattern 5: invitations — send + accept (AUTH-03, D-09/D-10/D-11/D-12)
**What:** `sendInvitationEmail` callback dispatches the email; the invitee hits `/accept-invitation/[id]`; the page calls `acceptInvitation`.
```typescript
// packages/api/src/email/send-invitation.ts (D-09 dev fallback)
import { Resend } from "resend";
import { InvitationEmail } from "./templates/invitation"; // React Email, es-AR voseo
export async function sendInvitationEmail(data: { id: string; email: string; role: string; organization: { name: string }; inviter: { user: { name: string } } }) {
  const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
  if (!env.RESEND_API_KEY) {
    console.info(`[invite] ${data.email} → ${data.organization.name} (${data.role}) :: ${acceptUrl}`);
    return;
  }
  const resend = new Resend(env.RESEND_API_KEY);
  await resend.emails.send({ from: env.INVITE_FROM, to: data.email, subject: `Te invitaron a ${data.organization.name}`, react: InvitationEmail({ acceptUrl, orgName: data.organization.name, inviter: data.inviter.user.name }) });
}
```
```typescript
// apps/panel/app/accept-invitation/[id]/page.tsx — client uses org plugin (D-10)
"use client";
import { authClient } from "@/lib/auth-client";
// new user: signUp first then accept; existing: signIn then accept
// await authClient.organization.acceptInvitation({ invitationId: id });
```
> Invite is created server-side via `authClient.organization.inviteMember({ email, role })` (owner picks role; default `viewer` — D-12), which triggers `sendInvitationEmail`.

### Pattern 6: worker shell (APP-03, D-16)
**What:** A deployable BullMQ Worker connected to Redis, **no job logic**.
```typescript
// apps/worker/src/index.ts
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }); // BullMQ requires null
export const healthQueue = new Queue("health", { connection });
const worker = new Worker("health", async (job) => { /* shell: no real jobs yet */ return "ok"; }, { connection });
worker.on("ready", () => console.info("[worker] connected to Redis, awaiting jobs"));
```
> `maxRetriesPerRequest: null` on the ioredis connection is **required** by BullMQ (workers throw otherwise). Redis runs on host `:6380`→container `6379` per phase-2 Compose (`REDIS_URL` already a validated env preset).

### Pattern 7: multi-stage Dockerfile (APP-04, D-16, CLAUDE.md)
**What:** prune → install/build → slim runner. Authored only; built in CI (phase 4). Pattern is already documented in CLAUDE.md §"Architecture-adjacent configuration notes".
```dockerfile
# Source: CLAUDE.md + turborepo.dev/docs/guides/tools/docker
# ---- prune ----
FROM node:22-alpine AS pruner
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @imbau/panel --docker
# ---- install + build ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@imbau/panel
# ---- runner (Next standalone) ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/panel/.next/standalone ./
COPY --from=builder /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=builder /app/apps/panel/public ./apps/panel/public
CMD ["node", "apps/panel/server.js"]
```
> Worker variant copies the tsup `dist/` and runs `node dist/index.js` instead of the Next standalone copy. Do NOT run `pnpm install --prod` inside `.next/standalone` (breaks pnpm-symlinked traced node_modules — CLAUDE.md "What NOT to Use").

### Anti-Patterns to Avoid
- **Trusting a client-supplied `orgId`** for tenant scoping. Always derive from `session.activeOrganizationId` server-side (D-05). A client could otherwise read another org.
- **Running Better Auth's adapter on `appDb` (`app_authenticated`)** without verifying it can write `member`/`organization`. Those tables are RLS-forced and the app role has no ownership/BYPASSRLS → inserts on org create / invite accept can silently default-deny (see Pitfall 1).
- **TanStack Query v4 with tRPC v11.** v11 needs v5 (CLAUDE.md). Mixing breaks types/runtime.
- **`nextCookies()` not last in the plugins array.** Cookies won't be set from server actions.
- **`turbo.json` `pipeline` key.** Renamed to `tasks` in Turborepo 2.x (CLAUDE.md). Use `tasks`.
- **Mounting the auth handler in `apps/web`.** Web is anon-only (D-03).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session management / cookies | Custom JWT + cookie logic | Better Auth sessions + `nextCookies()` | CSRF, rotation, expiry, secure flags handled. |
| Invitation token lifecycle | Custom token table + expiry | org plugin `inviteMember`/`acceptInvitation` + migrated `invitation` table | Phase 2 already migrated the table; plugin owns create/accept/expire. |
| Password hashing | Custom bcrypt/argon wiring | Better Auth `emailAndPassword` (scrypt by default) | Hand-rolling hashing is a security footgun. |
| Tenant isolation | App-layer `WHERE org_id=` filters | RLS + `withTenant` (phase 2) | DB-enforced; app filters leak on a missed `WHERE`. |
| Typed API client + cache | Custom fetch wrappers | tRPC v11 + TanStack Query v5 | End-to-end types, batching, cache. |
| Email rendering | String-concatenated HTML | React Email components | Cross-client HTML is a swamp; one component for the invite. |
| Queue/worker primitives | Custom Redis BRPOP loop | BullMQ Queue/Worker | Retries, concurrency, backoff — even though phase 3 only needs the shell. |

**Key insight:** Phase 2 already paid down the hard isolation work (RLS, roles, `withTenant`). Phase 3's job is to *route through* those primitives correctly, not to add a second isolation layer — and to let Better Auth own everything auth-shaped.

## Runtime State Inventory

> Phase 3 is greenfield application code on top of phase-2 data layer; it is not a rename/refactor/migration. The only "runtime state" considerations:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `organization`/`member`/`session`/`user`/`account`/`invitation`/`projects` tables exist (phase 2 migration). Better Auth will WRITE to these at runtime. | No new migration expected — auth tables already match the CLI-generated schema. If runtime reveals a missing column the plugin needs, go via `drizzle-kit generate` + `migrate` (never push). Verify before assuming. |
| Live service config | None — no external service holds the old/new strings. Resend is config-only (`RESEND_API_KEY`). | None. |
| OS-registered state | None — no daemons/tasks registered. | None. |
| Secrets/env vars | New env vars needed: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY` (optional in dev), `INVITE_FROM`. `packages/config/env/presets.ts` lacks an auth preset (confirmed) — phase 3 adds one. | Add `authEnv` preset; panel composes it. SOPS-encrypted secrets are phase 4 (do not add SOPS here). |
| Build artifacts | None stale — `packages/api` is a placeholder; tRPC/auth code is net-new. | None. |

## Common Pitfalls

### Pitfall 1: Better Auth's adapter pool vs RLS (THE load-bearing decision)
**What goes wrong:** Better Auth's Drizzle adapter inserts/updates `member`, `organization`, `session`, etc. `member` and `organization` are RLS-FORCED (phase 2), and `appDb` connects as `app_authenticated` (NOSUPERUSER, NOBYPASSRLS, no ownership). Operations like *create organization*, *accept invitation* (inserts a `member`), or *set active org* run **before** any tenant GUC is set — so the RLS policy `organization_id = current_setting('app.current_organization_id', true)::text` evaluates against an unset GUC and **default-denies the write**. The org/invite flow silently fails or returns empty.
**Why it happens:** Phase 2 deliberately gave Better Auth NO runtime DB (CLI-only) precisely to defer this. Auth-table management is a different security model than tenant-scoped app reads.
**How to avoid:** Give the Better Auth adapter a **dedicated elevated pool** — the owner/migration role via `createOwnerDb(env.DATABASE_URL)` — so the auth runtime can manage its own tables, while application reads/writes keep flowing through `withTenant`/`withAnon` on the unprivileged pools. This keeps RLS enforced for the tenant data path (the security boundary that matters) without fighting RLS on auth bookkeeping. **Alternative to evaluate:** keep Better Auth on the app role but add explicit policies/GRANTs so `app_authenticated` may write `organization`/`member` for its own user — more surface, more footguns. **Recommend the dedicated elevated pool for the auth adapter.** [ASSUMED — this is the highest-risk design choice; planner should lock it explicitly and the verifier should prove org-create + invite-accept actually write rows.]
**Warning signs:** "create organization" returns success but no row; `acceptInvitation` doesn't add a `member`; dashboard shows empty even with seeded data.

### Pitfall 2: `session.activeOrganizationId` is null right after signup
**What goes wrong:** A fresh user has no active organization, so `protectedProcedure` (which requires `activeOrganizationId`) rejects every tenant read; the dashboard 401s.
**Why it happens:** Better Auth doesn't auto-set an active org. It's set by `setActive({ organizationId })` or a `databaseHooks.session.create.before` default.
**How to avoid:** On first login / org creation, call `organization.setActive`. For the single-org common case, set a default active org via the session creation hook, or redirect to an org-picker if the user has memberships but no active org. Make `org.setActive` part of the D-07 minimal set.
**Warning signs:** Logged-in user gets UNAUTHORIZED on the dashboard; `session.activeOrganizationId` is `null` in the context.

### Pitfall 3: `nextCookies()` ordering / missing
**What goes wrong:** Login "succeeds" but the session cookie isn't set (server action path), so the next request is unauthenticated.
**Why it happens:** `nextCookies()` must be the **last** plugin; it hooks cookie-setting for Next server actions.
**How to avoid:** Place `nextCookies()` last in the plugins array. Verify a fresh login persists across a page refresh (AUTH-01 exit criterion).

### Pitfall 4: TanStack Query major mismatch
**What goes wrong:** Type errors / runtime breakage pairing `@tanstack/react-query@4` with `@trpc/tanstack-react-query@11`.
**How to avoid:** Pin `@tanstack/react-query@5`. (CLAUDE.md "What NOT to Use".)
**Warning signs:** `queryOptions`/`mutationOptions` type mismatches; provider type errors.

### Pitfall 5: pnpm standalone tracing in Docker
**What goes wrong:** Running `pnpm install --prod` inside `.next/standalone` breaks the @vercel/nft-traced symlinked node_modules.
**How to avoid:** Trust `output:'standalone'` tracing; copy the traced tree as-is (CLAUDE.md). Worker uses tsup `dist/` instead.
**Note:** Image build is **verified in CI (phase 4)** — no local Docker daemon. Author the Dockerfile correctly; do not attempt `docker build` locally.

### Pitfall 6: port collision on local dev
**What goes wrong:** `apps/web`:3000 and `apps/panel`:3001 collide with the user's CLINICAL project (memory: CLINICAL owns :3000/:3001).
**How to avoid:** Stop CLINICAL or reassign dev ports when running both apps locally to validate the login flow. Not blocking for build/CI.

### Pitfall 7: Drizzle adapter session-shape expectations
**What goes wrong:** Better Auth expects specific column names/relations on `session`/`user`/`member`. The phase-2 fold must match exactly (it was CLI-generated, so it should).
**How to avoid:** The `auth-schema.ts` fold came straight from `@better-auth/cli generate` with the same plugin config — it matches. If the runtime complains about a field, re-run `generate` with the runtime config and diff against the committed schema; reconcile via a versioned migration. Do not hand-edit. [ASSUMED — verify by booting the runtime against the existing schema once.]

## Code Examples

(See Patterns 1–7 above — each carries a `// Source:` line. The most load-bearing are Pattern 1 (auth runtime + `nextCookies` last), Pattern 3 (tRPC RSC + client), and Pattern 4 (the `withTenant`/`withAnon` seam).)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@trpc/react-query` (`createTRPCReact`) | `@trpc/tanstack-react-query` (`createTRPCOptionsProxy` + `useTRPC`/`queryOptions`) | tRPC v11 | Use the proxy for App Router/RSC; it's the v11 idiom. |
| TanStack Query v4 | v5 | with tRPC v11 | v4 incompatible with v11. |
| NextAuth/Auth.js org logic hand-rolled | Better Auth organization plugin | — | Memberships/invitations/roles are first-class. |
| Pages Router API routes | App Router catch-all `[...all]` + `toNextJsHandler` | Next 13+ | Single handler mounts all Better Auth endpoints. |

**Deprecated/outdated:**
- Turborepo `pipeline` key → `tasks` (2.x).
- `@react-email/components@1.0.12` carries a generic npm "no longer supported" flag on the `latest` version — treated as a metadata quirk, but verify at install (see Audit).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Better Auth's adapter should use a dedicated **owner/elevated** pool so it can write RLS-forced `organization`/`member` tables | Pitfall 1 / Pattern 1 | HIGH — wrong pool → org-create/invite-accept silently default-deny; core flows broken. Planner must lock this; verifier must prove writes land. |
| A2 | The phase-2 `auth-schema.ts` fold matches what better-auth 1.6.18 runtime expects (it was CLI-generated with the same config) | Pitfall 7 | MEDIUM — a missing column needs a new migration before the runtime works. |
| A3 | Override org-plugin default roles (`owner/admin/member`) with `owner/developer/viewer` via `ac`/`roles`, and `creatorRole` defaults to `owner` | Pattern 2 | MEDIUM — if role override semantics differ in 1.6.18, role checks misfire. Verify exact `roles`/`creatorRole` API. |
| A4 | tRPC v11 RSC pattern (`createTRPCOptionsProxy` / direct `createCaller`) and route-handler wiring as shown are correct for 11.17.0 + Next 16 | Pattern 3 | MEDIUM — API surface fetched from current docs, not a 11.17.0-locked snapshot; verify imports compile. |
| A5 | `requireEmailVerification` defaults to `false` (D-04 needs no gate) | Pattern 1 | LOW — confirmed in docs; if wrong, set it explicitly. |
| A6 | `@react-email/components@1.0.12` deprecation flag is a metadata quirk, not real abandonment | Audit | LOW — at worst swap to a maintained version; one human checkpoint covers it. |
| A7 | New env vars are `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `INVITE_FROM` | Runtime State / Env | LOW — exact names are Claude's discretion; planner sets the preset. |

## Open Questions

1. **Which Postgres role does Better Auth's adapter connect as?** (A1)
   - What we know: app pool is RLS-restricted; auth tables `member`/`organization` are RLS-forced; phase 2 gave BA no runtime db on purpose.
   - What's unclear: whether to use the owner pool (recommended) or grant the app role write access to its own auth rows.
   - Recommendation: dedicated owner/elevated pool for the BA adapter; keep app data path on `withTenant`/`withAnon`. Lock in planning; add a verification task that creates an org + accepts an invite and asserts rows landed.

2. **Default active org on first session.** (Pitfall 2)
   - What we know: BA doesn't auto-set `activeOrganizationId`; `setActive` or a session DB hook does.
   - Recommendation: include `org.setActive` in the minimal set; for single-membership users, set a default via session hook or redirect to a picker.

3. **Exact `creatorRole` and `roles` override semantics in better-auth 1.6.18.** (A3)
   - Recommendation: verify against the runtime once; ensure the org creator gets `owner` so `member.invite` (owner-only) works for the creator.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All apps/build | ✓ | 22 via nvm (shell defaults to 20 — use `nvm use 22`) | — |
| pnpm | Install/build | ✓ | 11.6.0 (pinned via packageManager) | — |
| Postgres 16 | Auth tables + RLS reads | ✓ (Compose `:5432`) | 16-alpine | — |
| Redis 7 | BullMQ worker shell | ✓ (Compose host `:6380`→`6379`) | 7 | — |
| Docker daemon | Local image build | ✗ | — | **Image build verified in CI (phase 4)** — author Dockerfiles only; do NOT `docker build` locally (memory + D-16). |
| Resend API | Real invitation email | ✗ (no key in dev) | — | Console-log the invite link when `RESEND_API_KEY` absent (D-09). |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** Docker daemon (→ CI build, phase 4); Resend (→ dev console log).

## Validation Architecture

> `workflow.nyquist_validation: true` in config → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (unit/integration) + Playwright 1.60 (e2e) — both pinned in CLAUDE.md; phase-2 harness runs Vitest against Compose Postgres |
| Config file | Phase-2 established a Vitest setup for `packages/db` cross-tenant tests; `packages/api`/apps configs may be Wave 0 gaps |
| Quick run command | `pnpm --filter @imbau/api test` (unit), `pnpm --filter @imbau/api typecheck` |
| Full suite command | `pnpm test && pnpm lint && pnpm typecheck` (CLAUDE.md gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | signup→login, session persists across refresh | e2e (Playwright) | `pnpm --filter @imbau/panel test:e2e -g "login persists"` | ❌ Wave 0 |
| AUTH-02 | active org sets tenant; role from member.role | integration (Vitest, tRPC caller + Postgres) | `pnpm --filter @imbau/api test -t "withTenant from session"` | ❌ Wave 0 |
| AUTH-03 | owner invites → invitee accepts → member row with role | integration | `pnpm --filter @imbau/api test -t "invite accept creates member"` | ❌ Wave 0 |
| APP-01 | panel reads org-scoped projects via RLS | integration | `pnpm --filter @imbau/api test -t "listForOrg isolates org"` | ❌ Wave 0 |
| APP-02 | web reads only `publicado` via anon | integration | `pnpm --filter @imbau/api test -t "listPublished anon only published"` | ❌ Wave 0 (can extend phase-2 anon test) |
| APP-03 | worker connects BullMQ↔Redis, boots | smoke (Vitest) | `pnpm --filter @imbau/worker test -t "worker connects to redis"` | ❌ Wave 0 |
| APP-04 | Dockerfiles authored & lint-valid (build in CI) | manual-only this phase | `hadolint apps/*/Dockerfile` (optional) — **build verified in CI phase 4** | n/a |

### Sampling Rate
- **Per task commit:** `pnpm --filter <touched-package> typecheck && test`
- **Per wave merge:** `pnpm test && pnpm lint && pnpm typecheck`
- **Phase gate:** full suite green + the auth/tenant integration tests (org-create + invite-accept actually write `member` rows, tenant isolation holds via tRPC caller) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `packages/api/src/trpc/*.test.ts` — tRPC caller integration tests against Compose Postgres (reuse phase-2 owner/fixture harness to seed orgs A/B)
- [ ] `packages/api` Vitest config + test DB wiring (mirror phase-2 `packages/db` setup)
- [ ] `apps/worker/src/*.test.ts` — Redis-connect smoke (needs Compose Redis up)
- [ ] `apps/panel` Playwright config + auth e2e (login persistence, invite accept) — may need port reassignment vs CLINICAL
- [ ] Test fixtures that create a user + org + active session for tRPC `protectedProcedure` tests
- [ ] Decision: integration tests for the auth runtime need the elevated/owner pool path (Pitfall 1) — fixtures must exercise the real adapter pool, not bypass it

## Security Domain

> `security_enforcement: true`, ASVS level 1 → section required.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth email/password (scrypt hashing, min-8 password); no hand-rolled credentials. |
| V3 Session Management | yes | Better Auth DB sessions + `nextCookies()` (secure cookie flags, rotation, expiry handled by the library). |
| V4 Access Control | yes | tRPC `protectedProcedure` + `requireRole` (owner/developer/viewer); RLS at the DB enforces tenant isolation independent of app code; tenant derived server-side from session, never client. |
| V5 Input Validation | yes | Zod 4 at the tRPC boundary on every procedure input (e.g., invite email/role); `set_config` orgId already parameterized (phase 2). |
| V6 Cryptography | yes (delegated) | No custom crypto — Better Auth handles password hashing and session tokens; `BETTER_AUTH_SECRET` from validated env. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data read via forged orgId | Tampering / Info Disclosure | Derive tenant from `session.activeOrganizationId` server-side; RLS `withTenant` enforces at DB (defense in depth). |
| Privilege escalation (non-owner invites/changes roles) | Elevation of Privilege | `requireRole("owner")` on `member.invite`; access-control roles. |
| Session fixation / leak across pooled connection | Spoofing / Info Disclosure | `SET LOCAL`/`set_config(...,true)` transaction-scoped GUC (phase 2) — never bleeds across pooled requests. |
| Auth-adapter running as superuser/BYPASSRLS | Elevation of Privilege | Use the owner pool (NOT superuser/BYPASSRLS) only for auth-table management; app data path stays on unprivileged roles (CLAUDE.md "What NOT to Use"). |
| Invitation link guessing | Spoofing | org-plugin invitation IDs are non-sequential plugin-generated; accept requires an authenticated session (signup/login first — D-10). |
| Secrets in plaintext | Info Disclosure | `BETTER_AUTH_SECRET`/`RESEND_API_KEY` via validated env; SOPS encryption is phase 4 (do not add here, but don't commit real secrets). |
| Input injection at API boundary | Tampering | Zod validation on every tRPC input. |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view <pkg> version`, 2026-06-17) — exact versions: `@trpc/server`/`@trpc/client`/`@trpc/tanstack-react-query` 11.17.0, `@tanstack/react-query` 5.101.0, `resend` 6.14.0, `@react-email/components` 1.0.12, `bullmq` 5.78.1, `ioredis` 5.11.1, `better-auth` 1.6.18.
- `gsd-tools query package-legitimacy check` (2026-06-17) — verdicts/signals for all phase-3 additions.
- Repo inspection — `packages/db/auth.ts` (CLI config), `with-tenant.ts` (`withTenant`/`withAnon`), `client.ts` (`appDb`/`anonDb`/`createOwnerDb`), `auth-schema.ts` (`session.activeOrganizationId`, `member.role`), `member-rls.ts`/`roles.ts` (RLS roles), `presets.ts` (env), worker/panel scaffolds.
- CLAUDE.md "Technology Stack" / "RLS + Auth integration" / "What NOT to Use" / "Architecture-adjacent configuration notes".

### Secondary (MEDIUM confidence)
- better-auth.com/docs/integrations/next — `toNextJsHandler`, catch-all `[...all]/route.ts`, `auth.api.getSession({headers})`, `nextCookies()` must be last.
- better-auth.com/docs/plugins/organization — `sendInvitationEmail(data)` fields, `createAccessControl`/`newRole`, `organizationClient`, `inviteMember`/`acceptInvitation`/`setActive`, `databaseHooks.session.create.before`.
- better-auth.com/docs/authentication/email-password — `emailAndPassword.enabled`, `requireEmailVerification` default false.
- trpc.io/docs/client/tanstack-react-query/server-components — `initTRPC`, `createTRPCOptionsProxy`, `createCaller`, client `createTRPCContext`/`useTRPC`/`queryOptions`, RSC prefetch + HydrationBoundary.

### Tertiary (LOW confidence)
- General training knowledge for BullMQ `maxRetriesPerRequest: null` and Dockerfile prune/standalone mechanics (cross-checked against CLAUDE.md, which documents the prune→build→runner pattern).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified on npm this session and pre-pinned in CLAUDE.md.
- Architecture / API surface: MEDIUM — official docs fetched this session (not 11.17.0/1.6.18-locked snapshots); the auth-adapter-pool decision (A1) is the key unverified design choice and is flagged for the planner.
- Pitfalls: MEDIUM-HIGH — Pitfall 1 (RLS vs auth adapter) is grounded in the phase-2 RLS reality; others are documented stack constraints.

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (stable stack; re-verify better-auth/tRPC API surface if versions move).
