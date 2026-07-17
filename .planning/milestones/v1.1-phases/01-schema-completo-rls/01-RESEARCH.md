# Phase 01: Schema completo + RLS - Research

**Researched:** 2026-06-26
**Domain:** PostgreSQL 16 multi-tenant data modeling — Drizzle ORM schema-as-code, Row-Level Security, RANGE partitioning, versioned migrations
**Confidence:** HIGH (v1.0 code is the contract and was read in full; every load-bearing PG/Drizzle claim verified against official docs or the existing codebase)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-16 — builder discretion under explicit user delegation)

The user delegated all technical decisions ("no tengo tanto conocimiento, tomá vos cuidadosamente las decisiones más óptimas"). The 16 decisions below are the spec. **This research re-verified each against the pinned stack and v1.0 code; conflicts are flagged explicitly in `## Decision Verification` below — none were silently accepted.**

- **D-01** Tenant scoping: every tenant table carries denormalized `organization_id` (`text`, FK → `organization.id`) **plus** its natural parent FK. Tenant policy is a flat clone of `projects_tenant`: `using`/`withCheck = organization_id = current_setting('app.current_organization_id', true)::text`. No join-based filtering.
- **D-02** Consistency of denormalized `organization_id` enforced **structurally via composite FKs** (not triggers): `projects` gets `UNIQUE (id, organization_id)`; each child references the pair, e.g. `floors (project_id, organization_id) → projects (id, organization_id)`. Composite FK requires `UNIQUE` on the parent pair.
- **D-03** Tenancy hierarchy: `organization` → `projects` → {floors, price_lists, payment_plans, cac_index*, quotes, brokers, leads, progress_posts, galleries, media, events} → {units (via floor), unit_prices (via unit+price_list)}. Each with denormalized `organization_id`.
- **D-04** `events` is RANGE-partitioned by month on `ts`; DDL hand-written in a SQL migration (Drizzle cannot emit `PARTITION BY`). Parent declared in Drizzle for types; partition DDL in the same single journal.
- **D-05** Migration creates current + next 2-3 months partitions **plus a DEFAULT partition** (safety net; an insert landing in DEFAULT is a monitorable event, never a 500).
- **D-06** A repeatable BullMQ job in `apps/worker` pre-creates next month's partition (idempotent). Phase 1 = skeleton job + migration partitions only. **No `pg_partman`.**
- **D-07** RLS on `events`: FORCE RLS + tenant policy declared on the partitioned **parent**; `organization_id` denormalized on events too.
- **D-08** `anon` gets **GRANT INSERT-only (no SELECT)** on `leads` and `events` — public site writes them, never reads them.
- **D-09** anon INSERT policy `WITH CHECK` only allows rows whose `project_id` belongs to a `publicado` project.
- **D-10** Zod validation at the boundary (drizzle-zod where applicable) for anonymous insert payloads; the ingestion endpoint itself is NOT built this phase.
- **D-11** Rate-limit NOT implemented this phase (no public endpoint yet); documented for downstream (nginx `limit_req` and/or Redis app-level limiter). Phase 1 DB guarantee: `WITH CHECK publicado-only` + no SELECT for anon.
- **D-12** All JSONB typed via `jsonb().$type<T>()` + co-located Zod (in `packages/db`, re-exported). `payment_plans.refuerzos: $type<Refuerzo[]>`, `leads.timeline: $type<LeadNote[]>`.
- **D-13** `quotes.snapshot` = versioned envelope `jsonb().$type<QuoteSnapshot>()` with `QuoteSnapshot = { version: 1; ... }`. Phase 1 fixes the envelope + structural FKs only; calc shape owned by `packages/quoting` (Fase 3), evolvable by bumping `version` without migration.
- **D-14** Money: USD prices = `integer`; `cac_index.valor` = `numeric`/decimal; ARS persisted as decimal/`numeric`. **Never float.**
- **D-15** Enums as `pgEnum` (Spanish data values, English identifiers): `unidad_estado [disponible|reservado|vendido]`, `lead_estado [nuevo|contactado|negociacion|cerrado]`, `galeria_seccion [amenities|exteriores|interiores]`, `ajuste_tipo [CAC|fijo]`, `moneda [USD|ARS]`. Reuse existing `estado` enum.
- **D-16** Extend `packages/db/tests/cross-tenant.test.ts` to every new table (absence assertions as unprivileged role); for leads/events add the anonymous-insert-allowed-vs-publicado / rejected-vs-borrador case and the no-SELECT case. Green in CI = exit gate (SCHEMA-08).

### Claude's Discretion
The 16 decisions were the builder's under explicit user delegation. The researcher must re-verify against pinned versions and flag conflicts (done — see `## Decision Verification`). If a decision is infeasible with the pinned stack, escalate — do not improvise. **One decision requires a structural adjustment to remain feasible (events PK), and two need a small extension to satisfy SCHEMA-07; both are flagged, not silently changed.**

### Deferred Ideas (OUT OF SCOPE — do not build)
- Anonymous ingestion endpoints/API for leads+events and their rate-limit (Fase 2+) — only DB policies + Zod schemas land here.
- Retention/detach/archival of old `events` partitions (later) — Phase 1 only creates partitions + next-month pre-creation job.
- Quoting engine (`packages/quoting`) and the internal shape of `quotes.snapshot` (Fase 3).
- Media pipeline (R2 + sharp + blurhash) (Fase 2) — only the `media` table + columns + RLS here.
- Seed of "Brigos Recoleta" (Fase 3).
- Automatic CAC scraping (manual monthly load first).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHEMA-01 | floors + units (estado `unidad_estado`, polígono SVG, orden) with tenant RLS + Drizzle migration | Standard Stack (Drizzle pgTable/pgEnum/pgPolicy), Pattern 1 (tenant table clone), Pattern 4 (composite FK hierarchy) |
| SCHEMA-02 | pricing — price_lists, unit_prices, payment_plans (refuerzos JSONB), cac_index; money as integers; tenant RLS | Pattern 5 (money types), Pattern 6 (typed JSONB), Pattern 4 (composite FK incl. unit_prices project_id flag) |
| SCHEMA-03 | quotes (snapshot JSONB, pdf key, lead opc.) — schema ready for Fase 3; tenant RLS; no calc engine | Pattern 7 (versioned envelope `$type<QuoteSnapshot>`), Pattern 1 |
| SCHEMA-04 | brokers + leads (estado `lead_estado`, timeline JSONB); leads accepts anonymous validated insert; tenant RLS | Pattern 1, Pattern 6 (timeline JSONB), Pattern 3 (anon insert-only policy) |
| SCHEMA-05 | progress_posts, galleries (`galeria_seccion`), media (R2 keys, dims, blurhash) with tenant RLS | Pattern 1, Standard Stack |
| SCHEMA-06 | events partitioned by month (anon analytics insert); tenant RLS | Pattern 2 (partitioned + RLS), Pattern 3 (anon insert), FLAG-A/FLAG-B |
| SCHEMA-07 | anon policy — public web (anon, no BYPASSRLS) reads only rows of `publicado` projects across catalog/content tables; verified by test | Pattern 8 (anon published-only on child tables), FLAG-D |
| SCHEMA-08 | cross-tenant isolation suite extended to all new tables, green in CI vs real Postgres 16, roles without BYPASSRLS | Validation Architecture, Pattern 9 (test extension) |
</phase_requirements>

