// projects — the domain tenant table for phase 2 (D-10/D-11) and its RLS as code.
//
// `projects` is one of EXACTLY TWO tenant-scoped tables this phase (the other is `member`,
// see member-rls.ts). It carries organization_id (FK → organization.id, the canonical
// tenant — D-01) and gets BOTH a tenant policy (app role, GUC-filtered) and an anon
// published-only policy (D-06/D-11). RESEARCH Pattern 2 is the source of truth.
import { pgTable, uuid, text, pgEnum, pgPolicy, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { appAuthenticated, anonRole } from "./roles";

// estado domain enum (modelo-mvp §3.3, D-11). Values stay Spanish — they are DATA values,
// not identifiers; surrounding identifiers stay English (CONTEXT Specific Ideas).
export const estadoEnum = pgEnum("estado", ["borrador", "publicado", "archivado"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // organization_id is `text` to match organization.id (Better Auth default id is TEXT,
    // decided/documented in auth-schema.ts — A1/Pitfall 2). A ::uuid type here would never
    // match the text FK and silently break the tenant filter.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    nombre: text("nombre").notNull(),
    slug: text("slug").notNull(),
    estado: estadoEnum("estado").notNull().default("borrador"),
    // whatsapp — per-project default number for the public WhatsApp CTA (WA-01, D-01).
    // Nullable slot: the broker routing of the maestro phase 5 overrides it later; this is
    // the "slot listo para routing" of WA-01. Exposed to anon via the existing table-level
    // projects_anon_published SELECT policy — NO new pgPolicy needed (only publicado projects
    // reach anon, and the number is intended to be public — it is the CTA target).
    whatsapp: text("whatsapp"),
    // leadsNotifyEmail — per-project recipient for the "nuevo lead" notification (D-05,
    // phase 11). Nullable: null is the valid "fall back to org owners" sentinel resolved by
    // the worker (plan 04); written by projects.updateSettings (plan 03), validated as
    // `.email()` at the Zod boundary. Panel-private: no new pgPolicy — projects_tenant covers
    // reads/writes and projects_anon_published is SELECT-only over public-facing fields.
    leadsNotifyEmail: text("leads_notify_email"),
    // renderExteriorKey — R2 storage key of the building's EXTERIOR render (the background over
    // which floor polygons are drawn in the phase-12 hotspot editor; modelo §P2 / RESEARCH §1).
    // The exact peer of floors.renderKey / units.planoKey: a plain nullable text storage key
    // living directly on its domain table — NOT an FK to `media` (media has no kind/role
    // discriminator, so a designated row would break the floors/units symmetry). Nullable:
    // null → the D-06 empty-state ("Falta el render exterior de este proyecto"). Auto-readable
    // by anon for `publicado` projects via the existing table-level projects_anon_published
    // SELECT policy — a new text column needs ZERO new pgPolicy (the phase-2 explorer consumes
    // it as-is). Written only via the hotspot media pipeline / seed; NEVER a client-supplied key.
    renderExteriorKey: text("render_exterior_key"),
  },
  (t) => [
    // Parent UNIQUE for composite FKs (D-02 / Pitfall 7): every child table org-pins its
    // denormalized organization_id by referencing the pair (id, organization_id). A composite
    // FK requires a matching UNIQUE on the parent. Additive — drizzle-kit emits the ALTER in
    // plan 01-04; non-breaking on existing rows (no backfill).
    unique().on(t.id, t.organizationId),
    // Tenant policy (D-04/D-05): app role only sees/writes rows of the active org.
    // D-05 reconciliation: the GUC is cast `::text` (NOT the literal `::uuid` D-05 wrote)
    // because organization.id is TEXT — a ::uuid cast against text ids never matches and
    // would make the DATA-04 absence tests pass for the wrong reason (Pitfall 2). The
    // second arg `true` (missing_ok) yields default-deny when the GUC is unset. `withCheck`
    // is what makes a cross-tenant INSERT/UPDATE fail (DATA-04 case c). Same cast as
    // member_tenant (member-rls.ts).
    pgPolicy("projects_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
    // Anon published-only policy (D-06/D-11, Pitfall 5): SELECT-only, no tenant GUC; anon
    // sees publicado projects globally and never borrador. GRANT is SELECT-only in 0001_rls.sql.
    pgPolicy("projects_anon_published", {
      as: "permissive",
      for: "select",
      to: anonRole,
      using: sql`${t.estado} = 'publicado'`,
    }),
  ],
).enableRLS();
