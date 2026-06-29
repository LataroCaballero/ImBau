// Test fixtures — seed fresh tenant data via the OWNER connection (D-08 / D-12).
//
// Seeding runs as the OWNER (which can bypass policies for setup) — that is intentional and
// correct: only the ASSERTIONS in the test file run as the unprivileged app/anon role. Every
// fixture uses unique ids/slugs (crypto.randomUUID) so tests never collide and need no
// per-test rollback (D-08). makeMember exists because `member` is the SECOND tenant table
// this phase (D-02/D-10) — the absence gate must have org-A and org-B `member` rows to prove
// isolation over, not just `projects`.
import { randomUUID } from "node:crypto";
import { connectAs, ownerUrl } from "./db";
import {
  organization,
  projects,
  member,
  user,
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

// A single owner connection shared across all fixtures in the run (opened lazily).
let owner: ReturnType<typeof connectAs> | undefined;
function ownerDb() {
  owner ??= connectAs(ownerUrl());
  return owner;
}

// Close the shared owner connection — call from an afterAll so the process can exit cleanly.
export async function closeFixtures(): Promise<void> {
  if (owner) {
    await owner.sql.end({ timeout: 5 });
    owner = undefined;
  }
}

export type Estado = "borrador" | "publicado" | "archivado";

// Insert a fresh organization (unique id + slug) via the owner; returns its id.
export async function makeOrg(): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(organization)
    .values({
      id,
      name: `Org ${id.slice(0, 8)}`,
      slug: `org-${id}`,
      createdAt: new Date(),
    });
  return id;
}

// Insert a projects row for `orgId` in the given estado (unique id + slug); returns its id.
export async function makeProject(
  orgId: string,
  estado: Estado,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(projects)
    .values({
      id,
      organizationId: orgId,
      nombre: `Proyecto ${id.slice(0, 8)}`,
      slug: `proj-${id}`,
      estado,
    });
  return id;
}

// Insert a fresh `user` (unique id + email) via the owner; returns its id. Exposed so the
// cross-tenant write test (WR-01) can seed a VALID member.user_id FK and thereby prove the
// member INSERT is rejected by RLS `withCheck`, not by the FK constraint firing first.
export async function makeUser(): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(user)
    .values({
      id,
      name: `User ${id.slice(0, 8)}`,
      email: `user-${id}@example.test`,
    });
  return id;
}

// Insert a `member` row for `orgId`. Creates a `user` first when userId is not supplied so
// the member.user_id FK holds. Returns the member id. (member is a tenant table — D-02/D-10.)
export async function makeMember(
  orgId: string,
  userId?: string,
): Promise<string> {
  const uid = userId ?? (await makeUser());
  const id = randomUUID();
  await ownerDb()
    .db.insert(member)
    .values({
      id,
      organizationId: orgId,
      userId: uid,
      role: "member",
      createdAt: new Date(),
    });
  return id;
}

// ──────────────────────────────────────────────────────────────────────────────────────────
// Domain-table fixtures (01-06 / SCHEMA-07/08). Each clones the makeProject style: insert via
// the OWNER connection (`ownerDb().db.insert`), a fresh `randomUUID()` id, and the parent FK
// column(s) set so the composite (id, organization_id) FKs are satisfied (D-02). Seeding runs
// as OWNER (setup only); ONLY the assertions in cross-tenant.test.ts run unprivileged. These
// give the absence/anon/events cases org-A and org-B rows of every new table to prove isolation
// over — not just `projects`/`member`. Money/measure columns use string|integer per D-14
// (numeric → string in the postgres-js driver; precio is integer USD whole units).

// floors — catalog. project-scoped; (project_id, organization_id) → projects (D-02).
export async function makeFloor(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(floors)
    .values({
      id,
      organizationId: orgId,
      projectId,
      // numero is a notNull integer with no UNIQUE — a large random keeps fixtures collision-free.
      numero: Math.floor(Math.random() * 1_000_000),
      nombre: `Floor ${id.slice(0, 8)}`,
    });
  return id;
}

// units — catalog. lives under a floor; pinned to projects AND floors by composite FKs (D-02).
export async function makeUnit(
  orgId: string,
  projectId: string,
  floorId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(units)
    .values({
      id,
      organizationId: orgId,
      projectId,
      floorId,
      identificador: `U-${id.slice(0, 8)}`,
    });
  return id;
}

