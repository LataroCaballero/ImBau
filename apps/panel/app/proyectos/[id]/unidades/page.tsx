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
// requireRole (Plan 01) is the real authority — hiding a button is never the control. The functional
// units grid (Plan 10-04) hangs off this RSC: the guard below is kept VERBATIM and only the <main>
// body renders the client island, wrapped in the tRPC client provider (mirroring the dashboard).
// es-AR voseo (10-UI-SPEC Copywriting Contract).
import { notFound } from "next/navigation";
import { z } from "zod";
import { resolveProject, resolveActiveRole } from "../../../../lib/project-caller";
import { TRPCReactProvider } from "../../../../lib/trpc-client";
import { UnitsGrid } from "./units-grid";

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

  const role = await resolveActiveRole();
  const canWrite = role === "owner" || role === "developer";

  return (
    <main className="px-8 pt-12 pb-8">
      <h1 className="font-display text-[1.75rem] font-medium leading-tight text-grafito">
        {project.nombre} · Unidades
      </h1>
      <TRPCReactProvider>
        <UnitsGrid projectId={id} canWrite={canWrite} />
      </TRPCReactProvider>
    </main>
  );
}
