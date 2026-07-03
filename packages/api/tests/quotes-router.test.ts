// quotes router integration tests (QUOTE-01 / QUOTE-02) — the phase's Nyquist validation
// contract. Every assertion runs through the tRPC caller against the live Postgres `_test` DB,
// exercising the EXACT anonymous production path: `createCaller({ headers: new Headers() })` →
// quotesRouter → withAnon(org resolve) → withTenant(orgId) reads/insert → the real RLS roles.
//
// Seeding strategy (mirrors trpc-tenant.test.ts / media-router.test.ts): org A and org B are
// minted by the REAL auth runtime via makeUserWithActiveOrg (owner-pool adapter — the only
// sanctioned write path for RLS-FORCED org/member tables). Their catálogo (project + floor +
// unit + price lists + unit prices + payment plan + cac_index) is seeded through the OWNER SQL
// client in FK order. The BEHAVIOR under test all flows through the anon caller — we never assert
// as the owner pool except to seed and to read back the persisted snapshot.
//
// Money is checked with EXACT integer/string equality — never an approximate matcher (a cent
// that does not reconcile is a bug, CLAUDE.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant, withAnon, schema } from "@imbau/db";
import { ENGINE_VERSION, QuoteError } from "@imbau/quoting";
import { createCaller } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

const owner = ownerSql();

// Seeded price constants — two USD lists so the router's /contado/i classification resolves both.
const PRECIO_CONTADO_USD = 88_000;
const PRECIO_FINANCIADO_USD = 100_000;
// Two CAC periods so the max-período rule (D-07) is meaningful; the LATER one must be the one used.
const CAC_PERIODO_VIEJO = "2026-05";
const CAC_PERIODO_NUEVO = "2026-06";
const PLAN_CUOTAS = 12;

interface QuoteFixture {
  projectId: string;
  unitId: string;
  paymentPlanId: string;
}

