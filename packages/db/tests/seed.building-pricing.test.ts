// seed.building-pricing — SEED-01 + SEED-02 integration proof against the _test DB harness.
//
// Runs the seed (skipMedia, so no R2/worker needed) and asserts the building composition (13 floors,
// 30-40 units, pozo curve, publicado project), the pricing (2 USD price_lists, integer-USD prices,
// CAC payment plans with Refuerzo[], 12-24 cac_index rows), and — the SEED-04 gate — that re-running
// leaves every per-table count invariant (deterministic ids + onConflictDoNothing).
//
// Reads use owner.db.execute<T>(sql`…`) (owner bypasses RLS — read-back only, setup style; typed
// generic IS the row type, so no `as unknown as`). ORG_ID is parameterized; table/column names in
// countFor are injected via sql.raw from a fixed in-test whitelist (no external input).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { connectAs, ownerUrl } from "./db";
import { runSeed } from "../seed";
import { seedId } from "../src/seed/ids";

const ORG_ID = seedId("brigos:org");
const PROJECT_ID = seedId("brigos:project");

let owner: ReturnType<typeof connectAs>;

async function countFor(table: string): Promise<number> {
  const rows = await owner.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where organization_id = ${ORG_ID}`,
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  owner = connectAs(ownerUrl());
  // First seed run — bootstraps org + project + building + pricing (idempotent).
  await runSeed({ skipMedia: true });
}, 60_000);

afterAll(async () => {
  await owner.sql.end({ timeout: 5 });
});

describe("seed building composition (SEED-01)", () => {
  it("project is publicado", async () => {
    const rows = await owner.db.execute<{ estado: string }>(
      sql`select estado from projects where id = ${PROJECT_ID}`,
    );
    expect(rows[0]?.estado).toBe("publicado");
  });

  it("has ~13 floors", async () => {
    expect(await countFor("floors")).toBe(13);
  });

  it("has 30-40 units", async () => {
    const n = await countFor("units");
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(40);
  });

  it("unit estados span disponible/reservado/vendido with a pozo curve (low vendido, high disponible)", async () => {
    const rows = await owner.db.execute<{ estado: string; avg_floor: number; n: number }>(
      sql`select u.estado as estado, avg(f.numero)::float8 as avg_floor, count(*)::int as n
            from units u
            join floors f on f.id = u.floor_id and f.organization_id = u.organization_id
           where u.organization_id = ${ORG_ID}
           group by u.estado`,
    );
    const byEstado = new Map<string, { estado: string; avg_floor: number; n: number }>();
    for (const r of rows) byEstado.set(r.estado, r);

    // All three estados present.
    expect(byEstado.has("disponible")).toBe(true);
    expect(byEstado.has("reservado")).toBe(true);
    expect(byEstado.has("vendido")).toBe(true);
    // Pozo curve: vendido concentrates on LOW floors, disponible on HIGH floors.
    const vendidoAvg = byEstado.get("vendido")?.avg_floor ?? Number.NaN;
    const disponibleAvg = byEstado.get("disponible")?.avg_floor ?? Number.NaN;
    expect(vendidoAvg).toBeLessThan(disponibleAvg);
  });
});

describe("seed pricing (SEED-02)", () => {
  it("has exactly 2 price_lists, both USD", async () => {
    const rows = await owner.db.execute<{ moneda: string }>(
      sql`select moneda from price_lists where organization_id = ${ORG_ID}`,
    );
    const list = [...rows];
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.moneda === "USD")).toBe(true);
  });

  it("every unit_prices.precio is an integer > 0", async () => {
    const rows = await owner.db.execute<{ precio: number }>(
      sql`select precio from unit_prices where organization_id = ${ORG_ID}`,
    );
    const list = [...rows];
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(Number.isInteger(r.precio)).toBe(true);
      expect(r.precio).toBeGreaterThan(0);
    }
  });

  it("payment_plans use ajuste='CAC' with a non-empty Refuerzo[]", async () => {
    const rows = await owner.db.execute<{
      ajuste: string;
      refuerzos: Array<{ cuota: number; montoUsd: number }>;
    }>(sql`select ajuste, refuerzos from payment_plans where organization_id = ${ORG_ID}`);
    const list = [...rows];
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      expect(r.ajuste).toBe("CAC");
      expect(Array.isArray(r.refuerzos)).toBe(true);
      expect(r.refuerzos.length).toBeGreaterThan(0);
      for (const ref of r.refuerzos) {
        expect(Number.isInteger(ref.cuota)).toBe(true);
        expect(Number.isInteger(ref.montoUsd)).toBe(true);
      }
    }
  });

  it("has 12-24 cac_index rows", async () => {
    const n = await countFor("cac_index");
    expect(n).toBeGreaterThanOrEqual(12);
    expect(n).toBeLessThanOrEqual(24);
  });
});

describe("seed is idempotent (SEED-04)", () => {
  it("re-running leaves per-table counts invariant", async () => {
    const tables = ["floors", "units", "price_lists", "unit_prices", "payment_plans", "cac_index"];
    const before = await Promise.all(tables.map((t) => countFor(t)));
    await runSeed({ skipMedia: true });
    const after = await Promise.all(tables.map((t) => countFor(t)));
    expect(after).toEqual(before);
  }, 60_000);
});
