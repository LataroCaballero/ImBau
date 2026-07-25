# Phase 11: D2 — Bandeja de leads + notificación por email - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 13 new/modified
**Analogs found:** 13 / 13 (this is a replication phase — every file clones an existing mold)

> **Read this as: "clone THIS exact shape, don't re-derive."** Every row below points at a real
> file+lines in the repo. The planner should reference the analog path in each plan's action; the
> executor should copy the shape verbatim and specialize only names/copy. All paths absolute-relative
> to repo root `/Users/laucaballero/Desktop/Lautaro/AndesCode/ImBau/`.

---

## File Classification

| New / Modified file | Role | Data Flow | Closest Analog | Match |
|---------------------|------|-----------|----------------|-------|
| `packages/db/src/schema/leads.ts` (MOD: add `desenlace`) | migration/schema | transform | same file (`estado` enum col) + `projects.whatsapp` nullable col | exact |
| `packages/db/src/schema/projects.ts` (MOD: add `leadsNotifyEmail`) | migration/schema | transform | same file (`whatsapp` nullable text col) | exact |
| `packages/db/migrations/*` (Drizzle generated) | migration | transform | existing generated migrations (`drizzle-kit generate` → `migrate`) | exact |
| `packages/api/src/trpc/routers/leads.ts` (NEW) | router | CRUD + event-driven | `packages/api/src/trpc/routers/units.ts` (write mold + events audit) + `quotes.ts` (insert.returning + enqueue) | exact |
| `packages/api/src/trpc/routers/projects.ts` (MOD: extend `updateSettings`) | router | CRUD | same file `updateSettings` | exact |
| `packages/api/src/trpc/routers/_app.ts` (MOD: register `leadsRouter`) | router | — | same file | exact |
| `packages/storage/src/lead-email.ts` (NEW: queue contract) | config | pub-sub | `packages/storage/src/quote-pdf.ts` | exact |
| `packages/api/src/leads/runtime.ts` (NEW: enqueue seam) | service | pub-sub | `packages/api/src/quotes/runtime.ts` (`enqueuePdf`) | exact |
| `apps/worker/src/lead-email.ts` (NEW: processor + failure report) | service | event-driven | `apps/worker/src/quote-pdf.ts` (`processQuotePdf`/`reportQuotePdfFailure`) | exact |
| `apps/worker/src/index.ts` (MOD: register worker) | config | event-driven | same file (`createQuotePdfWorker` + boot wiring) | exact |
| `packages/api/src/email/send-lead-notification.ts` (NEW) | service | request-response | `packages/api/src/email/send-invitation.ts` | exact |
| `packages/api/src/email/templates/lead-notification.tsx` (NEW) | component | — | `packages/api/src/email/templates/invitation.tsx` | exact |
| `apps/panel/app/proyectos/[id]/leads/page.tsx` (REPLACE body) + kanban/drawer islands (NEW) | component | CRUD | `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx` (+ its `page.tsx` spine) | role-match |
| `packages/db/src/seed/content.ts` + `content-rows.ts` (MOD if desenlace seeded) | migration/seed | batch | same files (direct `tx.insert(schema.leads)` — bypasses the email seam) | exact |

---

## Pattern Assignments

### `packages/db/src/schema/leads.ts` — add `desenlace` (migration/schema, D-03)

**Analog:** the nullable `whatsapp` slot in `projects.ts` (L34) and the existing `estado` enum col here (L48).

**Add a nullable column** — do NOT touch `leadEstadoEnum`. Discretion (CONTEXT D-03): enum PG vs Zod-validated text. Cheapest forward-compatible shape is a nullable `text` validated by Zod (`ganado|perdido`), mirroring how `origen` is plain `text` here (L47). If a PG enum is preferred, declare it in `enums.ts` next to `leadEstadoEnum` (do not modify that enum). Column sits alongside:
```typescript
estado: leadEstadoEnum("estado").notNull().default("nuevo"),
desenlace: text("desenlace"),   // nullable; ganado|perdido; set only on transition INTO cerrado (D-03)
```
Migration is **generated** (`drizzle-kit generate` then `migrate`), never `push` — CLAUDE.md: versioned migrations only.

### `packages/db/src/schema/projects.ts` — add `leadsNotifyEmail` (migration/schema, D-05)

