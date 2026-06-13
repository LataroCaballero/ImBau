# Architecture Research

**Domain:** Multi-tenant SaaS foundation (phase 0) — pnpm/Turborepo monorepo, Next.js App Router + tRPC, Postgres 16 + Drizzle with RLS, Better Auth, BullMQ/Redis, Docker Compose + Traefik on a VPS
**Researched:** 2026-06-12
**Confidence:** HIGH on monorepo/tRPC/Drizzle/Better-Auth wiring and the RLS-in-a-transaction pattern (verified against current docs and known Postgres semantics); MEDIUM on exact Docker Compose service tuning and CI cache details (depends on VPS specifics not yet pinned).

> Scope note: the stack is **already decided** (CLAUDE.md §Stack). This document is not an ecosystem survey — it answers *how these phase-0 pieces are typically wired together, where the boundaries sit, how the tenant context reaches RLS, and in what order to build them*. It deliberately omits product features (explorer, quoting, panel CRUD) — those are later milestones.

---

## Standard Architecture

### System Overview — monorepo package graph (build/dependency direction)

```
┌──────────────────────────── apps (deployables) ────────────────────────────┐
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐              │
│  │  apps/web    │      │  apps/panel  │      │ apps/worker  │              │
│  │ (public,RSC/ │      │ (Next.js,    │      │ (Node proc,  │              │
│  │  ISR, anon)  │      │  authed)     │      │  BullMQ)     │              │
│  └──────┬───────┘      └──────┬───────┘      └──────┬───────┘              │
│         │                     │                     │                       │
│         │ imports             │ imports             │ imports               │
└─────────┼─────────────────────┼─────────────────────┼───────────────────────┘
          ▼                     ▼                     ▼
┌──────────────────────────── packages (libraries) ──────────────────────────┐
│   ┌───────────────────────────────────────────────────────────────────┐   │
│   │ packages/api   (tRPC routers + context + RLS middleware + auth glue)│   │
│   └───────┬───────────────────────────┬───────────────────────┬────────┘   │
│           │ imports                    │ imports               │ imports     │
│           ▼                            ▼                       ▼             │
│   ┌──────────────┐            ┌──────────────┐        ┌──────────────┐      │
│   │ packages/db  │            │packages/quot.│        │ packages/ui  │      │
│   │ (Drizzle     │            │ (pure quote  │        │ (shadcn kit, │      │
│   │  schema +    │            │  engine —    │        │  panel/web)  │      │
│   │  client +    │            │  no I/O)     │        └──────────────┘      │
│   │  RLS helpers)│            └──────────────┘                              │
│   └──────┬───────┘                                                          │
│          │ imports                                                          │
│          ▼                                                                  │
│   ┌──────────────┐                                                          │
│   │packages/config│ (tsconfig base, eslint, env schema/Zod, shared const)  │
│   └──────────────┘                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
          │ (all DB access)                          │ (cross-cutting)
          ▼                                          ▼
┌──────────────────────────── runtime infra (Docker Compose) ────────────────┐
│  Traefik ─► web/panel/worker     Postgres 16 (RLS)     Redis (BullMQ)       │
│  Better Auth tables ◄── same Postgres        Loki/Grafana   Uptime Kuma     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The golden rule of the graph: dependencies point downward, never up or sideways between apps.** Apps import packages; packages never import apps; `packages/api` is the only package that touches `db`, `quoting`, and auth together; `quoting` and `ui` import nothing but `config`. No app imports another app. This is what makes Turborepo caching and independent deploys work, and it is the single most common thing to get wrong on day one.

### Component Responsibilities

| Component | Responsibility (owns) | Typical implementation | Phase-0 scope |
|-----------|----------------------|------------------------|---------------|
| `packages/config` | Shared tsconfig, eslint/prettier, **env validation (Zod `t3-env` style)**, shared constants (roles, project states) | Plain TS exports + `tsconfig.base.json`; `env.ts` parses `process.env` and throws at boot | Full |
| `packages/db` | Drizzle schema, migrations, the **two connection roles** (`app`/`anon`), the `withTenant()` transaction helper that issues `set_config` | Drizzle + `postgres-js`/`node-postgres`; SQL migration files committed; RLS policies defined as SQL | Auth tables + org/membership/project skeleton + RLS scaffolding |
| `packages/quoting` | Pure deterministic quote math — no I/O, no DB | Pure functions; 100% coverage, property-based tests | **Skeleton only** (package exists, real engine is phase 3) |
| `packages/ui` | Shared shadcn/ui components, theme tokens | shadcn/ui + Tailwind, consumed by web & panel | Skeleton |
| `packages/api` | tRPC routers, **request context builder**, RLS middleware, Better-Auth-session→tenant glue, Zod input validation | `@trpc/server` routers; `createContext` reads Better Auth session, resolves active org, opens tenant transaction | `appRouter` skeleton + `auth`/`org` routers + protected/public procedures |
| `apps/web` | Public showroom; RSC + ISR; reads only `publicado` projects via **anon role** | Next.js App Router; tRPC server-side caller for RSC, no auth session | "Hello tenant" page proving anon RLS read works |
| `apps/panel` | Authenticated self-service panel | Next.js App Router; Better Auth client + tRPC React Query | Login + org switch + a single RLS-protected query |
| `apps/worker` | Background jobs (images, PDFs, emails, alerts) | Long-running Node process; BullMQ consumers; imports `db`/`api` service layer | Skeleton consumer + healthcheck + one no-op job |
| Postgres 16 | System of record + tenant isolation (RLS) + LISTEN/NOTIFY | Single instance, two app roles | Full (this *is* the foundation) |
| Redis | BullMQ queue backing store | Single instance | Full |
| Traefik | TLS termination, routing by host, edge rate-limit middleware | Docker labels per service; Let's Encrypt | staging host routing + TLS |
| Better Auth | Sessions, organizations, memberships, roles, email invites | Better Auth + `organization` plugin + Drizzle adapter, **same Postgres** | Full |

---

## Recommended Project Structure

```
imbau/
├── apps/
│   ├── web/                    # public showroom (anon role, RSC/ISR)
│   │   ├── src/app/            # App Router; (public) routes only
│   │   ├── src/trpc/           # server-side tRPC caller (no client session)
│   │   └── Dockerfile
│   ├── panel/                  # authenticated panel
│   │   ├── src/app/            # App Router; auth-gated layout
│   │   ├── src/lib/auth-client.ts   # Better Auth React client
│   │   ├── src/trpc/           # tRPC React Query provider + client
│   │   └── Dockerfile
│   └── worker/                 # BullMQ consumers
│       ├── src/queues/         # one file per queue
│       ├── src/index.ts        # process bootstrap + graceful shutdown
│       └── Dockerfile
├── packages/
│   ├── config/                 # tsconfig.base, eslint, env.ts (Zod), constants
│   ├── db/
│   │   ├── src/schema/         # auth.ts, organizations.ts, projects.ts, ...
│   │   ├── src/rls/            # policies.sql helpers + withTenant()/withAnon()
│   │   ├── src/client.ts       # pool(s) + role connections
│   │   ├── drizzle.config.ts
│   │   └── migrations/         # *.sql, committed, never edited after apply
│   ├── api/
│   │   ├── src/trpc.ts         # initTRPC, procedure builders, middlewares
│   │   ├── src/context.ts      # createContext: session → org → tenant tx
│   │   ├── src/root.ts         # appRouter (merges sub-routers)
│   │   ├── src/routers/        # auth.ts, organization.ts, project.ts ...
│   │   └── src/auth.ts         # Better Auth server instance (shared)
│   ├── quoting/                # pure engine (skeleton in phase 0)
│   └── ui/                     # shadcn components + theme
├── infra/
│   ├── docker-compose.yml      # full local + staging topology
│   ├── docker-compose.staging.yml  # overrides (Traefik labels, volumes)
│   └── traefik/                # dynamic config, middlewares (rate-limit)
├── .github/workflows/ci.yml    # lint+typecheck+test → build → deploy staging
├── turbo.json                  # task graph + cache config
├── pnpm-workspace.yaml
└── package.json
```

### Structure Rationale

- **`packages/api` is the seam, not the apps.** Both Next.js apps and the worker import the *same* `appRouter` type and the *same* service functions. The router lives in a package so the web app gets server-side type-safe calls in RSC, the panel gets a typed client, and the worker can call business logic directly without HTTP. Putting tRPC inside one app and re-importing across apps breaks Turborepo boundaries.
- **`db` owns RLS, not `api`.** The connection roles, the `withTenant()` transaction helper, and the policy SQL live next to the schema they protect. `api` *uses* `withTenant()` but never constructs raw connections. This keeps "how isolation works" in one auditable place.
- **`config/env.ts` is imported by everything that boots.** A single Zod-validated env object that throws on missing vars at startup prevents the classic "deployed to staging, crashes on first request because `DATABASE_URL` was a typo."
- **`apps/web` has no auth client at all.** It only ever uses the anon connection. Physically separating the public surface (no session cookies, no panel mutations) shrinks the attack surface and lets ISR cache aggressively.
- **`infra/` is versioned in the repo.** Compose + Traefik config are reviewed like code; staging and prod differ only by an override file and secrets.

---

## Architectural Patterns

### Pattern 1: Tenant context via transaction-scoped `set_config` (the keystone)

**What:** Every authenticated request runs its DB work inside a **single transaction**, and the first statement of that transaction sets the tenant id (and role) using `set_config('app.org_id', $1, true)` — the `true` makes it `SET LOCAL`, scoped to the transaction. RLS policies read `current_setting('app.org_id')`. When the transaction commits/rolls back, the setting evaporates, so the pooled connection is clean for the next request.

**When to use:** Always, for every tenant-scoped read or write. There is no "set it once on connect" shortcut that is safe with pooling.

**Trade-offs:** Every request pays for a transaction (cheap) and you must remember that a query *outside* `withTenant()` sees nothing (or errors) — which is the desired fail-closed behavior. Cannot use a statement-pooling pooler (PgBouncer statement mode) — see anti-patterns.

**Example:**
```typescript
// packages/db/src/rls/with-tenant.ts
export async function withTenant<T>(
  orgId: string,
  role: "app_user",
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL: scoped to THIS transaction only — pool-safe.
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`set local role ${sql.raw(role)}`);
    return fn(tx); // all queries here are RLS-filtered to orgId
  });
}

