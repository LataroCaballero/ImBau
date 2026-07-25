// import-apply integration suite (GRID-03/04/05, D-08, T-10-PARTIAL-WRITE) — the load-bearing proof
// that the Excel round-trip is transactional (all-or-nothing) and idempotent against real Postgres.
// Every write goes THROUGH the owner tRPC caller (createCaller → withTenant → app_authenticated),
// never the owner SQL pool; the owner pool is used ONLY to seed and to read back the DB truth.
//
// The import file is built with the SAME pure buildWorkbook the exporter uses, so these tests
// exercise the exact canonical template the server re-parses + re-validates. The four properties:
//   (c) re-importing an unchanged export → applied 0, DB untouched (idempotent no-op).
//   (b) a file with ONE invalid row (unknown identificador) + a valid change → the whole apply throws
//       BAD_REQUEST and leaves ZERO rows changed (all-or-nothing rollback).
//   (a) a valid multi-row apply upserts the expected prices/estados and emits an events audit row per
//       change (D-02).
//   (d) re-applying the just-applied file → applied 0 and still exactly one price row per unit×list
//       (idempotent on the Plan 01 UNIQUE).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";
import { buildWorkbook } from "../src/excel/build";
import type { ExportRow } from "../src/excel/types";

const owner = ownerSql();

interface Seed {
  projectId: string;
  floorId: string;
  financiadoListId: string;
  contadoListId: string;
  u1: string; // "4A" — financiado 100000, contado 90000
  u2: string; // "4B" — unpriced
  u3: string; // "4C" — financiado 200000
}

