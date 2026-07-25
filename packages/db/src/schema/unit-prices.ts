// unit_prices — pricing table (SCHEMA-02), a faithful clone of projects.ts RLS template
// with FLAG-D applied.
//
// A unit_price ties a unit to a price_list with a precio and a vigencia. Per D-01 it carries
// a DENORMALIZED organization_id (TEXT). Per FLAG-D it ALSO carries a denormalized project_id
// so the anon-published policy is the SAME uniform single-level EXISTS the rest of the
// catálogo uses (no two-level join through units). Per D-02 it is org-pinned by THREE composite
// FKs that all share this row's organization_id column: the PRIMARY (project_id, organization_id)
// → projects, plus (unit_id, organization_id) → units and (price_list_id, organization_id) →
// price_lists. Because all three parents must share one organization_id, a cross-tenant price
// (unit of org A priced against a list of org B) is structurally impossible.
//
// Money rule (D-14, CLAUDE.md): `precio` is an `integer` (USD whole units), NEVER float
// (`real`/`doublePrecision`).
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgPolicy,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { units } from "./units";
import { priceLists } from "./price-lists";
import { appAuthenticated, anonRole } from "./roles";

export const unitPrices = pgTable(
  "unit_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // FLAG-D: denormalized project_id so the anon policy is the uniform single-level EXISTS.
    // Composite-FK'd to projects below (PRIMARY org-pin).
    projectId: uuid("project_id").notNull(),
    // Natural FKs — both composite-FK'd below to share this row's organization_id.
    unitId: uuid("unit_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    // precio — USD whole units. integer (D-14), NEVER float.
    precio: integer("precio").notNull(),
    // vigencia — effective timestamp. UTC in DB (CLAUDE.md), render in BA tz.
    vigencia: timestamp("vigencia", { withTimezone: true }).notNull(),
  },
  (t) => [
    // PRIMARY composite FK (D-02 / FLAG-D): (project_id, organization_id) → projects.
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // SECONDARY composite FK (D-02): (unit_id, organization_id) → units. Shares the same
    // organization_id column → ties the priced unit to this row's tenant.
    foreignKey({
      columns: [t.unitId, t.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("cascade"),
    // SECONDARY composite FK (D-02): (price_list_id, organization_id) → price_lists. Same
    // organization_id column → list and unit cannot belong to different tenants.
    foreignKey({
      columns: [t.priceListId, t.organizationId],
      foreignColumns: [priceLists.id, priceLists.organizationId],
    }).onDelete("cascade"),
    // Natural-key UNIQUE (GRID-05, D-01): at most one price row per (unit_id, price_list_id).
    // Enforces the v1.2 cotizador's one-row-per-unit×list invariant at the DB (not by convention)
    // and provides the conflict target every grid/Excel upsert (Plan 03) relies on.
    unique("unit_prices_unit_list_uq").on(t.unitId, t.priceListId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("unit_prices_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): single-level EXISTS on the parent
    // project, keyed off this row's denormalized project_id (NOT a join through units).
    pgPolicy("unit_prices_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
