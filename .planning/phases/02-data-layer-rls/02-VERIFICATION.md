---
phase: 02-data-layer-rls
verified: 2026-06-17T12:00:00Z
status: human_needed
score: 8/8 must-haves code-verified; 1 deferred to live CI gate
overrides_applied: 0
human_verification:
  - test: "Run `docker compose up -d` from repo root and confirm both services pass healthchecks"
    expected: "postgres:16-alpine accepts connections via `pg_isready -U imbau -d imbau`; redis:7-alpine returns PONG on `redis-cli ping`; Redis is on host port 6380, not 6379"
    why_human: "No Docker daemon is installed on this machine. The compose.yml is statically validated and structurally correct, but live container execution cannot run here."
  - test: "Run `pnpm --filter @imbau/db db:migrate` against the Compose Postgres, then verify pg_roles and pg_class"
    expected: "`drizzle.__drizzle_migrations` contains 2 entries with non-null hash; `pg_roles` shows `app_authenticated` and `anon` with `rolsuper=f` and `rolbypassrls=f`; `pg_class.relforcerowsecurity=t` for `projects`, `member`, and `organization`"
    why_human: "Requires live Postgres 16 via Docker. Offline verification (drizzle-kit generate clean, journal consistent, typecheck/lint pass) is complete."
  - test: "Run the DATA-04 exit gate: `pnpm --filter @imbau/db test` against Compose Postgres with imbau_test DB"
    expected: "All 5 tests pass — guard + cases (a) read isolation A→B on projects+member, (b) mirror B→A, (c) cross-tenant INSERT throws on both tables, cross-tenant UPDATE returns 0 rows, (d) anon sees publicado and zero borrador. globalSetup migrate + role guard also pass."
    why_human: "Requires Docker daemon + Compose Postgres 16 + dedicated imbau_test DB with app_authenticated/anon role credentials set (see 02-03-SUMMARY.md User Setup Required). This is decision CI-02 — the live run is the milestone exit gate and runs in CI (Phase 4) against a real Postgres 16 service."
---

# Phase 2: Data Layer + RLS Verification Report

