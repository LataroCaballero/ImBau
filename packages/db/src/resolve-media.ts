// resolveMedia — the PURE output resolver of the media pipeline (MEDIA-05, RESEARCH Pattern 5
// §263-280). Maps a `media` row + a public base URL to a shape both the public web (anon) and
// the panel (auth) render directly. NO env read, NO DB, NO Redis: `publicBaseUrl` enters by
// parameter (decision A6: public serving, no signed GET), so this stays importable by web and
// panel without cycles and unit-testable without infra. It imports nothing from ./client or
// ./with-tenant — purity is the contract.
//
// The `variants` jsonb maps `"{fmt}-{width}"` (e.g. "avif-1024") → the variant's R2 key. We
// parse the KEYS for fmt+width, prepend publicBaseUrl to each VALUE to build the public URL,
// group by format, sort by width ascending, and assemble the `<url> <w>w, …` srcset strings.
//
// isReady derives from `variants` being non-empty (rule A1: a row is "processed" once the
// worker has written variants; an empty `{}` is the pre-processing state). When not ready the
// resolver returns empty sources + empty srcsets so a consumer renders the blurhash/skeleton
// rather than a broken <img> (RESEARCH Pitfall 4 §338-341) — width/height/blurhash pass
// through untouched (they may be null until the worker fills them).

export interface ResolvedMedia {
  width: number | null;
  height: number | null;
  blurhash: string | null;
  /** True once the worker has written at least one variant (variants non-empty). */
  isReady: boolean;
  originalUrl: string;
  sources: {
    avif: { width: number; url: string }[];
    webp: { width: number; url: string }[];
  };
  /** "<url> <width>w, …" per format; empty string when no variants of that format. */
  srcset: { avif: string; webp: string };
}

interface MediaRow {
  originalKey: string;
  variants: Record<string, string>;
  width: number | null;
  height: number | null;
  blurhash: string | null;
}

type VariantFormat = "avif" | "webp";

// Parse a `"{fmt}-{width}"` variant map key into its format + width, or null when the key is
// not a recognized `avif-`/`webp-` entry with a numeric width.
function parseVariantKey(
  key: string,
): { fmt: VariantFormat; width: number } | null {
  const dash = key.indexOf("-");
  if (dash <= 0) return null;
  const fmt = key.slice(0, dash);
  if (fmt !== "avif" && fmt !== "webp") return null;
  const width = Number(key.slice(dash + 1));
  if (!Number.isInteger(width) || width <= 0) return null;
  return { fmt, width };
}

export function resolveMedia(
  row: MediaRow,
  opts: { publicBaseUrl: string },
): ResolvedMedia {
  const { publicBaseUrl } = opts;

  const avif: { width: number; url: string }[] = [];
  const webp: { width: number; url: string }[] = [];

  for (const [key, storageKey] of Object.entries(row.variants)) {
    const parsed = parseVariantKey(key);
    if (!parsed) continue;
    const entry = { width: parsed.width, url: `${publicBaseUrl}/${storageKey}` };
    (parsed.fmt === "avif" ? avif : webp).push(entry);
  }

  const byWidth = (a: { width: number }, b: { width: number }): number =>
    a.width - b.width;
  avif.sort(byWidth);
  webp.sort(byWidth);

  const toSrcset = (list: { width: number; url: string }[]): string =>
    list.map((s) => `${s.url} ${s.width}w`).join(", ");

  return {
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    // A1: a row is ready once it has any variant; empty `{}` is the pre-processing state.
    isReady: Object.keys(row.variants).length > 0,
    originalUrl: `${publicBaseUrl}/${row.originalKey}`,
    sources: { avif, webp },
    srcset: { avif: toSrcset(avif), webp: toSrcset(webp) },
  };
}
