import { describe, it, expect } from "vitest";
import { resolveMedia } from "../src/resolve-media";

// Unit tests for the PURE resolveMedia resolver (MEDIA-05). These assert the variant→srcset
// mapping + the isReady/placeholder behavior WITHOUT any DB/Redis — the resolver is
// side-effect-free (publicBaseUrl enters by parameter, A6), so it is provable independent of
// infra. The file lives in tests/ because packages/db/vitest.config.ts includes
// `tests/**/*.test.ts` (a test under src/ would never run); it opens no connections, so it is
// inert under the package's migrating globalSetup.

const BASE = "https://media.example.test";

describe("resolveMedia — populated variants (MEDIA-05)", () => {
  const row = {
    originalKey: "originals/org-1/proj-2/med-3.jpg",
    variants: {
      "avif-1024": "variants/med-3/1024.avif",
      "avif-384": "variants/med-3/384.avif",
      "webp-1024": "variants/med-3/1024.webp",
      "webp-384": "variants/med-3/384.webp",
    },
    width: 2048,
    height: 1536,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  };

  const resolved = resolveMedia(row, { publicBaseUrl: BASE });

  it("isReady=true when variants is non-empty", () => {
    expect(resolved.isReady).toBe(true);
  });

  it("builds the original URL from publicBaseUrl + originalKey", () => {
    expect(resolved.originalUrl).toBe(`${BASE}/originals/org-1/proj-2/med-3.jpg`);
  });

  it("groups sources by format, ordered by width ascending, with public URLs", () => {
    expect(resolved.sources.avif).toEqual([
      { width: 384, url: `${BASE}/variants/med-3/384.avif` },
      { width: 1024, url: `${BASE}/variants/med-3/1024.avif` },
    ]);
    expect(resolved.sources.webp).toEqual([
      { width: 384, url: `${BASE}/variants/med-3/384.webp` },
      { width: 1024, url: `${BASE}/variants/med-3/1024.webp` },
    ]);
  });

  it("assembles the srcset strings as '<url> <w>w' joined by ', '", () => {
    expect(resolved.srcset.avif).toBe(
      `${BASE}/variants/med-3/384.avif 384w, ${BASE}/variants/med-3/1024.avif 1024w`,
    );
    expect(resolved.srcset.webp).toBe(
      `${BASE}/variants/med-3/384.webp 384w, ${BASE}/variants/med-3/1024.webp 1024w`,
    );
  });

  it("passes width/height/blurhash through untouched", () => {
    expect(resolved.width).toBe(2048);
    expect(resolved.height).toBe(1536);
    expect(resolved.blurhash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj");
  });
});

describe("resolveMedia — empty variants (placeholder, Pitfall 4)", () => {
  const row = {
    originalKey: "originals/org-1/proj-2/med-9.png",
    variants: {},
    width: null,
    height: null,
    blurhash: null,
  };

  const resolved = resolveMedia(row, { publicBaseUrl: BASE });

  it("isReady=false when variants is empty (pre-processing state)", () => {
    expect(resolved.isReady).toBe(false);
  });

  it("returns empty sources and empty srcset strings (does not break an <img>)", () => {
    expect(resolved.sources.avif).toEqual([]);
    expect(resolved.sources.webp).toEqual([]);
    expect(resolved.srcset.avif).toBe("");
    expect(resolved.srcset.webp).toBe("");
  });

  it("still exposes the original URL and passes null dims/blurhash through", () => {
    expect(resolved.originalUrl).toBe(`${BASE}/originals/org-1/proj-2/med-9.png`);
    expect(resolved.width).toBeNull();
    expect(resolved.height).toBeNull();
    expect(resolved.blurhash).toBeNull();
  });
});