## Summary

This is a **data + RLS phase that clones an already-proven v1.0 pattern**, not a greenfield design. The v1.0 codebase (`projects.ts`, `member-rls.ts`, `roles.ts`, `with-tenant.ts`, `0000_init.sql`, `0001_rls.sql`, the cross-tenant suite) establishes a complete, working template: a `pgTable(...).enableRLS()` with a `projects_tenant` policy (flat `organization_id = current_setting('app.current_organization_id', true)::text`) and a `projects_anon_published` SELECT policy, dedicated `app_authenticated`/`anon` roles created NOSUPERUSER NOBYPASSRLS in hand-written SQL, FORCE ROW LEVEL SECURITY on every tenant table, and an absence-based isolation suite that runs as the unprivileged role. **The ~12 new tables are flat clones of this template.** The single-migration-journal invariant (drizzle-kit `0000_init.sql` generated + hand-written `0001_rls.sql`, one `db:migrate`) is sacred — and the schema reaches the DB ONLY via `pnpm db:migrate` (generate then migrate), **never `drizzle-kit push` nor manual edits** (CLAUDE.md, non-negotiable). The planner must inject a *migrate* task, not a push task.

Three of the 16 decisions need attention, all flagged below, none silently changed: **(FLAG-A)** the partitioned `events` table cannot have a single-column `id` primary key — Postgres requires the partition key `ts` in any PK/UNIQUE, so `events` PK must be `(id, ts)`; **(FLAG-B)** the events parent must be declared in Drizzle for types/Zod but kept OUT of `drizzle.config.ts`'s `schema:` array (mirroring the `.existing()` role pattern), so drizzle-kit never emits a plain `CREATE TABLE` that collides with the hand-written `PARTITION BY` — consequently the events tenant + anon policies are also hand-written `CREATE POLICY`, not Drizzle `pgPolicy`; **(FLAG-D)** the SCHEMA-07 anon-published policy on child/content tables has no `estado` column to test, so it needs a single-level `EXISTS` against `projects.project_id` — which means every project-scoped table should carry a denormalized `project_id` (modelo gives all of them one except `unit_prices`; recommend adding it there too, composite-FK'd, for a uniform flat anon policy).

