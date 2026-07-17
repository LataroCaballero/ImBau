import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { decode } from "blurhash";
import { variantKey, type MediaJobData } from "@imbau/storage";
import type { Job } from "bullmq";
import { pickWidths } from "./media-variants";

// Tests for the media pipeline (MEDIA-02/03). Two layers:
//   (1) renderVariants — PURE: REAL sharp + blurhash over an in-memory synthetic image, NO
//       infra. Proves AVIF/WebP variants are decodable at each non-upscaled width, dims are
//       correct, and the blurhash round-trips.
//   (2) processMedia — orchestration: media-runtime (R2) and media-store (DB) are vi.mocked, so
//       this proves download-once + deterministic keys + single complete write WITHOUT touching
//       R2 or Postgres.

// Mock the two I/O seams. media.ts imports getOriginal/putVariant from ./media-runtime and
// writeVariants from ./media-store; mocking them means @imbau/db + ./env are never loaded, so
// the suite needs no real DB/R2.
vi.mock("./media-runtime", () => ({
  getOriginal: vi.fn(),
  putVariant: vi.fn(),
  R2_BUCKET: "test-bucket",
}));
vi.mock("./media-store", () => ({
  writeVariants: vi.fn(),
}));

// Import AFTER the mock declarations (vi.mock is hoisted, but keep intent clear).
import { renderVariants, processMedia } from "./media";
import { getOriginal, putVariant } from "./media-runtime";
import { writeVariants } from "./media-store";

// Build a synthetic PNG of the given dimensions (a flat colour is enough to exercise the
// encode + blurhash paths; no fixture file needed).
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("renderVariants (pure, real sharp/blurhash)", () => {
  it("produces an AVIF + WebP variant for every pickWidths(width), each decodable and never upscaled", async () => {
    const srcWidth = 800;
    const srcHeight = 600;
    const input = await makeImage(srcWidth, srcHeight);

    const result = await renderVariants(input, "media-1");

    const expectedWidths = pickWidths(srcWidth); // [384, 640, 768, 800]
    // 2 formats per width.
    expect(result.uploads).toHaveLength(expectedWidths.length * 2);

    for (const w of expectedWidths) {
      for (const fmt of ["avif", "webp"] as const) {
        const upload = result.uploads.find((u) => u.mapKey === `${fmt}-${w}`);
        expect(upload, `missing ${fmt}-${w}`).toBeDefined();
        if (!upload) continue;
        // Deterministic key + content type.
        expect(upload.r2Key).toBe(variantKey("media-1", fmt, w));
        expect(upload.contentType).toBe(`image/${fmt}`);
        // Each buffer actually decodes as that format at the requested width (never upscaled).
        const meta = await sharp(upload.body).metadata();
        if (fmt === "avif") {
          // sharp reports AVIF (a HEIF container) as "heif".
          expect(["heif", "avif"]).toContain(meta.format);
        } else {
          expect(meta.format).toBe("webp");
        }
        expect(meta.width).toBe(w);
        expect(meta.width).toBeLessThanOrEqual(srcWidth);
      }
    }
  });

  it("returns the variants map matching the uploads, plus the source dimensions", async () => {
    const input = await makeImage(1000, 750);
    const result = await renderVariants(input, "media-2");

    expect(result.width).toBe(1000);
    expect(result.height).toBe(750);

    // variants map has one entry per upload, keyed `${fmt}-${width}` → the deterministic r2Key.
    expect(Object.keys(result.variants)).toHaveLength(result.uploads.length);
    for (const upload of result.uploads) {
      expect(result.variants[upload.mapKey]).toBe(upload.r2Key);
    }
  });

  it("computes a blurhash that round-trips to a w*h*4 RGBA buffer (MEDIA-03)", async () => {
    const input = await makeImage(640, 480);
    const result = await renderVariants(input, "media-3");

    expect(typeof result.blurhash).toBe("string");
    expect(result.blurhash.length).toBeGreaterThan(0);

    // decode must accept the hash and return RGBA pixels for the requested raster.
    const pixels = decode(result.blurhash, 32, 24);
    expect(pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pixels.length).toBe(32 * 24 * 4);
  });

  it("never upscales: a source narrower than the smallest breakpoint yields a single source-width variant", async () => {
    const input = await makeImage(300, 200);
    const result = await renderVariants(input, "media-4");

    // pickWidths(300) === [300]; 2 formats.
    expect(result.uploads).toHaveLength(2);
    for (const upload of result.uploads) {
      const meta = await sharp(upload.body).metadata();
      expect(meta.width).toBe(300);
    }
  });
});

