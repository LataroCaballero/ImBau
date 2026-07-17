# Phase 1: Schema completo + RLS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 1-Schema completo + RLS
**Areas discussed:** Tenant scoping, Particionado de events, Insert anónimo leads/events, JSONB tipado + alcance quotes

---

## Selección de áreas

| Option | Description | Selected |
|--------|-------------|----------|
| Tenant scoping de tablas | organization_id denormalizado vs join vía projects | (delegado) |
| Particionado de events | DDL a mano / job / pg_partman / create-on-demand | (delegado) |
| Insert anónimo leads/events | policy WITH CHECK anon + ubicación del rate-limit | (delegado) |
| JSONB tipado + alcance quotes | Zod/$type vs jsonb suelto; cuánto bloquear de quotes | (delegado) |

**User's choice:** "No tengo tanto conocimiento, tomá vos cuidadosamente todas las decisiones como sean más óptimas."
**Notes:** El usuario delegó explícitamente las cuatro áreas al builder. Son decisiones de arquitectura/implementación de schema y RLS — dominio del builder según la filosofía de discuss-phase. Se tomaron las opciones óptimas alineadas con el patrón RLS heredado de v1.0 y con el estándar de calidad NO negociable de CLAUDE.md, documentadas con fundamento en CONTEXT.md (D-01..D-16) para que researcher y planner las ejecuten.

---

## Claude's Discretion

Las cuatro áreas se resolvieron por discreción del builder bajo delegación explícita:

- **Tenant scoping (D-01..D-03):** `organization_id` denormalizado en cada tabla con policy plana clon de `projects_tenant`; consistencia garantizada por FKs compuestas `(id, organization_id)`. Se descartó el join vía projects (subconsulta correlacionada + acoplamiento de policies).
- **Particionado de events (D-04..D-07):** RANGE por mes vía SQL a mano en el journal Drizzle + DEFAULT partition + job repetible de BullMQ en el worker. Se descartó pg_partman (extensión innecesaria a escala MVP).
- **Insert anónimo (D-08..D-11):** anon INSERT-only (sin SELECT) en leads/events, WITH CHECK publicado-only, Zod en el boundary; rate-limit NO en esta fase (sin endpoint aún) → nginx/Redis cuando exista la superficie (nota D-01 nginx, no Traefik).
- **JSONB + quotes (D-12..D-13):** todo JSONB tipado con `$type` + Zod; `quotes.snapshot` como envelope versionado (`version: 1`) que bloquea el sobre sin fijar la forma interna del cálculo (la posee Fase 3 sin re-migrar).
- **Dinero/enums (D-14..D-15)** y **suite de aislamiento (D-16):** pineados según CLAUDE.md y el patrón de tests heredado.

El researcher debe re-verificar todas estas decisiones contra las versiones pineadas del stack y señalar conflictos en RESEARCH.md en lugar de silenciarlos.

## Deferred Ideas

- Endpoints/API de ingestión anónima + su rate-limit (nginx/Redis) — Fase 2+.
- Retención/detach de particiones viejas de events — posterior.
- Motor de cotización y forma interna de quotes.snapshot — Fase 3.
- Pipeline de media (R2 + sharp + blurhash) — Fase 2 (acá solo la tabla media).
- Seed "Brigos Recoleta" — Fase 3.
- Scraping automático del CAC — carga manual primero (modelo-mvp §3.3).