**Analog:** the `whatsapp` nullable column in the same file (L29-34).
```typescript
whatsapp: text("whatsapp"),
leadsNotifyEmail: text("leads_notify_email"),   // nullable; fallback = org owners when null (D-05)
```
No new pgPolicy needed (existing `projects_tenant` covers it; `projects_anon_published` is SELECT-only and this column is panel-private).

### `packages/api/src/trpc/routers/leads.ts` (NEW) — router (CRUD + event-driven)

**Primary analog:** `packages/api/src/trpc/routers/units.ts` (the D1 clone of the Phase 9 write mold). **Secondary:** `quotes.ts` for the insert-returning + enqueue-as-side-effect shape.

**Imports pattern** (units.ts L30-35):
```typescript
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, schema } from "@imbau/db";
import { router, protectedProcedure } from "../init";
import { requireRole } from "../middleware";
import { enqueueLeadEmail } from "../../leads/runtime";   // new — clone of quotes/runtime enqueuePdf
```

**Read mold — `listForProject` with joins** (LEADS-01; clone units.ts `listForProject` L173-185 + its `readGrid` join style L106-124). Resolve origen by tenant-pinned joins to `brokers` / `units` / `quotes`; all reads through `withTenant(ctx.activeOrgId, ...)`, NO app-layer org filter (RLS does it):
```typescript
listForProject: protectedProcedure
  .input(z.object({ projectId: z.uuid() }))
  .query(({ ctx, input }) =>
    withTenant(ctx.activeOrgId, async (tx) => {
      // select leads + leftJoin brokers/units/quotes on composite (id, organizationId)
      // to resolve origen (broker/unidad/cotización) — same join shape as readGrid's
      // innerJoin on (units.floorId, units.organizationId)=(floors.id, floors.organizationId).
    }),
  ),
```
Composite-join style to copy (units.ts L117-123):
```typescript
.innerJoin(
  schema.floors,
  and(
    eq(schema.units.floorId, schema.floors.id),
    eq(schema.units.organizationId, schema.floors.organizationId),
  ),
)
```

**Write mold — `updateEstado`** (LEADS-02/D-02; **verbatim clone** of units.ts `updateEstado` L260-290 — UPDATE + `.returning()` 0-row → `NOT_FOUND`, PLUS the `events` audit insert in the SAME tx). Destination `estado` validated against a local `z.enum(["nuevo","contactado","negociacion","cerrado"])` mirror of `leadEstadoEnum` — "máquina impuesta" = destination ∈ 4 enum values (not linear). This mutation ALSO appends the auto `LeadNote` to `leads.timeline` (D-04) and, on transition INTO `cerrado`, requires `desenlace`:
```typescript
updateEstado: requireRole("owner", "developer")
  .input(z.object({
    projectId: z.uuid(), leadId: z.uuid(),
    estado: z.enum(LEAD_ESTADOS),
    desenlace: z.enum(["ganado","perdido"]).optional(),  // required when estado==='cerrado' (refine)
  }))
  .mutation(({ ctx, input }) =>
    withTenant(ctx.activeOrgId, async (tx) => {
      // 1. read current estado (for estadoPrev in the timeline entry)
      // 2. UPDATE ... set({ estado, desenlace, timeline: [...prev, autoNote] })
      //    .where(and(eq(leads.id, leadId), eq(leads.projectId, projectId)))
      //    .returning({ id: schema.leads.id });
      // 3. if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      // 4. events audit insert IN THE SAME TX (see below)
    }),
  ),
```
**Events audit insert — verbatim from units.ts L282-287** (D-04, Phase 10 D-02 pattern):
```typescript
await tx.insert(schema.events).values({
  organizationId: ctx.activeOrgId,
  projectId: input.projectId,
  tipo: EVENT_LEAD_ESTADO_CHANGED,   // define a stable English const like EVENT_ESTADO_CHANGED (units.ts L49-50)
});
```
`autor` for the timeline entry comes from `ctx.session` (init.ts exposes `ctx.session`); D-04 rule: `{autor} movió el lead de {EstadoPrev} a {EstadoNuevo}`.

**`addNote`** (LEADS-03) — same `requireRole`+`withTenant`+`.returning()` NOT_FOUND mold; appends a free-text `LeadNote` (`{ ts, autor, nota }`) to `leads.timeline`. Notes do NOT emit to `events` and do NOT notify (D-06).

