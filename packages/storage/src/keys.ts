// R2 object-key derivation — PURE, server-owned key shapes (RESEARCH Code Examples §376-383).
//
// These keys are ALWAYS derived server-side from a server-minted mediaId; a client-supplied
// key is NEVER trusted (T-02-01). They are deterministic so a retry overwrites the SAME R2
// object instead of leaking a duplicate (RESEARCH Pitfall 5 §344-348).

// `originals/{orgId}/{projectId}/{mediaId}.{ext}` — the uploaded original's key. The org +
// project segments scope the object to its tenant for human-readable bucket browsing; the
// authority is still RLS + the presign, not the key path.
export function originalKey(
  orgId: string,
  projectId: string,
  mediaId: string,
  ext: string,
): string {
  return `originals/${orgId}/${projectId}/${mediaId}.${ext}`;
}

// `variants/{mediaId}/{width}.{fmt}` — a derived variant's key. Keyed by mediaId + width +
// format so the same variant always lands on the same R2 object: a retried worker job
// overwrites in place (idempotent), never duplicates (Pitfall 5).
export function variantKey(
  mediaId: string,
  fmt: "avif" | "webp",
  width: number,
): string {
  return `variants/${mediaId}/${width}.${fmt}`;
}

// `quotes/{orgId}/{projectId}/{quoteId}.pdf` — the rendered quote PDF's key. Deterministic per
// quoteId so a retried fase-7 job overwrites the SAME R2 object instead of duplicating (same
// idempotent-on-retry rationale as variantKey, Pitfall 5). The org + project segments scope the
// object to its tenant for human-readable bucket browsing; the authority stays with RLS + the
// worker, not the key path.
export function quotePdfKey(
  orgId: string,
  projectId: string,
  quoteId: string,
): string {
  return `quotes/${orgId}/${projectId}/${quoteId}.pdf`;
}
