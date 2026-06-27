// media — asset table (SCHEMA-05), a faithful clone of projects.ts RLS.
//
// modelo §3.3: project, original + variantes (keys de R2), dimensiones, blurhash. A media row
// records the R2 storage key of an uploaded original plus the derived variants (AVIF/WebP srcset
// keys) the Fase-2 worker pipeline produces. The schema exists now; `variants`/`blurhash` are
// populated later. Per D-01 it carries the denormalized organization_id (TEXT, FK →
// organization.id); per D-02 it composite-FKs (project_id, organization_id) → projects; per
// FLAG-D the anon-published policy is a single-level EXISTS against projects.estado. It exposes
// UNIQUE (id, organization_id) so future tables can composite-FK media on the tenant pair.
import { pgTable, uuid, text, integer, jsonb, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key. Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    // R2 storage key of the original upload.
    originalKey: text("original_key").notNull(),
    // Derived R2 variant keys (e.g. { "avif-800": "...", "webp-400": "..." }). Fase-2 fills these;
    // typed Record<string,string> JSONB, default empty object.
    variants: jsonb("variants")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so future tables can composite-FK media on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("media_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS on parent.
    pgPolicy("media_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