// A policy that uses it (in policies.sql):
//   create policy org_isolation on projects using
//     (organization_id = current_setting('app.org_id')::uuid);
```

### Pattern 2: tRPC context = (Better Auth session → active org → tenant tx factory)

**What:** `createContext` validates the Better Auth session, reads `session.activeOrganizationId`, verifies the user's membership/role, and exposes a `db` bound to that org via `withTenant`. A `protectedProcedure` middleware throws `UNAUTHORIZED` if no session and `FORBIDDEN` if the user isn't a member of the requested org. The public app uses a separate `publicProcedure` wired to the **anon role** path that only sees `publicado` projects.

**When to use:** The standard request pipeline for both apps. The web app uses public procedures; the panel uses protected ones.

**Trade-offs:** The active-org indirection (org switcher updates `activeOrganizationId` on the session) is the right model but means org membership must be re-checked server-side on every call — never trust the client's claimed org.

**Example:**
```typescript
// packages/api/src/context.ts
export async function createContext({ headers }: { headers: Headers }) {
  const session = await auth.api.getSession({ headers });
  return { session, db };
}

// packages/api/src/trpc.ts
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const orgId = ctx.session?.session.activeOrganizationId;
  if (!ctx.session || !orgId) throw new TRPCError({ code: "UNAUTHORIZED" });
  // membership re-check happens inside withTenant via RLS + an explicit guard
  return next({
    ctx: { ...ctx, orgId, runTenant: <T>(fn: (tx: Tx) => Promise<T>) =>
      withTenant(orgId, "app_user", fn) },
  });
});
```

### Pattern 3: Two Postgres roles, one database, fail-closed by default

**What:** Create a privileged migration/owner role (used only by Drizzle migrations and the worker's trusted paths), an `app_user` role for authenticated requests (RLS-enforced, scoped by `app.org_id`), and an `anon` role for the public web (RLS limited to `projects.estado = 'publicado'`). The app connects as a login role that `SET ROLE`s into `app_user`/`anon` per transaction. Tables have `enable row level security` **and `force row level security`** so even the table owner is constrained.

**When to use:** From the first migration. Retrofitting RLS after tables exist is a known rewrite trap.

**Trade-offs:** Slightly more setup; you must remember to add a policy whenever you add a tenant table (enforce via a test that asserts every tenant table has RLS enabled).

### Pattern 4: Worker calls the service layer directly, not over HTTP

**What:** The worker imports the same business functions `packages/api` exposes (or a thin `services` layer beneath the routers) and runs them with an explicit org context (jobs carry `orgId` in their payload, fed into `withTenant`). It does not call the Next.js apps over HTTP.

**When to use:** All background work. Realtime fan-out (later) is the worker/DB emitting `NOTIFY`; SSE endpoints in the web app `LISTEN`.

**Trade-offs:** Requires keeping a clean service layer that doesn't assume an HTTP request object — good discipline anyway. In phase 0 this is just a no-op job proving the wiring + graceful shutdown.

---

## Data Flow

### Request flow — authenticated panel mutation (the canonical path)

```
[Panel UI action]
   ↓  tRPC client (React Query) + Better Auth session cookie
