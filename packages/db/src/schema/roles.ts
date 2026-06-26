// DB role existence-stubs for policy `to:` targeting (RESEARCH Pattern 2 / FLAG-2).
//
// Drizzle's pgRole only models { createDb, createRole, inherit } — it CANNOT express
// LOGIN / PASSWORD / NOSUPERUSER / NOBYPASSRLS. The real `CREATE ROLE ...` with those
// attributes is hand-written SQL in migrations/0001_rls.sql (D-04). Declaring the roles
// `.existing()` here lets pgPolicy(..., { to }) reference them by identity without
// drizzle-kit trying to emit a (capability-incomplete) CREATE ROLE for them.
import { pgRole } from "drizzle-orm/pg-core";

// Runtime app role: NOSUPERUSER NOBYPASSRLS, no table ownership (real attrs in 0001_rls.sql).
export const appAuthenticated = pgRole("app_authenticated").existing();

// Anonymous public-read role: NOSUPERUSER NOBYPASSRLS, SELECT-only on publicado projects.
export const anonRole = pgRole("anon").existing();
