---
phase: 03-auth-api-app-surfaces
plan: 04
subsystem: app-surfaces
tags: [next, rsc, anon-rls, trpc-caller, bullmq, ioredis, redis, worker-shell, vitest]

# Dependency graph
requires:
  - phase: 03-auth-api-app-surfaces
    plan: 02
    provides: "@imbau/api barrel with createCaller + projects.listPublished (publicProcedure → withAnon); AppRouter type"
  - phase: 02-data-layer-rls
    provides: "withAnon + projects_anon_published RLS policy (estado='publicado' only); @imbau/db client"
provides:
  - "apps/web: a force-dynamic published-projects RSC reading createCaller(...).projects.listPublished() via the anon path (APP-02); web is anon-only — no auth handler, no auth/tRPC client, no withTenant"
  - "apps/worker: a deployable BullMQ shell — IORedis(REDIS_URL, { maxRetriesPerRequest: null }) + Queue/Worker on 'health', no job logic (APP-03); env-first boot + structured boot log preserved; no Sentry/pino/OTel"
  - "createConnection / createHealthWorker / boot factories on the worker for testable, leak-free wiring"
  - "worker Redis-connect smoke test proving the Worker reaches 'ready' against the Compose Redis"
affects: [04-docker-ci-staging-observability, web-public-showroom, worker-jobs-media-pdf]

# Tech tracking
tech-stack:
  added:
    - "bullmq@5.78.1 (apps/worker)"
    - "ioredis@5.10.1 (apps/worker — aligned to bullmq's exact pin)"
    - "@imbau/api workspace dep (apps/web)"
  patterns:
    - "web reads the published list through the @imbau/api barrel createCaller → publicProcedure listPublished → withAnon; no app-layer org filter, the anon RLS policy filters to estado='publicado' (T-03-16)"
    - "the published page is force-dynamic: the anon DB read happens per request, never at `next build` static collection (which has no live DB)"
    - "web env.ts declares DATABASE_ANON_URL in the server block only (never NEXT_PUBLIC_) and honors SKIP_ENV_VALIDATION for the Docker build — mirrors worker/db/api env wiring (T-03-19)"
    - "worker factors createConnection/createHealthWorker/boot and auto-boots ONLY when it is the process entrypoint, so the smoke test imports the module without spawning a leaked worker"
    - "worker ioredis is pinned to bullmq's exact dependency version (5.10.1) so a single IORedis type flows into new Worker({ connection }) — avoids a dual-version type skew"

key-files:
  created:
    - "apps/worker/src/index.test.ts"
  modified:
    - "apps/web/app/page.tsx"
    - "apps/web/env.ts"
    - "apps/web/next.config.ts"
    - "apps/web/package.json"
    - "apps/worker/src/index.ts"
    - "apps/worker/package.json"
    - "pnpm-workspace.yaml"
    - "pnpm-lock.yaml"

key-decisions:
  - "The published page is `export const dynamic = 'force-dynamic'`: it reads Postgres (anon pool) on every request, so it must never be statically prerendered at `next build` (no live DB at build). Deviation Rule 3."
  - "apps/web/env.ts gains `skipValidation: process.env.SKIP_ENV_VALIDATION === '1'` to support the fase-3 Docker image build (D-03/D-16) without live secrets — mirrors the worker/db/api env modules; the original web env.ts lacked it. Deviation Rule 3."
  - "ioredis is pinned to 5.10.1 (bullmq's exact dependency), NOT the 5.11.1 listed in CLAUDE.md's matrix: bullmq@5.78.1 pins ioredis 5.10.1 exactly, and a second 5.11.1 in the tree produced a structurally-incompatible IORedis type at `new Worker({ connection })`. Aligning to bullmq's pin yields a single type. Deviation Rule 3."
  - "msgpackr-extract (bullmq's optional native msgpack accelerator) set to allowBuilds:false — bullmq falls back to pure-JS msgpackr without it, keeping the worker portable and stopping pnpm's ignored-build-script gate from failing `pnpm --filter ... test`."

