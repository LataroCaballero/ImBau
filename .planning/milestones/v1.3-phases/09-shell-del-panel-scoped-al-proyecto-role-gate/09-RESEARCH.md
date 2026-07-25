# Phase 9: Shell del panel scoped al proyecto + role gate - Research

**Researched:** 2026-07-21
**Domain:** Next.js 16 App Router nested layouts (RSC) + tRPC v11 write-authorization gate + Postgres RLS cross-role integration testing
**Confidence:** HIGH (todo el material load-bearing es código existente del repo, leído directamente esta sesión)

## Summary

Esta fase no introduce ninguna dependencia nueva ni tecnología nueva: es un ejercicio de **composición de primitivos ya construidos y probados** en v1.0. Los cuatro pilares — `protectedProcedure` (auth + active-org derivado del server), `requireRole(...allowed)` (gate de rol dentro de `withTenant`/RLS), `projects.listForOrg` (lectura RLS-scoped), y el patrón RSC `createCaller({ headers })` — existen y funcionan. El trabajo real es (a) montar el árbol de segmentos App Router `proyectos/[id]/{unidades,leads,hotspots}` con un layout compartido que resuelve el proyecto una vez, (b) agregar UNA mutación canary `projects.updateSettings` que aplica el molde `protectedProcedure`→`requireRole("owner","developer")`→`withTenant` de escritura del panel, y (c) extender la matriz de tests cross-tenant existente (`packages/api/tests/trpc-tenant.test.ts`) a una matriz cross-ROL contra Postgres real.

Hay exactamente **tres detalles de corrección no obvios** que el planner debe cablear explícitamente o el gate se rompe en silencio: (1) un `UPDATE` bajo RLS sobre una fila invisible (proyecto de otra org) **afecta 0 filas sin lanzar error** — el resolver DEBE chequear `.returning()` y lanzar `NOT_FOUND` para cumplir D-07 (no-enumeración); (2) `params.id` llega como string arbitrario y compararlo contra una columna `uuid` con formato inválido lanza un error Postgres `22P02` (→ 500 en vez de 404) — hay que validar el formato UUID antes de la query y hacer `notFound()` si no es válido; (3) en Next 16 `params` es un **Promise** (`await params`) tanto en layout como en page — ya se ve en `apps/panel/app/accept-invitation/[id]/page.tsx`.

El shell prueba SC-1/SC-2 de punta a punta con placeholders es-AR; la mutación canary + la matriz cross-rol prueban SC-3/SC-4. El gate server-side es la fuente de verdad; el ocultamiento del botón de escritura al viewer (D-08) es defensa en profundidad, nunca la única barrera.

**Primary recommendation:** Clonar el patrón RSC de `(dashboard)/page.tsx` en un `proyectos/[id]/layout.tsx` que resuelve el proyecto vía un nuevo `projects.getForOrg({ id })` RLS-scoped (más barato y honesto que filtrar `listForOrg`), envuelto en React `cache()` en el boundary del panel para dedupe entre layout y page hijas. Agregar `projects.updateSettings` que mute `estado` (borrador↔publicado) — real, útil, visible en el selector `/` y en la web pública anon — protegida por `requireRole("owner","developer")` sobre `withTenant`, con guarda `.returning().length===0 → NOT_FOUND`. Extender `trpc-tenant.test.ts` con un helper `mintMemberInOrg(org, role)` y correr la matriz owner✓/developer✓/viewer✗(FORBIDDEN)/otra-org✗(NOT_FOUND) contra el caller real.

## Project Constraints (from CLAUDE.md)

- **TypeScript estricto sin `any`** injustificado (`strict: true`, `noUncheckedIndexedAccess: true`). Cualquier `any` requiere comentario justificando.
- **RLS en toda tabla con tenant**: la mutación scoped al proyecto pasa SIEMPRE por `withTenant(ctx.activeOrgId, ...)`; **nunca** `createOwnerDb`/`appDb` directo en routers de dominio (grep-verificado en fases previas — `T-03-09`).
- **RLS prueba aislamiento de tenant, NO autorización** (STATE.md, Carry v1.0/A1): las mutaciones del panel necesitan `requireRole` explícito además de RLS.
- Idioma: código/identificadores/commits en **inglés**; UI/placeholders/docs en **es-AR voseo**.
- Conventional Commits; rama `fase-4/panel` (v1.3 arranca en rama nueva desde `main` post-merge — 08-CONTEXT D-03).
- Todo cambio pasa **lint + type-check + tests** antes de commit; CI roja = no merge.
- Testing: **Vitest** (integración contra Postgres real `_test`) + **Playwright** (e2e). Nunca correr tests como superuser/BYPASSRLS.
- Sin design system esta fase (UI funcional mínima es-AR); UI-SPEC deferido explícitamente.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Tabs como **sub-rutas reales** de App Router: `proyectos/[id]/unidades`, `proyectos/[id]/leads`, `proyectos/[id]/hotspots`. Un layout compartido (`proyectos/[id]/layout.tsx`) monta la barra de tabs y **resuelve el proyecto una vez**; cada tab es su propio segmento/RSC.
- **D-02:** `proyectos/[id]` (índice) **redirige a la tab por defecto = `unidades`**. No hay "vista de proyecto" separada de las tabs.
- **D-03:** `/` sigue siendo el **home/selector**: lista proyectos de la org activa vía `projects.listForOrg`→RLS; cada proyecto linkea a `proyectos/[id]`. Se **mantiene el bloque `InviteForm`** (owner-only). Cero pérdida de lo existente.
- **D-04:** Cada segmento de tab tiene su **`page.tsx` real** (RSC que resuelve el proyecto scoped por RLS y valida `params.id`) pero renderiza un **placeholder es-AR** (ej. "Grilla de unidades — próximamente"). El contrato que heredan D1/D2/hotspots — `params.id` validado, proyecto ya resuelto, layout de tabs montado — queda cableado hoy; las fases siguientes reemplazan solo el cuerpo del placeholder.
- **D-05:** UNA mutación canary REAL y útil: `projects.updateSettings` (renombrar / cambiar `estado` borrador↔publicado — el planner define el campo concreto mínimo), protegida por `requireRole("owner","developer")` sobre `withTenant`. **Queda en producción** y es el molde exacto que D1/D2/hotspots clonan.
- **D-06:** Matriz de tests cross-rol contra Postgres real: `owner`✓ / `developer`✓ / `viewer`✗ (403 FORBIDDEN) / usuario de otra org✗ (aislamiento por RLS/tenant). Ejercita RSC→caller→RLS. Sigue el patrón de los tests cross-tenant existentes.
- **D-07:** Proyecto no resuelto por RLS (org activa) → RSC llama **`notFound()` (404)** — mismo comportamiento para "no existe" y "es de otra org". **No-enumeración**: no se distingue 403 de 404 en esta superficie.
- **D-08:** El **viewer entra al shell completo** (3 tabs, lectura); los **botones de escritura no se renderizan** para su rol (gating UI). El **servidor es la fuente de verdad**: si un viewer intenta mutar igual, `requireRole` devuelve 403. Defensa en profundidad = UI oculta + gate server-side.

