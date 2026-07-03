// quotes router (QUOTE-01/QUOTE-02) — the server-side emission core (RESEARCH Pattern 5).
//
// Two ANONYMOUS publicProcedures: `compute` (resolve + calc, NO DB write) and `create`
// (resolve + calc + persist the versioned snapshot). Both derive the tenant SERVER-SIDE from
// the publicado project via withAnon — a client-supplied orgId, price, or CAC value is NEVER
// read (T-05-01/T-05-03/D-03). CAC + prices + the snapshot insert flow only through
// withTenant(orgId) on the app pool; quotes/cac_index stay tenant-private (no anon policy is
// ever touched — Pitfall 5 / T-05-02). Numeric columns (anticipoPct, cac.valor) pass STRAIGHT
// through as strings — never parseFloat/Number'd (Pitfall 3 / D-14).
//
// This router imports ONLY the sanctioned data-access surface of @imbau/db (withTenant,
// withAnon, schema) — never the elevated/owner-pool clients (T-05-07 grep-fence, mirrors
// projects.ts / media.ts).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { withAnon, withTenant, schema } from "@imbau/db";
import {
  calcQuote,
  ENGINE_VERSION,
  QuoteError,
  type QuoteInput,
} from "@imbau/quoting";
import { router, publicProcedure } from "../init";

// The single input surface shared by both procedures. Only IDs + modalidad cross the boundary —
// never an orgId, price, or CAC value (the server re-derives all of those, T-05-03).
const quoteInputSchema = z.object({
  projectId: z.uuid(),
  unitId: z.uuid(),
  paymentPlanId: z.uuid(),
  modalidad: z.enum(["contado", "financiado"]),
});
type QuoteProcedureInput = z.infer<typeof quoteInputSchema>;

