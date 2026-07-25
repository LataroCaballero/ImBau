// units role-gate cross-role matrix (GRID-01/GRID-02, D-01/D-02, PANEL-02 mold) — the load-bearing
// proof that the panel's money writes enforce authorization + tenant isolation + no-enumeration
// server-side, NOT via UI hiding. Everything under test is asserted THROUGH the tRPC caller
// (createCaller) → the unprivileged app_authenticated role, exactly as a real panel request. The
// owner SQL pool appears ONLY in seeding (beforeAll), never inside an it(...) assertion (RESEARCH
// Pitfall 4 — asserting as the owner pool would false-green the RLS gate).
//
// Matrix (for BOTH updatePrice and updateEstado, against orgA's project):
//   owner (orgA)            → resolves, write persists
//   developer (orgA member) → resolves
//   viewer (orgA member)    → FORBIDDEN (requireRole, pre-write)
//   other-org owner (orgB)  → NOT_FOUND (RLS invisibility, no-enumeration)
//   non-existent id (orgA)  → NOT_FOUND (identical to cross-org)
// Plus: each successful write inserts an `events` audit row (tipo unit_price_changed /
// unit_estado_changed) in the SAME transaction (D-02), asserted via the owner pool post-hoc.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import {
  makeUserWithActiveOrg,
  mintMemberInOrg,
  type SessionFixture,
} from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

interface ProjectSeed {
  projectId: string;
  floorId: string;
  unitId: string;
  financiadoListId: string;
  contadoListId: string;
}

// Seed a project + floor + unit + 2 USD price lists (Financiado + Contado) for `orgId` through the
// OWNER pool, in FK order. The catálogo/pricing parents have no editor router, so they land via raw
// owner SQL exactly like the other role-gate suites.
async function seedProject(orgId: string): Promise<ProjectSeed> {
  const projectId = randomUUID();
  const floorId = randomUUID();
  const unitId = randomUUID();
  const financiadoListId = randomUUID();
  const contadoListId = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;

  await owner`
    insert into projects (id, organization_id, nombre, slug, estado)
    values (${projectId}, ${orgId}, ${`P ${slug}`}, ${slug}, 'borrador')
  `;
  await owner`
    insert into floors (id, organization_id, project_id, numero, nombre)
    values (${floorId}, ${orgId}, ${projectId}, 4, 'Piso 4')
  `;
  await owner`
    insert into units (id, organization_id, project_id, floor_id, identificador, tipologia, estado)
    values (${unitId}, ${orgId}, ${projectId}, ${floorId}, '4B', '2 amb', 'disponible')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${financiadoListId}, ${orgId}, ${projectId}, 'Financiado', 'USD')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${contadoListId}, ${orgId}, ${projectId}, 'Contado', 'USD')
  `;
  return { projectId, floorId, unitId, financiadoListId, contadoListId };
}

// Count events rows for a (unitId, tipo) — the D-02 audit assertion, read via the owner pool.
async function countEvents(unitId: string, tipo: string): Promise<number> {
  const rows = await owner<{ n: string }[]>`
    select count(*)::int as n from events where unit_id = ${unitId} and tipo = ${tipo}
  `;
  return Number(rows[0]?.n ?? 0);
}

let orgA: SessionFixture;
let orgB: SessionFixture;
let developerA: SessionFixture;
let viewerA: SessionFixture;
let seed: ProjectSeed;

