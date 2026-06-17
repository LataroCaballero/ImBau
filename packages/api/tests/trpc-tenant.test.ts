// tRPC integration tests (AUTH-02 / AUTH-03 / APP-01 / APP-02) — proven through the tRPC
// caller against the live Postgres `_test` DB, the SAME unprivileged app/anon path the
// panel/web use. We NEVER assert as the owner pool: cross-tenant isolation and the anon
// published-only read are proven through withTenant/withAnon exactly as a request would.
//
// Seeding strategy: org A and org B are minted by the REAL auth runtime via makeUserWithActiveOrg
// (owner-pool adapter — the only sanctioned write path for RLS-FORCED org/member tables). Their
// projects are seeded with the owner SQL client (a project editor lands in plan 03-04); the
// READS under test all go through the tRPC caller -> withTenant/withAnon -> app/anon role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller, type CreateContextOptions } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

// Build a caller carrying a real session (the fixture headers resolve to a session whose
// activeOrganizationId is the org). This is the production context shape.
function callerFor(opts: CreateContextOptions) {
  return createCaller(opts);
}

// Seed a project for an org through the OWNER pool (org/member are minted by the auth runtime;
// projects have no editor yet — that is plan 03-04). estado controls anon visibility.
async function seedProject(orgId: string, estado: "publicado" | "borrador"): Promise<string> {
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
let projAPublicado: string;
let projAPublicado2: string;
let projBPublicado: string;

beforeAll(async () => {
  orgA = await makeUserWithActiveOrg();
  orgB = await makeUserWithActiveOrg();
  // Each org: a publicado + a borrador project.
  projAPublicado = await seedProject(orgA.orgId, "publicado");
  await seedProject(orgA.orgId, "borrador");
  projBPublicado = await seedProject(orgB.orgId, "publicado");
  await seedProject(orgB.orgId, "borrador");
  // A second publicado in A so listForOrg has >1 row to count.
  projAPublicado2 = await seedProject(orgA.orgId, "publicado");
}, 60_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("requireRole (AUTH-02 role enforcement)", () => {
  it("member.invite is allowed for an owner caller (creator resolves to owner)", async () => {
    const caller = await callerFor({ headers: orgA.headers });
    // Owner invites a viewer (default role). The org-plugin invite fires sendInvitationEmail
    // (console stub in dev). It returns the invitation; we assert it succeeded (no FORBIDDEN).
    const invite = await caller.member.invite({
      email: `invitee-${randomUUID()}@example.test`,
    });
    expect(invite.id).toBeTruthy();
    expect(invite.role).toBe("viewer");
  });

  it("member.invite is FORBIDDEN for a non-owner (viewer) caller", async () => {
    // Mint a second user, invite+accept them into org A as a viewer, set that org active.
    const viewer = await mintViewerInOrg(orgA);
    const caller = await callerFor({ headers: viewer.headers });
    await expect(
      caller.member.invite({ email: `x-${randomUUID()}@example.test` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("projects tenant isolation via tRPC caller (AUTH-02 / APP-01)", () => {
  it("(a) org A caller sees only org A projects, ZERO org B rows", async () => {
    const caller = await callerFor({ headers: orgA.headers });
    const rows = await caller.projects.listForOrg();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgA.orgId)).toBe(true);
    expect(rows.filter((r) => r.organizationId === orgB.orgId).length).toBe(0);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(projAPublicado);
    expect(ids).toContain(projAPublicado2);
    expect(ids).not.toContain(projBPublicado);
  });

  it("(b) mirror: org B caller sees only org B projects, ZERO org A rows", async () => {
    const caller = await callerFor({ headers: orgB.headers });
    const rows = await caller.projects.listForOrg();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgB.orgId)).toBe(true);
    expect(rows.filter((r) => r.organizationId === orgA.orgId).length).toBe(0);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(projBPublicado);
    expect(ids).not.toContain(projAPublicado);
  });
});

describe("anon published-only read via tRPC caller (APP-02)", () => {
  it("(c) listPublished returns only publicado rows, ZERO borrador", async () => {
    // No session needed for the public procedure.
    const caller = await callerFor({ headers: new Headers() });
    const rows = await caller.projects.listPublished();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.estado === "publicado")).toBe(true);
    expect(rows.filter((r) => r.estado === "borrador").length).toBe(0);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(projAPublicado);
    expect(ids).toContain(projBPublicado);
  });
});

// --- helper: create a viewer member of `org` and return a fixture with that org active ---
// A fresh user is invited (by the org owner) as a viewer, signs up, accepts, then sets the
// org active. Returns a SessionFixture-shaped object whose headers carry the active org.
async function mintViewerInOrg(org: SessionFixture): Promise<SessionFixture> {
  const { auth } = await import("../src/auth/runtime");
  const email = `viewer-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;

  // Owner invites as viewer.
  const ownerCaller = await callerFor({ headers: org.headers });
  const invitation = await ownerCaller.member.invite({ email, role: "viewer" });

  // Invitee signs up.
  const signUp = await auth.api.signUpEmail({
    body: { name: "Viewer", email, password },
    returnHeaders: true,
  });
  const userId = signUp.response.user.id;
  let headers = cookieHeaderFrom(signUp.headers.get("set-cookie"));

  // Accept the invitation (adds the member row with role=viewer).
  await auth.api.acceptInvitation({
    body: { invitationId: invitation.id },
    headers,
  });

  // Set the org active so protectedProcedure resolves activeOrgId.
  const activated = await auth.api.setActiveOrganization({
    body: { organizationId: org.orgId },
    headers,
    returnHeaders: true,
  });
  const refreshed = activated.headers.get("set-cookie");
  if (refreshed) headers = cookieHeaderFrom(refreshed);

  return { userId, email, orgId: org.orgId, orgSlug: org.orgSlug, headers };
}

function cookieHeaderFrom(setCookie: string | null): Headers {
  const headers = new Headers();
  if (setCookie) {
    const pairs = setCookie
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]?.trim())
      .filter((c): c is string => Boolean(c));
    if (pairs.length > 0) headers.set("cookie", pairs.join("; "));
  }
  return headers;
}
