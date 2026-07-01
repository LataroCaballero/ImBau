// seed.content — SEED-03 / D-07 integration proof against the _test DB harness.
//
// Runs the seed with skipMedia:true (no R2/worker needed — galleries/progress reference the
// deterministic mediaIds as plain uuid refs), then asserts the content half: brokers present with
// realistic slug/whatsapp/email; 10-20 leads spanning all four estados with a LeadNote[] timeline;
// events routed to ≥2 distinct monthly partitions (not DEFAULT); galleries per seccion whose
// imagenes hold exactly the seeded mediaIds of that seccion. A final re-run asserts the new content
// tables stay count-invariant (SEED-04 across the plan-02 tables).
//
// Reads use owner.db.execute<T>(sql`…`) (owner bypasses RLS — read-back only). ORG_ID is
// parameterized; partition table names are injected via sql.raw from a fixed in-test whitelist.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { connectAs, ownerUrl } from "./db";
import { runSeed } from "../seed";
import { seedId } from "../src/seed/ids";
import { mediaSeedId } from "../src/seed/media";
import { MEDIA_ASSETS, type GallerySeccion } from "../src/seed/content";

const ORG_ID = seedId("brigos:org");
const ESTADOS = ["nuevo", "contactado", "negociacion", "cerrado"] as const;
const SECCIONES: readonly GallerySeccion[] = ["amenities", "exteriores", "interiores"];
// The three partitions plan-01 pre-creates (reference month 2026-06 + prior two).
const EVENT_PARTITIONS = ["events_2026_06", "events_2026_05", "events_2026_04"] as const;

let owner: ReturnType<typeof connectAs>;

async function countFor(table: string): Promise<number> {
  const rows = await owner.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.raw(table)} where organization_id = ${ORG_ID}`,
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  owner = connectAs(ownerUrl());
  await runSeed({ skipMedia: true });
}, 60_000);

afterAll(async () => {
  await owner.sql.end({ timeout: 5 });
});

describe("seed content — brokers + leads (SEED-03/D-07)", () => {
  it("has brokers with realistic slug/whatsapp/email", async () => {
    const rows = await owner.db.execute<{
      slug: string;
      whatsapp: string | null;
      email: string | null;
    }>(sql`select slug, whatsapp, email from brokers where organization_id = ${ORG_ID}`);
    const list = [...rows];
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const b of list) {
      expect(b.slug.length).toBeGreaterThan(0);
      expect(b.whatsapp ?? "").not.toBe("");
      expect(b.email ?? "").toContain("@");
    }
  });

  it("has 10-20 leads across all four estados, at least one with a timeline", async () => {
    const rows = await owner.db.execute<{ estado: string; timeline: unknown }>(
      sql`select estado, timeline from leads where organization_id = ${ORG_ID}`,
    );
    const list = [...rows];
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list.length).toBeLessThanOrEqual(20);
    const estados = new Set(list.map((r) => r.estado));
    for (const e of ESTADOS) expect(estados.has(e)).toBe(true);
    expect(
      list.some((r) => Array.isArray(r.timeline) && r.timeline.length > 0),
    ).toBe(true);
  });
});

describe("seed content — galleries reference seeded media", () => {
  it("has one gallery per seccion whose imagenes are exactly the seccion's seeded mediaIds", async () => {
    const rows = await owner.db.execute<{ seccion: string; imagenes: string[] }>(
      sql`select seccion, imagenes from galleries where organization_id = ${ORG_ID}`,
    );
    const bySeccion = new Map(rows.map((r) => [r.seccion, r.imagenes]));
    for (const seccion of SECCIONES) {
      const imagenes = bySeccion.get(seccion);
      expect(imagenes, `gallery for ${seccion}`).toBeDefined();
      const expected = MEDIA_ASSETS.filter(
        (a) => a.usage === "gallery" && a.seccion === seccion,
      ).map((a) => mediaSeedId(a.key));
      expect(expected.length).toBeGreaterThan(0);
      expect([...(imagenes ?? [])].sort()).toEqual([...expected].sort());
    }
  });
});

describe("seed content — events span monthly partitions (D-07)", () => {
  it("routes events to >=2 distinct monthly partitions (not DEFAULT)", async () => {
    const counts = await Promise.all(
      EVENT_PARTITIONS.map((part) => countFor(part)),
    );
    const nonEmpty = counts.filter((c) => c > 0).length;
    expect(nonEmpty).toBeGreaterThanOrEqual(2);
    // And the total across the real monthly partitions equals all seeded events (none in DEFAULT).
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(await countFor("events"));
  });
});

describe("seed content is idempotent (SEED-04)", () => {
  it("re-running leaves the plan-02 content tables count-invariant", async () => {
    const tables = ["brokers", "leads", "galleries", "progress_posts", "events"];
    const before = await Promise.all(tables.map((t) => countFor(t)));
    await runSeed({ skipMedia: true });
    const after = await Promise.all(tables.map((t) => countFor(t)));
    expect(after).toEqual(before);
  }, 60_000);
});
