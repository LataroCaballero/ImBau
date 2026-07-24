// Leads tab (PANEL-01 / D-04, D-08) — sibling clone of the unidades tab (see it for the rationale).
//
// Same spine (kept VERBATIM): await params → z.uuid() guard → notFound() → resolveProject (cache()
// hit) → notFound() → canWrite from org.activeMemberRole. The write affordance is cosmetic (D-08);
// the server requireRole is the authority. The <main> body mounts the client kanban island in the
// tRPC provider (mirroring unidades/page.tsx). The project's leadsNotifyEmail (D-05) is read here
// from the already-resolved project row and passed to the board's notify-email field. es-AR voseo,
// Phase-11 UI-SPEC design contract.
import { notFound } from "next/navigation";
import { z } from "zod";
import { resolveProject, resolveActiveRole } from "../../../../lib/project-caller";
import { TRPCReactProvider } from "../../../../lib/trpc-client";
import { LeadsBoard } from "./leads-board";

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
    <main className="px-8 pt-12 pb-8">
      <h1 className="font-display text-[1.75rem] font-medium leading-tight text-grafito">
        {project.nombre} · Leads
      </h1>
      <TRPCReactProvider>
        <LeadsBoard
          projectId={id}
          canWrite={canWrite}
          notifyEmail={project.leadsNotifyEmail}
        />
      </TRPCReactProvider>
    </main>
  );
}
