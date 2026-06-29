# Requirements: ImBau — v1.1 Schema + Media + Seed (Fase 1)

**Defined:** 2026-06-26
**Core Value:** La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging con aislamiento multi-tenant verificable por RLS.

## v1 Requirements

Requirements de este milestone (v1.1 = Fase 1 del modelo-mvp). Cada uno mapea a una fase del roadmap.

### Schema

Modelo de datos completo de modelo-mvp §3.3, con RLS por tenant y migraciones Drizzle versionadas. Dinero en enteros/decimal (nunca floats); USD para precios, ARS para cuotas; UTC en DB.

- [x] **SCHEMA-01**: floors + units (project, floor, identificador, tipología, m2, orientación, ambientes, plano, estado [disponible|reservado|vendido], polígono SVG, orden) con RLS por tenant y migración Drizzle versionada
- [x] **SCHEMA-02**: pricing — price_lists (nombre, moneda), unit_prices (precio + vigencia), payment_plans (anticipo %, cuotas, ajuste [CAC|fijo], refuerzos JSONB, notas legales) y cac_index (período, valor) — dinero en enteros, RLS por tenant
- [x] **SCHEMA-03**: quotes (project, unit, payment_plan, snapshot JSONB del cálculo, pdf storage key, lead opcional) — schema listo para que el cotizador (Fase 3) lo consuma; RLS por tenant. El motor de cálculo NO se construye en este milestone
- [x] **SCHEMA-04**: brokers (nombre, slug del link, whatsapp, email) + leads (unit?, broker?, quote?, nombre, contacto, origen, estado [nuevo|contactado|negociación|cerrado], timeline de notas); leads acepta insert anónimo validado (Zod); RLS por tenant
- [x] **SCHEMA-05**: contenido — progress_posts (fecha, título, media), galleries (sección [amenities|exteriores|interiores], imágenes, pano360s) y media (original + variantes R2, dimensiones, blurhash) con RLS por tenant
- [x] **SCHEMA-06**: events particionada por mes (project, tipo, unit?, broker?, session_id, ts), acepta insert anónimo (analytics) con rate-limit en el edge; RLS por tenant
- [x] **SCHEMA-07**: policy `anon` — la web pública (rol anon, sin BYPASSRLS) solo lee filas pertenecientes a proyectos `publicado` en todas las tablas de catálogo/contenido; verificado por test
- [x] **SCHEMA-08**: suite de aislamiento cross-tenant extendida a todas las tablas nuevas (org A no lee ni escribe datos de org B), verde en CI contra Postgres 16 real con roles sin privilegios

### Media

Pipeline de media: upload a Cloudflare R2, procesamiento sharp en el worker (BullMQ), variantes responsive y placeholders. Errores observables, nunca silenciados.

- [ ] **MEDIA-01**: upload de imágenes a Cloudflare R2 (vía API/presigned) con registro de la entidad en la tabla media (project, key del original)
- [ ] **MEDIA-02**: el worker procesa cada imagen con sharp generando variantes AVIF/WebP en múltiples tamaños (srcset) almacenadas en R2 y referenciadas desde media
- [ ] **MEDIA-03**: blurhash + dimensiones (width/height) calculados y persistidos en media para placeholders LQIP
- [ ] **MEDIA-04**: el job de procesamiento de media es idempotente, con reintentos y errores observables (Sentry + pino); un fallo no deja media en estado inconsistente
- [ ] **MEDIA-05**: helper/API que resuelve una media a su set de variantes (srcset + blurhash + dimensiones), consumible por web y panel

### Seed

Seed determinista y re-ejecutable del edificio ficticio realista, suficiente para poblar panel, web pública y futuras métricas.

- [ ] **SEED-01**: seed del edificio "Brigos Recoleta" ~13 pisos — organización, proyecto `publicado`, floors y units realistas (tipologías, m2, orientaciones, estados variados disponible/reservado/vendido)
- [ ] **SEED-02**: pricing realista — price_lists (contado USD / financiado), unit_prices, payment_plans con ajuste CAC, y cac_index con histórico de varios períodos
- [ ] **SEED-03**: contenido de ejemplo — progress_posts, galleries con media, brokers, y algunos leads/events para poblar panel y métricas
- [ ] **SEED-04**: `pnpm db:seed` es idempotente y re-ejecutable (no duplica filas en corridas sucesivas) y está documentado en el README/comandos

## v2 Requirements

Diferido a milestones futuros (fases posteriores del modelo-mvp). Tracked pero fuera de este roadmap.

### Quoting (Fase 3 / v1.2)

- **QUOT-01**: motor `packages/quoting` (funciones puras, cobertura 100%, property-based tests)
- **QUOT-02**: UI del cotizador + generación de PDF server-side + handoff a WhatsApp

### Explorador y ficha (Fase 2)

- **EXPL-01**: explorador del edificio por pisos con hotspots SVG sobre renders
- **EXPL-02**: ficha de unidad con realtime (SSE precios/estados)

## Out of Scope

Explícitamente excluido de v1.1. Documentado para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Motor de cotización (`packages/quoting`) | Es Fase 3; acá solo el schema de quotes/payment_plans/cac_index que el motor consumirá después |
| UI del explorador / ficha / panel CRUD | Fases 2 y 4; este milestone es data + media + seed, sin superficies de producto nuevas |
| Editor de hotspots, import Excel de unidades | Fase 4 (panel) |
| Scraping automático del CAC | modelo-mvp §3.3: carga manual mensual primero; scraping después |
| Procesamiento de video / pano360 stitching | El MVP usa pano360s pre-renderizados; no se procesan en el pipeline acá |
| Todo lo marcado `[B]` en modelo-mvp | Específico del design partner Pablo; espera su feedback (regla de corte A/B) |

## Traceability

Qué fases cubren qué requirements. Completado durante la creación del roadmap (2026-06-26).

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 | Phase 1 | Complete |
| SCHEMA-02 | Phase 1 | Complete |
| SCHEMA-03 | Phase 1 | Complete |
| SCHEMA-04 | Phase 1 | Complete |
| SCHEMA-05 | Phase 1 | Complete |
| SCHEMA-06 | Phase 1 | Complete |
| SCHEMA-07 | Phase 1 | Complete |
| SCHEMA-08 | Phase 1 | Complete |
| MEDIA-01 | Phase 2 | Pending |
| MEDIA-02 | Phase 2 | Pending |
| MEDIA-03 | Phase 2 | Pending |
| MEDIA-04 | Phase 2 | Pending |
| MEDIA-05 | Phase 2 | Pending |
| SEED-01 | Phase 3 | Pending |
| SEED-02 | Phase 3 | Pending |
| SEED-03 | Phase 3 | Pending |
| SEED-04 | Phase 3 | Pending |

**Coverage:**

- v1.1 requirements: 17 total
- Mapped to phases: 17 ✓ (Phase 1: 8 · Phase 2: 5 · Phase 3: 4)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-26*
*Last updated: 2026-06-26 — traceability completada al crear el roadmap (3 fases, 17/17 mapeados)*