requirements-completed: [APP-02, APP-03]

# Metrics
duration: 6min
completed: 2026-06-17
---

# Phase 3 Plan 04: Web Published List + Worker BullMQ Shell Summary

**`apps/web` renders a force-dynamic published-projects RSC via the anon path (createCaller → `projects.listPublished` → `withAnon` → RLS returns only `estado='publicado'`), with no auth/tRPC surface (D-03); `apps/worker` becomes a deployable BullMQ shell — `IORedis(REDIS_URL, { maxRetriesPerRequest: null })` + a `health` Queue/Worker with no job logic — proven by a smoke test that reaches the Compose Redis and the Worker's `ready` state.**

## Performance
- **Duration:** ~6 min
- **Tasks:** 2 (Task 2 was TDD: RED smoke test → GREEN shell)
- **Files created/modified:** 8 (1 created, 7 modified)

## Accomplishments
- **APP-02 — the anonymous read path is wired end to end in the public app.** `apps/web/app/page.tsx` is a server component that builds the `@imbau/api` server caller and calls `projects.listPublished()`; the read flows `publicProcedure → withAnon → anon pool`, where the `projects_anon_published` RLS policy (phase 2) returns only `estado='publicado'` rows. There is NO app-layer `where` filter and NO tenant/auth path in web — `borrador`/`archivado` are invisible by construction (T-03-16). The page renders `nombre · slug · estado` in a flat es-AR list (D-13/D-14).
- **Web stays strictly anon-only (D-03 / T-03-17).** A grep over `apps/web/` for `toNextJsHandler`, `withTenant`, `@trpc/client`, `@trpc/tanstack`, `createTRPCClient`, and `authClient` returns nothing. The only API import is `createCaller`.
- **Server-only env stays server-only (T-03-19).** `DATABASE_ANON_URL` is validated in the `server` block of the t3-env split; only `NEXT_PUBLIC_APP_ENV` reaches the client bundle.
- **APP-03 — the worker is a deployable BullMQ shell.** `apps/worker/src/index.ts` constructs `new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })` (the `null` is required by BullMQ) plus a `Queue("health")` and a no-op `Worker("health")`. The env-first import and the structured boot JSON log are preserved; there is NO real job logic and NO Sentry/pino/OTel (phase-4 scope guard).
- **The connection is proven, not assumed.** `apps/worker/src/index.test.ts` constructs the connection, asserts `maxRetriesPerRequest === null`, stands up the Worker, waits for its `ready` event against the live Compose Redis (`redis://localhost:6380`), and confirms a live `PING` round-trips — then closes both cleanly. RED→GREEN verified.
- Both apps green under Node 22: `@imbau/web` typecheck + build (route `/` is `ƒ Dynamic`, standalone output) and lint; `@imbau/worker` typecheck + smoke test + tsup build (`dist/index.js`) + lint.

## Task Commits
1. **Task 1: apps/web published-projects list via anon read** — `6274505` (feat)
2. **Task 2 (RED): worker Redis-connect smoke test** — `e9a91ed` (test)
3. **Task 2 (GREEN): worker BullMQ shell connected to Redis** — `da1e5f4` (feat)

## Files Created/Modified
- `apps/web/app/page.tsx` — force-dynamic published-projects RSC: `createCaller({ headers: await headers() }).projects.listPublished()`, renders `nombre · slug · estado`, empty-state message. No auth/tRPC surface.
- `apps/web/env.ts` — adds `DATABASE_ANON_URL` (server block, via `dbEnv` preset) and `skipValidation` for the Docker build.
- `apps/web/next.config.ts` — `@imbau/api` added to `transpilePackages`.
- `apps/web/package.json` — `@imbau/api` workspace dep.
- `apps/worker/src/index.ts` — BullMQ shell: `createConnection` (maxRetriesPerRequest null), `createHealthWorker` (no-op processor), `boot` (queue+worker+ready log), env-first import + boot log preserved, entrypoint-guarded auto-boot.
- `apps/worker/src/index.test.ts` — Redis-connect smoke test (created).
- `apps/worker/package.json` — `bullmq@5.78.1`, `ioredis@5.10.1`, `vitest` devDep.
- `pnpm-workspace.yaml` — `allowBuilds: msgpackr-extract: false` (resolved the install placeholder pnpm injected).
- `pnpm-lock.yaml` — lockfile for the new deps.

