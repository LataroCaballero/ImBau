// seedRenders — idempotent draw-over-render fixture for the phase-12 hotspot editor (RESEARCH §7).
//
// The base seed sets NONE of renderExteriorKey / renderKey / poligonoSvg — so the D-06 empty-state
// ("Falta el render…") is the DEFAULT state on Brigos Recoleta, and the draw→validate→save happy
// path has no background to draw on. This step gives that happy path a resolvable background by
// pointing projects.renderExteriorKey (the exterior render, background for FLOOR polygons) and a
// handful of floors.renderKey (the planta render, background for UNIT polygons) at ALREADY-SEEDED
// gallery assets' deterministic originalKeys — so `${R2_PUBLIC_BASE_URL}/${key}` resolves at UAT.
//
// Idempotency (matches the seed's `.onConflictDoNothing()` philosophy): every UPDATE is guarded by
// `isNull(column)`, so it sets the key ONLY when currently null. A re-run touches ZERO rows and
// never overwrites an operator's real render key — safe re-run, never duplicates (T-03-08 analog).
// It runs AFTER seedMedia (registered in seed.ts) so the referenced media originalKeys exist in R2
// first; in skipMedia runs (tests/CI) the columns are still set as plain strings (no R2 needed for
// a text UPDATE — resolution only matters under real R2 at UAT, exactly like galleries reference
// mediaIds even when media is skipped).
import { and, eq, isNull } from "drizzle-orm";
import { originalKey } from "@imbau/storage";
import { withTenant } from "../with-tenant";
import * as schema from "../schema";
import { seedId } from "./ids";
import { mediaSeedId } from "./media";

// The R2 originalKey of an already-seeded gallery asset (originals/{org}/{proj}/{mediaId}.jpg).
// All MEDIA_ASSETS are seeded as `.jpg`, so the ext is fixed here. Reusing an existing asset's key
// (instead of minting a new object) guarantees the placeholder background actually resolves.
function assetKey(orgId: string, projectId: string, assetName: string): string {
  return originalKey(orgId, projectId, mediaSeedId(assetName), "jpg");
}

// Which seeded floors get a placeholder planta render, and which gallery asset backs each. Kept to
// 3 floors (PB + first two) — enough to exercise drill-down + unit-polygon drawing at UAT without
// implying every floor has a real planta. Each maps to a DISTINCT interior asset so the plantas
// look different in the editor.
const FLOOR_RENDER_FIXTURES: readonly { readonly numero: number; readonly asset: string }[] = [
  { numero: 0, asset: "interiores-living" },
  { numero: 1, asset: "interiores-cocina" },
  { numero: 2, asset: "interiores-dormitorio" },
];

/**
 * Idempotently point the project's exterior render + a few floors' planta renders at resolvable
 * placeholder R2 keys, so the hotspot editor's draw-over-render happy path has a background at UAT.
 * Only sets each column where it is currently null (safe re-run). Runs inside `withTenant` (the
 * production RLS write path), exactly like every other seed step.
 */
export async function seedRenders(orgId: string, projectId: string): Promise<void> {
  // 1. Exterior render — the background for FLOOR polygons. Reuse the fachada gallery asset.
  await withTenant(orgId, (tx) =>
    tx
      .update(schema.projects)
      .set({ renderExteriorKey: assetKey(orgId, projectId, "exteriores-fachada") })
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.renderExteriorKey))),
  );

  // 2. Planta renders — the background for UNIT polygons on a handful of floors.
  for (const fixture of FLOOR_RENDER_FIXTURES) {
    const floorId = seedId(`brigos:floor:${fixture.numero}`);
    await withTenant(orgId, (tx) =>
      tx
        .update(schema.floors)
        .set({ renderKey: assetKey(orgId, projectId, fixture.asset) })
        .where(
          and(
            eq(schema.floors.id, floorId),
            eq(schema.floors.projectId, projectId),
            isNull(schema.floors.renderKey),
          ),
        ),
    );
  }
}
