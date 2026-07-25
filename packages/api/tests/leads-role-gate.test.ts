// leads role-gate cross-role + transition + timeline + idempotency matrix (LEADS-01..04, D-01..06,
// PANEL-02 mold) — the load-bearing proof that the leads bandeja enforces authorization + tenant
// isolation + no-enumeration + the pipeline state machine + append-only timeline + enqueue-once
// idempotency server-side, NOT via UI hiding. Everything under test is asserted THROUGH the tRPC
// caller (createCaller) → the unprivileged app_authenticated role, exactly as a real panel request.
// The owner SQL pool appears ONLY in seeding (beforeAll) and post-hoc audit reads, never inside an
// it(...) assertion (RESEARCH Pitfall 4 — asserting as the owner pool would false-green the RLS gate).
//
// Matrix (against orgA's project, calling leads.updateEstado / addNote / create):
//   owner (orgA)            → resolves, write persists + events audit row (transition)
//   developer (orgA member) → resolves
//   viewer (orgA member)    → FORBIDDEN (requireRole, pre-write; no events row)
//   other-org owner (orgB)  → NOT_FOUND (RLS invisibility, no-enumeration)
//   non-existent leadId     → NOT_FOUND (identical to cross-org)
// Plus: origen resolution (broker/unidad/cotización/Directo), cerrado desenlace refine (400),
// timeline append order, enqueue-once idempotency (jobId dedup), and the load-bearing rollback proof
// (a failing create enqueues ZERO jobs — the enqueue sits AFTER the committed persist, OUTSIDE the tx).

// Mock the leads RUNTIME so the router's enqueue seam never touches live Redis under test (Pitfall
// 3). enqueueLeadEmail records its calls for the create-side-effect + rollback assertions.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/leads/runtime", () => ({
  enqueueLeadEmail: vi.fn(() => Promise.resolve()),
}));

import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { leadEmailJobOptions } from "@imbau/storage";
// Imported AFTER the mock declaration; this is the vi.fn() stub above (hoisted vi.mock).
import { enqueueLeadEmail } from "../src/leads/runtime";
import {
  makeUserWithActiveOrg,
  mintMemberInOrg,
  type SessionFixture,
} from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

interface ProjectSeed {
  projectId: string;
  brokerId: string;
  unitId: string;
  quoteId: string;
  // Leads seeded for the origen-resolution read (LEADS-01).
  leadBrokerId: string;
  leadUnitId: string;
  leadQuoteId: string;
  leadDirectoId: string;
}

// Seed a project + broker + unit + payment_plan + quote + 4 origen-tagged leads for `orgId` through
// the OWNER pool, in FK order. The catálogo/pricing parents have no editor router, so they land via
// raw owner SQL exactly like the other role-gate suites.
async function seedProject(orgId: string): Promise<ProjectSeed> {
  const projectId = randomUUID();
  const floorId = randomUUID();
  const unitId = randomUUID();
  const brokerId = randomUUID();
  const planId = randomUUID();
  const quoteId = randomUUID();
  const leadBrokerId = randomUUID();
  const leadUnitId = randomUUID();
  const leadQuoteId = randomUUID();
  const leadDirectoId = randomUUID();
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
  await owner`
    insert into brokers (id, organization_id, project_id, nombre, slug)
    values (${brokerId}, ${orgId}, ${projectId}, 'Brokers del Sur', ${`br-${slug}`})
  `;
  await owner`
    insert into payment_plans (id, organization_id, project_id, nombre, anticipo_pct, cuotas, ajuste)
    values (${planId}, ${orgId}, ${projectId}, 'Plan A', '30', 12, 'CAC')
  `;
  await owner`
    insert into quotes (id, organization_id, project_id, unit_id, payment_plan_id, snapshot)
    values (${quoteId}, ${orgId}, ${projectId}, ${unitId}, ${planId}, '{"version":1}'::jsonb)
  `;
  // Four leads, one per origen pointer (the fourth all-null → Directo).
  await owner`
    insert into leads (id, organization_id, project_id, broker_id, nombre, contacto, estado)
    values (${leadBrokerId}, ${orgId}, ${projectId}, ${brokerId}, 'Lead Broker', 'wa 1', 'nuevo')
  `;
  await owner`
    insert into leads (id, organization_id, project_id, unit_id, nombre, contacto, estado)
    values (${leadUnitId}, ${orgId}, ${projectId}, ${unitId}, 'Lead Unidad', 'wa 2', 'nuevo')
  `;
  await owner`
    insert into leads (id, organization_id, project_id, quote_id, nombre, contacto, estado)
    values (${leadQuoteId}, ${orgId}, ${projectId}, ${quoteId}, 'Lead Cotización', 'wa 3', 'nuevo')
  `;
  await owner`
    insert into leads (id, organization_id, project_id, nombre, contacto, estado)
    values (${leadDirectoId}, ${orgId}, ${projectId}, 'Lead Directo', 'wa 4', 'nuevo')
  `;

  return {
    projectId,
    brokerId,
    unitId,
    quoteId,
    leadBrokerId,
    leadUnitId,
    leadQuoteId,
    leadDirectoId,
  };
}

