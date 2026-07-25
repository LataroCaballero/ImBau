// Public barrel for @imbau/storage — the shared R2 transport + media-queue contract used by
// @imbau/api (producer, this milestone) and apps/worker (consumer, plan 02-02). JIT package:
// raw .ts re-exports; `export type` for type-only surface (verbatimModuleSyntax).
export { makeR2Client } from "./r2-client";
export type { R2ClientEnv } from "./r2-client";
export { originalKey, variantKey, quotePdfKey } from "./keys";
export { MEDIA_QUEUE, mediaJobOptions } from "./queue";
export type { MediaJobData } from "./queue";
export { QUOTE_PDF_QUEUE, quotePdfJobOptions } from "./quote-pdf";
export type { QuotePdfJobData } from "./quote-pdf";
export { LEAD_EMAIL_QUEUE, leadEmailJobOptions } from "./lead-email";
export type { LeadEmailJobData } from "./lead-email";
