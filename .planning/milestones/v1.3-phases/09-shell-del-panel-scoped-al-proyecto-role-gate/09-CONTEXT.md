# Phase 9: Shell del panel scoped al proyecto + role gate - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

El prerrequisito estructural único sobre el que cuelgan las tres superficies de escritura del panel (D1 grilla, D2 leads, hotspots). Entrega: un layout `proyectos/[id]` con tabs (unidades / leads / hotspots) scoped al proyecto de la org activa vía RLS, más el gate de escritura owner/developer impuesto en el servidor y probado por una matriz de tests cross-rol contra Postgres real.

Hoy el panel es un dashboard único en `/` sin ninguna ruta scoped al proyecto. Esta fase construye el **shell y el molde de autorización**, NO las superficies de unidades/leads/hotspots (fases 10/11/12) — cada tab queda cableada con placeholder + seam para que la fase siguiente solo reemplace el cuerpo.

Requirements: PANEL-01, PANEL-02.

</domain>

<decisions>
## Implementation Decisions

### Routing y navegación
- **D-01:** Tabs como **sub-rutas reales** de App Router: `proyectos/[id]/unidades`, `proyectos/[id]/leads`, `proyectos/[id]/hotspots`. Un layout compartido (`proyectos/[id]/layout.tsx`) monta la barra de tabs y resuelve el proyecto una vez; cada tab es su propio segmento/RSC. URLs deep-linkeables y compartibles; D1/D2/hotspots cuelgan de su segmento natural sin re-cablear el shell.
- **D-02:** `proyectos/[id]` (índice) **redirige a la tab por defecto = `unidades`**. No hay una "vista de proyecto" separada de las tabs.

### Convivencia con el dashboard actual
- **D-03:** `/` sigue siendo el **home/selector**: lista los proyectos de la org activa (ya lo hace vía `projects.listForOrg` → RLS) y cada proyecto linkea a `proyectos/[id]`. Se **mantiene el bloque de invitación de miembros** (owner-only, `InviteForm`) que ya vive en el dashboard. Cero pérdida de lo existente; es la entrada natural al shell scoped.

### Contrato del shell vacío (seam para D1/D2/hotspots)
- **D-04:** Cada segmento de tab existe con su **`page.tsx` real** (RSC que ya resuelve el proyecto scoped por RLS y valida `params.id`) pero renderiza un **placeholder es-AR** (ej. "Grilla de unidades — próximamente"). El contrato que heredan las fases siguientes — `params.id` validado, proyecto ya resuelto en contexto, layout de tabs montado — queda **cableado hoy**; D1/D2/hotspots reemplazan únicamente el cuerpo del placeholder. Esto prueba SC-1 y SC-2 de punta a punta ya en esta fase.

### Gate de rol — cómo se prueba (SC-3)
- **D-05:** Se agrega **UNA mutación canary REAL y útil**, no descartable: `projects.updateSettings` (ej. renombrar el proyecto / cambiar `estado` borrador↔publicado — el planner define el campo concreto mínimo), protegida por `requireRole("owner","developer")` sobre `withTenant`. **Queda en producción** y es el **molde exacto** que D1/D2/hotspots clonan (patrón `withTenant` + `requireRole` de escritura del panel = SC-4).
- **D-06:** La **matriz de tests cross-rol corre contra esta mutación con Postgres real**: `owner`✓ / `developer`✓ / `viewer`✗ (403 FORBIDDEN) / usuario de otra org✗ (aislamiento por RLS/tenant). Ejercita el path completo RSC→caller→RLS, no solo "UI oculta". Sigue el patrón de los tests cross-tenant existentes contra Postgres real en CI.

### Resolución de proyecto no encontrado / cross-org (SC-2)
- **D-07:** Si la resolución del proyecto por RLS (org activa) **no devuelve la fila**, el RSC llama **`notFound()` (404)** — mismo comportamiento para "no existe" y "existe pero es de otra org". **No-enumeración**: no se revela la existencia de proyectos de otras orgs. Alineado con que RLS ya lo hace invisible; no se distingue 403 de 404 en esta superficie.

### Experiencia del viewer (read-only)
- **D-08:** El **viewer entra al shell completo** y navega las 3 tabs en modo lectura; los **botones/acciones de escritura no se renderizan** para su rol (gating de UI). El **servidor sigue siendo la fuente de verdad**: si un viewer intenta mutar igual, `requireRole` devuelve 403. Defensa en profundidad = UI oculta + gate server-side (nunca solo UI).

### Claude's Discretion
- Campo concreto que muta `projects.updateSettings` (nombre vs estado vs ambos, mínimo viable) — el planner elige el más simple que sea real y útil.
- Estilo visual del shell/tabs: **sin design system esta fase** (patrón establecido en el panel; UI funcional es-AR voseo). Un `/gsd-ui-phase 9` opcional puede correrse aparte si se quiere contrato de diseño.
- Micro-decisiones de layout (posición de la barra de tabs, breadcrumb al selector, indicador de tab activa) quedan a criterio del executor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y fase
- `.planning/ROADMAP.md` — Phase 9: goal, 4 success criteria, "UI hint: yes"; contexto de que D1/D2/hotspots cuelgan de este shell
- `.planning/REQUIREMENTS.md` — PANEL-01 (layout `proyectos/[id]` con tabs scoped a la org), PANEL-02 (mutaciones exigen owner/developer, verificado por matriz cross-rol, no solo UI)

