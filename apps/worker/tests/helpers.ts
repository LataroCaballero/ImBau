// Worker integration-test fixtures (MEDIA-04) — seed fresh tenant data via the OWNER connection,
// mirroring the three fixtures packages/db/tests/helpers.ts exposes that the media pipeline needs
// (makeOrg / makeProject / makeMedia). The worker cannot import those helpers (they are not an
// exported surface of @imbau/db), so the minimal trio is replicated here.
//
// Seeding runs as the OWNER (which bypasses policies for setup) — that is intentional and correct:
// ONLY the assertions/writes under test run as the unprivileged app role (the media pipeline's
// withTenant write-back). Every fixture uses a fresh randomUUID id/slug so tests never collide.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createOwnerDb, schema } from "@imbau/db";
import { ownerUrl } from "./db";

export type Estado = "borrador" | "publicado" | "archivado";

// A single owner connection shared across all fixtures + read-backs in the run (opened lazily).
let owner: ReturnType<typeof createOwnerDb> | undefined;
function ownerDb() {
  owner ??= createOwnerDb(ownerUrl());
  return owner;
}

// Close the shared owner connection — call from an afterAll so the process can exit cleanly.
export async function closeFixtures(): Promise<void> {
  if (owner) {
    await owner.client.end({ timeout: 5 });
    owner = undefined;
  }
}

// Insert a fresh organization (unique id + slug) via the owner; returns its id.
export async function makeOrg(): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(schema.organization)
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
    .db.insert(schema.projects)
    .values({
      id,
      organizationId: orgId,
      nombre: `Proyecto ${id.slice(0, 8)}`,
      slug: `proj-${id}`,
      estado,
    });
  return id;
}

// Insert a media row (unprocessed: variants defaults to '{}', blurhash/width/height NULL) for the
// given org/project via the owner; returns its id. originalKey is a plausible R2 key.
export async function makeMedia(
  orgId: string,
  projectId: string,
): Promise<string> {
  const id = randomUUID();
  await ownerDb()
    .db.insert(schema.media)
    .values({
      id,
      organizationId: orgId,
      projectId,
      originalKey: `originals/${orgId}/${projectId}/${id}.png`,
    });
  return id;
}

// Read a media row back via the OWNER connection (bypasses RLS — this is verification, not the
// path under test). Returns undefined if absent.
export async function getMediaById(mediaId: string) {
  const rows = await ownerDb()
    .db.select()
    .from(schema.media)
    .where(eq(schema.media.id, mediaId));
  return rows[0];
}

// Count media rows for a given id (proves processMedia never INSERTs a duplicate — idempotency).
export async function countMediaById(mediaId: string): Promise<number> {
  const rows = await ownerDb()
    .db.select()
    .from(schema.media)
    .where(eq(schema.media.id, mediaId));
  return rows.length;
}
