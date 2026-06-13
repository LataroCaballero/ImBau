# Project Research Summary

**Project:** ImBau — Showroom 3D para preventa en pozo (milestone v1 = fase 0: fundación)
**Domain:** Multi-tenant SaaS foundation (monorepo, CI/CD, staging, observabilidad, auth + RLS)
**Researched:** 2026-06-12
**Confidence:** HIGH

## Executive Summary

ImBau phase 0 builds the foundation for a multi-tenant real-estate presale SaaS: pnpm/Turborepo monorepo, Docker Compose + Traefik staging, GitHub Actions CI/CD, Better Auth with organization plugin, Postgres 16 + Drizzle with RLS-based tenant isolation, and basic observability (Sentry, pino → Loki, Uptime Kuma). The stack is pre-decided; research confirms exact versions (verified against npm 2026-06-12), verifies the compatibility matrix, and prescribes the critical wiring patterns. The product's credibility pitch — "tenant isolation, provable" and "operable from day one" — sets a foundation bar deliberately higher than a typical throwaway MVP.

The recommended approach: build in strict dependency order — shared config, then DB + RLS (highest risk, must come before any app code), then auth, then the tRPC API seam, then both Next.js apps + worker stub, then full Compose + Traefik topology, then observability, then CI/CD. The keystone decision is transaction-scoped `SET LOCAL` for the Postgres tenant GUC channeled through a single `withTenant()` helper — this must be established before any application code and verified by cross-tenant absence tests running as the non-owner app role.

The two meta-risks are: (1) RLS integration — silently bypassed policies (table owner exemption, wrong DB role, session-scoped GUC), broken auth behind Traefik, and the Let's Encrypt rate-limit trap — each has a clear mechanical fix documented in PITFALLS.md; and (2) scope creep — phase 0 must fit in ~3-4 days; OTel tracing dashboards, BullMQ job logic, media pipeline, PgBouncer, and custom-domain TLS are explicitly deferred.

## Key Findings

### Recommended Stack

Stack is pre-decided (CLAUDE.md / modelo-mvp.md §3.2). Research pinned current versions and flagged two early decisions: **pin TypeScript 5.9.x (NOT 6.x)** until the tool matrix confirms support, and **pin ESLint 9.x flat config** (ESLint 10 + typescript-eslint stability unconfirmed). Keep ALL DDL in one Drizzle migration history — fold Better Auth's generated schema into `packages/db`, never run two migration systems.

**Core technologies (pinned versions, verified against npm 2026-06-12):**

| Package | Version | | Package | Version |
|---------|---------|-|---------|---------|
| pnpm | 11.6.0 | | Drizzle ORM | 0.45.2 |
| Turborepo | 2.9.18 | | Drizzle Kit | 0.31.10 |
| TypeScript | 5.9.x (NOT 6.x) | | postgres (porsager) | 3.4.9 |
| Node.js | 22 LTS | | Better Auth | 1.6.18 |
| Next.js | 16.2.x | | BullMQ | 5.78.0 |
| React | 19.2.x | | ioredis | 5.11.1 |
| tRPC | 11.17.0 | | pino | 10.3.1 |
| TanStack Query | 5.101.0 | | @sentry/nextjs | 10.57.0 |
| Zod | 4.4.x | | Vitest / Playwright | 4.1.8 / 1.60 |

**RLS integration pattern (the load-bearing decision):** dedicated NOSUPERUSER/NOBYPASSRLS roles (`app_authenticated` + `anon`), transaction-scoped `set_config('app.current_org_id', orgId, true)` (SET LOCAL, pool-safe) fed from Better Auth's `activeOrganizationId`, and `pgPolicy`/`pgRole` in the Drizzle schema with `entities.roles: true`.

### Expected Features

**Must have (table stakes for a phase-0 foundation):**
- Provable tenant isolation — RLS isolation tests in CI against a real Postgres (a mocked DB cannot prove policies)
- Better Auth org plugin full membership lifecycle: orgs, members, invitations with expiry; map default roles to owner/developer/viewer via `createAccessControl`
- CI gates: lint + type-check + tests (with Postgres service for RLS tests); auto-deploy staging on merge to main, manual prod
- Observability from first deploy: Sentry (incl. `onRequestError` for RSC), pino structured logs → Loki, Uptime Kuma