### Primitivos de autorización ya existentes (reusar, no reinventar)
- `packages/api/src/trpc/middleware.ts` — `requireRole(...allowed)` ya implementado: lee `member.role` de la org activa dentro de `withTenant` (RLS), throw FORBIDDEN si el rol no está permitido. **El molde de la mutación canary y de D1/D2/hotspots.**
- `packages/api/src/auth/access-control.ts` — roles `owner`/`developer`/`viewer` y statement `project: [read,create,update,delete]`; developer sin delete, viewer solo read
- `packages/api/src/trpc/routers/projects.ts` — `projects.listForOrg` (protected, `withTenant`→RLS, sin orgId de cliente) que SC-1 reusa para resolver proyectos de la org activa
- `packages/api/src/trpc/init.ts` — `protectedProcedure` / `publicProcedure` y `ctx.activeOrgId` / `ctx.session`
- `packages/api/src/trpc/routers/_app.ts` — donde se registra el nuevo `projects.updateSettings`

### Superficie actual del panel a extender
- `apps/panel/app/(dashboard)/page.tsx` — dashboard RSC actual (`/`): patrón `createCaller` + `listForOrg` + catch UNAUTHORIZED/FORBIDDEN→redirect(`/login`); a extender como selector con links a `proyectos/[id]`
- `apps/panel/app/(dashboard)/invite-form.tsx` — island owner-only a preservar en `/`
- `apps/panel/lib/trpc-client.tsx` (`TRPCReactProvider`) — provider para islands cliente

### Convención de datos y despliegue
- `CLAUDE.md` — RLS en toda tabla con tenant; TS estricto; idioma código/commits inglés, UI/docs es-AR voseo; ramas `fase-N/descripcion`
- `.planning/phases/08-.../08-CONTEXT.md` (D-03) — el trabajo de v1.3 arranca en rama nueva `fase-4/panel` desde `main` post-merge

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`requireRole` middleware** (`middleware.ts`): existe y ya escala sobre `protectedProcedure` con lookup RLS-scoped del rol. La mutación canary de esta fase lo aplica tal cual; SC-4 ("patrón reutilizable establecido") se cumple usándolo, no creándolo.
- **`projects.listForOrg`** (`projects.ts`): resuelve proyectos de la org activa por RLS sin confiar en orgId de cliente. El shell lo usa para el selector `/` y para resolver `proyectos/[id]` (filtrar por id sobre las filas que RLS devuelve).
- **Patrón RSC del dashboard** (`(dashboard)/page.tsx`): `createCaller({ headers })` + catch `TRPCError` UNAUTHORIZED/FORBIDDEN → `redirect("/login")`, re-throw del resto. El layout de `proyectos/[id]` clona este patrón y añade `notFound()` cuando el proyecto no resuelve.
- **Tests cross-tenant contra Postgres real** (patrón v1.0/v1.1 en CI): la matriz cross-rol de esta fase sigue esa forma (roles NOSUPERUSER/NOBYPASSRLS, aserciones de ausencia).

### Established Patterns
- **App Router route groups**: el dashboard vive en `(dashboard)` (no afecta URL). `proyectos/[id]/...` son segmentos con URL real; layout compartido resuelve el proyecto una vez.
- **Sin design system esta fase**: UI funcional mínima es-AR voseo (patrón explícito del dashboard actual).
- **`withTenant` como único seam de escritura**: toda mutación scoped al proyecto pasa por `requireRole` + `withTenant(ctx.activeOrgId, ...)`; nunca `createOwnerDb`/`appDb` en routers de dominio (grep-verificado en fases previas).

### Integration Points
- `projects.updateSettings` se registra en `_app.ts` y viaja al cliente panel por type-safety (sin codegen).
- El shell `proyectos/[id]` se monta en `apps/panel/app/` como nuevo árbol de segmentos, enlazado desde el selector `/`.
- La org activa viene de la sesión (`ctx.activeOrgId`); no se introduce switcher de org en esta fase (deferido).

</code_context>

<specifics>
## Specific Ideas

- Placeholders de tab en es-AR voseo, tono del producto (ej. "Grilla de unidades — próximamente", "Bandeja de leads — próximamente", "Editor de hotspots — próximamente").
- La mutación canary debe ser **real y con valor**, no un `noop` — es el molde que copian tres fases; que sea el ejemplo canónico de "mutación de escritura del panel bien hecha".

</specifics>

<deferred>
## Deferred Ideas

- **Org switcher en el shell** — cambiar de org activa desde el panel. Fuera de alcance de Phase 9 (la org activa se toma de sesión); candidato a fase de configuración/branding (D5, fase 6 del plan maestro) o a un ajuste posterior si aparece la necesidad.
- **Contrato de diseño / design system del panel** — `/gsd-ui-phase 9` opcional aparte; esta fase usa UI funcional sin sistema de diseño.
- **Breadcrumbs / navegación global rica** — más allá del link selector→proyecto y la barra de tabs, a criterio del executor; no es un requisito de la fase.

None — la discusión se mantuvo dentro del alcance del shell.

</deferred>

---

*Phase: 9-shell-del-panel-scoped-al-proyecto-role-gate*
*Context gathered: 2026-07-21*
