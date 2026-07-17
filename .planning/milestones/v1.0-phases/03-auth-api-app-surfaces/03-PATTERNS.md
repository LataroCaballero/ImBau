# Phase 3: Auth, API & App Surfaces - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 22 new/modified
**Analogs found:** 19 / 22 (3 no close analog → use RESEARCH.md patterns)

> Note on scope: the JIT-package convention (exports point at raw `src/*.ts(x)`, no internal build) and the **env-by-app fail-fast** convention (each app composes only the presets it uses, via `@t3-oss/env-*`, validated at import) are load-bearing for almost every file below. They are not repeated per-file; see **Shared Patterns**.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/config/env/presets.ts` (MODIFY: add `authEnv`) | config | transform | same file (`baseEnv`/`dbEnv`/`redisEnv`) | exact |
| `packages/api/src/auth/runtime.ts` | provider (auth runtime) | request-response | `packages/db/auth.ts` (CLI config) + `packages/db/src/client.ts` (`createOwnerDb`) | role-match |
| `packages/api/src/auth/access-control.ts` | config | transform | `packages/db/src/schema/roles.ts` (role declarations) | role-match |
| `packages/api/src/auth/env.ts` (auth/api env) | config | transform | `apps/worker/src/env.ts` (preset composition) | exact |
| `packages/api/src/trpc/init.ts` | middleware (tRPC init) | request-response | RESEARCH Pattern 3 (no codebase analog) | no-analog |
| `packages/api/src/trpc/context.ts` | middleware | request-response | `packages/db/src/with-tenant.ts` (session→tenant seam) | partial |
| `packages/api/src/trpc/middleware.ts` (`requireRole`) | middleware | request-response | `packages/db/src/schema/member-rls.ts` (member.role read) + RESEARCH Pattern 4 | partial |
| `packages/api/src/trpc/routers/projects.ts` | controller (router) | CRUD (read-only) | `packages/db/src/with-tenant.ts` usage + RESEARCH Pattern 4 | role-match |
| `packages/api/src/trpc/routers/org.ts` | controller (router) | CRUD | RESEARCH Pattern 3/5 (org plugin) | no-analog |
| `packages/api/src/trpc/routers/member.ts` (`invite`) | controller (router) | event-driven (invite→email) | RESEARCH Pattern 5 | no-analog |
| `packages/api/src/trpc/routers/invitation.ts` (`accept`) | controller (router) | CRUD | RESEARCH Pattern 5 | no-analog |
| `packages/api/src/trpc/routers/_app.ts` | controller (router root) | request-response | `packages/db/src/index.ts` (barrel composition) | partial |
| `packages/api/src/email/send-invitation.ts` | service | event-driven (dispatch) | `apps/worker/src/index.ts` (env-gated boot + console fallback) | partial |
| `packages/api/src/email/templates/invitation.tsx` | component (email) | transform | `packages/ui/src/index.tsx` (minimal functional component) | role-match |
| `packages/api/src/index.ts` (MODIFY: real barrel) | barrel | — | `packages/db/src/index.ts` | exact |
| `apps/panel/app/api/auth/[...all]/route.ts` | route handler | request-response | RESEARCH Pattern 1 (`toNextJsHandler`) | no-analog |
| `apps/panel/app/api/trpc/[trpc]/route.ts` | route handler | request-response | RESEARCH Pattern 3 (`fetchRequestHandler`) | no-analog |
| `apps/panel/lib/auth-client.ts` | client provider | request-response | `packages/db/auth.ts` (mirror plugin/AC config client-side) | partial |
| `apps/panel/app/login/page.tsx`, `signup/page.tsx`, `accept-invitation/[id]/page.tsx`, `(dashboard)/page.tsx` | component (page) | request-response | `apps/panel/app/page.tsx` (RSC page, es-AR) | role-match |
| `apps/panel/env.ts` (MODIFY: compose `authEnv`) | config | transform | `apps/panel/env.ts` (self) + `apps/worker/src/env.ts` | exact |
| `apps/web/app/page.tsx` (MODIFY: published list) | component (page) | request-response (anon read) | `apps/web/app/page.tsx` (self) + RESEARCH Pattern 3 caller | exact |
| `apps/worker/src/index.ts` (MODIFY: BullMQ shell) | provider (worker) | event-driven | `apps/worker/src/index.ts` (self, env-first boot) + RESEARCH Pattern 6 | role-match |
| `apps/web/Dockerfile`, `apps/panel/Dockerfile`, `apps/worker/Dockerfile` | config (build) | batch | CLAUDE.md §Architecture + RESEARCH Pattern 7 | no-analog |
| `apps/worker/src/index.test.ts` (Redis smoke) | test | event-driven | `apps/worker/src/env.test.ts` | role-match |

---

## Pattern Assignments

### `packages/config/env/presets.ts` — MODIFY, add `authEnv` (config, transform)

**Analog:** the same file's existing `dbEnv`/`redisEnv` exports (lines 19-29). Add a new const beside them; declare NAMES + Zod schemas only, NEVER values (the file's own rule, comment lines 4-6).

**Pattern to copy** (existing `redisEnv`, lines 27-29):
```typescript
export const redisEnv = {
  server: { REDIS_URL: z.string().url() },
} as const;
```
New `authEnv` follows the identical `{ server: { ... } } as const` shape — per RESEARCH A7 the vars are `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY` (optional in dev — D-09), `INVITE_FROM`. Do NOT add a Sentry preset (phase 4). Keep the "no speculative presets" discipline (comment line 6).

---

### `packages/api/src/auth/runtime.ts` (auth runtime provider, request-response)

**Analog:** `packages/db/auth.ts` (the CLI-only config to evolve) + `packages/db/src/client.ts` `createOwnerDb` (the elevated pool — Pitfall 1 / A1).

**Config to evolve** (`packages/db/auth.ts` lines 16-34) — reuse the SAME `organization({ schema: { organization: { additionalFields: { plan } } } })` block verbatim so the schema never diverges from phase 2:
```typescript
export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "pg" }),
  plugins: [
    organization({
      schema: { organization: { additionalFields: { plan: { type: "string", required: false } } } },
    }),
  ],
});
```

**Elevated-pool wiring** — A1 is the load-bearing decision. The adapter must get an **owner** pool so it can write the RLS-FORCED `organization`/`member` tables. Use `createOwnerDb` from `packages/db/src/client.ts` (lines 28-31):
```typescript
export function createOwnerDb(url: string) {
  const ownerClient = postgres(url);
  return { client: ownerClient, db: drizzle(ownerClient, { schema }) };
}
```
Pass its `.db` to `drizzleAdapter(db, { provider: "pg" })`. Add `emailAndPassword` (D-04: `requireEmailVerification: false`), `baseURL`/`secret` from the validated auth env, the AC roles, `sendInvitationEmail`, and `nextCookies()` **LAST** (Pitfall 3). Full target shape in RESEARCH Pattern 1.

**Env read** — never `process.env`; import the validated auth env (see `packages/api/src/auth/env.ts` below), mirroring how `client.ts` reads `env` not `process.env` (lines 14-19).

---

### `packages/api/src/auth/access-control.ts` (config, transform)

**Analog:** `packages/db/src/schema/roles.ts` (declares `appAuthenticated`/`anon` Postgres roles as named exports) — same idiom of a small file exporting named role objects. Here it's Better Auth's `createAccessControl` instead of `pgRole`.

**Pattern** — from RESEARCH Pattern 2: `createAccessControl(statement)` → export `ac`, `owner`, `developer`, `viewer`. These names map to `member.role` (text column, `auth-schema.ts` line 132, default `"member"` — note the override to owner/developer/viewer, A3). The same `ac`/role exports are imported by both `runtime.ts` (server plugin) and `apps/panel/lib/auth-client.ts` (client mirror).

---

### `packages/api/src/auth/env.ts` (config, transform)

**Analog:** `apps/worker/src/env.ts` (lines 1-27) — the canonical "compose only the presets you use" pattern.

**Pattern to copy** (worker env, lines 14-27):
```typescript
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    DATABASE_URL: dbEnv.server.DATABASE_URL,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```
For the API package compose `baseEnv.server` + new `authEnv.server` + `dbEnv.server.DATABASE_URL` (owner pool for the Better Auth adapter). Honor `SKIP_ENV_VALIDATION` for the Docker build (worker comment lines 11-13). Do NOT override `onValidationError` — default formatter prints NAME not VALUE (V7, comment lines 8-10).

---

### `packages/api/src/trpc/context.ts` (middleware, request-response)

**Analog (the seam):** `packages/db/src/with-tenant.ts` (lines 22-39) — the context's only job is to read the session and hand `session.activeOrganizationId` to `withTenant`.

**The withTenant signature procedures call** (with-tenant.ts lines 22-34):
```typescript
export async function withTenant<T>(orgId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organization_id', ${orgId}, true)`);
    return fn(tx);
  });
}
export async function withAnon<T>(fn: (tx: AnonTx) => Promise<T>): Promise<T> {
  return anonDb.transaction(async (tx) => fn(tx));
}
```
Context builds `{ session, headers }` via `auth.api.getSession({ headers })` (RESEARCH Pattern 3, lines 297-301). `orgId` MUST come from `session.activeOrganizationId` (TEXT, `auth-schema.ts` line 63), never a client value (anti-pattern, RESEARCH line 432). Watch Pitfall 2: `activeOrganizationId` is null right after signup → `protectedProcedure` must reject, and `org.setActive` exists to fix it.

---

### `packages/api/src/trpc/middleware.ts` — `requireRole` (middleware, request-response)

**Analog:** `packages/db/src/schema/member-rls.ts` (lines 27-33) shows how `member.role` is the tenant-scoped role source; `requireRole` reads it through `withTenant` for the active org.

**Role-read inside the active tenant** — the `member_tenant` policy (member-rls.ts lines 27-33) already isolates rows to the active org, so the `requireRole` query inside `withTenant(ctx.activeOrgId, …)` returns only the caller's membership. Shape in RESEARCH Pattern 4 (lines 352-360): select `member.role`, throw `TRPCError({ code: "FORBIDDEN" })` if not allowed. `member.invite` = `requireRole("owner")` (D-12, owner-only).

---

### `packages/api/src/trpc/routers/projects.ts` (router, CRUD read-only)

**Analog:** `packages/db/src/with-tenant.ts` usage + RESEARCH Pattern 4 (lines 339-348). Best in-repo match — it directly consumes the phase-2 seam.

**Pattern** (RESEARCH Pattern 4):
```typescript
import { withTenant, withAnon, schema } from "@imbau/db";
export const projectsRouter = router({
  listForOrg: protectedProcedure.query(({ ctx }) =>
    withTenant(ctx.activeOrgId, (tx) => tx.select().from(schema.projects))),
  listPublished: publicProcedure.query(() =>
    withAnon((tx) => tx.select().from(schema.projects))),
});
```
`@imbau/db` already exports `withTenant`, `withAnon`, `schema` (index.ts lines 5-7). RLS does the filtering — no app-layer `WHERE org_id=` (anti-pattern, RESEARCH line 446).

---

### `packages/api/src/trpc/routers/_app.ts` (router root, request-response)

**Analog:** `packages/db/src/index.ts` (lines 5-7) — same barrel-composition idiom (gather sub-modules into one export). Here: `appRouter = router({ projects, org, member, invitation })` and export the `AppRouter` type + a `createCaller` helper (RESEARCH structure lines 213, 303).

---

### `packages/api/src/email/send-invitation.ts` (service, event-driven)

**Analog:** `apps/worker/src/index.ts` (lines 1-8) — the env-gated boot with a `console.log` JSON line is the same "fall back to console when the external dep is absent" shape D-09 needs.

**Pattern** — RESEARCH Pattern 5 (lines 366-377): if `env.RESEND_API_KEY` absent, `console.info` the accept URL (dev fallback, D-09); else `new Resend(...).emails.send({ react: InvitationEmail({...}) })`. Read the key from the validated auth env (not `process.env`).

---

### `packages/api/src/email/templates/invitation.tsx` (email component, transform)

**Analog:** `packages/ui/src/index.tsx` (lines 5-11) — minimal functional component, typed props, no styling/design-system. The invitation email mirrors that minimalism (D-11: functional, foundation-level, no branded design), es-AR voseo (D-13). Props: `{ acceptUrl, orgName, inviter }` (RESEARCH line 376). Built from `@react-email/components` — gate its first install behind the `checkpoint:human-verify` task (RESEARCH Audit, line 154; deprecation-flag quirk A6).

---

### `packages/api/src/index.ts` — MODIFY (barrel)

**Analog:** `packages/db/src/index.ts` (lines 5-7) verbatim idiom. Replace the placeholder (`apiPackage`, lines 3-5) with real re-exports: `auth`, `appRouter`, `AppRouter` type, `createCaller`. Use `export type` for type-only surface (verbatimModuleSyntax, db index.ts comment line 4).

---

### `apps/panel/lib/auth-client.ts` (client provider, request-response)

**Analog:** `packages/db/auth.ts` — the client must mirror the SAME plugin/AC config (`organizationClient({ ac, roles: { owner, developer, viewer } })`) so client and server agree (RESEARCH Pattern 2 note, line 270; Pattern 5 line 382). Import `ac`/roles from `@imbau/api` `auth/access-control.ts`. `createAuthClient` from `better-auth/react`. No codebase auth-client analog exists yet — this is the canonical one.

---

### Panel pages — `login`, `signup`, `accept-invitation/[id]`, `(dashboard)` (page components, request-response)

**Analog:** `apps/panel/app/page.tsx` (lines 1-17) — RSC page, es-AR voseo, reads validated `env`, consumes a shared `@imbau/*` package.

**Pattern to copy** (panel page, lines 6-17): default-exported RSC returning a flat `<main>` with es-AR copy and `React.JSX.Element` return type. Dashboard does an RSC read via the tRPC server caller (`createCaller({ headers: await headers() }).projects.listForOrg()` — RESEARCH Pattern 3 lines 316-320). Forms (`login`/`signup`, invite) are `"use client"` islands calling `authClient.signIn.email` / `authClient.organization.inviteMember` / `acceptInvitation` (RESEARCH Patterns 3/5). UI minimal, no design system (D-13).

---

### `apps/web/app/page.tsx` — MODIFY (page component, anon read)

**Analog:** itself (lines 1-19) — keep the RSC + es-AR + validated-`env` shape; swap the static status body for a published-projects list.

**Pattern:** RSC server caller → `createCaller({...}).projects.listPublished()` → `withAnon` → only `estado='publicado'` rows (D-14, RESEARCH Pattern 3 lines 316-320). NO auth handler, NO tRPC client (web is anon-only, D-03). Render name/slug/estado.

---

### `apps/worker/src/index.ts` — MODIFY (worker provider, event-driven)

**Analog:** itself (lines 1-8) — keep the **env-FIRST import** so validation runs at boot, then add BullMQ.

**Pattern to preserve** (current, lines 4-8): `import { env } from "./env"` first, structured JSON log on boot. **Add** (RESEARCH Pattern 6, lines 391-398): `new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })` (the `null` is REQUIRED by BullMQ), a `Queue`/`Worker` on `"health"`, no job logic (D-16/APP-03). `REDIS_URL` already validated in `apps/worker/src/env.ts` (line via `redisEnv`).

---

### `apps/worker/src/index.test.ts` (test, event-driven)

**Analog:** `apps/worker/src/env.test.ts` (lines 1-62) — Vitest `describe/it/expect`, composes presets directly. The new test asserts the BullMQ Worker connects to the Compose Redis (`:6380`→`6379`) and boots (RESEARCH Wave-0 gap, line 579). Needs Compose Redis up.

---

### `apps/web/Dockerfile`, `apps/panel/Dockerfile`, `apps/worker/Dockerfile` (build config, batch)

**Analog:** none in repo — CLAUDE.md §"Architecture-adjacent configuration notes" + RESEARCH Pattern 7 (lines 404-429) are the source.

**Pattern:** 3 stages — `pruner` (`pnpm dlx turbo prune <pkg> --docker`), `builder` (`pnpm install --frozen-lockfile` on `out/json/`, then `out/full/`, then `pnpm turbo build --filter`), `runner` (Node 22 Alpine). Web/panel copy `.next/standalone` + `.next/static` + `public` (RESEARCH lines 421-427); `output: 'standalone'` is already set (`apps/panel/next.config.ts` line 15). Worker copies tsup `dist/` and runs `node dist/index.js` (tsup config bundles `@imbau/*` via `noExternal`, tsup.config.ts line 13). NEVER `pnpm install --prod` inside standalone (Pitfall 5). Authored only — built/verified in CI phase 4 (no local Docker daemon).

---

## Shared Patterns

### Env validation (fail-fast, by app, NAME-not-VALUE)
**Source:** `apps/worker/src/env.ts` (lines 14-27), `packages/db/src/env.ts` (lines 15-22).
**Apply to:** `packages/api/src/auth/env.ts`, modified `apps/panel/env.ts`, the new `authEnv` preset.
```typescript
export const env = createEnv({
  server: { ...baseEnv.server, ...somePreset.server, DATABASE_URL: dbEnv.server.DATABASE_URL },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```
Compose ONLY the presets the unit uses. Never override `onValidationError` (default prints the variable NAME + reason, never the offending VALUE — security V7). `@t3-oss/env-nextjs` for the Next apps (client + server split, `apps/panel/env.ts` lines 1-18), `@t3-oss/env-core` for packages/worker. Honor `SKIP_ENV_VALIDATION` only for the Docker image build.

### Tenant / anon data seam
**Source:** `packages/db/src/with-tenant.ts` (lines 22-39); re-exported from `packages/db/src/index.ts` (lines 5-7).
**Apply to:** every tRPC router + the panel dashboard read + the web published read.
- Protected reads/writes → `withTenant(ctx.activeOrgId, (tx) => …)`; `orgId` always from `session.activeOrganizationId`, never client.
- Anonymous reads → `withAnon((tx) => …)`; RLS filters `estado='publicado'`.
- Never re-implement isolation in app code (no `WHERE org_id=`); RLS is the boundary.

### Better Auth adapter pool (THE load-bearing decision — A1 / Pitfall 1)
**Source:** `packages/db/src/client.ts` `createOwnerDb` (lines 28-31); contrast with `appDb`/`anonDb` (lines 16-22).
**Apply to:** `packages/api/src/auth/runtime.ts` ONLY.
Give Better Auth's Drizzle adapter the **owner/elevated** pool (`createOwnerDb(env.DATABASE_URL)`) so it can write the RLS-FORCED `organization`/`member` tables; keep ALL application reads/writes on `withTenant`/`withAnon` (unprivileged pools). The owner pool is used ONLY for auth-table bookkeeping — never as a BYPASSRLS shortcut for tenant data (CLAUDE.md "What NOT to Use"). Verifier must prove org-create + invite-accept actually write rows.

### JIT package consumption
**Source:** `apps/panel/next.config.ts` `transpilePackages` (line 13); `apps/worker/tsup.config.ts` `noExternal` (line 13).
**Apply to:** panel/web consuming `@imbau/api` (add to `transpilePackages`), worker bundling.
Internal packages export raw `src/*.ts(x)` (no internal build); the consuming app transpiles them. `@imbau/api` must be added to each Next app's `transpilePackages`.

### Better Auth schema fold (do NOT diverge)
**Source:** `packages/db/src/schema/auth-schema.ts` (header lines 1-24, tables 35-161).
**Apply to:** `runtime.ts` plugin config + `auth-client.ts`.
The runtime reuses the exact `additionalFields.plan` config from `packages/db/auth.ts`; org IDs are TEXT (line 111), `member.role` is text default `"member"` (line 132 — overridden to owner/developer/viewer in AC, A3), `session.activeOrganizationId` (line 63) is the tenant key. If the runtime needs a missing column → `drizzle-kit generate` + `migrate`, never hand-edit (Pitfall 7).

---

## No Analog Found

Files with no close in-repo match — planner should use the cited RESEARCH/CLAUDE.md patterns directly:

| File | Role | Data Flow | Reason / Source |
|------|------|-----------|-----------------|
| `packages/api/src/trpc/init.ts` | tRPC init | request-response | First tRPC in repo. Use RESEARCH Pattern 3 (lines 293-311): `initTRPC.context<…>().create()`, `cache`d context, `publicProcedure`/`protectedProcedure`/`createCallerFactory`. |
| `apps/panel/app/api/auth/[...all]/route.ts` | route handler | request-response | First Next route handler. Use `toNextJsHandler(auth)` → `{ GET, POST }` (RESEARCH Pattern 1, structure line 217). Panel only (D-03). |
| `apps/panel/app/api/trpc/[trpc]/route.ts` | route handler | request-response | First tRPC handler. Use `fetchRequestHandler({ endpoint, req, router: appRouter, createContext })` (RESEARCH Pattern 3, line 334). |
| `apps/*/Dockerfile` (×3) | build config | batch | No Dockerfiles exist yet. Use CLAUDE.md §Architecture + RESEARCH Pattern 7 (prune→build→standalone-runner). |
| `org.ts` / `member.ts` / `invitation.ts` routers | router | CRUD / event-driven | Org-plugin-driven (`setActive`/`inviteMember`/`acceptInvitation`); no in-repo analog. Use RESEARCH Patterns 3/5. `projects.ts` is the structural sibling to copy router scaffolding from. |

---

## Metadata

**Analog search scope:** `packages/db/src/**`, `packages/api/**`, `packages/config/**`, `packages/ui/src/**`, `apps/web/**`, `apps/panel/**`, `apps/worker/**` (excluding `node_modules`, `.next`, `dist`).
**Files scanned:** ~30 source files read; richest analog source is `packages/db` (client/with-tenant/auth-schema/member-rls) per the context hint.
**Pattern extraction date:** 2026-06-17
