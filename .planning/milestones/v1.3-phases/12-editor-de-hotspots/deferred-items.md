# Phase 12 — Deferred / Out-of-Scope Items

Discovered during execution but NOT owned by phase-12 changes (scope boundary: only auto-fix issues
directly caused by the current task's changes).

## Pre-existing lint error in `packages/api/src/trpc/routers/leads.ts`

- **Discovered during:** Plan 12-01, Task 2 (`pnpm --filter @imbau/api lint`).
- **Error:** `183:50 error This assertion is unnecessary since it does not change the type of the expression (@typescript-eslint/no-unnecessary-type-assertion)`.
- **Origin:** Phase 11 (D2 — Bandeja de leads). The file is untouched by phase 12 and the error
  reproduces at the pre-phase-12 HEAD (`6cfa374`), so it predates this work.
- **Impact:** `pnpm --filter @imbau/api lint` is red repo-wide (would fail the CI `quality` gate).
  Auto-fixable with `eslint --fix`.
- **Action:** ✅ RESOLVED at phase close (2026-07-25, commit `c723164`) — removed the unnecessary
  `as LeadEstado` assertion (`prev.estado` is already typed from the select). Compile-time only, no
  behavior change. Repo-wide `pnpm lint` + `pnpm typecheck` now 9/9 green; CI `quality` gate unblocked.
