// media router integration tests (MEDIA-01) — proven through the tRPC caller against the live
// Postgres `_test` DB (the SAME unprivileged app path the panel uses), with R2 + BullMQ
// MOCKED. No real R2 or Redis is required (plan prohibition): vi.mock replaces the entire
// media/runtime module so presignPut returns a fake URL, headOriginal resolves, and
// enqueueMedia is a spy. The org/member rows are minted by the REAL auth runtime
// (makeUserWithActiveOrg); the project is seeded by the owner SQL client (no project editor
// yet). The createUpload INSERT goes through withTenant → app_authenticated → media_tenant.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createCaller } from "../src";
import { makeUserWithActiveOrg, type SessionFixture } from "./fixtures";
import { ownerSql } from "./db";

// Hoisted mock fns (vi.mock is hoisted above imports — the factory may only close over
// hoisted bindings). presignPut returns a deterministic fake URL keyed by the R2 key so the
// test can assert the server-derived key; headOriginal/enqueueMedia are configurable spies.
const { presignPutMock, headOriginalMock, enqueueMediaMock } = vi.hoisted(() => ({
  presignPutMock: vi.fn(),
  headOriginalMock: vi.fn(),
  enqueueMediaMock: vi.fn(),
}));

vi.mock("../src/media/runtime", () => ({
  r2Bucket: () => "test-bucket",
  presignPut: presignPutMock,
  headOriginal: headOriginalMock,
  enqueueMedia: enqueueMediaMock,
}));

const owner = ownerSql();

// Seed a project for an org through the OWNER pool (mirrors trpc-tenant.test.ts).
async function seedProject(orgId: string): Promise<string> {
  const id = randomUUID();
  const slug = `proj-${randomUUID().slice(0, 8)}`;
  await owner`
    insert into projects (id, organization_id, nombre, slug, estado)
    values (${id}, ${orgId}, ${`P ${slug}`}, ${slug}, ${"borrador"})
  `;
  return id;
}

let orgA: SessionFixture;
let projectId: string;

beforeAll(async () => {
  orgA = await makeUserWithActiveOrg();
  projectId = await seedProject(orgA.orgId);
}, 60_000);

beforeEach(() => {
  presignPutMock.mockReset();
  headOriginalMock.mockReset();
  enqueueMediaMock.mockReset();
  // Default happy-path implementations.
  presignPutMock.mockImplementation((key: string) =>
    Promise.resolve(`https://fake-r2.example/put/${key}`),
  );
  headOriginalMock.mockResolvedValue(true);
  enqueueMediaMock.mockResolvedValue(undefined);
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

describe("media.createUpload (MEDIA-01)", () => {
  it("inserts a media row for the caller's org and returns the presigned putUrl", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const res = await caller.media.createUpload({
      projectId,
      contentType: "image/jpeg",
      size: 12_345,
    });

    expect(res.mediaId).toBeTruthy();
    expect(res.putUrl).toBe(
      `https://fake-r2.example/put/${`originals/${orgA.orgId}/${projectId}/${res.mediaId}.jpg`}`,
    );

    // The row landed in the correct org (queried by the owner client, outside RLS).
    const rows = await owner<
      { id: string; organization_id: string; project_id: string; original_key: string }[]
    >`
      select id, organization_id, project_id, original_key from media where id = ${res.mediaId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organization_id).toBe(orgA.orgId);
    expect(rows[0]?.project_id).toBe(projectId);
    // The original_key is SERVER-DERIVED from the mediaId (never client-supplied).
    expect(rows[0]?.original_key).toBe(
      `originals/${orgA.orgId}/${projectId}/${res.mediaId}.jpg`,
    );
    expect(rows[0]?.original_key).toContain(res.mediaId);
  });

  it("rejects a non-allowlisted content-type (SVG → XSS/SSRF vector)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    await expect(
      caller.media.createUpload({
        projectId,
        // @ts-expect-error — image/svg+xml is intentionally outside the z.enum allowlist.
        contentType: "image/svg+xml",
        size: 1024,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("media.confirmUpload (MEDIA-01)", () => {
  it("HeadObjects the original then enqueues with the server-derived payload", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const created = await caller.media.createUpload({
      projectId,
      contentType: "image/png",
      size: 9_999,
    });

    const res = await caller.media.confirmUpload({ mediaId: created.mediaId });
    expect(res).toEqual({ enqueued: true });

    const expectedKey = `originals/${orgA.orgId}/${projectId}/${created.mediaId}.png`;
    expect(headOriginalMock).toHaveBeenCalledWith(expectedKey);
    expect(enqueueMediaMock).toHaveBeenCalledTimes(1);
    expect(enqueueMediaMock).toHaveBeenCalledWith({
      mediaId: created.mediaId,
      organizationId: orgA.orgId,
      projectId,
      originalKey: expectedKey,
    });
  });

  it("does NOT enqueue when HeadObject reports the bytes are missing (no orphan job)", async () => {
    const caller = await createCaller({ headers: orgA.headers });
    const created = await caller.media.createUpload({
      projectId,
      contentType: "image/webp",
      size: 4_096,
    });

    headOriginalMock.mockResolvedValueOnce(false);
    await expect(
      caller.media.confirmUpload({ mediaId: created.mediaId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(enqueueMediaMock).not.toHaveBeenCalled();
  });
});
