---
phase: 09-shell-del-panel-scoped-al-proyecto-role-gate
verified: 2026-07-21T17:35:00Z
status: human_needed
score: 14/14 must-haves verified (structural/automated)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "With `pnpm dev` up, log in as an owner/developer and open `/proyectos/[id]/unidades` in a real viewport"
    expected: "Three tabs (Unidades / Leads / Hotspots) render, the active tab shows an `aria-current=\"page\"` visual indicator, and the es-AR placeholder copy displays under the project heading"
    why_human: "Automated checks (build, typecheck, route manifest, grep for `aria-current`/`usePathname`) prove the code renders the tabs and wires the active-tab logic, but not that it paints correctly in a browser — visual rendering was explicitly deferred to `/gsd-verify-work 9` per both PLAN.md `<verification>` sections"
  - test: "Deep-link to another org's project id (or a random non-existent uuid) at `/proyectos/[id]/unidades` in a real viewport"
    expected: "The es-AR 404 boundary (\"No encontramos ese proyecto.\") renders identically for both the cross-org and non-existent cases — no 403/404 distinction, no stack trace, no 500"
    why_human: "Automated evidence proves both cases resolve to the same `null` → same `notFound()` call site in code (single code path, structurally guaranteed) and the API-level cross-org/non-existent NOT_FOUND parity is proven by the real-Postgres test matrix — but the actual browser-rendered 404 page was not eyeballed this session; deferred to `/gsd-verify-work 9` per PLAN 02"
  - test: "Log in as a viewer, navigate all three tabs in a real viewport"
    expected: "All three tabs are reachable read-only; the write-affordance placeholder paragraph (\"Acá vas a poder...\") is absent for the viewer role"
    why_human: "Automated evidence (code inspection of the `canWrite` ternary in all three tab pages, plus the server-side `requireRole` FORBIDDEN proof in the real-Postgres matrix) proves the mechanism is correct, but rendering in an actual browser session as a real viewer was not observed this session; deferred to `/gsd-verify-work 9` per PLAN 02"
---

# Phase 9: Shell del panel scoped al proyecto + role gate Verification Report

**Phase Goal:** El developer entra a la administración de un proyecto de su org y navega entre las tres áreas (unidades, leads, hotspots), con el gate de autorización por rol impuesto en el servidor. Es el prerrequisito estructural único sobre el que viven las tres superficies de escritura.

