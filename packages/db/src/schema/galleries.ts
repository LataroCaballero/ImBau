// galleries — content table (SCHEMA-05), a faithful clone of projects.ts RLS.
//
// modelo §3.3: project, seccion [amenities|exteriores|interiores], imagenes, pano360s. A gallery
// groups media ids (and 360 panoramas) under a section for a project's published site. Per D-01
// it carries the denormalized organization_id (TEXT, FK → organization.id); per D-02 it
// composite-FKs (project_id, organization_id) → projects; per FLAG-D the anon-published policy is
// a single-level EXISTS against projects.estado. `seccion` is constrained by the galeria_seccion
// enum. `imagenes`/`pano360s` are typed string[] JSONB (lists of media ids). This is a leaf table
// (nothing references it) so it needs no UNIQUE (id, organization_id).
import { pgTable, uuid, text, jsonb, pgPolicy, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";
import { galeriaSeccionEnum } from "./enums";

export const galleries = pgTable(
  "galleries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key. Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    seccion: galeriaSeccionEnum("seccion").notNull(),
    // Lists of media ids (typed JSONB). The panel curates these; the column shape is string[].
    imagenes: jsonb("imagenes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    pano360s: jsonb("pano360s")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("galleries_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS on parent.
    pgPolicy("galleries_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
