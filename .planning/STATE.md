---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Cotizador
current_phase: 07
status: milestone complete
stopped_at: Phase 7 complete — milestone v1.2 100%
last_updated: "2026-07-08T23:43:31.771Z"
last_activity: 2026-07-08
last_activity_desc: Phase 07 complete
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 19
  completed_plans: 19
  percent: 100
current_phase_name: PDF asíncrono en el worker
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-08)

**Core value:** El diferencial competitivo #1 (cotizador financiero argentino) funciona de punta a punta con un motor de cálculo provablemente correcto — un error de cálculo mata el producto.
**Current focus:** Milestone v1.2 completo (4/4 fases) — cierre de milestone + merge a main/staging

## Current Position

Phase: 07 (última del milestone) — Complete
Plan: 19/19
Status: Milestone v1.2 complete — ready to archive
Last activity: 2026-07-08 — Phase 07 complete

Progress: [████████████████████] 19/19 plans (100%)

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

Notas vigentes para el cierre de milestone:

- ⚠️ [Milestone close] Staging corre imagen pre-fase-5 (`a599bb7`) — TODO v1.2 (fases 5-7: rutas quotes, UI cotizador, PDF) llega a staging recién al mergear la rama a main. Re-verificar en staging post-merge: rate-limit 429, flujo PDF completo, QR con URL de staging.
- ⚠️ [Phase 6, no bloqueante] Pasada visual de marca en viewport real pendiente (06-UAT.md).
- Resueltos en Phase 7: react-pdf en Alpine con Roboto embebida (COPY explícito de assets, UAT 3/3) e idempotencia por `quoteId` (jobId dedup + attempts 5) — verificados.

## Deferred Items

Items acknowledged and deferred at the v1.0 milestone close on 2026-06-26 (override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | phase-03 (v1.0) live re-runs: Playwright auth e2e (login persistence, invite→accept) + worker Redis smoke | human_needed (4/4 must-haves verified by code) | 2026-06-26 |

**Detail:** Re-run `pnpm --filter @imbau/panel test:e2e` and `pnpm --filter @imbau/worker test -t "worker connects"` with the Compose stack up to clear.

## Session Continuity

Last session: 2026-07-08
Stopped at: Phase 7 complete (UAT 3/3) — milestone v1.2 100% (4/4 fases)
Resume file: None

## Operator Next Steps

- `/gsd-complete-milestone v1.2` — archivar el milestone y preparar el siguiente
