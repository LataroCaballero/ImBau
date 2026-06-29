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
import {
  projects,
  member,
  organization,
  floors,
  units,
  priceLists,
  unitPrices,
  paymentPlans,
  cacIndex,
  quotes,
  brokers,
  leads,
  progressPosts,
  galleries,
  media,
  events,
} from "../src/schema";
import {
  makeOrg,
  makeProject,
  makeMember,
  makeUser,
  makeFloor,
  makeUnit,
  makePriceList,
  makeUnitPrice,
  makePaymentPlan,
  makeCacIndex,
  makeQuote,
  makeBroker,
  makeLead,
  makeProgressPost,
  makeGallery,
  makeMedia,
  makeEvent,
  closeFixtures,
  type Estado,
} from "./helpers";

// Transaction types of the sanctioned access helpers — derived from the helper signatures so the
// descriptor-driven cases below stay fully typed (no `any`). withTenant<T>(orgId, fn) and
// withAnon<T>(fn) bind T to unknown under Parameters, exposing the AppTx/AnonTx params.
type AppTx = Parameters<Parameters<typeof withTenant>[1]>[0];
type AnonTx = Parameters<Parameters<typeof withAnon>[0]>[0];

// One published + one borrador "bundle" per org: a project plus one row of EVERY project-scoped
// new table, seeded via the OWNER. The absence/anon/events cases assert over these rows as the
// unprivileged role. ids are tracked so the anon-published case can prove a SPECIFIC publicado
// row is visible and a SPECIFIC borrador row is absent (robust against accumulated DB state).
type Bundle = {
  projectId: string;
  floorId: string;
  unitId: string;
  priceListId: string;
  unitPriceId: string;
  paymentPlanId: string;
  quoteId: string;
  brokerId: string;
  leadId: string;
  progressPostId: string;
  galleryId: string;
  mediaId: string;
  eventId: string;
};

// Seed a full project bundle for `orgId` in `estado` (owner connection — setup only).
async function seedBundle(orgId: string, estado: Estado): Promise<Bundle> {
  const projectId = await makeProject(orgId, estado);
  const floorId = await makeFloor(orgId, projectId);
  const unitId = await makeUnit(orgId, projectId, floorId);
  const priceListId = await makePriceList(orgId, projectId);
  const unitPriceId = await makeUnitPrice(orgId, projectId, unitId, priceListId);
  const paymentPlanId = await makePaymentPlan(orgId, projectId);
  const quoteId = await makeQuote(orgId, projectId, unitId, paymentPlanId);
  const brokerId = await makeBroker(orgId, projectId);
  const leadId = await makeLead(orgId, projectId);
  const progressPostId = await makeProgressPost(orgId, projectId);
  const galleryId = await makeGallery(orgId, projectId);
  const mediaId = await makeMedia(orgId, projectId);
  const eventId = await makeEvent(orgId, projectId);
  return {
    projectId,
    floorId,
    unitId,
    priceListId,
    unitPriceId,
    paymentPlanId,
    quoteId,
    brokerId,
    leadId,
    progressPostId,
    galleryId,
    mediaId,
    eventId,
  };
}

type Scenario = {
  orgA: string;
  orgB: string;
  projectA: string;
  projectB: string;
  // Full per-(org, estado) bundles for the domain-wide gate (SCHEMA-07/08).
  aPub: Bundle;
  aBor: Bundle;
  bPub: Bundle;
  bBor: Bundle;
  // cac_index is ORG-scoped (no project) — one private row per org.
  cacA: string;
  cacB: string;
};

// One shared scenario for the suite: org A and org B each with a publicado + a borrador
// project bundle (one row of every new table) AND a member row, seeded via the owner. Fresh
// unique ids mean no rollback needed. projectA/projectB keep the original (a)-(d) cases working.
let s: Scenario;