// Insert a project row through the OWNER pool (mirrors trpc-tenant.test.ts seedProject). `estado`
// controls anon visibility: only `publicado` is resolvable by withAnon.
async function seedProjectRow(
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

// Insert a CAC-adjusted payment plan (ajuste 'CAC', 12 cuotas, one refuerzo). `anticipoPct` is a
// numeric string (D-14 — never float); refuerzos is jsonb. Returns the plan id.
async function seedPaymentPlan(
  orgId: string,
  projectId: string,
  anticipoPct: string,
): Promise<string> {
  const id = randomUUID();
  await owner`
    insert into payment_plans
      (id, organization_id, project_id, nombre, anticipo_pct, cuotas, ajuste, refuerzos, notas_legales)
    values
      (${id}, ${orgId}, ${projectId}, ${"Plan test 30/70 CAC"}, ${anticipoPct}, ${PLAN_CUOTAS},
       ${"CAC"}, ${owner.json([{ cuota: 6, montoUsd: 5000 }])}, ${"Cotización no vinculante."})
  `;
  return id;
}

// Seed a full quoting fixture for `orgId` through the OWNER pool, in FK order: publicado project →
// floor → unit → two USD price lists (Contado / Financiado) → two unit prices → one CAC payment
// plan → (optionally) two cac_index periods. Returns the ids the router's input surface needs.
async function seedQuoteFixtures(
  orgId: string,
  opts: { withCac: boolean },
): Promise<QuoteFixture> {
  const projectId = await seedProjectRow(orgId, "publicado");

  const floorId = randomUUID();
  await owner`
    insert into floors (id, organization_id, project_id, numero)
    values (${floorId}, ${orgId}, ${projectId}, ${1})
  `;

  const unitId = randomUUID();
  await owner`
    insert into units (id, organization_id, project_id, floor_id, identificador)
    values (${unitId}, ${orgId}, ${projectId}, ${floorId}, ${"1A"})
  `;

  // Two USD lists: the /contado/i-named one is the contado price, the other USD list is financiado.
  const contadoListId = randomUUID();
  const financiadoListId = randomUUID();
  await owner`
    insert into price_lists (id, organization_id, project_id, nombre, moneda)
    values
      (${contadoListId}, ${orgId}, ${projectId}, ${"Lista Contado USD"}, ${"USD"}),
      (${financiadoListId}, ${orgId}, ${projectId}, ${"Lista Financiado USD"}, ${"USD"})
  `;

  const vigencia = new Date("2026-01-01T00:00:00Z");
  await owner`
    insert into unit_prices (id, organization_id, project_id, unit_id, price_list_id, precio, vigencia)
    values
      (${randomUUID()}, ${orgId}, ${projectId}, ${unitId}, ${contadoListId}, ${PRECIO_CONTADO_USD}, ${vigencia}),
      (${randomUUID()}, ${orgId}, ${projectId}, ${unitId}, ${financiadoListId}, ${PRECIO_FINANCIADO_USD}, ${vigencia})
  `;

  const paymentPlanId = await seedPaymentPlan(orgId, projectId, "30.00");

  if (opts.withCac) {
    await owner`
      insert into cac_index (id, organization_id, periodo, valor)
      values
        (${randomUUID()}, ${orgId}, ${CAC_PERIODO_VIEJO}, ${"500000.0000"}),
        (${randomUUID()}, ${orgId}, ${CAC_PERIODO_NUEVO}, ${"520000.0000"})
    `;
  }

  return { projectId, unitId, paymentPlanId };
}

// Count quotes rows for an org via the OWNER pool (outside RLS) — used to prove compute writes none.
async function countQuotes(orgId: string): Promise<number> {
  const rows = await owner<{ n: number }[]>`
    select count(*)::int as n from quotes where organization_id = ${orgId}
  `;
  return rows[0]?.n ?? 0;
}

let orgA: SessionFixture;
let fixtureA: QuoteFixture;
// orgB has full fixtures but NO cac_index → proves the missing-CAC precondition path.
let orgB: SessionFixture;
let fixtureB: QuoteFixture;
// An out-of-range payment plan on orgA's project → proves the engine's typed rejection surfaces.
let degeneratePlanId: string;
// A borrador (unpublished) project on orgA → proves anon resolution yields NOT_FOUND.
let borradorProjectId: string;

beforeAll(async () => {
  orgA = await makeUserWithActiveOrg();
  fixtureA = await seedQuoteFixtures(orgA.orgId, { withCac: true });

  orgB = await makeUserWithActiveOrg();
  fixtureB = await seedQuoteFixtures(orgB.orgId, { withCac: false });

  // anticipoPct 150 is outside [0, 100] → calcQuote throws ANTICIPO_PCT_FUERA_DE_RANGO.
  degeneratePlanId = await seedPaymentPlan(orgA.orgId, fixtureA.projectId, "150.00");
  borradorProjectId = await seedProjectRow(orgA.orgId, "borrador");
}, 60_000);

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("quotes.compute / quotes.create happy path (QUOTE-01 / QUOTE-02)", () => {
  it("anon compute returns a financiado QuoteResult read from the publicado project", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const result = await caller.quotes.compute({
      projectId: fixtureA.projectId,
      unitId: fixtureA.unitId,
      paymentPlanId: fixtureA.paymentPlanId,
      modalidad: "financiado",
    });

    expect(result.modalidad).toBe("financiado");
    if (result.modalidad !== "financiado") throw new Error("expected financiado arm");
    // Version is stamped by the engine (self-describing snapshot, D-13).
    expect(result.version).toBe(ENGINE_VERSION);
    // cuotas match the seeded plan; the first cuota carries an ARS value ("al valor del mes").
    expect(result.cuotas).toHaveLength(PLAN_CUOTAS);
    const firstCuota = result.cuotas[0];
    expect(firstCuota).toBeDefined();
    expect(typeof firstCuota?.ars).toBe("string");
    expect(firstCuota?.ars).not.toBeNull();
    // Max-período rule (D-07): the NEWER seeded período is the one the engine used.
    expect(result.cac).not.toBeNull();
    expect(result.cac?.periodo).toBe(CAC_PERIODO_NUEVO);
  });

  it("compute writes NO quotes row (D-01)", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const before = await countQuotes(orgA.orgId);
    await caller.quotes.compute({
      projectId: fixtureA.projectId,
      unitId: fixtureA.unitId,
      paymentPlanId: fixtureA.paymentPlanId,
      modalidad: "financiado",
    });
    const after = await countQuotes(orgA.orgId);
    expect(after).toBe(before);
  });

  it("create persists the versioned snapshot and it is readable via withTenant (QUOTE-02)", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const res = await caller.quotes.create({
      projectId: fixtureA.projectId,
      unitId: fixtureA.unitId,
      paymentPlanId: fixtureA.paymentPlanId,
      modalidad: "financiado",
    });

    expect(res.quoteId).toBeTruthy();
    expect(res.result.modalidad).toBe("financiado");

    // Read the persisted snapshot through the OWNER pool: envelope version 1, engine version on the
    // result, the max período recorded, and the resolved financiado price captured in inputs.
    const snapRows = await owner<
      {
        snapshot: {
          version: number;
          result: { version: number };
          cacPeriodo: string | null;
          inputs: { precioFinanciadoUsd: number };
        };
      }[]
    >`select snapshot from quotes where id = ${res.quoteId}`;
    expect(snapRows).toHaveLength(1);
    const snapshot = snapRows[0]?.snapshot;
    expect(snapshot).toBeDefined();
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.result.version).toBe(ENGINE_VERSION);
    expect(snapshot?.cacPeriodo).toBe(CAC_PERIODO_NUEVO);
    expect(snapshot?.inputs.precioFinanciadoUsd).toBe(PRECIO_FINANCIADO_USD);

    // The row is visible through the app pool scoped to the org (the tenant path the panel uses).
    const tenantRows = await withTenant(orgA.orgId, (tx) =>
      tx.select().from(schema.quotes).where(eq(schema.quotes.id, res.quoteId)),
    );
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]?.organizationId).toBe(orgA.orgId);
  });

  it("contado compute returns the seeded contado price", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const result = await caller.quotes.compute({
      projectId: fixtureA.projectId,
      unitId: fixtureA.unitId,
      paymentPlanId: fixtureA.paymentPlanId,
      modalidad: "contado",
    });

    expect(result.modalidad).toBe("contado");
    if (result.modalidad !== "contado") throw new Error("expected contado arm");
    expect(result.precioUsd).toBe(PRECIO_CONTADO_USD);
  });
});

