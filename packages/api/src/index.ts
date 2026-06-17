// Public barrel for @imbau/api. The Better Auth runtime is the first real export (D-01);
// the tRPC router, Zod boundary and TanStack Query wiring land in plan 03-02. JIT package:
// raw .ts re-exports, `export type` for type-only surface (verbatimModuleSyntax).
export { auth } from "./auth/runtime";
export type { Auth } from "./auth/runtime";
export { ac, owner, developer, viewer } from "./auth/access-control";
