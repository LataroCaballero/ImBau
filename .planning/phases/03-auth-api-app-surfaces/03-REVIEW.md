---
phase: 03-auth-api-app-surfaces
reviewed: 2026-06-18T20:44:16Z
depth: deep
files_reviewed: 40
files_reviewed_list:
  - packages/api/src/auth/runtime.ts
  - packages/api/src/auth/access-control.ts
  - packages/api/src/auth/env.ts
  - packages/api/src/trpc/init.ts
  - packages/api/src/trpc/context.ts
  - packages/api/src/trpc/middleware.ts
  - packages/api/src/trpc/routers/_app.ts
  - packages/api/src/trpc/routers/projects.ts
  - packages/api/src/trpc/routers/org.ts
  - packages/api/src/trpc/routers/member.ts
  - packages/api/src/trpc/routers/invitation.ts
  - packages/api/src/email/send-invitation.ts
  - packages/api/src/email/templates/invitation.tsx
  - packages/api/src/index.ts
  - packages/api/tests/auth-runtime.test.ts
  - packages/api/tests/db.ts
  - packages/api/tests/fixtures.ts
  - packages/api/tests/send-invitation.test.ts
  - packages/api/tests/setup.ts
  - packages/api/tests/trpc-tenant.test.ts
  - packages/api/vitest.config.ts
  - packages/config/env/presets.ts
  - apps/panel/app/api/auth/[...all]/route.ts
  - apps/panel/app/api/trpc/[trpc]/route.ts
  - apps/panel/app/(dashboard)/page.tsx
  - apps/panel/app/(dashboard)/invite-form.tsx
  - apps/panel/app/login/page.tsx
  - apps/panel/app/signup/page.tsx
  - apps/panel/app/accept-invitation/[id]/page.tsx
  - apps/panel/lib/auth-client.ts
  - apps/panel/lib/trpc-client.tsx
  - apps/panel/env.ts
  - apps/panel/next.config.ts
  - apps/panel/playwright.config.ts
  - apps/panel/e2e/auth-flow.spec.ts
  - apps/web/app/page.tsx
  - apps/web/env.ts
  - apps/worker/src/index.ts
  - apps/worker/src/index.test.ts
  - apps/panel/Dockerfile
  - apps/web/Dockerfile
  - apps/worker/Dockerfile
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 3: Auth, API & App Surfaces — Code Review Report

**Reviewed:** 2026-06-18T20:44:16Z
**Depth:** deep (cross-file, call-chain tracing, A1 owner-pool verification)
**Files Reviewed:** 40
**Status:** issues_found — 0 blockers, 4 warnings, 3 info items

---

## Summary

This phase implements the Better Auth runtime, the tRPC API layer, and the app surfaces for a multi-tenant SaaS. The review covered all Phase 3 source files at deep depth, tracing call chains across module boundaries and verifying the load-bearing security properties.

**The critical architecture decisions hold:**

- A1 (owner-pool isolation) is correctly implemented: `createOwnerDb` is imported only in `packages/api/src/auth/runtime.ts` and is absent from every tRPC router (grep-verified). Application data reads flow exclusively through `withTenant`/`withAnon`.
- Tenant derivation is server-side only: `protectedProcedure` extracts `activeOrgId` solely from `session.session.activeOrganizationId`; no router accepts a client-supplied orgId for tenant scoping.
- `requireRole` reads `member.role` inside `withTenant` (defense-in-depth: the `member_tenant` RLS policy restricts the lookup to the active org).
- `nextCookies()` is last in the plugins array.
- No auth handler in `apps/web` (anon-only by design).
- No TS `any` in source files. Zod-4 validation at every tRPC input boundary.

No findings are BLOCKER severity. The four warnings are real defects that should be fixed before Phase 4 makes the worker a real service and CI exercises the Dockerfiles.

---

## Warnings

### WR-01: Worker validates and requires `DATABASE_URL` but never uses Postgres

**File:** `apps/worker/src/env.ts:23`
**Issue:** The worker's `env.ts` includes `DATABASE_URL: dbEnv.server.DATABASE_URL` in its validated server config. The worker process only connects to Redis (BullMQ/ioredis) and has zero Postgres connections — it never calls `appDb`, `anonDb`, `withTenant`, or anything from `@imbau/db`. The effect: the containerized worker will refuse to boot unless `DATABASE_URL` is present in its environment, even though that credential is unused. This will cause false startup failures in any deployment context that correctly separates the worker's secrets from the DB owner credentials.

**Fix:** Remove `DATABASE_URL` from the worker's validated env. The worker only needs `NODE_ENV` and `REDIS_URL`:
```typescript
// apps/worker/src/env.ts
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    // DATABASE_URL removed — the worker has no Postgres connections (APP-03 shell)
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```

---

### WR-02: `org.setActive` tRPC procedure is unreachable for its intended edge-case audience

**File:** `packages/api/src/trpc/routers/org.ts:27`
**Issue:** `org.setActive` is built on `protectedProcedure`, which throws `UNAUTHORIZED` when `session.activeOrganizationId` is null. But the stated purpose of `org.setActive` is to handle the "user has memberships but no active org" edge case (Pitfall 2 of the research doc). A user in that state cannot reach `protectedProcedure` at all — they're UNAUTHORIZED before the input is ever read. The current UI flows (signup, accept-invitation) bypass this by calling `authClient.organization.setActive` directly (the Better Auth HTTP endpoint), so no live breakage exists today. However, `org.setActive` is exported in the public AppRouter type and is the natural tRPC path a future caller would reach for (e.g., an org-picker component). If someone builds against it expecting it to solve the null-active-org case, it will silently redirect the user to `/login` instead.