### Claude's Discretion
- Campo concreto que muta `projects.updateSettings` (nombre vs estado vs ambos, mínimo viable) — el planner elige el más simple que sea real y útil.
- Estilo visual del shell/tabs: **sin design system esta fase** (UI funcional es-AR voseo).
- Micro-decisiones de layout: posición de la barra de tabs, breadcrumb al selector, indicador de tab activa — a criterio del executor.

### Deferred Ideas (OUT OF SCOPE)
- **Org switcher** en el shell (cambiar org activa desde el panel). La org activa se toma de sesión; candidato a fase de configuración/branding (D5) posterior.
- **Contrato de diseño / design system del panel** — `/gsd-ui-phase 9` opcional aparte.
- **Breadcrumbs / navegación global rica** — más allá del link selector→proyecto y la barra de tabs.
- **El contenido real de grilla / leads / hotspots** (fases 10/11/12). Esta fase NO investiga ni planifica esas superficies.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PANEL-01 | Developer navega a `proyectos/[id]` y ve un layout con tabs (unidades, leads, hotspots) scoped al proyecto de su org | Árbol de segmentos App Router + `proyectos/[id]/layout.tsx` que resuelve el proyecto vía `projects.getForOrg`→RLS (Pattern 1/2); redirect índice→`unidades` (Pattern 1); placeholders es-AR con `page.tsx` real por tab (D-04). SC-1/SC-2 probados por navegación RSC deep-link + aserción `notFound()` cross-org. |
| PANEL-02 | Toda mutación del panel exige rol owner/developer (viewer solo lectura) — verificado por matriz de tests cross-rol, no solo UI | Mutación canary `projects.updateSettings` = `requireRole("owner","developer")` sobre `withTenant` (Pattern 3); matriz cross-rol contra Postgres real extendiendo `trpc-tenant.test.ts` (Pattern 4). SC-3/SC-4. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resolución del proyecto scoped a la org activa | API / Backend (tRPC `projects.getForOrg` → `withTenant` → RLS) | Frontend Server (RSC layout invoca el caller) | La autoridad de tenant vive server-side (`ctx.activeOrgId` de sesión); el RSC solo consume. Nunca resolver el proyecto en el browser. |
| `notFound()` 404 no-enumeración (cross-org / inexistente) | Frontend Server (RSC layout/page) | API (RLS deja la fila invisible → 0 filas) | El RSC traduce "0 filas RLS" a `notFound()`; la política RLS es la que hace invisible la fila de otra org. |
| Gate de escritura owner/developer | API / Backend (`requireRole` middleware sobre `protectedProcedure`, dentro de `withTenant`) | Browser/Client (oculta el botón — D-08, defensa en profundidad) | Autorización = server-side, fuente de verdad. UI gating es cosmético; nunca la única barrera. |
| Mutación `projects.updateSettings` (UPDATE con RLS) | API / Backend (tRPC + `withTenant` transacción) | Database (política `projects_tenant` `using`/`withCheck`) | El UPDATE corre como `app_authenticated`; `withCheck` impide mover la fila a otra org; `.returning()` vacío = cross-org → `NOT_FOUND`. |
| Navegación entre tabs / indicador de tab activa | Browser/Client (island `usePathname`) | Frontend Server (Links server-side) | El estado "tab activa" es puramente de cliente (URL actual). Todo lo demás (resolución, gating) es server-side. |
| Rol del usuario para gating UI (D-08) | API / Backend (query RLS-scoped del `member.role`) | Frontend Server (RSC pasa el rol como prop al island) | El rol sale de `member.role` bajo RLS; el RSC lo resuelve y lo baja al island por prop. |

## Standard Stack

**No hay stack net-new en esta fase.** Toda la tecnología ya está instalada, pinneada y verificada en el repo. Se listan las versiones vigentes (leídas de `apps/panel/package.json` y `packages/*/package.json` esta sesión) sólo para fijar el contexto del planner.

### Core (ya instalado — reusar, no re-instalar)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | `16.2.9` | App Router RSC (panel) — nested layouts, `redirect`, `notFound`, async `params` | [VERIFIED: apps/panel/package.json] Ya en uso; `accept-invitation/[id]` prueba el patrón `params: Promise<>`. |
| react / react-dom | `19.2.7` | RSC + islands cliente | [VERIFIED: apps/panel/package.json] `cache()` disponible para dedupe de resolución. |
| @trpc/server + @trpc/client + @trpc/tanstack-react-query | `11.x` | Router tipado + caller server-side + islands | [VERIFIED: packages/api, apps/panel] `createCaller`, `requireRole`, `useTRPC` ya operativos. |
| zod | `4.4.3` | Validación de input de la mutación + `params.id` (UUID) | [VERIFIED: packages/api/package.json] Boundary validation del canary. |
| drizzle-orm | `0.45.x` | UPDATE con RLS (`withTenant` tx) | [VERIFIED: packages/db] `.returning()` es clave para la guarda cross-org. |
| drizzle-zod | `0.8.3` | Derivar el input schema de `projects` sin duplicar | [VERIFIED: packages/db/package.json] Ya se usa en `quotes.ts`/`leads.ts` (`createInsertSchema`). Opcional para el canary. |
| better-auth | `1.6.x` | Sesión + `activeOrganizationId` + `member.role` | [VERIFIED: packages/api] Fuente del tenant y del rol. |
| postgres (porsager) | `3.4.x` | Driver del app pool | [VERIFIED: packages/db] `withTenant` corre sobre el app pool NOSUPERUSER/NOBYPASSRLS. |
| vitest | `4.x` | Matriz cross-rol contra Postgres real | [VERIFIED: packages/api/vitest.config.ts] `globalSetup` verifica DB `_test`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nuevo `projects.getForOrg({ id })` RLS-scoped | Filtrar `projects.listForOrg()` por `id` en el RSC | `listForOrg` trae TODAS las filas de la org y filtra en app-layer — funciona hoy (pocas filas) pero es O(n) en red y no expresa "resolvé este proyecto". `getForOrg` con `where id = $1` bajo RLS es más honesto, más barato y es el contrato que D1/D2/hotspots quieren heredar. **Recomendado: agregar `getForOrg`.** |
| Query tRPC `member.myRole`/`org.activeMemberRole` para el gating UI | `auth.api.getActiveMember({ headers })` de Better Auth | La query tRPC RLS-scoped es consistente con el codebase y testeable con el mismo harness; `getActiveMember` [ASSUMED] existe pero acopla el panel a un endpoint del plugin no verificado esta sesión. **Recomendado: query tRPC.** |
| Mutar `estado` (borrador↔publicado) | Mutar `nombre` (rename) | Ambos reales. `nombre` es el más simple (un `text`); `estado` es **más útil y visible** (publicar/despublicar cambia la visibilidad anon en la web pública — efecto observable end-to-end) pero toca una superficie pública. Ver "Canary field decision" abajo. |