// Seed a bare lead in a given estado through the owner pool; returns its id. Used to mint
// per-test leads so state transitions in one case never bleed into another.
async function seedLead(
  orgId: string,
  projectId: string,
  estado: string,
): Promise<string> {
  const id = randomUUID();
  await owner`
    insert into leads (id, organization_id, project_id, nombre, contacto, estado)
    values (${id}, ${orgId}, ${projectId}, 'Lead', 'contacto', ${estado})
  `;
  return id;
}

// Count events rows for a (projectId, tipo) — the D-04 audit assertion, read via the owner pool.
// events has no lead_id column, so the lead audit trail is keyed by (project_id, tipo).
async function countEvents(projectId: string, tipo: string): Promise<number> {
  const rows = await owner<{ n: string }[]>`
    select count(*)::int as n from events where project_id = ${projectId} and tipo = ${tipo}
  `;
  return Number(rows[0]?.n ?? 0);
}

// Read a lead's timeline directly (post-hoc, owner pool) to assert append order.
async function readTimeline(leadId: string): Promise<unknown[]> {
  const rows = await owner<{ timeline: unknown[] }[]>`
    select timeline from leads where id = ${leadId}
  `;
  return rows[0]?.timeline ?? [];
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

beforeEach(() => {
  vi.mocked(enqueueLeadEmail).mockClear();
});

describe("leads.listForProject origen resolution (LEADS-01)", () => {
  it("resolves broker / unidad / cotización / Directo and hides cross-org leads", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const leads = await caller.leads.listForProject({ projectId: seed.projectId });
    const byId = new Map(leads.map((l) => [l.id, l]));

    expect(byId.get(seed.leadBrokerId)?.origenResuelto).toMatchObject({
      tipo: "broker",
      label: "Brokers del Sur",
    });
    expect(byId.get(seed.leadUnitId)?.origenResuelto).toMatchObject({
      tipo: "unidad",
      label: "4B",
    });
    expect(byId.get(seed.leadQuoteId)?.origenResuelto?.tipo).toBe("cotizacion");
    expect(byId.get(seed.leadDirectoId)?.origenResuelto).toMatchObject({
      tipo: "directo",
      label: "Directo",
    });

    // Cross-org caller sees an empty bandeja for orgA's project (RLS invisibility).
    const other = await createCaller({ headers: orgB.headers });
    const empty = await other.leads.listForProject({ projectId: seed.projectId });
    expect(empty).toHaveLength(0);
  });
});

