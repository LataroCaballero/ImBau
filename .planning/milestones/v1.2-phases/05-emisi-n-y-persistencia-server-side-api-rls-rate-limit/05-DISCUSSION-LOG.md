# Phase 5: Emisión y persistencia server-side (API + RLS + rate limit) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 5 - Emisión y persistencia server-side (API + RLS + rate limit)
**Areas discussed:** Compute vs persistencia, A1 vs A2 (pool app), CAC vigente y errores, Rate limit nginx — todas delegadas a Claude por el usuario

---

## Delegación global

Se presentaron 4 gray areas vía AskUserQuestion. El usuario respondió: *"Quiero que vos tomes las decisiones ya que son cosas muy técnicas que se escapan"* — delegación explícita y completa de las decisiones técnicas de la fase a Claude. Las elecciones quedan documentadas como D-01..D-13 en `05-CONTEXT.md`, fundadas en el research del milestone (confianza HIGH) y las convenciones validadas del proyecto.

## Compute vs persistencia

| Option | Description | Selected |
|--------|-------------|----------|
| Un solo procedure computa+persiste | Cada cómputo público escribe un snapshot | |
| Dos procedures: compute efímero + create persiste | "Emitida" = create (al accionar el comprador); compute interactivo no escribe | ✓ (Claude) |

**Rationale:** diseño del research (ARCHITECTURE.md) + Pitfall 6 (write-amplifier de spam, PII); QUOTE-02 se satisface para toda cotización *emitida*.

## A1 vs A2 — dónde vive el pool app

| Option | Description | Selected |
|--------|-------------|----------|
| A1: apps/web gana DATABASE_APP_URL + mount tRPC propio | Grep-fenced (solo withTenant/withAnon), amplía D-03 v1.1 | ✓ (Claude) |
| A2: el procedure vive en otra superficie | Evita darle pool app a web; agrega un hop/superficie | |

**Rationale:** A1 ya venía recomendado en STATE.md; el fence T-03-09 existente hace el riesgo verificable por grep. Se registra como Key Decision al cerrar la fase.

## CAC vigente y errores

| Option | Description | Selected |
|--------|-------------|----------|
| Vigente = mes calendario estricto | Falla si el mes corriente no está cargado | |
| Vigente = último período cargado (max periodo) | Compatible con publicación con rezago + carga manual | ✓ (Claude) |

**Rationale:** el CAC se publica con rezago y la ingesta es manual (COTIZ-F04 diferido). Errores: TRPCError semántico (PRECONDITION_FAILED / BAD_REQUEST) con mensaje es-AR + código de dominio; sin cutoff de staleness en MVP.

## Rate limit nginx

| Option | Description | Selected |
|--------|-------------|----------|
| Solo nginx limit_req | Zona per-IP, location ^~ /api/trpc/quotes en vhost web; 10r/s burst 20 punto de partida | ✓ (Claude) |
| nginx + token bucket Redis in-app | Defensa en profundidad, más piezas | (diferido) |

**Rationale:** QUOTE-03 pide edge; el vhost ya tiene el patrón pre-documentado. Verificación por UAT humano (burst curl → 429), prod intacto.

## Claude's Discretion

- Números finales de rate/burst; shape exacto del error tRPC; nombres/estructura del router; estrategia de tests; core compartido compute/create.

## Deferred Ideas

- Token bucket Redis in-app (defensa en profundidad)
- Enqueue del job PDF desde create → fase 7 (D-13: esta fase solo define el contrato en packages/storage)
- Creación de lead al accionar → milestone futuro (slot `quotes.leadId`)
- Ingesta automática CAC (COTIZ-F04) — ya trackeado