**`create` (alta manual)** — the load-bearing seam (D-01/D-06). Clone the **quotes.ts `create` shape L185-224** EXACTLY: `withTenant` is called at the mutation's TOP LEVEL and RESOLVES to the inserted rows; the enqueue happens AFTER that promise resolves, OUTSIDE the `withTenant(...)` closure. Insert with `.returning({ id })`, guard the row, then enqueue the email as the post-commit side-effect of a successful persist (NEVER await it inside the tx callback — a rolled-back insert must never leave a queued email; the enqueue only pushes to Redis, no email send in-request):
```typescript
create: requireRole("owner", "developer")
  .input(z.object({
    projectId: z.uuid(),
    nombre: z.string().min(1), contacto: z.string().min(1),
    origen: z.string(), brokerId: z.uuid().optional(),
    unitId: z.uuid().optional(), quoteId: z.uuid().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. Persist INSIDE the tenant tx; withTenant RESOLVES to the inserted rows, then the tx closes.
    const inserted = await withTenant(ctx.activeOrgId, (tx) =>
      tx.insert(schema.leads).values({
        organizationId: ctx.activeOrgId,
        projectId: input.projectId,
        nombre: input.nombre, contacto: input.contacto, origen: input.origen,
        brokerId: input.brokerId, unitId: input.unitId, quoteId: input.quoteId,
        timeline: [{ ts: new Date().toISOString(), autor: <session name>, nota: "registró el lead" }], // seeds timeline t=0 (UI-SPEC "creation entry")
      }).returning({ id: schema.leads.id }),
    );
    const row = inserted[0];
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo persistir el lead." });
    // 2. Enqueue AFTER the persist commits — OUTSIDE withTenant, at the mutation top level.
    //    Because `inserted` is withTenant's resolved value, referencing `inserted[0]` here proves
    //    the tx has closed. A rolled-back insert throws before this line, so it enqueues zero jobs.
    await enqueueLeadEmail({ leadId: row.id, organizationId: ctx.activeOrgId, projectId: input.projectId });
    return { leadId: row.id };
  }),
```
> Load-bearing rule (D-06, resolved — NOT a tension): mirror quotes.ts L203-222 exactly — `withTenant` at the top level, the enqueue as the FINAL step AFTER the promise resolves, OUTSIDE the tx callback. Never nest `enqueueLeadEmail` inside the `withTenant(...)` closure: a pre-commit enqueue inside the tx would fire an email for a lead that later rolls back and would let the worker race a not-yet-committed row. A Redis failure surfaces as the create error — observable, never silenced (CLAUDE.md).

**Grep-fence (units.ts L27-29, quotes.ts L12-16):** import ONLY `withTenant`/`schema` from `@imbau/db` — never `createOwnerDb`/`appDb`.

### `packages/api/src/trpc/routers/projects.ts` — extend `updateSettings` (D-05)

**Analog:** the mutation itself (L46-60). Add an optional `leadsNotifyEmail` to the input and to the `.set(...)`:
```typescript
updateSettings: requireRole("owner", "developer")
  .input(z.object({
    id: z.uuid(),
    estado: z.enum(["borrador", "publicado"]).optional(),
    leadsNotifyEmail: z.email().nullable().optional(),   // Zod .email(), nullable (D-05)
  }))
  .mutation(async ({ ctx, input }) => {
    const rows = await withTenant(ctx.activeOrgId, (tx) =>
      tx.update(schema.projects)
        .set({ /* estado?, leadsNotifyEmail? — only provided keys */ })
        .where(eq(schema.projects.id, input.id))
        .returning({ id: schema.projects.id }));
    if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
    return rows[0];
  }),
```
Keep the existing `.returning()` 0-row → `NOT_FOUND` no-enumeration guard (L56-58). Today `estado` is required; making it optional (or adding a sibling field) is planner discretion — do not break the Phase 9 canary test.

### `packages/api/src/trpc/routers/_app.ts` — register `leadsRouter`

**Analog:** the same file (L13-28). Add the import + the `leads: leadsRouter` key alongside `units: unitsRouter`.

### `packages/storage/src/lead-email.ts` (NEW) — queue contract (pub-sub, D-06)

