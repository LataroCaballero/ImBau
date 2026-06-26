# SECURITY.md — Phase 02: data-layer-rls

**Audited:** 2026-06-17
**Auditor:** gsd-security-auditor (Claude)
**ASVS Level:** 1
**block_on:** high
**Status:** SECURED — 16/16 threats resolved (15 CLOSED-mitigate, 1 CLOSED-accept). One CLOSED threat (T-02-09) carries a documented deviation from its literal mitigation plan; the underlying confidentiality threat remains mitigated.

This audit verifies that every declared threat mitigation in the three PLAN `<threat_model>` blocks is present in the implemented code. Evidence is a concrete file:line in the implementation, not documentation or intent. Implementation files were treated as read-only.

---

## Threat Verification Summary

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-02-01 | Information Disclosure | mitigate | CLOSED | `.gitignore:13-15` (`.env`, `.env.*`, `!.env.example`); `git check-ignore` confirms `.env`/`packages/db/.env` ignored, `.env.example` tracked-eligible; no real `.env` committed; placeholders only in `.env.example:7`, `packages/db/.env.example:18,22,26`, `compose.yml:14` |
| T-02-02 | Tampering | mitigate | CLOSED | No `^`/`~` ranges in any `package.json` (grep across repo, none found); `packages/db/package.json:16-29` all exact pins; `pnpm-lock.yaml` tracked in git |
| T-02-03 | Denial of Service | mitigate | CLOSED | `compose.yml:30-31` Redis published `"6380:6379"` with comment `compose.yml:27-29`; Postgres `"5432:5432"` `compose.yml:16-17` |
| T-02-SC | Tampering (supply chain) | accept | CLOSED | Accepted-risk entry recorded below (see Accepted Risks Log). RESEARCH Package Legitimacy Audit OK; deps exact-pinned; no postinstall scripts run (`pnpm-workspace.yaml` sets `allowBuilds:false` for the two native transitive deps) |
| T-02-04 | Information Disclosure / Elevation | mitigate | CLOSED | `0001_rls.sql:73-75` `ALTER TABLE projects / member / organization FORCE ROW LEVEL SECURITY` (FORCE on every tenant table); UAT confirmed `relforcerowsecurity=t` on all three (`02-UAT.md:25`) |
| T-02-05 | Elevation of Privilege | mitigate | CLOSED | `0001_rls.sql:38,41` `CREATE ROLE ... LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`; app role never owns tables (only GRANTs `0001_rls.sql:57-68`); UAT confirmed `rolsuper=f rolbypassrls=f` (`02-UAT.md:25`) |
| T-02-06 | Information Disclosure | mitigate | CLOSED | `0000_init.sql:130` `projects_anon_published ... FOR SELECT TO anon USING estado='publicado'`; anon GRANT is SELECT-only `0001_rls.sql:58`; policy source `projects.ts:47-52` |
| T-02-07 | Information Disclosure | mitigate | CLOSED | `organization.id` is TEXT (`auth-schema.ts` fold, `0000_init.sql:59`); FK is `text` `projects.ts:23-25`; identical `::text` cast on `projects_tenant` (`projects.ts:42-43`), `member_tenant` (`member-rls.ts:31-32`), `organization_self` (`organization-rls.ts:32-33`) |
| T-02-08 | Tampering | mitigate | CLOSED | Single journal `meta/_journal.json` (only `0000_init`, `0001_rls`); only `meta/{0000,0001}_snapshot.json`; no `db:push` script (`package.json:9-15`); BA CLI `migrate` never run; no competing migration SQL outside `packages/db/migrations` |
| T-02-09 | Information Disclosure | mitigate | CLOSED (deviation) | No PRODUCTION secret committed; the only literal is dev placeholder `'dev'` at `0001_rls.sql:46-47`, env-guarded `current_setting('imbau.env', true) <> 'production'` (`0001_rls.sql:45`); real credential out-of-band via SOPS (phase 4). See Deviation Note below — the literal `PASSWORD '...'` contradicts the plan's literal wording but the threat (real password disclosure) stays mitigated |
| T-02-10 | Information Disclosure | mitigate | CLOSED | `cross-tenant.test.ts:126-158` cases (a)/(b) assert `countForOrg(... otherOrg) === 0` on `projects` AND `member`; relies on `projects_tenant`/`member_tenant` + FORCE RLS; UAT 7 tests passed (`02-UAT.md:29`) |
| T-02-11 | Tampering (SQLi) | mitigate | CLOSED | `with-tenant.ts:29-31` `sql\`select set_config('app.current_organization_id', ${orgId}, true)\`` — `orgId` bound as parameter; no `SET LOCAL` interpolation anywhere (grep clean, `02-VERIFICATION.md:104`) |
| T-02-12 | Information Disclosure | mitigate | CLOSED | `with-tenant.ts:30` GUC set only inside `appDb.transaction()` with `is_local=true` (3rd arg `true`); no session-level `SET` |
| T-02-13 | Tampering | mitigate | CLOSED | `withCheck` on both tenant policies (`projects.ts:43`, `member-rls.ts:32`); `cross-tenant.test.ts:181-221` case (c) asserts INSERT throws on both (member asserts SQLSTATE `42501` via `rlsViolationInChain`) + UPDATE 0 rows (`:223-248`) |
| T-02-14 | Elevation of Privilege | mitigate | CLOSED | `vitest.config.ts:20` `globalSetup: ['./tests/setup.ts']` (required, not conditional); `setup.ts:28-67` `assertUnprivileged` asserts `current_user` + `rolsuper=false`/`rolbypassrls=false`; in-test guard `cross-tenant.test.ts:92-124`; all assertions via app/anon, never owner |
| T-02-15 | Information Disclosure | mitigate | CLOSED | `cross-tenant.test.ts:250-259` case (d) asserts `withAnon` sees ≥1 `publicado` and ZERO `borrador`; relies on `projects_anon_published` |
| T-02-16 | Information Disclosure | mitigate | CLOSED | `member_tenant` policy `member-rls.ts:27-33` + ENABLE RLS (`0000_init.sql:57`) + FORCE RLS (`0001_rls.sql:74`); `cross-tenant.test.ts:138-141,155-157,194-221` assert zero org-B member rows + failed cross-tenant member writes |

