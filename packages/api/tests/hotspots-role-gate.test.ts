// hotspots role-gate cross-role matrix (HSPOT-01/02/03/04, D-02/D-08/D-09, PANEL-02 mold) — the
// load-bearing proof that the polygon write seam enforces authorization + tenant isolation +
// no-enumeration + blocking server-side validation, NOT via UI hiding. Everything under test is
// asserted THROUGH the tRPC caller (createCaller) → the unprivileged app_authenticated role, exactly
// as a real panel request. The owner SQL pool appears ONLY in seeding (beforeAll), never inside an
// it(...) assertion (RESEARCH Pitfall 4 — asserting as the owner pool would false-green the RLS gate).
//
// Matrix (for BOTH setFloorPolygon and setUnitPolygon, against orgA's project):
//   owner (orgA)            → resolves, polygon persists
//   developer (orgA member) → resolves
//   viewer (orgA member)    → FORBIDDEN (requireRole, pre-UPDATE)
//   other-org owner (orgB)  → NOT_FOUND (RLS invisibility, no-enumeration)
//   non-existent id (orgA)  → NOT_FOUND (identical to cross-org)
// Plus validation (D-08, HSPOT-04): bowtie / <3-vertex → BAD_REQUEST with ZERO rows mutated (read
// back unchanged); round-trip (D-09): stored string equals serializePolygon(parsePolygon(input));
// clear (D-02, HSPOT-03): poligonoSvg → null while the floor/unit ROW still exists (never a delete).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { parsePolygon, serializePolygon } from "../src/hotspots/geometry";
import {
  makeUserWithActiveOrg,
  mintMemberInOrg,
  type SessionFixture,
} from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

// A known-valid square polygon (4 integer vertices in [0,1000], non-degenerate, non-crossing) and
// its canonical serialization (the exact bytes the DB must hold after a save — D-09).
const VALID_SVG = "100,100 900,100 900,900 100,900";
const VALID_CANONICAL = serializePolygon(parsePolygon(VALID_SVG));
// A classic bowtie: edge (1000,0)→(0,1000) properly crosses edge (1000,1000)→(0,0) at (500,500).
const BOWTIE_SVG = "0,0 1000,0 0,1000 1000,1000";
// A two-vertex string — parses fine but fails validatePolygon with too_few_points.
const TOO_FEW_SVG = "0,0 1000,0";

interface ProjectSeed {
  projectId: string;
  floorId: string;
  unitId: string;
}