[Traefik] → [apps/panel Next.js route handler]
   ↓  createContext: auth.getSession() → activeOrganizationId
[protectedProcedure middleware]  → verify session + org membership
   ↓  runTenant(orgId, tx => ...)
[BEGIN tx; set_config('app.org_id', orgId, true); set local role app_user]
   ↓  Drizzle query
[Postgres RLS] filters rows to orgId  →  rows
   ↓  COMMIT (tenant context auto-discarded)
[typed result] → tRPC → React Query cache → UI
```

### Request flow — public read (anon)

```
[Visitor opens proyecto.com] → [Traefik] → [apps/web RSC]
   ↓  server-side tRPC caller, publicProcedure (NO session)
[BEGIN tx; set local role anon]
   ↓  Drizzle query
[Postgres RLS] → only projects.estado = 'publicado' visible → rows
   ↓  COMMIT  →  RSC renders, ISR caches
```

### Tenant-context flow (the thing to get exactly right)

```
Better Auth session
   └─ session.activeOrganizationId   (set on login / org switch)
        └─ tRPC protectedProcedure re-validates membership
             └─ withTenant(orgId): SET LOCAL app.org_id INSIDE a tx
                  └─ Postgres current_setting('app.org_id') in RLS policy
                       └─ rows physically filtered by the database