## Decisions Made
See `key-decisions` in frontmatter. The load-bearing ones: (1) the published page is `force-dynamic` because the anon read is per-request, not buildable statically; (2) `ioredis` pinned to bullmq's exact `5.10.1` to keep a single `IORedis` type at the `Worker({ connection })` boundary; (3) `SKIP_ENV_VALIDATION` wired into web's env for the Docker build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Published page must be `force-dynamic` — static collection has no live DB**
- **Found during:** Task 1 (`next build`)
- **Issue:** `next build` collects page data by rendering the route, which imports `@imbau/db` and (without the flag) tries a build-time DB connection — failing because the anon read is inherently per-request.
- **Fix:** Added `export const dynamic = "force-dynamic"` to the page; `headers()` already opts into dynamic rendering, the flag documents and guards the intent.
- **Files modified:** apps/web/app/page.tsx
- **Verification:** `next build` succeeds; the `/` route reports `ƒ (Dynamic)`.
- **Committed in:** `6274505`

**2. [Rule 3 - Blocking] web env needed `skipValidation` for the Docker build**
- **Found during:** Task 1 (`next build` with `SKIP_ENV_VALIDATION=1`)
- **Issue:** Web's env.ts (`@t3-oss/env-nextjs`) did not wire `skipValidation`, so the env still threw at `next build` without live secrets — but the fase-3 Docker image is built without secrets (D-03/D-16). The worker/db/api env modules already wire this; web was the outlier.
- **Fix:** Added `skipValidation: process.env.SKIP_ENV_VALIDATION === "1"`. At container boot the flag is unset → validation always runs and fails closed.
- **Files modified:** apps/web/env.ts
- **Verification:** `SKIP_ENV_VALIDATION=1 next build` compiles; without the flag at runtime the env still fails closed (unchanged default).
- **Committed in:** `6274505`

**3. [Rule 3 - Blocking] ioredis dual-version type skew with bullmq**
- **Found during:** Task 2 (`@imbau/worker typecheck`)
- **Issue:** Pinning `ioredis@5.11.1` (CLAUDE.md matrix) put two ioredis versions in the tree — bullmq@5.78.1 pins `5.10.1` exactly — and the two `IORedis` types are structurally incompatible at `new Worker(..., { connection })` (protected-member mismatch on `AbstractConnector`).
- **Fix:** Pinned the worker's `ioredis` to `5.10.1` (bullmq's exact dependency), so the worker resolves a single ioredis instance/type.
- **Files modified:** apps/worker/package.json, pnpm-lock.yaml
- **Verification:** `@imbau/worker typecheck` clean; `pnpm why ioredis` shows no consumer of 5.11.1.
- **Committed in:** `da1e5f4`

**4. [Rule 3 - Blocking] pnpm ignored-build-script gate (msgpackr-extract) failed `pnpm --filter ... test`**
- **Found during:** Task 2 (running the worker test)
- **Issue:** bullmq pulls `msgpackr` whose optional native accelerator `msgpackr-extract` has a build script; pnpm 11.6 inserted a placeholder in `allowBuilds` and the unresolved entry made the pre-test `pnpm install` deps-check exit non-zero.
- **Fix:** Set `msgpackr-extract: false` in `pnpm-workspace.yaml allowBuilds` (bullmq works without the native build — pure-JS msgpackr fallback), keeping the worker portable.
- **Files modified:** pnpm-workspace.yaml, pnpm-lock.yaml
- **Verification:** `pnpm install` clean (no ignored-build error); `pnpm --filter @imbau/worker test` runs.
- **Committed in:** `da1e5f4`

