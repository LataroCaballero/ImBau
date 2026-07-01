// seedPricing — price_lists + unit_prices + payment_plans + cac_index (SEED-02, PATTERNS §86-107).
//
// Two price_lists (both USD): "Financiado" (list price) and "Contado" (discounted). unit_prices are
// INTEGER USD (~USD 2900/m² adjusted by floor/orientation), never floats. payment_plans use
// ajuste='CAC' with a semestral Refuerzo[] validated by refuerzoSchema before insert. cac_index gets
// the 18-month synthetic series, conflict-targeted on its natural key (organization_id, periodo);
// every other insert conflicts on the PK id. All ids are seedId(name) → re-runnable.
//
// Order (composite FKs): price_lists + payment_plans BEFORE unit_prices (which FKs price_lists);
// units already exist (seedBuilding ran first). cac_index is org-scoped (no projectId).
import { withTenant } from "../with-tenant";
import * as schema from "../schema";
import { seedId, SEED_REFERENCE_DATE } from "./ids";
import { PRICE_LISTS, PAYMENT_PLANS, CAC_SERIES, PRICING } from "./content";
import { refuerzoSchema } from "../schema/json-schemas";
import type { SeededUnit } from "./building";

// Integer-USD list price for a unit: base $/m² adjusted by floor level + orientation, × m².
function listPriceUsd(unit: SeededUnit): number {
  const floorAdj =
    unit.floorNumero === 0
      ? PRICING.pbAdjustment
      : unit.floorNumero * PRICING.floorPremiumPerLevel;
  const orientAdj = PRICING.orientacionAdj[unit.orientacion];
  const usdPerM2 = PRICING.baseUsdPerM2 * (1 + floorAdj + orientAdj);
  // Round to whole USD — integer money (D-14), never a float.
  return Math.round(usdPerM2 * Number(unit.m2));
}

export async function seedPricing(
  orgId: string,
  projectId: string,
  units: readonly SeededUnit[],
): Promise<void> {
  // price_lists (2, both USD).
  const priceListRows = PRICE_LISTS.map((pl) => ({
    id: seedId(`brigos:pricelist:${pl.key}`),
    organizationId: orgId,
    projectId,
    nombre: pl.nombre,
    moneda: pl.moneda,
  }));
  await withTenant(orgId, (tx) =>
    tx.insert(schema.priceLists).values(priceListRows).onConflictDoNothing(),
  );

  // payment_plans — validate each Refuerzo (both cuota + montoUsd integers) before insert (D-12).
  const paymentPlanRows = PAYMENT_PLANS.map((pp) => {
    const refuerzos = pp.refuerzos.map((r) => refuerzoSchema.parse(r));
    return {
      id: seedId(`brigos:plan:${pp.key}`),
      organizationId: orgId,
      projectId,
      nombre: pp.nombre,
      anticipoPct: pp.anticipoPct, // numeric → STRING
      cuotas: pp.cuotas,
      ajuste: pp.ajuste,
      refuerzos,
      notasLegales: pp.notasLegales,
    };
  });
  await withTenant(orgId, (tx) =>
    tx.insert(schema.paymentPlans).values(paymentPlanRows).onConflictDoNothing(),
  );

  // unit_prices — one row per unit per price_list. precio is a JS INTEGER (whole USD) > 0.
  const unitPriceRows: (typeof schema.unitPrices.$inferInsert)[] = [];
  for (const unit of units) {
    const listPrice = listPriceUsd(unit);
    for (const pl of PRICE_LISTS) {
      const precio = pl.isContado
        ? Math.round(listPrice * (1 - PRICING.contadoDiscountPct))
        : listPrice;
      unitPriceRows.push({
        id: seedId(`brigos:unitprice:${unit.id}:${pl.key}`),
        organizationId: orgId,
        projectId,
        unitId: unit.id,
        priceListId: seedId(`brigos:pricelist:${pl.key}`),
        precio,
        vigencia: SEED_REFERENCE_DATE,
      });
    }
  }
  if (unitPriceRows.length > 0) {
    await withTenant(orgId, (tx) =>
      tx.insert(schema.unitPrices).values(unitPriceRows).onConflictDoNothing(),
    );
  }

  // cac_index — org-scoped 18-month series; conflict on the natural key (organization_id, periodo).
  const cacRows = CAC_SERIES.map((c) => ({
    id: seedId(`brigos:cac:${c.periodo}`),
    organizationId: orgId,
    periodo: c.periodo,
    valor: c.valor, // numeric → STRING
  }));
  await withTenant(orgId, (tx) =>
    tx
      .insert(schema.cacIndex)
      .values(cacRows)
      .onConflictDoNothing({
        target: [schema.cacIndex.organizationId, schema.cacIndex.periodo],
      }),
  );
}
