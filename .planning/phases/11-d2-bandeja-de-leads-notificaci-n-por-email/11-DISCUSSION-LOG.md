# Phase 11: D2 — Bandeja de leads + notificación por email - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 11-d2-bandeja-de-leads-notificaci-n-por-email
**Areas discussed:** Origen del lead nuevo, Pipeline + timeline, Email: destinatarios, Forma de la bandeja (UI)

---

## Origen del lead nuevo (crítica)

Nudo: LEADS-04 exige email ante lead nuevo, pero nada crea leads en producción hoy (endpoint anon diferido a Fase-2; la cotización no crea lead y no captura PII).

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Cotización crea lead | Al emitir cotización se inserta lead origen=cotización. **Inviable:** el flujo no captura nombre/contacto (D-04 v1.2). | |
| Alta manual en el panel | Developer carga a mano un lead que llegó por afuera. | ✓ (caller) |
| Form anon en cotizador | Mini-form público que inserta lead vía policy anon (adelanta Fase-2). | |
| Solo seam + test | Construir seam+email+idempotencia, probar por test, sin caller de producción. | ✓ (seam) |

**User's choice:** "si lo vamos a construir en una próxima fase lo diferimos, sino lo vamos haciendo, decidilo vos." → Delegado a Claude.
**Notes:** Decisión aplicada (D-01): construir el seam de creación + email idempotente ahora (Fase-2 lo reusa), cablear alta manual en el panel como caller real, y diferir captura pública + auto-lead desde cotización a Fase-2 (bloqueado por PII pública). Verificado en código que `quotes.create` no captura PII y que `leads.nombre`/`contacto` son NOT NULL.

---

## Pipeline + timeline

| Pregunta | Opción elegida | Alternativas |
|----------|----------------|--------------|
| Transiciones | **Libres entre los 4** | Forward + una reversa / Forward-only estricto |
| 'cerrado' ganado/perdido | **Distinguir ganado/perdido** | Único terminal |
| Timeline fuente | **Auto + notas, JSONB fuente (+ events)** | Auto + notas sin events / Solo notas manuales |

**User's choice:** Transiciones libres; distinguir ganado/perdido; timeline auto+notas con JSONB como fuente y emisión a events.
**Notes:** Ganado/perdido se implementa como columna nullable `desenlace` (no toca el enum `lead_estado` ni rompe los 4 estados fijos) — D-03. Forward-compatible para métricas de D4/fase 6.

---

## Email: destinatarios

| Pregunta | Opción elegida | Alternativas |
|----------|----------------|--------------|
| Destinatarios | **Dirección configurable** | Owner/developer de la org / Solo el owner |
| Trigger + no-duplicación | **Solo lead nuevo, key created** | Nuevo + cambios de estado |
| Contenido | **Datos + link, clon invitation** | Mínimo (aviso + link) / Lo decidís vos |

**User's choice:** Dirección configurable; solo lead nuevo con idempotencia `lead:{id}:created`; contenido con datos + link clonando invitation.
**Notes:** Configurable se implementa mínimo (D-05): columna `projects.leadsNotifyEmail` + extender `projects.updateSettings` (canary de Phase 9) + campo mínimo de edición; fallback a owners de la org si está vacío (no pulls toda la config de D5/fase 6).

---

## Forma de la bandeja (UI)

| Pregunta | Opción elegida | Alternativas |
|----------|----------------|--------------|
| Layout | **Tablero kanban** | Lista/tabla con filtros |
| Detalle | **Panel/drawer lateral** | Página de detalle / Fila expandible |
| Contrato de diseño | **Sí, /gsd-ui-phase 11** | No, UI funcional |

**User's choice:** Kanban + drawer lateral + correr /gsd-ui-phase 11 antes de planificar.
**Notes:** Override del patrón "sin design system" de Phase 9/10 — esta fase sí lleva UI-SPEC. Kanban encaja con las transiciones libres (D-02): mover card = transición.

---

## Claude's Discretion

- Nombres/API de las mutaciones de leads y granularidad.
- Nombre/tipo exacto de la columna `desenlace`.
- Forma del read con joins para resolver origen (LEADS-01).
- Filtros del kanban y micro-layout (al UI-SPEC/executor).
- Cómo el seed evita el enqueue del email.

## Deferred Ideas

- Captura pública anon de leads + auto-lead desde cotización → Fase-2.
- Superficie completa de configuración del proyecto → D5/fase 6.
- Métricas de conversión / analítica de leads → D4/fase 6.
- Email en cambios de estado/notas → fuera de scope.
- Realtime de la bandeja (SSE) → RT-01, fase 2.
