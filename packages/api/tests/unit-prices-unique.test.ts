// unit_prices natural-key enforcement (GRID-05, D-01, T-10-DUPKEY) — the load-bearing proof that
// the `UNIQUE(unit_id, price_list_id)` constraint added in migration 0005 is ENFORCED by the live
// `_test` Postgres, not merely declared in the schema. Without this, a never-applied migration would
// false-green the type/build gate. Everything here seeds through the OWNER pool ONLY (ownerSql) — we
// assert on the DB error, not on an app-role read (RLS isolation is Plan 03's job, not this plan's).
//
// Proof shape: seed one org + project + floor + unit + price_list, insert a first unit_prices row for
// (unit_id, price_list_id), then attempt a SECOND raw insert with the SAME natural key (different id,
// different precio). The DB must reject it with a unique violation (SQLSTATE 23505) naming
// unit_prices_unit_list_uq. `precio` stays an integer (USD whole units, D-14 — never a float).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

let org: SessionFixture;
let unitId: string;
let priceListId: string;
let projectId: string;

// Seed the parent chain org → project → floor → unit → price_list through the OWNER pool. The org
// itself is minted by the real Better Auth runtime (makeUserWithActiveOrg); the catálogo/pricing
// parents have no editor router yet, so they land via raw owner SQL exactly like projects-role-gate.
beforeAll(async () => {
  org = await makeUserWithActiveOrg();
  const orgId = org.orgId;

  projectId = randomUUID();
  const floorId = randomUUID();
  unitId = randomUUID();
  priceListId = randomUUID();
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
    insert into units (id, organization_id, project_id, floor_id, identificador, estado)
    values (${unitId}, ${orgId}, ${projectId}, ${floorId}, '4B', 'disponible')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${priceListId}, ${orgId}, ${projectId}, 'Financiado', 'USD')
  `;
}, 120_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("unit_prices UNIQUE(unit_id, price_list_id) enforcement (GRID-05 / T-10-DUPKEY)", () => {
  it("accepts the first price row for a (unit_id, price_list_id) pair", async () => {
    const rows = await owner<{ id: string }[]>`
      insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
      values (${randomUUID()}, ${org.orgId}, ${projectId}, ${unitId}, ${priceListId}, ${290000}, now())
      returning id
    `;
    expect(rows).toHaveLength(1);
  });

  it("rejects a SECOND insert with the same (unit_id, price_list_id) — unique violation 23505", async () => {
    let error: unknown;
    try {
      await owner`
        insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
        values (${randomUUID()}, ${org.orgId}, ${projectId}, ${unitId}, ${priceListId}, ${315000}, now())
      `;
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    // postgres.js surfaces the SQLSTATE on `.code`; the constraint name identifies the natural key.
    expect((error as { code?: string }).code).toBe("23505");
    expect((error as { constraint_name?: string }).constraint_name).toBe(
      "unit_prices_unit_list_uq",
    );
  });
});
