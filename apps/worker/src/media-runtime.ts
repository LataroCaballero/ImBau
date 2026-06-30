// The worker's R2 RUNTIME (MEDIA-02) — the side-effectful seam for the media pipeline: the
// single configured S3Client plus get/put verbs against Cloudflare R2. media.ts (processMedia)
// imports ONLY getOriginal/putVariant/R2_BUCKET from here and never constructs an S3Client
// itself, so media.test.ts can vi.mock this whole module and the 02-03 integration test can
// exercise the real R2 path through the same seam.
//
// Unlike the api's media/runtime (lazy/memoized because the appRouter imports it on paths that
// may never enqueue), the worker IS the media consumer: it has already validated R2_* at boot
// via ./env, so building the client at module import is correct here. The checksum opt-out
// lives in makeR2Client (RESEARCH Pattern 1) — without it every R2 PutObject 400s.
import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { makeR2Client } from "@imbau/storage";
import { env } from "./env";

// One configured client for the worker process (env is already validated by ./env at boot).
const r2: S3Client = makeR2Client(env);

// The target R2 bucket for Get/Put (validated R2_BUCKET). Exported for callers/diagnostics.
export const R2_BUCKET = env.R2_BUCKET;

// Download an object's full body into a Buffer. Used ONCE per job to pull the original before
// rendering variants (download-once — RESEARCH Pattern 3). A missing Body is an error: a job
// that was enqueued only after HeadObject confirmed the bytes (02-01) should always find them,
// so an absent body is a real fault that must propagate (never silently swallowed — CLAUDE.md).
export async function getOriginal(key: string): Promise<Buffer> {
  const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!obj.Body) {
    throw new Error(`R2 GetObject returned no body for key (object missing or empty)`);
  }
  return Buffer.from(await obj.Body.transformToByteArray());
}

// Upload a single variant buffer to a deterministic key (variantKey). A retry overwrites the
// same object in place — never duplicates (RESEARCH Pitfall 5).
export async function putVariant(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