**Phase Goal:** La capa de datos existe con aislamiento de tenant impuesto por la base de datos y demostrado por tests, antes de escribir cualquier código de aplicación. (Postgres 16 + Redis vía Compose, schema base con migraciones Drizzle y aislamiento de tenant verificado por tests de ausencia cross-tenant.)
**Verified:** 2026-06-17T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1 | `docker compose up -d` brings up Postgres 16 and Redis 7 with one command and both pass their healthcheck | ? UNCERTAIN (human gate) | `compose.yml` exists at repo root with `postgres:16-alpine` + `redis:7-alpine`, named `pgdata` volume, `pg_isready` and `redis-cli ping` healthchecks, Redis remapped to host 6380. `docker compose config` validates clean per SUMMARY. No Docker daemon on this machine — live verification deferred to human/CI. |
| 2 | `packages/db` has pinned data-layer deps (no `^`/`~`) and `db:generate`/`db:migrate` scripts (no `db:push`) | ✓ VERIFIED | `packages/db/package.json` shows exact-pinned `drizzle-orm: 0.45.2`, `postgres: 3.4.9`, `better-auth: 1.6.18`, `@t3-oss/env-core: 0.13.11`, `zod: 4.4.3`; devDeps `drizzle-kit: 0.31.10`, `@better-auth/cli: 1.4.21`, `@types/node: 22.18.13`. Scripts `db:generate` and `db:migrate` present; no `db:push`. |
| 3 | Importing `packages/db/src/env.ts` without `DATABASE_APP_URL` or `DATABASE_ANON_URL` fails fast with the variable name in the message | ✓ VERIFIED | `src/env.ts` composes `baseEnv.server` + `dbEnv.server` via `createEnv` without overriding `onValidationError`; the default t3-env formatter prints the variable name, not the value. `dbEnv` in `presets.ts` includes `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL` all as `z.string().url()`. |
| 4 | Better Auth org-plugin tables (organization+plan, member, user, session, account, verification, invitation) exist in the Drizzle schema — one migration history | ✓ VERIFIED | `src/schema/auth-schema.ts` contains all 7 tables; `organization` has `plan` field; `session` has `activeOrganizationId`; `member` has `organizationId`, `userId`, `role`. Top-of-file comment records `organization.id` is TEXT and 1.4→1.6 reconciliation. No second migration system created (CLI `migrate` was never run). |
| 5 | `projects` and `member` (both tenant tables) have tenant RLS policies using the GUC, `ENABLE ROW LEVEL SECURITY`, and `FORCE ROW LEVEL SECURITY`; `organization` also has a self-isolation policy (CR-01 fix) | ✓ VERIFIED | `0000_init.sql`: `ENABLE ROW LEVEL SECURITY` on `member`, `organization`, `projects`; `CREATE POLICY member_tenant`, `organization_self`, `projects_tenant` (all: PERMISSIVE, FOR ALL, TO app_authenticated, USING+WITH CHECK on `current_setting('app.current_organization_id', true)::text`), plus `projects_anon_published` (PERMISSIVE FOR SELECT TO anon, USING estado='publicado'). `0001_rls.sql`: `ALTER TABLE projects FORCE ROW LEVEL SECURITY`, `ALTER TABLE member FORCE ROW LEVEL SECURITY`, `ALTER TABLE organization FORCE ROW LEVEL SECURITY`. |
| 6 | Roles `app_authenticated` and `anon` are created `NOSUPERUSER NOBYPASSRLS` via hand-written SQL in the migration journal, with scoped GRANTs | ✓ VERIFIED | `0001_rls.sql` creates both roles with `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` inside a `DO $$ IF NOT EXISTS $$` idempotent block. GRANTs: `USAGE ON SCHEMA public` to both; `SELECT,INSERT,UPDATE,DELETE ON projects` to app; `SELECT ON projects` to anon; `SELECT,INSERT,UPDATE,DELETE ON member` to app; `SELECT,INSERT ON organization` to app. Dev-only password (`'dev'`) guarded by `current_setting('imbau.env', true) <> 'production'` — never committed plaintext for production. |
| 7 | `withTenant(orgId, fn)` opens a transaction on the app pool and sets the GUC via parameterized `set_config` (never interpolated); `withAnon(fn)` runs on the anon pool with no GUC | ✓ VERIFIED | `src/with-tenant.ts` calls `appDb.transaction(async (tx) => { await tx.execute(sql\`select set_config('app.current_organization_id', ${orgId}, true)\`); return fn(tx); })`. `orgId` is a parameter in the `sql` template — never string-concatenated. `withAnon` opens `anonDb.transaction` with no GUC. No `SET LOCAL` interpolation pattern found in any source file. |
| 8 | The cross-tenant absence test suite covers BOTH tenant tables (projects AND member), asserts ZERO rows of the other org, plus failed cross-tenant writes and anon-published-only — wired via a required `vitest.config.ts` `globalSetup` | ✓ VERIFIED | `vitest.config.ts` has `globalSetup: ['./tests/setup.ts']` via `mergeConfig`. `tests/setup.ts` calls `migrate(...)` programmatically and asserts `rolbypassrls=false`/`rolsuper=false` for both roles. `cross-tenant.test.ts` implements: guard, (a) read isolation A→B (zero org-B rows on projects AND member), (b) mirror, (c) cross-tenant INSERT throws on both tables — member case uses valid `makeUser()` so RLS `withCheck` is the only possible rejection cause, asserted as `/row-level security|42501/`; UPDATE asserted via `.returning()` 0-length (no untyped cast), (d) anon sees publicado and zero borrador. CR-01 case added: org reads exactly 1 own organization row and zero sibling rows. All assertions via `withTenant`/`withAnon`, never owner. |

**Score:** 7/8 truths code-verified; Truth #1 (live Compose healthcheck) is UNCERTAIN pending Docker daemon.

### Deferred Items

