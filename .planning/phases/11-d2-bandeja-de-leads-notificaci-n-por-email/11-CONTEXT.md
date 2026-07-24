# Phase 11: D2 — Bandeja de leads + notificación por email - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

El developer gestiona su bandeja de leads desde `proyectos/[id]/leads`: los ve con el origen resuelto por joins (broker / unidad / cotización), los mueve por el pipeline fijo de 4 estados (`nuevo → contactado → negociacion → cerrado`), agrega notas al timeline, y recibe un aviso por email **encolado (BullMQ) e idempotente** ante cada lead nuevo — nunca `await` inline en la mutación, nunca duplicado en reintentos/bulk. Superficie liviana (anti-CRM), independiente de D1, que clona el molde `requireRole`+`withTenant`+audit de Phase 10 y el contrato worker BullMQ + Resend de quote-pdf/invitation.

Requirements: LEADS-01, LEADS-02, LEADS-03, LEADS-04.

Reemplaza el cuerpo del placeholder `proyectos/[id]/leads/page.tsx` cableado en Phase 9 (contrato heredado: `params.id` validado, proyecto resuelto por RLS, layout de tabs montado). **NO** toca unidades (D1) ni hotspots (D2/Phase 12). Las SCs 1-3 corren sobre los 14 leads del seed; la captura pública real de leads (form anon en cotizador/ficha) queda **fuera** — es Fase-2.

</domain>

<decisions>
## Implementation Decisions

### Origen del lead nuevo — qué dispara el email (D-01) — DECISIÓN CRÍTICA
- **D-01:** El usuario delegó ("si lo construye una fase futura, se difiere; si no, se hace ahora"). Aplicado:
  - **Se construye ahora:** el *seam* de creación de lead = una mutación server-side que **inserta el lead + encola el email idempotente** (BullMQ, clonando el contrato `quote-pdf` + Resend de `send-invitation`). Es la pieza load-bearing de LEADS-04; Fase-2 la **reusa** montándole encima el form público (no se rehace).
  - **Caller real cableado ahora:** **alta manual desde el panel** (owner/developer, molde `requireRole("owner","developer")`+`withTenant`). El developer registra a mano un lead que le llegó por afuera (WhatsApp/llamada) y elige el origen (broker/unidad/cotización/directo). No lo cubre ninguna fase futura, es chico, y da un trigger real y verificable en UAT para SC-4.
  - **Se DIFIERE a Fase-2:** captura pública anon (form "dejá tus datos" en cotizador/ficha) y auto-lead desde emisión de cotización. **Motivo estructural:** el flujo de cotización v1.2 **no captura PII del comprador** (D-04 de v1.2 — solo `projectId/unitId/paymentPlanId/modalidad` cruzan el borde; el snapshot es "no buyer PII"), y `leads.nombre`/`leads.contacto` son `NOT NULL`. Un lead automático desde quote exigiría UI de captura de contacto pública = la captura pública de Fase-2 (D-11 de v1.1 ya difirió el endpoint anon + rate-limit a Fase-2).
- **Nota de idempotencia:** el schema `leads` ya tiene la policy `leads_anon_insert` (INSERT-only anon contra proyecto `publicado`) — el seam anon está listo a nivel DB para Fase-2. Re-correr el seed (14 leads en bulk) NUNCA debe spamear emails: el seed inserta por fuera del seam / el enqueue dedup por `jobId` lo garantiza (ver D-06).

### Pipeline (máquina de estados)
- **D-02:** Transiciones **libres entre los 4 estados** (`nuevo`/`contactado`/`negociacion`/`cerrado`), incl. retroceder y reabrir un `cerrado`. "Máquina de estados impuesta, sin estados libres" (SC-2) = el estado destino DEBE ser uno de los 4 valores del enum `lead_estado`, nunca un estado arbitrario/libre; NO significa lineal. Cada cambio deja rastro en el timeline (D-04).
- **D-03:** Al cerrar se **distingue ganado vs perdido**. Implementación mínima que NO rompe el pipeline fijo de 4 estados ni el enum existente: **columna nueva nullable `desenlace` (`ganado|perdido`)** en `leads` (migración Drizzle versionada), seteada al mover a `cerrado` (requerida en esa transición; se limpia/ignora fuera de `cerrado`). Cheap y forward-compatible para las métricas de conversión de **D4/fase 6** — mismo espíritu que capturar `events` en D1 aunque su consumidor sea futuro.