**Fix:** Replace `protectedProcedure` with a session-only gate (same pattern as `invitation.accept`'s `sessionProcedure`), which requires an authenticated user but not an active org:
```typescript
// packages/api/src/trpc/routers/org.ts — define locally or import from init
const sessionProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

setActive: sessionProcedure
  .input(z.object({ organizationId: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const rows = await withTenant(input.organizationId, (tx) =>
      tx.select({ id: schema.member.id }).from(schema.member)
        .where(and(
          eq(schema.member.userId, userId),
          eq(schema.member.organizationId, input.organizationId),
        )),
    );
    if (rows.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return auth.api.setActiveOrganization({
      body: { organizationId: input.organizationId },
      headers: ctx.headers,
    });
  }),
```

---

### WR-03: Dashboard RSC catches all errors and redirects to `/login`, masking real failures

**File:** `apps/panel/app/(dashboard)/page.tsx:30`
**Issue:** The bare `catch {}` block catches every exception thrown by `caller.projects.listForOrg()` — including network errors, DB connection failures, Drizzle panics, and any non-UNAUTHORIZED TRPCError — and unconditionally redirects to `/login`. A DB outage presents to users as "you're logged out," making the failure invisible and misleading. More problematically, it makes diagnosing production incidents significantly harder: Sentry (arriving in Phase 4) will not record the original error because the exception is swallowed here.

**Fix:** Narrow the catch to UNAUTHORIZED only, and re-throw anything else:
```typescript
import { TRPCClientError } from "@trpc/client";

let projects: ProjectRow[];
try {
  projects = await caller.projects.listForOrg();
} catch (err) {
  // Only swallow UNAUTHORIZED — a missing session or missing active org means
  // the user must log in. Any other error (DB down, FORBIDDEN, etc.) should
  // surface, not masquerade as a logout.
  if (
    err instanceof TRPCClientError &&
    (err.data?.code === "UNAUTHORIZED" || err.data?.code === "FORBIDDEN")
  ) {
    redirect("/login");
  }
  throw err; // Let Next.js error boundary / Sentry (Phase 4) handle real failures
}
```

---

### WR-04: Dockerfiles run the production container as root

**File:** `apps/panel/Dockerfile:32`, `apps/web/Dockerfile:32`, `apps/worker/Dockerfile:33`
**Issue:** The runner stage in all three Dockerfiles has no `USER` directive, so the Node.js process runs as root inside the container. If a dependency vulnerability allows code execution, the attacker has root access within the container. This is a standard container hardening gap; Next.js standalone and tsup/Node both work correctly under a non-root user.

**Fix:** Add a non-root user in the runner stage of each Dockerfile. Panel/web example (same pattern for worker):
```dockerfile
# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Drop privileges: run the server as a non-root user.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/panel/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/panel/public ./apps/panel/public
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
```

---

## Info

### IN-01: `Math.random()` used for org slug suffix in signup page

**File:** `apps/panel/app/signup/page.tsx:25`
**Issue:** The slug uniqueness suffix is generated with `Math.random()`. This is not cryptographically random, but since org slugs are not security tokens (they are organization identifiers, not access credentials), there is no direct security impact. However, `Math.random()` has a small (but non-zero) birthday-collision probability in high-volume environments. Better Auth enforces slug uniqueness at the DB level, so a collision would produce an error the user sees, not a silent overwrite.

**Fix:** Use `crypto.randomUUID().slice(0, 8)` (available natively in Node 22 and modern browsers) for a properly random suffix:
```typescript
const suffix = crypto.randomUUID().slice(0, 8);
```

---

### IN-02: Integration tests accumulate data in the `_test` DB with no cleanup

**File:** `packages/api/tests/auth-runtime.test.ts`, `packages/api/tests/trpc-tenant.test.ts`
**Issue:** The test fixtures create `user`, `organization`, `member`, `invitation`, and `projects` rows on every test run but never delete them. The `_test` DB guard prevents contaminating dev/prod, but accumulation will eventually cause the `_test` DB to grow significantly and could cause false positives in future tests that count or enumerate rows globally. The `afterAll` hooks only close the DB connection — they do not truncate.

**Fix:** Add a truncation in `tests/setup.ts` (global setup, runs once before all suites) to clear the auth + projects tables before the suite starts:
```typescript
// tests/setup.ts — add after the table-presence check
await sqlc`
  truncate table "user", session, account, organization, member, invitation, projects
  restart identity cascade
`;
```
This is safe because the setup already confirmed these tables exist and the `_test` guard fires before the URL is handed out.

---

### IN-03: Hardcoded fallback e2e secret in Playwright config

**File:** `apps/panel/playwright.config.ts:52`
**Issue:** The config falls back to a hardcoded literal string `"e2e-secret-please-change-32chars-minimum-xx"` when `BETTER_AUTH_SECRET` is not set. This is a test file, not production code, but the literal secret is checked into the repository. If the same secret is accidentally used in a staging environment (e.g., CI sets `BETTER_AUTH_SECRET` only for prod but not for the e2e job), sessions signed with this known string would be forgeable.

**Fix:** Fail loudly instead of silently using a known-weak secret:
```typescript
BETTER_AUTH_SECRET: (() => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error(
    "BETTER_AUTH_SECRET must be set for e2e tests — add it to your CI secrets or .env.local"
  );
  return secret;
})(),
```
Alternatively, keep the fallback but append a comment making the CI requirement explicit, and add a CI check that the variable is set.

---

_Reviewed: 2026-06-18T20:44:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
