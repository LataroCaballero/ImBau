// seed.idempotency — the SEED-04 gate: run-twice per-table row-count invariance + no-duplicate
// ids, plus RLS-correctness (anon reads the publicado project's rows; a foreign-tenant GUC reads
// zero seeded rows). This is the phase exit criterion turned into an ALWAYS-ON automated gate.
//
// The always-on block runs `runSeed({ skipMedia: true })` — no R2/worker needed — so CI can prove
// row invariance without the media infra. It captures every seeded table's `count(*)` after run 1
// and after run 2 and asserts they are pairwise identical (deterministic ids + onConflictDoNothing
// ⇒ the second run is a no-op), and that `count(*) === count(distinct id)` (no duplicated ids).
// Because every count is scoped to the seed's deterministic ORG_ID, the delta is robust to any
// rows already accumulated in the shared _test DB by earlier suites — it measures THIS org only.
//
// RLS-correctness (unprivileged roles only — never the owner): `withAnon` sees the seeded
// floors/units/galleries because the project is `publicado` (D-06); a DIFFERENT tenant GUC via
// `withTenant(foreignOrgId, …)` sees ZERO of the seeded org's rows (cross-tenant isolation — the
// tenant `using` clause filters to the GUC org). Media assertions live in the env-gated block only
// (media rows are not produced under skipMedia).
//
// The env-gated `describe.skipIf` block runs the FULL `runSeed()` (media on) twice when R2/worker
// are present and asserts the `media` row count is invariant too — covering the media-object
// idempotency path. A cleanly SKIPPED media block is the correct green outcome without R2.
//
// Reads use owner.db.execute<T>(sql`…`) for count read-backs (owner bypasses RLS — read-back
// only; the typed generic IS the row type, so no `as unknown as` — WR-03). Table/column names in
// counts are injected via sql.raw from a fixed in-test whitelist (no external input). ORG_ID is
// always bound as a parameter.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { connectAs, ownerUrl } from "./db";
import { withAnon, withTenant } from "../src/with-tenant";
import { floors, units, galleries, media } from "../src/schema";
import { makeOrg, closeFixtures } from "./helpers";
import { runSeed } from "../seed";
import { seedId } from "../src/seed/ids";

const ORG_ID = seedId("brigos:org");

// Every table the seed populates for the org. `organization` is scoped by its own primary key;
// all others carry an `organization_id`. count(*) === count(distinct id) must hold for each.
type SeededTable = { readonly table: string; readonly scopeCol: "id" | "organization_id" };
const SEEDED_TABLES: readonly SeededTable[] = [
  { table: "organization", scopeCol: "id" },
  { table: "projects", scopeCol: "organization_id" },
  { table: "floors", scopeCol: "organization_id" },
  { table: "units", scopeCol: "organization_id" },
  { table: "price_lists", scopeCol: "organization_id" },
  { table: "unit_prices", scopeCol: "organization_id" },
  { table: "payment_plans", scopeCol: "organization_id" },
  { table: "cac_index", scopeCol: "organization_id" },
  { table: "brokers", scopeCol: "organization_id" },
  { table: "leads", scopeCol: "organization_id" },
  { table: "progress_posts", scopeCol: "organization_id" },
  { table: "galleries", scopeCol: "organization_id" },
  { table: "events", scopeCol: "organization_id" },
];

let owner: ReturnType<typeof connectAs>;
let foreignOrgId: string;

// count(*) and count(distinct id) for a whitelisted table scoped to ORG_ID (owner read-back).
async function tableStats(t: SeededTable): Promise<{ total: number; distinctIds: number }> {
  const rows = await owner.db.execute<{ total: number; distinct_ids: number }>(
    sql`select count(*)::int as total, count(distinct id)::int as distinct_ids
          from ${sql.raw(t.table)}
         where ${sql.raw(t.scopeCol)} = ${ORG_ID}`,
  );
  return { total: rows[0]?.total ?? 0, distinctIds: rows[0]?.distinct_ids ?? 0 };
}

async function countMedia(): Promise<number> {
  const rows = await owner.db.execute<{ n: number }>(
    sql`select count(*)::int as n from media where organization_id = ${ORG_ID}`,
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  owner = connectAs(ownerUrl());
  // A fresh foreign tenant (owner-seeded, empty) to prove cross-tenant isolation: a GUC scoped to
  // it must read ZERO of the seeded org's rows.
  foreignOrgId = await makeOrg();
  // Run 1 — the DB-only seed path (no R2/worker).
  await runSeed({ skipMedia: true });
}, 60_000);

afterAll(async () => {
  await owner.sql.end({ timeout: 5 });
  await closeFixtures();
});

