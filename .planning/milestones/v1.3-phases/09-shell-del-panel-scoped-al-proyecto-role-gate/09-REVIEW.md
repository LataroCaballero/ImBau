---
phase: 09-shell-del-panel-scoped-al-proyecto-role-gate
reviewed: 2026-07-21T20:30:18Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - apps/panel/app/(dashboard)/page.tsx
  - apps/panel/app/proyectos/[id]/hotspots/page.tsx
  - apps/panel/app/proyectos/[id]/layout.tsx
  - apps/panel/app/proyectos/[id]/leads/page.tsx
  - apps/panel/app/proyectos/[id]/not-found.tsx
  - apps/panel/app/proyectos/[id]/page.tsx
  - apps/panel/app/proyectos/[id]/tab-bar.tsx
  - apps/panel/app/proyectos/[id]/unidades/page.tsx
  - apps/panel/lib/project-caller.ts
  - packages/api/src/trpc/routers/org.ts
  - packages/api/src/trpc/routers/projects.ts
  - packages/api/tests/fixtures.ts
  - packages/api/tests/projects-role-gate.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-21T20:30:18Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This phase delivers the security-load-bearing panel write mold (`requireRole` over `withTenant`, `.returning()` + 0-row `NOT_FOUND` guard) and the RSC panel shell with `z.uuid()`-guarded, RLS-scoped project resolution. The **core security invariants are sound and verified**:

- **Authorization is server-side.** `updateSettings` is gated by `requireRole("owner","developer")` which reads `member.role` under `withTenant` (unprivileged `app_authenticated` role, `member_tenant` RLS policy) BEFORE the UPDATE runs. The UI `canWrite` is correctly documented as cosmetic defense-in-depth only.
- **Tenant isolation is RLS-enforced, not app-layer.** No resolver carries a `where organization_id = …` as its barrier; `withTenant` sets a parameterized transaction-scoped GUC and the `projects_tenant`/`member_tenant` policies do the filtering. The tenant is derived solely from `session.session.activeOrganizationId` — a client `orgId` is never read.
- **No-enumeration holds at the API layer.** Cross-org and non-existent ids are indistinguishable: `getForOrg` → `null`, `updateSettings` → `NOT_FOUND` via the 0-row `.returning()` guard (silent 0-row UPDATE correctly converted). The role gate runs before the id is used, so a viewer cannot enumerate either.
- **Next 16 async params handled** (`await params`) and `z.uuid()` validates before Postgres (avoids 22P02 → 500).
- **Injection-safe.** `set_config(..., ${orgId}, true)` binds `orgId` as a parameter; no string interpolation into SQL.

The defects found are in the **RSC not-found boundary wiring** (the intended es-AR no-enumeration 404 does not actually render for the primary path) and minor error-handling/typing inconsistencies. No security regression: the no-enumeration invariant itself is preserved even through the boundary bug, because all failure reasons collapse to the same fallback 404.

## Warnings

### WR-01: Co-located `not-found.tsx` cannot catch the layout's `notFound()` — deep-linked invalid/cross-org projects render Next's default English 404, not the custom es-AR page

**File:** `apps/panel/app/proyectos/[id]/not-found.tsx:1-16`, `apps/panel/app/proyectos/[id]/layout.tsx:28-36`

**Issue:** In the Next.js App Router component hierarchy, `not-found.tsx` is nested *inside* the `layout.tsx` of the same segment (`Layout > Template > ErrorBoundary > Suspense > NotFoundBoundary > Page`). When `[id]/layout.tsx` throws `notFound()` (the primary guard for a malformed, cross-org, or non-existent id — layout.tsx:28-36), the co-located `[id]/not-found.tsx` boundary is *below* the throw point and never mounts. The `notFound()` bubbles to the nearest **parent** not-found boundary. There is no `app/not-found.tsx` and no `app/proyectos/not-found.tsx` (verified: only `app/proyectos/[id]/not-found.tsx` exists), so it falls through to Next's built-in default 404 ("This page could not be found") in English.

The custom es-AR copy is only reachable via a **page-level** `notFound()` (unidades/leads/hotspots) — but those page guards run the *identical* `z.uuid()` + `resolveProject` logic the layout already ran (a `cache()` hit), so the layout always throws first for every failing case. The page-level `notFound()` is therefore effectively unreachable, making `[id]/not-found.tsx` dead for its stated purpose. The file's own header comment ("Rendered whenever a layout or tab page calls `notFound()`") is inaccurate for the layout case, which is the one that matters.

Security impact: none — all reasons still collapse to one uniform 404, so no-enumeration holds. This is a correctness/UX/i18n defect (CLAUDE.md requires es-AR UI) plus dead code.