**Analog:** `packages/storage/src/quote-pdf.ts` — the EXACT idempotency mold. No bullmq import; only a const + type + pure options helper. The only change vs quote-pdf is the **jobId key** (`lead:{id}:created` instead of bare `quoteId`):
```typescript
export const LEAD_EMAIL_QUEUE = "lead-email";
export interface LeadEmailJobData {
  readonly leadId: string;
  readonly organizationId: string;
  readonly projectId: string;
}
export function leadEmailJobOptions(leadId: string): {
  jobId: string; attempts: number; backoff: { type: "exponential"; delay: number };
} {
  return { jobId: `lead:${leadId}:created`, attempts: 5, backoff: { type: "exponential", delay: 2000 } };
}
```
`jobId = lead:{id}:created` is the D-06 dedup: reintentos / re-seed / bulk never duplicate. Export from the `@imbau/storage` barrel like `QUOTE_PDF_QUEUE`.

### `packages/api/src/leads/runtime.ts` (NEW) — enqueue seam (pub-sub, D-06)

**Analog:** `packages/api/src/quotes/runtime.ts` — clone the LAZY, MEMOIZED queue construction (L39-75, `getEnv`/`getQueue`) and `enqueuePdf` (L84-86). Strip the R2/S3 half (leads need no R2). The email SEND happens in the worker, not here — this module ONLY pushes the job:
```typescript
export async function enqueueLeadEmail(data: LeadEmailJobData): Promise<void> {
  await getQueue().add("notify", data, leadEmailJobOptions(data.leadId));
}
```
Keep `maxRetriesPerRequest: null` on IORedis (L69) — required by BullMQ. Env parsed on first use, fails closed with the var NAME (never value). Only `redisEnv` (+ baseEnv) needed — no `r2Env`.

### `apps/worker/src/lead-email.ts` (NEW) — processor + failure report (event-driven, D-07)

**Analog:** `apps/worker/src/quote-pdf.ts` (`processQuotePdf` L53-103, `reportQuotePdfFailure` L116-127).

**Processor** reads the lead + resolves the recipient under `withTenant(organizationId, ...)` (worker has no session — tenant comes from the payload, same rationale as processQuotePdf L56-59), then calls `sendLeadNotification`:
```typescript
export async function processLeadEmail(job: Job<LeadEmailJobData>): Promise<void> {
  const { leadId, organizationId, projectId } = job.data;
  // 1. withTenant read: lead (nombre/contacto/origen resolved by join) + project (nombre, leadsNotifyEmail)
  // 2. recipient = project.leadsNotifyEmail ?? <org owners resolved by membership> (D-05 fallback)
  // 3. await sendLeadNotification({ to, lead, projectNombre, deepLink })
  // 4. logger.info({ leadId, organizationId }, "lead notification sent")
}
```
**Failure report — verbatim shape** of `reportQuotePdfFailure` (Sentry.captureException + pino, never swallowed):
```typescript
export function reportLeadEmailFailure(err: unknown, ctx: { leadId?: string; attempts?: number }): void {
  Sentry.captureException(err, { extra: { leadId: ctx.leadId, attempts: ctx.attempts } });
  logger.error({ err, leadId: ctx.leadId, queue: LEAD_EMAIL_QUEUE }, "lead email job failed");
}
```

### `apps/worker/src/index.ts` — register the lead-email worker

**Analog:** `createQuotePdfWorker` (L90-98) + its boot wiring (L165-177). Add:
```typescript
export function createLeadEmailWorker(connection: IORedis): Worker<LeadEmailJobData> {
  return new Worker<LeadEmailJobData>(LEAD_EMAIL_QUEUE, (job) => processLeadEmail(job), { connection, concurrency: 2 });
}
```
In `boot()`: declare `new Queue(LEAD_EMAIL_QUEUE, { connection })`, stand up the worker, and wire the `failed` handler → `reportLeadEmailFailure` (verbatim clone of L172-177). Add the handles to the boot return type. NO `upsertJobScheduler` — event-driven, not repeatable (same as quote-pdf).

### `packages/api/src/email/send-lead-notification.ts` (NEW) — dispatch (request-response, D-07)

