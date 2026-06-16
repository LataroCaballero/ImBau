// projects — the domain tenant table for phase 2 (D-10/D-11) and its RLS as code.
//
// `projects` is one of EXACTLY TWO tenant-scoped tables this phase (the other is `member`,
// see member-rls.ts). It carries organization_id (FK → organization.id, the canonical
// tenant — D-01) and gets BOTH a tenant policy (app role, GUC-filtered) and an anon
// published-only policy (D-06/D-11). RESEARCH Pattern 2 is the source of truth.
import { pgTable, uuid, text, pgEnum, pgPolicy } from "drizzle-orm/pg-core";
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
  },
  (t) => [
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