// Shared resolve + compute core for compute/create. Resolves the org from the publicado project
// (withAnon), then reads plan + prices + CAC and computes the quote inside a single
// withTenant(orgId) transaction. Returns everything create needs to persist the snapshot.
async function resolveAndQuote(input: QuoteProcedureInput) {
  // 1. Org resolve (D-03): the anon policy filters projects to estado='publicado', so a
  // borrador/archivado/unknown project id yields no row → NOT_FOUND. The orgId is read from the
  // resolved row, NEVER from the request body.
  const projectRows = await withAnon((tx) =>
    tx
      .select({
        id: schema.projects.id,
        organizationId: schema.projects.organizationId,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, input.projectId)),
  );
  const project = projectRows[0];
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Proyecto no publicado." });
  }
  const orgId = project.organizationId;

  // 2. Tenant-scoped reads + compute under the app pool (RLS scopes every row to orgId).
  return withTenant(orgId, async (tx) => {
    // Payment plan — org-pinned by RLS, additionally checked against the resolved project.
    const planRows = await tx
      .select()
      .from(schema.paymentPlans)
      .where(
        and(
          eq(schema.paymentPlans.id, input.paymentPlanId),
          eq(schema.paymentPlans.projectId, input.projectId),
        ),
      )
      .limit(1);
    const plan = planRows[0];
    if (!plan) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No se encontró el plan de pago para esta unidad.",
      });
    }

    // Unit prices joined to their price list (org-pinned join) to read the list nombre + moneda.
    // The contado USD row is the one whose nombre matches /contado/i; the other USD row is the
    // financiado price. The engine does NO discount math — it needs both resolved USD prices.
    const priceRows = await tx
      .select({
        precio: schema.unitPrices.precio,
        nombre: schema.priceLists.nombre,
        moneda: schema.priceLists.moneda,
      })
      .from(schema.unitPrices)
      .innerJoin(
        schema.priceLists,
        and(
          eq(schema.unitPrices.priceListId, schema.priceLists.id),
          eq(schema.unitPrices.organizationId, schema.priceLists.organizationId),
        ),
      )
      .where(eq(schema.unitPrices.unitId, input.unitId));

    const usdRows = priceRows.filter((r) => r.moneda === "USD");
    const contadoRow = usdRows.find((r) => /contado/i.test(r.nombre));
    const financiadoRow = usdRows.find((r) => !/contado/i.test(r.nombre));
    const precioContadoUsd = contadoRow?.precio;
    const precioFinanciadoUsd = financiadoRow?.precio;
    if (precioContadoUsd === undefined || precioFinanciadoUsd === undefined) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No hay precios de contado y financiado cargados para esta unidad.",
      });
    }

    // CAC (D-07/D-09): the max-período row for the org, no freshness cutoff. May be empty.
    const cacRows = await tx
      .select({
        periodo: schema.cacIndex.periodo,
        valor: schema.cacIndex.valor,
      })
      .from(schema.cacIndex)
      .orderBy(desc(schema.cacIndex.periodo))
      .limit(1);
    const cacRow = cacRows[0];

    // Missing-CAC guard (D-08): a CAC-adjusted financiado quote with no CAC row is a precondition
    // failure the operator can fix in the panel — NEVER a cryptic 500.
    if (input.modalidad === "financiado" && plan.ajuste === "CAC" && !cacRow) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "No hay índice CAC cargado para este proyecto. Cargá el CAC en el panel.",
      });
    }

    // Map rows → QuoteInput. Numeric strings (anticipoPct, cac.valor) pass STRAIGHT through —
    // NEVER parseFloat/Number'd (Pitfall 3 / D-14). Integer columns (precio) are already numbers.
    const quoteInput: QuoteInput = {
      modalidad: input.modalidad,
      precioContadoUsd,
      precioFinanciadoUsd,
      plan: {
        anticipoPct: plan.anticipoPct,
        cuotas: plan.cuotas,
        ajuste: plan.ajuste,
        refuerzos: plan.refuerzos,
      },
      cac: cacRow ? { periodo: cacRow.periodo, valor: cacRow.valor } : undefined,
    };

    // Compute with domain-error mapping (D-05/D-08): a degenerate input makes the engine throw a
    // typed QuoteError, which we re-throw as BAD_REQUEST carrying the QuoteError as `cause` so the
    // errorFormatter surfaces data.quoteErrorCode. We NEVER normalize it into a wrong quote.
    try {
      const result = calcQuote(quoteInput);
      return {
        orgId,
        quoteInput,
        result,
        cacPeriodo: cacRow ? cacRow.periodo : null,
      };
    } catch (err) {
      if (err instanceof QuoteError) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message || "Datos de cotización inválidos.",
          cause: err,
        });
      }
      throw err;
    }
  });
}

export const quotesRouter = router({
  // Resolve + compute, NO DB write — the on-screen quote for the anon buyer (QUOTE-01).
  compute: publicProcedure
    .input(quoteInputSchema)
    .mutation(async ({ input }) => {
      const { result } = await resolveAndQuote(input);
      return result;
    }),

  // Resolve + compute + persist the versioned snapshot (QUOTE-02). The snapshot is the
  // finance-only audit envelope { version, inputs, result, cacPeriodo } — no buyer PII (D-04).
  create: publicProcedure
    .input(quoteInputSchema)
    .mutation(async ({ input }) => {
      const { orgId, quoteInput, result, cacPeriodo } =
        await resolveAndQuote(input);
      const snapshot = {
        version: ENGINE_VERSION,
        inputs: quoteInput,
        result,
        cacPeriodo,
      };
      const values = schema.quoteInsertSchema.parse({
        organizationId: orgId,
        projectId: input.projectId,
        unitId: input.unitId,
        paymentPlanId: input.paymentPlanId,
        snapshot,
      });
      const inserted = await withTenant(orgId, (tx) =>
        tx.insert(schema.quotes).values(values).returning({ id: schema.quotes.id }),
      );
      const row = inserted[0];
      // A RETURNING insert always yields the inserted row; guard for the typed index access.
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo persistir la cotización.",
        });
      }
      return { quoteId: row.id, result };
    }),
});
