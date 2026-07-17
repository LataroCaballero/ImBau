// Schema barrel — re-exports every table/enum/policy/role so drizzle-kit (schema glob
// ./src/schema/*.ts) and consumers see one surface. JIT package: raw .ts re-exports.
//
// auth-schema.ts is the faithful Better Auth fold. member-rls.ts overlays the tenant RLS
// policy onto `member` and re-exports it decorated; organization-rls.ts does the same for
// `organization` (CR-01). So `member` and `organization` are re-exported from their *-rls
// overlay modules (NOT auth-schema) to avoid a duplicate-export conflict — the rest of the
// auth tables come straight from the fold. projects.ts + roles.ts add the domain table,
// enum, policies, and role stubs.
export {
  user,
  session,
  account,
  verification,
  invitation,
  userRelations,
  sessionRelations,
  accountRelations,
  organizationRelations,
  memberRelations,
  invitationRelations,
} from "./auth-schema";
export * from "./roles";
export * from "./projects";
export * from "./member-rls";
export * from "./organization-rls";
// Domain schema (01-01/02/03). Every new module is re-exported here so consumers (tests,
// worker, api) see one surface — including events.ts, whose pgTable is re-exported for its
// $inferInsert/$inferSelect type + Zod schema even though it is excluded from drizzle.config
// (FLAG-B: its partition DDL is hand-written in migration 0003, not generated).
export * from "./enums";
export * from "./json-schemas";
export * from "./floors";
export * from "./units";
export * from "./price-lists";
export * from "./unit-prices";
export * from "./payment-plans";
export * from "./cac-index";
export * from "./quotes";
export * from "./brokers";
export * from "./leads";
export * from "./progress-posts";
export * from "./galleries";
export * from "./media";
export * from "./events";
