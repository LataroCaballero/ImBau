---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Panel de autogestión
current_phase: 12
current_phase_name: Editor de hotspots
status: planning
stopped_at: Completed 11-05-PLAN.md
last_updated: "2026-07-24T22:56:52.096Z"
last_activity: 2026-07-24
last_activity_desc: Phase 11 complete, transitioned to Phase 12
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 14
  completed_plans: 14
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-20)

**Core value:** La fundación técnica desplegada y operable: cada commit a main termina corriendo en staging con aislamiento multi-tenant verificable por RLS.
**Current focus:** Phase 11 — d2-bandeja-de-leads-notificaci-n-por-email

## Current Position

Phase: 12 — Editor de hotspots
Plan: Not started
Status: Ready to plan
Last activity: 2026-07-24 — Phase 11 complete, transitioned to Phase 12

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
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 8 P01 | 27min | 3 tasks | 3 files |
| Phase 08 P02 | 8min | 3 tasks | 1 files |
| Phase 09 P01 | 4min | 3 tasks | 4 files |
| Phase 09 P02 | 3min | 3 tasks | 9 files |
| Phase 10 P01 | 2min | 2 tasks | 5 files |
| Phase 10 P02 | 20min | 2 tasks | 15 files |
| Phase 10 P03 | 14min | 3 tasks | 5 files |
| Phase 10 P04 | 35min | 3 tasks | 10 files |
| Phase 11 P01 | 30min | 3 tasks | 5 files |
| Phase 11 P02 | 6min | 3 tasks | 6 files |
| Phase 11 P03 | 8min | 3 tasks | 5 files |
| Phase 11 P04a | 20min | 2 tasks | 2 files |
| Phase 11 P04 | 8min | 3 tasks | 7 files |
| Phase 11 P05 | 6min | 3 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (full log). Decisiones vigentes / abiertas que enmarcan v1.3:

- [Carry v1.0 / A1]: RLS = GUC transaction-scoped (`SET LOCAL`) + roles app/anon sin BYPASSRLS; tabla nueva = clon del template RLS verificado por la suite cross-tenant. **RLS prueba aislamiento de tenant, no autorización** → las tres superficies de escritura del panel necesitan `requireRole` explícito además de RLS.
- [Carry CLAUDE.md]: dinero en enteros (USD precios) / decimal (ARS cuotas), nunca floats; migraciones Drizzle versionadas; errores observables (Sentry + pino). **Crítico en D1**: nunca confiar en números tipados de celdas Excel (contaminación float del USD entero).
- [Carry v1.2 / D-12]: rate-limit de borde nginx (`quotes` zona, 10r/s + burst 20 nodelay, 429) — el archivo del repo es la fuente de verdad; re-verificar en staging en Phase 8.
- [Research / v1.3]: `exceljs@4.4.0` (MIT) es la única dependencia runtime net-new; **NO instalar `xlsx`/SheetJS** (CVE-2023-30533 sin patch en el path de import). Editor de hotspots hand-rolled (SVG `viewBox` pointer-events, ~250 líneas) — sin canvas/Konva (viola "sin motor tipo game engine").
- [Research / v1.3, a decidir en planning]: migración `UNIQUE(unit_id, price_list_id)` en `unit_prices` — hace idempotente el upsert de grilla/Excel y protege el resolver de cotización de v1.2 (una fila por unidad×lista). Excel parse/build en módulo puro `packages/api/src/excel/` (I/O-free, testeable).
- [Research / v1.3, a decidir en planning]: email de lead **queued** (BullMQ, clona el contrato quote-pdf) vs inline Resend (patrón invitación) — decidir en Phase 11; emisión de `events` por transición lead/precio (cheap, forward-compatible) vs diferir — decidir en Phase 10/11.
- [Phase ?]: Phase 8-01: merged PR #5 to main via merge commit (22d1e96, not squash) preserving 397-commit history + v1.2 tag; kept fase-0/foundation (D-01/D-03)
- [Phase ?]: Phase 8-01: fixed two shared-_test-DB Vitest flakes (db fileParallelism:false for concurrent partition-DDL race; worker testTimeout 30s for real sharp/PG suites) to green the required quality gate
- [Phase ?]: Phase 8-02: DEBT-02 live-verified on staging — quotes burst 77x429/0x503 (fase-5 live, not 404), nginx box==repo vhost (D-12, no sync-back), PDF e2e (quoteId 5d67277a) Roboto+es-AR accents with staging deep-link, worker+Loki+Sentry green
- [Phase ?]: Phase 9-01: panel write mold = requireRole(owner,developer)+withTenant+.returning() 0-row NOT_FOUND; the verbatim template D1/D2/hotspots clone
- [Phase ?]: Phase 9-01: canary = projects.updateSettings estado borrador<->publicado (D-05), observable via anon listPublished; PANEL-01/02 proven by projects-role-gate.test.ts (41/41 green vs real Postgres)
- [Phase ?]: unit_prices UNIQUE(unit_id, price_list_id) enforced at DB via versioned migration 0005 (GRID-05)
- [Phase ?]: Phase 10-02: pure packages/api/src/excel module (build/parse/money/dry-run/bulk), I/O-free, exceljs@4.4.0; parseMoneyEsAr property-proven never non-integer (D-08); 62 excel tests green
- [Phase ?]: Phase 10-02: unknown identificador on import = error 'no existe en el proyecto' (units not created via Excel); 'nueva' = previously-unpriced unit gains a price; blank price cell = null for GRID-05 idempotency
- [Phase ?]: Phase 10-03: unitsRouter wires grid read + 4 money mutations (updatePrice/updateEstado/importExcel/bulkUpdatePrice) + export/dry-run/bulk-preview as thin requireRole(owner,developer)+withTenant clones over the pure excel module; events audit (unit_price_changed/unit_estado_changed) co-transactional with each write (D-02)
- [Phase ?]: Phase 10-03: updatePrice (INSERT ... ON CONFLICT) can't rely on the UPDATE 0-row mold — a cross-org parent trips a composite-FK 23503; added an RLS-scoped unit+price_list existence pre-check → NOT_FOUND (no-enumeration). blank import price = DELETE the unit_prices row (precio NOT NULL). GRID-07 = Path A (force-dynamic cross-surface test, no revalidation plumbing). @imbau/api 124/124 green
- [Phase ?]: Phase 10-04: panel units-grid = first STYLED surface; RSC guard verbatim + "use client" island via useTRPC + inline role=status/alert feedback (no global toast) + mandatory viejo→nuevo preview for every irreversible money op — the mold Phases 11/12 clone
- [Phase ?]: Phase 10-04: money renders via canonical formatUsd as 'US$ 185.000' (not UI-SPEC illustrative 'USD 185.000') — user-accepted; single-source formatter guarantees UI == PDF == WhatsApp. packages/ui/src/tokens.css EXTENDED (un-prefixed), not forked to --imbau-*
- [Phase ?]: desenlace as nullable text (Zod-validated), not a PG enum — leadEstadoEnum untouched (D-03)
- [Phase ?]: leads_notify_email needs no new pgPolicy — projects_tenant covers it, anon policy is SELECT-only public fields (D-05)
- [Phase ?]: Lead-email queue contract uses jobId = lead:{id}:created (namespaced dedup, LEADS-04/T-11-08)
- [Phase ?]: Lead-notification dispatch reads a dedicated minimal env (never the auth runtime env) so the worker import carries no BETTER_AUTH_SECRET/DATABASE_URL; imported via @imbau/api/email
- [Phase ?]: leads.listForProject returns origenResuelto {tipo,label} (broker/unidad/cotizacion/directo)
- [Phase ?]: leads events audit keyed by (project_id, tipo=lead_estado_changed) — events has no lead_id
- [Phase ?]: projects.updateSettings: estado optional + empty-patch BAD_REQUEST guard for leadsNotifyEmail-only patches
- [Phase ?]: 11-04a: org_owner_emails SECURITY DEFINER fn (migration 0007) — parameterized org door, pinned search_path, REVOKE EXECUTE FROM PUBLIC then GRANT to app_authenticated only; no broad user-table grant
- [Phase ?]: 11-04: lead-email worker fallback reads org owners ONLY via org_owner_emails SECURITY DEFINER door under withTenant (never owner pool / direct user read)
- [Phase ?]: Leads bandeja client types derived from inferRouterOutputs<AppRouter> (no drift from router)
- [Phase ?]: Drag into cerrado defers optimistic move until desenlace prompt confirms (cancel = no mutation)