beforeAll(async () => {
  const orgA = await makeOrg();
  const orgB = await makeOrg();
  // org A: a publicado (visible to anon) + a borrador (never visible to anon) bundle + a member.
  const aPub = await seedBundle(orgA, "publicado");
  const aBor = await seedBundle(orgA, "borrador");
  const cacA = await makeCacIndex(orgA);
  await makeMember(orgA);
  // org B: likewise.
  const bPub = await seedBundle(orgB, "publicado");
  const bBor = await seedBundle(orgB, "borrador");
  const cacB = await makeCacIndex(orgB);
  await makeMember(orgB);
  s = {
    orgA,
    orgB,
    projectA: aPub.projectId,
    projectB: bPub.projectId,
    aPub,
    aBor,
    bPub,
    bBor,
    cacA,
    cacB,
  };
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

// Drizzle rethrows the driver error wrapped in a DrizzleQueryError whose top-level `.message`
// is generic ("Failed query: ..."); the real Postgres failure (SQLSTATE `42501` / "row-level
// security policy" text) is on `.cause` (possibly nested). Walk the whole cause chain and
// report whether ANY link is a row-level-security violation — so the cross-tenant write gate
// asserts on the actual RLS rejection, not the wrapper. (WR-03: no `as unknown as` casts.)
function rlsViolationInChain(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if (typeof current === "object") {
      const obj = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (obj.code === "42501") return true;
      if (
        typeof obj.message === "string" &&
        /row-level security|42501/.test(obj.message)
      ) {
        return true;
      }
      current = obj.cause;
    } else {
      break;
    }
  }
  return false;
}

describe("cross-tenant isolation (DATA-04 exit gate)", () => {
  it("(guard) app/anon connections are unprivileged (current_user + rolbypassrls=false)", async () => {
    // tx.execute<T>() resolves to a directly-indexable RowList<T[]>; index it without any
    // `as unknown as` re-cast (WR-03). The supplied generic IS the row type.
    const appGuard = await withTenant(s.orgA, async (tx) => {
      const who = await tx.execute<{ current_user: string }>(
        sql`select current_user`,
      );
      const attrs = await tx.execute<{ rolbypassrls: boolean }>(
        sql`select rolbypassrls from pg_roles where rolname = current_user`,
      );
      return {
        user: who[0]?.current_user,
        bypass: attrs[0]?.rolbypassrls,
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
        user: who[0]?.current_user,
        bypass: attrs[0]?.rolbypassrls,
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

  it("(a/b) organization self-isolation: a tenant reads ONLY its own organization row (CR-01)", async () => {
    // `organization` IS a tenant table, scoped by its own id via the organization_self policy.
    // org A (scoped to orgA) must see EXACTLY its own organization row and ZERO sibling rows —
    // closing the CR-01 cross-tenant read leak (previously every tenant could enumerate every
    // other tenant's name/slug/plan). This assertion is the under-test boundary for that fix.
    const orgRowsA = await withTenant(s.orgA, async (tx) =>
      tx.select().from(organization),
    );
    expect(orgRowsA.length).toBe(1);
    expect(orgRowsA[0]?.id).toBe(s.orgA);
    expect(orgRowsA.some((r) => r.id === s.orgB)).toBe(false);

    // Mirror: org B sees only org B's organization row, never org A's.
    const orgRowsB = await withTenant(s.orgB, async (tx) =>
      tx.select().from(organization),
    );
    expect(orgRowsB.length).toBe(1);
    expect(orgRowsB[0]?.id).toBe(s.orgB);
    expect(orgRowsB.some((r) => r.id === s.orgA)).toBe(false);
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
    // WR-01: seed a VALID user via the owner first so the member.user_id FK is satisfiable.
    // With a real userId, the ONLY possible rejection cause is the RLS `withCheck` (the old
    // test used a non-existent userId, so the FK violation fired regardless of RLS — a
    // vacuous gate). We further assert the error is a row-level-security / SQLSTATE 42501
    // policy violation, not merely "some throw".
    const uid = await makeUser();
    // The thrown error is drizzle's DrizzleQueryError wrapper: its top-level `.message` is the
    // generic "Failed query: ..." text, while the underlying Postgres error (SQLSTATE 42501,
    // "new row violates row-level security policy") lives on `.cause`. Walk the cause chain and
    // assert the RLS code/message is present there — this STRENGTHENS the gate (it proves the
    // rejection is specifically an RLS withCheck violation, not the FK or any other throw),
    // rather than matching the wrapper's generic message.
    let caught: unknown;
    await withTenant(s.orgA, async (tx) => {
      await tx.insert(member).values({
        id: `m-${Date.now()}`,
        organizationId: s.orgB,
        userId: uid,
        role: "member",
        createdAt: new Date(),
      });
    }).catch((e: unknown) => {
      caught = e;
    });
    expect(caught).toBeDefined();
    expect(rlsViolationInChain(caught)).toBe(true);
  });

  it("(c) cross-tenant UPDATE of an org B row affects 0 rows on projects AND member", async () => {
    // org B's projectB is invisible to org A (using clause), so the UPDATE matches 0 rows.
    // Assert on `.returning()` length — a fully-typed `{ id }[]`, NOT an untyped driver-internal
    // `.count` read behind an `as unknown as` cast (WR-02). RLS `using` makes the row unmatched,
    // so zero rows are returned.
    const projUpdated = await withTenant(s.orgA, async (tx) => {
      const rows = await tx
        .update(projects)
        .set({ nombre: "hijacked" })
        .where(eq(projects.id, s.projectB))
        .returning({ id: projects.id });
      return rows.length;
    });
    expect(projUpdated).toBe(0);

    // org B's member rows are invisible to org A — UPDATE by organization_id matches 0 rows.
    const memberUpdated = await withTenant(s.orgA, async (tx) => {
      const rows = await tx
        .update(member)
        .set({ role: "hijacked" })
        .where(eq(member.organizationId, s.orgB))
        .returning({ id: member.id });
      return rows.length;
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

// ──────────────────────────────────────────────────────────────────────────────────────────
// Domain-wide RLS exit gate (SCHEMA-07 / SCHEMA-08). Extends the absence/anon/write coverage to
// EVERY new tenant table plus the events partition. Same rules as above: every assertion runs as
// the unprivileged app/anon role through withTenant/withAnon; a failure means a schema/migration
// fix in 01-01..01-04 — NEVER weaken a check or switch to the owner role. The file-level beforeAll
// (which seeds the org-A/org-B publicado+borrador bundles) runs before this describe too.

// ABSENCE descriptors — one per new tenant table. `read` selects only organization_id (typed
// string) so a single generic loop asserts ZERO rows of the other org per table.
type AbsenceCase = {
  name: string;
  read: (tx: AppTx) => Promise<{ organizationId: string }[]>;
};
const absenceCases: AbsenceCase[] = [
  { name: "floors", read: (tx) => tx.select({ organizationId: floors.organizationId }).from(floors) },
  { name: "units", read: (tx) => tx.select({ organizationId: units.organizationId }).from(units) },
  { name: "price_lists", read: (tx) => tx.select({ organizationId: priceLists.organizationId }).from(priceLists) },
  { name: "unit_prices", read: (tx) => tx.select({ organizationId: unitPrices.organizationId }).from(unitPrices) },
  { name: "payment_plans", read: (tx) => tx.select({ organizationId: paymentPlans.organizationId }).from(paymentPlans) },
  { name: "cac_index", read: (tx) => tx.select({ organizationId: cacIndex.organizationId }).from(cacIndex) },
  { name: "quotes", read: (tx) => tx.select({ organizationId: quotes.organizationId }).from(quotes) },
  { name: "brokers", read: (tx) => tx.select({ organizationId: brokers.organizationId }).from(brokers) },
  { name: "leads", read: (tx) => tx.select({ organizationId: leads.organizationId }).from(leads) },
  { name: "progress_posts", read: (tx) => tx.select({ organizationId: progressPosts.organizationId }).from(progressPosts) },
  { name: "galleries", read: (tx) => tx.select({ organizationId: galleries.organizationId }).from(galleries) },
  { name: "media", read: (tx) => tx.select({ organizationId: media.organizationId }).from(media) },
  { name: "events", read: (tx) => tx.select({ organizationId: events.organizationId }).from(events) },
];

// WRITE descriptors — one per new tenant table. `insertClaimingB` inserts a row CLAIMING org B
// while scoped to org A (the parent FKs point at org B's REAL rows, so the ONLY possible rejection
// is the tenant withCheck — 42501, not an FK violation). `updateOrgB` updates an org-B row by id
// while scoped to org A; the tenant USING clause hides it, so 0 rows are returned.
type WriteCase = {
  name: string;
  insertClaimingB: (tx: AppTx) => Promise<unknown>;
  updateOrgB: (tx: AppTx) => Promise<{ id: string }[]>;
};
const writeCases: WriteCase[] = [
  {
    name: "floors",
    insertClaimingB: (tx) =>
      tx.insert(floors).values({ organizationId: s.orgB, projectId: s.bPub.projectId, numero: 1 }),
    updateOrgB: (tx) =>
      tx.update(floors).set({ nombre: "hijacked" }).where(eq(floors.id, s.bPub.floorId)).returning({ id: floors.id }),
  },
  {
    name: "units",
    insertClaimingB: (tx) =>
      tx.insert(units).values({ organizationId: s.orgB, projectId: s.bPub.projectId, floorId: s.bPub.floorId, identificador: "x" }),
    updateOrgB: (tx) =>
      tx.update(units).set({ tipologia: "hijacked" }).where(eq(units.id, s.bPub.unitId)).returning({ id: units.id }),
  },
  {
    name: "price_lists",
    insertClaimingB: (tx) =>
      tx.insert(priceLists).values({ organizationId: s.orgB, projectId: s.bPub.projectId, nombre: "x", moneda: "USD" }),
    updateOrgB: (tx) =>
      tx.update(priceLists).set({ nombre: "hijacked" }).where(eq(priceLists.id, s.bPub.priceListId)).returning({ id: priceLists.id }),
  },
  {
    name: "unit_prices",
    insertClaimingB: (tx) =>
      tx.insert(unitPrices).values({ organizationId: s.orgB, projectId: s.bPub.projectId, unitId: s.bPub.unitId, priceListId: s.bPub.priceListId, precio: 1, vigencia: new Date() }),
    updateOrgB: (tx) =>
      tx.update(unitPrices).set({ precio: 1 }).where(eq(unitPrices.id, s.bPub.unitPriceId)).returning({ id: unitPrices.id }),
  },
  {
    name: "payment_plans",
    insertClaimingB: (tx) =>
      tx.insert(paymentPlans).values({ organizationId: s.orgB, projectId: s.bPub.projectId, nombre: "x", anticipoPct: "10", cuotas: 1, ajuste: "CAC" }),
    updateOrgB: (tx) =>
      tx.update(paymentPlans).set({ nombre: "hijacked" }).where(eq(paymentPlans.id, s.bPub.paymentPlanId)).returning({ id: paymentPlans.id }),
  },
  {
    name: "cac_index",
    insertClaimingB: (tx) =>
      tx.insert(cacIndex).values({ organizationId: s.orgB, periodo: `X-${Date.now()}-${Math.random()}`, valor: "1" }),
    updateOrgB: (tx) =>
      tx.update(cacIndex).set({ valor: "1" }).where(eq(cacIndex.id, s.cacB)).returning({ id: cacIndex.id }),
  },
  {
    name: "quotes",
    insertClaimingB: (tx) =>
      tx.insert(quotes).values({ organizationId: s.orgB, projectId: s.bPub.projectId, unitId: s.bPub.unitId, paymentPlanId: s.bPub.paymentPlanId, snapshot: { version: 1 } }),
    updateOrgB: (tx) =>
      tx.update(quotes).set({ pdfKey: "hijacked" }).where(eq(quotes.id, s.bPub.quoteId)).returning({ id: quotes.id }),
  },
  {
    name: "brokers",
    insertClaimingB: (tx) =>
      tx.insert(brokers).values({ organizationId: s.orgB, projectId: s.bPub.projectId, nombre: "x", slug: `x-${Date.now()}-${Math.random()}` }),
    updateOrgB: (tx) =>
      tx.update(brokers).set({ nombre: "hijacked" }).where(eq(brokers.id, s.bPub.brokerId)).returning({ id: brokers.id }),
  },
  {
    name: "leads",
    insertClaimingB: (tx) =>
      tx.insert(leads).values({ organizationId: s.orgB, projectId: s.bPub.projectId, nombre: "x", contacto: "x" }),
    updateOrgB: (tx) =>
      tx.update(leads).set({ nombre: "hijacked" }).where(eq(leads.id, s.bPub.leadId)).returning({ id: leads.id }),
  },
  {
    name: "progress_posts",
    insertClaimingB: (tx) =>
      tx.insert(progressPosts).values({ organizationId: s.orgB, projectId: s.bPub.projectId, fecha: new Date(), titulo: "x" }),
    updateOrgB: (tx) =>
      tx.update(progressPosts).set({ titulo: "hijacked" }).where(eq(progressPosts.id, s.bPub.progressPostId)).returning({ id: progressPosts.id }),
  },
  {
    name: "galleries",
    insertClaimingB: (tx) =>
      tx.insert(galleries).values({ organizationId: s.orgB, projectId: s.bPub.projectId, seccion: "amenities" }),
    updateOrgB: (tx) =>
      tx.update(galleries).set({ seccion: "exteriores" }).where(eq(galleries.id, s.bPub.galleryId)).returning({ id: galleries.id }),
  },
  {
    name: "media",
    insertClaimingB: (tx) =>
      tx.insert(media).values({ organizationId: s.orgB, projectId: s.bPub.projectId, originalKey: "x" }),
    updateOrgB: (tx) =>
      tx.update(media).set({ originalKey: "hijacked" }).where(eq(media.id, s.bPub.mediaId)).returning({ id: media.id }),
  },
  {
    name: "events",
    insertClaimingB: (tx) =>
      tx.insert(events).values({ organizationId: s.orgB, projectId: s.bPub.projectId, tipo: "x" }),
    updateOrgB: (tx) =>
      tx.update(events).set({ tipo: "hijacked" }).where(eq(events.id, s.bPub.eventId)).returning({ id: events.id }),
  },
];

// no-anon descriptors — tenant-private tables anon has NO grant on. An anon SELECT must raise
// 42501 (insufficient_privilege — covers BOTH grant-denial here and RLS withCheck elsewhere; the
// shared rlsViolationInChain keys on code 42501).
type NoAnonCase = { name: string; read: (tx: AnonTx) => Promise<unknown> };
const noAnonCases: NoAnonCase[] = [
  { name: "quotes", read: (tx) => tx.select().from(quotes) },
  { name: "cac_index", read: (tx) => tx.select().from(cacIndex) },
  { name: "leads", read: (tx) => tx.select().from(leads) },
  { name: "events", read: (tx) => tx.select().from(events) },
];

describe("domain-wide RLS exit gate (SCHEMA-07/08)", () => {
  it("(1) read isolation A->B and B->A: zero rows of the other org on every new tenant table", async () => {
    // A->B: scoped to org A, each table shows ONLY org-A rows and ZERO org-B rows (absence).
    const rowsA = await withTenant(s.orgA, async (tx) => {
      const out: Record<string, { organizationId: string }[]> = {};
      for (const c of absenceCases) out[c.name] = await c.read(tx);
      return out;
    });
    for (const c of absenceCases) {
      const rows = rowsA[c.name] ?? [];
      expect(rows.length, `${c.name} A->B has org-A rows`).toBeGreaterThan(0);
      expect(rows.every((r) => r.organizationId === s.orgA), `${c.name} A->B all org A`).toBe(true);
      expect(rows.filter((r) => r.organizationId === s.orgB).length, `${c.name} A->B zero org B`).toBe(0);
    }

    // Mirror B->A: scoped to org B, each table shows ONLY org-B rows and ZERO org-A rows.
    const rowsB = await withTenant(s.orgB, async (tx) => {
      const out: Record<string, { organizationId: string }[]> = {};
      for (const c of absenceCases) out[c.name] = await c.read(tx);
      return out;
    });
    for (const c of absenceCases) {
      const rows = rowsB[c.name] ?? [];
      expect(rows.length, `${c.name} B->A has org-B rows`).toBeGreaterThan(0);
      expect(rows.every((r) => r.organizationId === s.orgB), `${c.name} B->A all org B`).toBe(true);
      expect(rows.filter((r) => r.organizationId === s.orgA).length, `${c.name} B->A zero org A`).toBe(0);
    }
  });

  it("(2) cross-tenant INSERT raises 42501 on every new tenant table (withCheck)", async () => {
    for (const c of writeCases) {
      let caught: unknown;
      await withTenant(s.orgA, (tx) => c.insertClaimingB(tx)).catch((e: unknown) => {
        caught = e;
      });
      expect(caught, `${c.name} insert threw`).toBeDefined();
      expect(rlsViolationInChain(caught), `${c.name} insert is 42501`).toBe(true);
    }
  });

  it("(2) cross-tenant UPDATE of an org-B row affects 0 rows on every new tenant table (using)", async () => {
    for (const c of writeCases) {
      const updated = await withTenant(s.orgA, (tx) => c.updateOrgB(tx));
      expect(updated.length, `${c.name} update 0 rows`).toBe(0);
    }
  });

  it("(3) anon sees ONLY publicado-project rows on catalog/content tables, zero borrador", async () => {
    // Per catalog/content table: a SPECIFIC publicado row is visible, a SPECIFIC borrador row is not.
    type AnonPublishedCase = {
      name: string;
      read: (tx: AnonTx) => Promise<{ id: string }[]>;
      pubRowId: string;
      borRowId: string;
    };
    const anonPublishedCases: AnonPublishedCase[] = [
      { name: "floors", read: (tx) => tx.select({ id: floors.id }).from(floors), pubRowId: s.aPub.floorId, borRowId: s.aBor.floorId },
      { name: "units", read: (tx) => tx.select({ id: units.id }).from(units), pubRowId: s.aPub.unitId, borRowId: s.aBor.unitId },
      { name: "price_lists", read: (tx) => tx.select({ id: priceLists.id }).from(priceLists), pubRowId: s.aPub.priceListId, borRowId: s.aBor.priceListId },
      { name: "unit_prices", read: (tx) => tx.select({ id: unitPrices.id }).from(unitPrices), pubRowId: s.aPub.unitPriceId, borRowId: s.aBor.unitPriceId },
      { name: "payment_plans", read: (tx) => tx.select({ id: paymentPlans.id }).from(paymentPlans), pubRowId: s.aPub.paymentPlanId, borRowId: s.aBor.paymentPlanId },
      { name: "brokers", read: (tx) => tx.select({ id: brokers.id }).from(brokers), pubRowId: s.aPub.brokerId, borRowId: s.aBor.brokerId },
      { name: "progress_posts", read: (tx) => tx.select({ id: progressPosts.id }).from(progressPosts), pubRowId: s.aPub.progressPostId, borRowId: s.aBor.progressPostId },
      { name: "galleries", read: (tx) => tx.select({ id: galleries.id }).from(galleries), pubRowId: s.aPub.galleryId, borRowId: s.aBor.galleryId },
      { name: "media", read: (tx) => tx.select({ id: media.id }).from(media), pubRowId: s.aPub.mediaId, borRowId: s.aBor.mediaId },
    ];
    for (const c of anonPublishedCases) {
      const ids = new Set(
        (await withAnon((tx) => c.read(tx))).map((r) => r.id),
      );
      expect(ids.has(c.pubRowId), `${c.name} publicado row visible`).toBe(true);
      expect(ids.has(c.borRowId), `${c.name} borrador row absent`).toBe(false);
    }
  });

  it("(4) anon SELECT on tenant-private tables (quotes, cac_index, leads, events) raises 42501", async () => {
    for (const c of noAnonCases) {
      let caught: unknown;
      await withAnon((tx) => c.read(tx)).catch((e: unknown) => {
        caught = e;
      });
      expect(caught, `${c.name} anon select threw`).toBeDefined();
      expect(rlsViolationInChain(caught), `${c.name} anon select is 42501`).toBe(true);
    }
  });

  it("(5) anon INSERT into leads/events: publicado succeeds, borrador rejected (42501)", async () => {
    // leads — publicado project: the leads_anon_insert withCheck (EXISTS publicado) passes.
    await expect(
      withAnon((tx) =>
        tx.insert(leads).values({ organizationId: s.orgA, projectId: s.aPub.projectId, nombre: "anon", contacto: "x" }),
      ),
    ).resolves.not.toThrow();
    // leads — borrador project: withCheck fails → 42501.
    let caughtLead: unknown;
    await withAnon((tx) =>
      tx.insert(leads).values({ organizationId: s.orgA, projectId: s.aBor.projectId, nombre: "anon", contacto: "x" }),
    ).catch((e: unknown) => {
      caughtLead = e;
    });
    expect(caughtLead, "leads borrador insert threw").toBeDefined();
    expect(rlsViolationInChain(caughtLead), "leads borrador insert is 42501").toBe(true);

    // events — publicado project: the events_anon_insert withCheck passes.
    await expect(
      withAnon((tx) =>
        tx.insert(events).values({ organizationId: s.orgA, projectId: s.aPub.projectId, tipo: "view" }),
      ),
    ).resolves.not.toThrow();
    // events — borrador project: withCheck fails → 42501.
    let caughtEvent: unknown;
    await withAnon((tx) =>
      tx.insert(events).values({ organizationId: s.orgA, projectId: s.aBor.projectId, tipo: "view" }),
    ).catch((e: unknown) => {
      caughtEvent = e;
    });
    expect(caughtEvent, "events borrador insert threw").toBeDefined();
    expect(rlsViolationInChain(caughtEvent), "events borrador insert is 42501").toBe(true);
  });

  it("(6) events: far-future ts routes to DEFAULT partition + readable by tenant; org-B event absent from parent", async () => {
    // An out-of-range ts has no monthly partition → it MUST land in events_default (no error) and
    // be read back by its tenant through the parent table.
    const farFuture = new Date("2999-01-15T00:00:00Z");
    const inserted = await withTenant(s.orgA, (tx) =>
      tx
        .insert(events)
        .values({ organizationId: s.orgA, projectId: s.aPub.projectId, tipo: "default-part", ts: farFuture })
        .returning({ id: events.id }),
    );
    const eventId = inserted[0]?.id;
    if (!eventId) throw new Error("far-future event insert returned no id");

    const readBack = await withTenant(s.orgA, (tx) =>
      tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)),
    );
    expect(readBack.length, "far-future event readable by tenant").toBe(1);

    // Parent isolation (Pitfall 6): querying the events PARENT as org A yields ZERO org-B rows —
    // RLS on the partitioned parent propagates to every partition (monthly + default).
    const parentRows = await withTenant(s.orgA, (tx) =>
      tx.select({ organizationId: events.organizationId }).from(events),
    );
    expect(parentRows.length, "events parent has org-A rows").toBeGreaterThan(0);
    expect(parentRows.every((r) => r.organizationId === s.orgA), "events parent all org A").toBe(true);
    expect(parentRows.filter((r) => r.organizationId === s.orgB).length, "events parent zero org B").toBe(0);
  });
});
