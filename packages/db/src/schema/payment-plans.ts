// payment_plans — pricing table (SCHEMA-02), a faithful clone of projects.ts RLS template.
//
// A payment plan is project-scoped (anticipo %, cuotas, ajuste, refuerzos, notas legales).
// Per D-01 it carries a DENORMALIZED organization_id (TEXT) → flat tenant policy. Per D-02 it
// composite-FKs (project_id, organization_id) → projects. Per FLAG-D the anon-published policy
// is a single-level EXISTS on projects.estado. It exposes UNIQUE(id, organization_id) so quotes
// can composite-FK it.
//
// refuerzos is typed JSONB (D-12): jsonb().$type<Refuerzo[]>(). drizzle-zod infers z.any() for
// jsonb, so the co-located `paymentPlanInsertSchema` refines refuerzos with the hand-authored
// `refuerzoSchema` — the runtime gate callers import.
import { pgTable, uuid, text, integer, numeric, jsonb, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { appAuthenticated, anonRole } from "./roles";
import { ajusteTipoEnum } from "./enums";
import { refuerzoSchema, type Refuerzo } from "./json-schemas";

export const paymentPlans = pgTable(
  "payment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key (FLAG-D). Composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    nombre: text("nombre").notNull(),
    // anticipo % — a percentage; numeric (decimal), never float (D-14).
    anticipoPct: numeric("anticipo_pct").notNull(),
    cuotas: integer("cuotas").notNull(),
    // ajuste basis — CAC | fijo (modelo §3.3).
    ajuste: ajusteTipoEnum("ajuste").notNull(),
    // refuerzos — typed JSONB array of balloon payments (D-12). Default empty array via SQL
    // literal so a row with no refuerzos is well-formed. Validated by paymentPlanInsertSchema.
    refuerzos: jsonb("refuerzos").$type<Refuerzo[]>().notNull().default(sql`'[]'::jsonb`),
    notasLegales: text("notas_legales"),
  },
  (t) => [
    // Composite FK org-pinning (D-02): (project_id, organization_id) → projects.
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // Parent UNIQUE so quotes can composite-FK payment_plans on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast; default-deny via missing_ok.
    pgPolicy("payment_plans_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (SCHEMA-07 / FLAG-D): single-level EXISTS on the parent project.
    pgPolicy("payment_plans_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();

// Boundary validator (D-12): drizzle-zod infers z.any() for jsonb, so refuerzos MUST be refined
// with the hand-authored schema. Callers (API/panel) import this to validate inserts.
export const paymentPlanInsertSchema = createInsertSchema(paymentPlans, {
  refuerzos: z.array(refuerzoSchema),
});
