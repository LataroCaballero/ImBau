// units — catálogo table (SCHEMA-01), a faithful clone of projects.ts RLS template.
//
// A unit lives under a floor (modelo §3.3). It carries the denormalized organization_id
// (D-01, TEXT) plus BOTH natural FKs: project_id and floor_id. Two composite FKs org-pin it
// (D-02): the PRIMARY (project_id, organization_id) → projects, and the SECONDARY
// (floor_id, organization_id) → floors. Because both parents share the same organization_id
// column on this row, a cross-tenant insert (unit of org A pointing at a floor of org B) is
// structurally impossible. estado uses the unidad_estado enum.
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  pgPolicy,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { floors } from "./floors";
import { appAuthenticated, anonRole } from "./roles";
import { unidadEstadoEnum } from "./enums";

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural FKs + anon EXISTS key. Both composite-FK'd below.
    projectId: uuid("project_id").notNull(),
    floorId: uuid("floor_id").notNull(),
    identificador: text("identificador").notNull(), // e.g. "4B"
    tipologia: text("tipologia"),
    // m2 — surface area; numeric (decimal), never float (D-14, CLAUDE.md money/measure rule).
    m2: numeric("m2"),
    orientacion: text("orientacion"),
    ambientes: integer("ambientes"),
    // Plano amoblado (storage key) (modelo §3.3).
    planoKey: text("plano_key"),
    estado: unidadEstadoEnum("estado").notNull().default("disponible"),
    poligonoSvg: text("poligono_svg"),
    orden: integer("orden"),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // SECONDARY composite FK (D-02): (floor_id, organization_id) → floors (id, organization_id).
    // Shares the same organization_id column → ties the unit's floor and project to one tenant.
    foreignKey({
      columns: [t.floorId, t.organizationId],
      foreignColumns: [floors.id, floors.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so unit_prices / quotes / leads / events can composite-FK units later.
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("units_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): single-level EXISTS on the parent project.
    pgPolicy("units_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