**Primary recommendation:** Build each new table as a literal clone of `projects.ts` (tenant policy) + a child-scoped anon-published policy; add `UNIQUE (id, organization_id)` to every parent and composite FKs `(child_fk, organization_id) → parent (id, organization_id)` per D-02; hand-write ALL `events` DDL (table + `PARTITION BY RANGE (ts)` + monthly partitions + DEFAULT + grants + FORCE RLS + both policies) in a single hand SQL migration appended to the same journal; add `drizzle-zod@0.8.3` for boundary validation; extend the cross-tenant suite table-by-table with the same absence assertions plus anon insert-only cases for leads/events.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tenant isolation (org A can't see org B) | Database / Storage (RLS policy) | — | RLS is the enforcement boundary; app code only sets the GUC. Never enforce tenancy in app code (CLAUDE.md: RLS on every tenant table). |
| Anonymous public read (publicado only) | Database / Storage (anon policy + role) | — | The `anon` role + published-only policy is the contract; the public web never bypasses it. |
| Anonymous write gating (leads/events vs publicado) | Database / Storage (INSERT policy WITH CHECK) | API (Zod) | DB policy is the hard guarantee; Zod at the tRPC boundary (Fase 2+) is defense-in-depth. |
| Money correctness (no float) | Database / Storage (integer/numeric column types) | API (quoting, Fase 3) | Column types make float impossible at rest; the quoting engine computes ARS later. |
| JSONB payload shape | Database (`$type<T>` + co-located Zod) | API/panel (validate before write) | `$type` is compile-time; Zod is the runtime validator re-exported for callers. |
| events partition lifecycle | Database (migration DDL) | Worker (BullMQ pre-create job) | Migration seeds initial partitions; the idempotent worker job pre-creates next month. |
| Migration application | Database (drizzle-kit migrate) | CI | Single journal, `db:migrate` only — never push, never manual. |

## Standard Stack

### Core (all ALREADY pinned & installed in `packages/db` — reuse, do not bump)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `0.45.2` | Schema-as-code, RLS policies (`pgPolicy`/`pgRole`), composite FK/PK/unique, typed JSONB (`$type`) | Already the project ORM; v1.0 RLS pattern is built on it `[VERIFIED: packages/db/package.json]` |
| `drizzle-kit` | `0.31.10` | Versioned migration generation (`generate`/`migrate`), `entities.roles:true` policy emission | Already the migration tool; single journal invariant `[VERIFIED: packages/db/package.json + drizzle.config.ts]` |
| `postgres` (porsager) | `3.4.9` | Driver for app/anon/owner pools; clean tx API for the per-request GUC | v1.0 `with-tenant.ts` + test harness use it `[VERIFIED: packages/db/package.json]` |
| PostgreSQL | `16.x` | RLS, declarative RANGE partitioning, FORCE ROW LEVEL SECURITY | Pinned `postgres:16-alpine` in Compose `[CITED: CLAUDE.md]` |
| `zod` | `4.4.3` | Boundary validation for JSONB + anon insert payloads | Already pinned; drizzle-zod 0.8.3 peer-compatible `[VERIFIED: npm peerDependencies zod ^4]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-zod` | `0.8.3` | Derive Zod insert/select schemas from Drizzle tables; refine JSONB columns with hand-authored Zod | NEW dependency — add to `packages/db`. For anon insert payload validation (D-10) and JSONB envelope schemas (D-12/D-13). Peer deps: `zod ^3.25 || ^4`, `drizzle-orm >=0.36` — both satisfied. `[VERIFIED: npm registry — OK verdict, 1.9M weekly dl, official drizzle-team repo, no postinstall]` |
| `bullmq` / `ioredis` | `5.78.0` / `5.11.1` | Repeatable partition pre-create job (D-06) in `apps/worker` | Worker shell already exists (`apps/worker/src/index.ts`); add a repeatable job. `[VERIFIED: apps/worker/src/index.ts]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written monthly partitions + small BullMQ job | `pg_partman` extension | Explicitly rejected by D-06 — extra extension, falls outside the single migration journal. Manual partitions + idempotent job stay 100% in-journal. |
| Flat `organization_id` tenant policy (D-01) | Join-based `project_id IN (select id from projects where organization_id = GUC)` | Rejected by D-01 — correlated subquery per row, couples every policy to `projects`'s policy (cascade risk). Flat denormalized tenant_id keeps every policy identical/fast. |
| Composite FK structural integrity (D-02) | Triggers / app-level trust | Rejected by D-02 — FKs make a mismatched `organization_id` physically impossible; triggers are bypassable and unobservable. |

**Installation:**
```bash
pnpm --filter @imbau/db add drizzle-zod@0.8.3
```

**Version verification (done 2026-06-26):** `npm view drizzle-zod version` → `0.8.3`; peer deps `{ zod: '^3.25.0 || ^4.0.0', 'drizzle-orm': '>=0.36.0' }` (both satisfied by pinned `zod@4.4.3` + `drizzle-orm@0.45.2`); `scripts.postinstall` → none. All other packages already pinned in `packages/db/package.json` — no bumps.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `drizzle-zod` | npm | published 2025-08-06 | 1.9M/wk | github.com/drizzle-team/drizzle-orm | **OK** | Approved (CLAUDE.md-listed; official drizzle-team monorepo; no postinstall) |
| `drizzle-orm` | npm | pinned `0.45.2` | (installed) | drizzle-team | OK | Already installed — reuse |
| `drizzle-kit` | npm | pinned `0.31.10` | (installed) | drizzle-team | OK | Already installed — reuse |
| `postgres` | npm | pinned `3.4.9` | (installed) | porsager/postgres | OK | Already installed — reuse |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Rejected by decision (not a legitimacy issue):** `pg_partman` (D-06 — out of scope by design)

## Decision Verification

> The builder's primary ask: re-verify D-01..D-16 against pinned versions and the v1.0 code, confirm exact syntax, and FLAG conflicts. Result: 13 decisions verified clean; 3 need attention (FLAG-A, FLAG-B, FLAG-D). None silently accepted.

| Decision | Verdict | Evidence / Note |
|----------|---------|-----------------|
| **D-01** flat tenant policy + GUC key | ✅ VERIFIED | `with-tenant.ts` sets `set_config('app.current_organization_id', ${orgId}, true)`; v1.0 policies read `current_setting('app.current_organization_id', true)::text`. CONTEXT's GUC name matches the code exactly. `::text` cast confirmed (org id is TEXT — Pitfall 2). `[VERIFIED: packages/db/src/with-tenant.ts + projects.ts]` |
| **D-02** composite FK + UNIQUE(id, organization_id) | ✅ VERIFIED | Drizzle 0.45 syntax confirmed: `unique().on(t.id, t.organizationId)` and `foreignKey({ columns, foreignColumns })`. `[VERIFIED: orm.drizzle.team/docs/indexes-constraints]` Adding `UNIQUE (id, organization_id)` to v1.0 `projects` is additive (ALTER TABLE ADD CONSTRAINT in a new generated migration) — non-breaking. `[CITED: PG createtable]` |
| **D-03** hierarchy | ✅ VERIFIED | Matches modelo §3.3. See FLAG-D for the `unit_prices` project_id refinement. |
| **D-04** events partition DDL hand-written | ⚠️ FLAG-B | Feasible, but the parent must be kept OUT of `drizzle.config.ts schema:` or drizzle-kit emits a plain `CREATE TABLE` colliding with hand `PARTITION BY`. See FLAG-B. |
| **D-05** DEFAULT partition | ✅ VERIFIED | "A partition key value not fitting into any other partition… will be routed to the default partition." `[CITED: postgresql.org/docs/16/sql-createtable]` |
| **D-06** BullMQ pre-create job, no pg_partman | ✅ VERIFIED | Worker shell exists; add a repeatable job. `[VERIFIED: apps/worker/src/index.ts]` |
| **D-07** FORCE RLS + policy on partitioned parent | ✅ VERIFIED (with caveat) | RLS on the parent applies when querying through the parent (the only access path — `withTenant`). Direct partition access is NOT gated by the parent's policy; mitigated because the app only ever queries the parent and grants are on the parent. See Pitfall 6. `[CITED: postgresql.org/docs/16 — established behavior]` |
| **D-08** anon INSERT-only, no SELECT | ✅ VERIFIED | Hand-written `GRANT INSERT ON leads, events TO anon` (no SELECT). Absence of SELECT is testable (42501). |
| **D-09** anon insert WITH CHECK publicado | ✅ VERIFIED | `pgPolicy({ for: 'insert', to: anonRole, withCheck: sql\`EXISTS(...)\` })` (no `using` — Postgres ignores USING for INSERT). anon already has SELECT on `projects` so the EXISTS subquery resolves. For events (hand-written), same as hand `CREATE POLICY ... FOR INSERT`. |
| **D-10** Zod boundary | ✅ VERIFIED | drizzle-zod 0.8.3 verified; endpoint deferred. |
| **D-11** no rate-limit this phase | ✅ VERIFIED | DB guarantee only; documented downstream. |
| **D-12 / D-13** typed JSONB + versioned envelope | ✅ VERIFIED | `jsonb().$type<T>()` is valid Drizzle 0.45. drizzle-zod infers `z.any()`/unknown for jsonb — so the JSONB runtime validator is a HAND-AUTHORED co-located Zod schema plugged into `createInsertSchema(table, { col: zSchema })`. See Pattern 6/7. |
| **D-14** money types | ✅ VERIFIED | `integer()` for USD; `numeric({ precision, scale })` for `cac_index.valor` / ARS. Never `real`/`doublePrecision`. |
| **D-15** enums | ✅ VERIFIED (1 note) | `pgEnum` + reuse `estadoEnum`. NOTE: modelo writes `negociación` (accented); D-15 writes `negociacion` (ASCII). Use the ASCII `negociacion` enum value (matches existing enum style, avoids encoding pitfalls); UI renders the accented label. |
| **D-16** extend isolation suite | ✅ VERIFIED | Same absence pattern; extend fixtures + cases. See Validation Architecture. |
| **events PK** | ⚠️ FLAG-A | Partitioned table PK must include partition key `ts` → events PK = `(id, ts)`, NOT `id` alone. `[VERIFIED: postgresql.org/docs/16/ddl-partitioning]` |
| **SCHEMA-07 anon on child tables** | ⚠️ FLAG-D | Needs `project_id` + single-level EXISTS; recommend denormalizing `project_id` on `unit_prices` too. |

### FLAG-A (MUST resolve in the plan): events primary key must include the partition key
PostgreSQL: *"To create a unique or primary key constraint on a partitioned table… the constraint's columns must include all of the partition key columns."* `[VERIFIED: postgresql.org/docs/16/ddl-partitioning.html]` Therefore `events` **cannot** have `id uuid PRIMARY KEY` alone. Resolution: hand-write `PRIMARY KEY (id, ts)` (composite, includes the `ts` partition key). This does NOT conflict with the rest of D-02 because **nothing references `events`** (it is a leaf of the hierarchy), so events needs no `UNIQUE (id, organization_id)`. The composite FK *FROM* events → `projects (id, organization_id)` is fine: foreign keys from a partitioned table to a normal table are supported (PG 11+). `[CITED: PG partitioning]`

### FLAG-B (MUST resolve in the plan): keep events OUT of drizzle.config to avoid a CREATE TABLE collision
Drizzle has no `PARTITION BY` support, so the events DDL is hand-written. But if `events.ts` is listed in `drizzle.config.ts`'s `schema:` array, `drizzle-kit generate` emits a **plain** `CREATE TABLE "events" (...)` (no partitioning) that collides with the hand-written partitioned DDL. Resolution (mirrors the existing `.existing()` role pattern — declare for types, hand-write DDL):
1. Declare `events` as a `pgTable` in `src/schema/events.ts` **for `$inferInsert`/`$inferSelect` types + the co-located Zod schema only**, and re-export it from the barrel (`index.ts`) for test/consumer use.
2. **Do NOT add `src/schema/events.ts` to `drizzle.config.ts`'s `schema:` array** — so drizzle-kit never sees it and never emits a CREATE TABLE.
3. Hand-write ALL events DDL in a new hand SQL migration (next number after the generated init), following the `0001_rls.sql` idempotent style: `CREATE TABLE "events" (...) PARTITION BY RANGE (ts)`, the monthly + DEFAULT partitions, the composite FK, `GRANT`s, `FORCE ROW LEVEL SECURITY`, and **both** `CREATE POLICY` statements (events tenant clone of `projects_tenant`, and the anon insert-only WITH-CHECK policy). The events policies are therefore hand-written SQL, not Drizzle `pgPolicy` emissions.

### FLAG-D (resolve in the plan): anon published-only on child tables needs project_id + EXISTS
D-01's flat `organization_id` policy works perfectly for the **tenant** policy. But the **anon published-only** policy (SCHEMA-07) has no `estado` column on child/content tables, so it needs a correlated check against the parent project's `estado`. The cleanest uniform shape requires every project-scoped table to carry a denormalized `project_id`:
```
-- anon SELECT policy, identical shape on every catalog/content table:
for select to anon using (
  exists (select 1 from projects p
          where p.id = <table>.project_id and p.estado = 'publicado')
)
```
modelo §3.3 already gives a direct `project` reference to **every** project-scoped table EXCEPT `unit_prices` (modelo lists it as `unit, price_list`). **Recommendation:** give `unit_prices` a denormalized `project_id` too, composite-FK'd `(project_id, organization_id) → projects (id, organization_id)`, so its anon policy is the same single-level EXISTS as the rest. (The hierarchical FKs `unit_prices → units` and `unit_prices → price_lists` from D-02 remain as additional integrity constraints.) This *extends* D-02 with one extra denormalized column on one table — flagged, not silently changed. Because `projects_anon_published` already restricts anon's visible projects to `publicado`, the EXISTS is naturally publicado-gated; the explicit `and p.estado = 'publicado'` is defensive and clear.

**Anon coverage map (which tables get an anon-published SELECT policy vs not):**
- **anon SELECT + published policy** (public catalog/content): `floors`, `units`, `price_lists`, `unit_prices`, `payment_plans`, `brokers`, `progress_posts`, `galleries`, `media`, `cac_index`.
- **anon INSERT-only, no SELECT** (private, write-only from public site): `leads`, `events`.
- **NO anon access** (tenant-private): `quotes`.
(`cac_index` is the one table without a `project_id` — it is org-scoped, not project-scoped; per D-09 footnote it carries `organization_id`. Its anon-read policy, if the cotizador needs CAC publicly, gates on `organization_id` membership of any publicado project, OR simply make CAC readable to anon globally since it is non-sensitive index data — **decide in planning**; default to anon SELECT gated by org having ≥1 publicado project, or treat CAC as tenant-private and feed it server-side. FLAG for the planner.)

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
   public web (anon) ───►│  anon role  (NOSUPERUSER NOBYPASSRLS)        │
   - read publicado      │  - SELECT on catalog/content (published only)│
   - write leads/events  │  - INSERT-only on leads, events (publicado)  │
                         └───────────────┬─────────────────────────────┘
                                          │ enforced by
   panel / API ──► withTenant(orgId) ─────┤  RLS POLICIES (the boundary)
   - set_config('app.current_organization_id', orgId, true)             │
   - runs as app_authenticated (NOBYPASSRLS)                            ▼
                         ┌─────────────────────────────────────────────────────┐
                         │ tenant tables (FORCE ROW LEVEL SECURITY)             │
                         │                                                       │
                         │ organization ─► projects ─► floors ─► units          │
                         │                    │  └─► price_lists ─► unit_prices  │
                         │                    │  └─► payment_plans, cac_index*   │
                         │                    │  └─► brokers, leads, quotes      │
                         │                    │  └─► progress_posts, galleries   │
                         │                    │  └─► media                       │
                         │                    └─► events (PARTITION BY RANGE ts) │
                         │                          ├ events_2026_06             │
                         │                          ├ events_2026_07 …           │
                         │                          └ events_default (catch-all) │
                         │                                                       │
                         │ every child: organization_id (denormalized, TEXT)    │
                         │   + composite FK (fk, organization_id) → parent       │
                         │   + project_id (denormalized) for anon published EXISTS│
                         └───────────────────────────────────────────────────────┘
   tenant policy  : organization_id = current_setting('app.current_organization_id', true)::text
   anon read pol. : exists(select 1 from projects p where p.id = t.project_id and p.estado='publicado')
   anon write pol.: WITH CHECK (same EXISTS) — leads, events only

   apps/worker (BullMQ) ──► repeatable job: pre-create next-month events partition (idempotent)
   drizzle-kit generate ──► 000N_init.sql  +  hand 000N+1_*.sql (roles/FORCE/partitions)  ──► db:migrate (ONE journal)
```

### Recommended Project Structure
```
packages/db/src/schema/
├── projects.ts          # v1.0 — reference template (UNCHANGED logic; add UNIQUE(id, organization_id))
├── roles.ts             # v1.0 — reuse appAuthenticated/anonRole .existing()
├── floors.ts            # NEW: pgTable + tenant policy + anon-published policy
├── units.ts             # NEW
├── price-lists.ts       # NEW
├── unit-prices.ts       # NEW (+ denormalized project_id — FLAG-D)
├── payment-plans.ts     # NEW (refuerzos JSONB $type<Refuerzo[]>)
├── cac-index.ts         # NEW (valor numeric; org-scoped)
├── quotes.ts            # NEW (snapshot JSONB $type<QuoteSnapshot>; NO anon)
├── brokers.ts           # NEW
├── leads.ts             # NEW (timeline JSONB; anon INSERT-only policy)
├── progress-posts.ts    # NEW
├── galleries.ts         # NEW (galeria_seccion enum)
├── media.ts             # NEW
├── events.ts            # NEW (pgTable for TYPES+Zod ONLY — NOT in drizzle.config; DDL hand-written)
├── enums.ts             # NEW (optional): unidad_estado, lead_estado, galeria_seccion, ajuste_tipo, moneda
├── json-schemas.ts      # NEW (optional): Refuerzo, LeadNote, QuoteSnapshot Zod + types
└── index.ts             # barrel — re-export every new table/enum/policy (incl. events)

packages/db/migrations/
├── 0000_init.sql        # v1.0 generated (unchanged)
├── 0001_rls.sql         # v1.0 hand (unchanged)
├── 0002_*.sql           # NEW generated (drizzle-kit) — all new tables, enums, FKs, ENABLE RLS, pgPolicies
└── 0003_*.sql           # NEW hand — new GRANTs, FORCE RLS on every new tenant table, ALL events DDL (partitions)

packages/db/tests/
├── helpers.ts           # extend: makeFloor, makeUnit, makeLead, makeBroker, makeEvent, …
└── cross-tenant.test.ts # extend: absence cases per table + anon insert-only cases (leads/events)

apps/worker/src/
└── partitions.ts        # NEW (optional): repeatable BullMQ job — pre-create next-month events partition
drizzle.config.ts        # add EVERY new schema file to schema: array EXCEPT events.ts (FLAG-B)
```

### Pattern 1: Tenant table (flat clone of projects_tenant)
**What:** Every new project-scoped table is a literal clone of `projects.ts`.
**When to use:** floors, units, price_lists, unit_prices, payment_plans, quotes, brokers, leads, progress_posts, galleries, media (and cac_index, org-scoped variant).
```typescript
// Source: clone of packages/db/src/schema/projects.ts (v1.0 contract)
import { pgTable, uuid, text, integer, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";

export const floors = pgTable("floors", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull()          // denormalized (D-01), TEXT to match org.id
    .references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),                   // natural FK + anon EXISTS key (FLAG-D)
  numero: integer("numero").notNull(),
  nombre: text("nombre"),
  // … render key, polígono SVG, etc.
}, (t) => [
  // composite FK enforces organization_id matches the parent project's (D-02)
  foreignKey({ columns: [t.projectId, t.organizationId],
              foreignColumns: [projects.id, projects.organizationId] }).onDelete("cascade"),
  unique().on(t.id, t.organizationId),                        // so children can composite-FK floors (D-02)
  // tenant policy — flat clone of projects_tenant (D-01); ::text cast (Pitfall 2)
  pgPolicy("floors_tenant", {
    as: "permissive", for: "all", to: appAuthenticated,
    using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
  }),
  // anon published-only (SCHEMA-07 / FLAG-D) — single-level EXISTS on project_id
  pgPolicy("floors_anon_published", {
    as: "permissive", for: "select", to: anonRole,
    using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
  }),
]).enableRLS();
```
> `projects` must gain `unique().on(t.id, t.organizationId)` so children can composite-FK it (D-02). Adding it is a non-breaking ALTER in the generated migration.

### Pattern 2: events — partitioned parent declared in Drizzle (types only), DDL hand-written
**What:** `events.ts` declares the table for `$inferInsert`/Zod, but its DDL (partitioning, policies, grants) is hand-written. **Not in drizzle.config (FLAG-B).**
```typescript
// Source: NEW — events.ts (TYPES + Zod ONLY; NOT in drizzle.config.ts schema: array — FLAG-B)
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
export const events = pgTable("events", {
  id: uuid("id").notNull().defaultRandom(),     // NOT .primaryKey() — composite (id, ts) in hand SQL (FLAG-A)
  organizationId: text("organization_id").notNull(),
  projectId: uuid("project_id").notNull(),
  tipo: text("tipo").notNull(),
  unitId: uuid("unit_id"),
  brokerId: uuid("broker_id"),
  sessionId: text("session_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),  // partition key
});
// $inferInsert/$inferSelect feed the co-located Zod + the worker job; DDL is hand-written.
```
```sql
-- Source: NEW hand migration (clone of 0001_rls.sql idempotent style) — ALL events DDL here.
CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "tipo" text NOT NULL,
  "unit_id" uuid, "broker_id" uuid, "session_id" text,
  "ts" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id", "ts"),                                   -- FLAG-A: partition key in PK
  CONSTRAINT events_project_org_fk FOREIGN KEY ("project_id","organization_id")
    REFERENCES "projects"("id","organization_id") ON DELETE cascade
) PARTITION BY RANGE ("ts");--> statement-breakpoint
-- monthly partitions (current + next 2-3) — idempotent
CREATE TABLE IF NOT EXISTS "events_2026_06" PARTITION OF "events"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');--> statement-breakpoint
-- … 2026_07, 2026_08 …
CREATE TABLE IF NOT EXISTS "events_default" PARTITION OF "events" DEFAULT;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "events" TO app_authenticated;--> statement-breakpoint
GRANT INSERT ON "events" TO anon;                              -- D-08: INSERT-only, NO SELECT
--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "events_tenant" ON "events" AS PERMISSIVE FOR ALL TO "app_authenticated"
  USING ("organization_id" = current_setting('app.current_organization_id', true)::text)
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true)::text);--> statement-breakpoint
CREATE POLICY "events_anon_insert" ON "events" AS PERMISSIVE FOR INSERT TO "anon"
  WITH CHECK (exists (select 1 from "projects" p
    where p.id = "events".project_id and p.estado = 'publicado'));
