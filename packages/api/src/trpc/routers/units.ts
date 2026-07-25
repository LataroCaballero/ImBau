// units router (GRID-01..07) — the panel's money-write seam and the Excel round-trip.
//
// This is the D1 clone of the Phase 9 `projects.updateSettings` mold: every WRITE is a
// requireRole("owner","developer") mutation routed exclusively through withTenant(ctx.activeOrgId)
// on the unprivileged app pool — RLS proves TENANT ISOLATION, requireRole proves AUTHORIZATION
// (they are orthogonal; RLS alone would let a viewer write, so the explicit role gate is
// load-bearing — the Phase 9 lesson). A cross-org / non-existent id is INVISIBLE under RLS, so:
//   - updateEstado (a plain UPDATE) affects 0 rows → the .returning() guard turns the silent no-op
//     into NOT_FOUND (verbatim updateSettings clone, no-enumeration).
//   - updatePrice (an INSERT ... ON CONFLICT) cannot rely on a 0-row UPDATE: a cross-org unit/list
//     would raise a composite-FK violation (23503) rather than a clean 0-row. So it FIRST does an
//     RLS-scoped existence check of the unit + price_list under the active org (invisible → 0 rows
//     → NOT_FOUND), then upserts. Same no-enumeration guarantee, correct for the INSERT path.
//
// ALL risky logic is delegated to the pure, I/O-free packages/api/src/excel/ module (Plan 02):
// buildWorkbook (sanitized export), parseWorkbook (defensive import), buildDryRun (money/estado
// classification — the server RE-RUNS it inside the tx and NEVER trusts a client isValid flag),
// computeBulkPreview (Math.round integer-USD, rejects negatives). Money is integer USD end-to-end;
// vigencia is server-set now(), never client-supplied (D-01/D-08).
//
// importExcel + bulkUpdatePrice are each ONE withTenant transaction (all-or-nothing): one bad row
// throws → the tx rolls back → zero writes; re-importing an unchanged file is a no-op (every row
// "sin cambios"), idempotent on the Plan 01 UNIQUE(unit_id, price_list_id). Every price/estado
// write inserts an `events` audit row in the SAME transaction (D-02) — an audit row exists iff the
// mutation committed.
//
// This router imports ONLY withTenant/schema from @imbau/db — never the elevated owner pool (the
// Phase 9 grep-fence). GRID-07 public reflection needs NO plumbing here: apps/web is force-dynamic,
// so a committed write is visible on the next anon read (Path A — proven in public-reflection.test).
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTenant, schema } from "@imbau/db";
import { router, protectedProcedure } from "../init";
import { requireRole } from "../middleware";
import { buildWorkbook } from "../../excel/build";
import { parseWorkbook } from "../../excel/parse";
import { buildDryRun } from "../../excel/dry-run";
import { computeBulkPreview } from "../../excel/bulk";
import { MAX_PRECIO_USD } from "../../excel/money-core";
import type {
  BulkSelectionUnit,
  CurrentUnit,
  ExportRow,
} from "../../excel/types";

// Stable English events.tipo constants (Open Q #3). Kept here so the audit vocabulary is
// single-sourced for both inline mutations and the Excel/bulk apply loops.
const EVENT_PRICE_CHANGED = "unit_price_changed";
const EVENT_ESTADO_CHANGED = "unit_estado_changed";

// The valid unit estados — a local z.enum mirror of packages/db unidadEstadoEnum (SCHEMA-01).
const UNIT_ESTADOS = ["disponible", "reservado", "vendido"] as const;
type UnitEstado = (typeof UNIT_ESTADOS)[number];

// Bound the base64 upload so an oversized spreadsheet is rejected at the boundary BEFORE parsing
// (T-10-XLSX-DOS, ASVS V12). ~10 MB of base64 dwarfs a ~38-row workbook (a few KB) by orders of
// magnitude while still refusing a memory-exhaustion payload.
const MAX_FILE_B64 = 10_000_000;

// A tenant-scoped tx handle (the only write seam). Local alias so the grid helpers type cleanly.
type Tx = Parameters<Parameters<typeof withTenant<unknown>>[1]>[0];

