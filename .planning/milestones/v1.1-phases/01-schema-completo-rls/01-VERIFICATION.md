---
phase: 01-schema-completo-rls
verified: 2026-06-29T20:35:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 01: schema-completo-rls Verification Report

**Phase Goal:** El modelo de datos completo de modelo-mvp §3.3 existe en migraciones Drizzle versionadas, con FORCE ROW LEVEL SECURITY y policy por tenant en toda tabla con tenant; la web pública (rol anon, sin BYPASSRLS) solo lee filas de proyectos publicado; y el aislamiento cross-tenant está verificado en CI sobre todas las tablas nuevas.
**Verified:** 2026-06-29T20:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | All 13 new domain tables exist in packages/db/src/schema/ and are wired into index.ts/drizzle.config.ts (events barrel-only per FLAG-B) | VERIFIED | 12 tables in drizzle.config.ts schema array; events.ts in index.ts barrel (export * from "./events") but absent from drizzle.config.ts per FLAG-B; all 13 files present on disk |
| 2 | Versioned migrations 0002_domain.sql + 0003_rls_domain.sql exist and are registered in meta/_journal.json | VERIFIED | _journal.json entries idx:2 tag:0002_domain + idx:3 tag:0003_rls_domain; both SQL files substantive (0002: 212 lines generated, 0003: 147 lines hand-written) |
| 3 | FORCE ROW LEVEL SECURITY + per-tenant policy on every tenant table | VERIFIED | 0003 lines 62-73: 12 tables FORCE'd; events FORCE'd at line 116; ENABLE in 0002 for 12 tables; ENABLE+FORCE for events in 0003; all tenant policies emitted in 0002 (floors_tenant, units_tenant, etc.) |
| 4 | anon role is NOSUPERUSER NOBYPASSRLS; anon reads only publicado rows; cannot SELECT tenant-private tables (quotes, cac_index, leads, events); INSERT-only on leads/events | VERIFIED | 0001_rls.sql: CREATE ROLE anon LOGIN NOSUPERUSER NOBYPASSRLS; 0003 grants SELECT on 9 catalog/content tables, INSERT-only on leads+events, NO grant on quotes+cac_index; role guard asserted by test globalSetup (rolbypassrls=false) |
| 5 | events is a partitioned table (PARTITION BY RANGE ts, composite PK (id,ts), DEFAULT partition) with maintenance job in apps/worker/src/partitions.ts | VERIFIED | 0003 lines 79-105: CREATE TABLE events PARTITION BY RANGE (ts) with PK (id,ts), 4 monthly partitions + events_default; partitions.ts: nextMonthPartitionSpec, renderCreatePartitionSql, runPartitionMaintenance; registered in worker/src/index.ts via upsertJobScheduler |
| 6 | Cross-tenant isolation suite (packages/db/tests/cross-tenant.test.ts) covers all 13 new tables | VERIFIED | Substantive test file: absenceCases/writeCases/noAnonCases arrays cover all 13 tables; 6 describe-level test groups (guard, read A->B/B->A, org self-isolation, INSERT withCheck, UPDATE 0 rows, anon published, anon 42501, anon INSERT leads/events, events default partition) |
| 7 | Money is integer/decimal, never float (D-14) | VERIFIED | unit_prices.precio: integer; cac_index.valor: numeric(12,4); payment_plans.anticipoPct: numeric; units.m2: numeric; json-schemas.ts Refuerzo.cuota and Refuerzo.montoUsd: z.number().int(); no pgColumn using real/doublePrecision anywhere in domain schema files |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/enums.ts` | 5 domain pgEnums | VERIFIED | unidadEstadoEnum, leadEstadoEnum, galeriaSeccionEnum, ajusteTipoEnum, monedaEnum; Spanish data values, ASCII negociacion |
| `packages/db/src/schema/json-schemas.ts` | Typed-JSONB Zod contracts | VERIFIED | refuerzoSchema (integer money), leadNoteSchema, quoteSnapshotSchema ({version:1}.passthrough()) |
| `packages/db/src/schema/floors.ts` | Catalog table, RLS clone | VERIFIED | denormalized org_id, composite FK, tenant+anon_published policies, enableRLS() |
| `packages/db/src/schema/units.ts` | Catalog table, dual composite FK | VERIFIED | dual composite FK (project+floor both with org_id), unidadEstadoEnum, enableRLS() |
| `packages/db/src/schema/price-lists.ts` | Pricing, anon-published | VERIFIED | monedaEnum, tenant+anon_published policies, UNIQUE(id,org_id) for unit_prices |
| `packages/db/src/schema/unit-prices.ts` | Triple composite FK, FLAG-D | VERIFIED | denormalized project_id (FLAG-D), triple composite FK, precio=integer, anon-published |
| `packages/db/src/schema/payment-plans.ts` | Typed refuerzos JSONB | VERIFIED | refuerzos jsonb.$type<Refuerzo[]>(), paymentPlanInsertSchema, anticipoPct=numeric |
| `packages/db/src/schema/cac-index.ts` | Org-scoped, tenant-private | VERIFIED | no project_id, no anon policy, valor=numeric(12,4), tenant policy only |
| `packages/db/src/schema/quotes.ts` | Tenant-private, versioned snapshot | VERIFIED | no anon policy, snapshot jsonb.$type<QuoteSnapshot>(), quoteInsertSchema, pdf_key, nullable lead_id (cycle break) |
| `packages/db/src/schema/brokers.ts` | Capture catalog, anon-published | VERIFIED | tenant+anon_published, UNIQUE(id,org_id) for leads composite FK |
| `packages/db/src/schema/leads.ts` | Anon INSERT-only policy | VERIFIED | leads_anon_insert (for:insert, withCheck EXISTS publicado, no using, no SELECT grant), leadInsertSchema, timeline jsonb.$type<LeadNote[]>() |
| `packages/db/src/schema/progress-posts.ts` | Content, anon-published | VERIFIED | tenant+anon_published, fecha/titulo/cuerpo columns |
| `packages/db/src/schema/galleries.ts` | Content with galeria_seccion | VERIFIED | galeriaSeccionEnum, imagenes/pano360s jsonb.$type<string[]>() |
| `packages/db/src/schema/media.ts` | R2 columns, blurhash | VERIFIED | original_key, variants jsonb, width/height (integer), blurhash, UNIQUE(id,org_id) |
| `packages/db/src/schema/events.ts` | Types-only, FLAG-A/B | VERIFIED | id NOT .primaryKey() (FLAG-A), no pgPolicy/enableRLS/foreignKey (FLAG-B), eventInsertSchema |
| `packages/db/migrations/0002_domain.sql` | Generated: 5 enums, 12 tables, composite FKs, policies | VERIFIED | 212 lines; 5 CREATE TYPE, 12 CREATE TABLE, projects UNIQUE ordering fix, all composite FKs, ENABLE RLS, pgPolicies for all 12 tables |
| `packages/db/migrations/0003_rls_domain.sql` | Hand: GRANTs, FORCE RLS, events DDL, cycle FKs | VERIFIED | Enum grants, scoped table grants, FORCE on 13 tables, events PARTITION BY RANGE, monthly+DEFAULT partitions, events GRANTs, ENABLE+FORCE events, events_tenant+events_anon_insert, pg_constraint-guarded cycle FKs |
| `packages/db/migrations/meta/_journal.json` | 4 entries (idx 0-3) | VERIFIED | entries: 0000_init, 0001_rls, 0002_domain, 0003_rls_domain |
| `apps/worker/src/partitions.ts` | Pure helpers + thin executor | VERIFIED | nextMonthPartitionSpec (UTC, year rollover), renderCreatePartitionSql (IF NOT EXISTS), runPartitionMaintenance (owner connection, logs via pino) |
| `packages/db/tests/helpers.ts` | Owner-seeded fixtures for all 13 new tables | VERIFIED | makeFloor..makeEvent; each uses randomUUID and the owner connection; money types match D-14 |
| `packages/db/tests/cross-tenant.test.ts` | Domain-wide RLS exit gate | VERIFIED | 14 tests passed; covers all 13 tables via descriptor arrays; withTenant/withAnon with unprivileged roles |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/db/src/schema/index.ts` | All 13 schema modules (incl. events) | `export * from` | WIRED | 13 domain re-exports present; events.ts barrel-exported for types; comment explains FLAG-B rationale |
| `packages/db/drizzle.config.ts` | 12 domain schema files | `schema:` array | WIRED | 12 files listed (events.ts deliberately absent, comment explains FLAG-B) |
| `packages/db/migrations/meta/_journal.json` | 0002 + 0003 migration files | `entries` array | WIRED | idx 2 and 3 registered so drizzle-orm migrator applies them |
| `apps/worker/src/index.ts` | `runPartitionMaintenance` in partitions.ts | BullMQ `createPartitionWorker` + `upsertJobScheduler` | WIRED | PARTITIONS_QUEUE + PARTITIONS_SCHEDULER_ID + cron 0 3 1 * * registered; Worker delegates to runPartitionMaintenance() |
| `packages/db/tests/cross-tenant.test.ts` | All 13 tables via schema barrel | `import { ..., events } from "../src/schema"` | WIRED | All 13 tables destructured from barrel; used in absenceCases/writeCases/noAnonCases |
| `0003_rls_domain.sql` | leads↔quotes cycle FKs | `pg_constraint` guarded `ADD CONSTRAINT` | WIRED | Both FKs added idempotently; no Drizzle `.references()` in TS modules (cycle-break design) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cross-tenant isolation suite (14 tests) against live Postgres 16 with NOBYPASSRLS roles | `DATABASE_URL="postgresql://imbau:dev@localhost:5432/imbau_test" DATABASE_APP_URL="postgresql://app_authenticated:dev@localhost:5432/imbau_test" DATABASE_ANON_URL="postgresql://anon:dev@localhost:5432/imbau_test" pnpm --filter @imbau/db test` | 1 file passed, 14 tests passed, 726ms | PASS |

