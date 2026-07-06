// The quote-PDF pipeline's tenant-scoped DB seam (PDF-01/PDF-02) — the EXACT analog of
// media-store.ts. Two verbs, both run as `app_authenticated` through @imbau/db's withTenant
// (never the owner/BYPASSRLS role):
//   - readQuoteForPdf: ONE withTenant transaction that reads the frozen snapshot + pdfKey +
//     the NON-MONETARY descriptors (unit/floor/project) the processor needs for the header +
//     deep-link. Montos are NEVER read from these tables — they come only from snapshot.result
//     via toPdfModel (D-07/T-04-06). RLS scopes every read to orgId.
//   - writePdfKey: the SINGLE atomic pdfKey write-back after render + upload succeed.
//
// WHY withTenant and NOT the owner role (same rationale as media-store): `quotes_tenant` is
// `FOR ALL TO appAuthenticated` — there is NO policy granting the owner access, and the table
// has RLS enabled, so an owner UPDATE hits default-deny. The worker has no Better Auth session,
// so it takes organizationId from the job payload (placed there by the authenticated enqueuer in
// 07-03) and feeds it into withTenant, which sets the transaction-scoped
// app.current_organization_id GUC — satisfying quotes_tenant.withCheck.
//
// quote-pdf.ts imports ONLY these two verbs from here; it never opens a transaction inline. That
// keeps this the single, mockable read/write point: quote-pdf.test.ts vi.mocks this module.
import { withTenant, schema } from "@imbau/db";
import { eq } from "drizzle-orm";
import type { QuoteResult } from "@imbau/quoting";

// The narrowed interior of quotes.snapshot the processor consumes. The column is typed
// `QuoteSnapshot` ({ version: 1 } + passthrough) because packages/quoting owns the calc shape
// (D-13); the producer (07-03) persists `{ version, inputs, result, cacPeriodo }`. We narrow to
// the fields the PDF reads at this DB boundary so the processor stays cast-free — montos come
// ONLY from `result` (never recomputed, T-04-06).
export interface QuotePdfSnapshot {
  readonly result: QuoteResult;
  readonly cacPeriodo: string | null;
}

// Everything the processor needs to render + persist one quote PDF: the frozen snapshot interior,
// the current pdfKey (null until first render — the D-11 short-circuit key), and the NON-MONETARY
// descriptors read live under RLS for the header + deep-link.
export interface QuoteForPdf {
  readonly snapshot: QuotePdfSnapshot;
  readonly pdfKey: string | null;
  readonly proyecto: string;
  readonly projectSlug: string;
  readonly unidadIdentificador: string;
  readonly tipologia: string | null;
  readonly m2: string | null;
  readonly piso: number;
  readonly unitId: string;
  readonly paymentPlanId: string;
}

/**
 * Read the frozen snapshot + pdfKey + the unit/floor/project descriptors for one quote, all in a
 * SINGLE withTenant(orgId) transaction (app_authenticated + the tenant GUC). RLS scopes every
 * read to orgId. NO monetary column is read from units/floors/projects — only descriptors (D-07);
 * the amounts live exclusively in snapshot.result.
 *
 * A missing quote row (already-consumed / wrong org) throws so BullMQ marks the job failed — never
 * a silent empty PDF (CLAUDE.md: errors observable, never swallowed).
 */
export async function readQuoteForPdf(
  orgId: string,
  quoteId: string,
): Promise<QuoteForPdf> {
  return withTenant(orgId, async (tx) => {
    const [quote] = await tx
      .select({
        snapshot: schema.quotes.snapshot,
        pdfKey: schema.quotes.pdfKey,
        unitId: schema.quotes.unitId,
        paymentPlanId: schema.quotes.paymentPlanId,
        projectId: schema.quotes.projectId,
      })
      .from(schema.quotes)
      .where(eq(schema.quotes.id, quoteId));
    if (!quote) {
      throw new Error(
        `quote not found for pdf render (id ${quoteId}) — already consumed or wrong tenant`,
      );
    }

    const [unit] = await tx
      .select({
        identificador: schema.units.identificador,
        tipologia: schema.units.tipologia,
        m2: schema.units.m2,
        floorId: schema.units.floorId,
      })
      .from(schema.units)
      .where(eq(schema.units.id, quote.unitId));
    if (!unit) {
      throw new Error(`unit not found for quote pdf (unit ${quote.unitId})`);
    }

    const [floor] = await tx
      .select({ numero: schema.floors.numero })
      .from(schema.floors)
      .where(eq(schema.floors.id, unit.floorId));
    if (!floor) {
      throw new Error(`floor not found for quote pdf (floor ${unit.floorId})`);
    }

    const [project] = await tx
      .select({ nombre: schema.projects.nombre, slug: schema.projects.slug })
      .from(schema.projects)
      .where(eq(schema.projects.id, quote.projectId));
    if (!project) {
      throw new Error(`project not found for quote pdf (project ${quote.projectId})`);
    }

    return {
      // The column is typed QuoteSnapshot (passthrough); narrow it to the interior the PDF reads.
      snapshot: quote.snapshot as unknown as QuotePdfSnapshot,
      pdfKey: quote.pdfKey,
      proyecto: project.nombre,
      projectSlug: project.slug,
      unidadIdentificador: unit.identificador,
      tipologia: unit.tipologia,
      m2: unit.m2,
      piso: floor.numero,
      unitId: quote.unitId,
      paymentPlanId: quote.paymentPlanId,
    };
  });
}

/**
 * Persist the rendered PDF's key on the quote row in a SINGLE atomic UPDATE, scoped to orgId via
 * withTenant (app_authenticated + the tenant GUC) — never the owner pool (T-07-03).
 *
 * Idempotent under retry: the key is deterministic (quotePdfKey), so a re-run writes the SAME
 * value; combined with the D-11 short-circuit the PDF is frozen after the first successful render.
 */
export async function writePdfKey(
  orgId: string,
  quoteId: string,
  pdfKey: string,
): Promise<void> {
  await withTenant(orgId, (tx) =>
    tx
      .update(schema.quotes)
      .set({ pdfKey })
      .where(eq(schema.quotes.id, quoteId)),
  );
}
