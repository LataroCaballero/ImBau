# Feature Research

**Domain:** Production-grade multi-tenant SaaS foundation (phase 0) — solo-operated, AI-first build, Argentina real-estate presale showroom
**Researched:** 2026-06-12
**Confidence:** HIGH

> Scope note: This file covers the **technical foundation** (phase 0) only — auth, tenancy, RLS isolation, CI gates, deploy pipeline, observability. It does NOT cover product/user features (building explorer, quoting engine, panel, leads); those are later milestones. "Features" here means *foundation capabilities*.
>
> Framing note: The general industry advice for solo founders is "skip CI/CD and observability until you have demand." This project **deliberately rejects that** (CLAUDE.md: "el código es la carta de presentación"; PROJECT.md discards PocketBase). The product *sells* "disponibilidad y precios en tiempo real" and benchmarks against Hauzd — a foundation that can't prove tenant isolation or notice its own outages would undercut the pitch. So the bar here is higher than a throwaway MVP, and "over-engineering" is judged against *that* bar, not against a generic micro-SaaS. The real risk at phase 0 is not under-building the foundation; it is gold-plating it past what one operator can run in 3-4 days.

## Feature Landscape

### Table Stakes (Foundation fails its purpose without these)

Capabilities a production multi-tenant SaaS foundation must have. Missing any = the foundation is not the thing it claims to be.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Monorepo skeleton (pnpm + Turborepo)** — apps `web`/`panel`/`worker`, packages `db`/`api`/`quoting`/`ui`/`config` as empty-but-wired stubs | Every later phase imports from these; without the boundaries, later work has nowhere to land | MEDIUM | Stubs only — real logic comes later. Get the dependency graph and `turbo` task pipeline right now; it is painful to refactor once code exists. |
| **Strict TypeScript + lint + format config (shared `packages/config`)** | Quality standard is non-negotiable; `any`-free strictness is hard to retrofit | LOW | `tsconfig` base + ESLint/Biome flat config + Prettier, consumed by all packages. One source of truth. |
| **CI pipeline that blocks merge: lint → type-check → unit tests → coverage gate** | "CI roja = no merge" is a stated rule; the quoting engine demands 100% coverage later | MEDIUM | GitHub Actions, pnpm cache, turbo remote/local cache. Coverage threshold enforced even though phase-0 code is thin — establishes the gate before code lands. |
| **Better Auth: email/password sessions** | No app surface works without authenticated users | MEDIUM | Server + client plugin wiring. Sessions in Postgres (same DB), httpOnly cookies. |
| **Better Auth organization plugin: orgs + memberships + roles (owner/developer/viewer)** | Multi-tenancy is "what turns service-per-project into SaaS"; roles gate the panel | MEDIUM | Map Better Auth default `owner/admin/member` to project's `owner/developer/viewer` via custom roles. A user can belong to many orgs — model accordingly. |
| **Email invitations to an org (with expiry + pre-assigned role)** | Onboarding a developer's team without manual DB edits; required for self-service later | MEDIUM | Better Auth handles the lifecycle (default 48h expiry). Needs Resend + React Email wired to send the invite. Depends on org plugin. |
| **Postgres 16 + Drizzle migrations (versioned, in-repo)** | "Nunca cambios manuales al schema"; reproducible DB across staging/prod | MEDIUM | `drizzle-kit` generate + migrate. `pnpm db:migrate` / `db:seed` commands. Migrations run in CI and on deploy. |
| **RLS tenant isolation: policies on every tenant table, `FORCE ROW LEVEL SECURITY`, non-superuser app role** | The core promise — "aislamiento verificable por RLS". This is the differentiator's foundation. | HIGH | See PITFALLS. App connects as a **non-owner, non-superuser** role with `FORCE RLS`. Tenant context via `SET LOCAL` inside a transaction (never `SET`), so pooled connections don't leak. Secure-by-default: no context → zero rows. |
| **`anon` read role limited to `publicado` projects** | Public web must read published projects only, never drafts/other tenants | MEDIUM | Separate Postgres role with policies allowing read of `estado = 'publicado'` rows. Anonymous insert (events/leads) deferred to later phases but role boundary set now. |
| **RLS isolation tests in CI (proof, not assertion)** | "Verificable por RLS" must be *verified* — a test that a tenant cannot read another's rows | MEDIUM | Integration tests against a real Postgres (testcontainer or compose). This is the single most valuable phase-0 test — it guards the product's central claim. |
| **Docker Compose: Postgres + Redis + app services, one command** | "Levantando con un comando"; staging and local must be reproducible | MEDIUM | `docker compose up -d`. Redis present even if BullMQ jobs come later — establishes the topology. |
| **Auto-deploy to staging on merge to main** | "Cada commit a main termina en software corriendo en staging" — the core value of this milestone | HIGH | Build Docker images → registry → VPS pull + restart via Traefik. Traefik for TLS. Hardest-to-debug part (DNS/TLS/registry auth) — budget time. |
| **Manual promotion to prod (gate)** | Prod must not deploy on every merge; separation of staging/prod | LOW | GitHub Actions `workflow_dispatch` / environment protection. Prod VPS itself deferred until first paying client (PROJECT.md). |
| **Error tracking (Sentry)** | "Errores observables, nunca silenciados"; a realtime SaaS can't learn of outages via client WhatsApp | LOW | Free tier sufficient. Wire into web/panel/worker. Source maps in CI. |
| **Structured logs (pino) → centralized (Grafana/Loki)** | Debugging integration issues (the part AI doesn't compress) needs queryable logs | MEDIUM | pino JSON logs, shipped to Loki in compose. Request/tenant context in log fields. |
| **Uptime monitoring (Uptime Kuma)** | Knowing staging is down before a demo or client does | LOW | Self-hosted in compose; HTTP checks on web/panel. |
| **Secrets management (not committed plaintext)** | Staging/prod secrets must not live in the repo as plaintext | MEDIUM | SOPS/age (per modelo-mvp §3.5). Establishes the pattern before prod secrets exist. |

### Differentiators (What makes THIS foundation strong)

Not strictly required to "boot," but they are why this foundation outclasses a typical MVP scaffold and directly serve the product's pitch.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **RLS as the *primary* isolation guarantee (not app-layer `WHERE`)** | Even raw SQL / a forgotten filter can't leak across tenants — the isolation is provably at the DB. This is what lets the pitch say "verificable". | HIGH | App-layer tenant filtering is the readable primary path; RLS is the unbypassable safety net (defense in depth). |
| **Reproducible env: staging ≡ prod via same compose** | "Funciona en mi máquina" is structurally impossible; new tenant = a DB row, not a deploy | MEDIUM | Same images, different secrets/domains. Pays off every later phase. |
| **Observability from the *first* deploy, with tenant/request context** | Day-one operability; a "tiempo real" product that notices its own failures first | MEDIUM | Sentry + structured logs + uptime together, not bolted on at the end. Tenant id propagated into traces/logs. |
| **Coverage gate live before product code** | The quoting engine's mandated 100% coverage has a home from day zero; quality is structural, not aspirational | LOW | Establishing the gate now means it is never "added later" (which never happens). |
| **Traefik TLS on-demand topology pre-wired** | Custom client domains via CNAME later cost zero infra change | MEDIUM | The mechanism need not be exercised in phase 0, but the routing shape should not need rework. |
| **AI-first repo conventions encoded (CLAUDE.md, Conventional Commits, `fase-N/` branches)** | Lets Fable generate consistent, reviewable code at speed during the temporary window | LOW | Conventions-as-config. Cheap to set up, compounding payoff. |

### Anti-Features (Tempting at phase 0, but wrong here)

Things that look like "good engineering" but would burn the 3-4 day budget or add operational weight a solo operator can't carry yet.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Schema- or database-per-tenant isolation** | "Strongest" isolation; some guides push it | Operational explosion for a solo op (N migrations, N backups, connection sprawl); contradicts "new project = a DB row" | Shared schema + RLS (already the decision). Revisit only at enterprise scale. |
| **Provisioning the dedicated prod VPS now** | "Be ready for the first client" | No paying client yet; doubles infra to maintain during the densest build window | Staging-only on existing VPS (PROJECT.md). Stand up prod when first client signs. |
| **Full backups + rehearsed PITR restore in phase 0** | "A backup not tested doesn't exist" (true!) | Real value only when there is real data; staging data is reproducible from seed | Defer to before first paying client (modelo-mvp §3.5 already places it there). Note the requirement, don't build it. |
| **Kubernetes / autoscaling / microservices** | "Scale like Hauzd" | Massive operational tax for zero current traffic; the monorepo is a modular monolith by design | Docker Compose + Traefik on a VPS. Scale vertically until metrics demand otherwise. |
| **OpenTelemetry distributed tracing fully built out** | Stack lists OTel | Full tracing pipeline is heavy; little to trace with stub apps | Sentry covers errors/perf now. Add OTel spans incrementally as real request paths (explorer, quoting) appear. Wire the SDK, don't over-instrument. |
| **SSO / OAuth providers / 2FA / passkeys** | "Enterprise auth" | Developers onboard via email invite; no enterprise buyer at MVP | Email/password + org invitations. Better Auth makes adding providers cheap later. |
| **Brokers as login users** | Data model contemplates brokers | "Brokers no loguean en MVP" (modelo-mvp §3.2) — modeling membership is enough | Membership schema accommodates them; no auth flow built now. |
| **Anonymous event/lead ingestion endpoints + rate limiting** | Public web will need them | Belongs to phases with public web (2/5); building the edge rate-limit now is premature | Set the `anon` role boundary; build ingestion when the public surface exists. |
| **Feature flags / A-B infra / multi-region** | "Mature SaaS has these" | Solo op, single region (es-AR), one design partner | Branch-based delivery + manual prod gate is enough. |
| **Admin "god mode" via BYPASSRLS/superuser app connection** | "Admin needs to see everything" | Bypassing RLS makes isolation unauditable and one bug = cross-tenant leak | Policy-based admin access (a policy that grants platform-admins broad read), auditable and revocable — never run the app as superuser/owner. |

## Feature Dependencies

```
Monorepo skeleton (pnpm + Turborepo)
    └──requires──> Strict TS + shared config (packages/config)
                       └──enables──> CI: lint → type-check → tests → coverage

Postgres 16 + Drizzle migrations
    └──requires──> Docker Compose (Postgres service)
    └──enables──> RLS policies + FORCE RLS + non-superuser app role
                       └──requires──> Better Auth org/membership tables (tenant identity source)
                       └──enables──> anon read role (publicado-only)
                       └──verified-by──> RLS isolation tests in CI

Better Auth sessions
    └──requires──> Postgres (session store)
    └──enables──> Organization plugin (orgs + memberships + roles)
                       └──enables──> Email invitations
                                          └──requires──> Resend + React Email

Auto-deploy to staging
    └──requires──> Docker images build (CI) + registry + Traefik on VPS
    └──requires──> Secrets management (SOPS/age)
    └──enables──> Manual prod promotion (gate)

Observability (Sentry / pino→Loki / Uptime Kuma)
    └──requires──> Services deployed (staging) to observe
    └──enhances──> every later phase (debuggable from day one)

RLS isolation (primary guarantee) ──conflicts──> Admin BYPASSRLS/superuser connection
```

### Dependency Notes

- **RLS requires Better Auth org/membership tables:** RLS policies key off tenant identity (`organization_id`), which lives in the auth-managed membership model. Auth schema must exist before isolation policies are meaningful — but the *app role / FORCE RLS* setup can be scaffolded in parallel.
- **Email invitations require Resend wiring:** The org plugin manages invitation state, but a real email must be sent. This pulls Resend + React Email into phase 0 even though broader email (lead alerts) is later.
- **RLS isolation tests require a real Postgres in CI:** A mocked DB cannot prove policies; use a testcontainer or the compose Postgres. This is the load-bearing test of the milestone.
- **Auto-deploy requires secrets management:** The pipeline can't push to a VPS or configure services without secrets, so SOPS/age comes in with the deploy pipeline, not after.
- **Admin access conflicts with RLS bypass:** Granting admins via superuser/BYPASSRLS defeats the central guarantee. Use a policy-based admin path so isolation stays provable.

## MVP Definition

### Launch With (phase-0 / milestone v1)

The foundation is "done" when each commit to main ships to staging with provable tenant isolation.

- [ ] **Monorepo skeleton + shared strict-TS/lint config** — everything else lands here
- [ ] **CI gate: lint + type-check + tests + coverage threshold, blocks merge** — quality is structural from commit one
- [ ] **Docker Compose: Postgres 16 + Redis + services, one command** — reproducible local/staging
- [ ] **Drizzle migrations versioned + `db:migrate`/`db:seed` commands** — no manual schema changes
- [ ] **Better Auth: sessions + org plugin (owner/developer/viewer) + email invitations** — multi-tenancy identity
- [ ] **RLS: policies on tenant tables, FORCE RLS, non-superuser app role, `anon` published-only role** — the central promise
- [ ] **RLS isolation tests in CI** — the promise, *verified*
- [ ] **Auto-deploy to staging on merge to main + manual prod gate** — the core value
- [ ] **Observability live on first deploy: Sentry + pino→Loki + Uptime Kuma** — operable from day one
- [ ] **Secrets via SOPS/age** — no plaintext secrets in repo

### Add After Validation (next milestones, not v1)

Triggered by phase 1+ work needing them.

- [ ] **Full schema (floors/units/prices/quotes/leads…) + media pipeline (R2 + sharp + blurhash)** — phase 1
- [ ] **BullMQ job processing (image variants, PDFs, emails, alerts)** — when there is work to queue (phase 1/3)
- [ ] **Anonymous event/lead ingestion + edge rate limiting** — when public web exists (phase 2/5)
- [ ] **SSE realtime via LISTEN/NOTIFY** — phase 2 (live prices/states)
- [ ] **OTel span instrumentation on real request paths** — incrementally as paths appear
- [ ] **Lighthouse / page-weight budget in CI** — when public web exists

### Future Consideration (defer until PMF / first paying client)

- [ ] **Dedicated prod VPS + custom-domain TLS on-demand exercised** — first paying client
- [ ] **Backups (pgBackRest/wal-g) + rehearsed PITR restore** — before first real data / first client
- [ ] **Self-service tenant signup / reseller mode** — post-PMF
- [ ] **SSO / OAuth / 2FA / passkeys** — first enterprise buyer
- [ ] **ClickHouse analytics path** — when event volume demands it

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| RLS isolation + FORCE RLS + non-superuser role | HIGH | HIGH | P1 |
| RLS isolation tests in CI | HIGH | MEDIUM | P1 |
| Better Auth sessions + org/roles + invitations | HIGH | MEDIUM | P1 |
| Auto-deploy to staging on merge | HIGH | HIGH | P1 |
| Monorepo + shared strict config | HIGH | MEDIUM | P1 |
| CI gate (lint/type/test/coverage) | HIGH | MEDIUM | P1 |
| Drizzle migrations + commands | HIGH | MEDIUM | P1 |
| Docker Compose one-command up | HIGH | MEDIUM | P1 |
| Sentry error tracking | HIGH | LOW | P1 |
| pino → Loki structured logs | MEDIUM | MEDIUM | P1 |
| Uptime Kuma | MEDIUM | LOW | P1 |
| Manual prod promotion gate | MEDIUM | LOW | P1 |
| Secrets (SOPS/age) | MEDIUM | MEDIUM | P1 |
| `anon` published-only role | MEDIUM | MEDIUM | P2 (boundary set in P1; exercised later) |
| Backups + PITR restore | HIGH (later) | MEDIUM | P3 (pre-first-client) |
| Dedicated prod VPS | MEDIUM | MEDIUM | P3 (first client) |

**Priority key:** P1 = must have for milestone v1 / P2 = boundary established now, fully built next milestone / P3 = deferred (documented requirement)

## Competitor Feature Analysis

Direct competitors (Urbania3D, Hauzd, Web3D) compete on the *product* surface, not on a publicly visible foundation. The foundation comparison is therefore against **SaaS engineering norms** rather than rival showrooms.

| Capability | Typical "ship-fast" MVP | Mature SaaS norm | Our phase-0 approach |
|------------|-------------------------|------------------|----------------------|
| Tenant isolation | App-layer `WHERE tenant_id` (leak-prone) | RLS + app filtering (defense in depth) | RLS + FORCE + non-superuser + CI proof — mature norm from day zero |
| Auth | Roll-your-own / single user | Managed multi-tenant auth + invites | Better Auth org plugin (mature norm) |
| Deploy | Manual / push-to-deploy single env | CI → staging → manual prod | Auto-staging + manual prod gate (mature norm) |
| Observability | Added after first incident | Errors + logs + uptime from launch | All three on first deploy (ahead of typical MVP) |
| Backups/PITR | Often absent early | Tested restore | Deliberately deferred to pre-first-client (pragmatic) |
| Infra | PaaS click-deploy | K8s/managed | Docker Compose + Traefik on VPS (deliberately simpler than "mature" — right for solo op) |

The shape: **mature on isolation, auth, deploy, and observability** (where the product's credibility lives), **deliberately lean on infra and deferred on backups/prod** (where solo-operator cost outweighs current value).

## Sources

- [Shipping multi-tenant SaaS using Postgres Row-Level Security — Nile](https://www.thenile.dev/blog/multi-tenant-rls) — MEDIUM
- [Postgres RLS Implementation Guide: Best Practices and Common Pitfalls — Permit.io](https://www.permit.io/blog/postgres-rls-implementation-guide) — MEDIUM
- [Mastering PostgreSQL RLS for Rock-Solid Multi-Tenancy — Rico Fritzsche](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/) — MEDIUM
- [Better Auth — Organization plugin docs](https://better-auth.com/docs/plugins/organization) — HIGH (official)
- [Members, Roles & Invitations — better-auth DeepWiki](https://deepwiki.com/better-auth/better-auth/5.2-organization-plugin) — MEDIUM
- [Multi-Tenant SaaS with Better-Auth: production lessons — Medium](https://benharundev.medium.com/multi-tenant-saas-with-nestjs-better-auth-what-we-learned-in-production-6d3414239121) — LOW
- [pgvpd — transparent multi-tenancy for Drizzle via Postgres RLS — drizzle-orm discussion #5411](https://github.com/drizzle-team/drizzle-orm/discussions/5411) — MEDIUM
- [Drizzle ORM + Postgres RLS for Multi-Tenancy — ECOSIRE](https://ecosire.com/blog/drizzle-orm-postgres-rls-multitenancy) — LOW
- [The Solo-Founder Playbook — ProductLed](https://productled.com/blog/the-solo-founder-playbook-how-to-run-a-1m-arr-saas-with-one-person) — LOW (context for anti-features framing)
- Project docs: `docs/modelo-mvp.md` §3.1–§3.6, `CLAUDE.md`, `.planning/PROJECT.md` — HIGH (authoritative for scope)

---
*Feature research for: production-grade multi-tenant SaaS foundation (phase 0)*
*Researched: 2026-06-12*
