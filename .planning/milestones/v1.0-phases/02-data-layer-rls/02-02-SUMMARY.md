---
phase: 02-data-layer-rls
plan: 02
subsystem: database
tags: [drizzle-orm, drizzle-kit, better-auth, rls, multi-tenant, pgPolicy, pgRole, migrations, postgres]

# Dependency graph
requires:
  - phase: 02-data-layer-rls
    plan: 01
    provides: "packages/db toolchain (drizzle.config.ts entities.roles:true on owner URL, db:generate/db:migrate scripts), three-role connection-string contract, pinned drizzle/postgres/better-auth deps"
provides:
  - "Folded Better Auth org-plugin tables in the Drizzle schema (organization+plan, member, user, session+activeOrganizationId, account, verification, invitation) — one migration history"
  - "projects table (estado enum [borrador|publicado|archivado], organization_id text FK) with tenant + anon-published RLS policies as code"
  - "member tenant RLS policy linked to the folded member table — the SECOND tenant table this phase (D-02/D-10)"
  - "Versioned migration journal: 0000_init.sql (generated DDL + ENABLE RLS + 3 policies) and hand-written 0001_rls.sql (roles + GRANTs + FORCE RLS on projects AND member) with matching 0001 snapshot"
  - "Decided + documented id type: organization.id is TEXT → all tenant policy casts are ::text (D-05 ::uuid reconciled)"
affects: [02-03 withTenant/withAnon clients + cross-tenant absence tests, 03 auth-runtime reuses auth.ts]

# Tech tracking
tech-stack:
  added: ["better-call@1.3.6 (pnpm override)"]
  patterns:
    - "Better Auth offline schema generation then fold (D-03): @better-auth/cli@1.4.21 generate → auth-schema.ts → owned by Drizzle migrations, no auth runtime"
    - "RLS as code: pgPolicy for tenant/anon policies + pgRole().existing() stubs; hand-written SQL for CREATE ROLE attrs, GRANTs, FORCE RLS (FLAG-2)"
    - "pgPolicy(...).link(externalTable) to overlay a tenant policy on a folded table without hand-editing the generated fold (member)"
    - "drizzle schema config points at concrete source files (not the index.ts barrel) to avoid double-reading entities"
    - "Two-file single-journal migration: drizzle-kit-generated 0000 + hand-written 0001 in the same _journal.json with a matching snapshot"

key-files:
  created:
    - packages/db/auth.ts
    - packages/db/src/schema/auth-schema.ts
    - packages/db/src/schema/roles.ts
    - packages/db/src/schema/projects.ts
    - packages/db/src/schema/member-rls.ts
    - packages/db/src/schema/index.ts
    - packages/db/migrations/0000_init.sql
    - packages/db/migrations/0001_rls.sql
    - packages/db/migrations/meta/_journal.json
    - packages/db/migrations/meta/0000_snapshot.json
    - packages/db/migrations/meta/0001_snapshot.json
  modified:
    - packages/db/drizzle.config.ts
    - pnpm-workspace.yaml
    - pnpm-lock.yaml

key-decisions:
  - "organization.id is TEXT (Better Auth default) — confirmed from the generated fold; D-05's literal ::uuid is reconciled to ::text across projects.organization_id (FK type), projects_tenant, and member_tenant casts. A ::uuid cast against text ids would never match and make the DATA-04 absence tests pass for the wrong reason (Pitfall 2)."
  - "member RLS attached via pgPolicy(...).link(member) (not member.enableRLS()) because member is an externally-defined folded table; .link() makes drizzle-kit emit ENABLE ROW LEVEL SECURITY + the policy. FORCE RLS is hand-written in 0001_rls.sql (Drizzle cannot emit FORCE — FLAG-2)."
  - "drizzle schema config lists concrete source files instead of the ./src/schema/*.ts glob, because the glob also matched index.ts and re-read every entity through its re-exports (drizzle-kit error: duplicated policy member_tenant)."
  - "Role passwords are NOT committed (A5). drizzle-kit migrate runs SQL via the postgres driver (no psql client vars), so roles are created with LOGIN but no credential; the credential is set out-of-band at apply time. SOPS is phase 4."
  - "0001_rls.sql role creation is idempotent (DO/IF NOT EXISTS) so the plan-03 test-harness re-apply path does not error."

