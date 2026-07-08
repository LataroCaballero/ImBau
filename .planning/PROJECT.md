# ImBau — Showroom 3D para preventa en pozo

## What This Is

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra, leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Lo construye Lautaro (Andescode) con desarrollo AI-first; el documento maestro de producto es `docs/modelo-mvp.md`.

**Estado actual:** **v1.0 Fundación (Fase 0)** SHIPPED 2026-06-26 y **v1.1 Schema + Media + Seed (Fase 1)** SHIPPED 2026-07-01 — sobre la fundación (staging vivo, CI/CD, auth, RLS) ahora existe el modelo de datos completo de modelo-mvp §3.3 con RLS por tenant, el pipeline de media R2 + sharp + blurhash, y el seed determinista de "Brigos Recoleta" poblando todo. Cada fase del modelo-mvp.md es su propio milestone GSD, en el orden ventana-Fable: 0 → 1 → 3 → 4 → 2 → 5 → 6. **En curso:** v1.2 Cotizador (Fase 3 del plan maestro).

## Core Value

La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging (`staging.tours.andescode.com.ar`) con aislamiento multi-tenant verificable por RLS — no "funciona en mi máquina".

## Current Milestone: v1.2 Cotizador (Fase 3 del plan maestro)

**Goal:** El diferencial competitivo #1 funciona de punta a punta: un comprador cotiza una unidad (contado USD / anticipo + cuotas CAC / refuerzos), ve el resultado en pantalla, descarga el PDF y abre WhatsApp con la cotización precargada — con un motor de cálculo puro al 100% de cobertura donde un error de cálculo mata el producto.

**Target features (P4 de modelo-mvp.md, todo rama A):**
- `packages/quoting` — motor puro y determinista (sin I/O), tipado exhaustivo, property-based tests + unitarios, cobertura 100% exigida en CI. Entrada: unidad + lista de precios + plan de pago + índice CAC vigente. Salida: estructura tipada que alimenta UI, PDF y texto WhatsApp.
- UI del cotizador en la web pública (mobile-first): contado USD / anticipo + cuotas ajustadas por CAC / refuerzos, resultado en pantalla.
- PDF server-side generado en el worker (con leyenda legal "cotización no vinculante").
- CTA WhatsApp (wa.me) con la cotización precargada.
- Persistencia del snapshot completo de cada cotización emitida (inputs + outputs + versión del motor) — auditabilidad total.

**Por qué ahora:** orden ventana-Fable (0 → 1 → **3** → 4 → 2 → 5 → 6) — el cotizador es la fase más densa en lógica pura, ideal para front-loadear mientras dura el acceso al modelo. Es además el diferencial competitivo #1 (nadie resuelve bien la financiación argentina). Consume el schema de quotes/payment_plans/cac_index y el seed "Brigos Recoleta" de v1.1 sin cambios de schema previstos.

## Requirements

### Validated