// price_lists — pricing. project-scoped; exposes UNIQUE(id, organization_id) for unit_prices.
export async function makePriceList(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(priceLists)
    .values({
      id,
      organizationId: orgId,
      projectId,
      nombre: `Lista ${id.slice(0, 8)}`,
      moneda: "USD",
    });
  return id;
}

// unit_prices — pricing. ties a unit to a price_list; three composite FKs share organization_id.
// precio is an integer (USD whole units, D-14); vigencia is a tz timestamp (Date).
export async function makeUnitPrice(
  orgId: string,
  projectId: string,
  unitId: string,
  priceListId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(unitPrices)
    .values({
      id,
      organizationId: orgId,
      projectId,
      unitId,
      priceListId,
      precio: 100_000,
      vigencia: new Date(),
    });
  return id;
}

// payment_plans — pricing. project-scoped; anticipoPct is numeric (string in the driver, D-14).
export async function makePaymentPlan(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(paymentPlans)
    .values({
      id,
      organizationId: orgId,
      projectId,
      nombre: `Plan ${id.slice(0, 8)}`,
      anticipoPct: "30",
      cuotas: 12,
      ajuste: "CAC",
    });
  return id;
}

// cac_index — ORG-SCOPED tenant-private (no project_id). UNIQUE(organization_id, periodo) → a
// unique periodo per call keeps fixtures collision-free. valor is numeric (string, D-14).
export async function makeCacIndex(orgId: string): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(cacIndex)
    .values({
      id,
      organizationId: orgId,
      periodo: `P-${id.slice(0, 18)}`,
      valor: "1234.5678",
    });
  return id;
}

// quotes — TENANT-PRIVATE quoting row. snapshot is the versioned envelope { version: 1 } (D-13).
export async function makeQuote(
  orgId: string,
  projectId: string,
  unitId: string,
  paymentPlanId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(quotes)
    .values({
      id,
      organizationId: orgId,
      projectId,
      unitId,
      paymentPlanId,
      snapshot: { version: 1 },
    });
  return id;
}

// brokers — capture catalog. project-scoped; exposes UNIQUE(id, organization_id) for leads.
export async function makeBroker(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(brokers)
    .values({
      id,
      organizationId: orgId,
      projectId,
      nombre: `Broker ${id.slice(0, 8)}`,
      slug: `broker-${id}`,
    });
  return id;
}

// leads — public capture table. estado defaults 'nuevo'; timeline defaults []. Seeded via OWNER
// so the absence/no-anon-SELECT cases have rows to assert ZERO of from the other org / as anon.
export async function makeLead(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(leads)
    .values({
      id,
      organizationId: orgId,
      projectId,
      nombre: `Lead ${id.slice(0, 8)}`,
      contacto: `contacto-${id.slice(0, 8)}`,
    });
  return id;
}

// progress_posts — obra/avance content. project-scoped; fecha is a tz timestamp (Date).
export async function makeProgressPost(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(progressPosts)
    .values({
      id,
      organizationId: orgId,
      projectId,
      fecha: new Date(),
      titulo: `Avance ${id.slice(0, 8)}`,
    });
  return id;
}

// galleries — content. project-scoped; seccion uses the galeria_seccion enum.
export async function makeGallery(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(galleries)
    .values({
      id,
      organizationId: orgId,
      projectId,
      seccion: "amenities",
    });
  return id;
}

// media — asset table. project-scoped; originalKey is the R2 storage key (notNull).
export async function makeMedia(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(media)
    .values({
      id,
      organizationId: orgId,
      projectId,
      originalKey: `r2/${id}.jpg`,
    });
  return id;
}

// events — partitioned analytics table. `ts` defaults to now() so an INSERT lands in the current
// month; the optional `ts` override lets the DEFAULT-partition routing case pass a far-future ts.
export async function makeEvent(
  orgId: string,
  projectId: string,
  ts?: Date,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(events)
    .values({
      id,
      organizationId: orgId,
      projectId,
      tipo: "view",
      ...(ts ? { ts } : {}),
    });
  return id;
}
