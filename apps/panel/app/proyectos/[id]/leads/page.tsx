// Leads tab (PANEL-01 / D-04, D-08) — sibling clone of the unidades tab (see it for the rationale).
//
// Same spine: await params → z.uuid() guard → notFound() → resolveProject (cache() hit) →
// notFound() → canWrite from org.activeMemberRole. Only the heading and placeholder copy differ.
// The write affordance is cosmetic (D-08); the server requireRole is the authority. Phase-11 fills
// the real bandeja. es-AR voseo, no design system (D-13).
import { notFound } from "next/navigation";
import { z } from "zod";
import { resolveProject, resolveActiveRole } from "../../../../lib/project-caller";

export default async function LeadsPage({
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
    <main>
      <h1>{project.nombre} · Leads</h1>
      <p>Bandeja de leads — próximamente.</p>
      {canWrite ? (
        <p>Acá vas a poder gestionar y responder tus leads (próximamente).</p>
      ) : null}
    </main>
  );
}
