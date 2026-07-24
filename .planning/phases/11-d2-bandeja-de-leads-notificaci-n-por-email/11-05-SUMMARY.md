---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
plan: 05
subsystem: ui
tags: [next, react, trpc, tanstack-query, kanban, drag-and-drop, panel, leads]

# Dependency graph
requires:
  - phase: 11-03
    provides: "leads router (listForProject / updateEstado / addNote / create) + projects.updateSettings extended with leadsNotifyEmail"
  - phase: 11-01
    provides: "leads.desenlace + projects.leads_notify_email schema columns"
  - phase: 09
    provides: "leads/page.tsx server spine (z.uuid guard, resolveProject notFound, resolveActiveRole/canWrite) + panel tRPC island wiring"
  - phase: 10
    provides: "settled panel tokens.css + units-grid island shape + inline role=status/alert feedback pattern"
provides:
  - "4-stage kanban leads bandeja (nuevo→contactado→negociacion→cerrado) with drag + drawer-select transitions"
  - "lead drawer: Actividad timeline (chronological by ts, autor) + Agregar nota form"
  - "desenlace prompt (Ganado/Perdido) gating every move into cerrado"
  - "alta-manual lead form (leads.create → queued idempotent email)"
  - "notify-email settings field editing projects.leadsNotifyEmail"