```
> Grants/policies on the PARENT cover all partitions when querying through the parent (the only access path). Partitions inherit the parent's RLS enablement.

### Pattern 3: anon INSERT-only policy on a Drizzle table (leads)
```typescript
// Source: NEW — leads.ts (anon writes leads from the public site, never reads them — D-08/D-09)
pgPolicy("leads_anon_insert", {
  as: "permissive", for: "insert", to: anonRole,             // INSERT → use withCheck only, no `using`
  withCheck: sql`exists (select 1 from ${projects} p
    where p.id = ${t.projectId} and p.estado = 'publicado')`,
}),
// + hand SQL grant in the hand migration: GRANT INSERT ON "leads" TO anon;  (NO SELECT)
```

### Pattern 4: composite FK hierarchy (D-02/D-03)
**What:** Each child composite-FKs to its immediate parent's `(id, organization_id)` pair; the parent declares `unique().on(id, organization_id)`.
**Examples:** `units (floor_id, organization_id) → floors (id, organization_id)`; `unit_prices (unit_id, organization_id) → units` AND `(price_list_id, organization_id) → price_lists`. Every parent in the chain needs `unique().on(t.id, t.organizationId)`. `[VERIFIED: orm.drizzle.team/docs/indexes-constraints]`

### Pattern 5: money columns (D-14)
```typescript
import { integer, numeric } from "drizzle-orm/pg-core";
precio: integer("precio").notNull(),                    // USD whole units (no cents in rubro)
valor: numeric("valor", { precision: 12, scale: 4 }).notNull(),  // cac_index.valor — decimal
// NEVER real() / doublePrecision() for money (CLAUDE.md).
```

### Pattern 6 & 7: typed JSONB + co-located Zod, versioned envelope (D-12/D-13)
```typescript
// Source: NEW — json-schemas.ts (types + runtime validators, re-exported for API/panel)
import { z } from "zod";
export const refuerzoSchema = z.object({ cuota: z.number().int(), montoUsd: z.number().int() });
export type Refuerzo = z.infer<typeof refuerzoSchema>;

