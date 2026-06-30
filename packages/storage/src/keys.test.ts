import { describe, it, expect } from "vitest";
import { originalKey, variantKey } from "./keys";
import { MEDIA_QUEUE, mediaJobOptions } from "./queue";

// Unit tests for the PURE key + queue-option helpers (MEDIA-01/MEDIA-04). No infra: these
// helpers are side-effect-free so the server-owned key shapes + the deterministic BullMQ
// options are provable without R2 or Redis.

describe("originalKey", () => {
  it("renders exactly originals/{orgId}/{projectId}/{mediaId}.{ext}", () => {
    expect(originalKey("org-1", "proj-2", "med-3", "jpg")).toBe(
      "originals/org-1/proj-2/med-3.jpg",
    );
  });

  it("is deterministic: same inputs → same key (retry overwrites, never duplicates)", () => {
    const a = originalKey("o", "p", "m", "png");
    const b = originalKey("o", "p", "m", "png");
    expect(a).toBe(b);
  });
});

describe("variantKey", () => {
  it("renders exactly variants/{mediaId}/{width}.{fmt}", () => {
    expect(variantKey("med-3", "avif", 1024)).toBe("variants/med-3/1024.avif");
    expect(variantKey("med-3", "webp", 384)).toBe("variants/med-3/384.webp");
  });

  it("is deterministic for the same media/format/width", () => {
    expect(variantKey("m", "avif", 800)).toBe(variantKey("m", "avif", 800));
  });
});

describe("MEDIA_QUEUE", () => {
  it("is the shared media-processing channel name", () => {
    expect(MEDIA_QUEUE).toBe("media-processing");
  });
});

describe("mediaJobOptions", () => {
  it("sets jobId=mediaId, attempts=5, exponential backoff delay 2000 (MEDIA-04 dedup)", () => {
    expect(mediaJobOptions("med-9")).toEqual({
      jobId: "med-9",
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
    });
  });

  it("uses the mediaId as the dedup jobId so re-enqueues collapse", () => {
    expect(mediaJobOptions("abc").jobId).toBe("abc");
  });
});