**Should have (differentiators of a strong foundation):**
- Cross-tenant *absence* tests run as the app role (not superuser) — the milestone's acceptance gate
- Migrations run before container swap in deploy; `pg_policies` verified after migrate

**Defer (later milestones — phase 0 risk is gold-plating, not under-building):**
- Backups/PITR + restore rehearsal (pre-first-paying-client), full OTel tracing dashboards, BullMQ job logic (stub `apps/worker` as deployable shell), PgBouncer, media pipeline, custom-domain on-demand TLS, SOPS rotation

### Architecture Approach

The package graph IS the architecture: dependencies point strictly downward — apps → `packages/api` → (`db`, `quoting`, `ui`) → `config`. `packages/api` is the single seam holding tRPC routers + context + RLS middleware + the Better Auth instance, imported identically by both Next.js apps and the worker. No app imports another app. Tenant context flow is explicit and verifiable: Better Auth `session.activeOrganizationId` → tRPC `protectedProcedure` re-validates membership → `withTenant(orgId)` in `packages/db` → `current_setting('app.org_id')` in the RLS policy → rows filtered by the database, not by app `where` clauses. Public `apps/web` uses only the anon path limited to `publicado` projects and carries no auth client.

**Major components:**
1. `packages/config` — shared tsconfig/ESLint/Zod env schema (everything depends on it)
2. `packages/db` — Drizzle schema, roles, RLS policies, `withTenant()` helper, migrations (single DDL source of truth incl. Better Auth tables)
3. `packages/api` — tRPC routers/context + Better Auth instance + RLS middleware
4. `apps/panel` / `apps/web` / `apps/worker` — Next.js apps + BullMQ stub, multi-stage Dockerfiles via `turbo prune`
5. Infra — Docker Compose: Traefik (TLS), web, panel, worker, Postgres, Redis, Loki/Grafana, Uptime Kuma
6. CI/CD — GitHub Actions: gates → Docker build → registry → VPS deploy (non-root) → migrate-before-swap

### Critical Pitfalls

1. **RLS silently bypassed by table owner/superuser** — app must connect as non-owner role; `FORCE ROW LEVEL SECURITY` on every tenant table; never test as superuser
2. **Session-scoped tenant context leaks across pooled connections** — always `SET LOCAL` inside a transaction via `withTenant()`; never session-level `SET`
3. **`drizzle-kit push` silently drops RLS policies** — use `generate` + `migrate` only (also mandated by CLAUDE.md); verify `pg_policies` after migrating
4. **Better Auth behind Traefik** — two opposite failure modes: wrong derived base URL (cookies/OAuth break) vs blindly trusting `X-Forwarded-*` (forgery); also reconcile org-plugin `member` table with the planned `memberships` table
5. **Let's Encrypt rate limits** — use LE staging CA during setup; persist `acme.json` with mode 600
6. **Over-engineering phase 0** — master doc's hard control rule: if phase 0 exceeds one week, recalibrate; defer everything not in the Active requirements list

## Implications for Roadmap

Based on research, suggested phase structure (6 phases):

### Phase 1: Monorepo Foundation + Shared Config
**Rationale:** Prerequisite for all compilation; everything imports `packages/config`
**Delivers:** Workspace graph, tsconfig, ESLint 9 flat config, Zod env schema, stub package skeletons
**Avoids:** TypeScript 6 / ESLint 10 toolchain churn (pin TS 5.9, ESLint 9)

### Phase 2: Data Layer — Postgres, Drizzle, RLS
**Rationale:** Highest-risk unit; retrofitting RLS is a rewrite, so it precedes ALL app code
**Delivers:** Docker Compose (PG16 + Redis), two DB roles, schema, `withTenant()` helper, RLS policies + FORCE RLS, cross-tenant absence tests
**Avoids:** Pitfalls 1, 2, 3 (owner bypass, GUC leak, push dropping policies)

