// floors — catálogo table (SCHEMA-01), a faithful clone of projects.ts RLS template.
//
// A floor is project-scoped. Per D-01 it carries a DENORMALIZED organization_id (TEXT — the
// canonical tenant, FK → organization.id) so its tenant policy is a FLAT clone of
// projects_tenant (NOT a join through projects). Per D-02 it also carries the natural
// project_id and composite-FKs the pair (project_id, organization_id) → projects (id,
// organization_id), which makes a mismatched organization_id physically impossible. Per
// FLAG-D the anon-published policy is a single-level EXISTS against projects.estado.
import { pgTable, uuid, text, integer, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";

export const floors = pgTable(
  "floors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Better Auth default —
    // Pitfall 2); a ::uuid type here would never match the text FK and break the tenant filter.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key (FLAG-D). Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    numero: integer("numero").notNull(),
    nombre: text("nombre"),
    // Render de planta (storage key) + polígono sobre el render exterior (modelo §3.3).
    renderKey: text("render_key"),
    poligonoSvg: text("poligono_svg"),
  },
  (t) => [
    // Composite FK org-pinning (D-02 / Pitfall 7): ties (project_id, organization_id) to the
    // parent's UNIQUE(id, organization_id) — a row whose organization_id drifts from its
    // project's is rejected by the DB, not a trigger.
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so units can composite-FK floors on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast (org id is TEXT); second
    // arg `true` (missing_ok) yields default-deny when the GUC is unset; withCheck blocks
    // cross-tenant writes. Identical shape to projects.ts / member-rls.ts.
    pgPolicy("floors_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): SELECT-only, single-level EXISTS gating
    // visibility on the parent project being `publicado`. anon already has SELECT on projects
    // restricted to publicado (projects_anon_published), so the EXISTS is naturally gated; the
    // explicit estado='publicado' is defensive and clear.
    pgPolicy("floors_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();
