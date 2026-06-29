import { defineConfig } from "drizzle-kit";

// drizzle-kit config (DATA-02). Runs as a CLI tool OUTSIDE the app boot path, so it
// reads process.env.DATABASE_URL directly (no createEnv here). DATABASE_URL is the
// OWNER/migration connection string (NOT the app URL): migrations run as the
// privileged owner role that owns the tables and creates the app_authenticated/anon
// roles (D-04). entities.roles:true is REQUIRED so role/policy DDL is emitted into
// migrations. The schema folder is created in plan 02; the glob can reference it now.
export default defineConfig({
  dialect: "postgresql",
  // Point at the concrete schema source files, NOT the barrel (index.ts). A glob that
  // includes index.ts would re-read every table/policy through its re-exports, making
  // drizzle-kit see each entity twice (e.g. "duplicated policy member_tenant"). The
  // barrel is for consumers; drizzle-kit reads the sources directly.
  schema: [
    "./src/schema/auth-schema.ts",
    "./src/schema/roles.ts",
    "./src/schema/projects.ts",
    "./src/schema/member-rls.ts",
    "./src/schema/organization-rls.ts",
    // Domain modules (01-01/02/03). events.ts is DELIBERATELY ABSENT (FLAG-B): drizzle-kit has
    // no PARTITION BY support, so listing it would emit a plain non-partitioned `CREATE TABLE
    // "events"` that collides with the hand-written partition DDL in 0003_rls_domain.sql. ALL
    // events DDL (partitions, composite FK, FORCE RLS, both policies) is hand-authored there.
    "./src/schema/enums.ts",
    "./src/schema/json-schemas.ts",
    "./src/schema/floors.ts",
    "./src/schema/units.ts",
    "./src/schema/price-lists.ts",
    "./src/schema/unit-prices.ts",
    "./src/schema/payment-plans.ts",
    "./src/schema/cac-index.ts",
    "./src/schema/quotes.ts",
    "./src/schema/brokers.ts",
    "./src/schema/leads.ts",
    "./src/schema/progress-posts.ts",
    "./src/schema/galleries.ts",
    "./src/schema/media.ts",
  ],
  out: "./migrations",
  entities: {
    roles: true,
  },
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