### Phase 3: Auth + API Layer
**Rationale:** Depends on DB schema; provides the session → org → tenant-tx seam for all apps
**Delivers:** Better Auth org plugin (sessions, roles owner/developer/viewer, invitations), tRPC `createContext`, secrets handling
**Avoids:** Pitfall 4 (dual migration systems, member/memberships drift)

### Phase 4: App Surfaces + Worker Skeleton
**Rationale:** Thin vertical proof that the seam works end-to-end
**Delivers:** `apps/panel` (login + one RLS-protected query), `apps/web` (one anon-role page), `apps/worker` stub; multi-stage Dockerfiles with `turbo prune` + Next standalone

### Phase 5: Compose Topology, Traefik TLS, Observability
**Rationale:** Staging must exist before CI can deploy to it
**Delivers:** Full Compose with Traefik (LE staging CA first), Sentry with `onRequestError`, pino → Loki, Uptime Kuma
**Avoids:** Pitfall 5 (LE rate limits), Sentry losing RSC errors

### Phase 6: CI/CD — Gate + Auto-Deploy to Staging
**Rationale:** Closes the loop: every merge to main ends deployed
**Delivers:** GitHub Actions: lint+typecheck+tests (Postgres service for RLS tests) → Docker build → registry → VPS deploy (non-root) → migrate-before-swap

### Phase Ordering Rationale

- Strict dependency order from the package graph: config → db → auth/api → apps → infra → pipeline
- RLS before any app code — retrofitting is a rewrite; the isolation test is the milestone exit gate
- Observability and CI/CD are part of definition of done ("operable from day one"), not deferred polish

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Drizzle + RLS):** `pgPolicy`/`pgRole` API relatively new; `entities.roles: true` easy to miss; `push` vs `generate`+`migrate` high-stakes
- **Phase 3 (Better Auth + tRPC):** org plugin API evolving; `member` vs `memberships` reconciliation needs explicit decision; Traefik proxy header trust
- **Phase 4 (Dockerfiles):** `turbo prune --docker` + `output: 'standalone'` + `outputFileTracingRoot` + `transpilePackages` has documented failure modes

Phases with standard patterns (skip research-phase):
- **Phase 1:** standard pnpm + Turborepo official patterns
- **Phase 5:** standard Compose + Traefik ACME + Sentry official docs
- **Phase 6:** GitHub Actions + Turborepo cache + Docker Buildx well-established

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions queried against live npm; patterns from official docs |
| Features | HIGH | Grounded in PROJECT.md + modelo-mvp.md; corroborated by SaaS norms |
| Architecture | HIGH | Verified Postgres SET LOCAL semantics; standard Turborepo/tRPC layout |
| Pitfalls | HIGH (RLS/Drizzle/Traefik/Sentry) / MEDIUM (Better Auth proxy specifics) | Better Auth API still evolving |

**Overall confidence:** HIGH

### Gaps to Address

- Better Auth org plugin API stability — re-verify exact options/invitation-email wiring (Resend handler) against pinned 1.6.x at Phase 3 implementation time
- Deploy mechanism to shared VPS: SSH push vs self-hosted runner — pick one during Phase 6 planning and isolate from existing `andescode.com.ar`
- Whether Better Auth's adapter holds a separate privileged connection from the RLS-scoped app pool — confirm during Phase 3
- TypeScript 6.x adoption — revisit after phase 0 is stable

## Sources

### Primary (HIGH confidence)
- PostgreSQL docs — Row Security Policies
- Drizzle ORM docs — RLS (`pgPolicy`, `pgRole`, entities.roles)
- Better Auth docs — Organization plugin, Drizzle adapter
- Turborepo docs — Docker guide (`turbo prune`)
- Traefik docs — ACME certificate resolvers
- npm registry (versions, queried 2026-06-12)

### Secondary (MEDIUM confidence)
- Bytebase — Postgres RLS Footguns
- Nile / Permit.io / Rico Fritzsche — multi-tenant RLS guides
- Mortadha — Supabase-style RLS with Drizzle + tRPC middlewares
- PlanetScale — "RLS sounds great until it isn't"

---
*Research completed: 2026-06-12*
*Ready for roadmap: yes*