export const quoteSnapshotSchema = z.object({ version: z.literal(1) }).passthrough(); // envelope fixed; calc shape Fase 3
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;

// payment-plans.ts:
import { jsonb } from "drizzle-orm/pg-core";
refuerzos: jsonb("refuerzos").$type<Refuerzo[]>().notNull().default(sql`'[]'::jsonb`),
// quotes.ts:
snapshot: jsonb("snapshot").$type<QuoteSnapshot>().notNull(),
```
> drizzle-zod infers `z.any()` for jsonb, so plug the hand-authored validator in: `createInsertSchema(paymentPlans, { refuerzos: z.array(refuerzoSchema) })`. `$type<T>` gives compile-time safety; the Zod schema is the runtime gate (D-10/D-12).

### Anti-Patterns to Avoid
- **`drizzle-kit push` or manual schema edits:** FORBIDDEN by CLAUDE.md. The schema reaches the DB only via `pnpm db:generate` then `pnpm db:migrate`. The planner injects a *migrate* task. (A generic schema-push gate will fire because Drizzle files change — override it: this project is migrate-only.)
- **Listing `events.ts` in drizzle.config `schema:`** → CREATE TABLE collision (FLAG-B).
- **`id uuid PRIMARY KEY` on events** → illegal on a partitioned table (FLAG-A).
- **`::uuid` cast in any tenant policy** → never matches the TEXT org id; makes absence tests pass for the wrong reason (Pitfall 2).
- **`using` on an INSERT policy** → Postgres ignores USING for INSERT; use `withCheck`.
- **Letting the owner/migration role own tables without FORCE RLS** → owner bypasses RLS (Pitfall 1).
- **Pointing drizzle.config at the barrel `index.ts`** → duplicate-policy errors (it re-reads every entity twice).
- **Two migration histories** → keep ONE journal; hand SQL appended after generated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant isolation | App-level `where organization_id = ?` everywhere | RLS policies + `withTenant` GUC | One missed filter = tenant leak; RLS is the enforced boundary (CLAUDE.md). |
| organization_id consistency | Triggers / app checks | Composite FKs (D-02) | DB makes mismatches physically impossible; verified by drizzle-kit. |
| Anon published gating | App filtering of borrador | anon role + published-only policy | The DB enforces it even if app code is wrong. |
| Partition lifecycle | Cron shell scripts editing prod | `pg_partman`? No — small idempotent BullMQ job + DEFAULT partition (D-05/D-06) | Stays in the migration journal; DEFAULT prevents insert failures. |
| Data-access helpers | New per-table query wrappers | Existing `withTenant`/`withAnon` | Single sanctioned path; new policies work under it automatically. |
| JSONB validation | Manual `JSON.parse` + ad-hoc checks | `$type<T>` + co-located Zod (drizzle-zod) | Compile-time + runtime safety, re-exported for callers. |
| Money | float/real columns | `integer` (USD) / `numeric` (decimal) | Float rounding kills the quoting product (CLAUDE.md). |

**Key insight:** This phase has a complete working reference in v1.0. The risk is NOT "how do I do RLS" — it's *deviating* from the proven clone. Every new table that isn't a faithful clone of `projects.ts` + `0001_rls.sql` is where a tenant leak hides.

## Runtime State Inventory

> This is an additive greenfield-within-schema phase (new tables only; no rename/migration of existing data). Inventory included because it touches the live migration journal and an existing v1.0 table (`projects` gains a UNIQUE).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No existing rows in the new tables (they don't exist yet). `projects`/`member`/`organization` rows exist in dev/CI but only gain a new UNIQUE constraint on `projects` (no data rewrite). | Code/migration only — `ALTER TABLE projects ADD CONSTRAINT … UNIQUE (id, organization_id)` is additive; no backfill. |
| Live service config | None — events partitions are created by the migration; the BullMQ pre-create job registers in the existing worker. | Worker job registration (code). |
| OS-registered state | None. | None — verified: no scheduler/launchd state references these tables. |
| Secrets/env vars | Reuses existing `DATABASE_URL` / `DATABASE_APP_URL` / `DATABASE_ANON_URL` (+ `TEST_*` variants). New roles? No — reuse `app_authenticated`/`anon`. | None — new GRANTs only (hand SQL). |
| Build artifacts | drizzle `meta/_journal.json` snapshot updates on `db:generate`; new migration files. | Commit generated migration + meta; never hand-edit the snapshot (hand SQL lives in separate `.sql`, snapshot unchanged — verified in 0000/0001 pattern). |

**Nothing found in OS-registered state and Live-service-config beyond the worker job — verified by reading apps/worker and the migrations dir.**

## Common Pitfalls

### Pitfall 1: Owner/migration role bypasses RLS
**What goes wrong:** Tables owned by the migration role ignore policies; absence tests pass for the wrong reason.
**Why:** Table owners bypass RLS by default.
**How to avoid:** `ALTER TABLE … FORCE ROW LEVEL SECURITY` on EVERY new tenant table in the hand SQL migration (clone 0001_rls.sql lines 70-75). The test harness role guard (`tests/setup.ts`) already asserts `rolbypassrls=false` and `rolsuper=false`.
**Warning signs:** An isolation test that "passes" but a manual query as owner returns cross-org rows.

### Pitfall 2: `::uuid` cast against a TEXT org id
**What goes wrong:** `current_setting(...)::uuid` never equals the TEXT `organization_id`; the tenant policy silently matches nothing → absence tests pass vacuously.
**How to avoid:** Always `::text` (org id is TEXT — Better Auth default). Clone the exact `using`/`withCheck` from `projects.ts`. Denormalized `organization_id` columns are `text`, not `uuid`.

### Pitfall 3: events PK without the partition key (FLAG-A)
**What goes wrong:** `CREATE TABLE … id uuid PRIMARY KEY … PARTITION BY RANGE (ts)` fails: *"unique constraint on partitioned table must include all partitioning columns."*
**How to avoid:** `PRIMARY KEY (id, ts)`.

### Pitfall 4: events declared in drizzle.config (FLAG-B)
**What goes wrong:** drizzle-kit emits a plain `CREATE TABLE events` that fights the hand-written partitioned DDL (duplicate table / drift).
**How to avoid:** Keep `events.ts` out of `drizzle.config.ts schema:`; declare it for types only; hand-write the DDL.

### Pitfall 5: anon gets SELECT on private tables
**What goes wrong:** A broad `GRANT SELECT` lets anon enumerate leads/events cross-tenant.
**How to avoid:** `leads`/`events` → `GRANT INSERT` only (D-08). `quotes` → no anon grant. Test that anon SELECT on these throws 42501.

### Pitfall 6: querying a partition directly bypasses the parent policy
**What goes wrong:** A query against `events_2026_06` directly uses the partition's own RLS, not the parent's.
**Why:** RLS is evaluated per relation accessed.
**How to avoid:** ALWAYS query the parent `events` through `withTenant` (the only sanctioned path). Grants are on the parent; partitions are never granted to app/anon directly, so direct partition access fails on privilege anyway. Document this; don't grant partitions individually.

### Pitfall 7: composite FK without the parent UNIQUE
**What goes wrong:** `foreignKey([…, organization_id] → projects[id, organization_id])` errors: *"there is no unique constraint matching given keys."*
**How to avoid:** Add `unique().on(t.id, t.organizationId)` to EVERY parent (including v1.0 `projects`).

## Code Examples

(See Patterns 1-7 above — all are verified clones of v1.0 `projects.ts` / `0001_rls.sql` or confirmed Drizzle 0.45 / PG 16 syntax.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pg_partman` for partition mgmt | Native declarative partitioning + DEFAULT partition + small job | PG 11+ DEFAULT (PG 11), this project (D-06) | No extra extension; all in-journal. |
| Schema-per-tenant | Shared schema + RLS | — (project decision, CLAUDE.md) | RLS in shared schema is correct for MVP. |
| Drizzle `pipeline` / no RLS DDL | `entities.roles:true` emits policy DDL; `.enableRLS()`/`pgPolicy` | drizzle-kit 0.31 | Policies generated into migrations; FORCE RLS still hand-written. |

