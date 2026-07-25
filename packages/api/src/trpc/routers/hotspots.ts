// hotspots router (HSPOT-01/02/03/04, D-10) — the SINGLE write seam for floor and unit polygons.
//
// This is a verbatim clone of the Phase 9 `projects.updateSettings` / D1 `units.updateEstado` mold:
// every WRITE is a requireRole("owner","developer") mutation routed exclusively through
// withTenant(ctx.activeOrgId) on the unprivileged app pool — RLS proves TENANT ISOLATION,
// requireRole proves AUTHORIZATION (they are orthogonal; RLS alone would let a viewer write, so the
// explicit role gate is load-bearing — the Phase 9 lesson, reaffirmed in STATE). A cross-org /
// non-existent id is INVISIBLE under RLS, so each plain UPDATE affects 0 rows → the .returning()
// guard turns the silent no-op into NOT_FOUND (no-enumeration: identical to the cross-org response).
//
// Set/clear semantics (D-02, HSPOT-03): a CLEAR is `.set({ poligonoSvg: null })` — a field-to-null
// UPDATE of the record, NEVER a row delete; the floors/units row still exists afterward.
//
// Server-side validation (D-08, HSPOT-04): the server RE-VALIDATES every polygon through the pure
// @imbau/api/geometry module INSIDE the mutation (never trusts a client `isValid` flag) and
// RE-SERIALIZES canonically before persisting — only canonical integer pairs 0-1000 ever reach the
// DB (injection mitigation T-12-05). A degenerate/self-intersecting/oversized payload → BAD_REQUEST
// with an es-AR message and ZERO rows mutated. The stored string is byte-identical to
// serializePolygon output, consumable as-is by the phase-2 explorer via the existing anon policies.
//
// This router imports ONLY withTenant/schema from @imbau/db — never the elevated owner pool (the
// Phase 9 grep-fence; the literal function names are avoided so the fence grep stays clean).
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, schema } from "@imbau/db";
import { router, protectedProcedure } from "../init";
import { requireRole } from "../middleware";
import {
  parsePolygon,
  validatePolygon,
  serializePolygon,
  polygonErrorMessage,
  PolygonParseError,
} from "../../hotspots/geometry";

// Cap the raw polygon string length at the Zod boundary (DoS guard, T-12-04). A real polygon with a
// few hundred integer pairs is a few KB at most; 16 KB refuses a memory/parse-exhaustion payload
// while dwarfing any legitimate hotspot by orders of magnitude.
const MAX_POLYGON_B = 16_000;

// Cap the vertex count BEFORE running the O(n²) self-intersection scan (T-12-04). A hotspot is a
// hand-drawn outline of a handful of vertices; 200 is far above any real polygon and bounds the
// self-intersection cost. Enforced server-side inside the mutation, after parse, before validate.
const MAX_VERTICES = 200;

