// Public barrel for @imbau/db. The sanctioned data path is withTenant/withAnon (never the
// raw clients); `schema` is exposed so callers can build typed queries, and the `db`
// instances are re-exported for advanced/owner-side use (migrations, tooling). JIT
// package: raw .ts re-exports; `export type` for any type-only surface (verbatimModuleSyntax).
export { withTenant, withAnon } from "./with-tenant";
export { appDb, anonDb, createOwnerDb } from "./client";
export * as schema from "./schema";
