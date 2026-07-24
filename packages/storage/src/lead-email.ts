// The lead-email pipeline contract — the single source of truth SHARED by the producer
// (the `leads.create` enqueue, Plan 03) and the consumer (the worker lead-email processor,
// Plan 04). Mirrors the quote-pdf molecule (D-06).
//
// This module intentionally does NOT import bullmq: it declares only a const, a type, and a
// pure helper returning a plain options object. Keeping @imbau/storage free of a bullmq
// dependency lets both sides depend on this shared contract without @imbau/storage pulling in
// Redis/BullMQ — each app constructs its own Queue/Worker around these values (mirrors the
// MEDIA_QUEUE / QUOTE_PDF_QUEUE molecules).

// The BullMQ queue/channel name. ONE constant shared by producer + consumer so they can never
// drift onto mismatched channel names.
export const LEAD_EMAIL_QUEUE = "lead-email";

// The job payload the producer enqueues and the worker consumes. IDS ONLY — no PII, no
// secrets (T-11-03): the worker re-reads the lead from Postgres under RLS via withTenant, so
// nothing sensitive ever travels through Redis. organizationId travels in the payload because
// the worker has no session to derive the tenant from — it feeds this into withTenant for the
// RLS-correct read, same rationale as QuotePdfJobData.
export interface LeadEmailJobData {
  readonly leadId: string;
  readonly organizationId: string;
  readonly projectId: string;
}

// Deterministic BullMQ job options for a lead-email job. PURE — no I/O.
//   - jobId = `lead:<leadId>:created`: BullMQ dedups re-enqueues carrying the same jobId, so a
//     retried enqueue, a bulk import, or a re-seed can never stack duplicate notification sends
//     for one lead (the LEADS-04 / T-11-08 idempotency seam).
//   - attempts = 5 with exponential backoff (delay 2000ms): transient Resend/Redis failures are
//     retried with growing spacing rather than hammering a degraded dependency.
export function leadEmailJobOptions(leadId: string): {
  jobId: string;
  attempts: number;
  backoff: { type: "exponential"; delay: number };
} {
  return {
    jobId: `lead:${leadId}:created`,
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  };
}