// One resolved grid row carrying both the export/reference columns and the current per-list prices.
interface GridUnit {
  unitId: string;
  identificador: string;
  piso: string;
  tipologia: string;
  m2: number | null;
  estado: string;
  financiado: number | null;
  contado: number | null;
}

interface Grid {
  /** All price lists of the project (id + nombre + moneda) — the panel's column metadata. */
  priceLists: { id: string; nombre: string; moneda: string }[];
  /** The USD list treated as the "Contado" column (nombre matches /contado/i), or null. */
  contadoListId: string | null;
  /** The other USD list treated as the "Financiado" column, or null. */
  financiadoListId: string | null;
  units: GridUnit[];
}

// Read the full project grid inside an already-open tenant tx. RLS scopes every row to the active
// org, so a cross-org projectId yields empty arrays (never a leak). Contado vs Financiado is
// resolved by list nombre (the same /contado/i convention quotes.ts uses) so export, dry-run and
// apply all agree on which USD list each price column maps to.
async function readGrid(tx: Tx, projectId: string): Promise<Grid> {
  const priceLists = await tx
    .select({
      id: schema.priceLists.id,
      nombre: schema.priceLists.nombre,
      moneda: schema.priceLists.moneda,
    })
    .from(schema.priceLists)
    .where(eq(schema.priceLists.projectId, projectId));

  const usdLists = priceLists.filter((l) => l.moneda === "USD");
  const contadoListId =
    usdLists.find((l) => /contado/i.test(l.nombre))?.id ?? null;
  const financiadoListId =
    usdLists.find((l) => !/contado/i.test(l.nombre))?.id ?? null;

  const unitRows = await tx
    .select({
      id: schema.units.id,
      identificador: schema.units.identificador,
      tipologia: schema.units.tipologia,
      m2: schema.units.m2,
      estado: schema.units.estado,
      floorNumero: schema.floors.numero,
      floorNombre: schema.floors.nombre,
    })
    .from(schema.units)
    .innerJoin(
      schema.floors,
      and(
        eq(schema.units.floorId, schema.floors.id),
        eq(schema.units.organizationId, schema.floors.organizationId),
      ),
    )
    .where(eq(schema.units.projectId, projectId));

  const priceRows = await tx
    .select({
      unitId: schema.unitPrices.unitId,
      priceListId: schema.unitPrices.priceListId,
      precio: schema.unitPrices.precio,
    })
    .from(schema.unitPrices)
    .where(eq(schema.unitPrices.projectId, projectId));

  const finByUnit = new Map<string, number>();
  const conByUnit = new Map<string, number>();
  for (const p of priceRows) {
    if (financiadoListId && p.priceListId === financiadoListId)
      finByUnit.set(p.unitId, p.precio);
    if (contadoListId && p.priceListId === contadoListId)
      conByUnit.set(p.unitId, p.precio);
  }

  const units: GridUnit[] = unitRows.map((u) => ({
    unitId: u.id,
    identificador: u.identificador,
    piso: u.floorNombre ?? String(u.floorNumero),
    tipologia: u.tipologia ?? "",
    m2: u.m2 === null ? null : Number(u.m2),
    estado: u.estado,
    financiado: finByUnit.get(u.id) ?? null,
    contado: conByUnit.get(u.id) ?? null,
  }));

  return { priceLists, contadoListId, financiadoListId, units };
}

// Project the grid into the pure module's CurrentUnit snapshot (unitId/identificador/estado + the
// two USD price columns) — the input buildDryRun classifies the uploaded rows against.
function toCurrentUnits(grid: Grid): CurrentUnit[] {
  return grid.units.map((u) => ({
    unitId: u.unitId,
    identificador: u.identificador,
    estado: u.estado,
    financiado: u.financiado,
    contado: u.contado,
  }));
}