### Timeline y notas
- **D-04:** El timeline se llena de dos formas: **(a)** cada transición de estado **auto-agrega** una entrada (`estadoPrev → estadoNuevo`, campos que el `LeadNote` JSONB ya tiene) y **(b)** el developer suma **notas de texto libre**. `autor` = nombre/email del developer logueado (de `ctx.session`). El **JSONB `leads.timeline` (`LeadNote[]`) es la fuente de verdad** que renderiza la UI (orden por `ts`). **Además** cada transición emite a la tabla **`events`** para el audit trail uniforme (mismo patrón que D-02 de Phase 10). Notas y transiciones se persisten append-only en orden (SC-3).

### Email de notificación
- **D-05:** Destinatario = **email de notificación configurable por proyecto**. Implementación mínima (NO la superficie completa de configuración D5/fase 6): **columna nueva nullable `projects.leadsNotifyEmail`** (migración Drizzle) + extender el input de la mutación canary **`projects.updateSettings`** de Phase 9 con un `leadsNotifyEmail` opcional (Zod `.email()`) + un **campo mínimo** para editarlo en el panel. **Fallback si está vacío/null:** el/los `owner` de la org (resueltos por membership) — el aviso nunca se pierde silenciosamente.
- **D-06:** El email lo dispara **solo la creación de un lead** (LEADS-04: "ante cada lead nuevo"); transiciones de estado y notas **NO** notifican. **Idempotente** por `jobId = lead:{id}:created` (clona `quotePdfJobOptions(quoteId)` → jobId dedup). Nunca `await` inline en la mutación (el enqueue es el side-effect tras un persist exitoso, como `enqueuePdf` en `quotes.create`); reintentos, re-seed y bulk nunca duplican.
- **D-07:** Contenido = **template React Email es-AR voseo** clonando `packages/api/src/email/templates/invitation.tsx` + `send-invitation.ts`: nombre, contacto, origen resuelto (broker/unidad/cotización), proyecto, y **link directo a la bandeja del proyecto en el panel**. Resend real en staging (`INVITE_FROM`/preset env existente), **fallback consola en dev**.

### Forma de la bandeja (UI)
- **D-08:** Bandeja = **tablero kanban**: una columna por estado, cards de lead, mover un card entre columnas ejecuta la transición (encaja con las transiciones libres de D-02). Al soltar un card en `cerrado` se pide el `desenlace` ganado/perdido (D-03).
- **D-09:** Detalle = **drawer/panel lateral**: abrir un card muestra el timeline, "agregar nota" y "cambiar estado" sin salir de la bandeja (fluido para gestionar varios leads seguidos).
- **D-10:** Esta fase **sí lleva contrato de diseño**: se corre **`/gsd-ui-phase 11`** para producir un `11-UI-SPEC.md` **antes de planificar** (a diferencia de Phase 9/10 que fueron UI funcional sin design system). Es el próximo paso recomendado tras cerrar el contexto.

### Claude's Discretion
- Nombre/API concreta de las mutaciones (`leads.create`, `leads.updateEstado`, `leads.addNote`, etc.) y su granularidad — el planner elige siguiendo el molde de Phase 9/10.
- Nombre exacto de la columna de desenlace (`desenlace` vs `resultado` vs `outcome`) y si es enum PG o text validado por Zod — a criterio del planner/executor; requisito: nullable, no toca el enum `lead_estado`.
- Query de resolución de origen por joins (LEADS-01: broker/unidad/cotización) — el planner define la forma exacta del read (`leads.listForProject` con joins tenant-scoped).
- Filtros del kanban (por estado ya es implícito en columnas; por origen/broker opcional) y micro-layout de cards/drawer — al UI-SPEC (`/gsd-ui-phase 11`) y al executor.
- Cómo el seed evita el enqueue del email (insert directo vs bypass del seam) — al planner; requisito: re-seed no dispara emails.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y fase
- `.planning/ROADMAP.md` — Phase 11: goal + 4 success criteria + "UI hint: yes"; contexto de que D2 cuelga del shell de Phase 9 y clona el patrón de D1.
- `.planning/REQUIREMENTS.md` — LEADS-01 (bandeja con origen broker/unidad/cotización por joins), LEADS-02 (pipeline fijo 4 estados, máquina impuesta), LEADS-03 (notas al timeline en orden), LEADS-04 (email queued idempotente `lead:{id}:{event}`, nunca await inline ni duplica en bulk). Ver también Out of Scope: **CRM completo cortado** (sin pipelines configurables/scoring/routing/asignación).