// Re-validate + re-serialize an untrusted polygon string to the canonical persisted form, or throw a
// BAD_REQUEST with an es-AR message (D-08, HSPOT-04). NEVER trusts a client flag; NEVER autocorrects.
// A malformed token (parsePolygon throw), too many vertices, or a failed geometry check each yields
// BAD_REQUEST — so ZERO rows are mutated (the mutation throws before the UPDATE runs).
function toCanonicalPolygon(raw: string): string {
  let points;
  try {
    points = parsePolygon(raw);
  } catch (err) {
    if (err instanceof PolygonParseError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }
  if (points.length > MAX_VERTICES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El polígono tiene demasiados vértices (máximo ${MAX_VERTICES}).`,
    });
  }
  const validation = validatePolygon(points);
  if (!validation.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: polygonErrorMessage(validation.reason),
    });
  }
  // Re-serialize through serializePolygon so only canonical integer pairs 0-1000 land in the DB
  // (injection mitigation T-12-05) — the raw client string is NEVER persisted.
  return serializePolygon(points);
}

export const hotspotsRouter = router({
  // Editor hydration read (owner/developer/viewer all read): returns the project's exterior render
  // key + ALL floors (so drill-down has plantas) + ALL units of the project, each with its stored
  // poligonoSvg, in ONE call. RLS scopes every row to the active org, so a cross-org projectId
  // yields renderExteriorKey null + empty arrays (never a leak).
  getForProject: protectedProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const projectRows = await tx
          .select({ renderExteriorKey: schema.projects.renderExteriorKey })
          .from(schema.projects)
          .where(eq(schema.projects.id, input.projectId));

        const floors = await tx
          .select({
            id: schema.floors.id,
            numero: schema.floors.numero,
            nombre: schema.floors.nombre,
            renderKey: schema.floors.renderKey,
            poligonoSvg: schema.floors.poligonoSvg,
          })
          .from(schema.floors)
          .where(eq(schema.floors.projectId, input.projectId));

        const units = await tx
          .select({
            id: schema.units.id,
            floorId: schema.units.floorId,
            identificador: schema.units.identificador,
            poligonoSvg: schema.units.poligonoSvg,
          })
          .from(schema.units)
          .where(eq(schema.units.projectId, input.projectId));

        return {
          renderExteriorKey: projectRows[0]?.renderExteriorKey ?? null,
          floors,
          units,
        };
      }),
    ),

  // Save a floor polygon (HSPOT-01). requireRole gates authorization; the server re-validates +
  // re-serializes (D-08) before the UPDATE. UPDATE scoped by (id ∧ projectId) + .returning() 0-row →
  // NOT_FOUND (cross-org/non-existent invisibility, no-enumeration).
  setFloorPolygon: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        floorId: z.uuid(),
        poligonoSvg: z.string().max(MAX_POLYGON_B),
      }),
    )
    .mutation(({ ctx, input }) => {
      const canonical = toCanonicalPolygon(input.poligonoSvg);
      return withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .update(schema.floors)
          .set({ poligonoSvg: canonical })
          .where(
            and(
              eq(schema.floors.id, input.floorId),
              eq(schema.floors.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.floors.id, poligonoSvg: schema.floors.poligonoSvg });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return rows[0];
      });
    }),

  // Clear a floor polygon (HSPOT-03, D-02): a field-to-null UPDATE, NOT a row delete — the floor row
  // still exists afterward. Same role gate + .returning() 0-row → NOT_FOUND guard.
  clearFloorPolygon: requireRole("owner", "developer")
    .input(z.object({ projectId: z.uuid(), floorId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .update(schema.floors)
          .set({ poligonoSvg: null })
          .where(
            and(
              eq(schema.floors.id, input.floorId),
              eq(schema.floors.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.floors.id, poligonoSvg: schema.floors.poligonoSvg });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return rows[0];
      }),
    ),

  // Save a unit polygon (HSPOT-02) — identical shape on schema.units, keyed by (unitId ∧ projectId).
  setUnitPolygon: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        unitId: z.uuid(),
        poligonoSvg: z.string().max(MAX_POLYGON_B),
      }),
    )
    .mutation(({ ctx, input }) => {
      const canonical = toCanonicalPolygon(input.poligonoSvg);
      return withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .update(schema.units)
          .set({ poligonoSvg: canonical })
          .where(
            and(
              eq(schema.units.id, input.unitId),
              eq(schema.units.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.units.id, poligonoSvg: schema.units.poligonoSvg });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return rows[0];
      });
    }),

  // Clear a unit polygon (HSPOT-03, D-02): field-to-null UPDATE, NOT a row delete.
  clearUnitPolygon: requireRole("owner", "developer")
    .input(z.object({ projectId: z.uuid(), unitId: z.uuid() }))
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .update(schema.units)
          .set({ poligonoSvg: null })
          .where(
            and(
              eq(schema.units.id, input.unitId),
              eq(schema.units.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.units.id, poligonoSvg: schema.units.poligonoSvg });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return rows[0];
      }),
    ),
});