describe("leads.updateEstado write gate + audit (LEADS-02 / D-02 / D-04)", () => {
  it("owner moves a lead, appends the auto timeline entry, and emits an audit event", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: orgA.headers });
    const before = await countEvents(seed.projectId, "lead_estado_changed");

    const row = await caller.leads.updateEstado({
      projectId: seed.projectId,
      leadId,
      estado: "contactado",
    });
    expect(row).toMatchObject({ id: leadId, estado: "contactado" });
    expect(await countEvents(seed.projectId, "lead_estado_changed")).toBe(before + 1);

    const timeline = (await readTimeline(leadId)) as {
      estadoPrev?: string;
      estadoNuevo?: string;
    }[];
    const auto = timeline.at(-1);
    expect(auto).toMatchObject({ estadoPrev: "nuevo", estadoNuevo: "contactado" });
    // No email is enqueued on a transition (D-06).
    expect(enqueueLeadEmail).not.toHaveBeenCalled();
  });

  it("developer caller resolves", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: developerA.headers });
    const row = await caller.leads.updateEstado({
      projectId: seed.projectId,
      leadId,
      estado: "negociacion",
    });
    expect(row).toMatchObject({ estado: "negociacion" });
  });

  it("viewer caller is rejected with FORBIDDEN and writes no audit event", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: viewerA.headers });
    const before = await countEvents(seed.projectId, "lead_estado_changed");
    await expect(
      caller.leads.updateEstado({
        projectId: seed.projectId,
        leadId,
        estado: "contactado",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await countEvents(seed.projectId, "lead_estado_changed")).toBe(before);
  });

  it("other-org owner is rejected with NOT_FOUND (RLS invisibility)", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: orgB.headers });
    await expect(
      caller.leads.updateEstado({
        projectId: seed.projectId,
        leadId,
        estado: "contactado",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non-existent leadId under the active org yields NOT_FOUND (no enumeration)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.leads.updateEstado({
        projectId: seed.projectId,
        leadId: randomUUID(),
        estado: "contactado",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("leads.updateEstado cerrado desenlace refine (LEADS-02 / D-03)", () => {
  it("rejects moving to cerrado without a desenlace (400)", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "negociacion");
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.leads.updateEstado({
        projectId: seed.projectId,
        leadId,
        estado: "cerrado",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("persists desenlace and the auto note when closing with ganado", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "negociacion");
    const caller = await createCaller({ headers: orgA.headers });
    const row = await caller.leads.updateEstado({
      projectId: seed.projectId,
      leadId,
      estado: "cerrado",
      desenlace: "ganado",
    });
    expect(row).toMatchObject({ estado: "cerrado", desenlace: "ganado" });
    const timeline = (await readTimeline(leadId)) as { estadoNuevo?: string }[];
    expect(timeline.at(-1)).toMatchObject({
      estadoPrev: "negociacion",
      estadoNuevo: "cerrado",
    });
  });

  it("clears desenlace when reopening a cerrado lead (transitions are free, D-02)", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "negociacion");
    const caller = await createCaller({ headers: orgA.headers });
    await caller.leads.updateEstado({
      projectId: seed.projectId,
      leadId,
      estado: "cerrado",
      desenlace: "perdido",
    });
    const reopened = await caller.leads.updateEstado({
      projectId: seed.projectId,
      leadId,
      estado: "negociacion",
    });
    expect(reopened).toMatchObject({ estado: "negociacion", desenlace: null });
  });
});

describe("leads.addNote append-only timeline (LEADS-03 / D-06)", () => {
  it("appends a free-text note in ts order, writes no events row, and enqueues nothing", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: orgA.headers });
    const beforeEvents = await countEvents(seed.projectId, "lead_estado_changed");

    await caller.leads.addNote({
      projectId: seed.projectId,
      leadId,
      nota: "Primera nota",
    });
    await caller.leads.addNote({
      projectId: seed.projectId,
      leadId,
      nota: "Segunda nota",
    });

    const timeline = (await readTimeline(leadId)) as { nota?: string }[];
    expect(timeline.map((n) => n.nota)).toEqual(["Primera nota", "Segunda nota"]);
    // Notes emit no audit event and no email (D-06).
    expect(await countEvents(seed.projectId, "lead_estado_changed")).toBe(beforeEvents);
    expect(enqueueLeadEmail).not.toHaveBeenCalled();
  });

  it("viewer caller is rejected with FORBIDDEN", async () => {
    const leadId = await seedLead(orgA.orgId, seed.projectId, "nuevo");
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.leads.addNote({ projectId: seed.projectId, leadId, nota: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("non-existent leadId yields NOT_FOUND", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.leads.addNote({
        projectId: seed.projectId,
        leadId: randomUUID(),
        nota: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("leads.create + enqueue seam (LEADS-04 / D-01 / D-06)", () => {
  it("owner creates a lead, seeds the t=0 timeline entry, and enqueues exactly one job", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const { leadId } = await caller.leads.create({
      projectId: seed.projectId,
      nombre: "Nuevo Comprador",
      contacto: "wa 999",
      origen: "Directo",
    });
    expect(leadId).toBeTruthy();
    expect(enqueueLeadEmail).toHaveBeenCalledTimes(1);
    expect(enqueueLeadEmail).toHaveBeenCalledWith({
      leadId,
      organizationId: orgA.orgId,
      projectId: seed.projectId,
    });

    // The creation entry is seeded at t=0 so the drawer never opens empty (UI-SPEC D-04).
    const timeline = (await readTimeline(leadId)) as { nota?: string }[];
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.nota).toContain("registró el lead");

    // Idempotency contract: the dedup jobId is deterministic per lead, so a retried enqueue of the
    // same created-event carries the SAME jobId → BullMQ collapses it to one job (LEADS-04).
    expect(leadEmailJobOptions(leadId).jobId).toBe(`lead:${leadId}:created`);
    expect(leadEmailJobOptions(leadId).jobId).toBe(leadEmailJobOptions(leadId).jobId);
  });

  it("viewer caller is rejected with FORBIDDEN and enqueues nothing", async () => {
    const caller = await createCaller({ headers: viewerA.headers });
    await expect(
      caller.leads.create({
        projectId: seed.projectId,
        nombre: "x",
        contacto: "y",
        origen: "Directo",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(enqueueLeadEmail).not.toHaveBeenCalled();
  });

  it("a failing insert (cross-org projectId) rejects AND enqueues ZERO jobs (post-commit placement)", async () => {
    // A projectId that does not exist under the caller's tenant makes the leads→projects composite
    // FK insert throw INSIDE withTenant. Because the enqueue sits AFTER the withTenant promise
    // resolves (OUTSIDE the tx), the rejected persist reaches the enqueue line 0 times — the
    // structural proof that a rolled-back lead never leaks a queued email (D-06).
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.leads.create({
        projectId: randomUUID(),
        nombre: "Fantasma",
        contacto: "wa 000",
        origen: "Directo",
      }),
    ).rejects.toThrow();
    expect(enqueueLeadEmail).not.toHaveBeenCalled();
  });
});