**Closed:** 16/16 (15 mitigate + 1 accept). **Open (BLOCKER):** 0.

---

## Deviation Note — T-02-09 (CLOSED with caveat, not a blocker)

The plan's mitigation plan for T-02-09 reads: *"No literal `PASSWORD '...'` in committed SQL (A5); injected at apply time."*

The implemented `packages/db/migrations/0001_rls.sql:46-47` **does** contain literal `ALTER ROLE app_authenticated WITH PASSWORD 'dev'` / `ALTER ROLE anon WITH PASSWORD 'dev'`. This was added as the code-review fix WR-04 (`02-REVIEW.md:110-119`): a passwordless `LOGIN` role cannot authenticate over TCP against `postgres:16-alpine` (scram-sha-256), so the app/anon runtime pools could not connect.

This deviates from the literal mitigation wording, but the **actual threat** — a real/production credential leaking into the repo — remains mitigated:

- The committed literal is `'dev'`, a non-secret development placeholder (the same value already in `.env.example`), never a production credential.
- The `ALTER ROLE ... PASSWORD` statements are guarded by `IF coalesce(current_setting('imbau.env', true), '') <> 'production'` (`0001_rls.sql:45`) — they apply only on a server NOT marked production.
- The production credential is provisioned out-of-band via SOPS/age in phase 4 (INFRA-03); `'dev'` can only ever reach a non-production server.

**Disposition:** CLOSED. The confidentiality threat (production password committed) is mitigated. Recorded here as a deviation so the decision record stays truthful — the mitigation mechanism changed from "no literal at all" to "dev-only env-guarded literal + out-of-band production secret." If a future auditor enforces the literal "no `PASSWORD '...'`" rule strictly, the env-guard + dev-only value is the documented justification.

---

## Accepted Risks Log

### T-02-SC — Supply-chain trust in pinned npm installs (Tampering)

