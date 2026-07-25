// leads router (LEADS-01..04) — the panel's lead-bandeja seam: the pipeline state machine, the
// append-only timeline, and the load-bearing create+enqueue seam.
//
// This is the D2 clone of the Phase 9 `projects.updateSettings` mold and the D1 `units.ts` write
// mold: every WRITE is a requireRole("owner","developer") mutation routed exclusively through
// withTenant(ctx.activeOrgId) on the unprivileged app pool — RLS proves TENANT ISOLATION,
// requireRole proves AUTHORIZATION (they are orthogonal; RLS alone would let a viewer write, so the
// explicit role gate is load-bearing — the Phase 9 lesson). A cross-org / non-existent id is
// INVISIBLE under RLS, so a plain UPDATE affects 0 rows → the .returning() guard turns the silent
// no-op into NOT_FOUND (no-enumeration, identical to the cross-org response).
//
// State machine (LEADS-02/D-02): the destination estado MUST be one of the 4 leadEstadoEnum values
// (a local z.enum mirror) — "máquina impuesta" = destination ∈ the 4 values, NOT linear (free
// transitions incl. reopening a cerrado). A transition INTO `cerrado` REQUIRES `desenlace`
// (ganado/perdido) via a Zod refine (400 without it); moving OUT of cerrado clears it.
//
// Timeline (LEADS-03/D-04): the JSONB `leads.timeline` (LeadNote[]) is the UI source of truth,
// ordered by `ts`. It fills two ways — every updateEstado auto-appends a transition entry
// (estadoPrev→estadoNuevo, autor from ctx.session), and addNote appends a free-text note. Every
// transition ALSO inserts an `events` audit row in the SAME tx (an audit row exists iff the write
// committed). Notes emit NO events row and trigger NO email.
//
// Create+enqueue seam (LEADS-04/D-01/D-06): `create` (alta manual) inserts the lead inside
// withTenant and, AFTER that promise resolves — OUTSIDE the tx closure, at the mutation top level —
// enqueues the notification email (idempotent by jobId=lead:{id}:created). The enqueue is the
// post-commit side-effect of a successful persist: a rolled-back insert enqueues ZERO jobs and the
// worker can never race an uncommitted row. updateEstado/addNote NEVER enqueue (D-06: only lead
// creation notifies). A Redis push failure surfaces as the create error — observable, never silenced.
//
// This router imports ONLY withTenant/schema from @imbau/db — never the elevated owner-pool clients
// (the Phase 9/10 grep-fence). The Redis side effect lives behind ../../leads/runtime, whose queue
// is lazy-memoized so importing this router opens NO Redis socket.
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, schema } from "@imbau/db";
import { router, protectedProcedure } from "../init";
import { requireRole } from "../middleware";
import { enqueueLeadEmail } from "../../leads/runtime";

// Stable English events.tipo constant (mirrors units.ts EVENT_ESTADO_CHANGED). Single-sourced so
// the audit vocabulary never drifts between the mutation and any future consumer.
const EVENT_LEAD_ESTADO_CHANGED = "lead_estado_changed";

// The valid lead estados — a local z.enum mirror of packages/db leadEstadoEnum (ASCII negociacion).
const LEAD_ESTADOS = ["nuevo", "contactado", "negociacion", "cerrado"] as const;
type LeadEstado = (typeof LEAD_ESTADOS)[number];

// Display labels (UI-SPEC §Color table) — the timeline auto-note copy MUST NOT surface the raw enum
// value (e.g. `Negociación`, never `negociacion`).
const ESTADO_LABEL: Record<LeadEstado, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  negociacion: "Negociación",
  cerrado: "Cerrado",
};

// The resolved origen of a lead (LEADS-01): a broker/unidad/cotización pointer resolved by a
// tenant-scoped join, or `Directo` when every pointer is null.
type OrigenTipo = "broker" | "unidad" | "cotizacion" | "directo";

// The display name of the logged-in developer for the timeline `autor` field (D-04).
function autorFrom(session: { user: { name?: string | null; email: string } }): string {
  return session.user.name ?? session.user.email;
}

