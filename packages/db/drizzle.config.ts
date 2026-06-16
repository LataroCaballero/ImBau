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
  ],
  out: "./migrations",
  entities: {
    roles: true,
  },
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
