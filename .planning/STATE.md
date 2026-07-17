---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Panel de autogestión
status: planning
last_updated: "2026-07-17T19:59:09.285Z"
last_activity: 2026-07-17
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-08)

**Core value:** La fundación técnica desplegada y operable: cada commit a main termina corriendo en staging con aislamiento multi-tenant verificable por RLS.
**Current focus:** v1.2 archivado — pendiente merge a main + re-verificación staging; luego `/gsd-new-milestone` (v1.3 Panel de autogestión)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-17 — Milestone v1.3 started

## Performance Metrics

**Velocity:**

- Total plans completed (proyecto): 39 (v1.0: 18 + v1.1: 12 + v1.2: 9)
- v1.2 plans completed: 9 (fases 4-5)

**By Phase (v1.2):**

| Phase | Plans | Status |
|-------|-------|--------|
| 4. Motor de cotización puro | 4/4 | Complete (2026-07-03) |
| 5. Emisión y persistencia server-side | 5/5 | Complete (2026-07-04) |
| 6. UI pública del cotizador + WhatsApp | 6/6 | Complete (2026-07-05) |
| 7. PDF asíncrono en el worker | 4/4 | Complete (2026-07-08) |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (full log). Decisiones vigentes / abiertas que enmarcan v1.2:

- [Carry v1.0 / A1]: RLS = GUC transaction-scoped (`SET LOCAL`) + roles app/anon sin BYPASSRLS; tabla nueva = clon del template RLS verificado por la suite cross-tenant.
- [Carry CLAUDE.md]: dinero en enteros (USD precios) / decimal (ARS cuotas), nunca floats; migraciones Drizzle versionadas; errores observables (Sentry + pino).
- [Carry v1.1]: schema de `quotes`/`payment_plans`/`cac_index` + seed "Brigos Recoleta" listos para que el cotizador los consuma sin cambios de schema previstos.
- [Settled / Phase 4]: base peso = **CAC como multiplicador** (saldo en unidades CAC al boleto; nunca proyecta CAC futuro ni inventa FX) — encodado en el contrato `QuoteInput` de ENGINE-02.
- [Settled / Phase 5]: A1 (D-06) — `apps/web` hostea el pool app para la cotización anónima: mount tRPC propio + `DATABASE_APP_URL`, fence T-03-09 (cero `@imbau/db` bajo `apps/web/`). Se valida de punta a punta con la UI de fase 6 en staging.
- [Settled / Phase 5]: rate-limit de borde en nginx-host (zona `quotes`, `rate=10r/s + burst=20 nodelay`, `limit_req_status 429`) — aplicado y probado en el VPS 2026-07-04; el archivo del repo (`deploy/nginx/...conf`) es la fuente de verdad (D-12) y está en sync con el box.

### Pending Todos

None yet.

### Blockers/Concerns

Abiertos post-cierre de v1.2:

- ⚠️ Staging corre imagen pre-fase-5 (`a599bb7`) — TODO v1.2 (fases 5-7: rutas quotes, UI cotizador, PDF) llega a staging recién al mergear la rama a main. Re-verificar en staging post-merge: rate-limit 429, flujo PDF completo, QR con URL de staging.
- Pasada visual de fase 6 → trackeada en Deferred Items (abajo).

## Deferred Items

Items acknowledged and deferred at milestone closes (v1.0 2026-06-26, v1.2 2026-07-09 — ambos override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | phase-03 (v1.0) live re-runs: Playwright auth e2e (login persistence, invite→accept) + worker Redis smoke | human_needed (4/4 must-haves verified by code) | 2026-06-26 |
| uat_gap | phase-06 (v1.2) 06-UAT.md — pasada visual humana del layout mobile-first + tema de marca en viewport real | testing (1 pending scenario; criterios de fase verificados por código + e2e 4/4) | 2026-07-08 |

**Detail:** Re-run `pnpm --filter @imbau/panel test:e2e` and `pnpm --filter @imbau/worker test -t "worker connects"` with the Compose stack up to clear. Para el item de v1.2: `/gsd-verify-work 6` con `pnpm dev` y abrir `/p/brigos-recoleta/cotizador` en viewport móvil.

## Session Continuity

Last session: 2026-07-08
Stopped at: Phase 7 complete (UAT 3/3) — milestone v1.2 100% (4/4 fases)
Resume file: None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
