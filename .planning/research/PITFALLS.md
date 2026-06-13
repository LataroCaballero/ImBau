# Pitfalls Research

**Domain:** Multi-tenant SaaS foundation (phase 0) — Next.js App Router + tRPC + Drizzle/Postgres RLS + Better Auth + Docker Compose/Traefik on a shared VPS, solo AI-first developer
**Researched:** 2026-06-12
**Confidence:** HIGH on RLS/pooling, Drizzle RLS, Traefik ACME, Sentry App Router (cross-checked against official docs); MEDIUM on Better Auth proxy/multi-app specifics (evolving API) and solo over-engineering judgment.

> Scope note: this milestone (v1) is ONLY phase 0 of `docs/modelo-mvp.md`. The hard control rule is "phase 0 must take under a week (3-4 días con Fable)". Several pitfalls below are about *over-building* the foundation, not just bugs. Where a pitfall belongs to a later GSD milestone, it is flagged so the roadmap can defer it cleanly instead of dragging it into phase 0.

## Critical Pitfalls

### Pitfall 1: RLS session context leaks across pooled connections

**What goes wrong:**
You set the tenant context with `SET app.current_tenant = ...` (session-level) or `set_config('app.current_tenant', x, false)` (the `false` = not transaction-local). With a connection pooler in transaction mode (PgBouncer) — or even just an app-level pool that reuses connections — the *next* request that grabs that physical connection inherits the previous tenant's context. Result: a user reads/writes another organization's units, prices, and leads. This is a silent cross-tenant data breach, not a crash, so tests that only check "does my own data show up" pass.

**Why it happens:**
The default for `set_config` is session scope. Tutorials show `SET` for simplicity. The bug is invisible in local dev (single connection, no concurrency) and only appears under load with a pool.

**How to avoid:**
- Always set tenant context **transaction-scoped**: `set_config('app.current_tenant', $1, true)` (third arg `true` = local to transaction) and run every tenant query inside a transaction that opens with that call. Drizzle: wrap in `db.transaction(async (tx) => { await tx.execute(sql\`select set_config('app.current_tenant', ${orgId}, true)\`); ... })`.
- Build one helper (`withTenant(orgId, fn)`) in `packages/db` that is the *only* sanctioned way to query tenant tables. Forbid raw `db.select()` against tenant tables outside it (lint rule or code review).
- If/when PgBouncer is introduced, use transaction pooling and never rely on session state. For phase 0 staging you may run without PgBouncer, but write the helper transaction-scoped from day one so adding the pooler later changes nothing.

**Warning signs:**
- Any `set_config(..., false)` or bare `SET app.*` in the codebase.
- Tenant queries not wrapped in a transaction.
- Tests that only ever use a single org / single connection.

**Phase to address:** This milestone (phase 0) — it is the core deliverable. The `withTenant` helper and its isolation tests are a phase-0 exit criterion.

---

### Pitfall 2: RLS bypassed by the table owner / superuser connection

