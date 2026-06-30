// registerAndEnqueue + the shared media-row insert (MEDIA-01 convergence helper).
//
// The Phase-3 seed runs in Node with no browser and no Better Auth session: it PUTs the
// original bytes to R2 directly, then needs the SAME "insert a media row + enqueue
// processing" core the tRPC createUpload/confirmUpload pair performs. Factoring that core
// here (RESEARCH Pattern 2 §201, "factor registerAndEnqueue so the browser and seed paths
// converge") means the row shape, the server-derived key, and the RLS-correct insert live in
// ONE place — the router calls insertMediaRow; the seed calls registerAndEnqueue.
//
// The INSERT runs inside withTenant(organizationId, …): it sets the app.current_organization_id
// GUC so the media_tenant policy's withCheck (organization_id = current GUC) is satisfied and
// the write happens as the unprivileged app_authenticated role — never owner/BYPASSRLS.
import { randomUUID } from "node:crypto";
import { withTenant, schema } from "@imbau/db";
import { originalKey, type MediaJobData } from "@imbau/storage";
import { enqueueMedia } from "./runtime";

// Insert a media row whose original_key is DERIVED SERVER-SIDE from the (server-minted)
// mediaId — never a client-supplied key. Returns the derived key. Shared by the tRPC
// createUpload mutation and registerAndEnqueue so the insert logic is not duplicated.
export async function insertMediaRow(input: {
  organizationId: string;
  projectId: string;
  mediaId: string;
  ext: string;
}): Promise<string> {
  const key = originalKey(
    input.organizationId,
    input.projectId,
    input.mediaId,
    input.ext,
  );
  await withTenant(input.organizationId, (tx) =>
    tx.insert(schema.media).values({
      id: input.mediaId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      originalKey: key,
    }),
  );
  return key;
}

// Node convergence helper (Phase-3 seed): mint a mediaId, insert the row via withTenant, and
// enqueue the processing job in one step — the bytes were already uploaded by a direct
// PutObject before this call. Returns the ids/key so the caller can correlate.
export async function registerAndEnqueue(input: {
  organizationId: string;
  projectId: string;
  ext: string;
}): Promise<{ mediaId: string; originalKey: string }> {
  const mediaId = randomUUID();
  const key = await insertMediaRow({
    organizationId: input.organizationId,
    projectId: input.projectId,
    mediaId,
    ext: input.ext,
  });
  const job: MediaJobData = {
    mediaId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    originalKey: key,
  };
  await enqueueMedia(job);
  return { mediaId, originalKey: key };
}
