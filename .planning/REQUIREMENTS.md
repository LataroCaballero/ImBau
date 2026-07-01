# Requirements: ImBau — Milestone v1.2 Cotizador

**Defined:** 2026-07-01
**Core Value:** El diferencial competitivo #1 (cotizador financiero argentino) funciona de punta a punta con un motor de cálculo provablemente correcto — un error de cálculo mata el producto.

## v1.2 Requirements

Requirements de este milestone. Cada uno mapea a una fase del roadmap.

### Motor de cotización (`packages/quoting`)

- [ ] **ENGINE-01**: El motor calcula la cotización **contado** (precio USD de la lista contado con descuento) como función pura y determinista, sin I/O
- [ ] **ENGINE-02**: El motor calcula la cotización **financiada**: anticipo USD + saldo en N cuotas ajustadas por CAC + refuerzos, con la primera cuota expresada en ARS "al valor del mes" usando **CAC como multiplicador** (el saldo se expresa en unidades CAC al boleto; nunca proyecta CAC futuro ni inventa FX)
- [ ] **ENGINE-03**: El motor emite una estructura tipada única (`QuoteResult`) que alimenta UI, PDF y texto de WhatsApp — las tres superficies nunca difieren
- [ ] **ENGINE-04**: `packages/quoting` tiene cobertura 100% exigida en CI + property-based tests con invariantes (anticipo + saldo + refuerzos reconcilian con el precio; suma de cuotas = saldo exacto; CAC monótono ⇒ cuota ARS monótona; determinismo)
- [ ] **ENGINE-05**: Todo el dinero se maneja en enteros (USD) / decimal (ARS), nunca floats — con regla de redondeo explícita y asignación de resto documentada y testeada (los totales cierran al centavo)
- [ ] **ENGINE-06**: El motor exporta una versión (`ENGINE_VERSION`) que se embebe en cada snapshot y se bumpea ante cualquier cambio de fórmula

### Emisión y persistencia de cotizaciones

- [ ] **QUOTE-01**: Un comprador anónimo puede generar una cotización desde la web pública — el cómputo y la persistencia corren server-side vía procedure público auditado con `withTenant` (sin agregar policies anon a `quotes`/`cac_index`, que quedan tenant-private)
- [ ] **QUOTE-02**: Cada cotización emitida persiste su snapshot completo (inputs resueltos + outputs + versión del motor) en `quotes.snapshot` — auditabilidad total, punto-en-el-tiempo, nunca recompute en vivo
- [ ] **QUOTE-03**: El endpoint anónimo de cotización tiene rate limit en el edge (nginx `limit_req`, no Traefik — D-01)

### UI del cotizador (web pública)

- [ ] **UI-01**: El comprador llega a cotizar una unidad sin el explorador: deep-link compartible por URL param + picker mínimo piso→unidad sobre unidades publicadas (rol anon)
- [ ] **UI-02**: El comprador ve el resultado en pantalla mobile-first: precio USD, anticipo (USD + %), cuotas, primera cuota ARS "al valor del mes", refuerzos y totales
- [ ] **UI-03**: El comprador ve la comparación **contado vs financiado** lado a lado (dos corridas del mismo motor)
- [ ] **UI-04**: El comprador ajusta anticipo/plazo de forma interactiva solo dentro de los planes preset y bounds autorizados por el developer (nunca términos libres)
- [ ] **UI-05**: La leyenda de ajuste CAC + "cotización no vinculante" (`payment_plans.notasLegales`) es visible en pantalla
- [ ] **UI-06**: Todos los montos se formatean es-AR (miles con punto, decimales con coma; US$ vs $) consistente entre server y cliente

### PDF de la cotización

- [ ] **PDF-01**: El comprador puede descargar el PDF de su cotización, generado server-side en el worker (BullMQ) desde el snapshot, almacenado en R2 con key en `quotes.pdfKey` — asíncrono, nunca bloquea el resultado en pantalla
- [ ] **PDF-02**: La generación de PDF es idempotente por `quoteId` (retry de BullMQ no duplica objetos) y renderiza correctamente acentos españoles en el worker Alpine (fuente embebida, sin Chromium)
- [ ] **PDF-03**: El PDF lleva la leyenda legal "cotización no vinculante" + leyenda de ajuste CAC

