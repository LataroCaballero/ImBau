# Requirements: ImBau — Milestone v1.3 Panel de autogestión

**Defined:** 2026-07-17
**Core Value:** La fundación técnica desplegada y operable: cada commit a main termina corriendo en staging con aislamiento multi-tenant verificable por RLS.

## v1.3 Requirements

Requirements de este milestone (fase 4 del plan maestro). Cada uno mapea a una fase del roadmap.

### Deuda v1.2

- [x] **DEBT-01**: `fase-0/foundation` mergeada a `main` con todo v1.2 desplegado en staging
- [x] **DEBT-02**: Re-verificación en vivo en staging: rate-limit 429 en `quotes.*`, flujo PDF completo, QR con URL de staging

### Shell del panel

- [x] **PANEL-01**: Developer navega a `proyectos/[id]` y ve un layout con tabs (unidades, leads, hotspots) scoped al proyecto de su org
- [x] **PANEL-02**: Toda mutación del panel exige rol owner/developer (viewer solo lectura) — verificado por matriz de tests cross-rol, no solo UI

### D1 — Grilla de unidades

- [x] **GRID-01**: Developer edita el precio de una unidad inline, por lista de pagos (matriz unidad × price_list), persistido con vigencia
- [x] **GRID-02**: Developer cambia el estado de una unidad (disponible/reservado/vendido) desde la grilla
- [x] **GRID-03**: Developer exporta la grilla a Excel con template canónico (sanitizado contra formula injection)
- [x] **GRID-04**: Developer importa Excel con validación completa y preview dry-run con diff campo por campo antes de aplicar
- [x] **GRID-05**: El import se aplica transaccional e idempotente (all-or-nothing, upsert por clave natural; migración `UNIQUE(unit_id, price_list_id)`)
- [x] **GRID-06**: Developer aplica bulk edit de precios (% o monto fijo) sobre una selección de unidades
- [x] **GRID-07**: Cambios de precio/estado se reflejan en la web pública al instante (revalidación ISR on-demand del picker/cotizador)

### D2 — Bandeja de leads

- [x] **LEADS-01**: Developer ve la bandeja de leads con origen (broker / unidad / cotización)
- [x] **LEADS-02**: Developer mueve un lead por el pipeline fijo nuevo → contactado → negociación → cerrado
- [x] **LEADS-03**: Developer agrega notas al timeline del lead
- [x] **LEADS-04**: Developer recibe aviso por email ante lead nuevo (queued e idempotente — nunca bloquea la mutación)

### Editor de hotspots

- [x] **HSPOT-01**: Developer dibuja polígonos de pisos sobre el render exterior del edificio y los vincula a un piso
- [x] **HSPOT-02**: Developer dibuja polígonos de unidades sobre la planta del piso y los vincula a una unidad
- [x] **HSPOT-03**: Developer edita y borra polígonos existentes
- [x] **HSPOT-04**: Polígonos guardados en coordenadas viewBox intrínsecas y validados (no degenerados), consumibles tal cual por el explorador de fase 2 vía las policies anon existentes

## Future Requirements

Diferidos — trackeados pero fuera del roadmap actual.

### Editor de hotspots

- **HSPOT-05**: Snapping + hover-preview en el editor (se itera mirando, cuando el explorador exista)

### Realtime

- **RT-01**: SSE vía Postgres LISTEN/NOTIFY para precios/estados en vivo en la web pública (fase 2 — el consumidor es el explorador; los writes ya quedan canalizados por un único path)

### Panel (fase 6 del plan maestro)

- **D4**: Métricas (unidades más vistas, sesiones, cotizaciones, conversión, ranking brokers)
- **D5**: Configuración (logo, colores, textos, formas de pago, brokers)
- **D6**: Alertas de interés repetido
- **HIST-01**: UI de historial de precios (los datos se capturan vía vigencia; la UI se difiere)

## Out of Scope

Exclusiones explícitas. Documentadas para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| CRM completo (pipelines configurables, scoring, follow-up automático, routing, asignación multi-vendedor) | modelo-mvp.md §2.2: "solo el liviano de D2"; anti-feature confirmada por research |
| Column-mapping wizard para Excel arbitrario | El template canónico round-trip (export define el formato) cubre el caso real; el wizard es complejidad especulativa |
| Parsing de fórmulas / multi-sheet en import | Superficie de ataque y complejidad sin caso de uso; solo valores planos del template |
| Hotspots bezier/freeform/AI-assisted | Polígonos simples cubren el producto; decisión renders estáticos + SVG |
| SheetJS (`xlsx` de npm) | CVE-2023-30533 sin patch en npm (prototype pollution en el path de import); se usa `exceljs` |
| Todo lo marcado `[B]` en modelo-mvp.md | Regla de corte A/B — espera feedback de Pablo |

## Traceability

Qué fases cubren qué requirements. Se actualiza al crear el roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | Phase 8 | Complete |
| DEBT-02 | Phase 8 | Complete |
| PANEL-01 | Phase 9 | Complete |
| PANEL-02 | Phase 9 | Complete |
| GRID-01 | Phase 10 | Complete |
| GRID-02 | Phase 10 | Complete |
| GRID-03 | Phase 10 | Complete |
| GRID-04 | Phase 10 | Complete |
| GRID-05 | Phase 10 | Complete |
| GRID-06 | Phase 10 | Complete |
| GRID-07 | Phase 10 | Complete |
| LEADS-01 | Phase 11 | Complete |
| LEADS-02 | Phase 11 | Complete |
| LEADS-03 | Phase 11 | Complete |
| LEADS-04 | Phase 11 | Complete |
| HSPOT-01 | Phase 12 | Complete |
| HSPOT-02 | Phase 12 | Complete |
| HSPOT-03 | Phase 12 | Complete |
| HSPOT-04 | Phase 12 | Complete |

**Coverage:**

- v1.3 requirements: 19 total
- Mapped to phases: 19 ✓
- Unmapped: 0

**Phase distribution:**

- Phase 8 (Deuda v1.2 — merge + re-verificación staging): DEBT-01, DEBT-02
- Phase 9 (Shell del panel scoped al proyecto + role gate): PANEL-01, PANEL-02
- Phase 10 (D1 — Grilla de unidades + Excel): GRID-01..07
- Phase 11 (D2 — Bandeja de leads + email): LEADS-01..04
- Phase 12 (Editor de hotspots): HSPOT-01..04

---
*Requirements defined: 2026-07-17*
*Last updated: 2026-07-17 after roadmap creation (Phases 8-12 mapped, 19/19 coverage)*
