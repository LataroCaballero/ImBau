# Phase 2: Data Layer + RLS - Research

**Researched:** 2026-06-15
**Domain:** PostgreSQL Row-Level Security multi-tenancy, Drizzle ORM schema/migrations/policies as code, Better Auth schema generation (offline), transaction-scoped GUC tenant context, cross-tenant absence testing
**Confidence:** HIGH (all load-bearing APIs verified against the pinned package type definitions; pinned versions confirmed against npm registry)

## Summary

This phase builds the data layer with tenant isolation **enforced by Postgres RLS and proven by absence tests**, before any application code. Every locked decision (D-01 … D-12) is implementable with the pinned stack, but three APIs differ from the optimistic assumption that "Drizzle expresses everything as code":

1. **Drizzle `pgRole` cannot express the role attributes the phase needs.** `PgRoleConfig` (verified in `drizzle-orm@0.45.2`) exposes only `createDb`, `createRole`, `inherit` — there is **no `login`, `password`, `bypassRls`, `nosuperuser` option**. So `app_authenticated` / `anon` as `NOSUPERUSER NOBYPASSRLS LOGIN` with a password, all `GRANT`s, and `FORCE ROW LEVEL SECURITY` must be **hand-written SQL appended to the generated migration** (Drizzle `.enableRLS()` emits `ENABLE`, never `FORCE`). This is the single biggest planning implication.
2. **`@better-auth/cli` latest is `1.4.21`, on a different version line than `better-auth@1.6.18`.** CLAUDE.md says "matching `@better-auth/cli`" — there is no 1.6.x CLI. Use `@better-auth/cli@1.4.21` purely as a dev-time generator; it depends on `better-auth@1.4.21` internally but only reads your config to emit schema (D-03's "no runtime" path). The CLI `migrate` command is **Kysely-only** ("not supported" for the Drizzle adapter), which is exactly why D-03 chose `generate` + fold-into-Drizzle.
3. **`set_config(..., $1, true)` parameterized** is the correct tenant-context injection with the porsager driver — `SET LOCAL` does not accept bind parameters. Confirmed `sql.begin()` transaction API in `postgres@3.4.9`.

None of these contradict the locked decisions; they are the API reality the planner must encode so the decisions are implemented correctly.

**Primary recommendation:** Generate Better Auth tables offline with `@better-auth/cli@1.4.21 generate` (org plugin + `plan` via `additionalFields`), fold the output into a single Drizzle schema, define `projects` + the `estado` enum + RLS policies/roles via `pgPolicy`/`pgRole`, then **append raw SQL** for role attributes/passwords, `GRANT`s, and `FORCE ROW LEVEL SECURITY` into the same migration. Connect the app pool as `app_authenticated` and migrations as a separate owner role. Implement `withTenant`/`withAnon` as `sql.begin` wrappers using `set_config(..., $1, true)`. Prove isolation with absence tests against the Compose Postgres 16, applying migrations + roles once at suite start.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tenant identity & Better Auth tables**
- **D-01:** Better Auth's `organization` table (org plugin) IS the canonical tenant, extended with a `plan` column from modelo-mvp. `projects.organization_id` points to it. The RLS GUC comes directly from `session.activeOrganizationId`. One notion of organization — no separate domain `organizations` table to sync.
- **D-02:** The membership table is `member` (created by the org plugin: `organization_id`, `user_id`, `role`), adopted as canonical. Roles `owner`/`developer`/`viewer` live in `member.role` via Better Auth access control. (modelo-mvp §3.3 calls it `memberships`; do not fight the plugin. Resolves the `member` vs `memberships` blocker from STATE.md.)
- **D-03:** To get Better Auth tables into the phase-2 migration without the auth runtime (phase 3): stand up a **minimal** Better Auth config (Drizzle adapter + organization plugin, no endpoints/UI) only to run `@better-auth/cli generate`, fold the output into the Drizzle schema, and version it in the migration history. Phase 3 reuses the same config. Schema faithful to what BA expects, one migration history (consistent with CLAUDE.md "fold Better Auth schema into Drizzle").

**`withTenant()` mechanics & role-switching**
- **D-04:** The app pool connects **directly** as `app_authenticated` (NOSUPERUSER, NOBYPASSRLS, no table ownership). `withTenant()` only opens a transaction and runs `SET LOCAL app.current_organization_id = <orgId>`. Migrations run with a **separate owner** pool/role. The runtime role is never privileged — minimizes RLS leak surface.
- **D-05:** Tenant GUC: `app.current_organization_id` (`app.*` namespace, custom setting that survives without being declared in `postgresql.conf`). Policies read `current_setting('app.current_organization_id', true)::uuid` — the second arg `true` (`missing_ok`) avoids an error when unset, letting the filter fall to default-deny.
- **D-06:** The anonymous public read path is exposed via a **separate** helper `withAnon()`: opens a transaction as role `anon` (also NOSUPERUSER/NOBYPASSRLS) **without** setting the tenant GUC; `anon` policies filter globally by `estado = 'publicado'`. A distinct API makes the security model explicit at each call site (tenant-scoped vs published-only).

**Cross-tenant test harness (DATA-04, exit gate)**
- **D-07:** Tests point at the **same Compose Postgres 16** (DATA-01), against a dedicated test DB. Zero new infra, exact parity with dev; in CI (phase 4) the endpoint is swapped for the GitHub Actions Postgres service with the same config and the same tests (no testcontainers — avoids a divergent second path).
- **D-08:** Test isolation: apply migrations + create roles **once** at suite start; each test creates its own orgs/projects (org A vs org B) with unique data and verifies. Mirrors how prod runs — **no** per-test txn-with-rollback because it would clash with the code-under-test's own per-transaction `SET LOCAL` (`withTenant()`).
- **D-09:** The absence test (the exit gate) runs **as role `app_authenticated`** with the GUC set to org A and asserts: (a) SELECT over `projects` and every tenant table returns **zero rows** from org B (absence, not just "doesn't break"); (b) the mirror case (B doesn't see A); (c) a cross-tenant INSERT/UPDATE **fails**; (d) `anon` does not see `borrador` projects. Covers reads, writes, and the anon/published path.

**Phase-2 schema scope**
- **D-10:** Tables in the phase-2 migration (minimum that proves the RLS seam end-to-end): `organization` (extended with `plan`), `member`, `user` / `session` / `account` / `verification`, `invitation` (Better Auth) and `projects`. floors/units/prices/quotes/leads/events/etc. do NOT enter — they are SCHEMA-01 (future milestone).
- **D-11:** `projects.estado` enters now as enum `[borrador|publicado|archivado]` **plus** the `anon` role policy filtering `estado = 'publicado'` — it is literal DATA-03 and `withAnon()` needs something concrete to test.
- **D-12:** No dev seed in phase 2 — test orgs/projects are created by the test fixtures. The "Brigos Recoleta" building seed is SEED-01 (future milestone), not this phase.

### Claude's Discretion
- Exact role names beyond `app_authenticated` / `anon` (e.g. whether the owner/migrator is the connection default role or a named one), internal structure of `drizzle.config.ts` (with `entities.roles: true`), and folder organization inside `packages/db` (schema, policies, helpers, migrations).
- Fine mechanics of how the `postgres` (porsager) pool opens/closes the transaction inside `withTenant()`/`withAnon()` and how `orgId` is injected safely (parameterized, never interpolated, to avoid injection in the `SET LOCAL`).
- Exact Redis version/image in Compose (stack asks for Redis 7) and whether a health-check is exposed; Redis is container-only in phase 2, no app code touches it yet.

### Deferred Ideas (OUT OF SCOPE)
- `events` and `leads` with anonymous insert + edge rate-limit (Traefik) — considered to exercise the anonymous write path, but the model places them in later phases; deferred to SCHEMA-01. The anonymous write RLS pattern is still validated by cross-tenant writes failing in D-09.
- Minimal dev seed (`pnpm db:seed` with example orgs/projects) — deferred; the real seed is SEED-01 ("Brigos Recoleta", future milestone).
- Full domain schema (floors, units, price_lists, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events) — SCHEMA-01, future milestone.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | `docker compose up -d` brings up Postgres 16 + Redis locally with one command | Compose service definitions (Postgres 16-alpine + Redis 7-alpine, both with healthchecks) — see "Docker Compose (DATA-01)" below. No compose file exists yet in the repo. |
| DATA-02 | Base schema (organizations → projects + Better Auth tables) in `packages/db`, versioned Drizzle migrations (`generate` + `migrate`, never `push`/manual) | Offline Better Auth `generate` → fold → one Drizzle schema → `drizzle-kit generate` + `migrate`. See "Better Auth offline generation" and "Drizzle schema & migrations". |
| DATA-03 | Every tenant table has `FORCE ROW LEVEL SECURITY`, dedicated DB roles (app no ownership/BYPASSRLS, `anon` limited to `publicado`), tenant context per-transaction via `withTenant()` with `SET LOCAL` | `pgPolicy`/`pgRole` for policies; **raw SQL** for `FORCE`, role attributes, GRANTs. `withTenant`/`withAnon` via `sql.begin` + `set_config(..., $1, true)`. See "RLS as code (and its limits)" + "withTenant/withAnon". |
| DATA-04 | Cross-tenant absence tests (absence, not just presence) run against real Postgres as the app role; org A cannot read org B — milestone exit gate | Vitest harness against Compose Postgres, dedicated test DB, migrations+roles once at suite start, per-role connections. See "Validation Architecture". |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tenant isolation enforcement | Database / Storage (Postgres RLS) | — | Decision is explicitly "enforced BY the database", not app code. Policies + `FORCE RLS` live in Postgres; app code cannot bypass. |
| Tenant context propagation (`withTenant`) | API / data-access layer (`packages/db`) | Database (GUC) | The helper sets a transaction-scoped GUC; Postgres reads it in policies. App passes `orgId`; DB does the filtering. |
| Schema definition + migrations | Database / Storage (`packages/db`) | — | Versioned DDL is the source of truth; no app surface in this phase. |
| Auth table shape | Database (folded Drizzle schema) | Dev tooling (BA CLI generator) | Tables are generated offline by a dev tool, then owned by Drizzle migrations. Runtime auth is phase 3. |
| Anonymous published read | Database (`anon` role policy) | data-access (`withAnon`) | Published-only filter is a DB policy on the `anon` role; the helper just selects the role and opens a txn. |
| Local infra (Postgres/Redis) | Infra (Docker Compose) | — | `docker compose up -d` is the only infra surface this phase touches. |
| Cross-tenant proof | Test harness (Vitest) | Database | The exit gate is a test asserting DB behavior as the app role. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `0.45.2` | Schema, queries, `pgPolicy`/`pgRole`, `.enableRLS()` | Pinned matrix. `latest` on npm == `0.45.2` (verified 2026-06-15). Native RLS-as-code for self-hosted Postgres. |
| `drizzle-kit` | `0.31.10` | Versioned migrations; emits roles/policies with `entities.roles:true` | Pinned matrix; `latest` == `0.31.10` (verified). Keep ORM+Kit majors aligned. |
| `postgres` (porsager) | `3.4.9` | App + migration DB driver | Pinned matrix; `latest` == `3.4.9` (verified). Clean `sql.begin()` transaction API for the per-request `SET LOCAL` pattern. |
| `better-auth` | `1.6.18` | Source of the org/member/user/session/account/verification/invitation table shapes | Pinned matrix; `latest` == `1.6.18` (verified). **Used in phase 2 only as a schema source via a minimal config — no runtime.** |
| PostgreSQL | `16-alpine` | Primary DB, RLS multi-tenancy | Pinned image tag; do not float to 17/18. |
| Redis | `7-alpine` | Container only in this phase (BullMQ in later phases) | Stack asks Redis 7. No app code touches it in phase 2 (D, discretion). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@better-auth/cli` | `1.4.21` | **Dev-time only** — `generate` Better Auth schema for the Drizzle adapter | Run once (and on auth-schema changes) to emit `auth-schema.ts`, then fold into Drizzle. **NOTE: 1.4.x line, not 1.6.x — see flag below.** |
| `drizzle-zod` | `0.8.3` | Derive Zod schemas from Drizzle tables | Optional in phase 2 (no tRPC boundary yet). Wire only if the planner wants typed test fixtures; otherwise defer to phase 3. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `set_config('app.current_organization_id', $1, true)` parameterized | `SET LOCAL app.current_organization_id = '<uuid>'` interpolated | `SET LOCAL` does not accept bind params in the porsager driver; interpolation is an injection vector. **Use `set_config` parameterized** (per D-05 + Specific Ideas). |
| App pool connects directly as `app_authenticated` (D-04) | Connect as owner then `SET ROLE app_authenticated` per txn | D-04 locked the direct-connection approach (smaller leak surface). Do not introduce `SET ROLE`. |
| porsager `sql.begin()` for `withTenant` | Drizzle `db.transaction()` | Both work. `db.transaction()` keeps queries typed through Drizzle; `sql.begin` gives raw control. Recommend wrapping a **Drizzle instance bound to the app client** and using `db.transaction()` so callers get typed queries, issuing the `set_config` as the transaction's first statement. Either is acceptable (discretion). |

**Installation (planner adds to `packages/db`):**
```bash
pnpm --filter @imbau/db add drizzle-orm@0.45.2 postgres@3.4.9 better-auth@1.6.18
pnpm --filter @imbau/db add -D drizzle-kit@0.31.10 @better-auth/cli@1.4.21
# drizzle-zod@0.8.3 only if typed fixtures are wanted now; otherwise defer to phase 3
```

**Version verification (performed this session, npm registry, 2026-06-15):**
- `drizzle-orm` latest = `0.45.2` ✓ matches pin
- `drizzle-kit` latest = `0.31.10` ✓ matches pin
- `postgres` latest = `3.4.9` ✓ matches pin
- `better-auth` latest = `1.6.18` ✓ matches pin (published 2026-06-12 — 3 days old, hence the SUS "too-new" flag below; the package itself is established with ~4.15M weekly downloads)
- `@better-auth/cli` latest = `1.4.21` — **does NOT track better-auth 1.6.x** (see flag)
- `vitest` latest = `4.1.9` (matrix pins `4.1.8`; root `package.json` already pins `4.1.8` + `@vitest/coverage-v8@4.1.8`). Patch bump only — keep `4.1.8` to match the lockfile.

### Pinned-version reality flags (CONTEXT/CLAUDE.md pinned 2026-06-12)

> These do NOT change any locked decision. They are the API/version reality so the planner implements the decision correctly.

- **FLAG-1 (high impact):** `@better-auth/cli` `latest` is `1.4.21`, not a 1.6.x version. CLAUDE.md's "matching `@better-auth/cli`" cannot be satisfied with a 1.6.x CLI because none exists. Use `@better-auth/cli@1.4.21` as a dev-only generator. It internally depends on `better-auth@1.4.21`, but `generate` only reads your config and emits schema text — it does not run the auth runtime, so the runtime `better-auth@1.6.18` you ship is unaffected. **Verify the generated `organization`/`member`/`invitation` columns match the `better-auth@1.6.18` org plugin's expected shape** (a quick `auth.api`-free diff; phase 3 stands up the real runtime against the same tables). If a column mismatch appears, regenerate by temporarily aligning the CLI's bundled core, or hand-reconcile the generated file before folding.
- **FLAG-2 (high impact):** Drizzle `pgRole(name, {createDb, createRole, inherit})` has **no** `login`, `password`, `bypassRls`, or `nosuperuser` options (verified in the 0.45.2 type defs). You can declare role *existence* with `pgRole(...).existing()` for policy `to:` targeting, but the actual `CREATE ROLE app_authenticated LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS NOCREATEDB`, the `anon` role, all `GRANT`/`REVOKE`s, and **`ALTER TABLE … FORCE ROW LEVEL SECURITY`** must be hand-written SQL in the migration. Drizzle `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`, never `FORCE`.
- **FLAG-3 (medium):** porsager `SET LOCAL` cannot bind `$1`; use `await tx`set_config('app.current_organization_id', ${orgId}, true)`` (porsager tagged-template parameterization) or the Drizzle `sql` template with a bind. Confirmed `sql.begin(cb)` / `sql.begin(optionsString, cb)` exist in `postgres@3.4.9`.
- **FLAG-4 (low):** `vitest` moved to `4.1.9`; the repo lockfile is on `4.1.8`. Stay on `4.1.8` (matrix) — no action.

## Package Legitimacy Audit

> Run via `gsd-tools query package-legitimacy check --ecosystem npm …` (2026-06-15) + `npm view` per package.

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|-------------|---------|-------------|
| `drizzle-orm` | npm | 2026-05-22 (v0.45.2) | ~11.2M/wk | github.com/drizzle-team/drizzle-orm | OK | Approved |
| `drizzle-kit` | npm | 2026-05-27 (v0.31.10) | ~9.4M/wk | github.com/drizzle-team/drizzle-orm | OK | Approved |
| `postgres` | npm | 2026-04-05 (v3.4.9) | ~10.4M/wk | github.com/porsager/postgres | OK | Approved |
| `better-auth` | npm | 2026-06-12 (v1.6.18) | ~4.15M/wk | github.com/better-auth/better-auth | SUS (`too-new`) | Approved — flag is patch-recency only; package is the decided, established dependency. No checkpoint needed (locked stack). |
| `@better-auth/cli` | npm | 2026-04-03 (v1.4.21) | ~190k/wk | github.com/better-auth/better-auth | OK | Approved (dev-only). See FLAG-1. |
| `drizzle-zod` | npm | 2026-03-27 (v0.8.3) | ~1.77M/wk | github.com/drizzle-team/drizzle-orm | OK | Approved (optional in phase 2) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `better-auth` — flagged only because v1.6.18 was published 3 days before this research; it is the locked stack dependency with ~4.15M weekly downloads and a verified repo. No `postinstall` script on any package above. No `checkpoint:human-verify` warranted (the dependency was already decided in CLAUDE.md).

## Architecture Patterns

### System Architecture Diagram

```
                          packages/db
                          ===========

  ┌─────────────────────────── schema/ ───────────────────────────┐
  │  auth-schema.ts (generated, folded)   projects.ts              │
  │  organization(+plan) user session     estadoEnum               │
  │  account verification member          projects(org_id FK)      │
  │  invitation                           pgPolicy(...) pgRole(...) │
  └───────────────────────────────┬───────────────────────────────┘
                                   │  drizzle-kit generate
                                   ▼
              migrations/0000_*.sql  (CREATE TABLE, ENABLE RLS,
                                      pgPolicy DDL, pgRole stubs)
                                   │
            + hand-appended SQL ───┤  CREATE ROLE app_authenticated/anon,
              (FLAG-2)             │  GRANTs, ALTER TABLE FORCE RLS, passwords
                                   ▼
                     ┌──────────────────────────────┐
   migration pool    │   PostgreSQL 16  (Compose)    │   docker compose up -d
   (OWNER role) ────►│   ┌────────────────────────┐  │◄── DATA-01
   drizzle-kit       │   │ tables w/ FORCE RLS     │  │
   migrate           │   │ policies: tenant + anon │  │   Redis 7 (container only)
                     │   └────────────────────────┘  │
                     └──────▲───────────────▲─────────┘
                            │               │
        withTenant(orgId,fn)│               │ withAnon(fn)
        ── BEGIN            │               │ ── BEGIN (role: anon)
           set_config(      │               │    no GUC set
            'app.current_   │               │    policies filter
             organization_  │               │    estado='publicado'
             id',$1,true)   │               │
           run fn (typed)   │               │
           COMMIT/ROLLBACK  │               │
                            │               │
                   app pool (app_authenticated, NOSUPERUSER NOBYPASSRLS, no ownership)
                            ▲               ▲
                            │               │
        Phase 3 panel ──────┘               └────── Phase 3 public web
        (orgId = session.activeOrganizationId)      (anon, published-only)

        Phase 2 consumer = the Vitest absence-test harness (DATA-04 exit gate)
        connecting as app_authenticated / anon against a dedicated test DB.
```

Data flow for the primary use case (tenant read): caller invokes `withTenant(orgIdA, fn)` → helper opens a txn on the app-role pool → first statement is `set_config('app.current_organization_id', orgIdA, true)` → `fn` runs typed Drizzle queries → every tenant table's policy compares `organization_id` to `current_setting('app.current_organization_id', true)::uuid` → rows from org B are invisible (default-deny when GUC unset/mismatched) → commit.

### Recommended Project Structure
```
packages/db/
├── drizzle.config.ts          # entities.roles:true; schema + migrations paths; uses MIGRATION/owner URL
├── src/
│   ├── schema/
│   │   ├── auth-schema.ts      # generated by BA CLI, folded (D-03) — org(+plan)/user/session/account/verification/member/invitation
│   │   ├── projects.ts         # estadoEnum + projects table (org_id FK)
│   │   ├── policies.ts         # pgPolicy() definitions (tenant + anon) linked to tables
│   │   ├── roles.ts            # pgRole(...).existing() stubs for policy `to:` targeting
│   │   └── index.ts            # re-export all tables/enums for drizzle-kit + consumers
│   ├── client.ts               # app pool (app_authenticated) + drizzle() instance; migration pool factory
│   ├── with-tenant.ts          # withTenant(orgId, fn) + withAnon(fn)
│   ├── env.ts                  # composes dbEnv preset (needs 2nd URL — see Env section)
│   └── index.ts                # public exports: db, withTenant, withAnon, schema
├── migrations/
│   ├── 0000_*.sql              # drizzle-kit generated DDL
│   └── 0000_rls.sql (or appended) # hand-written roles/GRANTs/FORCE RLS (FLAG-2)
├── auth.ts                     # minimal Better Auth config for the CLI generator (D-03), no endpoints
└── tests/
    ├── setup.ts                # apply migrations + create roles ONCE (D-08); dedicated test DB
    ├── helpers.ts              # connect-as-role, makeOrg(), makeProject()
    └── cross-tenant.test.ts    # the exit gate (D-09)
```

### Pattern 1: Better Auth offline schema generation, then fold (D-03, DATA-02)
**What:** A minimal `auth.ts` exists only so `@better-auth/cli generate` can emit the table shapes; the generated file is committed and owned thereafter by Drizzle migrations. No auth runtime in phase 2.
**When to use:** Exactly this phase. Phase 3 reuses the same `auth.ts` for the real runtime.
**Example:**
```ts
// packages/db/auth.ts  — minimal config for the CLI generator only (D-03)
// Source: better-auth@1.6.18 org plugin type defs (schema.organization.additionalFields verified);
//         drizzleAdapter re-exported from @better-auth/drizzle-adapter (provider option).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import * as schema from "./src/schema"; // on first generate this can be empty/partial

export const auth = betterAuth({
  // No baseURL/endpoints needed for `generate` — the CLI only reads config to emit schema.
  database: drizzleAdapter(/* db not required for generate */ {} as never, {
    provider: "pg",        // <- tells the CLI to emit the Drizzle Postgres generator output
    // schema,             // wire after first generation so the CLI sees existing tables
  }),
  plugins: [
    organization({
      // D-01: extend `organization` with a `plan` column so the CLI emits it.
      schema: {
        organization: {
          additionalFields: {
            plan: { type: "string", required: false }, // refine enum/notNull after fold if needed
          },
        },
      },
    }),
  ],
});
```
```bash
# Generate into the schema folder, fold, then version via Drizzle (DATA-02)
npx @better-auth/cli@1.4.21 generate --config packages/db/auth.ts \
  --output packages/db/src/schema/auth-schema.ts -y
# then: drizzle-kit generate  (emits migration)  ->  drizzle-kit migrate (owner pool)
```
> The CLI `migrate` subcommand is Kysely-only and will refuse the Drizzle adapter ("not supported") — this is intended; all DDL goes through `drizzle-kit`. (Verified in `@better-auth/cli@1.4.21` dist.)

### Pattern 2: RLS as code — and where Drizzle stops (DATA-03, FLAG-2)
**What:** Tenant policies expressed with `pgPolicy`; role *existence* with `pgRole(...).existing()`; everything Drizzle can't express (role attributes, passwords, GRANTs, `FORCE RLS`) hand-written in SQL appended to the migration.
**When to use:** Every tenant table (`organization`, `member`, `invitation`, `projects`, and any auth table you scope) and the `anon` published path.
**Example:**
```ts
// packages/db/src/schema/roles.ts
// Source: drizzle-orm@0.45.2 pg-core/roles.d.ts — pgRole(name,{createDb,createRole,inherit}); .existing()
import { pgRole } from "drizzle-orm/pg-core";
// Declared as existing because the real CREATE ROLE (with LOGIN/PASSWORD/NOBYPASSRLS) is raw SQL (FLAG-2).
export const appAuthenticated = pgRole("app_authenticated").existing();
export const anonRole = pgRole("anon").existing();
```
```ts
// packages/db/src/schema/projects.ts
// Source: drizzle-orm@0.45.2 pg-core/policies.d.ts — pgPolicy(name,{as,for,to,using,withCheck})
import { pgTable, uuid, text, pgEnum, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { appAuthenticated, anonRole } from "./roles";

export const estadoEnum = pgEnum("estado", ["borrador", "publicado", "archivado"]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")            // BA org id type — match generated column type
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  slug: text("slug").notNull(),
  estado: estadoEnum("estado").notNull().default("borrador"),
}, (t) => [
  // Tenant policy: app role only sees rows of the active org (D-05 default-deny on missing GUC)
  pgPolicy("projects_tenant", {
    as: "permissive",
    for: "all",
    to: appAuthenticated,
    using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
  }),
  // Anon policy: published-only, no tenant GUC (D-06/D-11)
  pgPolicy("projects_anon_published", {
    as: "permissive",
    for: "select",
    to: anonRole,
    using: sql`${t.estado} = 'publicado'`,
  }),
]).enableRLS();
```
```sql
-- packages/db/migrations/0000_rls.sql  (hand-appended — FLAG-2)
-- Role creation with attributes Drizzle pgRole cannot express.
-- Passwords injected from env at migrate time (do NOT commit literals); use psql vars or a templating step.
CREATE ROLE app_authenticated LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE anon            LOGIN PASSWORD :'anon_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- App role: DML on tenant tables but never ownership.
GRANT USAGE ON SCHEMA public TO app_authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_authenticated;
GRANT SELECT ON projects TO anon;           -- read-only public path
GRANT USAGE ON TYPE estado TO app_authenticated, anon;
-- (repeat appropriate GRANTs for organization/member/invitation as scoped)

-- FORCE so the table OWNER (the migration role) is ALSO subject to RLS — the owner-bypass footgun.
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
-- repeat ALTER ... FORCE ROW LEVEL SECURITY on every tenant table.
```
> `current_setting('app.current_organization_id', true)` is cast to match the `organization.id` column type. Better Auth's default `id` is **text**, so cast to `::text` (NOT `::uuid`, despite D-05's `::uuid` wording — see Pitfall 4; flag to planner). If you override BA ids to uuid, then `::uuid` is correct. Decide and be consistent.

### Pattern 3: `withTenant` / `withAnon` (DATA-03, D-04/D-05/D-06)
**What:** Transaction-scoped helpers. `withTenant` sets the GUC parameterized; `withAnon` opens a txn as the `anon` role with no GUC.
**Example:**
```ts
// packages/db/src/client.ts
// Source: postgres@3.4.9 types/index.d.ts (sql.begin); drizzle-orm/postgres-js driver.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// App pool connects DIRECTLY as app_authenticated (D-04). Anon pool connects as `anon`.
const appClient  = postgres(env.DATABASE_APP_URL);    // user=app_authenticated
const anonClient = postgres(env.DATABASE_ANON_URL);   // user=anon
export const appDb  = drizzle(appClient,  { schema });
export const anonDb = drizzle(anonClient, { schema });
```
```ts
// packages/db/src/with-tenant.ts
import { sql } from "drizzle-orm";
import { appDb, anonDb } from "./client";

export async function withTenant<T>(orgId: string, fn: (tx: typeof appDb) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    // parameterized — NEVER interpolate orgId into SET LOCAL (FLAG-3 / Specific Ideas)
    await tx.execute(sql`select set_config('app.current_organization_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export async function withAnon<T>(fn: (tx: typeof anonDb) => Promise<T>): Promise<T> {
  // No GUC set; anon policies filter estado='publicado' globally (D-06).
  return anonDb.transaction(async (tx) => fn(tx));
}
```
> `set_config(name, value, true)` with `is_local=true` is transaction-scoped — equivalent to `SET LOCAL` but accepts a bind parameter, which `SET LOCAL` does not. This is the safe injection path the CONTEXT.md Specific Ideas call out.

### Pattern 4: Two connection strings / two roles (D-04, Env)
**What:** A migration/owner URL (privileged enough to own tables, create roles, run DDL) and an app URL (`app_authenticated`). `withAnon` either uses a third `anon` URL or `SET ROLE anon` — prefer a dedicated `anon` connection string for symmetry with D-04's "connect directly as the role" principle.
**Example (env preset extension — `packages/config/env/presets.ts` currently has only `DATABASE_URL`):**
```ts
export const dbEnv = {
  server: {
    DATABASE_URL: z.string().url(),            // migration/owner role (DDL) — existing
    DATABASE_APP_URL: z.string().url(),        // app_authenticated (runtime queries)
    DATABASE_ANON_URL: z.string().url(),       // anon (public read path)
  },
} as const;
```
> The planner decides exact names (discretion). `DATABASE_URL` stays the owner/migration string for `drizzle.config.ts`; the app and anon URLs are new. Each app composes only what it uses (Phase-1 D-02 fail-fast pattern). In phase 2 only the test harness consumes these.

### Anti-Patterns to Avoid
- **Running tests/app as a superuser or `BYPASSRLS` role:** silently bypasses RLS — broken policies look like they pass; tenant leak ships. The absence test MUST connect as `app_authenticated`/`anon`, never as the owner. (CLAUDE.md "What NOT to Use".)
- **`ENABLE ROW LEVEL SECURITY` without `FORCE`:** the table owner (the migration role) bypasses policies by default. Always `FORCE` on every tenant table (FLAG-2; CLAUDE.md).
- **Session-level `SET` for the GUC:** persists on a pooled connection → cross-request tenant leak. Always `set_config(..., true)` / `SET LOCAL` inside a txn.
- **Interpolating `orgId` into `SET LOCAL`:** injection vector and `SET LOCAL` can't bind. Use `set_config(..., $1, true)`.
- **Two competing migration histories:** do NOT let `@better-auth/cli migrate` (or BA auto-migrate) write DDL. Generate only; all DDL through `drizzle-kit`. (D-03; CLAUDE.md.)
- **Neon helpers (`crudPolicy`, `authUid`):** target Neon/Supabase managed roles; this is self-hosted. Confirmed absent from the `drizzle-orm` API — use raw `pgPolicy` + `current_setting(...)`. (CLAUDE.md.)
- **`drizzle-kit push` or manual schema edits:** violates DATA-02/CLAUDE.md. `generate` + `migrate` only.
- **Per-test transaction-with-rollback:** clashes with the code-under-test's own `SET LOCAL` transactions (D-08). Create fresh orgs per test instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant isolation filtering | Manual `WHERE organization_id = ?` in every query | Postgres RLS policies + `FORCE RLS` | App-level filters are forgettable; one missed `WHERE` leaks a tenant. RLS enforces at the DB, can't be bypassed by app code. The whole phase exists to do this in the DB. |
| Auth table schema | Hand-written `user`/`session`/`organization`/`member` tables | `@better-auth/cli generate` → fold | BA's runtime (phase 3) expects exact column shapes; drift breaks login. Generate the canonical shape once. |
| Transaction-scoped tenant context | Custom connection-pool middleware that tracks current org | `set_config(..., true)` inside `db.transaction()` | Hand-rolled context on a pooled connection leaks across requests; `SET LOCAL`/`set_config(...,true)` is auto-cleared at txn end. |
| Migration versioning | Bespoke SQL-file runner | `drizzle-kit generate` + `migrate` | Checksum/ordering/journal handled; matches DATA-02 and CLAUDE.md "versioned migrations only". |
| Ephemeral test Postgres | testcontainers / a second DB path | The Compose Postgres 16 + a dedicated test DB | D-07: zero new infra, exact dev/CI parity. testcontainers would be a divergent second path. |

**Key insight:** The entire value of this phase is moving isolation OUT of application code and INTO the database. Any hand-rolled filtering reintroduces exactly the leak risk RLS exists to eliminate — and the absence test would still pass for the wrong reason (app code filtering) while the policy is broken.

## Runtime State Inventory

> This is a greenfield data-layer phase (no rename/refactor of running systems), but it does stand up new persistent state. Inventory of state this phase introduces and what depends on it:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New Postgres DB + tables (`organization`+plan, `member`, `user`, `session`, `account`, `verification`, `invitation`, `projects`). DB roles `app_authenticated`, `anon`, and an owner/migration role. | Created by Compose (DB) + Drizzle migrations + hand SQL (roles). All versioned in `packages/db/migrations`. |
| Live service config | Docker Compose service definitions for Postgres 16 + Redis 7. **No compose file exists in the repo yet** (verified — `find` returned nothing). | Author `docker-compose.yml` (or `compose.yml`) at repo root or `infra/`. Phase 4 extends it for staging; keep service names stable so phase 4 reuses them. |
| OS-registered state | None — no OS-level task/service registration in this phase. | None — verified (no daemons/launchd/systemd touched; Compose-managed only). |
| Secrets/env vars | New env vars: `DATABASE_APP_URL`, `DATABASE_ANON_URL` (in addition to existing `DATABASE_URL`); role passwords. SOPS/age encryption is INFRA-03 (phase 4) — in phase 2 these live in local `.env`/`.env.example` only. | Extend `dbEnv` preset; add to per-consumer `.env.example`. Do NOT commit real passwords. Real secret encryption is phase 4. |
| Build artifacts / installed packages | New deps in `packages/db` (`drizzle-orm`, `postgres`, `better-auth`, `drizzle-kit`, `@better-auth/cli`). Generated `auth-schema.ts` (committed). `pnpm-lock.yaml` updates. | `pnpm install`; commit lockfile + generated schema. JIT exports (Phase-1 D-05) — no `dist/`. |

**Nothing found in category:** OS-registered state — verified (this phase manages everything through Docker Compose and Drizzle migrations; no host-level registration).

## Common Pitfalls

### Pitfall 1: Owner bypasses RLS (the silent leak)
**What goes wrong:** Policies look correct, tests written against the owner/migration connection pass, but in production the app role still sees other tenants — or worse, the absence test passes because it ran as a role that bypasses RLS.
**Why it happens:** A table's owner bypasses RLS by default; `ENABLE ROW LEVEL SECURITY` alone does not subject the owner. Drizzle `.enableRLS()` emits only `ENABLE`, never `FORCE`.
**How to avoid:** `ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant table (raw SQL), AND run the absence test strictly as `app_authenticated`/`anon` (never the owner). Add an assertion in test setup that the test connection role has `rolbypassrls = false` and `rolsuper = false`.
**Warning signs:** Absence test passes immediately without any policy; `SELECT current_user` in the test returns the owner; org B rows appear when querying as owner.

### Pitfall 2: GUC type mismatch (uuid vs text)
**What goes wrong:** Policy `current_setting('app.current_organization_id', true)::uuid` errors or never matches because Better Auth's `organization.id` is `text`, not `uuid`.
**Why it happens:** D-05 wrote `::uuid` assuming uuid PKs, but BA's default id type is a text string. `projects.organization_id` must match the generated `organization.id` type.
**How to avoid:** Inspect the generated `auth-schema.ts` for the `organization.id` column type. If text, cast `::text` in policies and type `projects.organization_id` as `text`. If you configure BA to use uuid ids, then `::uuid` everywhere. Pick one and be consistent across schema + policies + helpers. (Flag to planner — this resolves D-05's `::uuid` wording against API reality.)
**Warning signs:** `invalid input syntax for type uuid` at query time, or tenant filter matching nothing.

### Pitfall 3: `@better-auth/cli` version skew vs runtime `better-auth`
**What goes wrong:** Generated columns don't match what `better-auth@1.6.18` expects at runtime in phase 3 (login/org creation fails).
**Why it happens:** CLI `1.4.21` bundles `better-auth@1.4.21`; the org plugin schema could differ from 1.6.18.
**How to avoid:** After generating, diff the emitted `organization`/`member`/`invitation`/`session` columns against the `better-auth@1.6.18` org plugin shape (the `$Infer` types / docs). Reconcile by hand in `auth-schema.ts` before folding if needed. Phase 3 must validate the real runtime against these exact tables.
**Warning signs:** Missing/renamed columns (e.g. `activeOrganizationId` on `session`, `metadata` on `organization`) between generated file and 1.6.18 expectations.

### Pitfall 4: Pooled-connection GUC leak
**What goes wrong:** One request's tenant context bleeds into another on a reused pooled connection.
**Why it happens:** `SET` (session-level) instead of `SET LOCAL`/`set_config(...,true)`.
**How to avoid:** Always set the GUC inside `db.transaction()` with `is_local=true`. Never set it outside a txn. The `withTenant` helper is the only place the GUC is set.
**Warning signs:** Intermittent cross-tenant reads under concurrency; a query outside any txn seeing the previous request's org.

### Pitfall 5: Anon path accidentally tenant-scoped (or accidentally seeing drafts)
**What goes wrong:** `withAnon` sees nothing (because a tenant policy requires the GUC) or sees `borrador` projects (policy too loose).
**Why it happens:** `anon` lacks a permissive published-only policy, or the published policy isn't restricted to `select`/`estado='publicado'`.
**How to avoid:** A dedicated `anon` policy `for: 'select'`, `to: anonRole`, `using: estado = 'publicado'`, and GRANT only SELECT to `anon`. Absence-test case (d) asserts `anon` sees `publicado` but not `borrador`.
**Warning signs:** Public page empty, or draft projects leaking publicly.

## Code Examples

(Verified patterns are inline in Architecture Patterns 1–4 above, sourced from the pinned packages' type definitions: `drizzle-orm@0.45.2` `pg-core/policies.d.ts` + `roles.d.ts`, `postgres@3.4.9` `types/index.d.ts`, `@better-auth/cli@1.4.21` dist option strings, `better-auth@1.6.18` org plugin `schema.organization.additionalFields`.)

### Docker Compose (DATA-01)
```yaml
# compose.yml (repo root) — no compose file exists yet (verified)
services:
  postgres:
    image: postgres:16-alpine        # pinned; do not float to 17/18
    environment:
      POSTGRES_USER: imbau           # owner/migration role
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-dev}
      POSTGRES_DB: imbau
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U imbau -d imbau"]
      interval: 5s
      timeout: 3s
      retries: 10
  redis:
    image: redis:7-alpine            # container only this phase
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  pgdata:
```
> **Port note (from user memory):** another local project (CLINICAL) owns host ports 3000/3001 (web/panel) — not relevant to Postgres/Redis, but the planner should confirm 5432/6379 are free locally or expose alt host ports.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| App-level `WHERE org_id=?` filtering | DB-enforced RLS policies as code | Drizzle native `pgPolicy`/`pgRole` (≥0.33, stable in 0.45) | Isolation can't be bypassed by forgotten WHERE clauses. |
| BA auto-migrate at runtime | Generate schema offline, own it in Drizzle migrations | Standard for Drizzle adapter (BA `migrate` is Kysely-only) | Single migration history; no two systems writing DDL. |
| `SET LOCAL` string-built | `set_config(name, $1, true)` parameterized | porsager driver param limitation | No injection in tenant context. |
| testcontainers per suite | Reuse Compose/CI Postgres service, dedicated test DB | D-07 decision | One DB path dev↔CI; no divergence. |

**Deprecated/outdated:**
- Turborepo `pipeline` key → `tasks` (already handled in phase 1 `turbo.json`).
- Neon `crudPolicy`/`authUid` → raw `pgPolicy` (self-hosted).

## Validation Architecture

> `workflow.nyquist_validation` is `false` in config, so the formal Nyquist test-map is not required. However, the cross-tenant absence test **is the milestone exit gate (DATA-04)**, so its architecture is specified concretely here.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.8` (already in root devDeps + `@vitest/coverage-v8@4.1.8`) |
| Config file | `vitest.config.ts` (root, exists) — package tests discovered per-package via Turbo `test` task |
| Quick run command | `pnpm --filter @imbau/db test` |
| Full suite command | `pnpm test` (turbo) |
| DB target | Compose Postgres 16, dedicated test DB (e.g. `imbau_test`) — D-07; same config swapped to GH Actions Postgres service in phase 4 (CI-02) |

### Harness architecture (D-07/D-08/D-09)
- **Suite-level setup (`tests/setup.ts`), run ONCE:**
  1. Connect as the **owner** role to a clean dedicated test DB (`imbau_test`); drop/create it if needed.
  2. Apply Drizzle migrations programmatically (`migrate(drizzle(ownerClient), { migrationsFolder })`) — same migrations as prod.
  3. Run the hand-written roles SQL (create `app_authenticated`/`anon`, GRANTs, `FORCE RLS`) — or include it in the migration so step 2 covers it (preferred: one path).
  4. Build per-role clients: `appClient` (user=`app_authenticated`), `anonClient` (user=`anon`). Assert `rolsuper=false` and `rolbypassrls=false` for both (guards Pitfall 1).
- **Per-test fixtures (no rollback — D-08):** each test inserts its own org A and org B with unique slugs + a `publicado` and a `borrador` project each, via the **owner** connection (bypassing policies is fine for *seeding*; the *assertions* run as app/anon).
- **Parametrize endpoint by env:** read `DATABASE_URL`/`DATABASE_APP_URL`/`DATABASE_ANON_URL` from env so phase 4 points the same tests at the CI Postgres service.

### Exit-gate assertions (DATA-04 / D-09)
| Case | Setup | Assertion |
|------|-------|-----------|
| (a) Read isolation A→B | `withTenant(orgA)` | `select * from projects` returns **only** org A rows; **zero** org B rows (count of B == 0, absence). Repeat for every tenant table seeded. |
| (b) Mirror B→A | `withTenant(orgB)` | Sees only org B; zero org A. |
| (c) Cross-tenant write fails | `withTenant(orgA)` | INSERT a project with `organization_id = orgB` **throws** (`withCheck` violation); UPDATE of an org B row affects **0 rows** / throws. |
| (d) Anon published-only | `withAnon()` | Sees `publicado` projects across orgs; **zero** `borrador` projects. |
| (guard) Role identity | setup | `select current_user` == `app_authenticated`/`anon`; `rolbypassrls=false`. |

### Wave 0 gaps
- [ ] `packages/db/tests/setup.ts` — programmatic migrate + role creation + per-role clients (no infra exists yet)
- [ ] `packages/db/tests/helpers.ts` — `connectAs(role)`, `makeOrg()`, `makeProject(orgId, estado)`
- [ ] `packages/db/tests/cross-tenant.test.ts` — the 4 absence cases + role guard
- [ ] `compose.yml` — Postgres 16 + Redis 7 (no compose file in repo)
- [ ] `packages/db` deps install + `drizzle.config.ts`

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, block-on `high`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | Only BA *tables* generated here; no auth runtime (phase 3). Password storage is BA's concern in phase 3. |
| V3 Session Management | no | `session` table shape only; no session handling this phase. |
| V4 Access Control | **yes (core)** | Tenant isolation via RLS `FORCE` + dedicated NOSUPERUSER/NOBYPASSRLS roles; anon limited to `publicado`. This is the phase's entire security thesis. |
| V5 Input Validation | partial | Tenant `orgId` injected via parameterized `set_config` (no SQL injection in GUC). Zod at the tRPC boundary is phase 3. |
| V6 Cryptography | no | No crypto in phase 2. Role passwords are infra secrets (SOPS = phase 4). |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data read (broken/absent policy) | Information Disclosure | `FORCE ROW LEVEL SECURITY` + tenant policy + absence tests as app role |
| Owner-bypass leak | Elevation/Information Disclosure | `FORCE RLS`; app never connects as owner/superuser/BYPASSRLS |
| Pooled-connection context bleed | Information Disclosure | `set_config(..., true)` inside a txn; never session `SET` |
| SQL injection in tenant context | Tampering | Parameterized `set_config('app.current_organization_id', $1, true)` |
| Draft project leaking publicly | Information Disclosure | `anon` policy `using estado='publicado'`; SELECT-only GRANT |
| Cross-tenant write | Tampering | `withCheck` on tenant policy; cross-tenant INSERT/UPDATE fails (D-09 case c) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Better Auth's default `organization.id` (and other ids) are **text**, so policies cast `::text` and `projects.organization_id` is `text`. | Pattern 2, Pitfall 2 | If ids are uuid, casts/types must be `::uuid` (D-05's wording). **Verify against the generated `auth-schema.ts` before writing policies.** Low effort to confirm; high impact if wrong. |
| A2 | `@better-auth/cli@1.4.21` generates org-plugin columns compatible with `better-auth@1.6.18`'s runtime. | FLAG-1, Pitfall 3 | If the org plugin schema changed between 1.4 and 1.6, phase-3 login/org-creation breaks. Mitigate by diffing generated columns vs 1.6.18 `$Infer` shapes before folding. |
| A3 | `set_config(name, value, true)` inside a Drizzle `db.transaction()` over the porsager driver is transaction-local (clears at COMMIT/ROLLBACK). | Pattern 3 | If misconfigured (autocommit/no real txn), GUC could persist on pooled conn. Verified `sql.begin`/`transaction` exist; behavior is standard Postgres `set_config` semantics. |
| A4 | Compose host ports 5432/6379 are free locally. | Compose example | Port clash blocks `docker compose up`. User memory notes 3000/3001 owned by another project (not DB/Redis ports). Planner should confirm or remap. |
| A5 | Role passwords can be injected at migrate time without committing literals (psql vars / templating). | Pattern 2 SQL | If the migration must contain literal passwords, that's a secret-in-repo issue (SOPS is phase 4). Planner should choose a no-literal injection mechanism for the roles SQL. |

## Open Questions

1. **uuid vs text for ids (A1)**
   - What we know: BA default ids are text; D-05 wrote `::uuid`.
   - What's unclear: whether the team wants to override BA to uuid ids in phase 2.
   - Recommendation: keep BA's default text ids in phase 2 (least friction), cast `::text`; revisit uuid override only if a later phase needs it. Flag the `::uuid`→`::text` reconciliation to the planner explicitly.

2. **Where the roles/GRANTs/`FORCE` SQL lives**
   - What we know: Drizzle can't emit it (FLAG-2); it must be raw SQL.
   - What's unclear: appended into the generated `0000_*.sql` vs a separate ordered migration file vs a custom Drizzle migration.
   - Recommendation: a dedicated migration file in the same Drizzle journal (so `migrate` applies it in order and tests use the exact same path). Keep it ONE history (DATA-02). Discretion within `packages/db` layout.

3. **`withAnon` role selection: dedicated connection vs `SET ROLE`**
   - What we know: D-04 prefers connecting directly as the role.
   - Recommendation: a dedicated `anon` connection string (`DATABASE_ANON_URL`) for symmetry; avoids `SET ROLE` complexity. Discretion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + Compose | DATA-01 (Postgres/Redis) | unverified (not probed this session) | — | None — required; planner adds a verify step / human checkpoint |
| Node.js 22 | toolchain | ✓ (engines `>=22`, repo running) | per `.nvmrc`/engines | — |
| pnpm 11.6.0 | workspace | ✓ (`packageManager` pinned, lockfile present) | 11.6.0 | — |
| PostgreSQL 16 | DB | via Compose image (not a host install) | 16-alpine | None |
| Redis 7 | container only | via Compose image | 7-alpine | None |

**Missing dependencies with no fallback:** Docker/Compose availability was not probed; the planner should add an early task to confirm `docker compose version` works on the dev machine (it is the only hard external dependency for DATA-01/DATA-04).
**Missing dependencies with fallback:** none.

## Sources

### Primary (HIGH confidence) — verified this session against pinned package artifacts
- `drizzle-orm@0.45.2` type defs (`pg-core/policies.d.ts`, `pg-core/roles.d.ts`, `pg-core/table.d.ts`) — `pgPolicy`/`pgRole` signatures, `PgRoleConfig` lacks login/bypassrls, `.enableRLS()` (no FORCE), no `crudPolicy`/`authUid`.
- `postgres@3.4.9` type defs (`types/index.d.ts`) — `sql.begin(cb)`/`sql.begin(opts, cb)`, `TransactionSql.savepoint`, `sql.reserve()`.
- `@better-auth/cli@1.4.21` dist — `generate` flags (`--config`, `--output`, `-y`), drizzle generator (`adapter.id`+`provider`), default `auth-schema.ts`, `migrate` Kysely-only.
- `better-auth@1.6.18` org plugin type defs — `schema.organization.additionalFields` (the `plan` column path), `activeOrganizationId`/`metadata`, drizzle adapter re-export with `provider`.
- npm registry (`npm view <pkg> version time.modified`, 2026-06-15) — confirmed pinned versions; `@better-auth/cli` latest = 1.4.21 (not 1.6.x); `vitest` latest = 4.1.9.
- `gsd-tools query package-legitimacy check` (2026-06-15) — verdicts/downloads/repos for all six packages.

### Secondary (MEDIUM confidence)
- CLAUDE.md "Technology Stack", "RLS + Auth integration", "What NOT to Use", "Version Compatibility Matrix" (research 2026-06-12) — cross-checked against the primary type-def evidence above; consistent except the CLI-version and `pgRole`-capability realities flagged here.
- modelo-mvp.md §3.1/§3.3 — logical data model + RLS-per-tenant rule + anon→publicado.

### Tertiary (LOW confidence)
- None — no WebSearch was used (all search providers disabled in config). Findings rest on direct package artifacts + project docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm; pins match `latest` (except CLI track + vitest patch, both flagged).
- Architecture / RLS APIs: HIGH — `pgPolicy`/`pgRole`/`enableRLS`/`set_config`/`sql.begin` all read directly from pinned type defs; FORCE-RLS and role-attribute gaps confirmed.
- Better Auth offline generation: MEDIUM-HIGH — CLI flags and drizzle-generator behavior verified from dist; the 1.4↔1.6 schema-parity (A2) needs a diff at implementation time.
- Pitfalls: HIGH — derived from CLAUDE.md footguns corroborated by the API evidence.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable pinned stack; re-check `@better-auth/cli` track and `better-auth` patch before phase 3 runtime work)
