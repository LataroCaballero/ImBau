// GRID-07 public reflection (Path A, D-14) — the load-bearing cross-surface proof that a committed
// panel write is visible to the ANONYMOUS public read path on the very next request, with ZERO
// cache/revalidation plumbing. apps/web renders force-dynamic (every public request reads live from
// Postgres via the anon pool), so "instant reflection" is true by construction; this test asserts
// that architecture-level guarantee rather than adding an /api/revalidate endpoint or revalidateTag
// (Path B is explicitly out of scope — RESEARCH Open Q #1, resolved to Path A in 10-CONTEXT D-14).
//
// Per-request DB reads are acceptable at MVP scale. This clones the projects-role-gate
// estado→listPublished cross-surface pattern for the units surface: an owner createCaller performs
// a panel mutation, then an anon createCaller observes it — updateEstado via picker.listUnits, and
// updatePrice via the anon quotes.compute price read path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

interface Seed {
  projectId: string;
  floorId: string;
  unitId: string;
  contadoListId: string;
  paymentPlanId: string;
}

// Seed a PUBLISHED project + floor + unit + both USD price lists (Contado 90000 / Financiado 200000)
// + a fijo payment plan, so the anon quotes.compute(contado) path resolves. Owner pool = seeding only.
async function seed(orgId: string): Promise<Seed> {
  const projectId = randomUUID();
  const floorId = randomUUID();
  const unitId = randomUUID();
  const contadoListId = randomUUID();
  const financiadoListId = randomUUID();
  const paymentPlanId = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;

  await owner`
    insert into projects (id, organization_id, nombre, slug, estado)
    values (${projectId}, ${orgId}, ${`P ${slug}`}, ${slug}, 'publicado')
  `;
  await owner`
    insert into floors (id, organization_id, project_id, numero, nombre)
    values (${floorId}, ${orgId}, ${projectId}, 4, 'Piso 4')
  `;
  await owner`
    insert into units (id, organization_id, project_id, floor_id, identificador, estado)
    values (${unitId}, ${orgId}, ${projectId}, ${floorId}, '4B', 'disponible')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${contadoListId}, ${orgId}, ${projectId}, 'Contado', 'USD')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${financiadoListId}, ${orgId}, ${projectId}, 'Financiado', 'USD')
  `;
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values (${randomUUID()}, ${orgId}, ${projectId}, ${unitId}, ${contadoListId}, 90000, now())
  `;
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values (${randomUUID()}, ${orgId}, ${projectId}, ${unitId}, ${financiadoListId}, 200000, now())
  `;
  await owner`
    insert into payment_plans
      (id, organization_id, project_id, nombre, anticipo_pct, cuotas, ajuste, refuerzos)
    values
      (${paymentPlanId}, ${orgId}, ${projectId}, 'Contado', '0.00', 1, 'fijo', ${owner.json([])})
  `;
  return { projectId, floorId, unitId, contadoListId, paymentPlanId };
}

let org: SessionFixture;
let s: Seed;

beforeAll(async () => {
  org = await makeUserWithActiveOrg();
  s = await seed(org.orgId);
}, 120_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("GRID-07 — a committed panel write is visible to the anon public read (Path A)", () => {
  it("updateEstado (owner) is reflected by the anon picker.listUnits read", async () => {
    const ownerCaller = await createCaller({ headers: org.headers });
    const anonCaller = await createCaller({ headers: new Headers() });

    const before = await anonCaller.picker.listUnits({ floorId: s.floorId });
    expect(before.find((u) => u.id === s.unitId)?.estado).toBe("disponible");

    await ownerCaller.units.updateEstado({
      projectId: s.projectId,
      unitId: s.unitId,
      estado: "vendido",
    });

    const after = await anonCaller.picker.listUnits({ floorId: s.floorId });
    expect(after.find((u) => u.id === s.unitId)?.estado).toBe("vendido");
  });

  it("updatePrice (owner) is reflected by the anon quotes.compute price read", async () => {
    const ownerCaller = await createCaller({ headers: org.headers });
    const anonCaller = await createCaller({ headers: new Headers() });

    const before = await anonCaller.quotes.compute({
      projectId: s.projectId,
      unitId: s.unitId,
      paymentPlanId: s.paymentPlanId,
      modalidad: "contado",
    });
    expect(before).toMatchObject({ precioUsd: 90000 });

    await ownerCaller.units.updatePrice({
      projectId: s.projectId,
      unitId: s.unitId,
      priceListId: s.contadoListId,
      precio: 95000,
    });

    const after = await anonCaller.quotes.compute({
      projectId: s.projectId,
      unitId: s.unitId,
      paymentPlanId: s.paymentPlanId,
      modalidad: "contado",
    });
    expect(after).toMatchObject({ precioUsd: 95000 });
  });
});
