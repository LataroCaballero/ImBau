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
import { organization, projects, member, user } from "../src/schema";

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

// Insert a `member` row for `orgId`. Creates a `user` first when userId is not supplied so
// the member.user_id FK holds. Returns the member id. (member is a tenant table — D-02/D-10.)
export async function makeMember(
  orgId: string,
  userId?: string,
): Promise<string> {
  const db = ownerDb().db;
  let uid = userId;
  if (!uid) {
    uid = randomUUID();
    await db.insert(user).values({
      id: uid,
      name: `User ${uid.slice(0, 8)}`,
      email: `user-${uid}@example.test`,
    });
  }
  const id = randomUUID();
  await db.insert(member).values({
    id,
    organizationId: orgId,
    userId: uid,
    role: "member",
    createdAt: new Date(),
  });
  return id;
}