**Analog:** `packages/api/src/email/send-invitation.ts` — clone the real-Resend / dev-console-fallback branch VERBATIM (L32-58). Dev (no `RESEND_API_KEY`) → `console.info` the lead summary + deep-link, return. Staging/prod → require `INVITE_FROM` (reuse the existing sender env — CONTEXT D-07; or add a `LEADS_FROM` if the planner wants a distinct sender, but `INVITE_FROM` reuse is the stated default), render the template, `resend.emails.send`, throw on `error`.
```typescript
if (!env.RESEND_API_KEY) { console.info(`[lead] ${to} :: ${data.nombre} — ${data.origen}`); return; }
const resend = new Resend(env.RESEND_API_KEY);
const { error } = await resend.emails.send({
  from: env.INVITE_FROM, to, subject: `Tenés un lead nuevo en ${data.projectNombre}`,
  react: LeadNotificationEmail({ ...data }),
});
if (error) throw new Error(`Resend failed to send the lead notification: ${error.message}`);
```

### `packages/api/src/email/templates/lead-notification.tsx` (NEW) — React Email (D-07)

**Analog:** `packages/api/src/email/templates/invitation.tsx` (L8-57). Same `@react-email/components` imports, same typed-props idiom, `<Html lang="es-AR">`, `<Preview>`, `<Heading>`, `<Text>` body lines, `<Button href={deepLink}>`. Copy from UI-SPEC §Notification email template:
- Subject: `Tenés un lead nuevo en {Proyecto}`
- Preheader: `{nombre} — {origen resuelto}`
- Heading: `Nuevo lead en {Proyecto}`
- Body: `Nombre: {nombre}` · `Contacto: {contacto}` · `Origen: {origen resuelto}` · `Proyecto: {Proyecto}`
- CTA button → deep link to the project's bandeja: `Ver el lead en el panel`

### Panel: `apps/panel/app/proyectos/[id]/leads/page.tsx` (REPLACE) + kanban/drawer islands (NEW)

**Server-page spine analog:** the current `leads/page.tsx` (L11-38) already has the correct spine — `await params` → `z.uuid()` guard → `notFound()` → `resolveProject` → `notFound()` → `resolveActiveRole` → `canWrite`. KEEP that spine; replace the placeholder `<main>` body with a client kanban island passing `projectId` + `canWrite` (exactly how `unidades/page.tsx` mounts `<UnitsGrid>`).

**Client-island analog:** `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx` (L1-90) — the settled panel data-tool shape:
- `"use client"` + `useTRPC()` + `useQuery(trpc.leads.listForProject.queryOptions({ projectId }))` (L65-67).
- `useMutation` + `queryClient.invalidateQueries({ queryKey })` refetch pattern (L69-72) for updateEstado/addNote/create.
- `canWrite` is COSMETIC defense-in-depth only; server `requireRole` is the authority (L4-7 comment).
- Inline `role="status"` / `role="alert"` feedback, NO global toast (Phase 10 D-04 — reaffirmed in UI-SPEC).
- Stage dot color map by estado — clone the `ESTADO_DOT` record idiom (units-grid L33-37), values per UI-SPEC Color table (Blueprint/Gris-500/amber/green-red-split).
- Tokens/fonts already wired (UI-SPEC §Wiring) — consume `tokens.css` as-is, no new token file.

New sub-islands to build from native elements + ARIA (UI-SPEC Component Inventory, no component library): column, lead card (draggable, `aria-label="Arrastrar para mover"`), lead drawer (`aria-label="Cerrar"`), timeline, add-note form, estado `<select>` (a11y-complete transition path — parity with drag), desenlace prompt modal, alta-manual form, notify-email settings field. All copy verbatim from UI-SPEC §Copywriting Contract.

### Seed: `packages/db/src/seed/content.ts` + `content-rows.ts` — email-seam bypass (D-01/D-06)

**Analog / existing behavior (already correct):** `content-rows.ts` inserts leads via `tx.insert(schema.leads).values(leadRows).onConflictDoNothing()` (L104) — a DIRECT DB insert that NEVER touches the `leads.create` router or `enqueueLeadEmail`. This is exactly why re-seed never spams email (belt + suspenders with the jobId dedup). If `desenlace` is seeded for the `cerrado` leads, add the field to `LeadDef` (content.ts L342-354) and map it into `leadRows` (content-rows.ts L79). No email-seam change needed — the seed path structurally bypasses it.