- ✓ Monorepo pnpm + Turborepo con apps (`web`, `panel`, `worker`) y packages (`db`, `api`, `quoting`, `ui`, `config`) — v1.0 (PROC-01, MONO-01/02/03). Build de punta a punta, config compartida `@imbau/config`, env tipado con fail-fast.
- ✓ TypeScript estricto + lint + type-check + tests en CI (GitHub Actions); CI roja = no merge — v1.0 (CI-01). Gate `quality` con branch-protection en `main`.
- ✓ Docker Compose con Postgres 16 + Redis levantando con un comando — v1.0 (DATA-01).
- ✓ Better Auth: sesiones, organizaciones, memberships con roles owner/developer/viewer, invitaciones por email (Resend/React Email) — v1.0 (AUTH-01/02/03).
- ✓ Multi-tenancy con RLS en Postgres (organizations → projects, policies por tenant, `anon` solo `publicado`), demostrado por tests de ausencia cross-tenant en CI contra Postgres real — v1.0 (DATA-03/04, CI-02).
- ✓ Migraciones versionadas con Drizzle (nunca `push` ni cambios manuales) — v1.0 (DATA-02).
- ✓ Deploy automático a staging en cada merge a main (build 4 imágenes Docker → GHCR → VPS, migrate-before-swap) — v1.0 (INFRA-02, CI-03). Nota: TLS vía nginx-host + certbot, no Traefik (D-01).
- ✓ Observabilidad desde el primer deploy: Sentry (incl. `onRequestError` RSC), pino → Grafana/Loki, Uptime Kuma — v1.0 (OBS-01/02/03).
- ✓ App surfaces: panel (login + dashboard RLS), web (anon published-only), worker (BullMQ shell), Dockerfiles multi-stage — v1.0 (APP-01/02/03/04).
- ✓ Secrets cifrados en repo (SOPS/age) con separación por entorno — v1.0 (INFRA-03).
- ✓ Schema completo de modelo-mvp.md §3.3 (13 tablas nuevas) con RLS FORCE por tenant y migraciones Drizzle versionadas (0002_domain + 0003_rls_domain), events particionada, suite cross-tenant verde en CI — v1.1 Phase 1 (SCHEMA-01..08).
- ✓ Pipeline de media: upload a R2 + worker sharp (variantes AVIF/WebP srcset + blurhash/dims) persistido en `media`, idempotente con reintentos y errores observables (Sentry + pino), resoluble por web/panel — v1.1 Phase 2 (MEDIA-01..05). 68/68 tests automatizados verde; round-trip live-R2 + observabilidad de fallo confirmados en UAT staging (2026-06-30).
- ✓ Seed determinista e idempotente del edificio ficticio "Brigos Recoleta" (13 pisos, 38 unidades, 2 listas de precios USD, planes CAC con refuerzos, 3 brokers, 14 leads con timeline, galerías/obra, 18 events en ≥2 particiones mensuales) — v1.1 Phase 3 (SEED-01..04). Media por el pipeline real R2+worker con mediaId determinista; gate run-twice de invariancia de filas + RLS-correctness; UAT live-R2 2/2 verde (2026-07-01: 13/13 media con variants+blurhash+dims, segunda corrida sin filas nuevas).
- ✓ Motor de cotización `packages/quoting` puro, determinista y sin I/O: `calcQuote` (contado + financiado CAC con anticipo half-up, última cuota absorbe resto, ARS "al valor del mes"), `QuoteResult` tipado único, `compareQuotes`, serializers `toWhatsAppText`/`toPdfModel`, `QuoteError` tipado (7 códigos) y `ENGINE_VERSION` alineado al snapshot — Validated in Phase 4 (v1.2, ENGINE-01..06). 62 tests (unit + fast-check properties), gate de cobertura 100% enforced (`vitest run --coverage`), verificación 5/5 must-haves (2026-07-03).
- ✓ Emisión y persistencia server-side del cotizador: `quotes.compute` / `quotes.create` como publicProcedures anónimos (resolución de org vía `withAnon` desde el proyecto publicado — el cliente nunca manda orgId), snapshot versionado `{version: ENGINE_VERSION, inputs, result, cacPeriodo}` persistido bajo `withTenant`, errorFormatter que solo expone `quoteErrorCode` (D-08), mount tRPC en `apps/web` con fence T-03-09 intacto (A1/D-06), y rate-limit de borde nginx `rate=10r/s + burst=20 nodelay + 429` en staging — Validated in Phase 5 (v1.2, QUOTE-01..03). 9 tests de router contra Postgres real (happy paths + negativos + pruebas RLS 42501); UAT QUOTE-03 en staging VPS: ráfaga de 40 POSTs → 29 pasan / 11× 429, cero 503 (2026-07-04).
- ✓ PDF asíncrono de la cotización en el worker: `quotes.create` encola `quote-pdf` en BullMQ (jobId=quoteId → dedup at-least-once, attempts 5 + backoff exponencial), el processor del worker re-renderiza desde el snapshot congelado bajo `withTenant` (`toPdfModel` del motor), react-pdf con Roboto TTF embebida (assets copiados explícitos a la imagen Alpine — tsup no emite TTFs; sin tofu), sube a R2 (`quotes/{org}/{project}/{quoteId}.pdf`) y persiste `pdf_key`; `quotes.pdfStatus` publicProcedure devuelve presigned GET con `Content-Disposition: attachment`; en la UI el botón "Descargar PDF" emite/reusa el quoteId compartido con WhatsApp, pollea cada 2s por el link `quotes.*` dedicado (nginx-throttled) y auto-descarga, con soft-fail a ~40s que nunca bloquea el CTA WhatsApp — Validated in Phase 7 (v1.2, PDF-01..03). UAT 3/3 (2026-07-08): e2e local con R2 real (descarga a los 3s, header/leyendas/QR/deep-link verificados), soft-fail a los 40.1s exactos, imagen Alpine build + PDF renderizado en contenedor inspeccionado (Roboto embebida, acentos correctos). Re-verificación en staging pendiente post-merge.
- ✓ UI pública del cotizador + CTA WhatsApp: `/p/[slug]/cotizador` mobile-first (RSC + isla cliente) con deep-link `?u=&plan=` y picker piso→unidad sobre unidades publicadas (router `picker` anon RLS-safe incl. `projects.whatsapp` nueva columna, migración 0004), resultado completo contado vs financiado (dos corridas del motor, primera cuota ARS, refuerzos, totales), slider snap-to-preset (nunca términos libres), leyenda CAC + "no vinculante", formato es-AR vía `formatUsd`/`formatArs` compartidos (cero `toLocaleString` en UI), dual `splitLink` que mantiene `quotes.*` bajo el path nginx-throttleado, y CTA wa.me precargado desde `toWhatsAppText` con guard sin-número — Validated in Phase 6 (v1.2, UI-01..06, WA-01). 26 unit/render + 5 integration + e2e Playwright 4/4 en corrida independiente post-merge contra seed Brigos Recoleta (2026-07-05). Pendiente no bloqueante: pasada visual de marca en viewport real (06-UAT.md).