**Verified:** 2026-07-21T17:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC-1) Developer autenticado navega a `proyectos/[id]` y ve un layout con tabs scoped a su org activa | ✓ VERIFIED (structural) | `apps/panel/app/proyectos/[id]/layout.tsx` renders `<TabBar>`; `tab-bar.tsx` renders 3 `Link`s with `aria-current`; `pnpm --filter @imbau/panel build` shows `/proyectos/[id]/{unidades,leads,hotspots}` as dynamic (ƒ) routes. Visual paint not eyeballed — see human item 1. |
| 2 | (SC-2) Un usuario no puede abrir la administración de un proyecto de otra org — cross-org y no-existente rinden notFound uniforme (no-enumeración) | ✓ VERIFIED | `layout.tsx`: single `if (!project) notFound()` call site fed by `resolveProject`→`projects.getForOrg`, which returns `null` for BOTH cross-org and non-existent (RLS makes both invisible). API-level parity proven in real Postgres: `projects-role-gate.test.ts` "other-org owner is rejected with NOT_FOUND" + "non-existent id ... yields NOT_FOUND (identical to cross-org)", both green (41/41 suite). Browser-rendered 404 not eyeballed — see human item 2. |
| 3 | (SC-3) Toda mutación scoped al proyecto exige rol owner/developer; viewer recibe FORBIDDEN — probado por matriz cross-rol contra Postgres real | ✓ VERIFIED | `packages/api/src/trpc/routers/projects.ts`: `updateSettings: requireRole("owner","developer")...`. `projects-role-gate.test.ts` matrix asserts via `createCaller({headers})` → real `app_authenticated`/`anon` Postgres roles (owner✓/developer✓/viewer→FORBIDDEN/other-org→NOT_FOUND). Ran green this session: `pnpm --filter @imbau/api test` = 41/41. |
| 4 | (SC-4) `requireRole("owner","developer")` queda establecido como patrón reutilizable de escritura del panel | ✓ VERIFIED | `packages/api/src/trpc/middleware.ts` defines `requireRole`; `updateSettings` composes it over `withTenant`; router header-comments explicitly document this as the mold "D1/D2/hotspots clone verbatim." Only `withTenant`/`withAnon`/`schema` imported in `projects.ts`/`org.ts` — no elevated owner-pool import in any domain router (grep-confirmed). |
| 5 | `projects.updateSettings` rejects viewer with `FORBIDDEN`, proven by cross-role Vitest matrix (not UI hiding) | ✓ VERIFIED | Test `"viewer caller is rejected with FORBIDDEN (before any UPDATE runs)"` — asserted via `createCaller`, not UI. Green. |
| 6 | `projects.updateSettings` by owner/developer returns updated row with `estado` toggled | ✓ VERIFIED | Tests `"owner caller resolves and toggles estado"` / `"developer caller resolves..."` both green; code uses `.returning({id, estado})`. |
| 7 | Cross-org caller on `updateSettings` gets `NOT_FOUND`; RLS leaves row invisible, guarded 0-row UPDATE never silently succeeds | ✓ VERIFIED | Code: `.returning()` + `if (rows.length === 0) throw TRPCError({code:"NOT_FOUND"})`. Test green. |
| 8 | Non-existent id under active org yields `NOT_FOUND`, byte-identical to cross-org (no-enumeration) | ✓ VERIFIED | Both test cases assert `.rejects.toMatchObject({ code: "NOT_FOUND" })` — same code, same shape. |
| 9 | `projects.getForOrg` returns the active-org row for a valid id, `null` for cross-org/non-existent | ✓ VERIFIED | Code: `rows[0] ?? null`. 3 tests green (valid/cross-org/non-existent). |
| 10 | Toggling `estado` borrador→publicado changes anon visibility via `listPublished` (cross-surface) | ✓ VERIFIED | Test `"publicado exposes projA to anon; toggling back to borrador hides it again"` green — asserts `listPublished()` via anon caller (`new Headers()`). |
| 11 | `org.activeMemberRole` returns caller's role (owner\|developer\|viewer\|null) via `withTenant`/RLS | ✓ VERIFIED | `org.ts`: `activeMemberRole` clones the `requireRole` role lookup exactly, routes through `withTenant`. Test asserts owner→"owner", viewer→"viewer", green. |
| 12 | Malformed (non-uuid) id is rejected at the boundary via `z.uuid()` before any query (backstop) | ✓ VERIFIED | `projects.ts`: both `getForOrg` and `updateSettings` use `z.object({ id: z.uuid(), ... })`; `layout.tsx`/all 3 tab pages: `if (!z.uuid().safeParse(id).success) notFound()` before `resolveProject`. `zod@4.4.3` confirmed as the dependency (top-level `z.uuid()` is valid Zod 4 API). |
| 13 | Every layout/page under `proyectos/[id]` awaits `params` (Next 16 async params) | ✓ VERIFIED | `await params` present in `layout.tsx`, `page.tsx` (index redirect), `unidades/page.tsx`, `leads/page.tsx`, `hotspots/page.tsx` — all read and confirmed. |
| 14 | `/` remains the selector: each project links to `/proyectos/[id]/unidades`, owner-only `InviteForm` preserved | ✓ VERIFIED | `apps/panel/app/(dashboard)/page.tsx`: `<Link href={`/proyectos/${p.id}/unidades`}>`; `<InviteForm />` + "Miembros" heading still present, untouched. |

