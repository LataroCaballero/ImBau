import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import type { Job } from "bullmq";
import type { MediaJobData } from "@imbau/storage";

// Integration tests for MEDIA-04 against REAL Postgres 16 (the media-store withTenant write-back)
// with a MOCK in-memory S3 (media-runtime). They PROVE the three guarantees:
//   (1) idempotency       — two processMedia runs → ONE row, an IDENTICAL variants map, the SAME
//                           variant keys (deterministic variantKey overwrites in place).
//   (2) recoverability    — a failure (putVariant throws) → processMedia rejects and the row stays
//                           variants={} (A1: never a partial map); a clean rerun populates it.
//   (3) role-guard (A8)   — withTenant runs as app_authenticated (rolsuper/rolbypassrls=false), and
//                           a FOREIGN-org job writes NOTHING (RLS default-deny → variants stays {}),
//                           proving the write-back is NOT an owner/BYPASSRLS escape.
//
// NO real R2 and NO Redis: only media-runtime is mocked (in-memory Map), so the suite needs solely
// the local/CI Postgres `_test` DB (migrate + role guard run in tests/setup.ts globalSetup).

// In-memory mock S3 for the worker's R2 seam. putVariant records key→buffer; getOriginal returns
// a synthetic image. Tests flip these to throw to exercise recoverability.
const r2 = new Map<string, Buffer>();
const getOriginalMock = vi.fn<(key: string) => Promise<Buffer>>();
const putVariantMock =
  vi.fn<(key: string, body: Buffer, contentType: string) => Promise<void>>();

vi.mock("../src/media-runtime", () => ({
  getOriginal: (key: string) => getOriginalMock(key),
  putVariant: (key: string, body: Buffer, contentType: string) =>
    putVariantMock(key, body, contentType),
  R2_BUCKET: "test-bucket",
}));

// Import AFTER the mock declaration. processMedia uses the mocked media-runtime but the REAL
// media-store (withTenant → app_authenticated against PG16).
import { processMedia } from "../src/media";
import { withTenant } from "@imbau/db";
import {
  makeOrg,
  makeProject,
  makeMedia,
  getMediaById,
  countMediaById,
  closeFixtures,
} from "./helpers";

async function makeImage(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
}

function makeJob(data: MediaJobData): Job<MediaJobData> {
  // Only `data` is read by processMedia; cast the minimal shape to the BullMQ Job type.
  return { data } as Job<MediaJobData>;
}

let image: Buffer;

beforeAll(async () => {
  image = await makeImage();
});

beforeEach(() => {
  r2.clear();
  getOriginalMock.mockReset();
  putVariantMock.mockReset();
  getOriginalMock.mockImplementation(() => Promise.resolve(image));
  putVariantMock.mockImplementation((key: string, body: Buffer) => {
    r2.set(key, body);
    return Promise.resolve();
  });
});

afterAll(async () => {
  await closeFixtures();
});

describe("processMedia integration (PG16 real + mock S3)", () => {
  it("idempotency: two runs → one row, identical variants map and identical keys", async () => {
    const org = await makeOrg();
    const proj = await makeProject(org, "publicado");
    const mediaId = await makeMedia(org, proj);
    const job = makeJob({
      mediaId,
      organizationId: org,
      projectId: proj,
      originalKey: `originals/${org}/${proj}/${mediaId}.png`,
    });

    await processMedia(job);
    const row1 = await getMediaById(mediaId);
    const keys1 = [...r2.keys()].sort();

    await processMedia(job);
    const row2 = await getMediaById(mediaId);
    const keys2 = [...r2.keys()].sort();

    // exactly ONE row — processMedia only UPDATEs, never duplicates.
    expect(await countMediaById(mediaId)).toBe(1);
    // identical variants map across runs (deterministic keys → overwrite, no growth).
    expect(row1?.variants).toEqual(row2?.variants);
    expect(Object.keys(row2?.variants ?? {}).length).toBeGreaterThan(0);
    // identical R2 key set across runs.
    expect(keys2).toEqual(keys1);
    // the persisted map points at exactly the uploaded keys.
    expect(Object.values(row2?.variants ?? {}).sort()).toEqual(keys2);
  });

  it("recoverability: a failure leaves variants={}, a clean rerun populates them", async () => {
    const org = await makeOrg();
    const proj = await makeProject(org, "publicado");
    const mediaId = await makeMedia(org, proj);
    const job = makeJob({
      mediaId,
      organizationId: org,
      projectId: proj,
      originalKey: `originals/${org}/${proj}/${mediaId}.png`,
    });

    // Inject a failure on the FIRST variant upload — processMedia must reject BEFORE writeVariants.
    putVariantMock.mockImplementationOnce(() =>
      Promise.reject(new Error("R2 PutObject failed")),
    );
    await expect(processMedia(job)).rejects.toThrow(/R2 PutObject failed/);

    // The row is left in the recoverable pre-processing state — NEVER a partial map (A1).
    const failed = await getMediaById(mediaId);
    expect(failed?.variants).toEqual({});
    expect(failed?.blurhash).toBeNull();
    expect(failed?.width).toBeNull();
    expect(failed?.height).toBeNull();

    // A clean rerun (default mock) succeeds and populates the complete map + blurhash + dims.
    await processMedia(job);
    const ok = await getMediaById(mediaId);
    expect(Object.keys(ok?.variants ?? {}).length).toBeGreaterThan(0);
    expect(ok?.blurhash).toBeTruthy();
    expect(ok?.width).toBe(800);
    expect(ok?.height).toBe(600);
  });

  it("role-guard (A8): withTenant runs as app_authenticated; a foreign-org job writes nothing", async () => {
    const org = await makeOrg();
    const proj = await makeProject(org, "publicado");
    const mediaId = await makeMedia(org, proj);

    // (a) the write path runs as app_authenticated with rolsuper/rolbypassrls=false (NOT owner).
    const guard = await withTenant(org, async (tx) => {
      const who = await tx.execute<{ current_user: string }>(
        sql`select current_user`,
      );
      const attrs = await tx.execute<{
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
      return {
        user: who[0]?.current_user,
        rolsuper: attrs[0]?.rolsuper,
        rolbypassrls: attrs[0]?.rolbypassrls,
      };
    });
    expect(guard.user).toBe("app_authenticated");
    expect(guard.rolsuper).toBe(false);
    expect(guard.rolbypassrls).toBe(false);

    // (b) a job whose organizationId is a DIFFERENT org cannot write the row: the withTenant
    // UPDATE is scoped to the foreign org's GUC, so media_tenant's USING filter matches 0 rows
    // (default-deny) and nothing is persisted — proving the write is NOT an owner escape.
    const otherOrg = await makeOrg();
    const foreignJob = makeJob({
      mediaId,
      organizationId: otherOrg,
      projectId: proj,
      originalKey: `originals/${org}/${proj}/${mediaId}.png`,
    });
    await processMedia(foreignJob);

    const row = await getMediaById(mediaId);
    expect(row?.variants).toEqual({});
    expect(row?.blurhash).toBeNull();
  });
});
