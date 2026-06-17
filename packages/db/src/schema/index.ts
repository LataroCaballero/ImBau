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