**Installation:** N/A — cero dependencias net-new. La verificación de versiones se hizo leyendo los `package.json` del repo, no la red.

## Package Legitimacy Audit

**N/A — esta fase no instala ningún paquete externo.** Todo el código nuevo compone primitivos ya presentes en `@imbau/api`, `@imbau/db`, `apps/panel`. No hay superficie de slopsquat/hallucination.

- Packages removed due to [SLOP] verdict: none
- Packages flagged as suspicious [SUS]: none

## Architecture Patterns

### System Architecture Diagram

```
                         Browser (viewer / developer / owner)
                                       │
                                       │  GET /proyectos/{id}/unidades   (deep-link)
                                       ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  apps/panel  ·  Next 16 App Router                                 │
        │                                                                    │
        │  proyectos/[id]/layout.tsx  (RSC)                                  │
        │    1. await params → id                                            │
        │    2. z.uuid().safeParse(id) ─ inválido → notFound() (evita 22P02) │
        │    3. createCaller({ headers }) → projects.getForOrg({ id })       │
        │         │  (React cache() dedupe: layout + page hijas 1 sola vez)  │
        │         ▼                                                          │
        │       proyecto | null                                             │
        │    4. null → notFound()  (D-07: cross-org == inexistente)         │
        │    5. resolver rol (member.myRole) → gating UI (D-08)             │
        │    6. render <TabBar/> (island usePathname) + {children}          │
        │                                                                    │
        │    proyectos/[id]/page.tsx  → redirect("./unidades")  (D-02)      │
        │    proyectos/[id]/{unidades,leads,hotspots}/page.tsx  (RSC)       │
        │        re-resuelve proyecto (cache() hit) + placeholder es-AR     │
        │        + <WriteAction/> island SOLO si rol ∈ {owner,developer}    │
        └───────────────────────────┬──────────────────────────────────────┘
                                     │ tRPC caller (server) / httpBatchLink (island)
                                     ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  @imbau/api  ·  tRPC v11                                           │
        │                                                                    │
        │  protectedProcedure  (auth + activeOrgId desde sesión, server)    │
        │        │                                                          │
        │        ├─ projects.getForOrg  ─ withTenant(activeOrgId) ─┐        │
        │        │                                                  │        │
        │        └─ projects.updateSettings                         │        │
        │              └ requireRole("owner","developer")           │        │
        │                   │ (lookup member.role en withTenant)    │        │
        │                   │ FORBIDDEN si rol ∉ allowed            │        │
        │                   ▼                                       │        │
        │                 withTenant(activeOrgId) ─ UPDATE .returning()      │
        │                   └ 0 filas → NOT_FOUND (cross-org, D-07)         │
        └───────────────────────────┬──────────────────────────────────────┘
                                     │ set_config('app.current_organization_id', $1, true)
                                     ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  PostgreSQL 16  ·  app_authenticated (NOSUPERUSER / NOBYPASSRLS)  │
        │  projects_tenant policy: using/withCheck org_id = GUC::text       │
        │  → filas de otra org: INVISIBLES (SELECT 0) / UPDATE 0 filas       │
        └──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
apps/panel/app/
├── (dashboard)/
│   ├── page.tsx          # `/` selector — EXTENDER: cada proyecto linkea a /proyectos/[id]; preservar InviteForm (D-03)
│   └── invite-form.tsx   # island owner-only — NO tocar
├── proyectos/
│   └── [id]/
│       ├── layout.tsx    # RSC: resuelve proyecto una vez, valida id, notFound(), monta TabBar (D-01)
│       ├── tab-bar.tsx   # "use client" island: usePathname → indicador tab activa
│       ├── page.tsx      # redirect("./unidades") (D-02)
│       ├── not-found.tsx # (opcional) boundary es-AR "Proyecto no encontrado"
│       ├── unidades/page.tsx   # RSC re-resuelve (cache hit) + placeholder + <WriteAction/> gated
│       ├── leads/page.tsx      # placeholder es-AR
│       └── hotspots/page.tsx   # placeholder es-AR
└── lib/
    ├── trpc-client.tsx   # TRPCReactProvider / useTRPC — reusar
    └── project-caller.ts # (nuevo, opcional) cache()-wrapped resolver del proyecto para RSC

packages/api/src/trpc/routers/
└── projects.ts           # AGREGAR getForOrg({id}) + updateSettings; registro ya en _app.ts

packages/api/tests/
├── fixtures.ts           # EXTENDER: exportar mintMemberInOrg(org, role) generalizado
└── projects-role-gate.test.ts  # NUEVO: matriz cross-rol (o extender trpc-tenant.test.ts)
```

### Pattern 1: Nested layout + índice-redirect + async params (Next 16)
**What:** Un `layout.tsx` de segmento dinámico resuelve el recurso una vez y envuelve las páginas hijas; el `page.tsx` del índice redirige a la tab por defecto.
**When to use:** D-01 (layout compartido de tabs) + D-02 (índice → `unidades`).
**Example:**
```typescript
// apps/panel/app/proyectos/[id]/page.tsx  — Source: repo pattern (accept-invitation async params) + Next 16 App Router
import { redirect } from "next/navigation";

export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;         // Next 16: params es Promise (ver accept-invitation/[id])
  redirect(`/proyectos/${id}/unidades`); // D-02: no hay vista de proyecto separada de las tabs
}
```
```typescript
// apps/panel/app/proyectos/[id]/layout.tsx  — RSC: resuelve una vez, valida, notFound
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { resolveProject } from "../../../lib/project-caller"; // cache()-wrapped, ver Pattern 2

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound(); // Pitfall 3: id no-UUID → 404, no 500 (22P02)
  const project = await resolveProject(id);          // null si RLS no devuelve la fila (D-07)
  if (!project) notFound();
  return (
    <section>
      <TabBar projectId={id} />   {/* island usePathname */}
      {children}
    </section>
  );
}
```