### Active

Milestone **v1.2 Cotizador** — requirements en definición (ver `.planning/REQUIREMENTS.md` cuando exista):

- [x] UI del cotizador en la web pública (contado USD / anticipo + cuotas CAC / refuerzos) — Validated in Phase 6
- [x] PDF server-side de la cotización en el worker (leyenda "cotización no vinculante") — Validated in Phase 7
- [x] CTA WhatsApp con la cotización precargada — Validated in Phase 6

### Out of Scope

- Todo lo marcado `[B]` en modelo-mvp.md — específico del design partner Pablo; no se construye hasta tener su feedback (regla de corte A/B)
- Fases 1-6 del plan maestro (schema completo, media, cotizador, panel, explorador, portada, métricas) — son milestones GSD futuros, no parte de v1
- Motores 3D tipo game engine — decisión de producto: renders estáticos + 360 + transiciones dan 90% de la percepción con 10% del costo
- Cambio de terminaciones, modo día/noche, reserva online con pagos, API/SDK, CRM completo, apps nativas/VR, producción de renders — fuera del MVP explícitamente (modelo-mvp.md §2.2)
- PocketBase u otros atajos de prototipo — el código es la carta de presentación; estándar SaaS profesional desde el día uno

## Context

- **Estado del código (post v1.1):** monorepo con 3 apps + 6 packages (se sumó `@imbau/storage`) compilando estricto; v1.1 agregó +17.8k LOC en 204 archivos (94 commits, 5 días). Schema §3.3 completo (13 tablas nuevas, events particionada), pipeline de media R2+sharp operativo, seed "Brigos Recoleta" idempotente. Staging vivo en `staging.tours.andescode.com.ar` (web) y `panel.staging.tours.andescode.com.ar` (panel) detrás de nginx-host + certbot. Fase 0 entregada en 14 días calendario (vs. estimación 3-4 días con Fable; el grueso fue infra de staging real sobre un VPS compartido con prod); Fase 1 (v1.1) entregada en 5 días.
- **Reverse proxy en staging — nginx, no Traefik (D-01):** el VPS de staging comparte caja con `andescode.com.ar` (prod), cuyo nginx-host ya posee :80/:443. Meter Traefik habría requerido reconfigurar el proxy de prod (riesgo real). Se entregó con nginx-vhost + certbot webroot; el patrón Traefik del CLAUDE.md queda diferido a un box dedicado. Actualizar CLAUDE.md/modelo-mvp.md si esta topología persiste en prod.
- **Documento maestro:** `docs/modelo-mvp.md` (junio 2026). Ante conflicto con él, manda `CLAUDE.md`.
- **Estrategia de dos ramas:** Rama A (núcleo agnóstico, arranca ya, table stakes + cotizador) / Rama B (material real de Pablo, post-reunión). La reunión con Pablo conviene tenerla al final de la fase 2-3 (~3-4 semanas) con la demo wow lista.
- **Competidores:** Urbania3D, Hauzd, Web3D. Diferenciales: entrega en semanas (no meses), cotizador financiero argentino (nadie lo resuelve bien), alertas de interés accionables.
- **Ventana Fable:** el acceso al modelo es temporal — se front-loadean las fases densas en código (0, 1, 3, 4) y se deja para después lo que depende de ojo humano (pulido visual, QA mobile, contenido).
- **Regla de control de fase 0:** si toma más de una semana, recalibrar todo el plan antes de seguir. Estimación con Fable: 3-4 días.
- **Seed de desarrollo:** edificio ficticio ~13 pisos estilo "Brigos Recoleta" (se carga en fase 1, no en este milestone).
- **Infra existente:** VPS personal compartido para staging (`staging.tours.andescode.com.ar`; `andescode.com.ar` queda intacto). Prod tendrá VPS dedicado desde el primer cliente pago.

