---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Panel de autogestión
status: planning
last_updated: "2026-07-17T20:30:00.000Z"
last_activity: 2026-07-17
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** La fundación técnica desplegada y operable: cada commit a main termina corriendo en staging con aislamiento multi-tenant verificable por RLS.
**Current focus:** v1.3 roadmap creado (Phases 8-12). Primer paso: Phase 8 — merge de `fase-0/foundation` a `main` + re-verificación en staging antes de cualquier feature del panel.

## Current Position

Phase: Phase 8 — Deuda v1.2 (merge + re-verificación staging) — not started
Plan: —
Status: Roadmap creado, listo para planificar Phase 8
Last activity: 2026-07-17 — ROADMAP v1.3 creado (5 fases, 19/19 requirements mapeados)

## Roadmap (v1.3 — Phases 8-12)

Numeración GSD continúa desde v1.2 (última fase = 7).

| Phase | Goal | Requirements | Depende de |
|-------|------|--------------|------------|
| 8. Deuda v1.2 — merge + re-verificación staging | Todo v1.2 corre verificado en staging tras merge a main | DEBT-01, DEBT-02 | v1.2 (rama a mergear) |
| 9. Shell del panel scoped al proyecto + role gate | Layout `proyectos/[id]` con tabs + role-gate server-side | PANEL-01, PANEL-02 | Phase 8 |
| 10. D1 — Grilla de unidades + Excel | Grilla editable (precio/estado/listas) + Excel round-trip transaccional | GRID-01..07 | Phase 9 |
| 11. D2 — Bandeja de leads + email | Bandeja + pipeline 4 estados + notas + email queued idempotente | LEADS-01..04 | Phase 9 (reusa patrón de 10) |
| 12. Editor de hotspots | Editor SVG draw/edit/delete + vínculo piso/unidad, coords viewBox | HSPOT-01..04 | Phase 9 |

**Orden de ejecución:** 8 → 9 → 10 → 11 → 12. Phases 11 y 12 son paralelizables una vez existe el shell (9), si hay capacidad.

**UI hint:** Phases 9, 10, 11, 12 tienen superficie frontend en el panel (candidatas a `/gsd-ui-phase`). Phase 8 es infra/ops, sin UI.

**Research flags (resolver al planificar):**
- Phase 10 (D1 Excel import): edge cases de parsing de dinero es-AR (separador `.`, fecha DD/MM/YYYY, encoding) + UX de validación/error.
- Phase 12 (hotspots): dónde vive el render exterior del edificio (`projects` vs fila `media`) antes de cablear el editor de pisos.

## Performance Metrics

**Velocity:**

- Total plans completed (proyecto): 39 (v1.0: 18 + v1.1: 12 + v1.2: 9)
- v1.3 plans completed: 0 (roadmap recién creado)

**By Phase (v1.3):**

| Phase | Plans | Status |
|-------|-------|--------|
| 8. Deuda v1.2 — merge + re-verificación staging | 0/TBD | Not started |
| 9. Shell del panel scoped al proyecto + role gate | 0/TBD | Not started |
| 10. D1 — Grilla de unidades + Excel | 0/TBD | Not started |
| 11. D2 — Bandeja de leads + email | 0/TBD | Not started |
| 12. Editor de hotspots | 0/TBD | Not started |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (full log). Decisiones vigentes / abiertas que enmarcan v1.3:

- [Carry v1.0 / A1]: RLS = GUC transaction-scoped (`SET LOCAL`) + roles app/anon sin BYPASSRLS; tabla nueva = clon del template RLS verificado por la suite cross-tenant. **RLS prueba aislamiento de tenant, no autorización** → las tres superficies de escritura del panel necesitan `requireRole` explícito además de RLS.
- [Carry CLAUDE.md]: dinero en enteros (USD precios) / decimal (ARS cuotas), nunca floats; migraciones Drizzle versionadas; errores observables (Sentry + pino). **Crítico en D1**: nunca confiar en números tipados de celdas Excel (contaminación float del USD entero).
- [Carry v1.2 / D-12]: rate-limit de borde nginx (`quotes` zona, 10r/s + burst 20 nodelay, 429) — el archivo del repo es la fuente de verdad; re-verificar en staging en Phase 8.
- [Research / v1.3]: `exceljs@4.4.0` (MIT) es la única dependencia runtime net-new; **NO instalar `xlsx`/SheetJS** (CVE-2023-30533 sin patch en el path de import). Editor de hotspots hand-rolled (SVG `viewBox` pointer-events, ~250 líneas) — sin canvas/Konva (viola "sin motor tipo game engine").
- [Research / v1.3, a decidir en planning]: migración `UNIQUE(unit_id, price_list_id)` en `unit_prices` — hace idempotente el upsert de grilla/Excel y protege el resolver de cotización de v1.2 (una fila por unidad×lista). Excel parse/build en módulo puro `packages/api/src/excel/` (I/O-free, testeable).
- [Research / v1.3, a decidir en planning]: email de lead **queued** (BullMQ, clona el contrato quote-pdf) vs inline Resend (patrón invitación) — decidir en Phase 11; emisión de `events` por transición lead/precio (cheap, forward-compatible) vs diferir — decidir en Phase 10/11.

### Pending Todos

None yet.

### Blockers/Concerns

Abiertos entrando a v1.3:

- ⚠️ Staging corre imagen pre-fase-5 (`a599bb7`) — TODO v1.2 (fases 5-7: rutas quotes, UI cotizador, PDF) llega a staging recién al mergear la rama a main. **Es el trabajo de Phase 8** (DEBT-01/02): merge → deploy → re-verificar rate-limit 429, flujo PDF completo, QR con URL de staging. Gate real: infra del operador (merge + deploy a VPS).
- Pasada visual de fase 6 (v1.2) → sigue trackeada en Deferred Items (abajo), no bloquea v1.3.

## Deferred Items

Items acknowledged and deferred at milestone closes (v1.0 2026-06-26, v1.2 2026-07-09 — ambos override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | phase-03 (v1.0) live re-runs: Playwright auth e2e (login persistence, invite→accept) + worker Redis smoke | human_needed (4/4 must-haves verified by code) | 2026-06-26 |
| uat_gap | phase-06 (v1.2) 06-UAT.md — pasada visual humana del layout mobile-first + tema de marca en viewport real | testing (1 pending scenario; criterios de fase verificados por código + e2e 4/4) | 2026-07-08 |

**Detail:** Re-run `pnpm --filter @imbau/panel test:e2e` and `pnpm --filter @imbau/worker test -t "worker connects"` with the Compose stack up to clear. Para el item de v1.2: `/gsd-verify-work 6` con `pnpm dev` y abrir `/p/brigos-recoleta/cotizador` en viewport móvil. La re-verificación en staging de v1.2 se absorbe en Phase 8 (DEBT-02).

## Session Continuity

Last session: 2026-07-17
Stopped at: ROADMAP v1.3 creado (Phases 8-12, 19/19 requirements mapeados, coverage 100%)
Resume file: None

## Operator Next Steps

- Planificar la primera fase con `/gsd-plan-phase 8` (o `/gsd-discuss-phase 8` primero). Phase 8 es mecánica pero depende de infra del operador: merge de `fase-0/foundation` a `main` + deploy a staging + re-verificación en vivo.