**What goes wrong:**
RLS policies are silently ignored for the role that owns the table and for superusers, unless you `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. Your migrations and your app very commonly connect as the owning/admin role (the role Drizzle migrations run under, or a single `postgres`-ish app user). So every policy you carefully wrote does nothing in production, and isolation appears to work in tests only because the test fixtures happen to filter by org.

**Why it happens:**
`ENABLE ROW LEVEL SECURITY` looks sufficient; the owner-exemption rule is buried in the Postgres docs. Single-DB-user setups (common on small VPS) make the app the owner.

**How to avoid:**
- Run the application against a **dedicated non-owner, non-superuser role** (e.g. `app_authenticated`, plus `app_anon` for the public web read path) that has only `SELECT/INSERT/UPDATE/DELETE` grants, never table ownership.
- Add `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` on every tenant table as a belt-and-suspenders defense so even an accidental owner connection is constrained.
- Keep migration/DDL on a separate privileged role used *only* by `drizzle-kit migrate`, never by the running apps.

**Warning signs:**
- App and migrations share one DB user.
- `DATABASE_URL` for the app points at a superuser or the table owner.
- An isolation test that inserts as org A and selects as org B still returns A's rows.

**Phase to address:** This milestone (phase 0) — role separation and FORCE RLS are part of the multi-tenancy deliverable.

---

### Pitfall 3: RLS isolation never actually tested (false confidence)

**What goes wrong:**
The team writes policies, sees their own data, and declares multi-tenancy "done". There is no test that proves org A *cannot* see org B. Combined with pitfalls 1 and 2, the foundation ships with broken isolation and no one knows until a customer sees another developer's prices.

**Why it happens:**
Positive tests are easy; adversarial cross-tenant tests require seeding two orgs and asserting *absence*. AI-generated test suites tend to assert presence, not absence.

**How to avoid:**
- Write isolation tests that run **as the app role with the same `set_config` machinery as production** (not as the owner). Seed org A and org B; assert that querying under A's context returns zero of B's rows for `select`, `update`, `insert` (cross-tenant insert should fail or be invisible), and `delete`.
- Include the `anon` read path: assert `anon` sees only `projects` with `estado = 'publicado'` and nothing from `borrador`/`archivado`, and zero rows from `leads`/`events` reads.
- Make this suite a CI gate.

**Warning signs:**
- No test file references a second organization.
- Tests connect as the owner/admin role.
- "RLS works" claimed without an absence assertion.

**Phase to address:** This milestone (phase 0). Verification: the cross-tenant absence suite is green in CI.

---

### Pitfall 4: Drizzle RLS policies applied with `push` instead of `generate`/`migrate`

**What goes wrong:**
`drizzle-kit push` does not reliably emit the RLS policy SQL (`CREATE POLICY`, role grants) — confirmed open behavior in drizzle-orm. Developers use `push` for speed in dev, the policies silently never get created, and the app runs with RLS-enabled-but-no-policies (default deny) or, worse, RLS not enabled at all. The project's own CLAUDE.md mandates versioned migrations and forbids manual schema changes, so `push` violates the standard *and* breaks RLS.

**Why it happens:**
`push` is the fast path everyone reaches for in early dev; the policy gap is not obvious. drizzle-kit also does not yet auto-generate policies for every case, so some policies must be hand-written SQL migrations.

**How to avoid:**
- Use `drizzle-kit generate` + `drizzle-kit migrate` exclusively (matches CLAUDE.md). Never `push`, even locally — make `pnpm db:migrate` the only path and don't expose a `push` script.
- Define policies via Drizzle's `pgPolicy`/`crudPolicy` where supported, and hand-write the rest as explicit SQL migration files committed to the repo.
- Add a migration-presence check / drift check in CI so a missing policy migration fails the build.

**Warning signs:**
- A `db:push` script in `package.json`.
- Policies defined in TS but absent from the generated SQL migration files.
- `pg_policies` view empty on a fresh migrated DB.

**Phase to address:** This milestone (phase 0). Verification: query `pg_policies` after migrate; every tenant table has expected policies.

---

### Pitfall 5: Better Auth misconfigured behind Traefik (cookies/sessions break, or open to forgery)

**What goes wrong:**
Two failure modes. (a) Auth derives the wrong base URL behind the reverse proxy — login redirects, OAuth callbacks, and secure cookies break because Better Auth sees `http`/internal host instead of the public `https` host. (b) You "fix" it by blindly trusting `X-Forwarded-*` headers without locking down who can set them, opening host-header/CSRF forgery.

**Why it happens:**
Behind Traefik the app receives internal scheme/host. Better Auth resolves base URL from static config → env (`BETTER_AUTH_URL`) → forwarded headers (only when `trustedProxyHeaders` is on). Getting the precedence and proxy header trust wrong is easy, and the multi-app setup (web + panel sharing auth) multiplies the surface (`trustedOrigins`, cookie domain, same secret).

**How to avoid:**
- Set an explicit `baseURL` / `BETTER_AUTH_URL` to the public staging URL rather than relying on header derivation, OR enable `trustedProxyHeaders` only after configuring Traefik to set `X-Forwarded-Proto`/`X-Forwarded-Host` and strip any client-supplied versions.
- List every app origin (web + panel, staging + localhost) in `trustedOrigins`; share the same auth secret/encryption key across apps.
- For shared sessions across `web` and `panel` on subdomains, set the cookie domain to the registrable parent domain and use `Secure`/`SameSite` appropriately. If they are separate hosts, decide explicitly whether sessions are shared or independent — don't leave it accidental.
- Pin the Better Auth + organization-plugin versions and re-read the proxy/security docs at integration time (API still evolving).

**Warning signs:**
- Login works on localhost but redirects/cookies fail on staging.
- OAuth/callback URLs contain the internal host or `http`.
- `trustedProxyHeaders` enabled without Traefik sanitizing the headers.

**Phase to address:** This milestone (phase 0) — auth + reverse proxy is in scope. Verification: full login + invite + org-switch flow works end-to-end on the staging URL.

---

### Pitfall 6: Better Auth Drizzle adapter schema/migration drift

**What goes wrong:**
The Better Auth Drizzle adapter (plus organization plugin) expects specific tables/columns (users, sessions, accounts, verification, organization, member, invitation). If you hand-roll the schema or let the adapter and your own migrations diverge, auth fails at runtime with cryptic errors, or the organization plugin can't find its tables. Multi-tenant membership/roles (owner/developer/viewer) live partly in plugin tables and partly in your `memberships` — duplicating or mismatching them creates two sources of truth.

**Why it happens:**
Two schema generators (Better Auth CLI vs your Drizzle migrations) competing; plugin tables are easy to forget; the project already has a `memberships` table in `docs/modelo-mvp.md` §3.3 that must reconcile with the org plugin's `member` table.

**How to avoid:**
- Generate the Better Auth schema via its CLI, commit it as Drizzle schema, and feed it through the same `generate`/`migrate` pipeline — one migration history.
- Decide explicitly whether the org plugin's `member` table *is* your `memberships` (preferred — one source of truth for roles) or whether you keep a separate domain table. Document the mapping. Don't run both with overlapping responsibilities.
- Re-run the auth schema generator after any plugin/version bump and review the diff.

**Warning signs:**
- Auth tables created outside the Drizzle migration history.
- Both a `member` and a `memberships` table holding roles.
- Runtime "relation does not exist" / missing-column errors from auth.

**Phase to address:** This milestone (phase 0). Verification: auth + org plugin run against the migrated schema with no runtime schema errors; roles resolve from one table.

---

### Pitfall 7: Traefik exhausts Let's Encrypt rate limits on staging

**What goes wrong:**
Let's Encrypt production limits issuance (~50 certs/domain/week, plus duplicate-certificate limits). A crash-looping Traefik, non-persisted `acme.json`, or repeated redeploys during phase-0 iteration request fresh certs each restart and hit the limit — then *no* cert issues for up to a week, blocking the staging demo. The on-demand TLS feature for clients' custom domains (planned in the master doc) amplifies this risk later.

**Why it happens:**
`acme.json` not mounted to a persistent volume; using the production CA while iterating; container restart loops during early infra debugging.

**How to avoid:**
- Use the **Let's Encrypt staging CA** (`acme-staging-v02`) while building/iterating phase-0 infra; switch to production only when the setup is stable. Use separate storage files (`acme-staging.json` / `acme.json`).
- Persist `acme.json` on a Docker volume; set file permissions to `600` (Traefik refuses world-readable acme storage).
- Fix crash loops before they spin; cap restart policy during debugging.
- For the future custom-domain feature, plan DNS-01 or careful on-demand issuance with the rate limits in mind — flag as a later milestone, NOT phase 0.

**Warning signs:**
- `acme.json` lives inside the container (lost on rebuild) or is `644`.
- Repeated "too many certificates already issued" / rate-limit errors in Traefik logs.
- Browser shows the staging CA cert in prod (left on staging CA by mistake).

**Phase to address:** This milestone (phase 0) for staging TLS. Custom-domain on-demand TLS: later milestone.

---

### Pitfall 8: Over-engineering phase 0 past the one-week control rule

**What goes wrong:**
The master doc sets a hard rule: if phase 0 takes more than a week, recalibrate the whole plan. With an AI assistant it is tempting to fully wire OpenTelemetry traces, Grafana/Loki dashboards, BullMQ workers, PgBouncer, SOPS secret rotation, and custom-domain TLS *now*. The foundation balloons to two weeks, the Fable window burns on plumbing instead of the "wow" demo (explorer + quoter), and the control rule is violated.

**Why it happens:**
"Professional from day one" (a real project value) gets misread as "everything, maximally, immediately". AI makes adding each piece cheap, so scope creeps silently. Solo dev has no one pushing back.

**How to avoid:**
- Define phase-0 "done" minimally and literally from PROJECT.md Active list: monorepo skeleton, CI (lint+typecheck+test), Docker Compose up with Postgres/Redis, Better Auth + orgs + RLS isolation proven, versioned migrations, auto-deploy to staging, *basic* observability (Sentry capturing errors + pino structured logs + Uptime Kuma ping). That is enough.
- Defer to later milestones (explicitly, in the roadmap): full OTel tracing dashboards, BullMQ/worker logic, PgBouncer, image pipeline, SOPS rotation, custom-domain on-demand TLS. Stub the worker app as an empty deployable shell only.
- Time-box: if phase 0 crosses ~5 working days, stop and recalibrate per the control rule rather than pushing through.

**Warning signs:**
- Building features (quoting, media, panel CRUD) "while I'm here".
- Grafana dashboards / OTel spans being tuned before any product code exists.
- Day 6+ of phase 0 with isolation tests still not green.

**Phase to address:** This milestone (phase 0) — it is a scoping discipline. Verification: phase-0 exit checklist matches PROJECT.md Active list exactly, no more.

---

### Pitfall 9: Single-app Docker build pulls the whole monorepo (slow, broken, leaks secrets)

**What goes wrong:**
Building `apps/web` (or `panel`/`worker`) by copying the entire monorepo into the image: huge images, slow CI, cache thrash, and workspace packages (`packages/db`, `api`, etc.) not resolving at runtime — or, worse, `.env` / source for *all* apps baked into one image. Next.js in a monorepo also commonly ships broken because `output: 'standalone'` and `outputFileTracingRoot` aren't set, so workspace deps aren't traced.

**Why it happens:**
Naive `COPY . .` Dockerfile; not knowing about `turbo prune --docker`; forgetting Next.js standalone needs the monorepo root as tracing root and `transpilePackages` for internal packages.

**How to avoid:**
- Use `turbo prune --docker <app>` to produce a minimal pruned context per app, with a multi-stage Dockerfile (deps → build → runner) and pnpm with corepack.
- In each Next.js app: `output: 'standalone'`, `outputFileTracingRoot` = monorepo root, `transpilePackages` listing internal `packages/*` consumed.
- Run from `.next/standalone` in the runner stage; don't reinstall deps or ship dev deps. Keep build args / secrets out of layers (use `--secret`, not `ARG`).

**Warning signs:**
- Dockerfile starts with `COPY . .`.
- Image size in hundreds of MB for a Next app; CI build minutes climbing.
- Runtime "cannot find module @repo/db" or missing internal package.

**Phase to address:** This milestone (phase 0) — building/deploying the three apps from the monorepo is in scope.

---

### Pitfall 10: Insecure VPS deploy from GitHub Actions

**What goes wrong:**
Phase 0 wires auto-deploy to a *shared* VPS that also hosts `andescode.com.ar`. Common mistakes: long-lived SSH keys with broad access in repo secrets; the workflow `docker compose pull && up` over SSH as root; secrets echoed into logs; or a self-hosted runner on the shared box that becomes a backdoor into the host. A compromise here touches the unrelated production site on the same VPS.

**Why it happens:**
SSH-deploy tutorials use a root key and `set -x`. Self-hosted runners are convenient but are a documented attack surface ("assume anyone who can run a workflow has the runner's environment").

**How to avoid:**
- Deploy with a dedicated, least-privilege deploy user (not root), a key scoped to that user, stored in GitHub Secrets (never in the repo). Restrict the key's `authorized_keys` `command=`/forced command if possible.
- Pull images from a registry on the VPS rather than building on the shared host; pass app secrets via env files on the box (or SOPS), never via workflow logs. Mask secrets; avoid `set -x`.
- Prefer NOT putting a self-hosted runner on the shared VPS; if used, isolate it (container, restricted network egress) and never on the same trust boundary as the existing site.
- Isolate staging from `andescode.com.ar`: separate Traefik routers, separate Docker networks/volumes, no shared DB.

**Warning signs:**
- Root SSH key in secrets; deploy runs as root.
- `set -x` or secret values visible in Actions logs.
- A self-hosted runner installed directly on the host that also serves the main site.

**Phase to address:** This milestone (phase 0). Verification: deploy uses non-root scoped user; staging and the existing site are network/volume isolated.

---

### Pitfall 11: Sentry/observability wired wrong for App Router RSC (errors silently dropped)

**What goes wrong:**
With Next.js App Router, server-side and React Server Component errors are NOT captured unless you export `onRequestError` calling `Sentry.captureRequestError` in `instrumentation.ts`. Teams install the SDK, see client errors, and assume server coverage — but RSC render errors (exactly where tRPC/DB/RLS failures surface) vanish. The project's value prop is "we can't learn about outages from the client's WhatsApp", so silent server errors defeat the whole observability deliverable. Separately, naive pino + Next.js (especially edge/serverless contexts) can crash or produce unstructured logs, and over-eager OTel auto-instrumentation floods traces with noise.

**Why it happens:**
The `onRequestError` hook is new-ish and easy to miss; the SDK's client setup looks complete. pino transports don't always work in all Next runtimes. OTel defaults instrument everything.

**How to avoid:**
- Add `instrumentation.ts` with `onRequestError` → `Sentry.captureRequestError`; await any async work in it. Verify by deliberately throwing in an RSC and confirming the event lands in Sentry.
- Configure pino for structured JSON to stdout (let the container/Loki collect it); avoid fragile transports in the request path; ensure it works in the Node runtime used by the apps.
- Keep OTel minimal in phase 0 (errors + uptime + structured logs are enough per Pitfall 8). Don't enable broad auto-instrumentation/sampling tuning yet.

**Warning signs:**
- No `instrumentation.ts` `onRequestError` export.
- A thrown error in a server component never appears in Sentry.
- Logs are plain strings, or pino throws in the Next runtime.

**Phase to address:** This milestone (phase 0) — "observability from the first deploy" is in scope. Deeper OTel tracing: later milestone.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `drizzle-kit push` in dev | Instant schema sync | RLS policies silently missing; violates versioned-migration standard | Never (use generate+migrate) |
| App connects as DB owner/superuser | One DB user, no grants to manage | RLS silently bypassed (Pitfall 2); breach risk | Never for tenant tables |
| Session-scoped tenant context | Slightly simpler query code | Cross-tenant leak under pooling (Pitfall 1) | Never |
| Skip the cross-tenant absence test | Faster "done" | False isolation confidence; breach ships | Never |
| Build full OTel/Grafana/BullMQ in phase 0 | Feels thorough | Blows the 1-week rule; burns Fable window | Never in phase 0 — defer |
| `COPY . .` monorepo Docker build | Dockerfile "just works" first try | Huge images, secret leakage, broken workspace deps | Only a throwaway spike, never committed |
| Static `baseURL` only (no proxy header plan) | Auth works on staging fast | Custom client domains later need rework | OK for phase 0 (single staging host); revisit at custom-domain milestone |
| Single shared VPS for staging + existing site | Zero new infra cost | Blast radius spans unrelated prod site | OK for staging only, with strict network/volume isolation |
| Stub `apps/worker` as empty shell | Keeps phase 0 small | None — this is the *correct* deferral | Always (recommended) |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Postgres RLS + connection pool | `set_config(...,false)` / `SET` session var | `set_config(...,true)` inside a transaction via one `withTenant` helper |
| Postgres RLS + app role | App runs as table owner/superuser | Dedicated non-owner roles (`app_authenticated`, `app_anon`) + `FORCE ROW LEVEL SECURITY` |
| Drizzle + RLS | Policies via `push`; assume auto-generated | `generate`+`migrate`; hand-write policy SQL where drizzle-kit can't; verify `pg_policies` |
| Better Auth + Traefik | Wrong base URL / blindly trust forwarded headers | Explicit `BETTER_AUTH_URL` or `trustedProxyHeaders` with Traefik sanitizing `X-Forwarded-*` |
| Better Auth + Drizzle adapter | Two competing schema sources; duplicate role tables | One migration history; reconcile org-plugin `member` with domain `memberships` |
| Better Auth multi-app (web+panel) | Cookie domain / `trustedOrigins` / secret mismatch | Shared secret, all origins listed, deliberate cookie-domain decision |
| Traefik + Let's Encrypt | Non-persisted `acme.json`, prod CA while iterating | Persist `acme.json` (perms 600), use staging CA during build, separate storage files |
| Sentry + App Router | Only client SDK; no `onRequestError` | `instrumentation.ts` exporting `Sentry.captureRequestError`; verify with a thrown RSC error |
| pino + Next.js | Fragile transport in request/edge path | Structured JSON to stdout, collected by container/Loki; verify in target runtime |
| GitHub Actions → VPS | Root SSH key in secrets; secrets in logs | Least-privilege deploy user, masked secrets, registry pull, no self-hosted runner on shared host |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| RLS policy with non-sargable / per-row subquery | Slow tenant queries as rows grow | Use simple `current_setting('app.current_tenant')::uuid = organization_id`; index the tenant column; wrap `current_setting` so the planner caches it | Noticeable at 10k+ rows/tenant; severe in `events` (partitioned) |
| No index on tenant discriminator | Seq scans on every tenant query | Index `organization_id`/`project_id` on every tenant table | As soon as data accumulates |
| Connection exhaustion on small VPS | "too many connections" under modest load | Plan for transaction-scoped context now so PgBouncer can be added without code change | When concurrency rises (later milestones) — design-only in phase 0 |
| Turbo/CI cache misconfigured | CI re-runs everything every commit; slow merges | Correct Turborepo task `inputs`/`outputs` and remote/local cache; cache pnpm store | Immediately on a busy repo; wastes the Fable window |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| RLS bypass via owner/superuser app role | Full cross-tenant read/write | Non-owner app roles + `FORCE ROW LEVEL SECURITY` (Pitfall 2) |
| Session-leaked tenant context under pooling | Silent cross-tenant breach | Transaction-scoped `set_config` (Pitfall 1) |
| `anon` role too permissive | Public web reads drafts/leads/events | `anon` policy limited to `projects.estado='publicado'`; no read on `leads`/`events`; insert-only with rate limit for `events`/`leads` |
| Trusting `X-Forwarded-*` without sanitizing | Host-header / CSRF / open redirect | Traefik sets and strips forwarded headers; `trustedOrigins` allowlist |
| Secrets in image layers / Actions logs | Credential leak | Docker `--secret`, masked GH secrets, no `set -x`, SOPS/age for env at rest |
| Shared VPS blast radius | Staging compromise reaches existing prod site | Network/volume isolation; non-root deploy user; no shared DB |
| Self-hosted runner on shared host | Backdoor into the box | Avoid, or isolate runner with restricted egress |
| Anonymous insert path (events/leads) unbounded | Spam / DoS / cost | Rate-limit at Traefik edge + Zod validation (per master doc §3.3) |

## UX Pitfalls

(Phase 0 has minimal end-user UX; these are operator/developer-experience pitfalls relevant now.)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Works on my machine", not on staging | Demo/integration fails late; control-rule risk | Each phase ends *deployed to staging*, not local-only (master doc rule) |
| Auth flow only tested on localhost | Login/cookies break on the real staging URL | Test full login/invite/org-switch against `staging.tours.andescode.com.ar` |
| Restore never rehearsed | "Backup" is illusory at first incident | Master doc rule: rehearse restore before first paying client (later milestone; note now) |

## "Looks Done But Isn't" Checklist

- [ ] **RLS multi-tenancy:** Often missing the cross-tenant *absence* test run as the app role — verify org A cannot see org B for select/insert/update/delete, and `anon` sees only published projects.
- [ ] **RLS policies:** Often missing because of `push` — verify `pg_policies` lists every expected policy on a fresh `migrate`.
- [ ] **App DB role:** Often still the owner/superuser — verify app `DATABASE_URL` is a non-owner role and `FORCE ROW LEVEL SECURITY` is set.
- [ ] **Tenant context:** Often session-scoped — verify every tenant query goes through the transaction-scoped `withTenant` helper.
- [ ] **Better Auth on staging:** Often only localhost-tested — verify login + email invite + org switch on the public staging URL with secure cookies.
- [ ] **Auth schema:** Often outside migration history — verify org-plugin tables are in the Drizzle migrations and roles come from one table.
- [ ] **Sentry server errors:** Often missing `onRequestError` — verify a deliberate RSC throw appears in Sentry.
- [ ] **Structured logs:** Often plain strings — verify pino emits JSON to stdout in the Node runtime and reaches Loki.
- [ ] **TLS:** Often on staging CA in prod or non-persisted `acme.json` — verify prod CA, persisted `acme.json` (perms 600).
- [ ] **Docker images:** Often whole-monorepo — verify `turbo prune` + Next standalone, small image, internal packages resolve at runtime.
- [ ] **Deploy security:** Often root SSH key + logged secrets — verify non-root scoped deploy user, masked secrets, staging isolated from existing site.
- [ ] **Worker app:** Often over-built — verify `apps/worker` is a deployable empty shell (logic deferred), keeping phase 0 small.
- [ ] **Phase-0 scope:** Often crept — verify exit checklist == PROJECT.md Active list, nothing more, within ~1 week.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cross-tenant leak shipped (Pitfall 1/2/3) | HIGH | Rotate to non-owner roles, add FORCE RLS + transaction-scoped helper, write absence tests, audit logs/data for cross-tenant access, notify if a real breach occurred. Cheap if caught in phase 0 (no real data yet) — the reason to do it now |
| Policies missing from `push` (Pitfall 4) | LOW (in phase 0) | Switch to generate+migrate, write the policy migrations, re-run, verify `pg_policies` |
| Auth broken behind proxy (Pitfall 5) | LOW–MEDIUM | Set explicit baseURL / configure trusted proxy headers + Traefik; fix `trustedOrigins`/cookie domain; retest on staging |
| Auth schema drift (Pitfall 6) | MEDIUM | Regenerate auth schema, write reconciling migration, collapse duplicate role tables |
| Let's Encrypt rate-limited (Pitfall 7) | MEDIUM (time-bound) | Switch to staging CA, persist `acme.json`, wait out the rolling weekly limit; can't be forced faster |
| Phase 0 over-built (Pitfall 8) | MEDIUM | Cut deferred items back out, recalibrate plan per control rule before continuing |
| Bloated/broken Docker build (Pitfall 9) | LOW–MEDIUM | Rewrite Dockerfile with `turbo prune` + standalone; set tracing root/transpilePackages |
| Insecure deploy (Pitfall 10) | MEDIUM | Rotate keys, switch to non-root deploy user, isolate staging, scrub secrets from history/logs |
| Server errors invisible (Pitfall 11) | LOW | Add `onRequestError`; fix pino transport; verify with a forced error |

## Pitfall-to-Phase Mapping

All eleven pitfalls land in **this milestone (phase 0)** because phase 0 *is* the foundation; the table notes verification and what to deliberately defer.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Pooled-connection tenant leak | Phase 0 | `withTenant` is the only tenant query path; concurrency test shows no context bleed |
| 2. Owner/superuser RLS bypass | Phase 0 | App role is non-owner; `FORCE ROW LEVEL SECURITY` on all tenant tables |
| 3. Isolation untested | Phase 0 | Cross-tenant absence suite green in CI (run as app role) |
| 4. Drizzle `push` drops policies | Phase 0 | `pg_policies` complete after `migrate`; no `push` script exists |
| 5. Better Auth behind Traefik | Phase 0 | Full login/invite/org-switch works on staging URL with secure cookies |
| 6. Auth schema drift | Phase 0 | Auth tables in Drizzle migration history; roles from one table |
| 7. Let's Encrypt rate limit | Phase 0 (staging) / later (custom domains) | Persisted `acme.json` (600); staging CA during build, prod CA on prod |
| 8. Over-engineering phase 0 | Phase 0 (discipline) | Exit checklist == PROJECT.md Active list; under ~1 week |
| 9. Monorepo Docker build | Phase 0 | `turbo prune` + Next standalone; small images; internal packages resolve |
| 10. Insecure VPS deploy | Phase 0 | Non-root scoped deploy user; staging isolated from existing site; secrets masked |
| 11. App Router / pino / OTel observability | Phase 0 (errors+logs+uptime) / later (OTel tracing) | Forced RSC error reaches Sentry; pino JSON reaches Loki; Uptime Kuma pings |

## Sources

- Postgres RLS footguns & pooling: [Bytebase — Postgres RLS Footguns](https://www.bytebase.com/blog/postgres-row-level-security-footguns/), [PlanetScale — RLS sounds great until it isn't](https://planetscale.com/blog/rls-sounds-great-until-it-isnt), [MVP Factory — RLS tenant isolation](https://mvpfactory.io/blog/row-level-security-in-postgresql-multi-tenant-data-isolation-for-your-saas) (MEDIUM, cross-checked)
- Drizzle RLS: [Drizzle ORM — RLS docs](https://orm.drizzle.team/docs/rls), [drizzle-orm issue #3504 — push vs migrate](https://github.com/drizzle-team/drizzle-orm/issues/3504), [Neon — Simplify RLS with Drizzle](https://neon.com/docs/guides/rls-drizzle) (HIGH)
- Better Auth proxy/security: [Better Auth — Security reference](https://better-auth.com/docs/reference/security), [better-auth issue #3215 — wrong baseURL](https://github.com/better-auth/better-auth/issues/3215) (MEDIUM, evolving API)
- Monorepo Docker: [Turborepo — Docker guide](https://turborepo.dev/docs/guides/tools/docker), [vercel/next.js discussion #85099 — self-hosting App Router + Turborepo](https://github.com/vercel/next.js/discussions/85099) (HIGH)
- Traefik ACME: [Traefik v3.4 — Let's Encrypt docs](https://doc.traefik.io/traefik/v3.4/https/acme/) (HIGH)
- Sentry App Router: [Sentry — Capturing Errors (Next.js)](https://docs.sentry.io/platforms/javascript/guides/nextjs/usage/), [Next.js — instrumentation.js conventions](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) (HIGH)
- CI/CD VPS security: [Sysdig — self-hosted runners as backdoors](https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors) (MEDIUM)
- Project context: `docs/modelo-mvp.md`, `CLAUDE.md`, `.planning/PROJECT.md` (HIGH — authoritative for scope/control rules)

---
*Pitfalls research for: multi-tenant SaaS foundation (Next.js + tRPC + Drizzle/Postgres RLS + Better Auth + Docker/Traefik), phase 0*
*Researched: 2026-06-12*
