// picker router (D-08 / UI-01) — the anon read seam the piso→unidad picker needs.
//
// Four ANONYMOUS publicProcedures — getPublishedProject / listFloors / listUnits / listPlans —
// each a faithful clone of projects.listPublished: they route through withAnon so the anon RLS
// policies (projects_anon_published / floors_anon_published / units_anon_published /
// payment_plans_anon_published) do ALL the visibility filtering. There is NO app-layer WHERE on
// the project status — an unpublished (borrador/archivado) project yields zero rows purely by
// RLS (mirrors projects.ts / quotes.ts). The component decides that only `disponible` units are
// selectable; the query returns every unit so that decision stays client-side.
//
// This router imports ONLY withAnon/schema from @imbau/db — never createOwnerDb/appDb/createAppDb
// (the T-06-03-ELEV fence, grep-verified in the plan). getPublishedProject exposes the new
// whatsapp column (Plan 01) for the CTA; listPlans carries notasLegales (the UI-05 leyenda) plus
// the preset fields (anticipoPct/cuotas/ajuste/refuerzos) the snap slider maps.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAnon, schema } from "@imbau/db";
import { router, publicProcedure } from "../init";

export const pickerRouter = router({
  // Anon project resolve by slug — returns id, nombre and the whatsapp CTA target. The anon
  // policy gates visibility, so an unpublished slug yields an empty array.
  getPublishedProject: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ input }) =>
      withAnon((tx) =>
        tx
          .select({
            id: schema.projects.id,
            nombre: schema.projects.nombre,
            whatsapp: schema.projects.whatsapp,
          })
          .from(schema.projects)
          .where(eq(schema.projects.slug, input.slug))
          .limit(1),
      ),
    ),

  // Floors of a project — anon-gated by floors_anon_published.
  listFloors: publicProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ input }) =>
      withAnon((tx) =>
        tx
          .select()
          .from(schema.floors)
          .where(eq(schema.floors.projectId, input.projectId)),
      ),
    ),

  // Units of a floor — returns ALL rows (every status); the component decides selectability.
  listUnits: publicProcedure
    .input(z.object({ floorId: z.uuid() }))
    .query(({ input }) =>
      withAnon((tx) =>
        tx
          .select()
          .from(schema.units)
          .where(eq(schema.units.floorId, input.floorId)),
      ),
    ),

  // Payment plans of a project — carry notasLegales (UI-05) + the snap-slider preset fields.
  listPlans: publicProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ input }) =>
      withAnon((tx) =>
        tx
          .select()
          .from(schema.paymentPlans)
          .where(eq(schema.paymentPlans.projectId, input.projectId)),
      ),
    ),
});
