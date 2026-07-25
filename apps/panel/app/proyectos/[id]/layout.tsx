// Project shell layout (PANEL-01 / SC-1, SC-2 — D-01/D-02/D-07) — the resolution spine.
//
// This async RSC is the structural seam the three tabs (unidades/leads/hotspots) hang off. It
// resolves the active-org project ONCE via resolveProject (cache()-wrapped), so the layout and
// its child pages share a single getForOrg query per request.
//
// Canonical order (RESEARCH Pitfall 6): validate the untrusted params.id with z.uuid() BEFORE any
// query (RESEARCH Pitfall 2 — a non-uuid would raise Postgres 22P02 → 500), then resolve, then
// notFound() on null. A cross-org id and a non-existent id are INDISTINGUISHABLE here — both are
// invisible under RLS → null → the same notFound() (no-enumeration, D-07). params is a Promise in
// Next 16 (RESEARCH Pitfall 3), so we await it. es-AR voseo, no design system (D-13).
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { resolveProject } from "../../../lib/project-caller";
import { TabBar } from "./tab-bar";

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const { id } = await params;

  // Reject a malformed id before touching Postgres (avoids 22P02 → 500).
  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  // null = invisible under RLS (cross-org OR non-existent — identical response, D-07).
  const project = await resolveProject(id);
  if (!project) {
    notFound();
  }

  return (
    <section>
      <nav>
        <Link href="/">← Proyectos</Link>
      </nav>
      <TabBar projectId={id} />
      {children}
    </section>
  );
}
