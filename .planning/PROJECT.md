# ImBau — Showroom 3D para preventa en pozo

## What This Is

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra, leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Lo construye Lautaro (Andescode) con desarrollo AI-first; el documento maestro de producto es `docs/modelo-mvp.md`.

**Estado actual:** **v1.0 Fundación (Fase 0)** SHIPPED 2026-06-26, **v1.1 Schema + Media + Seed (Fase 1)** SHIPPED 2026-07-01 y **v1.2 Cotizador (Fase 3 del plan maestro)** SHIPPED 2026-07-09 — sobre la fundación (staging vivo, CI/CD, auth, RLS), el modelo de datos completo y el seed "Brigos Recoleta", ahora el diferencial competitivo #1 funciona de punta a punta: motor de cotización puro al 100% de cobertura, emisión anónima server-side con snapshot auditable, UI pública mobile-first, PDF asíncrono en el worker y handoff a WhatsApp. Cada fase del modelo-mvp.md es su propio milestone GSD, en el orden ventana-Fable: 0 → 1 → 3 → 4 → 2 → 5 → 6.

## Core Value

La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging (`staging.tours.andescode.com.ar`) con aislamiento multi-tenant verificable por RLS — no "funciona en mi máquina".

## Current State

**v1.2 Cotizador shipped 2026-07-09** (4 fases, 19 plans, 43 tasks, 8 días). El flujo comprador demo-crítico existe completo: deep-link/picker → cotización contado vs financiado en vivo → CTA WhatsApp precargado → PDF descargable. Todo deriva de un único `QuoteResult` (`packages/quoting`, 100% cobertura + fast-check), el path anónimo es server-side auditado (cero policies anon sobre `quotes`/`cac_index`) y el PDF es asíncrono e idempotente (BullMQ + R2).

**Pendientes inmediatos post-cierre:**
- Merge de `fase-0/foundation` a `main` → deploy a staging (staging corre imagen pre-fase-5) + re-verificación en vivo: rate-limit 429, flujo PDF completo, QR con URL de staging.
- Pasada visual humana del cotizador en viewport real (06-UAT.md, diferido — `/gsd-verify-work 6`).

## Current Milestone: v1.3 Panel de autogestión

**Goal:** El developer administra su proyecto sin tocar código ni depender del operador: edita precios/estados de unidades (incl. import/export Excel), gestiona su bandeja de leads y dibuja los hotspots del edificio desde el panel — sobre la fundación auth/RLS existente y con todo v1.2 corriendo verificado en staging.

**Target features:**
- Deuda v1.2 primero: merge de `fase-0/foundation` a `main` → deploy a staging + re-verificación en vivo (rate-limit 429, flujo PDF completo, QR con URL de staging)
- D1 — Grilla de unidades: editar precio, estado y listas por forma de pago; import/export Excel (el formato en que los developers ya manejan sus datos)
- D2 — Bandeja de leads: origen (broker/unidad/cotización), estados nuevo → contactado → negociación → cerrado, aviso por email
- Editor de hotspots: polígonos SVG como datos, editor visual en el panel (habilita el explorador de fase 2)

**Fuera de este milestone (fase 6 del plan maestro):** métricas (D4), alertas de interés repetido (D6) y configuración/branding (D5).

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
- ✓ Deuda v1.2 saldada: todo v1.2 mergeado a `main` (merge commit `22d1e96`, historia + tag v1.2 preservados, D-01) y corriendo verificado en vivo en staging — Validated in Phase 8 (v1.3, DEBT-01/DEBT-02). UAT 5/5 (2026-07-17/20): burst anónimo 77×429 / 0×503 con vhost box==repo (D-12, sin sync-back), PDF e2e (quoteId `5d67277a`) Roboto embebida + acentos es-AR + deep-link a staging, smoke de superficies (web 200 / coti 200 / panel 307) + worker/Loki/Sentry sanos, deploy no-op verde, y **drill de migración fallida (T-4-MIGRATE, flagueado desde v1.0 y nunca drilleado en 3 milestones): migración rota → migrate-before-swap aborta bajo `set -e` sin swap, staging intacto sin downtime**. Security gate: 10/10 amenazas cerradas (08-SECURITY.md, threats_open:0).

### Active

Milestone **v1.3 Panel de autogestión** (fase 4 del plan maestro):

- [ ] D1 — Grilla de unidades: editar precio/estado/listas por forma de pago + import/export Excel
- [ ] D2 — Bandeja de leads: origen, estados nuevo/contactado/negociación/cerrado, aviso por email
- [ ] Editor de hotspots: polígonos SVG como datos con editor visual en el panel

### Out of Scope