// Capture a rejected promise's error for property inspection (typed codes / driver SQLSTATE).
// We assert ONLY on typed/machine-readable fields — never on stack traces or internal messages.
async function captureRejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, but it resolved");
}

// Extract the Postgres SQLSTATE from a rejection. Drizzle wraps the driver error in a
// DrizzleQueryError whose `cause` is the postgres.js PostgresError carrying `.code` (the SQLSTATE,
// e.g. "42501" permission denied). Read the code off the error or its cause, so the probe is
// robust to Drizzle's wrapping.
function postgresSqlState(err: unknown): string | undefined {
  const top = err as { code?: string; cause?: { code?: string } } | null;
  return top?.code ?? top?.cause?.code;
}

describe("quotes error surface + tenant privacy (QUOTE-01 negatives, D-08 / Pitfall 5)", () => {
  it("borrador project → NOT_FOUND (anon cannot resolve an unpublished project)", async () => {
    const caller = await createCaller({ headers: new Headers() });
    await expect(
      caller.quotes.compute({
        projectId: borradorProjectId,
        unitId: randomUUID(),
        paymentPlanId: randomUUID(),
        modalidad: "financiado",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("org without CAC → PRECONDITION_FAILED (never an unhandled 500)", async () => {
    const caller = await createCaller({ headers: new Headers() });
    await expect(
      caller.quotes.compute({
        projectId: fixtureB.projectId,
        unitId: fixtureB.unitId,
        paymentPlanId: fixtureB.paymentPlanId,
        modalidad: "financiado",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("degenerate plan → BAD_REQUEST carrying the machine-readable engine code", async () => {
    const caller = await createCaller({ headers: new Headers() });
    const err = (await captureRejection(() =>
      caller.quotes.compute({
        projectId: fixtureA.projectId,
        unitId: fixtureA.unitId,
        paymentPlanId: degeneratePlanId,
        modalidad: "financiado",
      }),
    )) as { code?: string; cause?: unknown };

    expect(err.code).toBe("BAD_REQUEST");
    // The errorFormatter surfaces this over the wire as data.quoteErrorCode; with createCaller the
    // raw TRPCError is thrown, so its `cause` is the original typed QuoteError.
    expect(err.cause).toBeInstanceOf(QuoteError);
    expect((err.cause as QuoteError).code).toBe("ANTICIPO_PCT_FUERA_DE_RANGO");
  });

  it("cac_index stays anon-invisible: an anon SELECT raises Postgres 42501", async () => {
    const err = await captureRejection(() =>
      withAnon((tx) => tx.select().from(schema.cacIndex)),
    );
    expect(postgresSqlState(err)).toBe("42501");
  });

  it("quotes stays anon-unwritable: an anon INSERT raises Postgres 42501", async () => {
    const err = await captureRejection(() =>
      withAnon((tx) =>
        tx.insert(schema.quotes).values({
          organizationId: orgA.orgId,
          projectId: fixtureA.projectId,
          unitId: fixtureA.unitId,
          paymentPlanId: fixtureA.paymentPlanId,
          snapshot: { version: 1 as const },
        }),
      ),
    );
    expect(postgresSqlState(err)).toBe("42501");
  });
});