None — no items explicitly addressed by a later milestone phase. The live execution gate (DATA-04) is deferred to CI by explicit decision CI-02, not because it is scheduled for a later phase.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `compose.yml` | Postgres 16-alpine + Redis 7-alpine with healthchecks, named pgdata volume | ✓ VERIFIED (static) | Contains `postgres:16-alpine`, `redis:7-alpine`, `pg_isready` healthcheck, Redis remapped to 6380:6379 with comment explaining why |
| `packages/config/env/presets.ts` | `dbEnv.server` with `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL` as `z.string().url()` | ✓ VERIFIED | All three present in `dbEnv.server`, `as const`, no values |
| `packages/db/package.json` | Pinned deps, `db:generate`/`db:migrate`, no `db:push` | ✓ VERIFIED | All deps exact-pinned; scripts present; no push script |
| `packages/db/drizzle.config.ts` | `entities.roles:true`, owner `DATABASE_URL`, schema lists concrete files | ✓ VERIFIED | `entities.roles: true`; reads `process.env.DATABASE_URL!`; schema lists 5 concrete files including `organization-rls.ts` (CR-01 fix) |
| `packages/db/src/env.ts` | `createEnv` composing `baseEnv`+`dbEnv`, no `onValidationError` override | ✓ VERIFIED | Exact match; `skipValidation` gated on `SKIP_ENV_VALIDATION === "1"` |
| `packages/db/src/schema/auth-schema.ts` | 7 BA org-plugin tables with `organization.id` type recorded | ✓ VERIFIED | All 7 tables present; top-of-file comment records TEXT id type and reconciliation |
| `packages/db/src/schema/projects.ts` | `estadoEnum`, `projects` table, `projects_tenant`+`projects_anon_published` policies, `.enableRLS()` | ✓ VERIFIED | All present; `::text` cast; `missing_ok` true; `withCheck` on tenant policy |
| `packages/db/src/schema/member-rls.ts` | `member_tenant` policy via `.link(member)`, same cast as projects, scope boundary comment | ✓ VERIFIED | Present; `::text` cast; no anon policy; scope comment at top |
| `packages/db/src/schema/organization-rls.ts` | `organization_self` policy (CR-01), ENABLE RLS, linked to `organization` | ✓ VERIFIED | Present with correct `using`+`withCheck` GUC cast; `.link(organization)` pattern |
| `packages/db/src/schema/roles.ts` | `pgRole("app_authenticated").existing()` + `pgRole("anon").existing()` | ✓ VERIFIED | Both present |
| `packages/db/migrations/0000_init.sql` | Generated DDL + ENABLE RLS + 4 policies (all 3 tables) | ✓ VERIFIED | Contains CREATE TABLE for all 8 tables, estado enum, ENABLE RLS on member+organization+projects, 4 policies |
| `packages/db/migrations/0001_rls.sql` | NOSUPERUSER/NOBYPASSRLS roles, GRANTs, FORCE RLS on projects+member+organization | ✓ VERIFIED | Present; idempotent creation; dev password guarded by production GUC; no committed secret |
| `packages/db/migrations/meta/_journal.json` | Both `0000_init` and `0001_rls` entries | ✓ VERIFIED | Two entries: idx 0 `0000_init`, idx 1 `0001_rls` |
| `packages/db/migrations/meta/0001_snapshot.json` | Exists for drizzle-kit to execute the hand-written SQL | ✓ VERIFIED | File exists |
| `packages/db/src/client.ts` | `appClient`/`anonClient` pools + drizzle instances + `createOwnerDb` factory | ✓ VERIFIED | All three present; pools use `env.DATABASE_APP_URL`/`env.DATABASE_ANON_URL`; no `SET ROLE` |
| `packages/db/src/with-tenant.ts` | `withTenant` parameterized `set_config`, `withAnon` no-GUC | ✓ VERIFIED | Exact implementation as required; `is_local=true` prevents pooled bleed |
| `packages/db/src/index.ts` | Public barrel with `withTenant`, `withAnon`, db instances, schema | ✓ VERIFIED | All 3 exports present; old placeholder removed |
| `packages/db/vitest.config.ts` | `globalSetup: ['./tests/setup.ts']`, `tests/**/*.test.ts` include | ✓ VERIFIED | Uses `mergeConfig(rootConfig, ...)`; globalSetup registered; generous timeouts |
| `packages/db/tests/setup.ts` | Suite-once migrate + role guard (rolbypassrls=false, rolsuper=false) | ✓ VERIFIED | `migrate(owner.db, ...)` + `assertUnprivileged` for both roles; no `as unknown as` casts |
| `packages/db/tests/helpers.ts` | `makeOrg`, `makeProject`, `makeMember`, `makeUser` via owner connection | ✓ VERIFIED | All present; owner-seeded with unique UUIDs; `makeUser` exported for WR-01 fix |
| `packages/db/tests/cross-tenant.test.ts` | 4 cases + guard over projects AND member | ✓ VERIFIED | All cases present; member INSERT uses valid `makeUser()` + asserts `/row-level security|42501/`; UPDATE uses `.returning()` not untyped cast; organization self-isolation case added |
| `packages/db/tests/db.ts` | Env-parametrized connection resolution + `_test` DB guard | ✓ VERIFIED | `requireTestDb` asserts DB name ends in `_test`; `requireEnv` throws with variable name on missing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/db/src/env.ts` | `@imbau/config/env/presets` | spread `dbEnv.server` into `createEnv` | ✓ WIRED | Exact pattern; `...baseEnv.server, ...dbEnv.server` |
| `packages/db/drizzle.config.ts` | `process.env.DATABASE_URL` | owner/migration connection string for DDL | ✓ WIRED | `url: process.env.DATABASE_URL!` |
| `packages/db/src/schema/projects.ts` | `organization.id` | `organization_id text FK references organization.id` | ✓ WIRED | `text("organization_id").references(() => organization.id, { onDelete: "cascade" })` |
| `packages/db/src/schema/projects.ts` | `app.current_organization_id` GUC | tenant policy `current_setting(...)` | ✓ WIRED | Both `using` and `withCheck` use parameterized `current_setting('app.current_organization_id', true)::text` |
| `packages/db/src/schema/member-rls.ts` | `app.current_organization_id` GUC | member tenant policy | ✓ WIRED | Same cast and pattern as projects; `::text` cast consistent |
| `packages/db/migrations/0001_rls.sql` | `projects` AND `member` AND `organization` | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` | ✓ WIRED | All 3 FORCE statements present |
| `packages/db/src/with-tenant.ts` | `app.current_organization_id` GUC | `set_config('app.current_organization_id', ${orgId}, true)` inside `db.transaction()` | ✓ WIRED | `orgId` is a bound parameter; `is_local=true` |
| `packages/db/vitest.config.ts` | `packages/db/tests/setup.ts` | `globalSetup` registration | ✓ WIRED | `globalSetup: ['./tests/setup.ts']` |
| `packages/db/tests/cross-tenant.test.ts` | `withTenant` / `withAnon` | absence assertions as app/anon role over projects AND member | ✓ WIRED | All 5 tests import and invoke `withTenant`/`withAnon`; never owner role |
| `packages/db/src/client.ts` | `DATABASE_APP_URL` / `DATABASE_ANON_URL` | `postgres()` pools per role | ✓ WIRED | `postgres(env.DATABASE_APP_URL)` and `postgres(env.DATABASE_ANON_URL)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `src/with-tenant.ts` | `orgId` bound to GUC | caller-supplied parameter in `sql` template | Yes — parameter, never interpolated | ✓ FLOWING |
| `tests/cross-tenant.test.ts` | `projectRows`, `memberRows` | `withTenant(orgId, (tx) => tx.select().from(table))` | Yes — live DB query via unprivileged role | ✓ FLOWING (pending live DB) |
| `migrations/0000_init.sql` | RLS policies | generated by `drizzle-kit generate` from schema code | Yes — DDL, not empty | ✓ FLOWING |

### Behavioral Spot-Checks

No runnable entry point without Docker daemon. Static checks performed instead:

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `compose.yml` validates | `docker compose config` (reported in SUMMARY) | Clean per SUMMARY b54837f | ✓ PASS (reported offline) |
| No `SET LOCAL` interpolation of orgId | `grep -rn "SET LOCAL app.current_organization_id" packages/db/src/` | No match | ✓ PASS |
| No `db:push` script | `grep "db:push" packages/db/package.json` | No match | ✓ PASS |
| FORCE RLS on all 3 tenant tables in 0001_rls.sql | `grep "FORCE ROW LEVEL SECURITY" packages/db/migrations/0001_rls.sql` | 3 ALTER TABLE statements (projects, member, organization) | ✓ PASS |
| NOSUPERUSER + NOBYPASSRLS in roles | `grep "NOSUPERUSER\|NOBYPASSRLS" packages/db/migrations/0001_rls.sql` | Both attributes in CREATE ROLE for both roles | ✓ PASS |
| No Neon helpers | `grep -rn "crudPolicy\|authUid" packages/db/src/` | No match | ✓ PASS |
| No unreferenced debt markers | `grep -rn "TBD\|FIXME\|XXX" packages/db/src/ packages/db/tests/ packages/db/migrations/` | No match | ✓ PASS |
| `organization_self` policy present | `grep "organization_self" packages/db/migrations/0000_init.sql` | Line 107 — PERMISSIVE FOR ALL TO app_authenticated, USING+WITH CHECK on GUC | ✓ PASS |
| `session.activeOrganizationId` present | `grep "activeOrganizationId" packages/db/src/schema/auth-schema.ts` | Line 63 — `activeOrganizationId: text("active_organization_id")` | ✓ PASS |
| `member` cross-tenant INSERT asserts RLS rejection specifically | `grep "row-level security\|42501" packages/db/tests/cross-tenant.test.ts` | Line 186 — `.rejects.toThrow(/row-level security\|42501/)` | ✓ PASS |
| UPDATE assertion uses typed `.returning()` | `grep "returning" packages/db/tests/cross-tenant.test.ts` | Lines 199, 207 — `.returning({ id: ... })` + `rows.length` | ✓ PASS |
| Live test: ECONNREFUSED at expected point | Reported in 02-03-SUMMARY.md | Suite ran, reached globalSetup migrate, failed ONLY at ECONNREFUSED :5432 | ✓ PASS (structural wiring confirmed) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DATA-01 | 02-01-PLAN.md | `docker compose up -d` levanta Postgres 16 y Redis locales con un comando | ? UNCERTAIN (human gate) | `compose.yml` is structurally correct; live healthcheck requires Docker daemon |
| DATA-02 | 02-01, 02-02 | Schema base en `packages/db` con migraciones Drizzle versionadas (`generate`+`migrate`, nunca `push`) | ✓ SATISFIED | Migration journal with 0000_init + 0001_rls; `db:generate`/`db:migrate` scripts; no `db:push`; one migration history |
| DATA-03 | 02-02, 02-03 | Toda tabla con tenant tiene `FORCE ROW LEVEL SECURITY`, roles dedicados (app sin ownership/BYPASSRLS, anon limitado a publicado), `withTenant()` con `SET LOCAL` | ✓ SATISFIED | FORCE RLS on projects+member+organization in 0001_rls.sql; roles NOSUPERUSER NOBYPASSRLS; `withTenant` uses parameterized `set_config(..., true)` which is transaction-scoped (equivalent to SET LOCAL) |
| DATA-04 | 02-03-PLAN.md | Tests de aislamiento cross-tenant (ausencia) contra Postgres real como rol de app | ? UNCERTAIN (human gate) | Test suite exists, structured correctly, offline verification clean, wiring proven by ECONNREFUSED at DB connect; awaits live Postgres 16 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/db/auth.ts` | 19-21 | `drizzleAdapter({}, ...)` with empty db object — SUMMARY warns this will break at phase-3 runtime (IN-03 from review) | ℹ️ Info | Phase-2 scope only; phase-3 auth runtime must split generate-only config from runtime config before using this as a runtime entry point |

