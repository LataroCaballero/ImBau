# Phase 2: Data Layer + RLS - Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 13 new/modified
**Analogs found:** 6 with codebase analogs / 13 total (7 are net-new concerns → RESEARCH.md is source of truth)

> Greenfield data-layer phase. Phase 1 established the conventions worth copying: JIT packages (`src/*.ts` exports, no build/`dist`), Zod env presets composed per-consumer via `@t3-oss/env-core`, `package.json`/`tsconfig.json` shapes, and the Vitest discovery model. The RLS/Drizzle/Better-Auth/transaction-helper concerns have **no codebase analog** — for those, the verified excerpts in `02-RESEARCH.md` (Patterns 1–4) are the source of truth, not invention.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/db/package.json` (modify) | config | — | `apps/worker/package.json` + `packages/config/package.json` | exact (shape) |
| `packages/db/tsconfig.json` (keep) | config | — | `packages/db/tsconfig.json` (itself) | exact |
| `packages/db/src/index.ts` (replace) | model/barrel | — | `packages/config/package.json` exports + `packages/db/src/index.ts` (current barrel) | role-match |
| `packages/db/src/schema/auth-schema.ts` (new, generated) | model | — | none (BA CLI output) | no analog → RESEARCH P1 |
| `packages/db/src/schema/projects.ts` (new) | model | CRUD | none (first Drizzle table) | no analog → RESEARCH P2 |
| `packages/db/src/schema/policies.ts` / inline | model | — (access control) | none (first RLS) | no analog → RESEARCH P2 |
| `packages/db/src/schema/roles.ts` (new) | model | — | none (first `pgRole`) | no analog → RESEARCH P2 |
| `packages/db/src/client.ts` (new) | provider | request-response | none (first DB driver wiring) | no analog → RESEARCH P3 |
| `packages/db/src/with-tenant.ts` (new) | utility | transform/request-response | none (first txn helper) | no analog → RESEARCH P3 |
| `packages/db/src/env.ts` (new) | config | — | `apps/worker/src/env.ts` | exact |
| `packages/config/env/presets.ts` (modify) | config | — | `packages/config/env/presets.ts` (itself) | exact |
| `packages/db/drizzle.config.ts` (new) | config | — | none (first drizzle config) | no analog → RESEARCH structure §194 |
| `packages/db/migrations/*.sql` + `*_rls.sql` (new) | migration | — | none (first migrations) | no analog → RESEARCH P2/FLAG-2 |
| `packages/db/auth.ts` (new) | config | — | none (BA generator config) | no analog → RESEARCH P1 |
| `packages/db/tests/*.ts` (new) | test | — | `apps/web/env.test.ts` (Vitest style only) | partial (idiom) |
| `compose.yml` (new, repo root) | config/infra | — | none (no compose in repo) | no analog → RESEARCH "Docker Compose" §451 |

## Pattern Assignments

### `packages/db/package.json` (config — modify)

**Analog:** `apps/worker/package.json` (deps + scripts) + `packages/config/package.json` (multi-entry exports).

**JIT export style — keep single `.` entry pointing at raw `src` (no `dist`)** — current `packages/db/package.json` lines 4-8:
```json
"type": "module",
"exports": {
  ".": "./src/index.ts"
}
```
If consumers (drizzle-kit, tests) need subpath imports (`@imbau/db/schema`, `@imbau/db/client`), add subpath exports the same way `packages/config/package.json` lines 6-13 does — point each at the raw `.ts`, never a build output.

**Scripts pattern** — copy worker's `lint`/`typecheck`/`test` (worker `package.json` lines 8-11), add `db:generate` / `db:migrate` invoking drizzle-kit. Test script convention is `"test": "vitest run"` (worker line 11).

**Dependency placement** — runtime deps (`drizzle-orm@0.45.2`, `postgres@3.4.9`, `better-auth@1.6.18`) in `dependencies`; dev-only generators/tooling (`drizzle-kit@0.31.10`, `@better-auth/cli@1.4.21`) in `devDependencies`, mirroring worker's split (deps lines 13-17 vs devDeps 18-23). Keep `@imbau/config: workspace:*` and pin `typescript: 5.9.3` exactly as the current db `package.json` lines 14-15. Per-version pins are exact (no `^`).

---

### `packages/db/tsconfig.json` (config — keep as-is)

**Analog:** itself (already correct). Lines 1-4:
```json
{
  "extends": "@imbau/config/tsconfig/base.json",
  "include": ["src"]
}
```
`base.json` already gives `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` (`packages/config/tsconfig/base.json` lines 4-16). **Note for planner:** `include` is `["src"]` only — `drizzle.config.ts`, `auth.ts`, and `tests/` live outside `src`, so either widen `include` or add a second tsconfig for those, otherwise typecheck/lint won't cover them. The JIT-package convention is `verbatimModuleSyntax: true` → use `import type` for type-only imports in all new files.

---

### `packages/db/src/env.ts` (config — new)

**Analog:** `apps/worker/src/env.ts` (exact pattern to replicate).

**Composition pattern** (`apps/worker/src/env.ts` lines 1-22):
```ts
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, dbEnv, redisEnv } from "@imbau/config/env/presets";

export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...dbEnv.server,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```
Compose **only** the presets db uses (fail-fast, D-02 fase 1). Do NOT override `onValidationError` — the default formatter prints variable NAME + reason, never the value (security V7). Add `@t3-oss/env-core@0.13.11` + `zod@4.4.3` to db deps (worker `package.json` lines 14-16) since `src/env.ts` imports them.

---

### `packages/config/env/presets.ts` (config — modify)

**Analog:** itself. Current `dbEnv` (lines 14-16):
```ts
export const dbEnv = {
  server: { DATABASE_URL: z.string().url() },
} as const;
```
**Extend** to the three-URL shape RESEARCH Pattern 4 (§366-376) requires for D-04's two-role split — keep `DATABASE_URL` as the owner/migration string, add the app + anon URLs:
```ts
export const dbEnv = {
  server: {
    DATABASE_URL: z.string().url(),       // owner/migration role (DDL) — existing
    DATABASE_APP_URL: z.string().url(),   // app_authenticated (runtime queries)
    DATABASE_ANON_URL: z.string().url(),  // anon (published-only reads)
  },
} as const;
```
Match the existing idiom exactly: presets declare variable NAMES + Zod schemas only, never values; `as const`; one preset object per concern. The file's header comment (lines 3-6) forbids speculative presets — these three are justified by D-04/D-06, not speculative. Exact var names are planner discretion (CONTEXT "Claude's Discretion").

---

### `packages/db/src/index.ts` (barrel — replace placeholder)

**Analog:** current placeholder (`packages/db/src/index.ts` lines 1-5) is what gets replaced; the export-barrel discipline mirrors `packages/config/package.json` exports. Public surface to export: `withTenant`, `withAnon`, the drizzle `db` instances, and `* as schema`. Keep it a thin re-export barrel (RESEARCH structure §208). Use `export type` for type-only re-exports (`verbatimModuleSyntax`).

---

### Net-new concerns — NO codebase analog (use RESEARCH.md verbatim)

These have no precedent in the repo. The planner must follow `02-RESEARCH.md` (verified against pinned type defs) rather than inventing:

| File | Source of truth in RESEARCH.md |
|------|-------------------------------|
| `packages/db/auth.ts` (BA generator config) | Pattern 1 §219-258 + Pitfall 3 §428. Minimal config, `additionalFields.plan`, run `@better-auth/cli@1.4.21 generate` — **dev-only, no runtime**. |
| `packages/db/src/schema/auth-schema.ts` | Generated then folded (D-03). **Verify id type** (text vs uuid) per Pitfall 2 §422 / Assumption A1 §558 before writing policies. |
| `packages/db/src/schema/projects.ts` | Pattern 2 §272-307. `estadoEnum` `[borrador|publicado|archivado]`, `organization_id` FK typed to match generated `organization.id`, `pgPolicy` tenant + anon, `.enableRLS()`. |
| `packages/db/src/schema/roles.ts` | Pattern 2 §265-271. `pgRole("app_authenticated").existing()`, `pgRole("anon").existing()` — existence stubs only. |
| `packages/db/migrations/*_rls.sql` (hand-appended) | Pattern 2 §308-325 + FLAG-2 §123. `CREATE ROLE … NOSUPERUSER NOBYPASSRLS LOGIN`, GRANTs, `ALTER TABLE … FORCE ROW LEVEL SECURITY`. Drizzle CANNOT emit these. Open Q2 §571: dedicated migration file in the same journal. Passwords injected at migrate time, never committed (A5 §562). |
| `packages/db/src/client.ts` | Pattern 3 §332-343. `postgres()` app pool as `app_authenticated`, separate `anon` pool, `drizzle(client, { schema })`. |
| `packages/db/src/with-tenant.ts` | Pattern 3 §345-362 + FLAG-3 §124. `db.transaction()` + `set_config('app.current_organization_id', ${orgId}, true)` PARAMETERIZED — never interpolate into `SET LOCAL`. `withAnon` opens an anon-pool txn with no GUC. |
| `packages/db/drizzle.config.ts` | RESEARCH structure §197 + Standard Stack. `entities.roles: true`, schema + migrations paths, uses the owner/`DATABASE_URL`. |
| `compose.yml` (repo root) | "Docker Compose (DATA-01)" §451-477. Postgres `16-alpine` + Redis `7-alpine`, healthchecks, named `pgdata` volume. Confirm host ports 5432/6379 free (A4 §561). |

---

### `packages/db/tests/*.ts` (test — new)

**Analog (idiom only):** `apps/web/env.test.ts` — for Vitest import/structure conventions (`import { describe, it, expect } from "vitest"`, lines 1; `describe`/`it`/`expect` style). The **harness architecture itself has no analog** — follow RESEARCH "Validation Architecture" §493-522 (setup once: migrate + create roles; per-test fresh orgs A/B, no rollback; assert `current_user` is `app_authenticated`/`anon` and `rolbypassrls=false`). Test discovery is per-package via the Turbo `test` task against `src/**` cwd (`vitest.config.ts` lines 8-16) — note tests live in `tests/` not `src/`, so confirm the discovery glob reaches them (planner: either place tests under `src/` or adjust include). The 4 exit-gate cases (a–d) + role guard are spelled out in RESEARCH §516-522.

## Shared Patterns

### JIT package layout (no build, raw `src/*.ts` exports)
**Source:** `packages/config/package.json` lines 6-13, `packages/db/package.json` lines 6-8.
**Apply to:** all `packages/db` files. Exports point at `.ts`; no `dist/`, no `build` script for the package's own code (drizzle-kit `generate`/`migrate` are commands, not a TS build). `verbatimModuleSyntax` → `import type` for types.

### Env preset composition (fail-fast, per-consumer)
**Source:** `apps/worker/src/env.ts` lines 1-22; presets in `packages/config/env/presets.ts`.
**Apply to:** `packages/db/src/env.ts`. Spread only needed presets into `createEnv`; default error formatter (never leak values, V7); `skipValidation` gated on `SKIP_ENV_VALIDATION`.
```ts
import { createEnv } from "@t3-oss/env-core";
import { baseEnv, dbEnv } from "@imbau/config/env/presets";
export const env = createEnv({
  server: { ...baseEnv.server, ...dbEnv.server },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```

### Strict TS via shared base config
**Source:** `packages/config/tsconfig/base.json` lines 4-16; `packages/db/tsconfig.json` lines 1-4.
**Apply to:** every new `.ts`. `extends` the base; no per-file relaxation. No `any` without a justifying comment (CLAUDE.md). Respect `noUncheckedIndexedAccess`.

### Exact version pinning + workspace deps
**Source:** `apps/worker/package.json` (e.g. `zod: 4.4.3`, `typescript: 5.9.3`), `packages/config/package.json`.
**Apply to:** `packages/db/package.json`. Pin to exact versions from the RESEARCH Standard Stack (no `^`/`~`); internal deps as `workspace:*`.

### Turbo task / Vitest discovery
**Source:** `turbo.json` lines 11-14 (`test` dependsOn `^build`), `vitest.config.ts` lines 8-16.
**Apply to:** db's `test` script = `vitest run`; tests discovered relative to invocation cwd (no root-anchored include). **Planner note:** the existing `test` task `dependsOn ["^build"]` — fine, but db's own tests need Compose Postgres running; that is a runtime precondition, not a turbo dep.

### `.env.example` per consumer (no real secrets)
**Source:** `apps/worker/.env.example` (exists), `.gitignore` allows only `.env.example`.
**Apply to:** add a `packages/db/.env.example` documenting `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL` with placeholder values. Real role passwords never committed (RESEARCH A5; SOPS is phase 4).

## No Analog Found

| File | Role | Reason | Use Instead |
|------|------|--------|-------------|
| `packages/db/auth.ts` | config | First Better Auth config in repo | RESEARCH Pattern 1 §219 |
| `packages/db/src/schema/{projects,policies,roles,auth-schema}.ts` | model | First Drizzle schema / first RLS in repo | RESEARCH Pattern 2 §260 |
| `packages/db/src/client.ts` | provider | First DB driver wiring | RESEARCH Pattern 3 §332 |
| `packages/db/src/with-tenant.ts` | utility | First transaction/GUC helper | RESEARCH Pattern 3 §345 |
| `packages/db/drizzle.config.ts` | config | First drizzle-kit config | RESEARCH structure §197 |
| `packages/db/migrations/*.sql` | migration | First migrations; hand-SQL RLS unprecedented | RESEARCH Pattern 2 §308 + FLAG-2 |
| `packages/db/tests/*.ts` (architecture) | test | First DB-integration test harness (only the Vitest idiom has an analog) | RESEARCH Validation Architecture §493 |
| `compose.yml` | infra | No compose file in repo (verified) | RESEARCH Docker Compose §451 |

## Metadata

**Analog search scope:** `packages/config`, `packages/db`, `apps/worker`, `apps/web`, root config files (`turbo.json`, `vitest.config.ts`, `.gitignore`).
**Files scanned:** ~14 (all of `packages/db`, `packages/config`, worker env/pkg, web env test, root configs).
**Pattern extraction date:** 2026-06-15
