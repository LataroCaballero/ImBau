// cac_index — pricing reference table (SCHEMA-02). The ORG-SCOPED, TENANT-PRIVATE exception
// (resolved decision A3 / D-09 footnote).
//
// Unlike the rest of the catálogo, cac_index is NOT project-scoped: it is one CAC value per org
// per período (manual monthly load; scraping later). So it carries organization_id (TEXT) but
// NO project_id, and it is TENANT-PRIVATE: ONLY a tenant policy (app role, GUC-filtered) — NO
// anon policy and NO anon GRANT. The hand migration (01-04) grants app DML only; anon SELECT
// therefore raises 42501 (asserted in 01-06). valor is `numeric` decimal — never float (D-14).
import { pgTable, uuid, text, numeric, pgPolicy, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth-schema";
import { appAuthenticated } from "./roles";

export const cacIndex = pgTable(
  "cac_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Tenant key (D-01). TEXT to match organization.id (Pitfall 2). NO project_id (org-scoped).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // período — e.g. "2026-06" (one value per org per month).
    periodo: text("periodo").notNull(),
    // valor — CAC index value; numeric decimal (D-14), never float.
    valor: numeric("valor", { precision: 12, scale: 4 }).notNull(),
  },
  (t) => [
    // One value per org per período.
    unique().on(t.organizationId, t.periodo),
    // Tenant policy ONLY (tenant-private — A3). `::text` cast; default-deny via missing_ok.
    // NO anon policy: cac_index is never exposed to the public web.
    pgPolicy("cac_index_tenant", {
      as: "permissive",
      for: "all",
      to: appAuthenticated,
      using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
      withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
    }),
  ],
).enableRLS();
