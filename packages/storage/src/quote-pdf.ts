// The quote-PDF pipeline contract — the single source of truth SHARED by the producer
// (the `quotes.create` enqueue, fase 7) and the consumer (the worker PDF processor, fase 7).
//
// This phase ships the CONTRACT ONLY: no producer enqueues here and no consumer drains it
// (D-13 — contrato sí, producer no). Wiring an enqueue now would leave jobs rotting in Redis
// with nothing to process them; the enqueue and the worker land together in fase 7.
//
// This module intentionally does NOT import bullmq: it declares only a const, a type, and a
// pure helper returning a plain options object. Keeping @imbau/storage free of a bullmq
// dependency lets both sides of fase 7 depend on this shared contract without @imbau/storage
// pulling in Redis/BullMQ — each app constructs its own Queue/Worker around these values
// (mirrors the MEDIA_QUEUE molecule).

// The BullMQ queue/channel name. ONE constant shared by producer + consumer so they can never
// drift onto mismatched channel names.
export const QUOTE_PDF_QUEUE = "quote-pdf";

// The job payload the fase-7 producer enqueues and the worker consumes. organizationId travels
// in the payload because the worker has no session to derive the tenant from — it feeds this
// into withTenant for the RLS-correct read/write, same rationale as MediaJobData.
export interface QuotePdfJobData {
  readonly quoteId: string;
  readonly organizationId: string;
  readonly projectId: string;
}

// Deterministic BullMQ job options for a quote-PDF job. PURE — no I/O.
//   - jobId = quoteId: BullMQ dedups re-enqueues of the same quote, so a retried enqueue can
//     never stack duplicate PDF jobs for one quote (the PDF-02 idempotency seam).
//   - attempts = 5 with exponential backoff (delay 2000ms): transient R2/Postgres failures are
//     retried with growing spacing rather than hammering a degraded dependency.
export function quotePdfJobOptions(quoteId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
} {
  return {
    jobId: quoteId,
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  };
}
