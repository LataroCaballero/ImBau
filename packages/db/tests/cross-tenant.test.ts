// Cross-tenant ABSENCE tests — the milestone exit gate (DATA-04 / D-09).
//
// Every assertion runs through withTenant / withAnon as the UNPRIVILEGED app/anon role —
// NEVER as the owner. Asserting as the owner would pass for the wrong reason (the owner can
// see everything), so the harness role guard (tests/setup.ts) + the in-test guard below both
// prove the connection is app_authenticated/anon with rolbypassrls=false.
//
// Coverage spans BOTH tenant tables this phase — `projects` AND `member` (D-02/D-10). The
// gate asserts ABSENCE (zero rows of the other org), not merely "the query didn't error":
//   (a) read isolation A->B over projects AND member
//   (b) mirror B->A over projects AND member
//   (c) cross-tenant write fails (INSERT throws, UPDATE affects 0 rows) over projects AND member
//   (d) anon sees publicado projects, ZERO borrador (no member anon path — D-06/D-11)
//
// If a case fails because a policy/cast/grant is wrong, the fix belongs in the plan-02
// schema/migration — we do NOT weaken an assertion or switch to the owner role to make it pass.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { withTenant, withAnon } from "../src/with-tenant";
import { projects, member } from "../src/schema";
import { makeOrg, makeProject, makeMember, closeFixtures } from "./helpers";

type Scenario = {
  orgA: string;
  orgB: string;
  projectA: string;
  projectB: string;
};

// One shared scenario for the suite: org A and org B each with a publicado + a borrador
// project AND a member row (seeded via the owner). Fresh unique ids mean no rollback needed.
let s: Scenario;

beforeAll(async () => {
  const orgA = await makeOrg();
  const orgB = await makeOrg();
  // org A: a publicado (visible to anon) + a borrador (never visible to anon) project.
  const projectA = await makeProject(orgA, "publicado");
  await makeProject(orgA, "borrador");
  await makeMember(orgA);
  // org B: likewise.
  const projectB = await makeProject(orgB, "publicado");
  await makeProject(orgB, "borrador");
  await makeMember(orgB);
  s = { orgA, orgB, projectA, projectB };
});

afterAll(async () => {
  await closeFixtures();
});

// Helper: count rows in `rows` whose organization_id equals `orgId`.
function countForOrg(
  rows: { organizationId: string }[],
  orgId: string,
): number {
  return rows.filter((r) => r.organizationId === orgId).length;
}

