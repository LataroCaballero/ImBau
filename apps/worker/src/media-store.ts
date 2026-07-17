// The worker's SOLE write seam (MEDIA-02/03, A1/A8). writeVariants persists the rendered
// variant map + blurhash + dimensions to the `media` row in ONE atomic UPDATE, run as
// `app_authenticated` through @imbau/db's withTenant — never as the owner/BYPASSRLS role.
//
// WHY withTenant and NOT the owner role (the partitions.ts pattern): partitions runs DDL that
// only the owner may run, but `media_tenant` is `FOR ALL TO appAuthenticated` — there is NO
// policy granting the owner write access, and the table has RLS enabled, so an owner UPDATE
// would hit default-deny (RESEARCH Pattern 4). The worker has no Better Auth session, so it
// takes organizationId from the job payload (placed there by the authenticated enqueuer in
// 02-01) and feeds it into withTenant, which sets the transaction-scoped
// app.current_organization_id GUC — satisfying media_tenant.withCheck. The role-guard that
// proves this runs as app_authenticated (not owner) lands in 02-03.
//
// media.ts imports ONLY writeVariants from here; it never opens a transaction inline. That keeps
// this the single, mockable write point: media.test.ts vi.mocks this module; the 02-03
// integration test drives the real withTenant UPDATE.
import { withTenant, schema } from "@imbau/db";
import { eq } from "drizzle-orm";

// The fully-rendered result to persist for one media row. `variants` is the COMPLETE map
// ({ "avif-768": "variants/…", … }) — never a partial accumulation (A1): the caller writes it
// exactly once, after every R2 PutObject has succeeded.
export interface WriteVariantsPayload {
  readonly mediaId: string;
  readonly organizationId: string;
  readonly variants: Record<string, string>;
  readonly blurhash: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Persist the rendered variants/blurhash/dims for one media row in a SINGLE atomic UPDATE,
 * scoped to the payload's org via withTenant (app_authenticated + the tenant GUC).
 *
 * Idempotent: the keys in `variants` are deterministic (variantKey), so a retry writes the
 * SAME content (last-write-wins). A crash before this call leaves variants='{}' / blurhash &
 * dims NULL — the recoverable pre-processing state, never a half-written row.
 */
export async function writeVariants(payload: WriteVariantsPayload): Promise<void> {
  const { mediaId, organizationId, variants, blurhash, width, height } = payload;
  await withTenant(organizationId, (tx) =>
    tx
      .update(schema.media)
      .set({ variants, blurhash, width, height })
      .where(eq(schema.media.id, mediaId)),
  );
}