describe("seed idempotency — row-count invariance (SEED-04 gate)", () => {
  it("running the full seed twice yields identical per-table count(*) with no duplicate ids", async () => {
    // After run 1 (beforeAll): capture every seeded table's count(*).
    const before = await Promise.all(SEEDED_TABLES.map((t) => tableStats(t)));

    // Run 2 — must be a pure no-op (deterministic ids + onConflictDoNothing).
    await runSeed({ skipMedia: true });

    const after = await Promise.all(SEEDED_TABLES.map((t) => tableStats(t)));

    for (let i = 0; i < SEEDED_TABLES.length; i += 1) {
      const t = SEEDED_TABLES[i]!;
      const b = before[i]!;
      const a = after[i]!;
      // Every seeded table has rows for this org (the seed is not vacuous).
      expect(b.total, `${t.table} seeded`).toBeGreaterThan(0);
      // Row-count invariance — the non-negotiable SEED-04 gate.
      expect(a.total, `${t.table} count invariant across re-run`).toBe(b.total);
      // No duplicate ids — deterministic ids are stable, the re-run adds none.
      expect(a.distinctIds, `${t.table} count(*) === count(distinct id)`).toBe(a.total);
    }
  }, 60_000);
});

describe("seed RLS correctness — published visibility + cross-tenant isolation", () => {
  it("withAnon reads the publicado project's floors/units/galleries (D-06)", async () => {
    const { anonFloors, anonUnits, anonGalleries } = await withAnon(async (tx) => ({
      anonFloors: await tx.select({ organizationId: floors.organizationId }).from(floors),
      anonUnits: await tx.select({ organizationId: units.organizationId }).from(units),
      anonGalleries: await tx.select({ organizationId: galleries.organizationId }).from(galleries),
    }));
    // The seeded project is publicado, so anon sees THIS org's catalog/content rows.
    expect(anonFloors.some((r) => r.organizationId === ORG_ID), "anon floors").toBe(true);
    expect(anonUnits.some((r) => r.organizationId === ORG_ID), "anon units").toBe(true);
    expect(anonGalleries.some((r) => r.organizationId === ORG_ID), "anon galleries").toBe(true);
  });

  it("a foreign-tenant GUC reads zero seeded rows (cross-tenant isolation)", async () => {
    const { fFloors, fUnits, fGalleries } = await withTenant(foreignOrgId, async (tx) => ({
      fFloors: await tx.select({ organizationId: floors.organizationId }).from(floors),
      fUnits: await tx.select({ organizationId: units.organizationId }).from(units),
      fGalleries: await tx.select({ organizationId: galleries.organizationId }).from(galleries),
    }));
    // Scoped to the foreign org, NONE of the seeded org's rows are visible.
    expect(fFloors.filter((r) => r.organizationId === ORG_ID).length, "foreign floors").toBe(0);
    expect(fUnits.filter((r) => r.organizationId === ORG_ID).length, "foreign units").toBe(0);
    expect(fGalleries.filter((r) => r.organizationId === ORG_ID).length, "foreign galleries").toBe(0);
  });
});

// ── Env-gated media idempotency + RLS (needs live R2 + a running worker) ──────────────────────
// When the media infra is present, the FULL seed (media on) must also be count-invariant on the
// `media` table, anon must see the publicado media, and a foreign tenant must see none. Without
// R2/Redis this SKIPS cleanly — the correct green outcome (live-R2 proof deferred to UAT).
const MEDIA_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "REDIS_URL",
] as const;
const hasMediaInfra = MEDIA_ENV.every((n) => {
  const v = process.env[n];
  return v !== undefined && v.length > 0;
});

describe.skipIf(!hasMediaInfra)("seed idempotency — media path (env-gated)", () => {
  beforeAll(async () => {
    // Full seed WITH media (skipMedia defaults false) — needs R2 + a running worker.
    await runSeed();
  }, 180_000);

  it("a second FULL run leaves the media row count invariant", async () => {
    const before = await countMedia();
    expect(before, "media seeded").toBeGreaterThan(0);
    await runSeed();
    const after = await countMedia();
    expect(after, "media count invariant across re-run").toBe(before);
  }, 180_000);

  it("anon reads the publicado media; a foreign-tenant GUC reads none", async () => {
    const anonMedia = await withAnon((tx) =>
      tx.select({ organizationId: media.organizationId }).from(media),
    );
    expect(anonMedia.some((r) => r.organizationId === ORG_ID), "anon media").toBe(true);

    const foreignMedia = await withTenant(foreignOrgId, (tx) =>
      tx.select({ organizationId: media.organizationId }).from(media),
    );
    expect(foreignMedia.filter((r) => r.organizationId === ORG_ID).length, "foreign media").toBe(0);
  });
});
