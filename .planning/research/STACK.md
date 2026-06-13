# Stack Research

**Domain:** Multi-tenant SaaS foundation (phase 0) — real-estate presale showroom platform (Argentina)
**Researched:** 2026-06-12
**Confidence:** HIGH (versions verified against live npm registry; integration patterns verified against official docs)

> **Scope note.** The stack is DECIDED and non-negotiable per `CLAUDE.md`. This document does NOT propose alternatives. It pins **current versions (mid-2026)**, flags **compatibility constraints**, and prescribes **phase-0 configuration** for: monorepo + CI/CD + Docker/staging + observability + auth + multi-tenancy + Postgres RLS. The "Alternatives Considered" and "What NOT to Use" sections below are scoped to *configuration choices within the decided stack* (e.g. which driver, which RLS pattern), not to swapping out the stack itself.

---

## Recommended Stack

### Core Technologies (versions verified on npm, 2026-06-12)

| Technology | Version | Purpose | Why / phase-0 note |
|------------|---------|---------|--------------------|
| **pnpm** | `11.6.0` | Package manager + workspaces | Pin via `packageManager` field in root `package.json` + Corepack so CI and local match exactly. |
| **Turborepo** | `2.9.18` | Monorepo task orchestration + caching | `turbo.json` with `tasks` (not the legacy `pipeline` key). Use `turbo prune` for Docker (see Architecture). |
| **TypeScript** | `5.9.x` | Strict typing end-to-end | **Do NOT jump to TS 6.x blindly** (npm `latest` shows `6.0.3`). TS 6 is the new native/perf line; verify every tool (ESLint TS plugin, Drizzle Kit, Next) supports it before adopting. **Pin TS `5.9.x` for phase 0** — safest with the rest of the matrix. `strict: true`, `noUncheckedIndexedAccess: true`. |
| **Node.js** | `22 LTS` (`>=20.9` required by Next) | Runtime | Use Node 22 LTS in CI and Docker base images. Pin in `.nvmrc` + `engines`. |
| **Next.js** | `16.2.x` | `apps/web` (public, RSC + ISR) and `apps/panel` | App Router. Set `output: 'standalone'` for Docker. Requires React 19. |
| **React** | `19.2.x` | UI runtime for both Next apps | Matches Next 16. tRPC v11 + TanStack Query v5 are React-19 compatible. |
| **tRPC** | `11.17.0` (`@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`) | Typed API in `packages/api` | v11 has first-class App Router + RSC support and native TanStack Query v5 integration. No codegen. |
| **Zod** | `4.4.x` | Validation at the tRPC boundary + env parsing | tRPC v11 supports Zod 4. Use `z.input`/`z.output` awareness; Zod 4 changed some error/format APIs vs v3 — write new code against v4 idioms. |
| **PostgreSQL** | `16.x` | Primary DB, multi-tenant via RLS | Pin the **Postgres 16** image tag (`postgres:16-alpine`) in Compose — do not float to 17/18. |
| **Drizzle ORM** | `drizzle-orm 0.45.2` | Schema, queries, **RLS policies as code** | Native `pgPolicy` / `pgRole` support. See RLS pattern below. |
| **Drizzle Kit** | `drizzle-kit 0.31.10` | Versioned migrations + role/policy generation | Set `entities.roles: true` in `drizzle.config.ts` so policies/roles are emitted into migrations. |
| **Better Auth** | `better-auth 1.6.18` | Sessions + organizations + memberships + email invites | Use the built-in **organization plugin** + **access control** for roles. CLI: `@better-auth/cli`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **postgres** (porsager) | `3.4.9` | Postgres driver for Drizzle | **Recommended driver.** Lightweight, fast, clean transaction API ideal for the per-request RLS transaction pattern. Use this over `pg` for app queries. |
| **drizzle-zod** | `0.8.3` | Derive Zod schemas from Drizzle tables | Keep tRPC input/output validation in sync with the schema without duplication. |
| **@tanstack/react-query** | `5.101.0` | Client cache for tRPC in the panel | Required peer for `@trpc/tanstack-react-query`. v5 (not v4 — v4 is for tRPC v10). |
| **bullmq** | `5.78.0` | Background jobs in `apps/worker` | Phase 0 only needs the wiring/skeleton + a health job; heavy jobs (sharp, PDFs) land in later phases. |
| **ioredis** | `5.11.1` | Redis client for BullMQ | BullMQ's expected client. |
| **pino** | `10.3.1` | Structured logging | Phase-0 observability requirement. JSON logs → Loki via Promtail/Alloy. Use `pino-pretty` only in dev. |
| **@sentry/nextjs** | `10.57.0` | Error + perf monitoring (web/panel) | Wire from first deploy. Free tier is sufficient for MVP. Use a separate Sentry SDK for the worker. |
| **@opentelemetry/sdk-node** | `0.219.0` | Tracing (worker + API) | Phase-0: minimal trace exporter; deepen in later phases. |
| **resend** + **react-email** | `resend 6.12.4`, `@react-email/components 1.0.12` | Transactional email (org invitations) | Phase 0 needs invitation emails for memberships. |
| **@aws-sdk/client-s3** | `3.10xx` | S3-compatible client for Cloudflare R2 | Skeleton/config in phase 0; media pipeline is phase 1. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **ESLint** | Lint gate in CI | npm `latest` is `10.x`. **Verify flat-config + `typescript-eslint` support** for whatever ESLint major you pick; if the TS-ESLint stack lags, pin ESLint `9.x` (flat config) for stability in phase 0. |
| **Vitest** | `4.1.8` — unit tests (later: quoting at 100%) | Phase 0 sets up the runner + coverage gate; the quoting suite is phase 3. |
| **@playwright/test** | `1.60.0` — e2e of auth/tenancy flows | Phase-0 e2e: login, create org, invite member, RLS isolation smoke test. |
| **Docker + Compose** | Local + staging parity | Compose: Postgres 16, Redis, web, panel, worker, Traefik, Loki/Grafana, Uptime Kuma. |
| **Traefik** | `v3.x` | Reverse proxy + ACME TLS (incl. on-demand for custom client domains) | See Architecture for cert-resolver config. |
| **GitHub Actions** | CI/CD | Lint+typecheck+test → build Docker images → registry → auto-deploy staging, manual prod. |