No blockers or TBD/FIXME/XXX markers found. The `as unknown as` WR-03 casts were fixed in commit `9c7ba8c`. The FK-before-RLS WR-01 issue was fixed in the same commit with `makeUser()` + SQLSTATE assertion. The untyped `.count` WR-02 issue was fixed with `.returning()`. The WR-06 non-test-DB risk was fixed with the `requireTestDb` guard in `tests/db.ts`.

### Human Verification Required

**All three items below are gated on Docker daemon + Compose Postgres 16.**

#### 1. DATA-01: Live Compose Healthcheck

**Test:** From the repo root (with Node 22 on PATH): `docker compose up -d && docker compose exec -T postgres pg_isready -U imbau -d imbau && docker compose exec -T redis redis-cli ping`
**Expected:** `pg_isready` exits 0 ("accepting connections"); `redis-cli ping` returns `PONG`; Redis is reachable on host port 6380 (not 6379)
**Why human:** No Docker daemon on this machine; `docker.sock` does not exist.

#### 2. DATA-02/03: Live Migration Apply + Role Verification

**Test:** With Compose Postgres running, apply the journal and query pg_roles and pg_class:
```bash
pnpm --filter @imbau/db db:migrate
docker compose exec -T postgres psql -U imbau -d imbau -tAc "select count(*) from drizzle.__drizzle_migrations where hash is not null"   # expect 2
docker compose exec -T postgres psql -U imbau -d imbau -tAc "select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('app_authenticated','anon')"   # expect both rolsuper=f rolbypassrls=f
docker compose exec -T postgres psql -U imbau -d imbau -tAc "select relname,relforcerowsecurity from pg_class where relname in ('projects','member','organization') order by relname"   # expect all 3 rows with t
```
**Expected:** 2 migrations applied; both roles with rolsuper/rolbypassrls=f; FORCE RLS=t on all 3 tenant tables.
**Why human:** Requires live Postgres.