beforeAll(async () => {
  orgA = await makeUserWithActiveOrg();
  orgB = await makeUserWithActiveOrg();
  developerA = await mintMemberInOrg(orgA, "developer");
  viewerA = await mintMemberInOrg(orgA, "viewer");
  seed = await seedProject(orgA.orgId);
}, 120_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("units.updatePrice write gate (GRID-01 / D-01 / D-02)", () => {
  it("owner caller upserts one price row, sets it again idempotently, and emits an audit event", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.units.updatePrice({
      projectId: seed.projectId,
      unitId: seed.unitId,
      priceListId: seed.financiadoListId,
      precio: 290000,
    });
    expect(row).toMatchObject({
      unitId: seed.unitId,
      priceListId: seed.financiadoListId,
      precio: 290000,
    });

    // Second write on the same (unit, list) UPDATES in place (idempotent on the Plan 01 UNIQUE):
    // still exactly one price row.
    await caller.units.updatePrice({
      projectId: seed.projectId,
      unitId: seed.unitId,
      priceListId: seed.financiadoListId,
      precio: 305000,
    });
    const priceRows = await owner<{ n: string }[]>`
      select count(*)::int as n from unit_prices
      where unit_id = ${seed.unitId} and price_list_id = ${seed.financiadoListId}
    `;
    expect(Number(priceRows[0]?.n)).toBe(1);
    // Two successful writes → two audit events (D-02).
    expect(await countEvents(seed.unitId, "unit_price_changed")).toBeGreaterThanOrEqual(2);
  });

  it("developer caller resolves", async () => {
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.units.updatePrice({
      projectId: seed.projectId,
      unitId: seed.unitId,
      priceListId: seed.contadoListId,
      precio: 315000,
    });
    expect(row).toMatchObject({ precio: 315000 });
  });

  it("viewer caller is rejected with FORBIDDEN (before any write)", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.units.updatePrice({
        projectId: seed.projectId,
        unitId: seed.unitId,
        priceListId: seed.financiadoListId,
        precio: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.units.updatePrice({
        projectId: seed.projectId,
        unitId: seed.unitId,
        priceListId: seed.financiadoListId,
        precio: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent unit id under the active org yields NOT_FOUND (no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.units.updatePrice({
        projectId: seed.projectId,
        unitId: randomUUID(),
        priceListId: seed.financiadoListId,
        precio: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("units.updateEstado write gate (GRID-02 / D-02)", () => {
  it("owner caller changes estado and emits an audit event", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const before = await countEvents(seed.unitId, "unit_estado_changed");
    const row = await caller.units.updateEstado({
      projectId: seed.projectId,
      unitId: seed.unitId,
      estado: "reservado",
    });
    expect(row).toMatchObject({ id: seed.unitId, estado: "reservado" });
    expect(await countEvents(seed.unitId, "unit_estado_changed")).toBe(before + 1);
    // Reset to a known state for later cases.
    await caller.units.updateEstado({
      projectId: seed.projectId,
      unitId: seed.unitId,
      estado: "disponible",
    });
  });

  it("developer caller resolves", async () => {
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.units.updateEstado({
      projectId: seed.projectId,
      unitId: seed.unitId,
      estado: "vendido",
    });
    expect(row).toMatchObject({ estado: "vendido" });
    await caller.units.updateEstado({
      projectId: seed.projectId,
      unitId: seed.unitId,
      estado: "disponible",
    });
  });

  it("viewer caller is rejected with FORBIDDEN", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.units.updateEstado({
        projectId: seed.projectId,
        unitId: seed.unitId,
        estado: "vendido",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.units.updateEstado({
        projectId: seed.projectId,
        unitId: seed.unitId,
        estado: "vendido",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent unit id under the active org yields NOT_FOUND (no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.units.updateEstado({
        projectId: seed.projectId,
        unitId: randomUUID(),
        estado: "vendido",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("units.listForProject grid read (GRID-01)", () => {
  it("returns the active-org grid; a cross-org projectId yields empty units", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const grid = await caller.units.listForProject({ projectId: seed.projectId });
    expect(grid.units.map((u) => u.unitId)).toContain(seed.unitId);
    expect(grid.priceLists.length).toBeGreaterThanOrEqual(2);

    const other = await createCaller({ headers: orgB.headers });
    const empty = await other.units.listForProject({ projectId: seed.projectId });
    expect(empty.units).toHaveLength(0);
  });
});