---

## Installation

```bash
# Pin pnpm via corepack (root package.json: "packageManager": "pnpm@11.6.0")
corepack enable

# --- Core (workspace root / shared) ---
pnpm add -w typescript@5.9 zod@4

# --- apps/web & apps/panel ---
pnpm add next@16 react@19 react-dom@19
pnpm add @trpc/server@11 @trpc/client@11 @trpc/tanstack-react-query@11 @tanstack/react-query@5
pnpm add @sentry/nextjs@10

# --- packages/db ---
pnpm add drizzle-orm@0.45 postgres@3
pnpm add -D drizzle-kit@0.31
pnpm add drizzle-zod@0.8

# --- auth (likely packages/api or apps/* depending on layout) ---
pnpm add better-auth@1.6
pnpm add -D @better-auth/cli

# --- apps/worker ---
pnpm add bullmq@5 ioredis@5 pino@10
pnpm add @opentelemetry/sdk-node
pnpm add resend@6 @react-email/components@1
pnpm add @aws-sdk/client-s3

# --- dev / tooling (root) ---
pnpm add -D turbo@2 vitest@4 @playwright/test@1 eslint pino-pretty
```

---

## RLS + Auth integration (the load-bearing decision)

This is the single highest-risk integration of phase 0. Getting it wrong = a silent tenant data leak, which is fatal for a multi-tenant SaaS.

### Pattern: transaction-scoped session variable + a dedicated non-superuser app role

1. **Two database roles, two connection contexts.**
   - **`app_authenticated`** (NOSUPERUSER, NOBYPASSRLS) — used by tRPC for all tenant-scoped application queries. RLS policies are evaluated against this role.
   - **`anon`** (NOSUPERUSER, NOBYPASSRLS) — used for the public web read path; policies restrict it to `projects.estado = 'publicado'`.
   - **Migrations / Better Auth's own tables** run under the migration/owner role (privileged). Better Auth manages `user`/`session`/`organization`/`member`/`invitation` via the Drizzle adapter on a privileged connection — **do NOT route Better Auth's internal queries through the RLS-scoped role.** RLS guards *application* tables, not the auth system tables.