**Fix:** Place the boundary at the parent segment so it wraps the throwing layout. Move/duplicate the es-AR copy to `app/proyectos/not-found.tsx`:

```tsx
// apps/panel/app/proyectos/not-found.tsx  (parent of the [id] segment)
import Link from "next/link";
export default function ProjectNotFound(): React.JSX.Element {
  return (
    <main>
      <h1>No encontramos ese proyecto.</h1>
      <p>Puede que no exista o que no tengas acceso.</p>
      <Link href="/">Volver a tus proyectos</Link>
    </main>
  );
}
```

Then verify by deep-linking a cross-org UUID and a random UUID: both must render this page (not Next's default). Once fixed, the redundant page-level guards can stay as cheap defense-in-depth or be removed.

### WR-02: `org.activeMemberRole` call in the tab pages is outside the auth-redirect seam used by `resolveProject` — an auth failure surfaces as a 500 instead of `/login`

**File:** `apps/panel/app/proyectos/[id]/unidades/page.tsx:36-37`, `leads/page.tsx:29-30`, `hotspots/page.tsx:29-30`

**Issue:** `resolveProject` (project-caller.ts:25-35) deliberately catches `TRPCError` with code `UNAUTHORIZED`/`FORBIDDEN` and redirects to `/login`, re-throwing anything else. The subsequent `caller.org.activeMemberRole()` call in each tab page builds a *separate* `createCaller` and is not wrapped in that seam. If that `protectedProcedure` call rejects with `UNAUTHORIZED`/`FORBIDDEN` (e.g., session invalidated between the two calls), it propagates uncaught to Next's error boundary as a 500 rather than the intended login redirect — inconsistent handling of the same failure class. Low probability in practice (the layout's `resolveProject` gates first on the same session), but it is an inconsistency in a mold that phases 10–12 will clone verbatim, so the divergence will propagate.

**Fix:** Route the role read through the same narrowed-catch seam, e.g. add a `cache()`-wrapped `resolveActiveRole()` in `project-caller.ts` mirroring `resolveProject`'s try/catch, and call that from the tab pages instead of a bare `createCaller().org.activeMemberRole()`. This also deduplicates the extra `createCaller`/query per tab.

## Info

### IN-01: Unsafe `as` assertion over a `text` column in `activeMemberRole`

**File:** `packages/api/src/trpc/routers/org.ts:86-91`

**Issue:** `(rows[0]?.role ?? null) as "owner" | "developer" | "viewer" | null` asserts a union over `member.role`, which is a `text` column with DB default `"member"` (auth-schema.ts:132) and could in principle hold Better Auth's built-in `"admin"`/`"member"` values. The assertion is an unjustified type-lie under CLAUDE.md's strict-typing rule. Functionally safe today (downstream `canWrite = role === "owner" || role === "developer"` defaults to `false` for any unexpected value, and `requireRole` similarly rejects), but the type does not reflect reality.

**Fix:** Narrow at runtime instead of asserting: `const role = rows[0]?.role; return role === "owner" || role === "developer" || role === "viewer" ? role : null;` — or validate with `z.enum(["owner","developer","viewer"]).nullable().catch(null)`.

### IN-02: `ProjectRow` interface in the dashboard duplicates the inferred tRPC row type (drift risk)

**File:** `apps/panel/app/(dashboard)/page.tsx:19-24`

**Issue:** A hand-written `ProjectRow` interface shadows the type tRPC already infers for `listForOrg()`. If the `projects` schema gains/renames a rendered column, this local interface silently drifts from the source of truth.

**Fix:** Drop the interface and let inference drive: `const projects = await caller.projects.listForOrg();` (type flows from the router). If an explicit alias is wanted, derive it from `AppRouter` outputs rather than re-declaring fields.

### IN-03: Fragile set-cookie splitting in test fixtures

**File:** `packages/api/tests/fixtures.ts:29-40`

**Issue:** `cookieHeaderFrom` splits a combined `set-cookie` value with `/,(?=[^;]+?=)/`. The lookahead avoids splitting inside `Expires=Wed, 21 Oct …` dates (no `=` before the next `;`), so it works for the current Better Auth cookies, but comma-joined `Set-Cookie` is inherently ambiguous and this heuristic will break if a future cookie attribute contains a comma followed by `key=value`. Test-only; affects fixture reliability, not production. Acceptable as-is, but worth a note if fixtures start flaking.

**Fix (optional):** Read raw set-cookie entries via `headers.getSetCookie()` (undici) when available instead of splitting the joined string.

---

_Reviewed: 2026-07-21T20:30:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
