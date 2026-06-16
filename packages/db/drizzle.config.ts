import { defineConfig } from "drizzle-kit";

// drizzle-kit config (DATA-02). Runs as a CLI tool OUTSIDE the app boot path, so it
// reads process.env.DATABASE_URL directly (no createEnv here). DATABASE_URL is the
// OWNER/migration connection string (NOT the app URL): migrations run as the
// privileged owner role that owns the tables and creates the app_authenticated/anon
// roles (D-04). entities.roles:true is REQUIRED so role/policy DDL is emitted into
// migrations. The schema folder is created in plan 02; the glob can reference it now.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./migrations",
  entities: {
    roles: true,
  },
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