### Handoff a WhatsApp

- [ ] **WA-01**: El CTA "Consultar por WhatsApp" abre wa.me con el resumen de la cotización precargado (generado del mismo `QuoteResult`), URL-encoded, corto (resumen + link, no la tabla completa), con número del proyecto y slot listo para routing por broker (fase 5)

## Future Requirements (v1.x+)

Diferidos — trackeados pero fuera de este roadmap.

### Cotizador

- **COTIZ-F01**: Deep-link desde la ficha de unidad (llega con fase 2 explorador/ficha)
- **COTIZ-F02**: Routing del CTA WhatsApp por broker `/b/<slug>` (llega con fase 5 broker links)
- **COTIZ-F03**: Módulo informativo de gastos de cierre (sellos/escribanía) — variable por jurisdicción
- **COTIZ-F04**: Ingesta automática del índice CAC (scraping/API) — carga manual alcanza a volumen MVP

## Out of Scope

Exclusiones explícitas — documentadas para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Proyección de valores CAC futuros ("tu cuota en el mes 24 será $X") | CAC es incognoscible; contradice "no vinculante" y es un riesgo legal — solo cuota de hoy + leyenda |
| Cotizaciones vinculantes / "precio garantizado" | El precio sigue la lista vigente al boleto; snapshot es para auditoría, no garantía |
| Anticipo/plazo libres fuera de lo autorizado por el developer | Genera leads por términos que el developer rechaza — solo presets y bounds |
| FX USD→ARS inventado | Un tipo de cambio propio queda mal al instante — la base peso es el CAC (decisión de motor) |
| Tabla de amortización completa (48 cuotas proyectadas) | Implica proyectar CAC + UI pesada en mobile — primera cuota + cronograma de refuerzos + totales |
| Creación de lead en cada vista de cotización | Un quote no es lead hasta que el comprador acciona; la bandeja de leads (D2) es fase 4 y el flujo de contacto (P7) es fase 5 |
| Policies RLS anon sobre `quotes`/`cac_index` | Expondría el índice de cada tenant y abriría spam de inserts — el path público es server-side auditado |

## Traceability

Qué fases cubren qué requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENGINE-01 | Phase 4 | Pending |
| ENGINE-02 | Phase 4 | Pending |
| ENGINE-03 | Phase 4 | Pending |
| ENGINE-04 | Phase 4 | Pending |
| ENGINE-05 | Phase 4 | Pending |
| ENGINE-06 | Phase 4 | Pending |
| QUOTE-01 | Phase 5 | Pending |
| QUOTE-02 | Phase 5 | Pending |
| QUOTE-03 | Phase 5 | Pending |
| UI-01 | Phase 6 | Pending |
| UI-02 | Phase 6 | Pending |
| UI-03 | Phase 6 | Pending |
| UI-04 | Phase 6 | Pending |
| UI-05 | Phase 6 | Pending |
| UI-06 | Phase 6 | Pending |
| PDF-01 | Phase 7 | Pending |
| PDF-02 | Phase 7 | Pending |
| PDF-03 | Phase 7 | Pending |
| WA-01 | Phase 6 | Pending |

**Coverage:**
- v1.2 requirements: 19 total
- Mapped to phases: 19 (100%) ✓
- Unmapped: 0

**Por fase:**
- Phase 4 — Motor de cotización puro: ENGINE-01..06 (6)
- Phase 5 — Emisión y persistencia server-side: QUOTE-01, QUOTE-02, QUOTE-03 (3)
- Phase 6 — UI pública del cotizador + WhatsApp: UI-01..06, WA-01 (7)
- Phase 7 — PDF asíncrono en el worker: PDF-01, PDF-02, PDF-03 (3)

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after roadmap creation (v1.2, Phases 4-7, 19/19 requirements mapeados)*