export const unitsRouter = router({
  // Grid read (GRID-01): owner/developer/viewer all read the matrix; RLS scopes it to the active
  // org, so a cross-org projectId returns empty arrays. No app-layer org filter — the policy does it.
  listForProject: protectedProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const grid = await readGrid(tx, input.projectId);
        return {
          priceLists: grid.priceLists,
          contadoListId: grid.contadoListId,
          financiadoListId: grid.financiadoListId,
          units: grid.units,
        };
      }),
    ),

  // Inline price edit (GRID-01, D-01): UPSERT one row per unit×list, vigencia server-set now().
  // requireRole gates authorization; the RLS-scoped existence pre-check turns a cross-org/unknown
  // unit or list into NOT_FOUND (no-enumeration) BEFORE the insert — an INSERT ... ON CONFLICT
  // against a cross-org parent would otherwise raise a composite-FK violation, not a clean 0-row.
  updatePrice: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        unitId: z.uuid(),
        priceListId: z.uuid(),
        // WR-01: `precio` is an int4 column — cap at the int4 max so an oversized value is a clean 400
        // at the boundary, never an unhandled `integer out of range (22003)` 500 from the INSERT.
        precio: z.number().int().min(0).max(MAX_PRECIO_USD),
      }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const unitRows = await tx
          .select({ id: schema.units.id })
          .from(schema.units)
          .where(
            and(
              eq(schema.units.id, input.unitId),
              eq(schema.units.projectId, input.projectId),
            ),
          );
        if (unitRows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const listRows = await tx
          .select({ id: schema.priceLists.id })
          .from(schema.priceLists)
          .where(
            and(
              eq(schema.priceLists.id, input.priceListId),
              eq(schema.priceLists.projectId, input.projectId),
            ),
          );
        if (listRows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const rows = await tx
          .insert(schema.unitPrices)
          .values({
            organizationId: ctx.activeOrgId,
            projectId: input.projectId,
            unitId: input.unitId,
            priceListId: input.priceListId,
            precio: input.precio,
            vigencia: sql`now()`,
          })
          .onConflictDoUpdate({
            target: [schema.unitPrices.unitId, schema.unitPrices.priceListId],
            set: { precio: input.precio, vigencia: sql`now()` },
          })
          .returning({
            id: schema.unitPrices.id,
            unitId: schema.unitPrices.unitId,
            priceListId: schema.unitPrices.priceListId,
            precio: schema.unitPrices.precio,
          });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        await tx.insert(schema.events).values({
          organizationId: ctx.activeOrgId,
          projectId: input.projectId,
          tipo: EVENT_PRICE_CHANGED,
          unitId: input.unitId,
        });
        return rows[0];
      }),
    ),

  // Inline estado edit (GRID-02): the verbatim updateSettings clone — UPDATE + .returning() 0-row
  // NOT_FOUND. estado validated against the unidadEstadoEnum mirror before the write.
  updateEstado: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        unitId: z.uuid(),
        estado: z.enum(UNIT_ESTADOS),
      }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const rows = await tx
          .update(schema.units)
          .set({ estado: input.estado })
          .where(
            and(
              eq(schema.units.id, input.unitId),
              eq(schema.units.projectId, input.projectId),
            ),
          )
          .returning({ id: schema.units.id, estado: schema.units.estado });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        await tx.insert(schema.events).values({
          organizationId: ctx.activeOrgId,
          projectId: input.projectId,
          tipo: EVENT_ESTADO_CHANGED,
          unitId: input.unitId,
        });
        return rows[0];
      }),
    ),

  // Export (GRID-03, D-10/D-11): role-readable canonical workbook of ALL project units, sanitized
  // against formula/CSV injection by the pure buildWorkbook. Returned base64 so the panel can offer
  // a download without Next proxying binary bytes.
  exportExcel: protectedProcedure
    .input(z.object({ projectId: z.uuid() }))
    .query(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const grid = await readGrid(tx, input.projectId);
        const rows: ExportRow[] = grid.units.map((u) => ({
          identificador: u.identificador,
          piso: u.piso,
          tipologia: u.tipologia,
          m2: u.m2,
          financiado: u.financiado,
          contado: u.contado,
          estado: u.estado,
        }));
        const buf = await buildWorkbook(rows);
        return { filename: "unidades.xlsx", base64: buf.toString("base64") };
      }),
    ),

  // Import dry-run (GRID-04, D-06): parse + classify against LIVE DB rows, write NOTHING. The pure
  // buildDryRun is the single source of validation truth; the panel shows its nuevas/con cambios/
  // sin cambios/errores summary before the operator confirms the apply.
  dryRunImport: requireRole("owner", "developer")
    .input(z.object({ projectId: z.uuid(), file: z.string().max(MAX_FILE_B64) }))
    .mutation(async ({ ctx, input }) => {
      const raw = await parseWorkbook(Buffer.from(input.file, "base64"));
      return withTenant(ctx.activeOrgId, async (tx) => {
        const grid = await readGrid(tx, input.projectId);
        return buildDryRun(raw, toCurrentUnits(grid));
      });
    }),

  // Import apply (GRID-05, D-08): ONE all-or-nothing withTenant transaction. The server RE-PARSES +
  // RE-VALIDATES via buildDryRun inside the tx (never trusts a client flag); any error aborts the tx
  // → zero writes. Otherwise it applies each price change (upsert on the Plan 01 UNIQUE, or delete
  // when a price is cleared to blank/null) and estado change, inserting an events audit row per
  // change in the SAME tx. An unchanged re-import classifies every row "sin cambios" → zero writes
  // (idempotent no-op).
  importExcel: requireRole("owner", "developer")
    .input(z.object({ projectId: z.uuid(), file: z.string().max(MAX_FILE_B64) }))
    .mutation(async ({ ctx, input }) => {
      const raw = await parseWorkbook(Buffer.from(input.file, "base64"));
      return withTenant(ctx.activeOrgId, async (tx) => {
        const grid = await readGrid(tx, input.projectId);
        const report = buildDryRun(raw, toCurrentUnits(grid));
        if (report.errors.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El archivo tiene filas inválidas; no se aplicó ningún cambio.",
            cause: report.errors,
          });
        }

        let applied = 0;
        for (const row of report.rows) {
          if (row.rowClass === "sin cambios") continue;
          for (const change of row.changes) {
            if (change.field === "estado") {
              await tx
                .update(schema.units)
                .set({ estado: change.new as UnitEstado })
                .where(
                  and(
                    eq(schema.units.id, row.unitId),
                    eq(schema.units.projectId, input.projectId),
                  ),
                );
              await tx.insert(schema.events).values({
                organizationId: ctx.activeOrgId,
                projectId: input.projectId,
                tipo: EVENT_ESTADO_CHANGED,
                unitId: row.unitId,
              });
            } else {
              const listId =
                change.field === "financiado"
                  ? grid.financiadoListId
                  : grid.contadoListId;
              if (!listId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `El proyecto no tiene una lista de precios ${change.field}.`,
                });
              }
              const nextPrice = change.new;
              if (nextPrice === null) {
                // A cleared (blank) price removes the row so the unit reads as unpriced again.
                await tx
                  .delete(schema.unitPrices)
                  .where(
                    and(
                      eq(schema.unitPrices.unitId, row.unitId),
                      eq(schema.unitPrices.priceListId, listId),
                    ),
                  );
              } else if (typeof nextPrice === "number") {
                await tx
                  .insert(schema.unitPrices)
                  .values({
                    organizationId: ctx.activeOrgId,
                    projectId: input.projectId,
                    unitId: row.unitId,
                    priceListId: listId,
                    precio: nextPrice,
                    vigencia: sql`now()`,
                  })
                  .onConflictDoUpdate({
                    target: [
                      schema.unitPrices.unitId,
                      schema.unitPrices.priceListId,
                    ],
                    set: { precio: nextPrice, vigencia: sql`now()` },
                  });
              }
              await tx.insert(schema.events).values({
                organizationId: ctx.activeOrgId,
                projectId: input.projectId,
                tipo: EVENT_PRICE_CHANGED,
                unitId: row.unitId,
              });
            }
          }
          applied += 1;
        }
        return { applied };
      });
    }),

  // Bulk preview (GRID-06, D-12): compute the % / fixed change over a selection on one list via the
  // pure computeBulkPreview (Math.round integer USD, rejects negatives) — the mandatory D-13 modal
  // shows this true old→new before any write.
  bulkPreview: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        unitIds: z.array(z.uuid()).min(1),
        priceListId: z.uuid(),
        mode: z.enum(["percent", "fixed"]),
        // WR-02: reject Infinity/NaN and absurd magnitudes at the boundary (the client gates
        // Number.isFinite, but a direct tRPC call is not so constrained). A non-finite value would
        // reach Math.round in computeBulkPreview and write precio: Infinity → a 500 aborting the tx.
        value: z.number().finite().min(-MAX_PRECIO_USD).max(MAX_PRECIO_USD),
      }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const selection = await buildBulkSelection(
          tx,
          input.projectId,
          input.unitIds,
          input.priceListId,
        );
        return computeBulkPreview(selection, input.mode, input.value);
      }),
    ),

  // Bulk apply (GRID-06, D-12): ONE withTenant transaction of N upserts + events on the chosen list.
  // A previewed negative result rejects the WHOLE apply (never write a negative price).
  bulkUpdatePrice: requireRole("owner", "developer")
    .input(
      z.object({
        projectId: z.uuid(),
        unitIds: z.array(z.uuid()).min(1),
        priceListId: z.uuid(),
        mode: z.enum(["percent", "fixed"]),
        // WR-02: reject Infinity/NaN and absurd magnitudes at the boundary (the client gates
        // Number.isFinite, but a direct tRPC call is not so constrained). A non-finite value would
        // reach Math.round in computeBulkPreview and write precio: Infinity → a 500 aborting the tx.
        value: z.number().finite().min(-MAX_PRECIO_USD).max(MAX_PRECIO_USD),
      }),
    )
    .mutation(({ ctx, input }) =>
      withTenant(ctx.activeOrgId, async (tx) => {
        const listRows = await tx
          .select({ id: schema.priceLists.id })
          .from(schema.priceLists)
          .where(
            and(
              eq(schema.priceLists.id, input.priceListId),
              eq(schema.priceLists.projectId, input.projectId),
            ),
          );
        if (listRows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const selection = await buildBulkSelection(
          tx,
          input.projectId,
          input.unitIds,
          input.priceListId,
        );
        const preview = computeBulkPreview(selection, input.mode, input.value);
        if (preview.errors.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La edición masiva produce precios inválidos; no se aplicó ningún cambio.",
            cause: preview.errors,
          });
        }

        let applied = 0;
        for (const r of preview.rows) {
          await tx
            .insert(schema.unitPrices)
            .values({
              organizationId: ctx.activeOrgId,
              projectId: input.projectId,
              unitId: r.unitId,
              priceListId: input.priceListId,
              precio: r.new,
              vigencia: sql`now()`,
            })
            .onConflictDoUpdate({
              target: [
                schema.unitPrices.unitId,
                schema.unitPrices.priceListId,
              ],
              set: { precio: r.new, vigencia: sql`now()` },
            });
          await tx.insert(schema.events).values({
            organizationId: ctx.activeOrgId,
            projectId: input.projectId,
            tipo: EVENT_PRICE_CHANGED,
            unitId: r.unitId,
          });
          applied += 1;
        }
        return { applied };
      }),
    ),
});

// Read the current price of each selected unit on the chosen list, scoped to the project (RLS scopes
// to the active org). A cross-org unitId is invisible → simply absent from the selection.
async function buildBulkSelection(
  tx: Tx,
  projectId: string,
  unitIds: string[],
  priceListId: string,
): Promise<BulkSelectionUnit[]> {
  const unitRows = await tx
    .select({ id: schema.units.id, identificador: schema.units.identificador })
    .from(schema.units)
    .where(
      and(
        eq(schema.units.projectId, projectId),
        inArray(schema.units.id, unitIds),
      ),
    );

  const priceRows = await tx
    .select({
      unitId: schema.unitPrices.unitId,
      precio: schema.unitPrices.precio,
    })
    .from(schema.unitPrices)
    .where(
      and(
        eq(schema.unitPrices.projectId, projectId),
        eq(schema.unitPrices.priceListId, priceListId),
        inArray(schema.unitPrices.unitId, unitIds),
      ),
    );
  const priceByUnit = new Map(priceRows.map((r) => [r.unitId, r.precio]));

  return unitRows.map((u) => ({
    unitId: u.id,
    identificador: u.identificador,
    current: priceByUnit.get(u.id) ?? null,
  }));
}