---

## Shared Patterns

### Authorization — `requireRole("owner","developer")` + `withTenant`
**Source:** `packages/api/src/trpc/middleware.ts` (L16-30) applied per-mutation as in `units.ts`.
**Apply to:** every leads write mutation (`create`, `updateEstado`, `addNote`) and the extended `projects.updateSettings`.
```typescript
updateEstado: requireRole("owner", "developer")
  .input(...).mutation(({ ctx, input }) => withTenant(ctx.activeOrgId, async (tx) => { ... }))
```
requireRole proves AUTHORIZATION, RLS proves TENANT ISOLATION — orthogonal, both load-bearing (units.ts L4-8). Cross-org/unknown id → invisible under RLS → 0 rows → `.returning()` guard → `NOT_FOUND` (no-enumeration).

### Enqueue as side-effect after successful persist (OUTSIDE withTenant, never await-inline the send)
**Source:** `packages/api/src/quotes/runtime.ts` `enqueuePdf` (L84-86) called from `quotes.ts` create (L218-222 — the enqueue sits AFTER the `withTenant(...)` promise resolves, at the mutation top level, NOT inside the tx callback).
**Apply to:** `leads.create` — call `enqueueLeadEmail` at the mutation's top level AFTER the `withTenant(...)` promise resolves; the enqueue is OUTSIDE the tx closure so a rolled-back insert enqueues nothing. The email SEND lives in the worker. A Redis push failure surfaces as the create error (observable), but the email delivery never blocks the request.

### Events audit per transition (in the same tx as the write)
**Source:** `units.ts` L282-287 (`tx.insert(schema.events).values({ organizationId, projectId, tipo, unitId })`) + `events.ts` schema.
**Apply to:** `leads.updateEstado` — an `events` row per estado transition, in the SAME withTenant tx (an audit row exists iff the mutation committed). Define stable English `tipo` consts like units.ts L49-50.

### BullMQ idempotency by jobId
**Source:** `quotePdfJobOptions(quoteId)` (`packages/storage/src/quote-pdf.ts` L32-42).
**Apply to:** `leadEmailJobOptions(leadId)` with `jobId = lead:${leadId}:created` — dedups reintentos/bulk/re-seed (D-06).

### Real-Resend / dev-console-fallback email dispatch
**Source:** `send-invitation.ts` L32-58.
**Apply to:** `send-lead-notification.ts` — identical branch (dev logs summary, staging/prod renders template + sends via `INVITE_FROM`, throws on Resend error).

### Observable failure reporting (Sentry + pino, never swallowed)
**Source:** `reportQuotePdfFailure` (`apps/worker/src/quote-pdf.ts` L116-127) wired via `worker.on("failed", ...)` in `index.ts` L172-177.
**Apply to:** `reportLeadEmailFailure` + its `on("failed")` handler in boot().

### Typed JSONB timeline (`LeadNote[]`)
**Source:** `json-schemas.ts` `leadNoteSchema`/`LeadNote` (L20-27) — `{ ts, autor?, nota, estadoPrev?, estadoNuevo? }`. Already the column's `$type`. The UI renders `leads.timeline` (JSONB) as the source of truth ordered by `ts` (D-04). Both auto-transition entries and free notes share this one shape.

---

## No Analog Found

_None._ Every file in this phase clones an existing mold — this is by design a replication phase.
The only genuinely new UI primitives (drag-and-drop kanban, drawer, modal) have no component-level
analog in the codebase (Phase 10 was a table/grid, not a board), but they inherit the panel's
**wiring, tokens, feedback pattern, and TRPC island shape** from `units-grid.tsx` — so they are a
role-match, not a green-field. Build them from native elements + ARIA per UI-SPEC (no component
library in the stack).

---

## Metadata

**Analog search scope:** `packages/api/src/trpc/routers/`, `packages/api/src/{quotes,leads,email}/`,
`packages/storage/src/`, `apps/worker/src/`, `packages/db/src/schema/`, `packages/db/src/seed/`,
`apps/panel/app/proyectos/[id]/`, `packages/config/env/`.
**Files scanned:** ~18 read in full/targeted.
**Pattern extraction date:** 2026-07-24
</content>
</invoke>
