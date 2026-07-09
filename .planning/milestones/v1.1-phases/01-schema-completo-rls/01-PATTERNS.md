# Phase 01: Schema completo + RLS - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 13 new tenant tables + 2 JSONB/enum helper modules + 4 modified infra files + 3 test files + 1 worker job + 2 hand/generated migrations
**Analogs found:** 22 / 22 (this phase CLONES a fully-proven v1.0 RLS template — every new file has an exact in-repo analog)

> **Core directive (from RESEARCH §400):** "This phase has a complete working reference in v1.0. The risk is NOT 'how do I do RLS' — it's *deviating* from the proven clone. Every new table that isn't a faithful clone of `projects.ts` + `0001_rls.sql` is where a tenant leak hides." Copy the analog line-for-line; change only column lists, table/policy names, and parent FK targets.

---

## File Classification

### New schema files (each = clone of `projects.ts`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/db/src/schema/floors.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/units.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/price-lists.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/unit-prices.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact (+ denorm `project_id`, FLAG-D) |
| `packages/db/src/schema/payment-plans.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact (+ typed JSONB `refuerzos`) |
| `packages/db/src/schema/cac-index.ts` | model (org-scoped table) | CRUD | `packages/db/src/schema/projects.ts` | role-match (org-scoped, no `project_id`) |
| `packages/db/src/schema/quotes.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact (NO anon policy; typed JSONB `snapshot`) |
| `packages/db/src/schema/brokers.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/leads.ts` | model (tenant table) | event-driven (anon insert) | `packages/db/src/schema/projects.ts` | exact (+ anon INSERT-only policy; typed JSONB `timeline`) |
| `packages/db/src/schema/progress-posts.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/galleries.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact (+ `galeria_seccion` enum) |
| `packages/db/src/schema/media.ts` | model (tenant table) | CRUD | `packages/db/src/schema/projects.ts` | exact |
| `packages/db/src/schema/events.ts` | model (partitioned, TYPES-ONLY) | event-driven (anon insert) | `packages/db/src/schema/projects.ts` (table shape) + `0001_rls.sql` (DDL) | role-match (FLAG-A PK `(id,ts)`, FLAG-B NOT in drizzle.config; DDL hand-written) |
| `packages/db/src/schema/enums.ts` | config (pgEnum decls) | n/a | `projects.ts` lines 12-14 (`estadoEnum`) | exact |
| `packages/db/src/schema/json-schemas.ts` | utility (Zod + types) | transform/validate | NEW — no prior JSONB in v1.0 | no analog (use RESEARCH Patterns 6/7) |

### Modified infra files

| Modified File | Role | Change | Analog/Reference |
|---------------|------|--------|------------------|
| `packages/db/src/schema/index.ts` | config (barrel) | add `export * from "./<each-new-file>"` | existing lines 23-26 |
| `packages/db/drizzle.config.ts` | config | add each new schema file to `schema:` array — **EXCEPT `events.ts`** (FLAG-B) | existing lines 15-21 |
| `packages/db/src/schema/projects.ts` | model | add `unique().on(t.id, t.organizationId)` so children can composite-FK it (D-02) | additive ALTER |
| `packages/db/package.json` | config | add `drizzle-zod@0.8.3` dep | RESEARCH Standard Stack |

### Migrations

| File | Role | Source | Analog |
|------|------|--------|--------|
| `packages/db/migrations/0002_*.sql` | migration (generated) | `drizzle-kit generate` — all new tables/enums/FKs/ENABLE RLS/pgPolicies | `0000_init.sql` (generated) |
| `packages/db/migrations/0003_*.sql` | migration (hand) | new GRANTs + FORCE RLS on every new tenant table + ALL events DDL (partitions) | `packages/db/migrations/0001_rls.sql` (exact pattern) |

### Tests + worker

| File | Role | Change | Analog |
|------|------|--------|--------|
| `packages/db/tests/helpers.ts` | test (fixtures) | add `makeFloor`, `makeUnit`, `makeLead`, `makeEvent`, … | existing `makeProject`/`makeMember` |
| `packages/db/tests/cross-tenant.test.ts` | test (isolation) | per-table absence cases + anon insert-only (leads/events) + quotes-no-anon + events DEFAULT routing | existing cases (a)-(d) |
| `apps/worker/src/partitions.ts` | utility (BullMQ job) | repeatable job pre-creating next-month events partition | `apps/worker/src/index.ts` (queue/worker shell) |

---

## Pattern Assignments

### Every project-scoped tenant table (floors, units, price-lists, unit-prices, payment-plans, quotes, brokers, leads, progress-posts, galleries, media)

**Analog:** `packages/db/src/schema/projects.ts` (read in full, 55 lines — the literal template)

**Imports pattern** (projects.ts lines 7-10):
```typescript
import { pgTable, uuid, text, pgEnum, pgPolicy } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { appAuthenticated, anonRole } from "./roles";
```
> New tables additionally import `{ foreignKey, unique, integer, numeric, jsonb }` from `drizzle-orm/pg-core` as needed, `import { projects } from "./projects"`, and enum/Zod from `./enums` / `./json-schemas`.

**Denormalized `organization_id` column** (projects.ts lines 20-25) — copy verbatim, `text` not `uuid` (Pitfall 2):
```typescript
// organization_id is `text` to match organization.id (Better Auth default id is TEXT ...).
// A ::uuid type here would never match the text FK and silently break the tenant filter.
organizationId: text("organization_id")
  .notNull()
  .references(() => organization.id, { onDelete: "cascade" }),
