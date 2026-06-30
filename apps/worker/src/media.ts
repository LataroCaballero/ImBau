// The media pipeline (MEDIA-02/03) — the heart of plan 02-02. Mirrors the partitions.ts split:
// `renderVariants` is CPU-PURE (Buffer in → buffers out: sharp + blurhash, no R2/DB/env) so it
// is unit-testable in memory with REAL sharp/blurhash; `processMedia` is the ONE thin impure
// executor that wires the pure render to the I/O seams (media-runtime for R2, media-store for
// the single withTenant write). NO R2 client or DB transaction is constructed inline here — all
// I/O is delegated, so media.test.ts can vi.mock those two seams and the 02-03 integration test
// can drive the real ones.
//
// RESEARCH Pattern 3 (download-once → fan-out → single write) + Pitfall 6 (memory) are the
// sources of truth.
import sharp from "sharp";
import { encode as blurhashEncode } from "blurhash";
import type { Job } from "bullmq";
import { variantKey, type MediaJobData } from "@imbau/storage";
import { logger } from "@imbau/observability";
import { pickWidths, QUALITY } from "./media-variants";
import { getOriginal, putVariant } from "./media-runtime";
import { writeVariants } from "./media-store";

// Bound the libvips operation cache so concurrent jobs don't accumulate cached buffers
// (Pitfall 6). Module-level: applies process-wide, set once at import.
sharp.cache(false);

// Decode pixel cap (~16k × 16k) — refuse decompression-bomb inputs (T-02-07 / ASVS V5 DoS).
// The declared-size ceiling is enforced at upload (02-01); this is the decode-side guard.
const MAX_INPUT_PIXELS = 268_402_689;

// blurhash component counts (x=4, y=3) — a compact hash that round-trips to a smooth
// placeholder (MEDIA-03).
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

// A single rendered variant ready to upload: its deterministic R2 key, the `${fmt}-${width}`
// map key persisted in `media.variants`, the encoded bytes, and the content type.
export interface VariantUpload {
  readonly r2Key: string;
  readonly mapKey: string;
  readonly body: Buffer;
  readonly contentType: string;
}

// The full pure-render result: every variant to upload, the COMPLETE variants map to persist,
// the blurhash, and the source dimensions.
export interface RenderResult {
  readonly uploads: VariantUpload[];
  readonly variants: Record<string, string>;
  readonly blurhash: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Render every AVIF/WebP variant + the blurhash + dimensions for one original — CPU-PURE.
 *
 * Reads the source dimensions, picks the non-upscaling widths (pickWidths), and for each
 * width × format ∈ {avif,webp} encodes a fresh `sharp(input)` (rotate() bakes EXIF orientation,
 * resize withoutEnlargement guards against upscale at the sharp layer too). Variants are encoded
 * SEQUENTIALLY (a plain for-loop, not Promise.all) so at most one encode buffer is live at a
 * time (Pitfall 6). The blurhash is computed from a tiny 32×32 raw RGBA raster.
 *
 * No I/O: returns the buffers + the deterministic key map for the caller to upload + persist.
 */
export async function renderVariants(
  input: Buffer,
  mediaId: string,
): Promise<RenderResult> {
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const uploads: VariantUpload[] = [];
  const variants: Record<string, string> = {};

  for (const w of pickWidths(width)) {
    for (const fmt of ["avif", "webp"] as const) {
      // Fresh sharp instance per encode — pipelines are single-use; reusing one across formats
      // would throw. rotate() with no arg applies the EXIF orientation before resizing.
      const body =
        fmt === "avif"
          ? await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
              .rotate()
              .resize({ width: w, withoutEnlargement: true })
              .avif(QUALITY.avif)
              .toBuffer()
          : await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
              .rotate()
              .resize({ width: w, withoutEnlargement: true })
              .webp(QUALITY.webp)
              .toBuffer();
      const r2Key = variantKey(mediaId, fmt, w);
      const mapKey = `${fmt}-${w}`;
      uploads.push({ r2Key, mapKey, body, contentType: `image/${fmt}` });
      variants[mapKey] = r2Key;
    }
  }

  // blurhash from a small 32×32 raw RGBA raster (cheap; bounded memory).
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .raw()
    .ensureAlpha()
    .resize(32, 32, { fit: "inside" })
    .toBuffer({ resolveWithObject: true });
  const blurhash = blurhashEncode(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    BLURHASH_COMPONENTS_X,
    BLURHASH_COMPONENTS_Y,
  );

  return { uploads, variants, blurhash, width, height };
}

/**
 * The ONLY side effect of the pipeline (MEDIA-02/03). Downloads the original ONCE, renders all
 * variants in memory, uploads each to its deterministic R2 key SEQUENTIALLY, then persists the
 * COMPLETE variant map + blurhash + dims in ONE withTenant UPDATE (A1: never a partial write).
 *
 * organizationId comes from the job payload — the worker has no session (RESEARCH Pattern 4).
 * Any error propagates so BullMQ marks the job failed; the failed handler (Sentry + pino) is
 * wired in 02-03. On success a single structured pino line is logged.
 */
export async function processMedia(job: Job<MediaJobData>): Promise<void> {
  const { mediaId, organizationId, originalKey } = job.data;

  // 1. download the original exactly once.
  const input = await getOriginal(originalKey);

  // 2. render all variants + blurhash + dims in memory (pure).
  const { uploads, variants, blurhash, width, height } = await renderVariants(
    input,
    mediaId,
  );

  // 3. upload each variant to its deterministic key — SEQUENTIALLY (Pitfall 6).
  for (const upload of uploads) {
    await putVariant(upload.r2Key, upload.body, upload.contentType);
  }

  // 4. SINGLE atomic write-back under RLS (app_authenticated + GUC) with the COMPLETE map.
  await writeVariants({ mediaId, organizationId, variants, blurhash, width, height });

  logger.info(
    { mediaId, organizationId, variants: uploads.length, width, height },
    "media processed (variants + blurhash persisted)",
  );
}