### Pattern 2: Resolver el proyecto una vez con React `cache()` (dedupe RSC)
**What:** El layout de App Router **no puede pasar props a las páginas hijas**. En vez de prop-drilling o re-fetch ciego, se envuelve el caller en `cache()`: layout y cada `page.tsx` llaman `resolveProject(id)` y comparten el mismo resultado dentro del request.
**When to use:** Siempre que layout + page(s) necesiten el mismo recurso resuelto (D-01/D-04). Documentado en `context.ts`: `@imbau/api` es un JIT package **sin dependencia de `react`**, así que `cache()` se aplica en el **boundary del panel**, no dentro del caller.
**Example:**
```typescript
// apps/panel/lib/project-caller.ts — Source: repo context.ts note ("wrap in cache() at its own boundary")
import { cache } from "react";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { createCaller } from "@imbau/api";

// Dedup per-request: layout + N page hijas → 1 sola query withTenant/RLS.
export const resolveProject = cache(async (id: string) => {
  const caller = await createCaller({ headers: await headers() });
  try {
    return await caller.projects.getForOrg({ id }); // null si RLS no ve la fila
  } catch (err) {
    if (err instanceof TRPCError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")) {
      redirect("/login"); // clona el catch de (dashboard)/page.tsx
    }
    throw err;
  }
});
```
> **Trade-off documentado:** `cache()` deduplica dentro de un mismo request RSC. Si por alguna razón no se usara `cache()`, la alternativa aceptable es que cada `page.tsx` re-resuelva con su propia query barata (`where id=$1` bajo RLS es un index lookup) — el costo es N queries triviales en vez de 1. `cache()` es preferible; ambas son correctas. **No** intentar pasar el proyecto del layout a la page por props (imposible en App Router).

### Pattern 3: Mutación canary `projects.updateSettings` (el molde de escritura del panel)
**What:** El patrón exacto que D1/D2/hotspots clonan (SC-4). `protectedProcedure` (implícito en `requireRole`) → `requireRole("owner","developer")` → input Zod → `withTenant` UPDATE con guarda de fila-no-visible.
**When to use:** Toda mutación scoped al proyecto del panel.
**Example:**
```typescript
// packages/api/src/trpc/routers/projects.ts (AGREGAR) — Source: repo middleware.ts + with-tenant.ts + member.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, schema } from "@imbau/db";
import { requireRole } from "../middleware";
// ... router existente ...

  // getForOrg: RLS-scoped single-project resolver (SC-1/SC-2). Devuelve null si RLS no ve la fila.
  getForOrg: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await withTenant(ctx.activeOrgId, (tx) =>
        tx.select().from(schema.projects).where(eq(schema.projects.id, input.id)),
      );
      return rows[0] ?? null; // el RSC traduce null → notFound() (D-07)
    }),

  // updateSettings: EL MOLDE de escritura del panel (D-05, SC-4).
  updateSettings: requireRole("owner", "developer")
    .input(
      z.object({
        id: z.uuid(),
        // Campo mínimo real (Claude's Discretion). Recomendado: estado borrador↔publicado.
        estado: z.enum(["borrador", "publicado"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await withTenant(ctx.activeOrgId, (tx) =>
        tx
          .update(schema.projects)
          .set({ estado: input.estado })
          .where(eq(schema.projects.id, input.id))
          .returning({ id: schema.projects.id, estado: schema.projects.estado }),
      );
      // PITFALL 1 (crítico): UPDATE bajo RLS sobre fila invisible (otra org) afecta 0 filas SIN error.
      // Sin esta guarda, el caller de otra org recibiría 200/undefined en vez de 404 → enumeración.
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return rows[0];
    }),
```
> **Canary field decision (recomendación al planner):** mutar **`estado` (borrador↔publicado)**. Es real, útil y **observable end-to-end**: publicar/despublicar cambia lo que la política `projects_anon_published` expone en la web pública (`listPublished`) — un test puede assertear el efecto cross-surface. El enum ya existe (`estadoEnum`). Alternativa igualmente válida y aún más simple: mutar `nombre` (`z.string().min(1).max(120)`), sin efecto en superficie pública. Evitar mutar `archivado` en esta fase (fuera del toggle mínimo).

### Pattern 4: Gating UI del viewer (D-08, defensa en profundidad)
**What:** El RSC resuelve el rol del usuario en la org activa y sólo renderiza el island de escritura si el rol ∈ {owner, developer}. El servidor sigue rechazando con FORBIDDEN si el viewer intenta mutar igual.
**When to use:** Cualquier acción de escritura visible en el shell.
**Example:**
```typescript
// packages/api/src/trpc/routers/org.ts (o member.ts) — AGREGAR: rol del caller en la org activa
  activeMemberRole: protectedProcedure.query(async ({ ctx }) => {
    const rows = await withTenant(ctx.activeOrgId, (tx) =>
      tx.select({ role: schema.member.role }).from(schema.member)
        .where(eq(schema.member.userId, ctx.session.user.id)),
    );
    return (rows[0]?.role ?? null) as "owner" | "developer" | "viewer" | null;
  }),
```
```typescript
// apps/panel/app/proyectos/[id]/unidades/page.tsx — RSC baja el rol al island por prop
const caller = await createCaller({ headers: await headers() });
const role = await caller.org.activeMemberRole();
const canWrite = role === "owner" || role === "developer";
// ...
{canWrite ? <WriteAction projectId={id} /> : null} {/* viewer: botón NO se renderiza */}
```
> El island `WriteAction` llama `projects.updateSettings` vía `useTRPC` (como `InviteForm` llama `member.invite`). Aunque un viewer forjara el request, `requireRole` devuelve FORBIDDEN — la UI oculta es cosmética, el gate server-side es la verdad (D-08).