```

**Tenant policy — FLAT CLONE of `projects_tenant`** (projects.ts lines 38-44) — change only the policy name:
```typescript
pgPolicy("floors_tenant", {              // <-- only this name changes per table
  as: "permissive",
  for: "all",
  to: appAuthenticated,
  using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
  withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
}),
```
> `::text` cast is load-bearing (Pitfall 2). The `true` (missing_ok) second arg yields default-deny when GUC unset. `withCheck` is what fails cross-tenant INSERT/UPDATE.

**Anon published-only policy — child-table variant (FLAG-D)** — differs from `projects_anon_published` (projects.ts lines 47-52, which uses `estado = 'publicado'` directly). Child tables have no `estado` column, so use single-level EXISTS on denormalized `project_id`:
```typescript
pgPolicy("floors_anon_published", {
  as: "permissive",
  for: "select",
  to: anonRole,
  using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
}),
```

**Composite FK + parent UNIQUE** (D-02 / Pitfall 7) — new pattern, not in projects.ts; tableConfig callback returns array:
```typescript
}, (t) => [
  foreignKey({ columns: [t.projectId, t.organizationId],
              foreignColumns: [projects.id, projects.organizationId] }).onDelete("cascade"),
  unique().on(t.id, t.organizationId),   // so child tables can composite-FK THIS table (D-02)
  pgPolicy(...), pgPolicy(...),
]).enableRLS();
```
> Every parent needs `unique().on(t.id, t.organizationId)` — including v1.0 `projects` (additive ALTER). `units → floors`, `unit_prices → units` AND `→ price_lists` (both composite). Leaf tables that nothing references skip the `unique()`.

**`.enableRLS()`** terminal call (projects.ts line 54) — required on every table.

---

### Table-specific deltas

**`unit-prices.ts`** — add denormalized `project_id` (FLAG-D) so its anon policy is the same single-level EXISTS; keep BOTH hierarchical composite FKs (`→ units`, `→ price_lists`) plus `(project_id, organization_id) → projects`.

**`payment-plans.ts` / `quotes.ts` / `leads.ts`** — typed JSONB (D-12/D-13), no v1.0 analog. Use RESEARCH Pattern 6/7:
```typescript
import { jsonb } from "drizzle-orm/pg-core";
refuerzos: jsonb("refuerzos").$type<Refuerzo[]>().notNull().default(sql`'[]'::jsonb`),
snapshot:  jsonb("snapshot").$type<QuoteSnapshot>().notNull(),     // quotes
timeline:  jsonb("timeline").$type<LeadNote[]>().notNull().default(sql`'[]'::jsonb`),  // leads
```
> drizzle-zod infers `z.any()` for jsonb — plug the hand-authored validator: `createInsertSchema(paymentPlans, { refuerzos: z.array(refuerzoSchema) })`.

**`quotes.ts`** — NO anon policy at all (tenant-private, A5). Only the tenant policy + no anon GRANT in hand SQL.

**`cac-index.ts`** — org-scoped, no `project_id` (D-09 footnote). Tenant policy as usual; anon-read is an **OPEN QUESTION** (RESEARCH A3 / Open Q1) — planner decides: tenant-private (default) vs anon SELECT gated by org having a publicado project.

**`leads.ts`** — add anon INSERT-only policy (RESEARCH Pattern 3, D-08/D-09), INSERT uses `withCheck` only (no `using`):
```typescript
pgPolicy("leads_anon_insert", {
  as: "permissive", for: "insert", to: anonRole,
  withCheck: sql`exists (select 1 from ${projects} p
    where p.id = ${t.projectId} and p.estado = 'publicado')`,
}),
// + hand SQL: GRANT INSERT ON "leads" TO anon;  (NO SELECT — D-08)
```

**`galleries.ts`** — `galeria_seccion` pgEnum (D-15). Enum decl pattern from projects.ts line 14.

**`enums.ts`** (new module) — clone projects.ts line 12-14 enum style, Spanish data values / English identifiers (D-15):
```typescript
export const unidadEstadoEnum = pgEnum("unidad_estado", ["disponible", "reservado", "vendido"]);
export const leadEstadoEnum = pgEnum("lead_estado", ["nuevo", "contactado", "negociacion", "cerrado"]); // ASCII (A4)
export const galeriaSeccionEnum = pgEnum("galeria_seccion", ["amenities", "exteriores", "interiores"]);
export const ajusteTipoEnum = pgEnum("ajuste_tipo", ["CAC", "fijo"]);
export const monedaEnum = pgEnum("moneda", ["USD", "ARS"]);
```
> Reuse existing `estadoEnum` from projects.ts — do NOT redeclare.

**Money columns (D-14)** — `integer("precio")` for USD whole units; `numeric("valor", { precision: 12, scale: 4 })` for `cac_index.valor`. NEVER `real`/`doublePrecision`.

---

### `events.ts` (partitioned table — TYPES ONLY)

**Analog (table shape):** `projects.ts`; **Analog (DDL):** `0001_rls.sql`. Special handling per FLAG-A + FLAG-B.

- Declare `pgTable("events", {...})` for `$inferInsert`/`$inferSelect` + co-located Zod ONLY.
- `id: uuid("id").notNull().defaultRandom()` — **NOT `.primaryKey()`** (FLAG-A: partitioned PK must include partition key → composite `(id, ts)` in hand SQL).
- `ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow()` — partition key.
- Re-export from barrel `index.ts`, but **do NOT add to `drizzle.config.ts` `schema:`** (FLAG-B — else drizzle-kit emits a colliding plain `CREATE TABLE`).
- ALL events DDL (table + `PARTITION BY RANGE (ts)` + monthly partitions + DEFAULT + composite FK + GRANTs + FORCE RLS + BOTH policies as hand `CREATE POLICY`) goes in `0003_*.sql`. See RESEARCH Pattern 2 §305-335 for the exact SQL.

---

### Hand migration `0003_*.sql`

**Analog:** `packages/db/migrations/0001_rls.sql` (read in full, 76 lines) — replicate its idempotent style exactly.

**Idempotent role/grant block** (0001_rls.sql lines 35-50) — the `DO $$ ... IF NOT EXISTS` + DEV-only env-guarded password pattern. New roles? NO — reuse `app_authenticated`/`anon` (RESEARCH Runtime Inventory). Only new GRANTs + FORCE RLS needed.

**Scoped GRANT pattern** (0001_rls.sql lines 52-68) — for each new tenant table:
```sql
GRANT USAGE ON TYPE "public"."unidad_estado" TO app_authenticated, anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "floors" TO app_authenticated;--> statement-breakpoint
GRANT SELECT ON "floors" TO anon;--> statement-breakpoint   -- catalog/content tables (anon-published)
-- leads/events: GRANT INSERT ONLY, no SELECT (D-08/Pitfall 5)
-- quotes: NO anon grant at all
```
> Note the `--> statement-breakpoint` separator and `GRANT USAGE ON TYPE` for every new enum (0001_rls.sql line 54).

**FORCE RLS block** (0001_rls.sql lines 70-75) — one line per new tenant table (Pitfall 1):
```sql
ALTER TABLE "floors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- ... every new tenant table, including events (on the partitioned parent — D-07)
```

---

### `tests/helpers.ts` (extend, don't rewrite)

**Analog:** existing `makeProject` (lines 44-60) / `makeMember` (lines 79-95).

**Pattern** (owner-seeded, unique ids, no rollback) — clone `makeProject` per table:
```typescript
export async function makeFloor(orgId: string, projectId: string): Promise<string> {
  const id = randomUUID();
  await ownerDb().db.insert(floors).values({ id, organizationId: orgId, projectId, numero: 1, ... });
  return id;
}
```
> Seeding runs as OWNER (bypasses RLS — intentional, setup only). Only ASSERTIONS run as unprivileged role. Add: `makeFloor`, `makeUnit`, `makePriceList`, `makeUnitPrice`, `makePaymentPlan`, `makeBroker`, `makeLead`, `makeQuote`, `makeProgressPost`, `makeGallery`, `makeMedia`, `makeEvent`, `makeCacIndex` (RESEARCH Wave 0 Gaps).

### `tests/cross-tenant.test.ts` (extend)

**Analog:** existing cases (a)-(d) lines 126-259 + the role guard (lines 92-124) + `rlsViolationInChain` helper (lines 71-89).

**Per-table absence pattern** — clone case (a)/(b) read-isolation, case (c) INSERT-throws (assert via `rlsViolationInChain`) + UPDATE-affects-0-rows (`.returning().length`), case (d) anon-published. Add NEW cases:
- `quotes`: anon SELECT throws 42501 (no anon grant — SCHEMA-03).
- `leads`/`events`: anon INSERT allowed vs `publicado`, REJECTED vs `borrador`; anon SELECT throws 42501 (D-08/D-16).
- `events`: insert routes by `ts` to correct partition; out-of-range insert lands in DEFAULT (D-05).
- Keep the role guard intact — it proves `rolbypassrls=false`.

### `apps/worker/src/partitions.ts` (new job)

**Analog:** `apps/worker/src/index.ts` (Queue/Worker shell, lines 24-60). Add a **repeatable** BullMQ job that idempotently `CREATE TABLE IF NOT EXISTS` next-month's events partition (D-06). Phase 1 = skeleton job + migration-seeded partitions only; retention/detach deferred.

---

## Shared Patterns

### Tenant policy (the contract — applies to ALL new tenant tables)
**Source:** `packages/db/src/schema/projects.ts` lines 38-44
**Apply to:** every new schema file (flat clone, change only policy name). `::text` cast mandatory (Pitfall 2). `current_setting('app.current_organization_id', true)` matches the GUC set by `withTenant`.

### Role targeting
**Source:** `packages/db/src/schema/roles.ts` lines 11-14
```typescript
export const appAuthenticated = pgRole("app_authenticated").existing();
export const anonRole = pgRole("anon").existing();
```
**Apply to:** every `pgPolicy({ to: ... })`. Do NOT redeclare roles — real attributes live in hand SQL.

### Data access
**Source:** `packages/db/src/with-tenant.ts` lines 22-39
**Apply to:** all tests/consumers. `withTenant(orgId, fn)` sets GUC via parameterized `set_config(..., true)`; `withAnon(fn)` sets no GUC. **No new helpers** — new policies work automatically under these.

### Hand-SQL idempotency
**Source:** `packages/db/migrations/0001_rls.sql` lines 35-50, 70-75
**Apply to:** `0003_*.sql` — `DO/IF NOT EXISTS` blocks, `--> statement-breakpoint` separators, DEV-only env-guarded password (`imbau.env <> 'production'`), FORCE RLS per table.

### Single migration journal
**Source:** `0000_init.sql` (generated) + `0001_rls.sql` (hand) + `drizzle.config.ts`
**Apply to:** `0002_*.sql` (generated) + `0003_*.sql` (hand). One journal, `pnpm db:generate` then `pnpm db:migrate` ONLY — **never `drizzle-kit push`, never manual edits** (CLAUDE.md, non-negotiable). A generic schema-push gate must be overridden: this project is migrate-only.

### Barrel + config registration (three places per table)
**Source:** `index.ts` lines 10-26, `drizzle.config.ts` lines 15-21
**Apply to:** every new table → (1) `export * from "./<file>"` in `index.ts`, (2) add file to `drizzle.config.ts schema:` array **EXCEPT `events.ts`** (FLAG-B), (3) the schema file itself. Never point drizzle.config at the barrel (duplicate-policy error).

---

## No Analog Found

| File | Role | Data Flow | Reason | Use Instead |
|------|------|-----------|--------|-------------|
| `packages/db/src/schema/json-schemas.ts` | utility (Zod + types) | transform | No JSONB exists in v1.0 schema | RESEARCH Patterns 6/7 (`refuerzoSchema`, `quoteSnapshotSchema` envelope, drizzle-zod `createInsertSchema` refine) |
| events partition DDL (in `0003_*.sql`) | migration | event-driven | No partitioned table in v1.0 | RESEARCH Pattern 2 §305-335 (clone `0001_rls.sql` idempotent style for the surrounding GRANT/FORCE/CREATE POLICY) |

---

## Planner Flags (from RESEARCH — resolve before/within planning)

- **FLAG-A:** events PK MUST be `(id, ts)` (partition key in PK) — hand-written.
- **FLAG-B:** keep `events.ts` OUT of `drizzle.config.ts schema:`; events policies are hand `CREATE POLICY`, not `pgPolicy`.
- **FLAG-D:** every project-scoped table carries denormalized `project_id` (incl. `unit_prices`) for the uniform single-level anon-published EXISTS.
- **Open Q1 / A3:** `cac_index` anon visibility — planner decides (default tenant-private vs anon-gated).
- **A4:** `lead_estado` value is ASCII `negociacion` (UI renders accent).

## Metadata

**Analog search scope:** `packages/db/src/schema/`, `packages/db/migrations/`, `packages/db/tests/`, `apps/worker/src/`
**Files scanned:** projects.ts, roles.ts, index.ts, drizzle.config.ts, 0001_rls.sql, helpers.ts, cross-tenant.test.ts, with-tenant.ts, worker/index.ts (+ dir listings)
**Pattern extraction date:** 2026-06-26
