import { Suspense } from "react";
import { headers } from "next/headers";
import { createCaller } from "@imbau/api";
import { TRPCReactProvider } from "../../../../lib/trpc-client";
import { CotizadorSimulator } from "../../../../components/cotizador-simulator";
import "../../../../env";

// The cotizador route (UI-01) reads the picker/project data from Postgres via the anon pool on EVERY
// request, so it must render dynamically — never statically prerendered at `next build` (which has no
// live DB). Calling `headers()` already opts into dynamic rendering; the explicit flag documents the
// intent and guards against a future change reintroducing static collection. (Mirrors app/page.tsx.)
export const dynamic = "force-dynamic";

// Server Component: resolves the published project (+ whatsapp), its floors and its payment plans
// through the ANON picker caller (createCaller → picker.* → withAnon → the anon RLS policies do ALL
// the visibility filtering — an unpublished slug yields zero rows). It then mounts the tRPC client
// provider around the interactive simulator island and passes the resolved data as props. Units are
// NOT fetched here — they depend on the floor the buyer picks, so the island fetches them per floor
// via useTRPC. Amounts stay unformatted server-side; formatting is the island/cards' job.
//
// Importing ./env keeps the validated-env fail-fast at boot (DATABASE_ANON_URL validated in the server
// block, never the client bundle); we never touch process.env directly.
export default async function CotizadorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;

  const caller = await createCaller({ headers: await headers() });
  const projectRows = await caller.picker.getPublishedProject({ slug });
  const project = projectRows[0];

  // Not a published project (borrador/archivado/unknown all yield zero rows via the anon policy).
  if (!project) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <h1 className="font-display text-xl text-hormigon">Proyecto no encontrado</h1>
        <p className="text-hormigon/70">
          No encontramos un proyecto publicado en esta dirección. Verificá el enlace.
        </p>
      </main>
    );
  }

  const [floors, plans] = await Promise.all([
    caller.picker.listFloors({ projectId: project.id }),
    caller.picker.listPlans({ projectId: project.id }),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-cobre">Cotizador</p>
        <h1 className="font-display text-2xl text-hormigon">{project.nombre}</h1>
      </header>
      <TRPCReactProvider>
        {/* The island reads useSearchParams (?u/?plan) — wrap it in Suspense (Pitfall 6). */}
        <Suspense
          fallback={<p className="text-sm text-hormigon/70">Cargando cotizador…</p>}
        >
          <CotizadorSimulator project={project} floors={floors} plans={plans} />
        </Suspense>
      </TRPCReactProvider>
    </main>
  );
}