async function seed(orgId: string): Promise<Seed> {
  const projectId = randomUUID();
  const floorId = randomUUID();
  const financiadoListId = randomUUID();
  const contadoListId = randomUUID();
  const u1 = randomUUID();
  const u2 = randomUUID();
  const u3 = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;

  await owner`
    insert into projects (id, organization_id, nombre, slug, estado)
    values (${projectId}, ${orgId}, ${`P ${slug}`}, ${slug}, 'borrador')
  `;
  await owner`
    insert into floors (id, organization_id, project_id, numero, nombre)
    values (${floorId}, ${orgId}, ${projectId}, 4, 'Piso 4')
  `;
  for (const [id, ident] of [
    [u1, "4A"],
    [u2, "4B"],
    [u3, "4C"],
  ] as const) {
    await owner`
      insert into units (id, organization_id, project_id, floor_id, identificador, estado)
      values (${id}, ${orgId}, ${projectId}, ${floorId}, ${ident}, 'disponible')
    `;
  }
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${financiadoListId}, ${orgId}, ${projectId}, 'Financiado', 'USD')
  `;
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values (${contadoListId}, ${orgId}, ${projectId}, 'Contado', 'USD')
  `;
  // u1 priced on both lists; u3 financiado only; u2 unpriced.
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values (${randomUUID()}, ${orgId}, ${projectId}, ${u1}, ${financiadoListId}, 100000, now())
  `;
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values (${randomUUID()}, ${orgId}, ${projectId}, ${u1}, ${contadoListId}, 90000, now())
  `;
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values (${randomUUID()}, ${orgId}, ${projectId}, ${u3}, ${financiadoListId}, 200000, now())
  `;
  return { projectId, floorId, financiadoListId, contadoListId, u1, u2, u3 };
}

async function priceOf(unitId: string, listId: string): Promise<number | null> {
  const rows = await owner<{ precio: number }[]>`
    select precio from unit_prices where unit_id = ${unitId} and price_list_id = ${listId}
  `;
  return rows[0]?.precio ?? null;
}
async function priceRowCount(unitId: string, listId: string): Promise<number> {
  const rows = await owner<{ n: string }[]>`
    select count(*)::int as n from unit_prices where unit_id = ${unitId} and price_list_id = ${listId}
  `;
  return Number(rows[0]?.n ?? 0);
}
async function estadoOf(unitId: string): Promise<string> {
  const rows = await owner<{ estado: string }[]>`
    select estado from units where id = ${unitId}
  `;
  return rows[0]?.estado ?? "";
}
async function eventCount(projectId: string): Promise<number> {
  const rows = await owner<{ n: string }[]>`
    select count(*)::int as n from events where project_id = ${projectId}
  `;
  return Number(rows[0]?.n ?? 0);
}

async function xlsxB64(rows: ExportRow[]): Promise<string> {
  return (await buildWorkbook(rows)).toString("base64");
}
function row(
  identificador: string,
  financiado: number | null,
  contado: number | null,
  estado: string,
): ExportRow {
  return { identificador, piso: "Piso 4", tipologia: "2 amb", m2: 50, financiado, contado, estado };
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

describe("importExcel is transactional + idempotent (GRID-05 / D-08)", () => {
  it("(c) re-importing the unchanged export is a no-op (applied 0, DB untouched)", async () => {
    const caller = await createCaller({ headers: org.headers });
    const exported = await caller.units.exportExcel({ projectId: s.projectId });
    const eventsBefore = await eventCount(s.projectId);

    const res = await caller.units.importExcel({
      projectId: s.projectId,
      file: exported.base64,
    });
    expect(res.applied).toBe(0);
    expect(await eventCount(s.projectId)).toBe(eventsBefore);
    expect(await priceOf(s.u1, s.financiadoListId)).toBe(100000);
  });

  it("(b) one invalid row aborts the WHOLE apply — zero writes (all-or-nothing)", async () => {
    const caller = await createCaller({ headers: org.headers });
    const eventsBefore = await eventCount(s.projectId);
    const u1FinBefore = await priceOf(s.u1, s.financiadoListId);

    // A file with a VALID change to 4A (→ 999999) AND an invalid unknown identificador.
    const file = await xlsxB64([
      row("4A", 999999, 90000, "disponible"),
      row("4B", null, null, "disponible"),
      row("4C", 200000, null, "disponible"),
      row("NO-EXISTE", 123, null, "disponible"),
    ]);

    await expect(
      caller.units.importExcel({ projectId: s.projectId, file }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // The valid 4A change must NOT have landed — the invalid row rolled back the entire tx.
    expect(await priceOf(s.u1, s.financiadoListId)).toBe(u1FinBefore);
    expect(await eventCount(s.projectId)).toBe(eventsBefore);
  });

  it("(a) a valid multi-row apply upserts prices/estados and emits audit events", async () => {
    const caller = await createCaller({ headers: org.headers });
    const eventsBefore = await eventCount(s.projectId);

    // 4A financiado 100000→150000 (con cambios); 4B unpriced→120000 financiado + estado reservado
    // (nueva); 4C unchanged (sin cambios).
    const file = await xlsxB64([
      row("4A", 150000, 90000, "disponible"),
      row("4B", 120000, null, "reservado"),
      row("4C", 200000, null, "disponible"),
    ]);
    const res = await caller.units.importExcel({ projectId: s.projectId, file });
    expect(res.applied).toBe(2);

    expect(await priceOf(s.u1, s.financiadoListId)).toBe(150000);
    expect(await priceOf(s.u2, s.financiadoListId)).toBe(120000);
    expect(await estadoOf(s.u2)).toBe("reservado");
    // 4A: 1 price event; 4B: 1 price + 1 estado event → at least 3 new audit rows.
    expect(await eventCount(s.projectId)).toBeGreaterThanOrEqual(eventsBefore + 3);
  });

  it("(d) re-applying the same file is a no-op and keeps one row per unit×list (Plan 01 UNIQUE)", async () => {
    const caller = await createCaller({ headers: org.headers });
    const file = await xlsxB64([
      row("4A", 150000, 90000, "disponible"),
      row("4B", 120000, null, "reservado"),
      row("4C", 200000, null, "disponible"),
    ]);
    const res = await caller.units.importExcel({ projectId: s.projectId, file });
    expect(res.applied).toBe(0);
    expect(await priceRowCount(s.u1, s.financiadoListId)).toBe(1);
    expect(await priceRowCount(s.u2, s.financiadoListId)).toBe(1);
  });

  it("rejects an oversized base64 upload at the boundary (T-10-XLSX-DOS)", async () => {
    const caller = await createCaller({ headers: org.headers });
    const huge = "A".repeat(10_000_001);
    await expect(
      caller.units.importExcel({ projectId: s.projectId, file: huge }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("exportExcel covers all project units (GRID-03)", () => {
  it("returns a workbook the round-trip re-reads without error", async () => {
    const caller = await createCaller({ headers: org.headers });
    const exported = await caller.units.exportExcel({ projectId: s.projectId });
    expect(exported.filename).toMatch(/\.xlsx$/);
    // A dry-run of the freshly-exported file classifies every row (no parse errors).
    const dry = await caller.units.dryRunImport({
      projectId: s.projectId,
      file: exported.base64,
    });
    expect(dry.errors).toHaveLength(0);
    expect(dry.rows.length).toBeGreaterThanOrEqual(3);
  });
});