### Schema de datos (leer antes de migración/mutaciones)
- `packages/db/src/schema/leads.ts` — tabla `leads` YA existe: RLS `leads_tenant` (owner/dev gestionan tenant-scoped) + `leads_anon_insert` (INSERT-only anon contra proyecto `publicado`, listo para Fase-2). Columnas: `nombre`/`contacto` NOT NULL, `origen` text, `unitId`/`brokerId`/`quoteId` nullable (composite-FK in-tenant), `estado` enum default `nuevo`, `timeline` JSONB `LeadNote[]` default `'[]'`. **Agregar aquí la columna `desenlace` (D-03).**
- `packages/db/src/schema/json-schemas.ts` — `leadNoteSchema`/`LeadNote` = `{ ts, autor?, nota, estadoPrev?, estadoNuevo? }` (la forma del timeline, D-04).
- `packages/db/src/schema/enums.ts` — `leadEstadoEnum` = `nuevo | contactado | negociacion | cerrado` (ASCII `negociacion`, sin acento). NO tocar este enum (D-03 usa columna aparte).
- `packages/db/src/schema/brokers.ts` — `brokers` (nombre/slug/whatsapp/email) para resolver origen=broker por join (LEADS-01).
- `packages/db/src/schema/projects.ts` — `projects` (`nombre`/`slug`/`estado`/`whatsapp`); **agregar `leadsNotifyEmail` nullable (D-05)**.
- `packages/db/src/schema/events.ts` — tabla `events` (particionada por mes) para el audit de transiciones (D-04).
- `packages/db/src/seed/content.ts` (L327+) + `packages/db/src/seed/content-rows.ts` — 14 leads seed en los 4 estados con timelines + brokers; dataset determinista para tests de bandeja/pipeline. El seed inserta leads sin disparar emails (D-01/D-06).

### Molde de escritura del panel (clonar, NO reinventar — Phase 9 / Phase 10)
- `.planning/phases/09-shell-del-panel-scoped-al-proyecto-role-gate/09-CONTEXT.md` — D-05/D-06: molde `requireRole("owner","developer")`+`withTenant`+`.returning()` 0-row → `NOT_FOUND`; matriz cross-rol vs Postgres real (owner✓/developer✓/viewer✗ 403/otra org✗). D-04: contrato del placeholder `leads/page.tsx` que D2 reemplaza. D-07: `notFound()` para proyecto no resuelto.
- `.planning/phases/10-d1-grilla-de-unidades-editable-import-export-excel/10-CONTEXT.md` — D-02: patrón de audit a `events` por transición; molde de las mutaciones + matriz de tests que D2 clona.
- `packages/api/src/trpc/middleware.ts` — `requireRole(...allowed)` (lookup del rol dentro de `withTenant`/RLS, FORBIDDEN si no permitido).
- `packages/api/src/trpc/routers/projects.ts` — `projects.updateSettings` (canary Phase 9, hoy setea solo `estado`) = el ejemplo canónico a **extender con `leadsNotifyEmail`** (D-05) y a clonar para las mutaciones de leads; `getForOrg` para resolver el proyecto scoped.
- `packages/api/src/trpc/routers/_app.ts` — registrar el nuevo `leadsRouter`.
- `packages/api/src/auth/access-control.ts` — roles owner/developer/viewer.
- `packages/api/src/trpc/init.ts` — `protectedProcedure`/`publicProcedure`, `ctx.activeOrgId`/`ctx.session` (para `autor` en D-04).

### Contrato worker BullMQ + email (clonar para el aviso de lead — D-06/D-07)
- `packages/storage/src/quote-pdf.ts` — `QUOTE_PDF_QUEUE` + `quotePdfJobOptions(quoteId)` (jobId dedup + attempts/backoff) = el molde exacto de la cola de email de lead (`jobId = lead:{id}:created`).
- `packages/api/src/quotes/runtime.ts` — `enqueuePdf` = el seam de enqueue (side-effect tras persist, no await inline en el router) a clonar.
- `packages/api/src/trpc/routers/quotes.ts` (L203-218) — patrón `insert.returning()` + enqueue como side-effect del persist exitoso.
- `apps/worker/src/index.ts` — registro de Workers (`createMediaWorker`/`createPartitionWorker` + `processX`/`reportXFailure`); el worker de email de lead se registra igual, con handler `failed` → Sentry + pino.
- `apps/worker/src/quote-pdf.ts` — `processQuotePdf` + `reportQuotePdfFailure` = forma del processor + reporte de fallo a clonar.
- `packages/api/src/email/send-invitation.ts` + `packages/api/src/email/templates/invitation.tsx` — dispatch Resend real + fallback consola en dev + template React Email es-AR = el molde del email de lead (D-07).
- `packages/config/env/presets.ts` (L72) — `INVITE_FROM` (sender Resend verificado); reusar/extender para el remitente del aviso de lead.

