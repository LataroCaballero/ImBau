import { headers } from "next/headers";
import { createCaller } from "@imbau/api";
import "../env";

// The published list is read from Postgres (via the anon pool) on EVERY request,
// so it must be rendered dynamically — never statically prerendered at `next build`
// (which has no live DB and would force a build-time connection). `force-dynamic`
// keeps the anon read at request time. Calling `headers()` already opts the route
// into dynamic rendering, but the explicit flag documents the intent and guards
// against a future change reintroducing static collection. (Deviation Rule 3.)
export const dynamic = "force-dynamic";

// Published-projects list (APP-02, D-14), es-AR voseo. Server Component reading
// ONLY via the anon path: createCaller → projects.listPublished → withAnon → the
// anon RLS policy returns ONLY estado='publicado' rows (borrador/archivado are
// invisible — T-03-16). Web is anon-only (D-03): there is NO auth handler, NO
// auth client and NO tRPC client here — the direct server caller is enough for a
// pure RSC read (D-08). Importing ./env keeps the validated-env fail-fast at boot
// (DATABASE_ANON_URL is validated in the server block, never the client bundle —
// T-03-19); we never touch process.env directly.
export default async function PublishedProjectsPage(): Promise<React.JSX.Element> {
  // listPublished is a publicProcedure → no session/tenant is read. createCaller
  // still resolves the (absent) session from the request headers; the anon read
  // path ignores it.
  const caller = await createCaller({ headers: await headers() });
  const projects = await caller.projects.listPublished();

  return (
    <main>
      <h1>ImBau · Proyectos publicados</h1>
      {projects.length === 0 ? (
        <p>Todavía no hay proyectos publicados.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              {project.nombre} · {project.slug} · {project.estado}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