### Pending Todos

None yet.

### Blockers/Concerns

Entrando a Phase 9:

- ✅ RESUELTO (Phase 8, DEBT-01/02): v1.2 mergeado a `main` (`22d1e96`) y re-verificado EN VIVO en staging — burst 429/0×503, PDF e2e es-AR, deep-link a staging, smoke de superficies + worker/Loki/Sentry, deploy no-op, y drill migrate-before-swap (T-4-MIGRATE) demostrado sin downtime. Security 10/10 (08-SECURITY.md). UAT 5/5.
- Pasada visual de fase 6 (v1.2) → sigue trackeada en Deferred Items (abajo), no bloquea v1.3.
- ⚠️ [Phase 9] Las 3 superficies de escritura del panel (D1/D2/hotspots) necesitan `requireRole` explícito además de RLS — RLS prueba aislamiento de tenant, no autorización. El role-gate server-side arranca en el shell (Phase 9).

## Deferred Items

Items acknowledged and deferred at milestone closes (v1.0 2026-06-26, v1.2 2026-07-09 — ambos override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | phase-03 (v1.0) live re-runs: Playwright auth e2e (login persistence, invite→accept) + worker Redis smoke | human_needed (4/4 must-haves verified by code) | 2026-06-26 |
| uat_gap | phase-06 (v1.2) 06-UAT.md — pasada visual humana del layout mobile-first + tema de marca en viewport real | testing (1 pending scenario; criterios de fase verificados por código + e2e 4/4) | 2026-07-08 |

**Detail:** Re-run `pnpm --filter @imbau/panel test:e2e` and `pnpm --filter @imbau/worker test -t "worker connects"` with the Compose stack up to clear. Para el item de v1.2: `/gsd-verify-work 6` con `pnpm dev` y abrir `/p/brigos-recoleta/cotizador` en viewport móvil. La re-verificación en staging de v1.2 ya se cerró en Phase 8 (DEBT-02, UAT 5/5 el 2026-07-20); lo único que sigue diferido es la pasada visual humana de marca.

## Session Continuity

Last session: 2026-07-24T20:59:10.064Z
Stopped at: Completed 11-05-PLAN.md
Resume file: None

## Operator Next Steps

- Phase 8 cerrada (deuda v1.2 saldada, staging verificado en vivo). Seguir con `/gsd-discuss-phase 9` (o `/gsd-plan-phase 9` directo). Phase 9 es el shell del panel scoped a `proyectos/[id]` con tabs + role-gate server-side — primera superficie frontend del panel (candidata a `/gsd-ui-phase`).