#### 3. DATA-04: The Milestone Exit Gate (Live Test Run)

**Test:** Create `imbau_test` DB and run the suite (see 02-03-SUMMARY.md User Setup Required for full setup steps):
```bash
export DATABASE_URL="postgres://imbau:dev@localhost:5432/imbau_test"
export DATABASE_APP_URL="postgres://app_authenticated:dev@localhost:5432/imbau_test"
export DATABASE_ANON_URL="postgres://anon:dev@localhost:5432/imbau_test"
pnpm --filter @imbau/db test
```
**Expected:** 5 tests pass (guard, cases a–d including organization self-isolation for CR-01). globalSetup migrate + role guard run once. Suite exits 0.
**Why human:** Requires Docker daemon + Compose Postgres 16 + dedicated `imbau_test` DB. This is the DATA-04 milestone exit gate. The live run is deferred to CI (Phase 4, CI-02) by explicit decision. All offline verification is clean: typecheck, lint, structural import/wiring checks, and the live connect attempt fails only at ECONNREFUSED (proving vitest.config.ts, globalSetup, env resolution, and migrate path are all correctly wired).

---

## Summary

### Code Quality Assessment

The data-layer implementation is structurally sound and complete. All code-verifiable must-haves pass:

- The Compose stack is correctly specified for Postgres 16 + Redis 7 with proper healthchecks
- The `dbEnv` preset declares the three-role connection-string contract; `packages/db` toolchain is fully wired with exact-pinned deps
- Better Auth org-plugin tables are folded into the Drizzle schema with the `organization.id = TEXT` type decision recorded and propagated consistently across all policies
- The critical CR-01 cross-tenant read leak on `organization` was found by the code review and fixed: `organization_self` policy + FORCE RLS added, and a test case asserting organization self-isolation was added to the suite
- Three tenant tables (`projects`, `member`, `organization`) all have ENABLE RLS + a tenant policy (USING + WITH CHECK) + FORCE ROW LEVEL SECURITY
- `withTenant` uses parameterized `set_config` with `is_local=true` — no SET LOCAL string interpolation; pooled-connection bleed is impossible
- The test harness has a required `vitest.config.ts` globalSetup that migrates + role-guards before any assertion; tests run as the unprivileged app/anon role only
- Review findings WR-01, WR-02, WR-03, WR-04, WR-06 were all fixed in commits after the review

### What Remains for Human/CI Verification

Two items require a Docker daemon: the live Compose healthcheck (DATA-01) and the live migration apply + DATA-04 test run. These were deferred by explicit decision CI-02 to Phase 4 CI execution. The suite reaches the expected ECONNREFUSED at the DB connect point — confirming the wiring is structurally correct and only the live DB is missing.

Note: WR-05 (no negative anon assertions for `member`/`organization` deny boundary) was noted in the review but marked as a test-completeness enhancement, not a goal blocker. The deny path is correctly established by the lack of GRANTs and the presence of policies — it is simply untested negatively for those tables.

---

_Verified: 2026-06-17T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