patterns-established:
  - "Generated auth fold carries a top-of-file comment recording the decided id type and any 1.4→1.6 reconciliation (none needed — CLI loaded the 1.6.18 runtime, so emitted columns are the 1.6.18 shape)."
  - "Tenant tables this phase are EXACTLY projects + member; the other Better Auth tables are not organization_id-scoped and intentionally get no tenant policy / no FORCE RLS."

requirements-completed: [DATA-02, DATA-03]

# Metrics
duration: ~45min
completed: 2026-06-16
---

# Phase 02 Plan 02: Schema Fold + RLS-as-Code + Migrations Summary

**Folded the Better Auth org-plugin tables into the Drizzle schema, added the `projects` table with an `estado` enum, expressed tenant + anon-published RLS as code on the two tenant tables (`projects` and `member`), and materialized it all as a single-journal migration: a generated `0000_init.sql` plus a hand-written `0001_rls.sql` (roles + GRANTs + FORCE RLS that Drizzle cannot emit).**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-06-16
- **Completed:** 2026-06-16
- **Tasks:** 3 (code complete; live `db:migrate` against Compose Postgres awaits a daemon — see User Setup Required)
- **Files:** 13 (11 created, 2 modified — counting `pnpm-lock.yaml`)

## Accomplishments

- **Better Auth fold (D-03):** Minimal `auth.ts` (CLI-generator-only, no runtime) drives `@better-auth/cli generate`, emitting `auth-schema.ts` with all 7 org-plugin tables. Confirmed load-bearing columns: `organization.plan` (D-01 additionalField), `session.activeOrganizationId` (phase-3 GUC source), `member.{organizationId,userId,role}`. The CLI is 1.4.21 but loaded the shipped `better-auth@1.6.18`, so emitted columns are the 1.6.18 shape — no hand-reconciliation needed.
- **Id type resolved (A1/Pitfall 2):** `organization.id` is `text`. All policy casts are `::text`, `projects.organization_id` is `text`. D-05's literal `::uuid` is consciously reconciled to `::text` and documented on both `projects_tenant` and `member_tenant`.
- **RLS as code (DATA-03):** `projects` gets `projects_tenant` (all, app role, `using`+`withCheck` on the GUC, default-deny via `missing_ok`) and `projects_anon_published` (select, anon, `estado='publicado'`) plus `.enableRLS()`. `member` — the second tenant table (D-02/D-10) — gets `member_tenant` via `pgPolicy(...).link(member)`; drizzle-kit emits its ENABLE RLS + policy. No anon policy on `member`.
- **Migrations (DATA-02):** `0000_init.sql` (generated; 8 tables, estado enum, ENABLE RLS on `projects` + `member`, 3 policies) renamed from the generated tag; `0001_rls.sql` hand-written in the same journal — idempotent `CREATE ROLE app_authenticated/anon` (LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE), scoped GRANTs, and `FORCE ROW LEVEL SECURITY` on **both** `projects` and `member`. Registered in `_journal.json` with a matching `0001_snapshot.json`.
- All `@imbau/db` `typecheck` + `lint` pass on every commit.

## Task Commits

1. **Task 1: generate + fold Better Auth org-plugin tables** — `b5f031a` (feat)
2. **Task 2: projects + member RLS policies and role stubs as code** — `7afdd9c` (feat)
3. **Task 3: generate base migration + hand-write roles/GRANT/FORCE RLS** — `e297127` (feat)

## Files Created/Modified

