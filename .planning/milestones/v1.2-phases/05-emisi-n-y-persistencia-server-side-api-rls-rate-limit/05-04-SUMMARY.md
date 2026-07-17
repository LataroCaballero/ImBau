---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
plan: 04
subsystem: api
tags: [trpc, next-app-router, t3-env, rls, multi-tenant, quotes]

# Dependency graph
requires:
  - phase: 05-01
    provides: quotesRouter (quotes.compute / quotes.create) mounted on appRouter with publicProcedures resolving org server-side
provides:
  - apps/web serves appRouter (incl. quotesRouter) over HTTP at /api/trpc/[trpc], mirror of the panel handler
  - apps/web env validates DATABASE_APP_URL at boot (A1 widening) — the app pool reached ONLY via withTenant inside packages/api
  - PROJECT.md Key Decision A1 (D-06) registered, closing the A1-vs-A2 note left open by the v1.2 roadmap
affects: [phase-05-05 nginx rate-limit on /api/trpc/quotes, phase-6 web quote UI client]

# Tech tracking
tech-stack:
  added: ["@trpc/server@11.17.0 as direct dep of @imbau/web (workspace link only — already in store via panel/api)"]
  patterns:
    - "Public web tRPC mount: fetchRequestHandler → appRouter, endpoint /api/trpc, sessionless createTRPCContext resolves session=null; publicProcedures resolve org from the publicado project (never client-supplied orgId)"
    - "t3-env server block widened with DATABASE_APP_URL documented at the boundary — the A1 fence (T-03-09: web imports data access only via @imbau/api) stated in-comment"

key-files:
  created:
    - "apps/web/app/api/trpc/[trpc]/route.ts"
  modified:
    - "apps/web/env.ts"
    - "apps/web/package.json"
    - "pnpm-lock.yaml"
    - ".planning/PROJECT.md"

key-decisions:
  - "A1 (D-06): apps/web hosts the app pool for the anonymous quote path via its own tRPC mount + DATABASE_APP_URL; A2 (dedicated panel/API emission) rejected — cross-app hop with no isolation gain, fence T-03-09 keeps the data surface identical"

patterns-established:
  - "Byte-mirror route handler between apps/panel and apps/web (identical modulo header comment) — appRouter served under /api/trpc/* on both surfaces"

requirements-completed: [QUOTE-01]

coverage:
  - id: D1
    description: "apps/web mounts the tRPC route handler at /api/trpc/[trpc], serving appRouter (incl. quotesRouter) so the anonymous quote path is HTTP-reachable on the public web surface"
    requirement: "QUOTE-01"
    verification:
      - kind: unit
        ref: "pnpm turbo run typecheck lint test --filter=@imbau/web (9/9 tasks pass; route.ts typechecks + lints; grep-fence: no @imbau/db under apps/web)"
        status: pass
    human_judgment: false
  - id: D2
    description: "apps/web/env.ts validates DATABASE_APP_URL in its server block at boot (A1 widening), owner DATABASE_URL NOT declared"
    requirement: "QUOTE-01"
    verification:
      - kind: unit
        ref: "grep -c 'DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL' apps/web/env.ts == 1; no owner 'DATABASE_URL:' key; pnpm --filter @imbau/web typecheck exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "End-to-end anonymous quote request served over HTTP on staging web (mount + validated app pool boot together against live Postgres/RLS)"
    verification: []
    human_judgment: true
    rationale: "Requires the fase-6 web UI + staging deploy (nginx /api/trpc/quotes location from plan 05-05) to exercise the live anonymous round-trip; not provable by unit typecheck/lint in the worktree."
  - id: D4
    description: "A1 Key Decision (D-06) registered in PROJECT.md, closing the A1-vs-A2 note from the v1.2 roadmap"
    verification:
      - kind: unit
        ref: "grep -c 'A1 — apps/web' .planning/PROJECT.md == 1; Key Decisions data rows increased 9 → 10"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-03
status: complete
---

# Phase 5 Plan 04: apps/web tRPC mount + DATABASE_APP_URL (A1) Summary

