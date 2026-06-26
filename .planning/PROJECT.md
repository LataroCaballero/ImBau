# ImBau — Showroom 3D para preventa en pozo

## What This Is

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra, leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Lo construye Lautaro (Andescode) con desarrollo AI-first; el documento maestro de producto es `docs/modelo-mvp.md`.

**Estado actual:** el milestone **v1.0 Fundación (Fase 0)** está SHIPPED (2026-06-26) — monorepo, CI/CD, Docker Compose + staging vivo, observabilidad, y auth + multi-tenancy + RLS, todo desplegado y operable en `staging.tours.andescode.com.ar`. Cada fase del modelo-mvp.md es su propio milestone GSD, en el orden ventana-Fable: 0 → 1 → 3 → 4 → 2 → 5 → 6. **Próximo:** v1.1 (Fase 1 — schema completo + media + seed).

## Core Value

La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging (`staging.tours.andescode.com.ar`) con aislamiento multi-tenant verificable por RLS — no "funciona en mi máquina".

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

### Active

Próximo milestone — **v1.1 Fase 1 (Schema + Media + Seed)**. Se concreta con `/gsd-new-milestone`:

- [ ] Schema completo de modelo-mvp.md §3.3 (floors, units, price_lists, unit_prices, payment_plans, cac_index, quotes, brokers, leads, progress_posts, galleries, media, events) con RLS y migraciones Drizzle
- [ ] Pipeline de media: R2 + sharp + blurhash, variantes AVIF/WebP con srcset, procesadas en el worker
- [ ] Seed del edificio ficticio ~13 pisos estilo "Brigos Recoleta" con unidades, listas de precios y planes de pago realistas

### Out of Scope

- Todo lo marcado `[B]` en modelo-mvp.md — específico del design partner Pablo; no se construye hasta tener su feedback (regla de corte A/B)
- Fases 1-6 del plan maestro (schema completo, media, cotizador, panel, explorador, portada, métricas) — son milestones GSD futuros, no parte de v1
- Motores 3D tipo game engine — decisión de producto: renders estáticos + 360 + transiciones dan 90% de la percepción con 10% del costo
- Cambio de terminaciones, modo día/noche, reserva online con pagos, API/SDK, CRM completo, apps nativas/VR, producción de renders — fuera del MVP explícitamente (modelo-mvp.md §2.2)
- PocketBase u otros atajos de prototipo — el código es la carta de presentación; estándar SaaS profesional desde el día uno

## Context

- **Estado del código (post v1.0):** ~682 archivos, monorepo con 3 apps + 5 packages compilando estricto. Staging vivo en `staging.tours.andescode.com.ar` (web) y `panel.staging.tours.andescode.com.ar` (panel) detrás de nginx-host + certbot. Fase 0 entregada en 14 días calendario (vs. estimación 3-4 días con Fable; el grueso fue infra de staging real sobre un VPS compartido con prod).
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
*Last updated: 2026-06-26 after v1.0 Fundación (Fase 0) milestone. 4 phases / 18 plans / 39 tasks shipped; staging vivo y operable en `staging.tours.andescode.com.ar` con RLS multi-tenant verificado en CI. 24/24 requirements validados. Next: v1.1 (Fase 1 — schema + media + seed) vía `/gsd-new-milestone`.*