**Deprecated/outdated:** none relevant — the pinned matrix (drizzle-orm 0.45 / drizzle-kit 0.31 / postgres 16) is current and consistent with v1.0.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RLS policies on a partitioned parent apply when querying through the parent; direct-partition access uses the partition's own RLS | D-07 / Pitfall 6 | LOW — established PG behavior; mitigated because the app only queries the parent and partitions are never granted. Verify with an explicit test (query parent as wrong tenant → 0 rows). |
| A2 | FK FROM a partitioned table to a normal table is supported in PG 16 | FLAG-A / Pattern 2 | LOW — supported since PG 11. The migration will fail loudly at apply time if wrong. |
| A3 | `cac_index` anon-read decision (gated vs global vs tenant-private) | FLAG-D footnote | MEDIUM — affects whether the public cotizador can read CAC. **Needs a planning decision** (default: anon SELECT gated by org having a publicado project, OR feed CAC server-side). |
| A4 | `lead_estado` value is ASCII `negociacion` (no accent) | D-15 note | LOW — discrepancy between modelo (`negociación`) and D-15 (`negociacion`); recommend ASCII, UI renders accent. Confirm in planning. |
| A5 | quotes has NO anon access (tenant-private) | Anon coverage map | LOW — matches "private del tenant" intent; confirm no public-quote-share feature is expected this milestone. |