### Anti-Patterns to Avoid
- **Pasar el proyecto resuelto del layout a la page por props.** Imposible en App Router — usar `cache()` (Pattern 2) o re-resolver barato.
- **Filtrar existencia distinguiendo 403 de 404 en el shell.** Viola no-enumeración (D-07): "no existe" y "otra org" deben ser indistinguibles → siempre `notFound()`.
- **UPDATE sin `.returning()` + guarda de 0 filas.** El cross-org pasa silencioso (RLS afecta 0 filas sin error) → enumeración + falsa sensación de éxito.
- **Comparar `params.id` no validado contra la columna `uuid`.** Un id malformado lanza Postgres `22P02` → 500 en vez de 404. Validar formato UUID primero.
- **Confiar en el ocultamiento del botón como autorización.** UI gating (D-08) es defensa en profundidad, nunca la barrera única.
- **Usar `appDb`/`createOwnerDb` en el router del canary.** Sólo `withTenant` (CLAUDE.md, `T-03-09`, grep-verificado).
- **Correr la matriz cross-rol como owner del pool o superuser.** Bypassea RLS → el test pasa por la razón equivocada. Siempre por el caller real → `app_authenticated`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gate de rol de escritura | Chequeo ad-hoc de `member.role` en cada resolver | `requireRole("owner","developer")` (`middleware.ts`) | Ya existe, ya lee el rol bajo RLS, ya lanza FORBIDDEN. SC-4 se cumple **usándolo**, no recreándolo. |
| Aislamiento de tenant en la resolución/mutación | `where organization_id = ...` en app-layer | `withTenant(ctx.activeOrgId, ...)` + política `projects_tenant` | RLS ya filtra; un `where` manual es redundante y falla-abierto si se olvida. |
| Derivar el tenant | Leer orgId del cliente/URL | `ctx.activeOrgId` (de `session.activeOrganizationId`) | `protectedProcedure` ya lo deriva server-side; un orgId de cliente nunca se confía. |
| Dedup de la resolución RSC | Context provider / prop-drilling manual | React `cache()` en el boundary del panel | 1 query por request; App Router no deja pasar props layout→page. |
| Session/rol en el cliente | Parsear cookies / decodificar sesión a mano | Query tRPC RLS-scoped (`activeMemberRole`) | Consistente, tipado, testeable con el mismo harness. |
| Construir sesiones de test por rol | Insertar `member` rows a mano | `makeUserWithActiveOrg` + `mintMemberInOrg` (fixtures reales de Better Auth) | La única vía sancionada de escribir tablas org/member RLS-FORCED (owner-pool A1). |

**Key insight:** Esta fase es 90% **cableado de primitivos existentes**. El valor no está en construir nada nuevo de autorización, sino en aplicar el molde correctamente y **probarlo cross-rol contra Postgres real**. Cualquier "solución custom" de auth/tenancy aquí es una regresión frente a lo ya verificado en v1.0.

## Runtime State Inventory

> No aplica en sentido estricto (no es un rename/refactor/migración de datos). Se completa igual para descartar sorpresas de estado runtime.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Ninguno net-new. `projects.estado` ya existe (enum `borrador/publicado/archivado`); el canary muta un valor existente, no agrega columnas. | None — sin migración de schema. |
| Live service config | Ninguno. No hay config externa (n8n/Datadog/Tailscale) tocada por el shell del panel. | None — verificado: fase puramente app/API. |
| OS-registered state | Ninguno. Sin tasks/daemons nuevos; corre dentro de `apps/panel` (Next) y `@imbau/api` existentes. | None. |
| Secrets/env vars | Ninguno net-new. Reusa `DATABASE_APP_URL`/`DATABASE_ANON_URL`/auth env ya presentes. | None. |
| Build artifacts | Ninguno. Sin cambios de `pyproject`/`package.json` que invaliden artefactos. La única adición es código TS en paquetes ya construidos por Turborepo. | None — `turbo build` recompila normal. |

**Nada crítico encontrado:** Verificado — no hay estado runtime que sobreviva a los cambios de código de esta fase. `projects.updateSettings` mutando `estado` afecta datos de negocio existentes (visibilidad pública), pero eso es comportamiento intencional, no estado stale.

## Common Pitfalls

### Pitfall 1: UPDATE bajo RLS sobre fila invisible afecta 0 filas SIN lanzar error
**What goes wrong:** Un caller de otra org (o con id inexistente) invoca `updateSettings`; la política `projects_tenant` hace la fila invisible, el `UPDATE` matchea 0 filas y **retorna éxito vacío** en vez de fallar. El caller recibe 200/undefined → puede inferir que el proyecto no existía → enumeración, y viola D-07.
**Why it happens:** En Postgres, `UPDATE ... WHERE` que no matchea filas no es un error; con RLS, una fila no visible simplemente no entra al conjunto afectado.
**How to avoid:** `.returning(...)` en el UPDATE y `if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" })`. El RSC/caller trata NOT_FOUND igual que "no existe" (no-enumeración).
**Warning signs:** El test "otra org" pasa pero sin assertear el código de error, o assertea `undefined` sin distinguir de un update legítimo que devolvió void.

### Pitfall 2: `params.id` no-UUID → error Postgres 22P02 → 500 en vez de 404
**What goes wrong:** Un deep-link con `/proyectos/no-es-uuid/unidades` compara un string inválido contra `projects.id::uuid` → Postgres lanza `invalid input syntax for type uuid` (22P02) → el RSC explota con 500.
**Why it happens:** El casteo implícito a `uuid` valida el formato en el motor, no antes.
**How to avoid:** `z.uuid().safeParse(id)` en el layout ANTES de la query; si falla → `notFound()`. En el resolver, `z.object({ id: z.uuid() })` como input (rechaza en el boundary tRPC).
**Warning signs:** 500 en logs con `22P02` al abrir URLs escritas a mano.

### Pitfall 3: Next 16 `params` es un Promise
**What goes wrong:** Tratar `params.id` como sincrónico (`const { id } = params`) rompe en Next 15+/16.
**Why it happens:** App Router async params/searchParams desde Next 15.
**How to avoid:** `const { id } = await params;` con tipo `params: Promise<{ id: string }>`. Ya establecido en `apps/panel/app/accept-invitation/[id]/page.tsx`.
**Warning signs:** Type error o `id` undefined en runtime.

### Pitfall 4: Owner de tabla / superuser bypassea RLS → el test cross-rol pasa por la razón equivocada
**What goes wrong:** Correr la matriz como el owner-pool o un rol BYPASSRLS hace que TODAS las filas sean visibles → viewer "pasa" un test que debía fallar, o cross-org no aísla.
**Why it happens:** El dueño de la tabla y superuser ignoran RLS salvo `FORCE ROW LEVEL SECURITY`; el schema ya hace `FORCE`, pero el **test** debe correr por el path `app_authenticated`.
**How to avoid:** La matriz invoca el **caller real** (`createCaller({ headers })`) → `withTenant` → `app_authenticated` (NOSUPERUSER/NOBYPASSRLS), exactamente como `trpc-tenant.test.ts`. El owner-pool sólo se usa para **sembrar** fixtures (vía Better Auth runtime), nunca para assertear.
**Warning signs:** El test de viewer no lanza FORBIDDEN, o el cross-org devuelve filas.

