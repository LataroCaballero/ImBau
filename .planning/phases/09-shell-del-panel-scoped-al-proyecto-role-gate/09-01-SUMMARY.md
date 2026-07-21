---
phase: 09-shell-del-panel-scoped-al-proyecto-role-gate
plan: 01
subsystem: api
tags: [trpc, rls, postgres, authorization, multi-tenant, drizzle, vitest, better-auth]

# Dependency graph
requires:
  - phase: 03-auth-multitenancy
    provides: requireRole middleware, withTenant/withAnon RLS seam, member table + policies, projects_tenant/projects_anon_published policies, createCaller test harness
  - phase: 08-deuda-v1.2
    provides: v1.2 merged to main + staging re-verified (green baseline)
provides:
  - "projects.getForOrg — single active-org project resolver (z.uuid input, RLS-scoped, null on cross-org/non-existent)"
  - "projects.updateSettings — the reusable panel write mold: requireRole(owner,developer) over withTenant + .returning() 0-row NOT_FOUND guard"
  - "org.activeMemberRole — RLS-scoped caller role (owner|developer|viewer|null) for D-08 UI gating"
  - "mintMemberInOrg(org, role) — generalized member-minting test fixture (owner/developer/viewer)"
  - "projects-role-gate.test.ts — the cross-role authorization matrix (PANEL-02 proof)"
