# ImBau — Showroom 3D para preventa en pozo

## What This Is

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo: un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra, leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers). Lo construye Lautaro (Andescode) con desarrollo AI-first; el documento maestro de producto es `docs/modelo-mvp.md`.

**Este ciclo GSD (milestone v1) cubre únicamente la fase 0 del plan maestro:** monorepo, CI/CD, Docker Compose + staging, observabilidad, y auth + multi-tenancy + RLS. Cada fase del modelo-mvp.md será su propio milestone GSD, en el orden ventana-Fable: 0 → 1 → 3 → 4 → 2 → 5 → 6.

## Core Value

La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging (`staging.tours.andescode.com.ar`) con aislamiento multi-tenant verificable por RLS — no "funciona en mi máquina".

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Monorepo pnpm + Turborepo operativo con apps (`web`, `panel`, `worker`) y packages (`db`, `api`, `quoting`, `ui`, `config`) esqueleto
- [ ] TypeScript estricto + lint + type-check + tests corriendo en CI (GitHub Actions); CI roja = no merge
- [ ] Docker Compose con Postgres 16, Redis y servicios locales levantando con un comando
- [ ] Better Auth funcionando: sesiones, organizaciones, memberships con roles (owner/developer/viewer), invitaciones por email
- [ ] Multi-tenancy con RLS en Postgres: organizations → projects, policies por tenant, rol `anon` limitado a proyectos `publicado`
- [ ] Migraciones versionadas con Drizzle (nunca cambios manuales al schema)
- [ ] Deploy automático a staging en cada merge a main (build de imágenes Docker → registry → VPS con Traefik + TLS)
- [ ] Observabilidad desde el primer deploy: Sentry, logs estructurados (pino) → Grafana/Loki, Uptime Kuma

### Out of Scope

- Todo lo marcado `[B]` en modelo-mvp.md — específico del design partner Pablo; no se construye hasta tener su feedback (regla de corte A/B)
- Fases 1-6 del plan maestro (schema completo, media, cotizador, panel, explorador, portada, métricas) — son milestones GSD futuros, no parte de v1
- Motores 3D tipo game engine — decisión de producto: renders estáticos + 360 + transiciones dan 90% de la percepción con 10% del costo
- Cambio de terminaciones, modo día/noche, reserva online con pagos, API/SDK, CRM completo, apps nativas/VR, producción de renders — fuera del MVP explícitamente (modelo-mvp.md §2.2)
- PocketBase u otros atajos de prototipo — el código es la carta de presentación; estándar SaaS profesional desde el día uno

## Context

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
| Cada fase de modelo-mvp.md = un milestone GSD; v1 = solo fase 0 | Cortes verticales, cada fase termina desplegada y demostrable; permite validar la estimación AI-first en fase 0 antes de comprometer el resto | — Pending |
| Roadmap GSD espeja modelo-mvp.md (orden ventana-Fable 0→1→3→4→2→5→6) | El doc maestro ya tiene fases estimadas y validadas contra la estrategia; no se re-deriva estructura | — Pending |
| Renders estáticos + hotspots SVG, sin motor 3D | Decisión de producto: 90% de la percepción con 10% del costo, carga instantánea en móvil (lección anti-Hauzd) | — Pending |
| Estándar SaaS profesional desde día uno (se descarta PocketBase) | Multi-tenancy real, migraciones versionadas y techo de escala; el código es la carta de presentación | — Pending |
| Regla de corte A/B | Solo se construye lo `[A]` (table stakes + cotizador); lo `[B]` espera el feedback de Pablo — validar antes de construir | — Pending |

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
*Last updated: 2026-06-12 after initialization*
