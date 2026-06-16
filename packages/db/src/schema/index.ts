// Schema barrel — re-exports every table/enum/policy/role so drizzle-kit (schema glob
// ./src/schema/*.ts) and consumers see one surface. JIT package: raw .ts re-exports,
// `export *` per verbatimModuleSyntax (these are value exports: tables, enums, roles).
//
// auth-schema.ts is the faithful Better Auth fold (Task 1). Task 2 adds roles.ts,
// projects.ts, and member-rls.ts (the latter overlays the tenant RLS policy +
// .enableRLS() onto the `member` table, re-exported decorated).
export * from "./auth-schema";
