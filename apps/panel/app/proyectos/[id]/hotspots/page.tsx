// Hotspots tab (PANEL-01 / D-03..D-10) — the real SVG hotspot editor surface (Phase 12, Plan 03).
//
// Same server spine as the unidades tab, kept VERBATIM (Phase 9/10 mold): await params →
// z.uuid() guard → notFound() → resolveProject (cache() HIT) → notFound() → canWrite from
// resolveActiveRole(). The write affordance is cosmetic (D-08); the server requireRole on the
// Plan-02 hotspots mutations is the authority.
//
// What this RSC adds over the placeholder: it builds a server-side caller (as resolveProject does)
// to read hotspots.getForProject, then maps the storage keys (renderExteriorKey / floors[].renderKey)
// to PUBLIC render URLs via `${env.R2_PUBLIC_BASE_URL}/${key}` server-side — the client island never
// sees a storage key or credentials (T-12-06 accept / trust boundary). A null key → a null URL prop
// → the island renders the D-06 empty-state (never draws over void, D-05/D-06). The live polygon
// state (poligonoSvg per floor/unit) is (re-)fetched by the island itself via useTRPC so it can
// invalidate after each save/clear; the RSC only supplies the static render-URL map + role.
// es-AR voseo (12-UI-SPEC Copywriting Contract).
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createCaller } from "@imbau/api";
import { resolveProject, resolveActiveRole } from "../../../../lib/project-caller";
import { TRPCReactProvider } from "../../../../lib/trpc-client";
import { env } from "../../../../env";
import { HotspotsEditor } from "./hotspots-editor";

// Build a public render URL from a storage key server-side, or null when there is no key.
// A null return drives the island's D-06 empty-state (missing render → no drawing surface).
function renderUrl(key: string | null): string | null {
  return key === null ? null : `${env.R2_PUBLIC_BASE_URL}/${key}`;
}

export default async function HotspotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  const project = await resolveProject(id);
  if (!project) {
    notFound();
  }

  const role = await resolveActiveRole();
  const canWrite = role === "owner" || role === "developer";

  // Server-side caller (session cookie → active org → RLS), same seam resolveProject uses. We read
  // getForProject once here purely to build the render-URL map; the island re-reads it for live
  // polygon state. RLS scopes every row to the active org (a cross-org id already 404'd above).
  const caller = await createCaller({ headers: await headers() });
  const data = await caller.hotspots.getForProject({ projectId: id });

  const exteriorRenderUrl = renderUrl(data.renderExteriorKey);
  // floorId → planta render URL (or null). The island joins this with its own live getForProject
  // read by floorId, so the render backgrounds stay server-built while polygons stay invalidatable.
  const floorRenderUrls: Record<string, string | null> = {};
  for (const floor of data.floors) {
    floorRenderUrls[floor.id] = renderUrl(floor.renderKey);
  }

  return (
    <main className="px-8 pt-12 pb-8">
      <h1 className="font-display text-[1.75rem] font-medium leading-tight text-grafito">
        {project.nombre} · Hotspots
      </h1>
      <TRPCReactProvider>
        <HotspotsEditor
          projectId={id}
          canWrite={canWrite}
          exteriorRenderUrl={exteriorRenderUrl}
          floorRenderUrls={floorRenderUrls}
        />
      </TRPCReactProvider>
    </main>
  );
}