## Open Questions

1. **cac_index anon visibility** — What we know: CAC is non-sensitive index data the cotizador needs; cac_index is org-scoped (no project_id). What's unclear: should anon read it publicly? Recommendation: default to tenant-private (fed server-side in Fase 3 quoting) OR anon SELECT gated by the org having ≥1 publicado project. Decide in planning (A3).
2. **events partition window + naming** — How many months ahead (D-05 says current + 2-3)? Recommend current + 3, names `events_YYYY_MM`, all idempotent (`CREATE TABLE IF NOT EXISTS`). The DEFAULT partition makes the exact count non-critical.
3. **Does the absence suite need a per-table loop or explicit cases per table?** Recommend explicit cases mirroring the v1.0 style (readable, each table named) but a shared helper to reduce duplication. Keep the role guard.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 16 | All RLS/partition DDL + tests | ✓ (Compose + CI service per memory/STATE) | 16.x | — (hard requirement) |
| Redis 7 | BullMQ partition job (D-06) | ✓ (Compose, worker shell uses it) | 7 | Job is skeleton-only this phase; absence OK locally |
| drizzle-kit CLI | generate + migrate | ✓ (devDep 0.31.10) | 0.31.10 | — |
| drizzle-zod | JSONB/anon Zod schemas | ✗ (not yet installed) | 0.8.3 (to add) | Hand-author Zod without the table-derived helper (more boilerplate) |
| Node 22 | tooling/tests | ✓ (nvm; memory note: shell defaults to 20 — use `nvm use 22`) | 22 LTS | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `drizzle-zod` (install `0.8.3`); without it, JSONB/anon Zod schemas are hand-authored directly (still feasible).

## Validation Architecture

