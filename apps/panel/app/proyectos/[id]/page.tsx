// Project index (PANEL-01 / D-02) — redirect to the default tab.
//
// /proyectos/[id] has no content of its own; it redirects to the canonical first tab,
// /proyectos/[id]/unidades. The shared layout (which already validated the id and resolved the
// project under RLS) wraps this, so the redirect only ever fires for a real, in-org project.
// params is a Promise in Next 16 (RESEARCH Pitfall 3). redirect() never returns → Promise<never>.
import { redirect } from "next/navigation";

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/proyectos/${id}/unidades`);
}