**Score:** 14/14 truths structurally/automatically verified. 0 behavior-unverified (no state-transition/cancellation invariants in this phase's scope — the write mold's authorization/tenant-isolation behavior IS a state-transition-adjacent concern and it WAS behaviorally proven, not just presence-checked, via the real-Postgres matrix). 3 items remain for human visual confirmation (see Human Verification Required).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/api/src/trpc/routers/projects.ts` | `getForOrg` + `updateSettings` write mold | ✓ VERIFIED | Both procedures present, correct shape, `.returning()` + NOT_FOUND guard, `z.uuid()` inputs |
| `packages/api/src/trpc/routers/org.ts` | `activeMemberRole` | ✓ VERIFIED | Present, `withTenant`-scoped, correct return type |
| `packages/api/tests/fixtures.ts` | `mintMemberInOrg(org, role)` | ✓ VERIFIED | Exported, role-parameterized, real invite→accept→setActive path |
| `packages/api/tests/projects-role-gate.test.ts` | Cross-role matrix | ✓ VERIFIED | All matrix cases present and green (41/41 suite) |
| `apps/panel/lib/project-caller.ts` | `resolveProject` (cache()-wrapped) | ✓ VERIFIED | `cache()` from `react`, calls `getForOrg`, narrow UNAUTHORIZED/FORBIDDEN catch |
| `apps/panel/app/proyectos/[id]/layout.tsx` | Resolution spine | ✓ VERIFIED | `await params`, `z.uuid()` guard, `resolveProject`, `notFound()`, `<TabBar>` |
| `apps/panel/app/proyectos/[id]/not-found.tsx` | Uniform es-AR 404 | ✓ VERIFIED | es-AR voseo copy present |
| `apps/panel/app/proyectos/[id]/page.tsx` | Index → unidades redirect | ✓ VERIFIED | `redirect(`/proyectos/${id}/unidades`)` |
| `apps/panel/app/proyectos/[id]/tab-bar.tsx` | Client nav island | ✓ VERIFIED | `"use client"`, `usePathname`, `aria-current` |
| `apps/panel/app/proyectos/[id]/unidades/page.tsx` | Canonical tab | ✓ VERIFIED | Full spine + `canWrite` gate |
| `apps/panel/app/proyectos/[id]/leads/page.tsx` | Sibling tab | ✓ VERIFIED | Same spine, distinct copy |
| `apps/panel/app/proyectos/[id]/hotspots/page.tsx` | Sibling tab | ✓ VERIFIED | Same spine, distinct copy |
| `apps/panel/app/(dashboard)/page.tsx` | Selector wiring | ✓ VERIFIED | `Link` to shell, `InviteForm` preserved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `projects.updateSettings` | `requireRole("owner","developer")` + `withTenant` | Middleware composition | ✓ WIRED | Code confirms exact composition; matches D1/D2/hotspots mold intent |
| `projects-role-gate.test.ts` | `createCaller({headers})` | tRPC caller, real Postgres roles | ✓ WIRED | Owner pool used only in `beforeAll`/`seedProject`; every `it(...)` asserts through `createCaller` |
| `apps/panel/app/proyectos/[id]/layout.tsx` + tab pages | `resolveProject` (`cache()`) | Shared per-request dedup | ✓ WIRED | Both layout and each tab page call `resolveProject(id)`; `cache()` wraps the async fn at the panel boundary |
| Tab pages (`unidades`/`leads`/`hotspots`) | `org.activeMemberRole` | `createCaller(...).org.activeMemberRole()` → `canWrite` | ✓ WIRED | All three pages call it and gate the write-affordance placeholder |
| `/` selector | `/proyectos/[id]/unidades` | `next/link` `Link href` | ✓ WIRED | Confirmed in `(dashboard)/page.tsx` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `projects.getForOrg` | `rows[0] ?? null` | `withTenant(...).select().from(projects).where(eq(id, input.id))` | Real Drizzle query against Postgres, RLS-scoped | ✓ FLOWING |
| `projects.updateSettings` | `rows[0]` (via `.returning()`) | `withTenant(...).update(projects).set({estado}).where(eq(id,...))` | Real mutation, `.returning()` proves row-level effect | ✓ FLOWING |
| `org.activeMemberRole` | `rows[0]?.role ?? null` | `withTenant(...).select({role}).from(member).where(eq(userId,...))` | Real Drizzle query, RLS-scoped | ✓ FLOWING |
| Panel tab pages `project.nombre` | `resolveProject(id)` | `caller.projects.getForOrg({id})` (real tRPC round-trip to the above) | Real, no static fallback | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cross-role authorization matrix (owner/developer/viewer/other-org) | `pnpm --filter @imbau/api test` | 41/41 passed, real `_test` Postgres | ✓ PASS |
| Panel type-safety consuming Plan 01 procedures | `pnpm --filter @imbau/panel typecheck` | exit 0 | ✓ PASS |
| Panel lint | `pnpm --filter @imbau/panel lint` | exit 0 | ✓ PASS |
| Panel build (whole `proyectos/[id]` RSC tree + islands compile) | `pnpm --filter @imbau/panel build` | exit 0; route manifest confirms `/proyectos/[id]`, `/proyectos/[id]/{unidades,leads,hotspots}` as dynamic (ƒ) routes | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` declared by this phase's PLAN/SUMMARY, and this is not a migration/CLI/tooling phase. Skipped.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| PANEL-01 | 09-01, 09-02 | Developer navega a `proyectos/[id]` y ve un layout con tabs scoped al proyecto de su org | ✓ SATISFIED | Truths 1, 2, 9, 12, 13, 14 above |
| PANEL-02 | 09-01 | Toda mutación del panel exige rol owner/developer — verificado por matriz cross-rol | ✓ SATISFIED | Truths 3, 4, 5, 6, 7, 8, 11 above; 41/41 real-Postgres tests green |

