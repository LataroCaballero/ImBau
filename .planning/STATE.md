---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Cotizador
current_phase: 4
current_phase_name: Motor de cotización puro `packages/quoting`
status: planning
stopped_at: Phase 4 context gathered
last_updated: "2026-07-02T19:45:53.189Z"
last_activity: 2026-07-01
last_activity_desc: ROADMAP v1.2 creado (4 fases, 19/19 requirements mapeados)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-01)

**Core value:** El diferencial competitivo #1 (cotizador financiero argentino) funciona de punta a punta con un motor de cálculo provablemente correcto — un error de cálculo mata el producto.
**Current focus:** Phase 4 — Motor de cotización puro (`packages/quoting`)

## Current Position

Phase: 4 of 7 (Motor de cotización puro `packages/quoting`) — primera fase del milestone v1.2
Plan: — (roadmap creado; sin planes aún)
Status: Ready to plan
Last activity: 2026-07-01 — ROADMAP v1.2 creado (4 fases, 19/19 requirements mapeados)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed (proyecto): 30 (v1.0: 18 + v1.1: 12)
- v1.2 plans completed: 0 of TBD

**By Phase (v1.2):**

| Phase | Plans | Status |
|-------|-------|--------|
| 4. Motor de cotización puro | 0/TBD | Not started |
| 5. Emisión y persistencia server-side | 0/TBD | Not started |
| 6. UI pública del cotizador + WhatsApp | 0/TBD | Not started |
| 7. PDF asíncrono en el worker | 0/TBD | Not started |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (full log). Decisiones vigentes / abiertas que enmarcan v1.2:

- [Carry v1.0 / A1]: RLS = GUC transaction-scoped (`SET LOCAL`) + roles app/anon sin BYPASSRLS; tabla nueva = clon del template RLS verificado por la suite cross-tenant.
- [Carry CLAUDE.md]: dinero en enteros (USD precios) / decimal (ARS cuotas), nunca floats; migraciones Drizzle versionadas; errores observables (Sentry + pino).
- [Carry v1.1]: schema de `quotes`/`payment_plans`/`cac_index` + seed "Brigos Recoleta" listos para que el cotizador los consuma sin cambios de schema previstos.
- [Settled / Phase 4]: base peso = **CAC como multiplicador** (saldo en unidades CAC al boleto; nunca proyecta CAC futuro ni inventa FX) — encodado en el contrato `QuoteInput` de ENGINE-02.
- [Open / Phase 5]: sub-decisión **A1-vs-A2** (dónde vive el pool `app` para el `publicProcedure` de cotización) debe resolverse como Key Decision documentada durante la planificación de la fase 5 (A1 recomendado: `apps/web` gana `DATABASE_APP_URL` grep-fenced, ampliando D-03).

### Pending Todos

None yet.

### Blockers/Concerns

None — los blockers de v1.1 se resolvieron todos antes del cierre. Notas de fase para planning:

- Phase 5: QUOTE-03 (nginx `limit_req`) toca infra de staging (nginx-host + certbot, no Traefik — D-01).
- Phase 6: `apps/web` no tiene cliente tRPC hoy (panel sí) — scopearlo explícito en el plan.
- Phase 7: react-pdf en Alpine requiere fuente embebida (acentos) + idempotencia por `quoteId` (retry BullMQ at-least-once).

## Deferred Items

Items acknowledged and deferred at the v1.0 milestone close on 2026-06-26 (override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | phase-03 (v1.0) live re-runs: Playwright auth e2e (login persistence, invite→accept) + worker Redis smoke | human_needed (4/4 must-haves verified by code) | 2026-06-26 |

**Detail:** Re-run `pnpm --filter @imbau/panel test:e2e` and `pnpm --filter @imbau/worker test -t "worker connects"` with the Compose stack up to clear.

## Session Continuity

Last session: 2026-07-02T19:45:53.180Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-motor-de-cotizaci-n-puro-packages-quoting/04-CONTEXT.md

## Operator Next Steps

- `/gsd-plan-phase 4` — planificar la fase 4 (Motor de cotización puro `packages/quoting`)