**Disposition:** accept (declared at plan time, 02-01-PLAN `<threat_model>`).

**Risk:** The data-layer depends on `drizzle-orm@0.45.2`, `postgres@3.4.9`, `better-auth@1.6.18` (deps) and `drizzle-kit@0.31.10`, `@better-auth/cli@1.4.21` (devDeps), plus their transitive trees.

**Why accepted:**
- RESEARCH "Package Legitimacy Audit" verdicts were all OK/approved for the locked stack; the only SUS note on `better-auth` was patch-recency, not a malicious signal.
- All versions are exact-pinned (no `^`/`~`) and the resolution is frozen in the committed `pnpm-lock.yaml`, so the installed tree cannot silently drift.
- No `postinstall` scripts execute: `pnpm-workspace.yaml` sets `allowBuilds:false` for the two native transitive deps (`@prisma/client`, `better-sqlite3`) of the dev-only CLI, so their build scripts never run (02-01-SUMMARY decisions).
- The `@better-auth/cli` is dev-only (offline `generate`) and `better-call@1.3.6` is pinned via override to keep the generator subtree consistent.

**Residual risk owner:** project maintainer. Re-evaluate on any dependency bump (re-run the legitimacy audit and re-pin).

---

## Unregistered Attack Surface (informational — already closed in code)

The SUMMARY files for this phase contain no `## Threat Flags` section, so there is no executor-declared new attack surface to map. However, the audit notes one piece of new attack surface that appeared during implementation and was NOT in the original three-PLAN threat register:

### UF-01 — `organization` table cross-tenant read leak (CR-01)

**Source:** discovered by the phase code review (`02-REVIEW.md:56-72`, finding CR-01), not present in any PLAN `<threat_model>`.

**Surface:** `organization` was originally GRANTed `SELECT, INSERT` to `app_authenticated` with **no RLS**, letting any authenticated tenant `SELECT * FROM organization` and read every other tenant's `name`, `slug`, `plan`, `logo`, `metadata` — a cross-tenant confidentiality leak on the tenant identity table itself (CLAUDE.md: "RLS en toda tabla con tenant").

**Disposition:** Mapped to the same family as T-02-04/T-02-10/T-02-16 (Information Disclosure via missing RLS) and **closed in code** before phase exit:
- `organization-rls.ts:28-34` adds the `organization_self` policy (FOR ALL, app role, `using`+`withCheck` on `organization.id = GUC::text`).
- `0000_init.sql:69` ENABLE RLS, `0000_init.sql:127` `CREATE POLICY organization_self`.
- `0001_rls.sql:75` `ALTER TABLE organization FORCE ROW LEVEL SECURITY`.
- `cross-tenant.test.ts:160-179` asserts a tenant reads exactly its own `organization` row and zero sibling rows.
- UAT confirmed `organization` `relforcerowsecurity=t` and the self-isolation test passes (`02-UAT.md:25,29`).

This is logged as informational (the surface is closed, not open). It is a WARNING-class observation only in that the original threat register under-scoped "every tenant table" to `projects` + `member`; the implementation correctly expanded RLS coverage to `organization`. No blocker.

---

## Notes on Live Verification

The DATA-01/02/03/04 live database checks (Compose healthcheck, migration apply, role attributes, FORCE RLS state, and the 7-test cross-tenant suite) were executed against Postgres 16 via Docker Compose and passed — see `02-UAT.md` (status: passed, 3/3) and `02-VERIFICATION.md` (status: passed). The migration-ordering fix `1b6a13f` (roles created in 0000 before policies reference them) and the member-INSERT 42501 assertion fix were required and are present in the audited code. This audit additionally confirms each declared mitigation is present in the source independent of the live run.

---

## Scope of this audit

- Verified mitigations for the 16 threats in the three PLAN `<threat_model>` blocks by their declared disposition (15 mitigate, 1 accept). Did not scan for new vulnerabilities beyond the register (`register_authored_at_plan_time: true`).
- Implementation files were read-only; no implementation file was modified.
- The one new attack surface (UF-01) found during the phase is logged above as already-closed informational, not an open blocker.
