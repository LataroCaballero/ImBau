---
phase: 09-shell-del-panel-scoped-al-proyecto-role-gate
plan: 02
subsystem: panel
tags: [panel, app-router, rsc, rls, role-gate, next16]
status: complete
requires:
  - "09-01: projects.getForOrg + org.activeMemberRole tRPC procedures"
provides:
  - "proyectos/[id] App Router shell (layout + 3 tabs + index redirect)"
  - "resolveProject cache()-wrapped panel-boundary resolver"
  - "D-08 UI role-gate seam (canWrite) on top of the Plan 01 server gate"
affects:
  - "phase 10 (D1 grilla): replaces the unidades placeholder body"
  - "phase 11 (D2 leads): replaces the leads placeholder body"
  - "phase 12 (hotspots): replaces the hotspots placeholder body"
tech-stack:
  added: []
  patterns:
    - "React cache() at the panel boundary for per-request getForOrg dedup (App Router cannot prop-drill layout→page)"
    - "Canonical RSC order: await params → z.uuid() guard → resolveProject → notFound() (no-enumeration)"
    - "Next 16 async params: params: Promise<{ id: string }> + await params in every layout/page"
key-files:
  created:
    - apps/panel/lib/project-caller.ts
    - apps/panel/app/proyectos/[id]/layout.tsx
    - apps/panel/app/proyectos/[id]/not-found.tsx
    - apps/panel/app/proyectos/[id]/tab-bar.tsx
    - apps/panel/app/proyectos/[id]/page.tsx
    - apps/panel/app/proyectos/[id]/unidades/page.tsx
    - apps/panel/app/proyectos/[id]/leads/page.tsx
    - apps/panel/app/proyectos/[id]/hotspots/page.tsx
  modified:
    - apps/panel/app/(dashboard)/page.tsx
decisions:
  - "tab-bar.tsx pulled forward from Task 2 into the Task 1 commit: layout.tsx imports TabBar, so Task 1 typecheck could not pass without it (deviation Rule 3 — blocking dependency)"
metrics:
  duration: 3min
  completed: 2026-07-21
  tasks: 3
  files: 9
---

# Phase 9 Plan 02: Shell del panel scoped al proyecto + role gate Summary

Mounted the `proyectos/[id]` App Router shell: a shared layout that resolves the active-org project once via a `cache()`-wrapped `resolveProject` under RLS, an index redirect to `/unidades`, three real RSC tab pages (unidades/leads/hotspots) rendering es-AR voseo placeholders with a role-gated write-affordance seam, a `usePathname` tab-bar island, and the `/` selector wired to link each project into its shell.

## What was built

- **`lib/project-caller.ts`** — `resolveProject = cache(async (id) => …)` builds `createCaller({ headers: await headers() })`, calls `projects.getForOrg({ id })` (null under RLS = cross-org OR non-existent, indistinguishable), and reuses the narrow catch from `(dashboard)/page.tsx` verbatim (only `TRPCError` `UNAUTHORIZED`/`FORBIDDEN` → `redirect("/login")`; all else re-thrown). `cache()` lives at the panel boundary because `@imbau/api` has no `react` dep.
- **`proyectos/[id]/layout.tsx`** — async RSC, `params: Promise<{ id: string }>`, `await params`, `z.uuid()` guard → `notFound()` before any query (avoids Postgres 22P02→500), then `resolveProject` → `notFound()` on null (D-07). Renders a breadcrumb, `<TabBar>`, and `{children}`.
- **`proyectos/[id]/not-found.tsx`** — es-AR voseo 404 boundary ("No encontramos ese proyecto.").
- **`proyectos/[id]/tab-bar.tsx`** — `"use client"` island, `usePathname`, three tabs with `aria-current="page"` on the active one; navigation only.
- **`proyectos/[id]/page.tsx`** — index redirect to `/proyectos/[id]/unidades` (D-02), `Promise<never>`.
- **`unidades/page.tsx`, `leads/page.tsx`, `hotspots/page.tsx`** — canonical tab + two sibling clones. Same spine (await params → z.uuid guard → resolveProject cache() hit → notFound), `canWrite` from `org.activeMemberRole`, es-AR placeholder copy, write-affordance gated on `canWrite` (cosmetic D-08 seam only — no functional write UI).
- **`(dashboard)/page.tsx`** — imported `next/link`; each project name is now a `Link` to `/proyectos/[id]/unidades`. Miembros/InviteForm block preserved verbatim (D-03, zero loss).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking dependency] tab-bar.tsx created in Task 1 instead of Task 2**
- **Found during:** Task 1
- **Issue:** `layout.tsx` (Task 1) imports `TabBar` from `tab-bar.tsx`, which the plan assigned to Task 2. Task 1's acceptance criteria require `pnpm --filter @imbau/panel typecheck` to pass, but the import of a non-existent module would fail typecheck.
- **Fix:** Created `tab-bar.tsx` (exactly as specified in Task 2) as part of the Task 1 commit to unblock the layout typecheck. Task 2 then created only the index redirect and the unidades tab.
- **Files modified:** apps/panel/app/proyectos/[id]/tab-bar.tsx
- **Commit:** e373864
- **Impact:** None on the final artifact set — all planned files exist with the planned content; only the commit boundary shifted (tab-bar landed one commit earlier than the plan's task table implied).

## Threat mitigations applied

- **T-09-02 / T-09-03 (BOLA + enumeration):** every layout/page resolves via `getForOrg` under RLS; null → `notFound()`. Cross-org and non-existent are identical responses (D-07).
- **T-09-05 (22P02 DoS):** `z.uuid().safeParse(id)` guards before any query in the layout and all three tabs.
- **T-09-01 (viewer EoP):** write affordance rendered only when `canWrite` (owner/developer); documented as cosmetic defense-in-depth over the Plan 01 server `requireRole`. No functional write UI shipped.
- **T-09-08 (masked DB error):** narrow `UNAUTHORIZED`/`FORBIDDEN`-only catch in `resolveProject`; all other errors re-thrown.

## Verification

- `pnpm --filter @imbau/panel typecheck` — PASS (exit 0)
- `pnpm --filter @imbau/panel lint` — PASS (exit 0)
- `pnpm --filter @imbau/panel build` — PASS (exit 0); route manifest shows `/proyectos/[id]`, `/proyectos/[id]/unidades`, `/proyectos/[id]/leads`, `/proyectos/[id]/hotspots` all as dynamic (ƒ) server-rendered routes.
- Structural grep checks (await params, z.uuid guard, two notFound sites, getForOrg, cache(, usePathname, aria-current, activeMemberRole, canWrite, próximamente, InviteForm/Miembros preserved, next/link) — all confirmed.
- Manual/UAT (deferred to `/gsd-verify-work 9`, no design system this phase): tab navigation active-indicator, cross-org deep-link 404, viewer sees no write affordance in a real viewport.

## Known Stubs

The three tab pages render es-AR voseo placeholders ("… — próximamente.") and a role-gated placeholder line instead of a functional write button. This is intentional and specified by the plan (D-04/D-08): each future phase replaces only a placeholder body (phase 10 = unidades grid, phase 11 = leads inbox, phase 12 = hotspots editor). The functional phase-10 write UI is explicitly out of scope for this shell phase.

## Self-Check: PASSED

- Files: all 9 key files FOUND on disk.
- Commits: e373864, 47bda88, 80d829b all present in git log.