affects: [10-d1-grilla-unidades, 11-d2-bandeja-leads, 12-editor-hotspots, 09-02-shell-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Panel write mold: requireRole(...roles).input(z.object({ id: z.uuid(), ... })).mutation(withTenant(...).update(...).returning(...)) + if rows.length===0 throw NOT_FOUND"
    - "No-enumeration: cross-org and non-existent ids return an identical NOT_FOUND (never 403-vs-404 leakage)"
    - "Single-project resolver returns rows[0] ?? null so the RSC translates null -> notFound (D-07)"
    - "Cross-role test matrix asserts exclusively through createCaller -> app_authenticated/anon; owner pool seeds only"

key-files:
  created:
    - packages/api/tests/projects-role-gate.test.ts
  modified:
    - packages/api/src/trpc/routers/projects.ts
    - packages/api/src/trpc/routers/org.ts
    - packages/api/tests/fixtures.ts

key-decisions:
  - "Canary mutation = projects.updateSettings toggling estado borrador<->publicado (Claude's Discretion under D-05): real, stays in production, observable end-to-end via anon listPublished"
  - "updateSettings estado enum excludes archivado — out of the minimal toggle scope"
  - "activeMemberRole placed in the org router (RESEARCH Open Q #2 convention), not a new router — no _app.ts change"

patterns-established:
  - "requireRole + withTenant write gate is the verbatim mold D1 (phase 10), D2 (phase 11), and hotspots (phase 12) clone"
  - "0-row UPDATE under RLS is guarded by .returning() + NOT_FOUND — never a silent no-op success (RESEARCH Pitfall 1)"

requirements-completed: [PANEL-01, PANEL-02]

coverage:
  - id: D1
    description: "projects.updateSettings rejects a viewer with FORBIDDEN server-side (not UI hiding)"
    requirement: PANEL-02
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#viewer caller is rejected with FORBIDDEN (before any UPDATE runs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "owner/developer callers resolve updateSettings and toggle estado; the row is actually mutated"
    requirement: PANEL-02
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#owner caller resolves and toggles estado to publicado"
        status: pass
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#developer caller resolves and toggles estado"
        status: pass
    human_judgment: false
  - id: D3
    description: "cross-org owner and non-existent id both return an identical NOT_FOUND (no-enumeration, RLS invisibility)"
    requirement: PANEL-01
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#other-org owner is rejected with NOT_FOUND (RLS invisibility, no silent 0-row success)"
        status: pass
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#non-existent id under the active org yields NOT_FOUND (identical to cross-org — no enumeration)"
        status: pass
    human_judgment: false
  - id: D4
    description: "projects.getForOrg returns the active-org row for a valid id and null for cross-org/non-existent"
    requirement: PANEL-01
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#projects.getForOrg single-project resolver (SC-1 / SC-2 / D-07)"
        status: pass
    human_judgment: false
  - id: D5
    description: "toggling estado to publicado exposes the project through anon listPublished; borrador hides it (cross-surface canary)"
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#publicado exposes projA to anon; toggling back to borrador hides it again"
        status: pass
    human_judgment: false
  - id: D6
    description: "org.activeMemberRole returns the RLS-scoped caller role for D-08 UI gating"
    verification:
      - kind: integration
        ref: "packages/api/tests/projects-role-gate.test.ts#resolves owner for an owner caller and viewer for a viewer caller"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-21
status: complete
---

# Phase 9 Plan 01: Panel Write Mold + Role Gate Summary

**The reusable `requireRole("owner","developer") + withTenant` panel write mold, proven server-side against real Postgres via a cross-role Vitest matrix (owner/developer ✓, viewer FORBIDDEN, cross-org/non-existent NOT_FOUND), plus the `getForOrg` resolver and `org.activeMemberRole` for D-08 gating.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-21T20:10:57Z
- **Completed:** 2026-07-21T20:14:32Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Established the panel write authorization mold: `projects.updateSettings` guarded by `requireRole("owner","developer")` over `withTenant`, with a `.returning()` + 0-row `NOT_FOUND` guard that turns silent cross-tenant no-ops into an explicit, no-enumeration error.
- Added `projects.getForOrg` (single active-org resolver, `null` on cross-org/non-existent → RSC `notFound`) and `org.activeMemberRole` (RLS-scoped caller role for D-08 UI gating).
- Proved PANEL-02 with `projects-role-gate.test.ts`: the full owner/developer/viewer/other-org matrix plus getForOrg-null, no-enumeration NOT_FOUND, the cross-surface `estado`→`listPublished` effect, and activeMemberRole — asserted exclusively through `createCaller` → `app_authenticated`/`anon` (owner pool seeds only). 41/41 tests green.
- Generalized the viewer-only `mintViewerInOrg` into an exported, role-parameterized `mintMemberInOrg(org, role)` fixture reused across the matrix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the failing cross-role matrix + generalize the member fixture (RED)** - `4e93186` (test)
2. **Task 2: Implement getForOrg + the updateSettings canary mold (GREEN)** - `b520400` (feat)
3. **Task 3: Implement org.activeMemberRole for D-08 UI gating (full GREEN)** - `439f148` (feat)

_TDD flow: Task 1 authored the RED matrix; Task 2 turned the write/read cases green; Task 3 completed the matrix (activeMemberRole)._

## Files Created/Modified
- `packages/api/tests/projects-role-gate.test.ts` - The cross-role authorization matrix (PANEL-02 proof) against real `_test` Postgres.
- `packages/api/src/trpc/routers/projects.ts` - Added `getForOrg` resolver and the `updateSettings` canary write mold.
- `packages/api/src/trpc/routers/org.ts` - Added `activeMemberRole` protected query (RLS-scoped role lookup).
- `packages/api/tests/fixtures.ts` - Generalized `mintMemberInOrg(org, role)` (owner/developer/viewer), importing `createCaller` for the owner-invite step.

## Decisions Made
- **Canary = estado toggle:** chose `updateSettings` toggling `estado` borrador↔publicado as the real, production-surviving canary (D-05) because it is observable end-to-end through the anon `listPublished` policy — a mutation that proves the mold without introducing throwaway surface.
- **Enum excludes `archivado`:** the toggle enum is `["borrador","publicado"]` only — the minimal, observable set for this phase.
- **`activeMemberRole` lives in the `org` router:** per RESEARCH Open Q #2 convention, avoiding a new router and keeping `_app.ts` untouched.

## Deviations from Plan

None - plan executed exactly as written. The three tasks landed in order; typecheck at the Task 2 boundary reported only the not-yet-implemented `activeMemberRole` reference (an intended TDD ordering artifact authored by Task 1's RED test), which Task 3 resolved. Full typecheck, lint, and the 41-test suite are green.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `getForOrg` is ready for Plan 02 (the `proyectos/[id]` shell) to consume as the single-project loader; `activeMemberRole` is ready for the RSC tab pages' D-08 write-affordance gating.
- The `requireRole + withTenant + .returning() NOT_FOUND` mold is established and green as the verbatim template for D1 (phase 10), D2 (phase 11), and hotspots (phase 12).
- No `_app.ts` change was needed (procedures added to already-registered `projects`/`org` routers).

---
*Phase: 09-shell-del-panel-scoped-al-proyecto-role-gate*
*Completed: 2026-07-21*

## Self-Check: PASSED

- All 4 files (1 created, 3 modified) present on disk.
- All 3 task commits (`4e93186`, `b520400`, `439f148`) exist in git history.
- Gates: `pnpm --filter @imbau/api typecheck` clean, `lint` clean, `test` 41/41 passed vs real `_test` Postgres.
- No `_app.ts` diff.