```

The isolation guarantee lives in **Postgres**, not in application `where` clauses. Application code can forget a filter; RLS can't. That is the whole point of choosing RLS over app-level scoping for this product.

### Key data flows (phase 0)

1. **Login + org bootstrap:** user authenticates (Better Auth) → if no active org, a `databaseHook` `before` session creation sets `activeOrganizationId` to their first membership → subsequent requests carry it.
2. **Invite:** owner invites email → Better Auth `organization` plugin creates an invitation row → Resend (via worker) sends the email → invitee accepts → membership row created with role.
3. **Migration/deploy:** CI builds images → on merge to main, deploy step runs `pnpm db:migrate` (privileged role) against staging Postgres *before* swapping app containers.

---

## Suggested Build Order (phase-0 components, by dependency)

Derived strictly from the package graph above — build leaves first, then the seam, then the deployables, then the operational shell.

1. **Repo skeleton + `packages/config`** — pnpm workspaces, `turbo.json`, base tsconfig/eslint, **Zod env schema**. Nothing compiles meaningfully without this. (Unblocks everything.)
2. **`docker compose up` for Postgres + Redis** — you need a real DB locally before schema work. Keep it minimal here (data services only); add Traefik/observability later.
3. **`packages/db`: Drizzle + Better Auth tables + org/membership/project skeleton + the two roles + `withTenant`/`withAnon` + first RLS policies.** This is the riskiest, highest-value unit — do it early while attention is fresh. Ship with a test asserting RLS isolation (org A cannot see org B).
4. **Better Auth server instance (`packages/api/src/auth.ts`) wired to the Drizzle adapter + organization plugin.** Depends on db (auth tables). Verify sessions + org switch + invite create.
5. **`packages/api`: tRPC init, context (session→org→tx), protected/public procedures, a trivial `organization`/`project` router.** Depends on db + auth.
6. **`apps/panel`: login, org switcher, one protected query that proves RLS end-to-end through the UI.** Depends on api.
7. **`apps/web`: one public page that reads a `publicado` project via the anon path** — proves the public/anon isolation boundary. Depends on api/db.
8. **`apps/worker`: BullMQ consumer skeleton, graceful shutdown, one no-op job + healthcheck.** Depends on db (+ redis already up).
9. **Full Docker Compose topology + Traefik** (web/panel/worker/traefik labels, TLS, edge rate-limit middleware for `leads`/`events` later). Depends on apps building into images.
10. **Observability: pino structured logs → Loki/Grafana, Sentry init in each app, Uptime Kuma, OTel scaffolding.** Cross-cutting; wire once apps run.
11. **CI/CD: GitHub Actions** — `lint → typecheck → test (incl. RLS isolation test) → build images → push registry → deploy staging + run migrations`. Last because it orchestrates everything above.

**Critical ordering constraints:** RLS (step 3) must precede any app code, because retrofitting it is a rewrite. Auth (4) precedes api context (5) precedes both apps (6,7). Migrations run *before* container swap in deploy (step 11). Observability (10) and CI (11) are the "operable from day one" payoff and should not be deferred past the milestone even though they come last in dependency order.

---

## CI Pipeline Shape (GitHub Actions)

```
on: push → [ install (pnpm, cached) ]
   → turbo run lint typecheck test   (affected-graph aware, remote/Turbo cache)
        └─ includes the RLS isolation test (spins ephemeral Postgres service)
   → turbo run build                  (Next.js standalone output for web/panel)
   → docker build + push per app      (only on main)