**5. [Rule 1 - Lint/correctness] no-op processor flagged `require-await`**
- **Found during:** Task 2 (`@imbau/worker lint`)
- **Issue:** `async () => "ok"` has no `await` → `@typescript-eslint/require-await` error (CI-red per CLAUDE.md).
- **Fix:** Changed the no-op processor to `() => Promise.resolve("ok")` — still satisfies BullMQ's `Processor` Promise return, lint-clean.
- **Files modified:** apps/worker/src/index.ts
- **Verification:** `@imbau/worker lint` clean; smoke test still green.
- **Committed in:** `da1e5f4`

---
**Total deviations:** 5 auto-fixed (4 blocking, 1 lint/correctness). All stay within the plan's owned files (`apps/web/*`, `apps/worker/*`) plus the shared lockfile/workspace config required by the new worker deps. No `packages/api` / `apps/panel` touched. No scope creep into job logic or observability.

## Threat Model Verification
- **T-03-16 (web leaks non-published projects):** web reads ONLY via `withAnon` → `projects_anon_published` returns `estado='publicado'` only; no tenant path in web; the 03-02 anon caller test already asserts borrador absence. ✅
- **T-03-17 (web gaining an auth/tenant data path):** grep over `apps/web/` for `toNextJsHandler`/`withTenant`/`@trpc/client`/`@trpc/tanstack`/`createTRPCClient`/`authClient` returns nothing — web's only API import is `createCaller`. ✅
- **T-03-18 (worker retry storm):** accepted this phase — `maxRetriesPerRequest: null` is BullMQ's required setting; backoff/queue hardening lands with real jobs. ✅
- **T-03-19 (server env leaking into the client bundle):** `DATABASE_ANON_URL` lives in the t3-env `server` block; only `NEXT_PUBLIC_APP_ENV` is wired into `experimental__runtimeEnv`. ✅

## Validation / CI Notes
- The worker smoke test connected to the LIVE Compose Redis at `redis://localhost:6380` (host 6380 → container 6379; host 6379 is Homebrew Redis). It is NOT deferred-to-CI — it ran green locally. In CI (phase 4) the harness re-points `REDIS_URL` at the GitHub Actions Redis service unchanged.
- Web build verified with `SKIP_ENV_VALIDATION=1` (the Docker-build path, D-16); the `/` route is `ƒ Dynamic`. The BetterAuth "default secret" line at build is a benign warning under the skip flag — the secret is provided at container boot.
- Docker image builds for both apps are authored in a later plan / verified in CI (no local Docker daemon — CONTEXT scope guard).

## Known Stubs
The worker's `health` processor is an intentional no-op (`() => Promise.resolve("ok")`) — this is the APP-03 shell-only contract (D-16); real job logic lands with the media/PDF pipeline in a later milestone. Not a defect.

## Threat Flags
None — no security surface beyond the plan's threat model. Web adds no endpoint (anon RSC read only); the worker connects to Redis on the internal network with no new auth secrets.

## Self-Check: PASSED

- Created file present: `apps/worker/src/index.test.ts` ✅
- Modified files present: web page.tsx/env.ts/next.config.ts/package.json, worker index.ts/package.json ✅
- All 3 task commits in history: `6274505`, `e9a91ed`, `da1e5f4` ✅
- Grep: `listPublished` in page.tsx ✅; `maxRetriesPerRequest` in worker index.ts ✅; no `toNextJsHandler`/`withTenant`/tRPC client under `apps/web/` ✅
- Gates: web typecheck+build+lint, worker typecheck+smoke test+tsup build+lint all green ✅
- Scope: only `apps/web/*`, `apps/worker/*`, and the shared lockfile/workspace config changed ✅

---
*Phase: 03-auth-api-app-surfaces*
*Completed: 2026-06-17*