### Pitfall 5: `requireRole` corre su propia transacción `withTenant` ANTES del UPDATE (dos transacciones)
**What goes wrong:** No es un bug, pero es un detalle a entender: `requireRole` hace el lookup de `member.role` en **su propia** `withTenant` tx; luego el resolver hace **otra** `withTenant` tx para el UPDATE. Son dos transacciones GUC-scoped separadas.
**Why it happens:** El middleware y el resolver son capas independientes, cada una abre/cierra su tx (el GUC `set_config(...,true)` se auto-limpia al commit).
**How to avoid:** Nada que arreglar — es correcto y seguro (el GUC nunca bleedea entre requests). Sólo no asumir que rol-lookup y UPDATE comparten transacción/snapshot.
**Warning signs:** N/A — documentado para evitar confusión al leer el molde.

### Pitfall 6: Orden de checks
**What goes wrong:** Chequear rol antes de auth, o resolver el proyecto antes de validar el id, produce errores confusos (500 en vez de 401/404).
**Why it happens:** Composición mal ordenada.
**How to avoid:** Orden canónico: **auth** (`protectedProcedure`: UNAUTHORIZED si no hay sesión/active org) → **tenant** (`withTenant` scope RLS) → **role** (`requireRole`: FORBIDDEN) → **resolución/mutación** (NOT_FOUND si 0 filas). En el RSC: validar UUID → resolver → `notFound()`.
**Warning signs:** Un viewer sin sesión recibe FORBIDDEN en vez de UNAUTHORIZED; un id malformado tira 500.

## Code Examples

### Extender el selector `/` para linkear al shell (D-03, preservando InviteForm)
```typescript
// apps/panel/app/(dashboard)/page.tsx — cambiar SOLO la lista; NO tocar la sección Miembros/InviteForm
import Link from "next/link";
// ...
<ul>
  {projects.map((p) => (
    <li key={p.id}>
      <Link href={`/proyectos/${p.id}/unidades`}>{p.nombre}</Link> · {p.slug} · {p.estado}
    </li>
  ))}
</ul>
```

### Indicador de tab activa (island cliente)
```typescript
// apps/panel/app/proyectos/[id]/tab-bar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "unidades", label: "Unidades" },
  { seg: "leads", label: "Leads" },
  { seg: "hotspots", label: "Hotspots" },
] as const;

export function TabBar({ projectId }: { projectId: string }): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav>
      {TABS.map((t) => {
        const href = `/proyectos/${projectId}/${t.seg}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={t.seg} href={href} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

### Placeholder es-AR de una tab (D-04) con `page.tsx` real
```typescript
// apps/panel/app/proyectos/[id]/unidades/page.tsx
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createCaller } from "@imbau/api";
import { resolveProject } from "../../../../lib/project-caller";

export default async function UnidadesTab({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const project = await resolveProject(id); // cache() hit: mismo resultado que el layout
  if (!project) notFound();
  const caller = await createCaller({ headers: await headers() });
  const role = await caller.org.activeMemberRole();
  const canWrite = role === "owner" || role === "developer";
  return (
    <main>
      <h1>{project.nombre} · Unidades</h1>
      <p>Grilla de unidades — próximamente.</p>
      {canWrite ? <p>(acá irá la acción de escritura — fase 10)</p> : null}
    </main>
  );
}
```

