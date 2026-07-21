// Hotspots tab (PANEL-01 / D-04, D-08) — sibling clone of the unidades tab (see it for rationale).
//
// Same spine: await params → z.uuid() guard → notFound() → resolveProject (cache() hit) →
// notFound() → canWrite from org.activeMemberRole. Only the heading and placeholder copy differ.
// The write affordance is cosmetic (D-08); the server requireRole is the authority. Phase-12 fills
// the real SVG editor. es-AR voseo, no design system (D-13).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createCaller } from "@imbau/api";
import { resolveProject } from "../../../../lib/project-caller";

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

  const caller = await createCaller({ headers: await headers() });
  const role = await caller.org.activeMemberRole();
  const canWrite = role === "owner" || role === "developer";

  return (
    <main>
      <h1>{project.nombre} · Hotspots</h1>
      <p>Editor de hotspots — próximamente.</p>
      {canWrite ? (
        <p>Acá vas a poder dibujar y vincular hotspots del edificio (próximamente).</p>
      ) : null}
    </main>
  );
}