describe("processMedia (orchestration, R2 + store mocked)", () => {
  beforeEach(() => {
    vi.mocked(getOriginal).mockReset();
    vi.mocked(putVariant).mockReset();
    vi.mocked(writeVariants).mockReset();
  });

  function makeJob(data: MediaJobData): Job<MediaJobData> {
    // Only `data` is read by processMedia; cast the minimal shape to the BullMQ Job type.
    return { data } as Job<MediaJobData>;
  }

  it("downloads the original ONCE, uploads each deterministic key, and writes the COMPLETE map once", async () => {
    const srcWidth = 800;
    const input = await makeImage(srcWidth, 600);
    const job = makeJob({
      mediaId: "media-9",
      organizationId: "org-7",
      projectId: "proj-3",
      originalKey: "originals/org-7/proj-3/media-9.png",
    });

    const putKeys: string[] = [];
    vi.mocked(getOriginal).mockResolvedValue(input);
    vi.mocked(putVariant).mockImplementation((key: string) => {
      putKeys.push(key);
      return Promise.resolve();
    });
    vi.mocked(writeVariants).mockResolvedValue();

    await processMedia(job);

    // download-once with the payload's originalKey.
    expect(getOriginal).toHaveBeenCalledTimes(1);
    expect(getOriginal).toHaveBeenCalledWith("originals/org-7/proj-3/media-9.png");

    // every variant uploaded to its deterministic variantKey (no others, no dupes).
    const expectedWidths = pickWidths(srcWidth);
    const expectedKeys = expectedWidths.flatMap((w) => [
      variantKey("media-9", "avif", w),
      variantKey("media-9", "webp", w),
    ]);
    expect(putVariant).toHaveBeenCalledTimes(expectedKeys.length);
    expect(putKeys.slice().sort()).toEqual(expectedKeys.slice().sort());

    // exactly ONE write-back, carrying the COMPLETE variants map + blurhash + dims + org.
    expect(writeVariants).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(writeVariants).mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    if (!payload) return;
    expect(payload.mediaId).toBe("media-9");
    expect(payload.organizationId).toBe("org-7");
    expect(payload.width).toBe(srcWidth);
    expect(payload.height).toBe(600);
    expect(typeof payload.blurhash).toBe("string");
    expect(payload.blurhash.length).toBeGreaterThan(0);
    // Map is complete: one key per uploaded variant, each pointing at its deterministic r2Key.
    expect(Object.keys(payload.variants)).toHaveLength(expectedKeys.length);
    for (const w of expectedWidths) {
      expect(payload.variants[`avif-${w}`]).toBe(variantKey("media-9", "avif", w));
      expect(payload.variants[`webp-${w}`]).toBe(variantKey("media-9", "webp", w));
    }
  });

  it("writes variants only AFTER every upload (single final write, never partial)", async () => {
    const input = await makeImage(640, 480);
    const job = makeJob({
      mediaId: "media-10",
      organizationId: "org-1",
      projectId: "proj-1",
      originalKey: "originals/org-1/proj-1/media-10.png",
    });

    let uploadsAtWriteTime = -1;
    let putCount = 0;
    vi.mocked(getOriginal).mockResolvedValue(input);
    vi.mocked(putVariant).mockImplementation(() => {
      putCount += 1;
      return Promise.resolve();
    });
    vi.mocked(writeVariants).mockImplementation(() => {
      uploadsAtWriteTime = putCount;
      return Promise.resolve();
    });

    await processMedia(job);

    // At the moment writeVariants ran, ALL uploads had already completed (A1: never partial).
    expect(uploadsAtWriteTime).toBe(putCount);
    expect(putCount).toBeGreaterThan(0);
  });
});