on: merge to main →
   → ssh/registry deploy to VPS
   → pnpm db:migrate (privileged role) BEFORE container swap
   → docker compose up -d (rolling)   → smoke check via Uptime Kuma / healthchecks
prod: same workflow, manual approval gate.
```

Build order inside CI mirrors the package graph (Turborepo computes it); the only hand-ordered step is **migrate-before-swap** in deploy.

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| 0–1k visitors (MVP/staging) | Single VPS, single Postgres, single Redis, Compose. ISR + R2 absorb public read load. No pooler needed yet. This is the whole milestone-v1 target. |
| 1k–100k visitors | Add a **transaction-mode** connection pooler (PgBouncer/Supavisor) — compatible because the RLS pattern already uses `SET LOCAL`-in-a-transaction. Move worker to its own VPS. Read replicas for the public/anon read path. |
| 100k+ | Partition `events` is already designed (monthly); offload analytics to ClickHouse (already noted as the path). Consider per-large-tenant schema/db split only if a single tenant dwarfs others — RLS handles the long tail. |

### Scaling priorities

1. **First bottleneck: image/media delivery on 4G**, not the DB. Mitigated by R2 + AVIF/WebP variants (phase 1) and Lighthouse budget in CI — architectural, not a DB concern.
2. **Second bottleneck: connections under concurrency.** The transaction-scoped RLS choice future-proofs this: a transaction-mode pooler drops in without touching app code. (If we had chosen session-level `SET`, adding a pooler would be a rewrite — which is exactly why we didn't.)

---

## Anti-Patterns

### Anti-Pattern 1: Setting tenant context once per connection (or in middleware before a transaction)

**What people do:** `SET app.org_id = ...` (session-level) on connect or at the start of a request, then run queries on a pooled connection.
**Why it's wrong:** With any connection pooling, a later request reuses that connection and inherits the previous tenant's context → cross-tenant data leak that only manifests under concurrency in production. Statement-mode poolers break it outright.
**Do this instead:** `SET LOCAL` / `set_config(..., true)` **inside the transaction** that runs the queries (Pattern 1). Context dies with the transaction; the connection returns clean.

### Anti-Pattern 2: Enforcing tenancy with application `where org_id = ?` instead of RLS

**What people do:** Skip RLS and add a `where` clause in every Drizzle query.
**Why it's wrong:** One forgotten clause = silent cross-tenant leak; nothing fails loudly. CLAUDE.md mandates RLS for this reason.
**Do this instead:** RLS in the database with `force row level security`; the app `where` clauses become an optimization, not the security boundary. Add a test that fails if any tenant table lacks RLS.

### Anti-Pattern 3: Putting tRPC routers inside one app and importing across apps

**What people do:** Define routers in `apps/panel` and import them from `apps/web`/`apps/worker`.
**Why it's wrong:** Creates app→app dependencies, breaks Turborepo caching and independent deploys, and tangles the public and authed surfaces.
**Do this instead:** Routers + context live in `packages/api`; every app imports the package. Apps never import apps.

### Anti-Pattern 4: Mixing Better Auth tables into a hand-rolled migration flow

**What people do:** Let Better Auth own one schema generation path and Drizzle own another, drifting apart.
**Why it's wrong:** Two sources of truth for the schema → migration conflicts, RLS not applied to auth-adjacent tables.
**Do this instead:** Use the Better Auth **Drizzle adapter**, generate its tables into `packages/db/src/schema`, and let Drizzle migrations be the single source of truth (commit them; never hand-edit applied migrations).

### Anti-Pattern 5: Deferring observability/CI to "after it works"

**What people do:** Build features first, add logging/monitoring/deploy later.
**Why it's wrong:** Directly violates the project's core value ("operable from day one; not 'works on my machine'"). You discover staging is broken via the client, not your dashboards.
**Do this instead:** Steps 10–11 are part of the milestone definition of done, not optional polish.

---

## Integration Points

### External Services

| Service | Integration pattern | Notes / gotchas |
|---------|---------------------|-----------------|
| Resend (email) | Called from the **worker**, not the request path; React Email templates | Invitations/leads emails are async jobs; keep API keys server-only via `config/env.ts` |
| Cloudflare R2 | S3 SDK; signed URLs from panel | Not phase-0 critical (media is phase 1) but env vars and bucket should exist in staging |
| Sentry | SDK init per app (web/panel/worker) | Set `tracesSampleRate` low; tag events with `orgId` (never PII) |
| Loki/Grafana | pino → JSON logs → Promtail/Loki | Structured logs with `orgId`, `requestId`; one log schema across apps |
| Uptime Kuma | HTTP healthcheck endpoints per app | Each app exposes `/healthz` (liveness) and `/readyz` (DB/Redis reachable) |
| Traefik / Let's Encrypt | Docker labels per service; on-demand TLS for custom domains (later) | Phase 0: just staging host + TLS; rate-limit middleware defined but lightly used |

### Internal Boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| apps ↔ `packages/api` | Direct import (RSC server caller / typed client / worker direct call) | No HTTP between worker and apps; type-safe contracts, no codegen |
| `packages/api` ↔ `packages/db` | Direct import; api uses `withTenant`/`withAnon`, never raw pool | All tenant scoping funneled through db helpers |
| `packages/api` ↔ Better Auth | api owns the single `auth` server instance; reads `activeOrganizationId` | Re-validate membership server-side every request |
| worker ↔ Redis ↔ apps | BullMQ queues; jobs carry `orgId` in payload | Worker sets tenant context from payload, same `withTenant` path |
| web/panel ↔ Postgres realtime | LISTEN/NOTIFY → SSE (later phases) | Channel/payload conventions decided in db package now to avoid churn |

---

## Sources

- [Drizzle ORM — Row-Level Security (RLS)](https://orm.drizzle.team/docs/rls) — HIGH (official)
- [Better Auth — Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle) and [Active Organization & Context](https://deepwiki.com/better-auth/better-auth/5.5-access-control-deep-dive) — HIGH/MEDIUM (official + community wiki)
- [Restore Supabase RLS with Drizzle using tRPC middlewares](https://mortadha.dev/blog/restore-supabase-rls-with-drizzle-using-trpc-middlewares/) — MEDIUM (community, corroborates the tx-scoped middleware pattern)
- [PostgreSQL RLS notes — set/set local only persist in a transaction](https://imfeld.dev/notes/postgresql_row_level_security) — HIGH (matches Postgres semantics)
- [Postgres Row-Level Security Footguns — Bytebase](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) and [RLS sounds great until it isn't — PlanetScale](https://planetscale.com/blog/rls-sounds-great-until-it-isnt) — MEDIUM (pooling/SET ROLE pitfalls, cross-checked)
- [Mastering PostgreSQL RLS for multi-tenancy](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/) — MEDIUM (corroborating)
- Project docs: `docs/modelo-mvp.md` §3 (architecture/stack/data model), `CLAUDE.md` (stack/quality), `.planning/PROJECT.md` (phase-0 scope) — HIGH (authoritative for this project)

---
*Architecture research for: multi-tenant SaaS foundation (phase 0)*
*Researched: 2026-06-12*