### Convenciones
- `CLAUDE.md` — RLS en toda tabla con tenant; TS estricto; migraciones Drizzle versionadas (nunca cambios manuales); errores observables (Sentry+pino), nunca silenciados; idioma código/commits inglés, UI/docs es-AR voseo; ramas `fase-N/descripcion`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`leads` schema + policies + `LeadNote` JSONB**: ya existen completos (tenant + anon INSERT-only); esta fase agrega solo la columna `desenlace` y construye router+UI encima. El seam anon a nivel DB ya está listo para Fase-2.
- **Email infra (Resend + React Email)**: `send-invitation.ts` + `invitation.tsx` + `INVITE_FROM` env — el aviso de lead es un clon directo (real en staging, consola en dev).
- **Contrato BullMQ quote-pdf**: `QUOTE_PDF_QUEUE`/`quotePdfJobOptions` + `enqueuePdf` seam + `processQuotePdf`/`reportQuotePdfFailure` + registro en `apps/worker/src/index.ts` — la cola de email de lead clona la molécula entera (jobId dedup = idempotencia de D-06).
- **Molde `requireRole`+`withTenant` (Phase 9/10)** y **matriz cross-rol vs Postgres real**: las mutaciones de leads (create/updateEstado/addNote) y `projects.updateSettings` extendida lo clonan; SC de autorización se cumple usando el molde, no creándolo.
- **14 leads seed en los 4 estados + brokers**: dataset determinista para tests de bandeja/pipeline/timeline y para verificar que re-seed NO dispara emails.

### Established Patterns
- **`withTenant` como único seam de escritura**: toda mutación scoped al proyecto pasa por `requireRole`+`withTenant(ctx.activeOrgId, ...)`; nunca `createOwnerDb`/`appDb` en routers de dominio.
- **Enqueue como side-effect tras persist, nunca await inline** (`quotes.create` → `enqueuePdf`): el email de lead sigue este patrón exacto (D-06).
- **Audit a `events` por transición** (Phase 10 D-02): las transiciones de estado del lead emiten a `events` además del timeline JSONB.
- **Idempotencia por `jobId` en BullMQ** (`quotePdfJobOptions(quoteId)`): `jobId = lead:{id}:created` garantiza no-duplicación en reintentos/bulk/re-seed.

### Integration Points
- Nuevo `leadsRouter` registrado en `packages/api/src/trpc/routers/_app.ts`; viaja al panel por type-safety (sin codegen).
- `projects.updateSettings` extendida con `leadsNotifyEmail` (D-05) — reusa la mutación canary de Phase 9.
- Migraciones Drizzle versionadas: `leads.desenlace` (D-03) + `projects.leadsNotifyEmail` (D-05).
- Nueva cola BullMQ de email de lead: definición en `packages/storage` + Worker en `apps/worker/src/index.ts` + enqueue seam en `packages/api`.
- Cuerpo del placeholder `apps/panel/app/.../proyectos/[id]/leads/page.tsx` reemplazado por el kanban + drawer (D-08/D-09).

</code_context>

<specifics>
## Specific Ideas

- Textos del email y de la UI en **es-AR voseo, tono del producto** (ej. asunto "Tenés un lead nuevo en {proyecto}").
- El kanban debe reflejar directamente el pipeline: mover un card = transición; soltar en `cerrado` pide ganado/perdido (D-03) antes de confirmar.
- El drawer del lead muestra el timeline en orden cronológico (transiciones + notas mezcladas por `ts`), con el autor visible.
- El fallback de destinatario (owners de la org) existe para que un lead nuevo nunca quede sin avisar aunque el proyecto no tenga `leadsNotifyEmail` cargado.

</specifics>

<deferred>
## Deferred Ideas

- **Captura pública anon de leads** (form "dejá tus datos" en cotizador/ficha + auto-lead desde emisión de cotización) → **Fase-2** (explorador+ficha). Bloqueado por la captura de PII pública; el schema (`leads_anon_insert`) y el seam de creación de esta fase ya lo dejan listo para montar encima. (D-01, D-11 de v1.1.)
- **Superficie completa de configuración del proyecto** (logo, colores, textos, formas de pago, brokers) → **D5/fase 6**. Esta fase solo adelanta el único campo load-bearing `leadsNotifyEmail` (D-05).
- **Métricas de conversión / analítica de leads** (ganados vs perdidos, ranking brokers, embudo) → **D4/fase 6**. Esta fase solo captura el flag `desenlace` (D-03), sin UI de analítica.
- **Email en cambios de estado / notas** — fuera (D-06 notifica solo lead nuevo). Candidato si aparece necesidad operativa.
- **Realtime de la bandeja** (SSE LISTEN/NOTIFY para leads en vivo) → RT-01 (fase 2, consumidor futuro).

### Reviewed Todos (not folded)
None — no había todos pendientes que matchearan el scope de la fase.

</deferred>

---

*Phase: 11-d2-bandeja-de-leads-notificaci-n-por-email*
*Context gathered: 2026-07-24*