// Seed a project + floor + unit for `orgId` through the OWNER pool, in FK order (the catálogo
// parents have no editor router, so they land via raw owner SQL like the other role-gate suites).
async function seedProject(orgId: string): Promise<ProjectSeed> {
  const projectId = randomUUID();
  const floorId = randomUUID();
  const unitId = randomUUID();
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
  return { projectId, floorId, unitId };
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

// Read the floor's stored poligonoSvg via a fresh orgA caller (never the owner pool inside an it).
async function readFloorSvg(): Promise<string | null> {
  const caller = await createCaller({ headers: orgA.headers });
  const data = await caller.hotspots.getForProject({ projectId: seed.projectId });
  return data.floors.find((f) => f.id === seed.floorId)?.poligonoSvg ?? null;
}

async function readUnitSvg(): Promise<string | null> {
  const caller = await createCaller({ headers: orgA.headers });
  const data = await caller.hotspots.getForProject({ projectId: seed.projectId });
  return data.units.find((u) => u.id === seed.unitId)?.poligonoSvg ?? null;
}

describe("hotspots.setFloorPolygon write gate (HSPOT-01, D-08)", () => {
  it("owner caller saves a polygon; the canonical string round-trips (D-09)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.hotspots.setFloorPolygon({
      projectId: seed.projectId,
      floorId: seed.floorId,
      poligonoSvg: VALID_SVG,
    });
    expect(row).toMatchObject({ id: seed.floorId, poligonoSvg: VALID_CANONICAL });
    // Stored bytes equal serializePolygon(parsePolygon(input)) — canonical integers 0-1000 (D-09).
    expect(await readFloorSvg()).toBe(VALID_CANONICAL);
  });

  it("developer caller resolves", async () => {
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.hotspots.setFloorPolygon({
      projectId: seed.projectId,
      floorId: seed.floorId,
      poligonoSvg: VALID_SVG,
    });
    expect(row).toMatchObject({ id: seed.floorId });
  });

  it("viewer caller is rejected with FORBIDDEN (before any UPDATE)", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.hotspots.setFloorPolygon({
        projectId: seed.projectId,
        floorId: seed.floorId,
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility, no-enumeration)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.hotspots.setFloorPolygon({
        projectId: seed.projectId,
        floorId: seed.floorId,
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent floor id under the active org yields NOT_FOUND (no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.hotspots.setFloorPolygon({
        projectId: seed.projectId,
        floorId: randomUUID(),
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("hotspots.setUnitPolygon write gate (HSPOT-02, D-08)", () => {
  it("owner caller saves a polygon; the canonical string round-trips (D-09)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.hotspots.setUnitPolygon({
      projectId: seed.projectId,
      unitId: seed.unitId,
      poligonoSvg: VALID_SVG,
    });
    expect(row).toMatchObject({ id: seed.unitId, poligonoSvg: VALID_CANONICAL });
    expect(await readUnitSvg()).toBe(VALID_CANONICAL);
  });

  it("developer caller resolves", async () => {
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.hotspots.setUnitPolygon({
      projectId: seed.projectId,
      unitId: seed.unitId,
      poligonoSvg: VALID_SVG,
    });
    expect(row).toMatchObject({ id: seed.unitId });
  });

  it("viewer caller is rejected with FORBIDDEN (before any UPDATE)", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.hotspots.setUnitPolygon({
        projectId: seed.projectId,
        unitId: seed.unitId,
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility, no-enumeration)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.hotspots.setUnitPolygon({
        projectId: seed.projectId,
        unitId: seed.unitId,
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent unit id under the active org yields NOT_FOUND (no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.hotspots.setUnitPolygon({
        projectId: seed.projectId,
        unitId: randomUUID(),
        poligonoSvg: VALID_SVG,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("blocking server-side validation (HSPOT-04, D-08) — zero rows mutated on reject", () => {
  it("a self-intersecting (bowtie) polygon is rejected BAD_REQUEST and leaves poligonoSvg unchanged", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    // Establish a known-good stored value first.
    await caller.hotspots.setFloorPolygon({
      projectId: seed.projectId,
      floorId: seed.floorId,
      poligonoSvg: VALID_SVG,
    });
    const before = await readFloorSvg();
    await expect(
      caller.hotspots.setFloorPolygon({
        projectId: seed.projectId,
        floorId: seed.floorId,
        poligonoSvg: BOWTIE_SVG,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The rejected save mutated ZERO rows — the stored polygon is exactly what it was.
    expect(await readFloorSvg()).toBe(before);
  });

  it("a <3-vertex polygon is rejected BAD_REQUEST (too few points)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.hotspots.setUnitPolygon({
        projectId: seed.projectId,
        unitId: seed.unitId,
        poligonoSvg: TOO_FEW_SVG,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("clear is a field-to-null UPDATE, NOT a row delete (HSPOT-03, D-02)", () => {
  it("clearFloorPolygon nulls poligonoSvg while the floor row still exists", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await caller.hotspots.setFloorPolygon({
      projectId: seed.projectId,
      floorId: seed.floorId,
      poligonoSvg: VALID_SVG,
    });
    const row = await caller.hotspots.clearFloorPolygon({
      projectId: seed.projectId,
      floorId: seed.floorId,
    });
    expect(row).toMatchObject({ id: seed.floorId, poligonoSvg: null });
    // The floor is STILL returned by getForProject (row exists) with a null polygon (no delete).
    const data = await caller.hotspots.getForProject({ projectId: seed.projectId });
    const floor = data.floors.find((f) => f.id === seed.floorId);
    expect(floor).toBeDefined();
    expect(floor?.poligonoSvg).toBeNull();
  });

  it("clearUnitPolygon nulls poligonoSvg while the unit row still exists", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await caller.hotspots.setUnitPolygon({
      projectId: seed.projectId,
      unitId: seed.unitId,
      poligonoSvg: VALID_SVG,
    });
    const row = await caller.hotspots.clearUnitPolygon({
      projectId: seed.projectId,
      unitId: seed.unitId,
    });
    expect(row).toMatchObject({ id: seed.unitId, poligonoSvg: null });
    const data = await caller.hotspots.getForProject({ projectId: seed.projectId });
    const unit = data.units.find((u) => u.id === seed.unitId);
    expect(unit).toBeDefined();
    expect(unit?.poligonoSvg).toBeNull();
  });

  it("clearFloorPolygon on a cross-org floor is NOT_FOUND (no-enumeration)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.hotspots.clearFloorPolygon({
        projectId: seed.projectId,
        floorId: seed.floorId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("hotspots.getForProject editor hydration (HSPOT-01/02)", () => {
  it("returns the active-org floors + units; a cross-org projectId yields empty arrays", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const data = await caller.hotspots.getForProject({ projectId: seed.projectId });
    expect(data.floors.map((f) => f.id)).toContain(seed.floorId);
    expect(data.units.map((u) => u.id)).toContain(seed.unitId);

    const other = await createCaller({ headers: orgB.headers });
    const empty = await other.hotspots.getForProject({ projectId: seed.projectId });
    expect(empty.floors).toHaveLength(0);
    expect(empty.units).toHaveLength(0);
    expect(empty.renderExteriorKey).toBeNull();
  });
});
