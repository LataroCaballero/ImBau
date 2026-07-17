// progress_posts — obra/avance content table (SCHEMA-05), a faithful clone of projects.ts RLS.
//
// modelo §3.3: project, fecha, titulo, media. A progress post is project-scoped content shown on
// the published site. Per D-01 it carries the denormalized organization_id (TEXT, FK →
// organization.id); per D-02 it composite-FKs (project_id, organization_id) → projects; per
// FLAG-D the anon-published policy is a single-level EXISTS against projects.estado. `media_id`
// is a PLAIN nullable uuid (no FK) — pointing at a media row without an ordering/coupling
// constraint between the two content tables (the worker pipeline fills media later, Fase 2).
// This is a leaf table (nothing references it) so it needs no UNIQUE (id, organization_id).
import { pgTable, uuid, text, timestamp, pgPolicy, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";

export const progressPosts = pgTable(
  "progress_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key. Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    fecha: timestamp("fecha", { withTimezone: true }).notNull(),
    titulo: text("titulo").notNull(),
    // Plain nullable pointer to a media row (no FK — avoids ordering coupling between content
    // tables; the Fase-2 pipeline populates media).
    mediaId: uuid("media_id"),
    cuerpo: text("cuerpo"),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("progress_posts_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS on parent.
    pgPolicy("progress_posts_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