- Todo lo marcado `[B]` en modelo-mvp.md — específico del design partner Pablo; no se construye hasta tener su feedback (regla de corte A/B)
- Fases 1-6 del plan maestro (schema completo, media, cotizador, panel, explorador, portada, métricas) — son milestones GSD futuros, no parte de v1
- Motores 3D tipo game engine — decisión de producto: renders estáticos + 360 + transiciones dan 90% de la percepción con 10% del costo
- Cambio de terminaciones, modo día/noche, reserva online con pagos, API/SDK, CRM completo, apps nativas/VR, producción de renders — fuera del MVP explícitamente (modelo-mvp.md §2.2)
- PocketBase u otros atajos de prototipo — el código es la carta de presentación; estándar SaaS profesional desde el día uno

## Context

- **Estado del código (post v1.2):** monorepo con 3 apps + 6 packages compilando estricto; v1.2 agregó +9.4k LOC de código en 86 archivos (156 commits, 8 días). Sobre el schema/media/seed de v1.1 ahora corren: `packages/quoting` (motor puro, 100% cobertura), rutas `quotes.*`/`picker.*` en `packages/api`, el cotizador público en `apps/web` (`/p/[slug]/cotizador`, Tailwind v4 + tokens de marca) y el pipeline quote-pdf en `apps/worker`. Staging vivo en `staging.tours.andescode.com.ar` (web) y `panel.staging.tours.andescode.com.ar` (panel) detrás de nginx-host + certbot — **corre imagen pre-fase-5**: todo v1.2 llega a staging al mergear a `main`. Timeline por milestone: fase 0 en 14 días (infra real domina), v1.1 en 5 días, v1.2 en 8 días (código puro + superficies).
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
| A1 — apps/web hosts the app pool for the anonymous quote path (Phase 5 / D-06): DATABASE_APP_URL en el env de web + mount tRPC propio; web deja de ser anon-only SOLO vía withTenant dentro de quotesRouter | El pool app ya llegaba al contenedor web por env_file; A2 (emisión en panel/API dedicada) agregaba un hop cross-app sin ganancia de aislamiento real — el fence T-03-09 (solo withTenant/withAnon/schema desde @imbau/db, grep-verificable) mantiene la superficie de datos idéntica | ✓ Good — validado e2e con la UI de fase 6 (Playwright 4/4 contra seed real); re-verificación en staging post-merge pendiente |
| Dual `splitLink` en el cliente tRPC de web (Phase 6): `quotes.*` va a `/api/trpc/quotes.*` (path nginx-throttleado), el resto al endpoint general; formatters es-AR compartidos del motor (cero `toLocaleString` en UI) | El rate-limit de borde solo protege si el cliente enruta las quotes por el path limitado; el formato server/cliente no puede divergir si ambos usan las mismas funciones puras | ✓ Good — split probado por test de predicado + e2e; es-AR idéntico en RSC, isla cliente, WhatsApp y PDF |
| PDF asíncrono (Phase 7): producer BullMQ dentro del proceso web (quotes.create encola; D-02) + poll `quotes.pdfStatus` con presigned R2 GET + soft-fail ~40s en UI (D-10); Roboto TTF como asset copiado explícito en la imagen Alpine (tsup no emite TTFs) | El PDF nunca es critical path — WhatsApp sigue vivo pase lo que pase; jobId=quoteId da idempotencia at-least-once en retries; sin el COPY de assets react-pdf cae a una fuente sin glifos es-AR (tofu silencioso) | ✓ Good — UAT 3/3 (2026-07-08): e2e local R2 real, soft-fail 40.1s, PDF del contenedor Alpine con acentos perfectos; staging pendiente post-merge |
| Drill de migración fallida sobre staging (Phase 8 / T-4-MIGRATE): branch descartable con migración `SELECT 1/0` → `workflow_dispatch` → observar abort sin swap por SSH → limpieza; recovery innecesario (el box nunca sale del estado bueno) | El invariante migrate-before-swap estaba flagueado desde v1.0 y nunca se había ejercitado en 3 milestones; el migrator de drizzle corre cada migración en transacción → una migración rota hace rollback sin DDL parcial y `set -e` aborta antes del swap, con blast radius contenido a staging (D-04/D-08) | ✓ Good — drilleado en vivo 2026-07-20: migrate exit≠0, cero swap (web/panel/worker intactos en `22d1e96`), DB en 5 migraciones, superficies sin downtime |

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
*Last updated: 2026-07-20 after Phase 8 (Deuda v1.2 saldada: merge a main + re-verificación en vivo en staging, incl. drill migrate-before-swap T-4-MIGRATE; security 10/10). Sigue Phase 9 (shell del panel scoped + role gate).*