2. **Per-request transaction sets the tenant context, then runs the query.** With the `postgres` driver + Drizzle:

```ts
// pseudo-pattern inside tRPC context / a db helper
await db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`); // true = LOCAL (transaction-scoped)
  // ...all tenant queries here see only rows for orgId
});
```

   `set_config(..., true)` == `SET LOCAL`: the variable resets at COMMIT/ROLLBACK, so it is **safe with connection pooling** (no leak between requests). The `orgId` comes from the Better Auth session's `activeOrganizationId`.

3. **Policies in Drizzle schema, emitted to migrations.** Example for a tenant table:

```ts
import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole, pgTable, uuid, text } from 'drizzle-orm/pg-core';

export const appAuthenticated = pgRole('app_authenticated');         // .existing() if created outside Drizzle
export const anon = pgRole('anon');

export const projects = pgTable('projects', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid().notNull(),
  estado: text().notNull(), // borrador | publicado | archivado
}, () => [
  pgPolicy('projects_tenant_isolation', {
    for: 'all',
    to: appAuthenticated,
    using: sql`organization_id = current_setting('app.current_org_id', true)::uuid`,
    withCheck: sql`organization_id = current_setting('app.current_org_id', true)::uuid`,
  }),
  pgPolicy('projects_public_read', {
    for: 'select',
    to: anon,
    using: sql`estado = 'publicado'`,
  }),
]);
```

   Set `entities: { roles: true }` in `drizzle.config.ts` so Drizzle Kit generates the role + policy DDL. Adding a policy auto-enables RLS on the table.

4. **CRITICAL gotchas (verified against PostgreSQL docs + RLS footgun write-ups):**
   - **Table owners bypass RLS by default.** If the app role owns the tables (common when migrations create them), policies are silently ignored. **Use `ALTER TABLE ... FORCE ROW LEVEL SECURITY`** on every tenant table, OR ensure the app role is never the table owner. Add a phase-0 test that asserts this.
   - **Superusers and `BYPASSRLS` roles ignore policies.** Never run app/test queries as a superuser — they make broken RLS look like it works. The `app_authenticated`/`anon` roles must be plain NOSUPERUSER NOBYPASSRLS.
   - **`current_setting('app.current_org_id', true)`** — the second arg `true` returns NULL instead of erroring when unset; combined with default-deny this means "no context → no rows" (fail-closed). Without it, a missing GUC throws.
   - **No policy on a table = default deny** for non-owner roles. Good default, but means every new tenant table needs an explicit policy or the app breaks. Enforce via a schema lint / migration review checklist.

5. **Mandatory phase-0 verification (e2e):** create two orgs, insert rows in each, then prove that a query under `app_authenticated` with org A's GUC cannot see org B's rows, and that `anon` only sees `publicado` projects. This is the acceptance gate for the multi-tenancy requirement.

### Better Auth organization plugin config (verified against official docs)

```ts
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

const statement = {
  project: ['create', 'update', 'delete', 'publish'],
  unit:    ['update'],
  member:  ['create', 'update', 'delete'],
} as const;
const ac = createAccessControl(statement);