- `packages/db/auth.ts` — minimal Better Auth generator config (drizzle adapter `provider:"pg"` + organization plugin with `plan` additionalField). No baseURL/runtime.
- `packages/db/src/schema/auth-schema.ts` — generated + folded org-plugin tables with a top-of-file comment recording the decided text id type and the 1.4→1.6 (no-op) reconciliation.
- `packages/db/src/schema/roles.ts` — `pgRole("app_authenticated").existing()` + `pgRole("anon").existing()` stubs.
- `packages/db/src/schema/projects.ts` — `estadoEnum`, `projects` table (text `organization_id` FK), `projects_tenant` + `projects_anon_published` policies, `.enableRLS()`.
- `packages/db/src/schema/member-rls.ts` — `member_tenant` policy linked to the folded `member`; scope-boundary comment (only projects + member are tenant-scoped).
- `packages/db/src/schema/index.ts` — barrel; re-exports `member` from `member-rls` (decorated) and the rest of the auth tables from `auth-schema` to avoid a duplicate-export conflict.
- `packages/db/migrations/0000_init.sql` — generated DDL + ENABLE RLS + 3 policies.
- `packages/db/migrations/0001_rls.sql` — hand-written roles + GRANTs + FORCE RLS (FLAG-2), no committed credential.
- `packages/db/migrations/meta/_journal.json` — both `0000_init` and `0001_rls` entries in order.
- `packages/db/migrations/meta/0000_snapshot.json` / `0001_snapshot.json` — schema snapshots (0001 carries the same table state with a new id/prevId chained to 0000).
- `packages/db/drizzle.config.ts` — schema now lists concrete source files (not the barrel glob).
- `pnpm-workspace.yaml` / `pnpm-lock.yaml` — `better-call: 1.3.6` override (see Deviations).

## Decisions Made

- **Text ids, `::text` casts everywhere** (resolves A1/D-05). Documented on the fold and both tenant policies.
- **`member` RLS via `.link()`**, not `.enableRLS()` on a re-imported table (which would create a divergent table instance and break the link). Verified ENABLE RLS appears for `member` in `0000_init.sql`.
- **Schema config lists files, not the barrel glob**, to stop drizzle-kit double-reading entities (it errored with "duplicated policy member_tenant" when the glob picked up `index.ts`).
- **No password literals**; roles created with LOGIN only, credential applied out-of-band. drizzle-kit migrate (postgres driver) cannot use psql client variables.
- **Idempotent role creation** so the plan-03 harness can re-apply the journal without erroring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `better-auth generate` crashed on a `better-call` peer-resolution mismatch**
- **Found during:** Task 1 (running the offline generator).
- **Issue:** `@better-auth/core@1.6.18` declares peer `better-call@1.3.6` (which exports `kAPIErrorHeaderSymbol`), but with both `@better-auth/cli@1.4.21` (FLAG-1, 1.4.x line) and runtime `better-auth@1.6.18` in one tree, pnpm linked one `@better-auth/core@1.6.18` instance against the CLI subtree's older `better-call@1.1.8` — which lacks that export. The generator threw `SyntaxError: ... does not provide an export named 'kAPIErrorHeaderSymbol'` (Pitfall 3 made real). This is a resolution correction on already-pinned, already-installed, legitimate packages — NOT an alternative-package install (so not a package-legitimacy checkpoint).
- **Fix:** Added `overrides: { better-call: 1.3.6 }` to `pnpm-workspace.yaml` so `@better-auth/core@1.6.18` always gets its declared peer; re-ran `pnpm install`. The shipped runtime already resolved 1.3.6; this only realigns the dev-time generator subtree.
- **Files modified:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- **Verification:** `better-auth generate` succeeds and emits all 7 tables.
- **Committed in:** `b5f031a` (Task 1 commit)

**2. [Rule 3 - Blocking] drizzle-kit "duplicated policy member_tenant"**
- **Found during:** Task 2/3 (`db:generate`).
- **Issue:** The plan's `drizzle.config.ts` glob `./src/schema/*.ts` also matched `index.ts`. The barrel re-exports every table/policy, so drizzle-kit read each entity twice and refused with a duplicated-policy error.
- **Fix:** Changed `schema` to an explicit list of the four concrete source files, excluding the barrel. The barrel remains for consumers; drizzle-kit reads sources directly.
- **Files modified:** `packages/db/drizzle.config.ts`
- **Verification:** `db:generate` produces a clean `0000_init.sql` (8 tables, 3 policies, ENABLE RLS on projects + member).
- **Committed in:** `7afdd9c` (Task 2 commit)

**3. [Rule 1 - Bug] Lint failed on an unnecessary `as never` assertion in `auth.ts`**
- **Found during:** Task 1 (lint gate — CLAUDE.md requires lint before commit).
- **Issue:** `drizzleAdapter({} as never, ...)` (from the RESEARCH example) triggered `@typescript-eslint/no-unnecessary-type-assertion` — the adapter already accepts `{}`.
- **Fix:** Removed the assertion (`drizzleAdapter({}, ...)`). Typecheck + generation still pass.
- **Files modified:** `packages/db/auth.ts`
- **Verification:** `typecheck` + `lint` pass; generator still works.
- **Committed in:** `b5f031a` (Task 1 commit)