No orphaned requirements — `REQUIREMENTS.md` maps only PANEL-01/PANEL-02 to Phase 9, both claimed by the plans' `requirements:` frontmatter and both marked `[x]` complete in REQUIREMENTS.md.

### Anti-Patterns Found

None. Scanned all 13 files modified/created by this phase (both API routers, both test files, and all 9 panel files) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches. The `próximamente` placeholder copy in the three tab pages is an intentional, plan-specified (D-04) es-AR "coming soon" placeholder for functionality explicitly deferred to phases 10/11/12 — not an unplanned stub; the write-affordance seam is documented as cosmetic-only (D-08) with the server-side `requireRole` as the sole authority, matching the plan's `<prohibitions>`.

### Human Verification Required

### 1. Tab bar renders with active indicator in a real viewport

**Test:** With `pnpm dev` up, log in as an owner/developer and open `/proyectos/[id]/unidades`.
**Expected:** Three tabs (Unidades / Leads / Hotspots) render; the active tab shows a visible indicator; es-AR placeholder copy displays.
**Why human:** Code/build/route-manifest evidence proves the mechanism is wired correctly, but visual rendering in a browser was not observed this session — both PLAN.md files explicitly deferred this to `/gsd-verify-work 9`.

### 2. Cross-org / non-existent deep-link renders a uniform 404 in the browser

**Test:** Deep-link to another org's project id, and separately to a random non-existent uuid, at `/proyectos/[id]/unidades`.
**Expected:** Identical es-AR 404 page for both — no distinguishing signal, no 500.
**Why human:** The code guarantees a single `notFound()` call site for both cases (structurally proven) and the API-level NOT_FOUND parity is proven by the real-Postgres test matrix, but the actual rendered page was not eyeballed this session — deferred to `/gsd-verify-work 9` per PLAN 02.

### 3. Viewer sees no write affordance in a real viewport

**Test:** Log in as a viewer and navigate all three tabs.
**Expected:** All tabs reachable read-only; no "Acá vas a poder..." write-affordance line appears.
**Why human:** The `canWrite` conditional and the server-side `requireRole` FORBIDDEN proof are both verified in code/tests, but rendering as an actual viewer session was not observed this session — deferred to `/gsd-verify-work 9` per PLAN 02.

### Gaps Summary

No gaps. All must-haves from both plans' frontmatter and all four ROADMAP success criteria are structurally and/or automatically verified against the real codebase (code inspection matches every plan-described shape exactly; `pnpm --filter @imbau/api test` = 41/41 against real Postgres; `pnpm --filter @imbau/panel typecheck|lint|build` all exit 0 with the expected dynamic route manifest). The only open item is visual/browser confirmation of three UI behaviors that both PLAN.md files explicitly deferred to the end-of-phase human UAT step (`/gsd-verify-work 9`) rather than attempting to verify blind — this is a deliberate, plan-documented deferral, not a missed gap.

---

_Verified: 2026-07-21T17:35:00Z_
_Verifier: Claude (gsd-verifier)_