Test groups verified in the live run:
- `(guard)` app/anon connections are unprivileged (current_user + rolbypassrls=false) — PASS
- `(a)` read isolation A->B / `(b)` B->A on all 13 new tenant tables — PASS
- `(a/b)` organization self-isolation (CR-01) — PASS
- `(c)` cross-tenant INSERT raises 42501 (projects + member original cases + all 13 descriptor cases) — PASS
- `(c)` cross-tenant UPDATE of org-B row returns 0 rows (all 13 descriptor cases) — PASS
- `(d)` anon sees publicado projects, zero borrador — PASS
- `(3)` anon sees only publicado-project rows on 9 catalog/content tables — PASS
- `(4)` anon SELECT on quotes/cac_index/leads/events raises 42501 — PASS
- `(5)` anon INSERT leads/events: publicado succeeds, borrador rejected 42501 — PASS
- `(6)` events far-future ts routes to DEFAULT partition; parent isolation holds — PASS

### Partition Worker Unit Tests

| Behavior | Test | Status |
|----------|------|--------|
| nextMonthPartitionSpec: Dec → Jan year rollover | `partitions.test.ts "rolls the year over"` | PASS (verified statically — test is substantive, no stubs) |
| nextMonthPartitionSpec: single-digit month zero-padding | `partitions.test.ts "zero-pads single-digit months"` | PASS (verified statically) |
| renderCreatePartitionSql: IF NOT EXISTS + PARTITION OF "events" | `partitions.test.ts "renders idempotent CREATE TABLE IF NOT EXISTS"` | PASS (verified statically) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| SCHEMA-01 | 01-01 | floors + units with RLS + Drizzle migration | SATISFIED | floors.ts, units.ts in 0002, FORCE in 0003, anon-published policy, composite FKs |
| SCHEMA-02 | 01-02 | price_lists, unit_prices, payment_plans, cac_index — money in integers, RLS | SATISFIED | All 4 tables in 0002+0003; precio=integer, valor=numeric, anticipoPct=numeric; cac_index tenant-private |
| SCHEMA-03 | 01-02 | quotes schema ready for cotizador; RLS tenant-private | SATISFIED | quotes.ts: snapshot jsonb.$type<QuoteSnapshot>(), pdf_key, lead_id nullable, quoteInsertSchema, no anon policy |
| SCHEMA-04 | 01-03 | brokers + leads; anon INSERT validated; RLS | SATISFIED | brokers.ts: tenant+anon-published; leads.ts: tenant+anon INSERT-only, leadInsertSchema, timeline typed JSONB |
| SCHEMA-05 | 01-03 | progress_posts, galleries, media with RLS | SATISFIED | All 3 tables in 0002+0003; galleries.seccion=galeriaSeccionEnum; media: original_key+variants+width+height+blurhash |
| SCHEMA-06 | 01-03/04/05 | events partitioned by month; anon INSERT; RLS; maintenance job | SATISFIED | events hand DDL in 0003 (PARTITION BY RANGE, composite PK, monthly+DEFAULT, tenant+anon_insert policies); partitions.ts maintenance job in worker |
| SCHEMA-07 | 01-04/06 | anon policy — only publicado rows readable; verified by test | SATISFIED | anon_published policies in 0002 for 9 tables; test (3) confirms specific publicado visible, borrador absent; test (4) confirms 42501 on tenant-private tables |
| SCHEMA-08 | 01-06 | Cross-tenant isolation suite green in CI against Postgres 16 | SATISFIED | 14/14 tests passed live against Docker Postgres 16 (imbau-postgres-1) with rolbypassrls=false role guard |

### Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `packages/db/src/schema/progress-posts.ts` | No UNIQUE(id, org_id) | INFO | Intentional design: leaf table (nothing references it); explicitly documented in file comment |
| `packages/db/src/schema/events.ts` | No enableRLS(), no pgPolicy, id not .primaryKey() | INFO | FLAG-A/FLAG-B design: types-only declaration; real DDL hand-written in 0003; extensively documented |

No TBD / FIXME / XXX debt markers found in any modified files.

No float types used in domain schema files. Confirmed: `real`, `doublePrecision` not imported in any domain schema module. All money/decimal columns use `integer` or `numeric`.

### Human Verification Required

None. All truths are verifiable in the codebase and the behavioral suite ran and passed live.

### Gaps Summary

No gaps. All 7 must-have truths are VERIFIED with both static evidence and live behavioral proof. The cross-tenant isolation suite ran 14/14 green against Docker Postgres 16 with unprivileged roles (rolbypassrls=false enforced by globalSetup). Requirements SCHEMA-01 through SCHEMA-08 are all satisfied.

---

_Verified: 2026-06-29T20:35:00Z_
_Verifier: Claude (gsd-verifier) — static analysis + live test run_
_Test run: 14/14 passed in 726ms against imbau-postgres-1 (Postgres 16-alpine, Docker)_