export const leadsRouter = router({
  // Bandeja read (LEADS-01): owner/developer/viewer all read the leads of the project; RLS scopes
  // every row to the active org, so a cross-org projectId returns an empty array (never a leak). No
  // app-layer org filter — the policy does it. origen is resolved by leftJoins to brokers/units/
  // quotes on the composite (id, organizationId); a lead with all pointers null resolves to `Directo`.
  listForProject: protectedProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .select({
            id: schema.leads.id,
            nombre: schema.leads.nombre,
            contacto: schema.leads.contacto,
            origen: schema.leads.origen,
            estado: schema.leads.estado,
            desenlace: schema.leads.desenlace,
            timeline: schema.leads.timeline,
            brokerId: schema.leads.brokerId,
            unitId: schema.leads.unitId,
            quoteId: schema.leads.quoteId,
            brokerNombre: schema.brokers.nombre,
            unitIdentificador: schema.units.identificador,
            quoteRefId: schema.quotes.id,
          })
          .from(schema.leads)
          .leftJoin(
            schema.brokers,
            and(
              eq(schema.leads.brokerId, schema.brokers.id),
              eq(schema.leads.organizationId, schema.brokers.organizationId),
            ),
          )
          .leftJoin(
            schema.units,
            and(
              eq(schema.leads.unitId, schema.units.id),
              eq(schema.leads.organizationId, schema.units.organizationId),
            ),
          )
          .leftJoin(
            schema.quotes,
            and(
              eq(schema.leads.quoteId, schema.quotes.id),
              eq(schema.leads.organizationId, schema.quotes.organizationId),
            ),
          )
          .where(eq(schema.leads.projectId, input.projectId));

        return rows.map((r) => {
          let origenResuelto: { tipo: OrigenTipo; label: string };
          if (r.brokerId && r.brokerNombre !== null) {
            origenResuelto = { tipo: "broker", label: r.brokerNombre };
          } else if (r.unitId && r.unitIdentificador !== null) {
            origenResuelto = { tipo: "unidad", label: r.unitIdentificador };
          } else if (r.quoteId && r.quoteRefId !== null) {
            origenResuelto = { tipo: "cotizacion", label: r.quoteRefId };
          } else {
            origenResuelto = { tipo: "directo", label: "Directo" };
          }
          return {
            id: r.id,
            nombre: r.nombre,
            contacto: r.contacto,
            origen: r.origen,
            estado: r.estado,
            desenlace: r.desenlace,
            timeline: r.timeline,
            origenResuelto,
          };
        });
      }),
    ),

  // Pipeline transition (LEADS-02/D-02, D-03, D-04). requireRole gates authorization; the
  // .returning() 0-row guard turns a cross-org/unknown id into NOT_FOUND (no-enumeration). The
  // destination estado is validated against the 4-value enum mirror; a transition INTO `cerrado`
  // requires `desenlace` (Zod refine → 400). One withTenant tx: read current estado (for
  // estadoPrev), UPDATE estado + desenlace + the appended auto LeadNote, then insert the events
  // audit row IN THE SAME TX. Moving out of `cerrado` clears desenlace. NO enqueue (D-06).
  updateEstado: requireRole("owner", "developer")
    .input(
      z
        .object({
          projectId: z.uuid(),
          leadId: z.uuid(),
          estado: z.enum(LEAD_ESTADOS),
          desenlace: z.enum(["ganado", "perdido"]).optional(),
        })
        .refine((v) => v.estado !== "cerrado" || v.desenlace !== undefined, {
          message: "Al cerrar un lead hay que indicar si fue ganado o perdido.",
          path: ["desenlace"],
        }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const current = await tx
          .select({
            estado: schema.leads.estado,
            timeline: schema.leads.timeline,
          })
          .from(schema.leads)
          .where(
            and(
              eq(schema.leads.id, input.leadId),
              eq(schema.leads.projectId, input.projectId),
            ),
          );
        const prev = current[0];
        if (!prev) throw new TRPCError({ code: "NOT_FOUND" });

        // Move INTO cerrado carries the desenlace; any other destination clears it.
        const desenlace = input.estado === "cerrado" ? input.desenlace ?? null : null;
        const autoNote = {
          ts: new Date().toISOString(),
          autor: autorFrom(ctx.session),
          nota: `movió el lead de ${ESTADO_LABEL[prev.estado]} a ${ESTADO_LABEL[input.estado]}`,
          estadoPrev: prev.estado,
          estadoNuevo: input.estado,
        };

        const rows = await tx
          .update(schema.leads)
          .set({
            estado: input.estado,
            desenlace,
            timeline: [...prev.timeline, autoNote],
          })
          .where(
            and(
              eq(schema.leads.id, input.leadId),
              eq(schema.leads.projectId, input.projectId),
            ),
          )
          .returning({
            id: schema.leads.id,
            estado: schema.leads.estado,
            desenlace: schema.leads.desenlace,
          });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        await tx.insert(schema.events).values({
          organizationId: ctx.activeOrgId,
          projectId: input.projectId,
          tipo: EVENT_LEAD_ESTADO_CHANGED,
        });
        return rows[0];
      }),
    ),

  // Free-text note (LEADS-03/D-04). Same requireRole + withTenant + .returning() NOT_FOUND mold.
  // Appends a `{ ts, autor, nota }` LeadNote to the append-only timeline. Emits NO events row and
  // triggers NO email (D-06).
  addNote: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        leadId: z.uuid(),
        nota: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const current = await tx
          .select({ timeline: schema.leads.timeline })
          .from(schema.leads)
          .where(
            and(
              eq(schema.leads.id, input.leadId),
              eq(schema.leads.projectId, input.projectId),
            ),
          );
        const prev = current[0];
        if (!prev) throw new TRPCError({ code: "NOT_FOUND" });

        const note = {
          ts: new Date().toISOString(),
          autor: autorFrom(ctx.session),
          nota: input.nota,
        };

        const rows = await tx
          .update(schema.leads)
          .set({ timeline: [...prev.timeline, note] })
          .where(
            and(
              eq(schema.leads.id, input.leadId),
              eq(schema.leads.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.leads.id });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return rows[0];
      }),
    ),

  // Alta manual — the load-bearing create+enqueue seam (LEADS-04/D-01/D-06). Clones the quotes.ts
  // create shape EXACTLY: withTenant is called at the mutation TOP LEVEL and RESOLVES to the
  // inserted rows; the enqueue happens AFTER that promise resolves, OUTSIDE the withTenant closure.
  // The insert seeds a t=0 creation LeadNote so the drawer never opens empty (origen traced from
  // t=0). Referencing inserted[0] on the next line proves the tx has committed — a rolled-back
  // insert throws before the enqueue, so it enqueues zero jobs. NEVER nest enqueueLeadEmail inside
  // the withTenant(...) arrow: a pre-commit enqueue would fire an email for a lead that later rolls
  // back and let the worker race a not-yet-committed row (D-06).
  create: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        nombre: z.string().min(1),
        contacto: z.string().min(1),
        origen: z.string(),
        brokerId: z.uuid().optional(),
        unitId: z.uuid().optional(),
        quoteId: z.uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const autor = autorFrom(ctx.session);
      // 1. Persist INSIDE the tenant tx; withTenant RESOLVES to the inserted rows, then the tx closes.
      const inserted = await withTenant(ctx.activeOrgId, (tx) =>
        tx
          .insert(schema.leads)
          .values({
            organizationId: ctx.activeOrgId,
            projectId: input.projectId,
            nombre: input.nombre,
            contacto: input.contacto,
            origen: input.origen,
            brokerId: input.brokerId,
            unitId: input.unitId,
            quoteId: input.quoteId,
            timeline: [
              {
                ts: new Date().toISOString(),
                autor,
                nota: "registró el lead",
              },
            ],
          })
          .returning({ id: schema.leads.id }),
      );
      const row = inserted[0];
      // A RETURNING insert always yields the inserted row; guard for the typed index access.
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo persistir el lead.",
        });
      }
      // 2. Enqueue AFTER the persist commits — OUTSIDE withTenant, at the mutation top level. A
      //    Redis push failure surfaces as the create error (observable), never silenced.
      await enqueueLeadEmail({
        leadId: row.id,
        organizationId: ctx.activeOrgId,
        projectId: input.projectId,
      });
      return { leadId: row.id };
    }),
});