describe("cross-tenant isolation (DATA-04 exit gate)", () => {
  it("(guard) app/anon connections are unprivileged (current_user + rolbypassrls=false)", async () => {
    const appGuard = await withTenant(s.orgA, async (tx) => {
      const who = await tx.execute<{ current_user: string }>(
        sql`select current_user`,
      );
      const attrs = await tx.execute<{ rolbypassrls: boolean }>(
        sql`select rolbypassrls from pg_roles where rolname = current_user`,
      );
      return {
        user: (who as unknown as { current_user: string }[])[0]?.current_user,
        bypass: (attrs as unknown as { rolbypassrls: boolean }[])[0]
          ?.rolbypassrls,
      };
    });
    expect(appGuard.user).toBe("app_authenticated");
    expect(appGuard.bypass).toBe(false);

    const anonGuard = await withAnon(async (tx) => {
      const who = await tx.execute<{ current_user: string }>(
        sql`select current_user`,
      );
      const attrs = await tx.execute<{ rolbypassrls: boolean }>(
        sql`select rolbypassrls from pg_roles where rolname = current_user`,
      );
      return {
        user: (who as unknown as { current_user: string }[])[0]?.current_user,
        bypass: (attrs as unknown as { rolbypassrls: boolean }[])[0]
          ?.rolbypassrls,
      };
    });
    expect(anonGuard.user).toBe("anon");
    expect(anonGuard.bypass).toBe(false);
  });

  it("(a) read isolation A->B: org A sees zero org B rows on projects AND member", async () => {
    const { projectRows, memberRows } = await withTenant(s.orgA, async (tx) => {
      const projectRows = await tx.select().from(projects);
      const memberRows = await tx.select().from(member);
      return { projectRows, memberRows };
    });

    // projects: every visible row is org A; ZERO org B (absence).
    expect(projectRows.length).toBeGreaterThan(0);
    expect(projectRows.every((r) => r.organizationId === s.orgA)).toBe(true);
    expect(countForOrg(projectRows, s.orgB)).toBe(0);

    // member: ZERO org B (absence) — member is a tenant table too (D-02/D-10).
    expect(memberRows.length).toBeGreaterThan(0);
    expect(memberRows.every((r) => r.organizationId === s.orgA)).toBe(true);
    expect(countForOrg(memberRows, s.orgB)).toBe(0);
  });

  it("(b) mirror B->A: org B sees zero org A rows on projects AND member", async () => {
    const { projectRows, memberRows } = await withTenant(s.orgB, async (tx) => {
      const projectRows = await tx.select().from(projects);
      const memberRows = await tx.select().from(member);
      return { projectRows, memberRows };
    });

    expect(projectRows.length).toBeGreaterThan(0);
    expect(projectRows.every((r) => r.organizationId === s.orgB)).toBe(true);
    expect(countForOrg(projectRows, s.orgA)).toBe(0);

    expect(memberRows.length).toBeGreaterThan(0);
    expect(memberRows.every((r) => r.organizationId === s.orgB)).toBe(true);
    expect(countForOrg(memberRows, s.orgA)).toBe(0);
  });

  it("(c) cross-tenant INSERT throws on projects AND member (withCheck)", async () => {
    // INSERT a projects row claiming org B while scoped to org A — withCheck must reject it.
    await expect(
      withTenant(s.orgA, async (tx) => {
        await tx.insert(projects).values({
          organizationId: s.orgB,
          nombre: "cross-tenant",
          slug: `xtenant-${Date.now()}`,
          estado: "borrador",
        });
      }),
    ).rejects.toThrow();

    // INSERT a member row claiming org B while scoped to org A — withCheck must reject it.
    // (FK to user/org is satisfiable via the owner; the row is rejected by RLS withCheck, not FK.)
    await expect(
      withTenant(s.orgA, async (tx) => {
        await tx.insert(member).values({
          id: `m-${Date.now()}`,
          organizationId: s.orgB,
          userId: "nonexistent-user-but-rls-rejects-first",
          role: "member",
          createdAt: new Date(),
        });
      }),
    ).rejects.toThrow();
  });

  it("(c) cross-tenant UPDATE of an org B row affects 0 rows on projects AND member", async () => {
    // org B's projectB is invisible to org A (using clause), so the UPDATE matches 0 rows.
    const projUpdated = await withTenant(s.orgA, async (tx) => {
      const res = await tx
        .update(projects)
        .set({ nombre: "hijacked" })
        .where(eq(projects.id, s.projectB));
      return (res as unknown as { count: number }).count;
    });
    expect(projUpdated).toBe(0);

    // org B's member rows are invisible to org A — UPDATE by organization_id matches 0 rows.
    const memberUpdated = await withTenant(s.orgA, async (tx) => {
      const res = await tx
        .update(member)
        .set({ role: "hijacked" })
        .where(eq(member.organizationId, s.orgB));
      return (res as unknown as { count: number }).count;
    });
    expect(memberUpdated).toBe(0);
  });

  it("(d) anon sees publicado projects and ZERO borrador (global published-only)", async () => {
    const rows = await withAnon(async (tx) => tx.select().from(projects));

    // At least one publicado row is visible (we seeded publicado for both orgs).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.estado === "publicado")).toBe(true);
    // ABSENCE: anon must never see a borrador row, across ANY org.
    expect(rows.filter((r) => r.estado === "borrador").length).toBe(0);
    expect(rows.every((r) => r.estado === "publicado")).toBe(true);
  });
});
