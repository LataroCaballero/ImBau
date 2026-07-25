// leads — the public capture table (SCHEMA-04). A clone of projects.ts RLS PLUS an anon
// INSERT-only policy: the public site WRITES leads but NEVER reads them (D-08).
//
// modelo §3.3: project, unit?, broker?, quote?, nombre, contacto, origen, estado
// [nuevo|contactado|negociacion|cerrado], timeline de notas.
//
// Tenancy (D-01/D-02): denormalized organization_id (TEXT, FK → organization.id) + a PRIMARY
// composite FK (project_id, organization_id) → projects, so org-pinning is structural. The
// SECONDARY composite FKs (unit_id, organization_id) → units and (broker_id, organization_id)
// → brokers are nullable (MATCH SIMPLE: skipped when the pointer is NULL) and keep the optional
// unit/broker references inside the SAME tenant. `quote_id` is a PLAIN nullable uuid with NO
// Drizzle `.references()` — this breaks the leads↔quotes reference cycle (the real FK is added
// in the hand migration 01-04). `estado` uses lead_estado (ASCII `negociacion`, D-15) and
// `timeline` is a typed LeadNote[] JSONB (D-12). The co-located `leadInsertSchema` validates the
// anon timeline payload at the boundary (D-10); the public ingestion endpoint + its rate-limit
// are NOT built this phase (D-11) — only the DB policy + Zod schema land here.
import { pgTable, uuid, text, jsonb, pgPolicy, foreignKey, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./auth-schema";
import { projects } from "./projects";
import { units } from "./units";
import { brokers } from "./brokers";
import { appAuthenticated, anonRole } from "./roles";
import { leadEstadoEnum } from "./enums";
import { leadNoteSchema, type LeadNote } from "./json-schemas";

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized tenant key (D-01). TEXT to match organization.id (Pitfall 2).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Natural parent FK + anon EXISTS key. PRIMARY composite-FK'd to projects below.
    projectId: uuid("project_id").notNull(),
    // Optional in-tenant pointers. Composite-FK'd to units/brokers below (nullable, MATCH SIMPLE).
    unitId: uuid("unit_id"),
    brokerId: uuid("broker_id"),
    // quote_id: plain nullable uuid, NO Drizzle .references() — cycle break (quotes.lead_id
    // references leads). The real FK lands in the hand migration 01-04.
    quoteId: uuid("quote_id"),
    nombre: text("nombre").notNull(),
    contacto: text("contacto").notNull(),
    origen: text("origen"),
    estado: leadEstadoEnum("estado").notNull().default("nuevo"),
    // desenlace — closed-outcome flag (D-03, phase 11). Nullable `text` validated as
    // `ganado`|`perdido` at the Zod boundary (leads.updateEstado, plan 03), mirroring how
    // `origen` above is plain text: the `leadEstadoEnum` is DELIBERATELY untouched — the
    // ganado/perdido distinction lives in this cheap, forward-compatible sidecar column
    // (consumed by D4/fase 6 conversion metrics). Null outside `cerrado`; set only on the
    // transition INTO `cerrado`.
    desenlace: text("desenlace"),
    // Typed JSONB timeline (D-12). drizzle-zod infers z.any() for jsonb, so the runtime gate is
    // the co-located leadInsertSchema below; $type<LeadNote[]> is the compile-time contract.
    timeline: jsonb("timeline")
      .$type<LeadNote[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    // PRIMARY composite FK (D-02): (project_id, organization_id) → projects (id, organization_id).
    foreignKey({
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    // SECONDARY composite FK: (unit_id, organization_id) → units (nullable in-tenant pointer).
    // MATCH SIMPLE skips the check when unit_id is NULL; when set, it pins the unit to this tenant.
    foreignKey({
      columns: [t.unitId, t.organizationId],
      foreignColumns: [units.id, units.organizationId],
    }).onDelete("set null"),
    // SECONDARY composite FK: (broker_id, organization_id) → brokers (nullable in-tenant pointer).
    foreignKey({
      columns: [t.brokerId, t.organizationId],
      foreignColumns: [brokers.id, brokers.organizationId],
    }).onDelete("set null"),
    // Parent UNIQUE so quotes can composite-FK leads on (id, organization_id).
    unique().on(t.id, t.organizationId),
    // Tenant policy — flat clone of projects_tenant. `::text` cast (org id is TEXT); default-deny
    // via missing_ok. The panel/API reads + manages leads tenant-scoped through this policy.
    pgPolicy("leads_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon INSERT-only policy (D-08/D-09, RESEARCH Pattern 3): the public site writes a lead
    // against a publicado project. INSERT → `withCheck` ONLY, NO `using` (Postgres ignores USING
    // for INSERT). The EXISTS rejects writes to borrador/archivado projects (42501). There is
    // deliberately NO anon-published SELECT policy — anon writes leads but NEVER reads them
    // (D-08); the hand migration 01-04 grants anon INSERT only (no SELECT).
    pgPolicy("leads_anon_insert", {
      as: "permissive",
      for: "insert",
      to: anonRole,
      withCheck: sql`exists (select 1 from ${projects} p where p.id = ${t.projectId} and p.estado = 'publicado')`,
    }),
  ],
).enableRLS();

// Boundary validator for the anon ingestion payload (D-10). drizzle-zod infers z.any() for the
// jsonb timeline, so refine it with the hand-authored leadNoteSchema array — the SAME shape the
// column is typed with. The public endpoint + rate-limit are Fase-2 (D-11); only this schema lands.
export const leadInsertSchema = createInsertSchema(leads, {
  timeline: z.array(leadNoteSchema),
});
