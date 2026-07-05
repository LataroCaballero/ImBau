// picker router integration tests (UI-01 / UI-05) — the anon read seam the piso→unidad picker
// needs, proven RLS-safe against the live Postgres `_test` DB. Every assertion runs through the
// ANONYMOUS tRPC caller (`createCaller({ headers: new Headers() })` → pickerRouter → withAnon →
// the real anon RLS role), exercising the exact production path (mirrors quotes-router.test.ts).
//
// Seeding strategy: one org is minted by the REAL auth runtime via makeUserWithActiveOrg (the
// only sanctioned owner-pool write path for RLS-FORCED org/member tables). Under it we seed —
// through the OWNER SQL client, in FK order — a `publicado` project (with a whatsapp value, a
// floor, three units of mixed status, and a payment plan carrying notasLegales) plus a `borrador`
// project (with its own floor + unit). The BEHAVIOR under test flows through the anon caller: it
// must see ONLY the publicado project's rows across all four procedures — the borrador rows are
// invisible purely by RLS.
//
// Ids / whatsapp / notasLegales are checked with EXACT equality — never a fuzzy matcher.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

const WHATSAPP_PUBLICADO = "+5491133334444";
const NOTAS_LEGALES = "Cotización no vinculante. Valores sujetos a confirmación.";
const ANTICIPO_PCT = "30.00";
const PLAN_CUOTAS = 12;

interface ProjectFixture {
  projectId: string;
  slug: string;
  floorId: string;
  unitIds: string[];
  paymentPlanId: string;
}

// Seed a full picker fixture for `orgId` through the OWNER pool, in FK order: project → floor →
// units (mixed status) → payment plan. `estadoValue` controls anon visibility. When `withPlan`
// is set the plan carries notasLegales + the snap-slider preset fields.
async function seedProjectFixture(
  orgId: string,
  estadoValue: "publicado" | "borrador",
  opts: { whatsapp: string | null; unitStates: ("disponible" | "reservado" | "vendido")[] },
): Promise<ProjectFixture> {
  const projectId = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;
  await owner`
    insert into projects (id, organization_id, nombre, slug, estado, whatsapp)
    values (${projectId}, ${orgId}, ${`P ${slug}`}, ${slug}, ${estadoValue}, ${opts.whatsapp})
  `;

  const floorId = randomUUID();
  await owner`
    insert into floors (id, organization_id, project_id, numero, nombre)
    values (${floorId}, ${orgId}, ${projectId}, ${1}, ${"Planta 1"})
  `;

  const unitIds: string[] = [];
  for (const [i, unitEstado] of opts.unitStates.entries()) {
    const unitId = randomUUID();
    unitIds.push(unitId);
    await owner`
      insert into units (id, organization_id, project_id, floor_id, identificador, estado, orden)
      values (${unitId}, ${orgId}, ${projectId}, ${floorId}, ${`1${String.fromCharCode(65 + i)}`}, ${unitEstado}, ${i})
    `;
  }

  const paymentPlanId = randomUUID();
  await owner`
    insert into payment_plans
      (id, organization_id, project_id, nombre, anticipo_pct, cuotas, ajuste, refuerzos, notas_legales)
    values
      (${paymentPlanId}, ${orgId}, ${projectId}, ${"Plan 30/70 CAC"}, ${ANTICIPO_PCT}, ${PLAN_CUOTAS},
       ${"CAC"}, ${owner.json([{ cuota: 6, montoUsd: 5000 }])}, ${NOTAS_LEGALES})
  `;

  return { projectId, slug, floorId, unitIds, paymentPlanId };
}

let org: SessionFixture;
let publicado: ProjectFixture;
let borrador: ProjectFixture;

beforeAll(async () => {
  org = await makeUserWithActiveOrg();
  publicado = await seedProjectFixture(org.orgId, "publicado", {
    whatsapp: WHATSAPP_PUBLICADO,
    unitStates: ["disponible", "reservado", "vendido"],
  });
  borrador = await seedProjectFixture(org.orgId, "borrador", {
    whatsapp: null,
    unitStates: ["disponible"],
  });
}, 60_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("picker anon reads see published-only rows (UI-01 / UI-05)", () => {
  it("getPublishedProject resolves the published project with its whatsapp CTA number", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const rows = await caller.picker.getPublishedProject({ slug: publicado.slug });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.id).toBe(publicado.projectId);
    expect(row?.whatsapp).toBe(WHATSAPP_PUBLICADO);
  });

  it("getPublishedProject returns no row for an unpublished project", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const rows = await caller.picker.getPublishedProject({ slug: borrador.slug });
    expect(rows).toHaveLength(0);
  });

  it("listFloors returns the published project's floors, none for the unpublished one", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const visible = await caller.picker.listFloors({ projectId: publicado.projectId });
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(publicado.floorId);

    const hidden = await caller.picker.listFloors({ projectId: borrador.projectId });
    expect(hidden).toHaveLength(0);
  });

  it("listUnits returns ALL units incl. non-disponible ones (status is not filtered server-side)", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const units = await caller.picker.listUnits({ floorId: publicado.floorId });
    expect(units).toHaveLength(3);
    const ids = units.map((u) => u.id).sort();
    expect(ids).toEqual([...publicado.unitIds].sort());
    const states = units.map((u) => u.estado).sort();
    expect(states).toEqual(["disponible", "reservado", "vendido"]);

    const hidden = await caller.picker.listUnits({ floorId: borrador.floorId });
    expect(hidden).toHaveLength(0);
  });

  it("listPlans returns the plan with notasLegales and the snap-slider preset fields", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const plans = await caller.picker.listPlans({ projectId: publicado.projectId });
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan).toBeDefined();
    expect(plan?.id).toBe(publicado.paymentPlanId);
    expect(plan?.notasLegales).toBe(NOTAS_LEGALES);
    expect(plan?.anticipoPct).toBe(ANTICIPO_PCT);
    expect(plan?.cuotas).toBe(PLAN_CUOTAS);
    expect(plan?.ajuste).toBe("CAC");
    expect(plan?.refuerzos).toEqual([{ cuota: 6, montoUsd: 5000 }]);

    const hidden = await caller.picker.listPlans({ projectId: borrador.projectId });
    expect(hidden).toHaveLength(0);
  });
});