affects: [phase-2-explorador-ficha, phase-6-metricas-alertas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TanStack Query optimistic transition: snapshot → setQueryData move → mutate → revert-on-error"
    - "Native HTML5 drag-and-drop kanban + a11y-parity estado <select> writing the same mutation"
    - "Router-derived client types via inferRouterOutputs<AppRouter> (no drift from the server contract)"

key-files:
  created:
    - apps/panel/app/proyectos/[id]/leads/leads-board.tsx
    - apps/panel/app/proyectos/[id]/leads/lead-card.tsx
    - apps/panel/app/proyectos/[id]/leads/lead-drawer.tsx
    - apps/panel/app/proyectos/[id]/leads/desenlace-prompt.tsx
    - apps/panel/app/proyectos/[id]/leads/alta-lead-form.tsx
    - apps/panel/app/proyectos/[id]/leads/notify-email-field.tsx
  modified:
    - apps/panel/app/proyectos/[id]/leads/page.tsx

key-decisions:
  - "Client Lead types derived from inferRouterOutputs<AppRouter> so the board never drifts from the leads router output"
  - "desenlace typed as string|null (the router's nullable text column), compared against ganado/perdido literals"
  - "Drag INTO cerrado defers the optimistic move until the desenlace prompt confirms; cancel = no mutation, card stays"
  - "notify-email seeded from the already-resolved project row (getForOrg selects all columns) — no extra query"

patterns-established:
  - "Optimistic pipeline transition with snapshot rollback shared by drag-drop and the drawer estado select"
  - "Timeline entry rendering distinguishes transitions (estadoPrev/estadoNuevo), creation phrases, and free notes"

requirements-completed: [LEADS-01, LEADS-02, LEADS-03, LEADS-04]

coverage:
  - id: D1
    description: "4-stage kanban board reading leads.listForProject: columns in stage order, count badges (Sin leads / N), stage+desenlace dots, board loading/empty/error + column-empty states; Negociación always accented"
    requirement: LEADS-01
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/panel typecheck && lint && build"
        status: pass
    human_judgment: true
    rationale: "Visual anchor + populated-board distribution + backstop long-text/overflow rows need a held-out visual UI-state check at phase verify time (UI-SPEC backstop)"
  - id: D2
    description: "Pipeline transitions via drag-drop AND the drawer estado <select> (a11y parity), both calling leads.updateEstado with optimistic move + revert-on-error"
    requirement: LEADS-02
    verification:
      - kind: automated_ui
        ref: "source assertion: both paths call requestTransition→commitTransition→leads.updateEstado; typecheck pass"
        status: pass
    human_judgment: true
    rationale: "Drag interaction, optimistic-move revert, and keyboard-complete parity require live interaction to confirm"
  - id: D3
    description: "desenlace prompt (Ganado/Perdido) opens before any move into cerrado; cancel aborts (card returns, no mutation), confirm writes estado=cerrado+desenlace"
    requirement: LEADS-02
    verification:
      - kind: automated_ui
        ref: "source assertion: estado==='cerrado' routes to pendingCerrado prompt; confirm passes desenlace; cancel calls no mutation"
        status: pass
    human_judgment: true
    rationale: "Required-choice gate + move-abort-on-cancel behavior needs live verification"
  - id: D4
    description: "lead drawer: Actividad timeline (chronological by ts, autor visible) + Agregar nota form (submit disabled while empty) via leads.addNote"
    requirement: LEADS-03
    verification:
      - kind: automated_ui
        ref: "source assertion: drawer renders sorted lead.timeline; addNote disabled on empty; role=alert error preserves textarea; typecheck pass"
        status: pass
    human_judgment: true
    rationale: "Timeline chronological merge rendering + note append refresh need a visual/interaction check"
  - id: D5
    description: "alta-manual form (Nombre/Contacto/Origen) → leads.create; success asserts the queued email; board invalidated; UI never blocks on send"
    requirement: LEADS-04
    verification:
      - kind: automated_ui
        ref: "source assertion: submit calls leads.create, success copy 'Listo. El lead quedó en Nuevo y avisamos por email.'; typecheck pass"
        status: pass
    human_judgment: true
    rationale: "End-to-end alta → queued email → card in Nuevo requires live UAT with a real trigger"
  - id: D6
    description: "notify-email settings field editing projects.leadsNotifyEmail via projects.updateSettings; invalid → 'Ingresá un email válido'; helper explains owner fallback"
    requirement: LEADS-04
    verification:
      - kind: automated_ui
        ref: "source assertion: save calls projects.updateSettings with leadsNotifyEmail (null when empty); invalid inline copy; typecheck pass"
        status: pass
    human_judgment: true
    rationale: "Persisted recipient + fallback behavior verified live at phase verify time"

# Metrics
duration: 6min
completed: 2026-07-24
status: complete
---

# Phase 11 Plan 05: Bandeja de leads (kanban + drawer + alta + notify-email) Summary

**Drag-and-drop 4-stage leads kanban with a lead drawer (timeline + add-note + estado select), a desenlace gate on close, an alta-manual form that enqueues the idempotent email, and a per-project notify-email field — all on the settled panel tokens/wiring/feedback.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-24T20:51:32Z
- **Completed:** 2026-07-24T20:57:50Z
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 replaced body)

## Accomplishments
- Replaced the `leads/page.tsx` placeholder body (server spine kept verbatim) with the `LeadsBoard` client island in `TRPCReactProvider`, passing `project.leadsNotifyEmail`.
- Built the 4-column kanban reading `leads.listForProject`: stage-ordered columns, count badges (`Sin leads`/`N`), stage+desenlace dots, HTML5 drag transitions with an optimistic move + revert, a cobre drop-target ring, and full board loading/empty/error + column-empty states.
- Wired both transition paths (drag AND the drawer estado `<select>`) to `leads.updateEstado` with a shared optimistic path; every move into `cerrado` opens the neutral `Ganado`/`Perdido` desenlace prompt before the write.
- Lead drawer renders the `Actividad` timeline (chronological by `ts`, autor visible) plus the `Agregar nota` form (`leads.addNote`, submit disabled while empty, error preserves the textarea).
- Alta-manual form (`leads.create`) asserts the queued email and never blocks the UI on the send; notify-email field edits `projects.leadsNotifyEmail` via `projects.updateSettings` with inline `Ingresá un email válido` validation and the owner-fallback helper.

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: server spine + kanban board + drawer + transitions + desenlace prompt** - `0b86a30` (feat)
2. **Task 3: alta-manual form + notify-email settings field** - `b3428e2` (feat)