### Matriz cross-rol — helper generalizado y test (extiende trpc-tenant.test.ts)
```typescript
// packages/api/tests/fixtures.ts (AGREGAR) — generaliza el mintViewerInOrg local de trpc-tenant.test.ts
export async function mintMemberInOrg(
  org: SessionFixture,
  role: "owner" | "developer" | "viewer",
): Promise<SessionFixture> {
  const { auth } = await import("../src/auth/runtime");
  const email = `${role}-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const ownerCaller = await createCaller({ headers: org.headers });
  const invitation = await ownerCaller.member.invite({ email, role });
  const signUp = await auth.api.signUpEmail({
    body: { name: role, email, password }, returnHeaders: true,
  });
  let headers = cookieHeaderFrom(signUp.headers.get("set-cookie"));
  await auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers });
  const activated = await auth.api.setActiveOrganization({
    body: { organizationId: org.orgId }, headers, returnHeaders: true,
  });
  const refreshed = activated.headers.get("set-cookie");
  if (refreshed) headers = cookieHeaderFrom(refreshed);
  return { userId: signUp.response.user.id, email, orgId: org.orgId, orgSlug: org.orgSlug, headers };
}
```
```typescript
// packages/api/tests/projects-role-gate.test.ts (NUEVO) — matriz cross-rol contra Postgres real (D-06/SC-3)
describe("projects.updateSettings role gate (PANEL-02)", () => {
  it("owner ✓ can update", async () => {
    const c = await createCaller({ headers: orgA.headers }); // creator = owner
    const res = await c.projects.updateSettings({ id: projA, estado: "publicado" });
    expect(res.estado).toBe("publicado");
  });
  it("developer ✓ can update", async () => {
    const dev = await mintMemberInOrg(orgA, "developer");
    const c = await createCaller({ headers: dev.headers });
    await expect(c.projects.updateSettings({ id: projA, estado: "borrador" })).resolves.toBeTruthy();
  });
  it("viewer ✗ → FORBIDDEN", async () => {
    const viewer = await mintMemberInOrg(orgA, "viewer");
    const c = await createCaller({ headers: viewer.headers });
    await expect(c.projects.updateSettings({ id: projA, estado: "publicado" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("otra org ✗ → NOT_FOUND (aislamiento RLS + no-enumeración)", async () => {
    const c = await createCaller({ headers: orgB.headers }); // owner de B, proyecto de A
    await expect(c.projects.updateSettings({ id: projA, estado: "publicado" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```
> Nota: el caso "otra org" con un **owner de B** prueba que ni siquiera un rol privilegiado cruza el tenant — el gate de rol pasa (B es owner) pero RLS deja la fila invisible → 0 filas → NOT_FOUND (D-07). Esto separa limpiamente "autorización" (rol) de "aislamiento" (tenant).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `params`/`searchParams` sincrónicos en App Router | `params: Promise<>` (`await params`) | Next 15 → 16 | Layout/page deben ser async y awaitear params (ya en uso en el repo). |
| Prop-drilling / context para compartir data layout↔page | React `cache()` per-request dedupe | React 19 RSC | Resolución del proyecto una vez sin acoplar layout a hijas. |
| RLS como única barrera de escritura | RLS (tenant) + `requireRole` (autorización) | v1.0/A1 (este proyecto) | El molde de esta fase: RLS aísla tenant, `requireRole` autoriza rol. Ambos, no uno. |

**Deprecated/outdated:**
- TanStack Query v4 con tRPC v11 (usar v5 — ya pinneado). No relevante net-new aquí.
- Nada más deprecado toca esta fase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `auth.api.getActiveMember({ headers })` existe en better-auth 1.6.x como alternativa a una query tRPC para el rol | Alternatives / Pattern 4 | Bajo — se recomienda la query tRPC (verificada contra el codebase), no `getActiveMember`. Si no existiera, la recomendación no cambia. |
| A2 | El planner elige `estado` (borrador↔publicado) como campo del canary | Pattern 3 / Standard Stack | Bajo — es Claude's Discretion (D-05); `nombre` es fallback igualmente válido. La estructura del molde no depende del campo. |
| A3 | El árbol `proyectos/[id]` vive fuera del route group `(dashboard)` (URL real `/proyectos/[id]`, no `/(dashboard)/proyectos`) | Project Structure | Bajo — micro-decisión de layout (Claude's Discretion). Ambas ubicaciones dan la misma URL si se coloca bien; recomendado fuera de `(dashboard)` por claridad. |

## Open Questions

1. **¿La barra de tabs debe mostrar un breadcrumb "← Proyectos" al selector `/`?**
   - What we know: D-03 mantiene `/` como selector; CONTEXT deja breadcrumbs a criterio del executor (Deferred).
   - What's unclear: si el planner quiere el link de retorno explícito en el layout.
   - Recommendation: incluir un `<Link href="/">← Proyectos</Link>` mínimo en el layout — trivial, mejora navegación, no es scope creep.

2. **¿`activeMemberRole` va en `org` o `member` router?**
   - What we know: ambos existen; `org` tiene procedimientos de sesión/tenant, `member` es owner-only para invite.
   - What's unclear: convención de ubicación.
   - Recommendation: `org.activeMemberRole` (es info de la membresía del caller en la org activa, coherente con `org.list`/`org.setActive`). Micro-decisión del planner.

3. **¿Se necesita un `not-found.tsx` es-AR dedicado en `proyectos/[id]`?**
   - What we know: `notFound()` renderiza el `not-found` boundary más cercano; sin uno propio usa el global.
   - Recommendation: agregar `proyectos/[id]/not-found.tsx` con copy es-AR ("No encontramos ese proyecto.") para no filtrar y dar UX correcta. Opcional pero recomendado.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL `_test` DB | Matriz cross-rol (Vitest integración) | ✓ | 16 | — (ya usado por `trpc-tenant.test.ts`; `globalSetup` verifica `_test`) |
| Node 22 | Build/test panel + api | ✓ | 22 LTS | nvm (shell default 20 — usar `nvm use 22`, ver MEMORY) |
| Better Auth runtime (owner pool) | Sembrar fixtures owner/dev/viewer | ✓ | 1.6.x | — (fixtures reales, único path A1) |
| Playwright | e2e navegación shell (opcional) | ✓ | 1.60 | — |

**Missing dependencies with no fallback:** ninguna — toda la infra de test ya existe y corre en CI (patrón v1.0/v1.1).
**Missing dependencies with fallback:** Node 22 vía nvm si el shell arranca en 20 (recordatorio de MEMORY.md).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (integración contra Postgres `_test`) + Playwright 1.60 (e2e) |
| Config file | `packages/api/vitest.config.ts` (globalSetup `tests/setup.ts` verifica DB `_test`); panel e2e en `apps/panel` |
| Quick run command | `pnpm --filter @imbau/api test` |
| Full suite command | `pnpm test` (turbo: lint + typecheck + test en todos los paquetes) |

### Phase Requirements → Test Map
| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| SC-1 / PANEL-01 | Developer abre `proyectos/[id]/unidades` y ve tabs scoped al proyecto de su org | e2e (Playwright) + integración (`getForOrg` devuelve la fila de la org) | `pnpm --filter @imbau/panel test:e2e` / `pnpm --filter @imbau/api test` | ❌ Wave 0 (e2e nuevo) / ✅ (extiende `trpc-tenant.test.ts`) |
| SC-2 / PANEL-01 | Usuario no abre un proyecto de otra org → `notFound()` 404, no-enumeración | integración (`getForOrg` cross-org → null) + e2e (deep-link a proyecto de otra org → 404) | `pnpm --filter @imbau/api test` / `pnpm --filter @imbau/panel test:e2e` | ✅ patrón cross-tenant / ❌ Wave 0 (e2e 404) |
| SC-3 / PANEL-02 | owner✓ / developer✓ / viewer✗(FORBIDDEN) / otra-org✗(NOT_FOUND) sobre `updateSettings` | integración cross-rol contra Postgres real (caller→RLS) | `pnpm --filter @imbau/api test` | ❌ Wave 0 (`projects-role-gate.test.ts` + `mintMemberInOrg`) |
| SC-3 (UI gating D-08) | El botón de escritura no se renderiza para viewer | e2e (viewer no ve el botón) — **más verificación manual/UAT** | `pnpm --filter @imbau/panel test:e2e` | ❌ Wave 0 / manual |
| SC-4 / PANEL-02 | `requireRole("owner","developer")` establecido como molde reutilizable | verificación estructural: la mutación usa `requireRole` (grep) + la matriz cross-rol verde | `grep` + `pnpm --filter @imbau/api test` | ✅ molde existe / ❌ matriz Wave 0 |
| Cross-surface (canary `estado`) | Publicar/despublicar cambia visibilidad anon (`listPublished`) | integración (toggle estado → assert `listPublished`) | `pnpm --filter @imbau/api test` | ✅ `listPublished` existe / ❌ assertion nueva |

**Verificable por test automatizado:** SC-1 (resolución), SC-2 (cross-org null/404 lógico), SC-3 (matriz cross-rol — el corazón de PANEL-02), SC-4 (grep + matriz). Estos NO dependen de juicio humano.
**Requiere check manual/UAT:** la experiencia visual del shell (tabs, placeholders es-AR, indicador de tab activa) y la confirmación de que el botón de escritura efectivamente no aparece para viewer en viewport real — cosmético, sin design system esta fase. El 404 renderizado (copy es-AR) conviene verlo una vez en UAT.

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/api test` (matriz cross-rol es la señal crítica)
- **Per wave merge:** `pnpm test` (turbo full: lint + typecheck + test todos los paquetes)
- **Phase gate:** Full suite verde + e2e de navegación shell antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/api/tests/projects-role-gate.test.ts` — matriz cross-rol owner/dev/viewer/otra-org (SC-3, PANEL-02)
- [ ] `packages/api/tests/fixtures.ts` — exportar `mintMemberInOrg(org, role)` generalizado (hoy el helper `mintViewerInOrg` vive local en `trpc-tenant.test.ts`, sólo viewer)
- [ ] Integración `getForOrg` cross-org → null y `updateSettings` cross-org → NOT_FOUND (puede vivir en el mismo archivo)
- [ ] (opcional) e2e Playwright: deep-link a proyecto propio (tabs visibles) vs proyecto de otra org (404); viewer no ve botón de escritura
- [ ] Assertion cross-surface: toggle `estado` → `listPublished` refleja el cambio (si se elige `estado` como campo del canary)

## Security Domain

> `security_enforcement` no está marcado `false` en config (absent = enabled). Esta fase ES una superficie de autorización — el análisis aplica de lleno.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Defensa en profundidad: UI gating (D-08) + gate server-side (`requireRole`) — nunca sólo UI. |
| V2 Authentication | yes (heredado) | `protectedProcedure` (sesión + active org derivados server-side de Better Auth). Sin cambios net-new. |
| V4 Access Control | **yes (core)** | `requireRole("owner","developer")` server-side por rol; RLS `projects_tenant` por tenant; no-enumeración vía `notFound()`/`NOT_FOUND` uniforme (D-07). BOLA/IDOR mitigado: no se confía en id de cliente sin RLS. |
| V5 Input Validation | yes | `z.uuid()` en `params.id` y en el input de la mutación (previene 22P02 y payloads malformados). `z.enum` acota `estado`. |
| V7 Error Handling | yes | Errores tRPC tipados (FORBIDDEN/NOT_FOUND/UNAUTHORIZED); nunca filtrar existencia de recursos de otra org; el `errorFormatter` de `init.ts` no leakea stack. |
| V6 Cryptography | no | Sin cripto net-new. |
| V3 Session Management | yes (heredado) | Better Auth; `activeOrganizationId` es la fuente del tenant. Sin cambios. |

### Known Threat Patterns for {Next 16 RSC + tRPC + Postgres RLS}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| BOLA / IDOR: acceder/editar el proyecto de otra org por id en la URL | Elevation of Privilege / Information Disclosure | RLS `projects_tenant` (fila invisible) + `getForOrg` null→`notFound()` + `updateSettings` 0-filas→NOT_FOUND. **No** `where org_id` en app-layer como única barrera. |
| Broken function-level authz: viewer ejecuta una mutación de escritura forjando el request | Elevation of Privilege | `requireRole("owner","developer")` server-side (FORBIDDEN); UI gating es sólo defensa en profundidad. |
| Enumeración de recursos: distinguir "no existe" de "existe en otra org" | Information Disclosure | Mismo comportamiento (`notFound()`/NOT_FOUND) para ambos casos (D-07). |
| Injection vía `params.id` malformado a columna uuid | Tampering / DoS (500s) | Validar `z.uuid()` antes de la query; input tRPC con `z.uuid()`. |
| RLS bypass en tests (owner-pool/superuser) → falso verde | Spoofing (de la evidencia) | Matriz cross-rol corre por el caller real → `app_authenticated` NOSUPERUSER/NOBYPASSRLS; owner-pool sólo siembra. |
| Tenant GUC bleed en connection pool | Information Disclosure | `set_config('app.current_organization_id', $1, true)` (transaction-scoped, auto-clear) — ya implementado en `with-tenant.ts`. |

## Sources

### Primary (HIGH confidence) — código del repo leído esta sesión
- `packages/api/src/trpc/middleware.ts` — firma exacta de `requireRole(...allowed)`, lookup de rol bajo `withTenant`, FORBIDDEN. [VERIFIED: repo]
- `packages/api/src/trpc/init.ts` — `protectedProcedure` (auth + `activeOrgId` server-derived), `errorFormatter`. [VERIFIED: repo]
- `packages/api/src/trpc/routers/projects.ts` — `listForOrg`/`listPublished` (patrón `withTenant`/`withAnon`, sin orgId de cliente). [VERIFIED: repo]
- `packages/api/src/auth/access-control.ts` — roles owner/developer/viewer + statements `project`. [VERIFIED: repo]
- `packages/db/src/with-tenant.ts` — `withTenant` set_config parametrizado transaction-scoped. [VERIFIED: repo]
- `packages/db/src/schema/projects.ts` — columnas (`nombre`,`slug`,`estado` enum,`whatsapp`), políticas `projects_tenant` (using/withCheck) + `projects_anon_published`. [VERIFIED: repo]
- `packages/api/tests/trpc-tenant.test.ts` + `fixtures.ts` + `db.ts` — patrón exacto de matriz cross-tenant contra Postgres real, `makeUserWithActiveOrg`, `mintViewerInOrg` local, harness `_test`. [VERIFIED: repo]
- `apps/panel/app/(dashboard)/page.tsx` + `invite-form.tsx` + `lib/trpc-client.tsx` + `accept-invitation/[id]/page.tsx` — patrón RSC `createCaller`, islands `useTRPC`, `params: Promise<>` async. [VERIFIED: repo]
- `packages/api/src/trpc/context.ts` — nota explícita sobre `cache()` en el boundary del panel (JIT package sin react dep). [VERIFIED: repo]
- `apps/panel/package.json` — Next 16.2.9, React 19.2.7. [VERIFIED: repo]

### Secondary (MEDIUM confidence)
- Next.js App Router semantics (nested layouts, layout no pasa props a page, `notFound`/`redirect`, async params) — conocimiento consistente con el uso ya presente en el repo (accept-invitation async params). [CITED: nextjs.org/docs/app]

### Tertiary (LOW confidence)
- `auth.api.getActiveMember` como alternativa de rol — [ASSUMED], no verificado esta sesión; recomendación no depende de él.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero net-new, versiones leídas de los package.json del repo.
- Architecture: HIGH — todos los patrones son clones de código existente verificado (RSC dashboard, `requireRole`, `withTenant`, matriz cross-tenant).
- Pitfalls: HIGH — los tres críticos (UPDATE 0-filas, uuid 22P02, async params) se derivan directamente del comportamiento de RLS/Postgres/Next observado en el repo.

**Research date:** 2026-07-21
**Valid until:** 2026-08-20 (stack estable, pinneado; re-verificar sólo si se bumpea Next/tRPC/Drizzle)
