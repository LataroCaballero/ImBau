// media router (MEDIA-01) — the presigned-create / confirm-enqueue pair (RESEARCH Pattern 2).
//
// Both procedures are protectedProcedure, so the tenant is ctx.activeOrgId derived SOLELY from
// the session (never a client-supplied org). The original R2 key is derived SERVER-SIDE from a
// server-minted mediaId (originalKey from @imbau/storage) — a client key is never trusted
// (T-02-01). The content-type allowlist is a z.enum of the four raster formats: image/svg+xml
// (and anything else) is rejected at the tRPC boundary before any work happens (T-02-02 — SVG
// is an XSS/SSRF vector). There is NO app-layer `where organization_id = …`: the media_tenant
// RLS policy does the filtering, so confirmUpload run by org A can never even SELECT org B's
// row. This router imports ONLY withTenant/schema from @imbau/db (never the elevated/owner pool).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@imbau/db";
import { router, protectedProcedure } from "../init";
import { presignPut, headOriginal, enqueueMedia } from "../../media/runtime";
import { insertMediaRow } from "../../media/register";

// The ONLY accepted upload content-types → their file extension. SVG is deliberately absent
// (T-02-02). The map keys are exactly the z.enum members below, so the lookup is total.
const CONTENT_TYPE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

// Declared-size ceiling for an upload (defense against decompression-bomb / DoS at the
// boundary; the worker also caps decode pixels). 25 MiB comfortably covers architectural
// renders while bounding the presigned PUT.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const mediaRouter = router({
  // Phase 1 of the upload: validate, mint the id + server-derived key, insert the row under
  // RLS, and hand back a short-lived presigned PUT for the browser to upload the bytes to.
  createUpload: protectedProcedure
    .input(
      z.object({
        projectId: z.uuid(),
        contentType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
        ]),
        size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mediaId = randomUUID();
      const ext = CONTENT_TYPE_EXT[input.contentType];
      // Insert under withTenant(ctx.activeOrgId) — key derived from the server-minted mediaId.
      const key = await insertMediaRow({
        organizationId: ctx.activeOrgId,
        projectId: input.projectId,
        mediaId,
        ext,
      });
      const putUrl = await presignPut(key, input.contentType);
      return { mediaId, putUrl };
    }),

  // Phase 2 of the upload: look the row up under RLS (scoped to the caller's org), confirm the
  // bytes landed in R2 (HeadObject), and only THEN enqueue processing (no object → no job).
  confirmUpload: protectedProcedure
    .input(z.object({ mediaId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await withTenant(ctx.activeOrgId, (tx) =>
        tx.select().from(schema.media).where(eq(schema.media.id, input.mediaId)),
      );
      const media = rows[0];
      // RLS scopes the SELECT to the caller's org, so a missing row means "not yours / not
      // found" — either way there is nothing to confirm.
      if (!media) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const exists = await headOriginal(media.originalKey);
      if (!exists) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Original bytes not found in R2; upload did not complete.",
        });
      }
      await enqueueMedia({
        mediaId: media.id,
        organizationId: media.organizationId,
        projectId: media.projectId,
        originalKey: media.originalKey,
      });
      return { enqueued: true };
    }),
});
