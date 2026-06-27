// brokers — capture-domain catalog table (SCHEMA-04), a faithful clone of projects.ts RLS.
//
// A broker belongs to a project (modelo §3.3: project, nombre, slug del link, whatsapp, email).
// Per D-01 it carries the denormalized organization_id (TEXT — the canonical tenant, FK →
// organization.id) so its tenant policy is a FLAT clone of projects_tenant (NOT a join). Per
// D-02 it carries the natural project_id and composite-FKs (project_id, organization_id) →
// projects (id, organization_id), making a mismatched organization_id physically impossible.
// Per FLAG-D the anon-published policy is a single-level EXISTS against projects.estado. It
// also exposes UNIQUE (id, organization_id) so `leads` can composite-FK (broker_id, org_id).
import { pgTable, uuid, text, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";

export const brokers = pgTable(
  "brokers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key. Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    nombre: text("nombre").notNull(),
    // slug del link de broker (modelo §3.3).
    slug: text("slug").notNull(),
    whatsapp: text("whatsapp"),
    email: text("email"),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so leads can composite-FK brokers on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast (org id is TEXT); second
    // arg `true` (missing_ok) yields default-deny when the GUC is unset; withCheck blocks
    // cross-tenant writes. Identical shape to projects.ts / floors.ts / units.ts.
    pgPolicy("brokers_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS gating
    // visibility on the parent project being `publicado` (broker links live on published sites).
    pgPolicy("brokers_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
