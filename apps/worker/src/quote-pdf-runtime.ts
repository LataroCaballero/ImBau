// The quote-PDF pipeline's R2 RUNTIME (PDF-01) — the side-effectful seam for the PDF worker: the
// single configured S3Client plus the put verb against Cloudflare R2, and the WEB_PUBLIC_BASE_URL
// the processor prepends to build the cotizador deep-link (D-08). quote-pdf.ts (processQuotePdf)
// imports ONLY putPdf/WEB_PUBLIC_BASE_URL from here and never constructs an S3Client or touches
// ./env itself, so quote-pdf.test.ts can vi.mock this whole module (no env load, no live R2).
//
// EXACT analog of media-runtime.ts: the worker IS the PDF consumer — it has already validated
// R2_* + WEB_PUBLIC_BASE_URL at boot via ./env — so building the client at module import is
// correct here (the checksum opt-out lives in makeR2Client — without it every R2 PutObject 400s).
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { makeR2Client } from "@imbau/storage";
import { env } from "./env";

// One configured client for the worker process (env is already validated by ./env at boot).
const r2: S3Client = makeR2Client(env);

// The target R2 bucket for Put (validated R2_BUCKET). Exported for callers/diagnostics.
export const R2_BUCKET = env.R2_BUCKET;

// The public origin of apps/web the processor prepends to the cotizador deep-link embedded in the
// PDF footer + QR (D-08). Re-exported through this (mockable) seam so quote-pdf.ts never imports
// ./env directly — keeping quote-pdf.test.ts free of env load.
export const WEB_PUBLIC_BASE_URL = env.WEB_PUBLIC_BASE_URL;

// Upload the rendered PDF buffer to a deterministic key (quotePdfKey). A retry overwrites the SAME
// object in place — never duplicates (PDF-02 idempotency: deterministic key + short-circuit).
export async function putPdf(key: string, body: Buffer): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/pdf",
    }),
  );
}