> nyquist_validation is enabled. This section maps each success criterion to an observable, automated test against real Postgres 16.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x (`vitest run`), `globalSetup` migrates the real journal + role guard |
| Config file | `packages/db/vitest.config.ts` (registers `tests/setup.ts` globalSetup) `[VERIFIED: tests/setup.ts header]` |
| Quick run command | `pnpm --filter @imbau/db test` |
| Full suite command | `pnpm --filter @imbau/db test` (same; DB suite is the gate) — plus root `pnpm test` / `pnpm typecheck` / `pnpm lint` |
| DB target | Dedicated `*_test` DB (enforced by `tests/db.ts requireTestDb`); CI points the same vars at the Postgres 16 service |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHEMA-01..05 | each new tenant table: org A sees 0 org B rows (read A→B, B→A); cross-tenant INSERT throws 42501; cross-tenant UPDATE affects 0 rows | integration | `pnpm --filter @imbau/db test` | ❌ Wave 0 (extend `cross-tenant.test.ts` + `helpers.ts`) |
| SCHEMA-03 | quotes has NO anon access (anon SELECT throws 42501) | integration | same | ❌ Wave 0 |
| SCHEMA-06 | events: partitioned insert routes by ts; tenant isolation; insert outside any month lands in DEFAULT | integration | same | ❌ Wave 0 |
| SCHEMA-07 | anon reads ONLY publicado rows of catalog/content tables; zero borrador | integration | same | ❌ Wave 0 (per-table anon case) |
| SCHEMA-04/06 | anon INSERT into leads/events allowed vs publicado project, REJECTED (42501/RLS) vs borrador; anon has NO SELECT on leads/events | integration | same | ❌ Wave 0 |
| SCHEMA-08 (gate) | full suite green vs real PG16 with NOBYPASSRLS roles | integration | `pnpm --filter @imbau/db test` + CI `quality` gate | partial (suite exists; extend) |
| db:migrate-from-zero | `drizzle-kit migrate` applies the full journal cleanly on a fresh DB (no push, no manual) | integration | `pnpm --filter @imbau/db db:migrate` against empty `*_test` DB (globalSetup already does this) | ✓ (globalSetup `migrate()`) |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/db test` (+ `typecheck` on the package)
- **Per wave merge:** full `pnpm test && pnpm typecheck && pnpm lint`
- **Phase gate:** full DB suite green in CI vs Postgres 16 (the `quality` gate) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/helpers.ts` — add `makeFloor`, `makeUnit`, `makePriceList`, `makeUnitPrice`, `makePaymentPlan`, `makeBroker`, `makeLead`, `makeQuote`, `makeProgressPost`, `makeGallery`, `makeMedia`, `makeEvent`, `makeCacIndex` (owner-seeded, unique ids, mirror existing style)
- [ ] `tests/cross-tenant.test.ts` — per-table absence cases + anon-published case + anon insert-only (leads/events) + quotes-no-anon + events-DEFAULT-partition routing
- [ ] Framework install: none (Vitest present); add `drizzle-zod@0.8.3`

*(Test infra exists and is strong; gaps are extensions, not new scaffolding.)*

## Security Domain

> security_enforcement: true, ASVS level 1. This phase IS a security boundary (multi-tenant isolation).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (Phase 0) | Better Auth (already) |
| V3 Session Management | no | session.activeOrganizationId → GUC (Phase 0) |
| V4 Access Control | **yes** | RLS policies (tenant + anon published-only); NOSUPERUSER NOBYPASSRLS roles; FORCE ROW LEVEL SECURITY; composite FK structural integrity |
| V5 Input Validation | **yes** | Zod (drizzle-zod) at the boundary for anon insert + JSONB payloads (D-10/D-12); `pgEnum` constrains state values |
| V6 Cryptography | no | — (no new crypto) |

### Known Threat Patterns for multi-tenant PG + RLS
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read (org A reads org B) | Information Disclosure | tenant policy `using` + FORCE RLS; absence suite (SCHEMA-08) |
| Cross-tenant write (org A writes as org B) | Tampering | tenant policy `withCheck` → INSERT 42501; UPDATE 0 rows; composite FK |
| Anon enumeration of private data (leads/events) | Information Disclosure | INSERT-only grant, no SELECT (D-08); test anon SELECT → 42501 |
| Anon writing to unpublished projects | Tampering | anon INSERT policy `WITH CHECK` publicado-only (D-09) |
| Owner/superuser RLS bypass | Elevation of Privilege | NOSUPERUSER NOBYPASSRLS roles; FORCE RLS; role guard in test harness |
| Float money corruption | Tampering (integrity) | `integer`/`numeric` columns only (D-14) |
| Org-id spoofing via denormalization drift | Tampering | composite FK (D-02) makes mismatch impossible |

## Sources

### Primary (HIGH confidence)
- `packages/db/src/{with-tenant.ts, schema/projects.ts, schema/roles.ts, schema/member-rls.ts, index.ts}` — the v1.0 RLS contract (read in full; GUC key, `::text` cast, policy shape, `.existing()` role pattern)
- `packages/db/migrations/{0000_init.sql, 0001_rls.sql}` — generated+hand split, idempotent role/FORCE RLS/grant pattern, single journal
- `packages/db/{drizzle.config.ts, package.json, tests/{cross-tenant.test.ts, helpers.ts, setup.ts, db.ts}, migrate.ts}` — config (schema array, entities.roles), pinned versions, test harness + role guard
- `docs/modelo-mvp.md §3.3/§3.4` — table/column/enum source of truth
- `CLAUDE.md` — non-negotiable quality, money rules, migrate-only, RLS-on-every-tenant-table
- [postgresql.org/docs/16/ddl-partitioning.html] — partition PK/unique must include partition key `[VERIFIED]`
- [postgresql.org/docs/16/sql-createtable.html] — DEFAULT partition routing `[VERIFIED]`
- [orm.drizzle.team/docs/indexes-constraints] — composite `unique().on()`, `foreignKey({columns, foreignColumns})`, `primaryKey({columns})` `[VERIFIED]`
- npm registry — `drizzle-zod@0.8.3` (OK verdict, 1.9M/wk, drizzle-team repo, peer deps, no postinstall) `[VERIFIED]`

### Secondary (MEDIUM confidence)
- PG 16 RLS-on-partitions inheritance + FK-from-partitioned-table — established behavior (PG 11+/12+); confirmed by reasoning + partial doc fetch, to be re-confirmed by the explicit events isolation test at execution.

### Tertiary (LOW confidence)
- none — all load-bearing claims grounded in code or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all pinned/installed; drizzle-zod verified against registry
- Architecture: HIGH — literal clone of a proven v1.0 pattern read in full
- Pitfalls: HIGH — derived from PG docs + the v1.0 reconciliation comments (Pitfall 1/2 are documented in-code)
- Partition specifics: MEDIUM-HIGH — PK rule + DEFAULT verified in docs; RLS-on-partition inheritance is established behavior to be re-confirmed by test

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable stack; 30 days)
</content>
</invoke>