// Roles map to CLAUDE.md: owner / developer / viewer
const owner     = ac.newRole({ project: ['create','update','delete','publish'], unit:['update'], member:['create','update','delete'] });
const developer = ac.newRole({ project: ['create','update','publish'], unit:['update'] });
const viewer    = ac.newRole({});

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  plugins: [
    organization({
      ac,
      roles: { owner, developer, viewer },
      creatorRole: 'owner',
      // membershipLimit, invitation email handler, etc.
    }),
  ],
  databaseHooks: {
    session: { create: { before: async (s) => ({ data: { ...s, activeOrganizationId: /* user's org */ } }) } },
  },
});
```

- Plugin creates `organization`, `member`, `invitation` tables and adds `activeOrganizationId` to `session`. The session's `activeOrganizationId` is exactly the value to feed into the RLS GUC.
- Mirror `ac`/roles in the client via `organizationClient`.
- Run Better Auth's migration/generate (`@better-auth/cli`) and **commit the generated schema into your Drizzle schema** so all DDL stays versioned in one migration history (don't let two migration systems fight).

---

## Alternatives Considered (configuration-level, within the decided stack)

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `postgres` (porsager) driver | `pg` (`8.21.0`) | If a dependency requires the `pg` pool interface specifically. `pg` works with Drizzle too, but `postgres` has a cleaner transaction API for the per-request RLS pattern. |
| TS `5.9.x` for phase 0 | TS `6.0.x` (npm latest) | Once the whole tool matrix (typescript-eslint, drizzle-kit, next) confirms TS 6 support. Adopt deliberately, not by floating `latest`. |
| ESLint `9.x` flat config (if TS-ESLint lags) | ESLint `10.x` | Once `typescript-eslint` ships a stable major for ESLint 10. |
| HTTP-01 ACME challenge for custom domains | DNS-01 challenge | Use DNS-01 only if you need a **wildcard** cert (ACME wildcards require DNS-01). For per-client custom domains via CNAME, HTTP-01 on-demand is simpler. |
| Transaction-scoped `SET LOCAL` GUC RLS | Schema-per-tenant / DB-per-tenant | Only if a future enterprise client demands physical isolation. For MVP, RLS in a shared schema is correct (matches modelo-mvp.md §3.1). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Turborepo `pipeline` key in `turbo.json` | Renamed to `tasks` in Turborepo 2.x; `pipeline` is removed. | `"tasks": { ... }` |
| TanStack Query **v4** with tRPC v11 | v4 pairs with tRPC v10; v11 needs v5. Mixing causes type/runtime breakage. | `@tanstack/react-query@5` + `@trpc/tanstack-react-query@11` |
| Running app/tests as Postgres **superuser** or a `BYPASSRLS` role | Silently bypasses RLS — broken policies look like they work; tenant leak ships. | Dedicated `app_authenticated` / `anon` NOSUPERUSER NOBYPASSRLS roles. |
| Letting the app role **own** RLS tables without `FORCE ROW LEVEL SECURITY` | Table owners bypass RLS by default → policies ignored. | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table (or separate owner role). |
| `SET` (session-level) for the tenant GUC | Persists on a pooled connection → cross-request tenant leak. | `set_config(..., true)` / `SET LOCAL` inside a transaction. |
| `pnpm install --prod` inside `.next/standalone` | Breaks the @vercel/nft-traced `node_modules` (pnpm symlinks). | Trust `output: 'standalone'` tracing; copy the traced tree as-is. |
| Two competing migration histories (Better Auth auto-migrate **and** Drizzle Kit both writing DDL at runtime) | Drift + conflicts between systems. | Generate Better Auth schema, fold it into Drizzle schema, run **all** DDL through Drizzle Kit migrations. |
| Neon-only helpers (`crudPolicy`, `authUid()`) | They target Neon/Supabase managed roles; this is self-hosted Postgres. | Raw `pgPolicy` + `current_setting()` expressions. |
| Manual schema edits in Postgres | Violates CLAUDE.md (versioned migrations only). | Drizzle Kit migrations, reviewed in PR. |

---

## Architecture-adjacent configuration notes (phase 0)

**Docker — Next.js standalone in a pnpm/Turborepo monorepo (verified pattern):**
- `next.config`: `output: 'standalone'`.
- Multi-stage Dockerfile per app: a **prune stage** runs `turbo prune <app> --docker` → `./out` (pruned workspace + pruned lockfile); an **install/build stage** runs `pnpm install --frozen-lockfile` then `turbo build`; a slim **runner stage** copies `.next/standalone`, `.next/static`, and `public`. Do not re-run `pnpm install --prod` inside standalone.
- Use a Node 22 Alpine base for the runner.

**Traefik v3 — TLS for staging + custom client domains (verified pattern):**
- One ACME **certResolver** using **HTTP-01** challenge (Let's Encrypt). Persist `acme.json` (chmod 600) on a volume.
- Per-app routers derive their cert from the router's `Host()` rule — so a new client custom domain (added via CNAME → label/dynamic config) triggers an on-demand cert request with no infra change. This delivers the "dominios custom por CNAME sin tocar infra" requirement.
- For a single wildcard (`*.tours.andescode.com.ar`) you'd need DNS-01 instead; for arbitrary client domains, stick with per-domain HTTP-01.
- Anonymous insert endpoints (`events`, `leads`) get a Traefik rate-limit middleware at the edge (per modelo-mvp.md §3.3).

**GitHub Actions — Turborepo + Docker:**
- Cache Turborepo via the GitHub Actions cache (or self-hosted remote cache) keyed on lockfile + `turbo` hash; restore before `turbo run lint typecheck test build`.
- Build images with Buildx + layer cache (`cache-from/cache-to: type=gha`), push to a registry, then deploy to the VPS (SSH `docker compose pull && up -d`). Auto on merge to `main` → staging; manual `workflow_dispatch` → prod.

---

## Version Compatibility Matrix

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `next@16.2` | `react@19.2`, `react-dom@19.2` | Next 16 requires React 19. Node `>=20.9` (use 22 LTS). |
| `@trpc/*@11.17` | `@tanstack/react-query@5`, `zod@4`, React 19 | v11 = TanStack Query **v5** only; Zod 4 supported. |
| `drizzle-orm@0.45` | `drizzle-kit@0.31`, Postgres 16, `postgres@3` / `pg@8` | Keep ORM + Kit majors aligned; `entities.roles:true` needed for RLS DDL. |
| `better-auth@1.6` | `drizzle-orm@0.45` via `drizzleAdapter`, Postgres 16 | Organization plugin tables; adapter `joins` opt-in since 1.4. Use matching `@better-auth/cli`. |
| `bullmq@5.78` | `ioredis@5.11`, Redis 7 | Pin Redis 7 image in Compose. |
| `typescript@5.9` | typescript-eslint, drizzle-kit, next 16 | **Do not** float to TS 6 until each tool confirms support. |
| `vitest@4` / `@playwright/test@1.60` | Node 22 | Standard. |

---

## Sources

- npm registry (`npm view <pkg> version`), 2026-06-12 — exact current versions of every package above. **HIGH**
- [Drizzle ORM — Row-Level Security](https://orm.drizzle.team/docs/rls) — `pgRole`, `pgPolicy`, `using`/`withCheck`, `entities.roles`, default-deny, self-hosted caveats. **HIGH**
- [Better Auth — Organization plugin](https://better-auth.com/docs/plugins/organization) — plugin setup, `createAccessControl`, roles, `creatorRole`, tables created, `activeOrganizationId`, session hooks. **HIGH**
- [Better Auth — Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — adapter config, `experimental.joins` (since 1.4). **HIGH**
- [PostgreSQL docs — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) + [Bytebase — RLS footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — owner bypass, `FORCE ROW LEVEL SECURITY`, BYPASSRLS/superuser, testing gotcha. **HIGH**
- [ECOSIRE — Drizzle + Postgres RLS multi-tenancy (2026)](https://ecosire.com/blog/drizzle-orm-postgres-rls-multitenancy) + [OneUptime — RLS for multi-tenant](https://oneuptime.com/blog/post/2026-01-25-row-level-security-postgresql/view) — `SET LOCAL` / `set_config(...,true)` transaction-scoped GUC, pooling safety. **MEDIUM** (cross-checked against PG docs → effectively HIGH).
- [Turborepo — Docker guide](https://turborepo.dev/docs/guides/tools/docker) + [pnpm + Next standalone + Docker](https://dev.to/kochan/pnpm-nextjs-standalone-docker-5-failures-before-success-part-9-g3o) — `turbo prune --docker`, standalone tracing, avoid `pnpm install --prod` in standalone. **HIGH** (official) / **MEDIUM** (blog).
- [Traefik — ACME cert resolvers](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/) — HTTP-01 vs DNS-01, per-router cert derivation, wildcard requires DNS-01. **HIGH**
- [tRPC v11 + Next App Router setup](https://trpc.io/docs) (and 2026 RSC guides) — v11 RSC support, TanStack Query v5 pairing, Zod 4. **MEDIUM/HIGH**

---
*Stack research for: multi-tenant SaaS foundation (phase 0)*
*Researched: 2026-06-12*
