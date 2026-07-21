// Unidades tab (PANEL-01 / D-04, D-08) — the canonical tab RSC and the mold leads/hotspots clone.
//
// Structure (repeated in every tab): await params → z.uuid() guard → notFound() if invalid →
// resolveProject(id) (a cache() HIT — same result the layout already resolved this request) →
// notFound() if null. The layout re-runs this guard here too because App Router renders layout and
// page independently and cannot prop-drill the resolved project down; cache() makes the second call
// free.
//
// The write affordance is role-gated on canWrite (owner/developer), computed from
// org.activeMemberRole (Plan 01). This is COSMETIC defense-in-depth ONLY (D-08): the server-side
// requireRole (Plan 01) is the real authority. The functional write UI is deferred to phase 10 —
// this only renders an es-AR seam so a viewer sees no write affordance. es-AR voseo, no design
// system (D-13).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createCaller } from "@imbau/api";
import { resolveProject } from "../../../../lib/project-caller";

export default async function UnidadesPage({
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

  const caller = await createCaller({ headers: await headers() });
  const role = await caller.org.activeMemberRole();
  const canWrite = role === "owner" || role === "developer";

  return (
    <main>
      <h1>{project.nombre} · Unidades</h1>
      <p>Grilla de unidades — próximamente.</p>
      {canWrite ? (
        <p>Acá vas a poder editar precios y disponibilidad (próximamente).</p>
      ) : null}
    </main>
  );
}
