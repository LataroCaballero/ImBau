// price_lists — pricing table (SCHEMA-02), a faithful clone of projects.ts RLS template.
//
// A price list is project-scoped (e.g. "contado USD", "financiado", "lista broker X").
// Per D-01 it carries a DENORMALIZED organization_id (TEXT — the canonical tenant,
// FK → organization.id) so its tenant policy is a FLAT clone of projects_tenant. Per D-02
// it also carries the natural project_id and composite-FKs the pair
// (project_id, organization_id) → projects (id, organization_id), making a mismatched
// organization_id physically impossible. Per FLAG-D the anon-published policy is a
// single-level EXISTS against projects.estado. It exposes UNIQUE(id, organization_id) so
// unit_prices can composite-FK it (id, organization_id).
import { pgTable, uuid, text, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";
import { monedaEnum } from "./enums";

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key (FLAG-D). Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    nombre: text("nombre").notNull(),
    // Currency for the list (modelo §3.3). moneda enum — USD | ARS.
    moneda: monedaEnum("moneda").notNull(),
  },
  (t) => [
    // Composite FK org-pinning (D-02 / Pitfall 7): ties (project_id, organization_id) to the
    // parent's UNIQUE(id, organization_id) — a row whose organization_id drifts from its
    // project's is rejected by the DB.
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so unit_prices can composite-FK price_lists on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast (org id is TEXT); second
    // arg `true` (missing_ok) yields default-deny when the GUC is unset; withCheck blocks
    // cross-tenant writes. Identical shape to projects.ts / floors.ts.
    pgPolicy("price_lists_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS gating
    // visibility on the parent project being `publicado`. Mirrors floors_anon_published.
    pgPolicy("price_lists_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