## Constraints

- **Tech stack**: Decidido y no negociable salvo bloqueo real — monorepo pnpm + Turborepo, Next.js App Router (RSC/ISR), tRPC + Zod, PostgreSQL 16 + Drizzle (RLS), Better Auth, BullMQ + Redis, Cloudflare R2 + sharp, SSE vía LISTEN/NOTIFY, Vitest + Playwright, Sentry + OTel + pino, Docker Compose + Traefik, GitHub Actions.
- **Calidad**: TypeScript estricto sin `any` injustificado; todo cambio pasa lint + type-check + tests antes de commit; RLS en toda tabla con tenant; errores observables, nunca silenciados. NO negociable.
- **Performance**: <3s en 4G en gama media; presupuesto de peso por página y Lighthouse budget en CI (aplica desde que haya web pública).
- **Idioma**: código, identificadores y commits en inglés; UI y docs en español (es-AR, voseo).
- **Convenciones**: Conventional Commits; ramas `fase-N/descripcion`; dinero en enteros/decimal (nunca floats), USD enteros para precios, ARS para cuotas; UTC en DB, render en America/Argentina/Buenos_Aires.
- **Timeline**: fase 0 estimada en 3-4 días con Fable; regla de control si supera la semana.
- **Presupuesto**: staging ~USD 0 sobre infra existente; free tiers de Sentry/Resend suficientes para el MVP.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cada fase de modelo-mvp.md = un milestone GSD; v1 = solo fase 0 | Cortes verticales, cada fase termina desplegada y demostrable; permite validar la estimación AI-first en fase 0 antes de comprometer el resto | ✓ Good — v1.0 entregó fase 0 completa y desplegada; el modelo se sostiene para v1.1 |
| Roadmap GSD espeja modelo-mvp.md (orden ventana-Fable 0→1→3→4→2→5→6) | El doc maestro ya tiene fases estimadas y validadas contra la estrategia; no se re-deriva estructura | ✓ Good — v1.0 siguió el orden sin fricción |
| Renders estáticos + hotspots SVG, sin motor 3D | Decisión de producto: 90% de la percepción con 10% del costo, carga instantánea en móvil (lección anti-Hauzd) | — Pending (se ejercita en fases 1-2) |
| Estándar SaaS profesional desde día uno (se descarta PocketBase) | Multi-tenancy real, migraciones versionadas y techo de escala; el código es la carta de presentación | ✓ Good — RLS FORCE + migraciones Drizzle + tests de ausencia cross-tenant en CI, sin atajos |
| Regla de corte A/B | Solo se construye lo `[A]` (table stakes + cotizador); lo `[B]` espera el feedback de Pablo — validar antes de construir | — Pending (recién relevante con contenido real, fase 1+) |
| RLS: GUC transaction-scoped (`SET LOCAL`) + roles app/anon sin BYPASSRLS, owner pool separado para Better Auth (A1) | Aislamiento impuesto por DB, no por código de app; pooling-safe; el adapter de auth escribe tablas RLS-FORCED vía owner pool | ✓ Good — v1.0 probado por suite de ausencia cross-tenant verde en CI contra Postgres real |
| Staging detrás de nginx-host + certbot en vez de Traefik (D-01) | VPS de staging comparte caja con prod (`andescode.com.ar`), cuyo nginx ya posee :80/:443; Traefik habría arriesgado la config de prod | ⚠️ Revisit — funciona para staging; reevaluar Traefik en box dedicado para prod / dominios custom por CNAME |
| pino-loki transport en vez de Promtail (D-03/04) | Cero contenedor extra, fallback-simétrico vía swap de `LOKI_URL` | ✓ Good — logs del worker llegando a Loki en staging |
| Media pipeline: R2 con `WHEN_REQUIRED` checksum opt-out + mock-S3 in-memory en CI, live-R2 como gate humano (Phase 2 / D6) | R2 rechaza los checksums por defecto del SDK S3; CI no toca infra real (sin secrets en repo), pero el round-trip live se verifica en UAT staging | ✓ Good — 68/68 tests verde con mock; UAT live-R2 + observabilidad de fallo confirmados 2026-06-30 |
| Seed: idempotencia por `seedId(name)=uuidv5` + `onConflictDoNothing`, media por pipeline REAL R2+worker con mediaId determinista (Phase 3 / D-04) | Un solo mecanismo de idempotencia para todas las tablas; el seed re-compone los primitivos de @imbau/storage (sin importar @imbau/api — evita ciclo db↔api) y una re-corrida sobreescribe los mismos objetos R2 en lugar de duplicar | ✓ Good — gate run-twice de invariancia verde; UAT live-R2 2/2 (13/13 media resueltas, segunda corrida sin filas nuevas) |
| A1 — apps/web hosts the app pool for the anonymous quote path (Phase 5 / D-06): DATABASE_APP_URL en el env de web + mount tRPC propio; web deja de ser anon-only SOLO vía withTenant dentro de quotesRouter | El pool app ya llegaba al contenedor web por env_file; A2 (emisión en panel/API dedicada) agregaba un hop cross-app sin ganancia de aislamiento real — el fence T-03-09 (solo withTenant/withAnon/schema desde @imbau/db, grep-verificable) mantiene la superficie de datos idéntica | — Pending (se valida con la UI de fase 6 en staging) |
| PDF asíncrono (Phase 7): producer BullMQ dentro del proceso web (quotes.create encola; D-02) + poll `quotes.pdfStatus` con presigned R2 GET + soft-fail ~40s en UI (D-10); Roboto TTF como asset copiado explícito en la imagen Alpine (tsup no emite TTFs) | El PDF nunca es critical path — WhatsApp sigue vivo pase lo que pase; jobId=quoteId da idempotencia at-least-once en retries; sin el COPY de assets react-pdf cae a una fuente sin glifos es-AR (tofu silencioso) | ✓ Good — UAT 3/3 (2026-07-08): e2e local R2 real, soft-fail 40.1s, PDF del contenedor Alpine con acentos perfectos; staging pendiente post-merge |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-08 after Phase 7 (v1.2 Cotizador, PDF asíncrono en el worker): PDF-01..03 validados — quotes.create encola BullMQ, worker renderiza react-pdf (Roboto embebida, Alpine-safe), R2 + presigned download, UI poll + soft-fail 40s sin bloquear WhatsApp. UAT 3/3 (e2e local R2 real + contenedor Alpine verificado). **Milestone v1.2 100% — 4/4 fases.** Pendientes al cierre: merge a main + re-verificación en staging (rate-limit 429, flujo PDF), pasada visual de marca (06-UAT.md).*
