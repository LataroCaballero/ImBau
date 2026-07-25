// projects role-gate cross-role matrix (PANEL-02, SC-2/SC-3/SC-4) — the load-bearing proof that
// the panel write mold enforces authorization + tenant isolation + no-enumeration server-side, NOT
// via UI hiding. Everything under test is asserted THROUGH the tRPC caller (createCaller) → the
// unprivileged app_authenticated/anon roles, exactly as a real panel/web request would. The owner
// SQL pool appears ONLY in seeding (beforeAll/seedProject), never inside an it(...) assertion
// (RESEARCH Pitfall 4 — asserting as the owner pool would false-green the RLS gate).
//
// Matrix (all against projA, orgA's borrador project, calling projects.updateSettings):
//   owner (orgA)            → resolves, estado toggled            (SC-3)
//   developer (orgA member) → resolves                            (SC-3)
//   viewer (orgA member)    → FORBIDDEN (requireRole, pre-UPDATE) (SC-3, D-06)
//   other-org owner (orgB)  → NOT_FOUND (RLS 0-row + .returning guard, no-enumeration) (SC-2, D-07)
// Plus: getForOrg row/null resolution, no-enumeration NOT_FOUND identical to cross-org, the
// cross-surface estado→listPublished effect (D-05), and org.activeMemberRole (D-08 UI gating).
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

// Seed a project for an org through the OWNER pool (org/member are minted by the auth runtime;
// projects have no editor router yet). estado controls anon visibility via projects_anon_published.
async function seedProject(
  orgId: string,
  estado: "publicado" | "borrador",
): Promise<string> {
  const id = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;
  await owner`
    insert into projects (id, organization_id, nombre, slug, estado)
    values (${id}, ${orgId}, ${`P ${slug}`}, ${slug}, ${estado})
  `;
  return id;
}

let orgA: SessionFixture;
let orgB: SessionFixture;
let developerA: SessionFixture;
let viewerA: SessionFixture;
let projA: string;

beforeAll(async () => {
  orgA = await makeUserWithActiveOrg();
  orgB = await makeUserWithActiveOrg();
  // Mint a developer and a viewer member of org A (real invite→accept→setActive path).
  developerA = await mintMemberInOrg(orgA, "developer");
  viewerA = await mintMemberInOrg(orgA, "viewer");
  // One borrador project in org A — the canary target for the whole matrix.
  projA = await seedProject(orgA.orgId, "borrador");
}, 120_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("projects.updateSettings write gate (SC-3 / D-06)", () => {
  it("owner caller resolves and toggles estado to publicado", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.projects.updateSettings({
      id: projA,
      estado: "publicado",
    });
    expect(row).toMatchObject({ id: projA, estado: "publicado" });
    // Reset to borrador so later cases start from a known state.
    await caller.projects.updateSettings({ id: projA, estado: "borrador" });
  });

  it("developer caller resolves and toggles estado", async () => {
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.projects.updateSettings({
      id: projA,
      estado: "publicado",
    });
    expect(row).toMatchObject({ id: projA, estado: "publicado" });
    await caller.projects.updateSettings({ id: projA, estado: "borrador" });
  });

  it("viewer caller is rejected with FORBIDDEN (before any UPDATE runs)", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.projects.updateSettings({ id: projA, estado: "publicado" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility, no silent 0-row success)", async () => {
    // orgB's owner is a real owner — but of the WRONG org. RLS makes projA invisible, so the
    // UPDATE affects 0 rows and the .returning() guard throws NOT_FOUND (SC-2, T-09-02/T-09-04).
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.projects.updateSettings({ id: projA, estado: "publicado" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent id under the active org yields NOT_FOUND (identical to cross-org — no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.projects.updateSettings({
        id: randomUUID(),
        estado: "publicado",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("projects.getForOrg single-project resolver (SC-1 / SC-2 / D-07)", () => {
  it("returns the active-org row for a valid id", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.projects.getForOrg({ id: projA });
    expect(row?.id).toBe(projA);
    expect(row?.organizationId).toBe(orgA.orgId);
  });

  it("returns null for a cross-org id (RLS leaves the row invisible)", async () => {
    const caller = await createCaller({ headers: orgB.headers });
    const row = await caller.projects.getForOrg({ id: projA });
    expect(row).toBeNull();
  });

  it("returns null for a non-existent id under the active org", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.projects.getForOrg({ id: randomUUID() });
    expect(row).toBeNull();
  });
});

describe("cross-surface: estado toggle is observable through anon listPublished (D-05)", () => {
  it("publicado exposes projA to anon; toggling back to borrador hides it again", async () => {
    const ownerCaller = await createCaller({ headers: orgA.headers });
    const anonCaller = await createCaller({ headers: new Headers() });

    await ownerCaller.projects.updateSettings({ id: projA, estado: "publicado" });
    const published = await anonCaller.projects.listPublished();
    expect(published.map((r) => r.id)).toContain(projA);

    await ownerCaller.projects.updateSettings({ id: projA, estado: "borrador" });
    const afterHide = await anonCaller.projects.listPublished();
    expect(afterHide.map((r) => r.id)).not.toContain(projA);
  });
});

describe("org.activeMemberRole for D-08 UI gating", () => {
  it("resolves owner for an owner caller and viewer for a viewer caller", async () => {
    const ownerCaller = await createCaller({ headers: orgA.headers });
    const viewerCaller = await createCaller({ headers: viewerA.headers });
    await expect(ownerCaller.org.activeMemberRole()).resolves.toBe("owner");
    await expect(viewerCaller.org.activeMemberRole()).resolves.toBe("viewer");
  });
});