### Adaptations (not scope changes)

- **`member` "enableRLS" mechanism:** the plan's literal expectation was `.enableRLS()` on `member`. For an externally-defined folded table the correct Drizzle API is `pgPolicy(...).link(member)`, which makes drizzle-kit emit `ENABLE ROW LEVEL SECURITY` for `member` (verified in `0000_init.sql`, line for `member`). The intent (member has ENABLE RLS + a tenant policy) is fully met; the implementation differs from the literal API name and is documented in `member-rls.ts`.
- **Migration filename split (W4):** RESEARCH §211/§309 named the hand-written file `0000_rls.sql`; per the plan this is `0000_init.sql` (generated) + `0001_rls.sql` (hand-written) in one journal. Noted in `0001_rls.sql`.

**Total deviations:** 3 auto-fixed (2 Rule 3 - blocking, 1 Rule 1 - bug) + 2 documented adaptations. No scope added; the RLS seam matches D-01…D-11 exactly.

## Issues Encountered / User Setup Required

**Live `db:migrate` against Compose Postgres could not be run here (no Docker daemon).** Per the environment note and confirmed at runtime (`docker info` fails, host port 5432 closed), there is no running Postgres on this machine. The OFFLINE half of Task 3 is complete and committed (`drizzle-kit generate` succeeded; the journal + snapshots are consistent). The LIVE verification is a human-action gate, NOT a failure:

To complete the runtime checks (DATA-02/DATA-03 live proof):
1. Start a Docker daemon and the Compose stack from the repo root:
   ```bash
   export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" && corepack enable
   docker compose up -d
   ```
2. Apply the journal as the owner role (DATABASE_URL = owner string):
   ```bash
   pnpm --filter @imbau/db db:migrate
   ```
3. Set the role credentials out-of-band (no password is in the migration — A5), e.g. as the owner:
   ```sql
   ALTER ROLE app_authenticated WITH PASSWORD '<dev-app-pw>';
   ALTER ROLE anon            WITH PASSWORD '<dev-anon-pw>';
   ```
   (or rely on local trust auth for the Compose dev DB).
4. Confirm the expected state:
   ```bash
   docker compose exec -T postgres psql -U imbau -d imbau -tAc "select count(*) from drizzle.__drizzle_migrations where hash is not null"   # expect >= 2
   docker compose exec -T postgres psql -U imbau -d imbau -tAc "select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('app_authenticated','anon')"   # expect rolsuper=f, rolbypassrls=f
   docker compose exec -T postgres psql -U imbau -d imbau -tAc "select relname,relforcerowsecurity from pg_class where relname in ('projects','member') order by relname"   # expect both t
   ```

This live gate also covers plan 02-03 (the cross-tenant absence tests point at the same Compose Postgres — D-07).

## Next Phase Readiness

- Ready for **02-03** (`withTenant`/`withAnon` clients + cross-tenant absence tests): the schema, both tenant policies, the anon-published policy, the role stubs, and the full migration journal (incl. FORCE RLS + roles) are in place and applied offline. The harness applies this exact journal programmatically at suite start (D-08).
- Ready for **phase 3** (auth runtime): `auth.ts` is reusable for the real runtime; `session.activeOrganizationId` feeds the tenant GUC.
- **Blocker for runtime/test work:** a Docker daemon + Compose Postgres must be running locally (see User Setup Required). The `better-call: 1.3.6` override must remain in `pnpm-workspace.yaml`.

## Self-Check: PASSED

- Files: all 11 created files + 2 modified present on disk (verified).
- Commits: `b5f031a`, `7afdd9c`, `e297127` all present in git log (verified).
- Offline verifications: `db:generate` clean; `typecheck` + `lint` pass; no password literal in `0001_rls.sql`; journal lists both migrations; `0001_snapshot.json` present; FORCE RLS on both `projects` and `member` (4 FORCE-related lines); ENABLE RLS on `member` confirmed in `0000_init.sql`.

---
*Phase: 02-data-layer-rls*
*Completed: 2026-06-16*
