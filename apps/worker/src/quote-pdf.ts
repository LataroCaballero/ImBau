// The quote-PDF pipeline (PDF-01/PDF-02) — the heart of fase 7. Mirrors media.ts: the ONE thin
// impure executor that wires the pure react-pdf render to the I/O seams (quote-pdf-runtime for
// R2 + WEB_PUBLIC_BASE_URL, quote-pdf-store for the withTenant read + single pdfKey write). NO R2
// client or DB transaction is constructed inline here — all I/O is delegated, so quote-pdf.test.ts
// can vi.mock those seams (+ the doc + the renderer) and prove the orchestration without infra.
//
// Triple idempotency guarantees a BullMQ retry never duplicates an R2 object (PDF-02):
//   1. SHORT-CIRCUIT on pdfKey (D-11) — a rendered quote is frozen forever, never re-rendered.
//   2. DETERMINISTIC quotePdfKey — a retry that DOES render overwrites the SAME object in place.
//   3. jobId=quoteId dedup (quotePdfJobOptions, set by the producer in 07-03) — one job per quote.
//
// The amounts come ONLY from snapshot.result via toPdfModel — the worker NEVER re-runs calcQuote
// (T-04-06): recomputing per surface is exactly how the number on screen, in WhatsApp and in the
// PDF would drift apart. Descriptors (unit/floor/project) are read LIVE but are non-monetary (D-07).
import type { Job } from "bullmq";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import * as Sentry from "@sentry/node";
import {
  quotePdfKey,
  QUOTE_PDF_QUEUE,
  type QuotePdfJobData,
} from "@imbau/storage";
import { toPdfModel } from "@imbau/quoting";
import { logger } from "@imbau/observability";
import { readQuoteForPdf, writePdfKey } from "./quote-pdf-store";
import { putPdf, WEB_PUBLIC_BASE_URL } from "./quote-pdf-runtime";
import { QuoteDoc, type QuoteHeader } from "./quote-pdf-doc";

// Render-time emission date, formatted es-AR in America/Argentina/Buenos_Aires (CLAUDE.md: render
// in AR tz). quotes has NO createdAt column, so "fecha de emisión" is the first-render date — and
// the D-11 short-circuit freezes it: a retry never re-renders, so the date never drifts.
function formatFechaEsAr(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * The ONLY side effect of the pipeline (PDF-01/PDF-02). Reads the frozen snapshot + descriptors
 * under withTenant, short-circuits if the PDF already exists (D-11), lays out the snapshot via
 * toPdfModel (NEVER recompute — D-07/T-04-06), builds the deep-link QR (D-08), renders QuoteDoc to
 * a Buffer, uploads it to the deterministic R2 key, and writes pdfKey back in ONE withTenant UPDATE
 * — in that order (put before write, so pdfKey never points at an object that was never uploaded).
 *
 * organizationId comes from the job payload — the worker has no session (same rationale as media).
 * Any error propagates so BullMQ marks the job failed; the failed handler (Sentry + pino, via
 * reportQuotePdfFailure) is wired in index.ts boot(). On success a single structured pino line logs.
 */
export async function processQuotePdf(
  job: Job<QuotePdfJobData>,
): Promise<void> {
  const { quoteId, organizationId, projectId } = job.data;

  // 1. read the frozen snapshot + pdfKey + descriptors under RLS (withTenant).
  const row = await readQuoteForPdf(organizationId, quoteId);

  // 2. SHORT-CIRCUIT (D-11): the PDF is frozen forever once rendered — never re-render/re-upload.
  if (row.pdfKey) {
    return;
  }

  // 3. lay out the snapshot — montos SOLO del snapshot.result (D-07); calcQuote never runs here.
  // The snapshot holds exactly one modalidad, so the PDF reflects only the emitted modalidad — no
  // contado-vs-financiado comparison (D-05).
  const model = toPdfModel(row.snapshot.result);

  // 4. build the cotizador deep-link (D-08) server-side + its QR data-URL.
  const deepLink = `${WEB_PUBLIC_BASE_URL}/p/${row.projectSlug}/cotizador?u=${row.unitId}&plan=${row.paymentPlanId}`;
  const qrPng = await QRCode.toDataURL(deepLink, { margin: 1, width: 256 });

  // 5. build the header — every field a string (the worker never re-formats numbers, T-04-06).
  const header: QuoteHeader = {
    proyecto: row.proyecto,
    unidad: row.unidadIdentificador,
    piso: String(row.piso),
    tipologia: row.tipologia ?? "",
    m2: row.m2 ?? "",
    fecha: formatFechaEsAr(new Date()),
    cacPeriodo: row.snapshot.cacPeriodo ?? "—",
    // ref: first 8 of quotes.id, traceable back to the row (D-07).
    ref: quoteId.slice(0, 8).toUpperCase(),
    deepLink,
  };

  // 6. render the document to a Buffer (pure layout — no I/O in QuoteDoc).
  const pdf = await renderToBuffer(QuoteDoc({ model, header, qrPng }));

  // 7. upload to the deterministic key (overwrite on retry — never duplicates).
  const key = quotePdfKey(organizationId, projectId, quoteId);
  await putPdf(key, pdf);

  // 8. single atomic pdfKey write-back under RLS (app_authenticated + GUC).
  await writePdfKey(organizationId, quoteId, key);

  logger.info(
    { quoteId, organizationId },
    "quote pdf rendered + persisted",
  );
}

/**
 * Observable failure reporting for the quote-PDF pipeline (D-10 / T-07-10). A job that throws
 * (the withTenant read, QR/render, the R2 put, or the pdfKey write-back) is marked failed by
 * BullMQ; index.ts wires `quotePdfWorker.on("failed", …)` to delegate here. This routes the error
 * to BOTH Sentry (captureException with quoteId/attempts as searchable context) AND the structured
 * pino logger — the error is NEVER swallowed (CLAUDE.md: errors observable, never silenced).
 *
 * It does NOT re-throw or swallow: it only reports. BullMQ owns the retry policy (jobId=quoteId
 * dedup + attempts/exponential backoff, set by the producer's quotePdfJobOptions in 07-03). Only
 * structured fields (quoteId, attempts, queue) are emitted — never the raw payload (V7).
 */
export function reportQuotePdfFailure(
  err: unknown,
  ctx: { quoteId?: string; attempts?: number },
): void {
  Sentry.captureException(err, {
    extra: { quoteId: ctx.quoteId, attempts: ctx.attempts },
  });
  logger.error(
    { err, quoteId: ctx.quoteId, queue: QUOTE_PDF_QUEUE },
    "quote pdf job failed",
  );
}