_Tasks 1 and 2 share the tightly-coupled board/card/drawer/prompt island set (the board imports every island), so they landed in one atomic commit; Task 3's two standalone forms landed in a second._

## Files Created/Modified
- `apps/panel/app/proyectos/[id]/leads/page.tsx` - Server spine kept verbatim; `<main>` body now mounts `<LeadsBoard>` in `TRPCReactProvider` with `notifyEmail`.
- `apps/panel/app/proyectos/[id]/leads/leads-board.tsx` - Kanban root: columns/counts/dots, drag transitions, optimistic move + revert, drawer/prompt/alta orchestration, shared types + color/label helpers.
- `apps/panel/app/proyectos/[id]/leads/lead-card.tsx` - Draggable card: nombre/contacto/origen chip + stage dot + desenlace badge; opens the drawer.
- `apps/panel/app/proyectos/[id]/leads/lead-drawer.tsx` - Right 480px drawer: header + estado select, `Actividad` timeline, `Agregar nota` form.
- `apps/panel/app/proyectos/[id]/leads/desenlace-prompt.tsx` - Neutral required-choice modal (cobre confirm) before entering `cerrado`.
- `apps/panel/app/proyectos/[id]/leads/alta-lead-form.tsx` - Registrar lead modal → `leads.create`, success asserts the queued email.
- `apps/panel/app/proyectos/[id]/leads/notify-email-field.tsx` - Minimal `leadsNotifyEmail` editor via `projects.updateSettings`.

## Decisions Made
- Client `Lead`/`LeadEstado`/`TimelineEntry` types are derived from `inferRouterOutputs<AppRouter>` so the board can never drift from the leads router output.
- `desenlace` is typed as `string | null` (matching the router's nullable `text` column) and compared against the `ganado`/`perdido` literals rather than a narrow union — avoids a cast at the query boundary.
- A drag INTO `cerrado` does NOT move optimistically; it opens the desenlace prompt and only commits on confirm (cancel leaves the card untouched, no mutation) — satisfies the D-03 "cancel aborts the move" contract.
- The notify-email field is seeded from `project.leadsNotifyEmail` (already on the server-resolved `getForOrg` row) rather than issuing a new query.

## Deviations from Plan

None - plan executed exactly as written. Copy is verbatim from the UI-SPEC Copywriting Contract; `Negociación` is always rendered accented and the raw `negociacion` enum value never reaches the UI.

## Issues Encountered
- Initial typecheck flagged `desenlace` as `string | null` vs the `Desenlace` union in `stageDot`/`desenlaceDot` — resolved by widening those helper signatures to `string | null` (the router's actual column type) and comparing against the literals. Typecheck, lint, and build then passed clean.
- `pnpm --filter @imbau/panel build` fails fast on missing env vars in a bare shell (env schema validated at `next.config` load). Supplied placeholder `DATABASE_*`/`NEXT_PUBLIC_APP_ENV`/auth/redis values (no DB connection needed for the build) → build compiled successfully and rendered `/proyectos/[id]/leads` as a dynamic route.

## User Setup Required

None - no external service configuration required for this plan. (Live email delivery + drag/UAT verification happen at phase verify time.)

## Next Phase Readiness
- The bandeja delivers LEADS-01..04 in the panel; typecheck + lint + build are green.
- The 3 UI-SPEC backstop rows (long-text card, long-text timeline, drawer overflow) plus the drag / desenlace / alta→email / notify-email flows route to the held-out visual + UAT check at phase verify time.
- Fase-2 can mount the public anon lead-capture form on top of the same `leads.create` seam without reworking this surface.

## Self-Check: PASSED

All 7 island/spine files exist on disk; both task commits (`0b86a30`, `b3428e2`) are in git history.

---
*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Completed: 2026-07-24*