**apps/web now serves appRouter (incl. quotesRouter) at /api/trpc/[trpc] as a byte-mirror of the panel and validates DATABASE_APP_URL at boot — the public web surface can serve the anonymous quote procedures server-side, holding the app pool ONLY through withTenant inside packages/api (T-03-09 fence).**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T21:16:38Z
- **Completed:** 2026-07-03T21:28:00Z
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Created `apps/web/app/api/trpc/[trpc]/route.ts` — byte-mirror of the panel handler (fetchRequestHandler → appRouter, endpoint `/api/trpc`, GET+POST), adapted only in its header comment to document the anonymous quote path (QUOTE-01/D-06-A1).
- Widened `apps/web/env.ts` to validate `DATABASE_APP_URL` in the server block and rewrote the anon-only header comment to document the A1 posture and the T-03-09 grep-fence; owner `DATABASE_URL` deliberately NOT declared.
- Registered the A1 Key Decision (D-06) in `.planning/PROJECT.md`, closing the A1-vs-A2 sub-decision left open by the v1.2 roadmap.
- Grep-fence holds: no `@imbau/db` import anywhere under `apps/web/` — data access stays behind `withTenant`/`withAnon` inside `packages/api`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Surface DATABASE_APP_URL in apps/web/env.ts + rewrite comment** - `6205ec3` (feat)
2. **Task 2: Mount the tRPC route handler in apps/web** - `6b3af30` (feat, includes Rule 3 dependency fix)
3. **Task 3: Register the A1 Key Decision in PROJECT.md** - `2f1d17c` (docs)

## Files Created/Modified
- `apps/web/app/api/trpc/[trpc]/route.ts` - NEW: tRPC fetch route handler mounting appRouter under /api/trpc/* (GET+POST), anonymous-quote-path header comment.
- `apps/web/env.ts` - Added `DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL` to the server block; rewrote the header comment to document the A1 widening + T-03-09 fence.
- `apps/web/package.json` - Added `@trpc/server@11.17.0` direct dependency (needed for the `@trpc/server/adapters/fetch` import to resolve).
- `pnpm-lock.yaml` - Workspace link for the new web `@trpc/server` dependency (no download — already in the store via panel/api).
- `.planning/PROJECT.md` - Appended the A1 Key Decision row and updated the "Last updated" footer.

## Decisions Made
- A1 (D-06) registered as the resolved Key Decision (see frontmatter). No implementation choices beyond following the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@trpc/server` as a direct dependency of `@imbau/web`**
- **Found during:** Task 2 (Mount the tRPC route handler)
- **Issue:** The byte-mirror route handler imports `@trpc/server/adapters/fetch`, but `@imbau/web` did not declare `@trpc/server` directly. Typecheck failed with `TS2307: Cannot find module '@trpc/server/adapters/fetch'` and lint reported `no-unsafe-return`/`no-unsafe-call` on the unresolved `fetchRequestHandler`. The plan asserted the mount needed no dependency change; in practice the adapter import requires the direct dep exactly as the panel declares it.
- **Fix:** Added `"@trpc/server": "11.17.0"` to `apps/web/package.json` (same pinned version panel and api use) and ran `pnpm install`. This is NOT a new/unknown package install — `@trpc/server@11.17.0` was already in the lockfile/store via panel and api, so `pnpm install` reported `downloaded 0` and only added the workspace link. The lockfile diff is scoped to the single web `@trpc/server` entry.
- **Files modified:** apps/web/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @imbau/web typecheck` exit 0, `pnpm --filter @imbau/web lint` exit 0, full web gate `pnpm turbo run lint typecheck test --filter=@imbau/web` 9/9 pass.
- **Committed in:** `6b3af30` (part of the Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The dependency addition was required for the mount to compile and lint; it mirrors the panel's existing declaration and pulled nothing new from the registry. No scope creep — the version is pinned to the monorepo-wide `11.17.0`.

## Issues Encountered
None beyond the Rule 3 deviation above.

## User Setup Required
None - no external service configuration required. `DATABASE_APP_URL` is already provisioned in the web container via `deploy/compose.staging.yml` (`env_file: [.env]`) — no new secret, no infra change.

## Next Phase Readiness
- The anonymous quote path is HTTP-reachable on the web surface (mount + validated app-pool env), completing the QUOTE-01 delivery chain from 05-01.
- Plan 05-05 adds the nginx edge rate-limit on `/api/trpc/quotes` (QUOTE-03) — the mount's endpoint prefix `/api/trpc` matches that location.
- Live end-to-end verification of the anonymous round-trip is deferred to the fase-6 web UI on staging (coverage D3, human judgment).

## Self-Check: PASSED

- `apps/web/app/api/trpc/[trpc]/route.ts` — FOUND
- `05-04-SUMMARY.md` — FOUND
- Commits `6205ec3`, `6b3af30`, `2f1d17c` — all FOUND in git log
- Working tree clean after commits

---
*Phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit*
*Completed: 2026-07-03*
