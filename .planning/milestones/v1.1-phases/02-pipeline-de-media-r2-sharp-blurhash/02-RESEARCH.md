# Phase 2: Pipeline de media (R2 + sharp + blurhash) - Research

**Researched:** 2026-06-29
**Domain:** S3-compatible object storage (Cloudflare R2) + background image processing (sharp) + responsive variant/LQIP generation, wired into an existing multi-tenant RLS + BullMQ codebase
**Confidence:** HIGH (codebase grounding + npm-verified versions + Cloudflare official docs); MEDIUM on the few product-shaped parameter choices (breakpoint widths, quality, blurhash components) which are flagged in the Assumptions Log

> **No CONTEXT.md exists** — `/gsd-discuss-phase` was NOT run. Design intent below is derived from REQUIREMENTS.md (MEDIA-01..05), ROADMAP.md Phase 2, CLAUDE.md, and direct codebase inspection. Every choice that a discuss step would normally lock is tagged `[ASSUMED]` and collected in the Assumptions Log for the planner / a future discuss pass to confirm.

## Summary

This phase turns the already-shipped `media` table (Phase 1 / SCHEMA-05) into a working end-to-end pipeline: an image lands in Cloudflare R2, the existing BullMQ worker processes it with sharp into AVIF/WebP srcset variants plus a blurhash LQIP placeholder, and a pure resolver maps a `media` row to a consumable variant set for both the anon web path and the authenticated panel path. The codebase is unusually well-prepared: the `media` schema (with `variants` jsonb, `width`, `height`, `blurhash` columns and both `media_tenant` + `media_anon_published` RLS policies) exists; the worker already wires BullMQ + ioredis with an idempotent repeatable-job pattern (`partitions.ts` via `upsertJobScheduler`); the tenant write-path helper `withTenant(orgId, fn)` is the sanctioned RLS-correct mutation seam; and Sentry + pino observability are live. The work is additive plumbing, not new infrastructure.

The three load-bearing design decisions are: (1) **how the worker writes variants back under RLS** — it must use the `app_authenticated` role + the transaction-scoped `app.current_organization_id` GUC via `withTenant`, which means the worker gains an `@imbau/db` dependency and a `DATABASE_APP_URL` env var (it currently has neither — it is a Redis-only shell); (2) **whether "processed" needs a new status column** — recommendation is **no new column for this phase**: model `processed = variants != '{}'` and persist `variants` + `blurhash` + `width`/`height` in a single final `UPDATE`, which makes a mid-job crash leave the row in its pre-processing state (recoverable, never half-written); (3) **the R2 checksum gotcha** — current `aws-sdk-js-v3` (≥ 3.729) defaults to CRC32 streaming checksums that R2 rejects, so the `S3Client` must set `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"`.

Idempotency and "never inconsistent" (MEDIA-04) fall out cleanly from two invariants: **deterministic R2 variant keys** (derived from `mediaId` + format + width, so a retry overwrites rather than duplicates) and a **single last-write `UPDATE`** of the whole `variants` map after all bytes are confirmed in R2. BullMQ `jobId = mediaId` deduplicates re-enqueues; `attempts` + exponential `backoff` handle transient R2/sharp failures; the worker's `failed` handler routes the error to Sentry + pino (never swallowed).

**Primary recommendation:** Three plans, mirroring the ROADMAP split. Plan 02-01 (MEDIA-01, MEDIA-05): add an `r2Env` preset + a shared `@imbau/storage`-style R2 client, a `media` tRPC router with a presigned-create / confirm-enqueue flow, and a **pure** `resolveMedia(row, { publicBaseUrl })` resolver in `@imbau/db`. Plan 02-02 (MEDIA-02, MEDIA-03): the worker media queue/worker + the sharp pipeline (download-once → buffer → per-variant AVIF/WebP at fixed widths → blurhash from raw pixels → single `withTenant` UPDATE). Plan 02-03 (MEDIA-04): idempotency/retry/observability hardening + the failure-injection and idempotency test suite. Pin `sharp@0.35.2`, `@aws-sdk/client-s3@3.x`, `@aws-sdk/s3-request-presigner@3.x`, `blurhash@2.0.5`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Upload intake + validation (content-type, size, project ownership) | API / Backend (`packages/api` tRPC) | — | Auth + tenant authority live only in the tRPC session→`activeOrgId` seam; never trust a client key. |
| Presigned PUT URL generation | API / Backend | CDN/Storage (R2) | Server signs a single-key, short-expiry URL; bytes flow client→R2 directly (keeps large renders off the API process). |
| Original byte storage | Database/Storage (R2) | — | R2 is the object store; the original key is recorded in `media.originalKey`. |
| `media` row insert + enqueue | API / Backend | Database (Postgres, RLS) | Row insert runs inside `withTenant` (RLS); enqueue is a Redis op after commit. |
| Variant generation (AVIF/WebP srcset) | Worker (`apps/worker` BullMQ) | Storage (R2) | CPU-heavy sharp work belongs off the request path, in the background worker. |
| blurhash + dimensions compute | Worker | — | Derived from the same decoded source as variants; persisted in the same UPDATE. |
| Variant persistence under tenant RLS | Worker → Database (Postgres) | — | Worker must write as `app_authenticated` + GUC (`withTenant`) — never owner/BYPASSRLS. |
| Resolve `media` → srcset/blurhash/dims | Shared pure helper (`@imbau/db`) | API + Browser (consumers) | Pure mapping function imported by both web (anon RSC) and panel (auth); no DB/Redis/env coupling. |
| Public URL serving of variants | CDN/Storage (R2 public bucket + custom domain) | Browser | Variants of published projects are effectively public; serve via a cacheable public bucket URL, not signed GETs. |

## Standard Stack

> Stack is **DECIDED** by CLAUDE.md — no alternatives proposed. The only genuinely new packages this phase are `sharp`, `@aws-sdk/client-s3` (+ presigner), and `blurhash`. CLAUDE.md already names `@aws-sdk/client-s3` and `sharp`; it does not pin a blurhash lib.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | `3.x` (latest `3.1076.0` [VERIFIED: npm view]) | S3-compatible client for R2: `PutObject`, `GetObject`, `HeadObject` | CLAUDE.md-mandated R2 access path; R2 is S3-API-compatible. First-party AWS package (github.com/aws/aws-sdk-js-v3, ~32M downloads/wk). |
| `@aws-sdk/s3-request-presigner` | `3.x` (matches client, `3.1076.0` [VERIFIED: npm view]) | `getSignedUrl()` for presigned PUT (MEDIA-01 upload) | The standard v3 presigning companion; same release train as the client. |
| `sharp` | `0.35.2` [VERIFIED: npm view] | Decode → resize → AVIF/WebP encode → raw pixels for blurhash + metadata for dims | CLAUDE.md-mandated; the de-facto Node image processor (libvips), ~65M downloads/wk (github.com/lovell/sharp). |
| `blurhash` | `2.0.5` [VERIFIED: npm view, OK legitimacy] | `encode()` LQIP placeholder string into `media.blurhash` (MEDIA-03) | Wolt's reference implementation (github.com/woltapp/blurhash), 1.2M downloads/wk, no postinstall. Pure TS. |

### Supporting (already present — reuse, do not re-add)
| Library | Version (installed) | Purpose | Reuse note |
|---------|---------|---------|-------------|
| `bullmq` | `5.78.1` | Media processing queue/worker | Already wired in `apps/worker/src/index.ts`; mirror the `partitions.ts` pattern. |
| `ioredis` | `5.10.1` | BullMQ Redis connection | `createConnection()` already builds it with `maxRetriesPerRequest: null`. |
| `postgres` (porsager) | `3.4.9` | Driver behind `withTenant`/Drizzle | Worker write-back goes through `@imbau/db`. |
| `drizzle-orm` | `0.45.2` | `media` schema + typed UPDATE | Schema already exists at `packages/db/src/schema/media.ts`. |
| `@sentry/node` | `10.61.0` | Failure capture in the worker | Initialized in `apps/worker/src/instrument.ts`; add explicit `captureException` in the `failed` handler. |
| `pino` via `@imbau/observability` | `10.3.1` | Structured job logs | `logger` already imported in the worker. |
| `@trpc/server` + `zod` | `11.17.0` / `4.4.3` | Upload/confirm endpoints + input validation | `packages/api` patterns: `projects.ts`, `init.ts` `protectedProcedure`. |

### Alternatives Considered (within the decided stack)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `blurhash` | `thumbhash` (`0.1.1`) | thumbhash produces smaller hashes with alpha + better gradients, but the `media.blurhash` column is named/typed for blurhash and CLAUDE.md/§3.3 say "blurhash". **Use blurhash** — changing to thumbhash is scope creep + a column rename. |
| Presigned PUT (client→R2) | Server-proxied `PutObject` through tRPC | Server-proxy is simpler to make atomic (put+insert+enqueue in one handler) but streams large render bytes through the API process. **Use presigned for the browser path; the Phase-3 seed (Node) will server-proxy via the same shared helper** — design the core so both share it. |
| R2 public bucket + custom domain | Presigned/signed GET per variant | Signed GETs keep variants private but are uncacheable and add latency. Variants of `publicado` projects are public content → **public bucket** is correct and CDN-cacheable (matches CLAUDE.md <3s/4G perf budget). |

**Installation (worker gains DB + storage deps):**
```bash
# apps/worker — sharp + R2 + blurhash + DB access for RLS write-back
pnpm --filter @imbau/worker add sharp@0.35.2 @aws-sdk/client-s3 blurhash@2.0.5 @imbau/db
# packages/api — presigned upload endpoints + R2 client
pnpm --filter @imbau/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
# (consider a small shared @imbau/storage package so api + worker share one R2 client factory)
```

**Version verification (run before pinning — latest moves fast):**
```bash
npm view sharp version                       # 0.35.2 (2026-06-27)
npm view @aws-sdk/client-s3 version          # 3.1076.0
npm view @aws-sdk/s3-request-presigner version
npm view blurhash version                    # 2.0.5
```
Pin a **specific** `@aws-sdk/*` version (not a floating `^3`) and keep `client-s3` + `s3-request-presigner` on the **same** version — they share internal `@smithy/*` interfaces. Note the R2 checksum behavior changed at `3.729` (see Pitfall 1).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `sharp` | npm | latest pub 2026-06-19 (pkg 8+ yrs) | ~65M/wk | github.com/lovell/sharp | SUS (`too-new`) | **Approved** — false positive: flagged only because the high-cadence latest release is recent. First-party libvips wrapper, no postinstall script reported. |
| `@aws-sdk/client-s3` | npm | latest pub 2026-06-29 (pkg years old) | ~32M/wk | github.com/aws/aws-sdk-js-v3 | SUS (`too-new`) | **Approved** — false positive: AWS publishes the SDK ~daily. First-party AWS. |
| `@aws-sdk/s3-request-presigner` | npm | latest pub 2026-06-29 | ~14.5M/wk | github.com/aws/aws-sdk-js-v3 | SUS (`too-new`) | **Approved** — same train as client-s3, first-party AWS. |
| `blurhash` | npm | pub 2023-02-17 | ~1.25M/wk | github.com/woltapp/blurhash | OK | **Approved** |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `sharp`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` — all `too-new` false positives driven by very high release cadence on massively-used first-party packages. **No `checkpoint:human-verify` needed**; the planner may pin a known-good slightly-older version (e.g. an `@aws-sdk/*` ≥ 3.729 with the checksum opt-out applied) to avoid bleeding-edge churn. This judgement is recorded so a reviewer can confirm.

## Architecture Patterns

### System Architecture Diagram

```
  ┌─────────────┐   1. media.createUpload (tRPC, protectedProcedure)
  │  Client /   │──────────────────────────────────────────────┐
  │  Panel /    │                                               ▼
  │  Phase-3    │                              ┌──────────────────────────────┐
  │  seed (Node)│                              │  packages/api  media router   │
  └─────────────┘                              │  • validate content-type/size │
        │  2. PUT bytes (presigned URL)        │  • derive originalKey(mediaId) │
        │     OR seed PutObject direct         │  • withTenant: INSERT media    │
        ▼                                      │      (variants={}, dims/hash   │
  ┌───────────────┐   <─ presigned PUT ──┐     │      NULL)                     │
  │ Cloudflare R2 │                      └─────│  • return {mediaId, putUrl}    │
  │  (bucket)     │                            └──────────────┬────────────────┘
  │  originals/…  │   3. media.confirmUpload    enqueue (jobId=mediaId,
  │  variants/…   │   (HeadObject verify) ──────▶ attempts/backoff)
  └───────┬───────┘                                           │
          │  GetObject(originalKey)                           ▼
          │                                  ┌────────────────────────────────┐
          │  4. download ONCE → Buffer       │  apps/worker  media queue       │
          ├─────────────────────────────────▶│  • sharp(buffer):               │
          │                                  │     ├─ per width → AVIF + WebP   │
          │  5. PutObject deterministic      │     │   (skip widths > original) │
          │     variant keys (overwrite)     │     ├─ raw 32px → blurhash.encode│
          │◀─────────────────────────────────│     └─ metadata → width/height  │
          │                                  │  • withTenant(orgId): single    │
          │                                  │     UPDATE media SET variants=…  │
          ▼                                  │     blurhash=…, width=…, height=…│
  ┌───────────────┐                          │  • on throw → BullMQ retry;      │
  │   Postgres    │◀─── UPDATE (RLS:          │     on final fail → Sentry+pino  │
  │   media row   │     app_authenticated     └────────────────────────────────┘
  │  variants jsonb│    + GUC org_id)
  └───────┬───────┘
          │  resolveMedia(row, {publicBaseUrl})  — PURE
          ▼
  ┌───────────────────────────────────────────────────────────┐
  │  Consumers (later phases — OUT OF SCOPE here):             │
  │   web (withAnon, published-only)  ·  panel (withTenant)    │
  │   { width, height, blurhash, sources:{avif[],webp[]},      │
  │     srcset, originalUrl }                                  │
  └───────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/config/env/presets.ts      # + r2Env preset (R2_ACCOUNT_ID, keys, bucket, public base)
packages/storage/  (NEW, optional)   # shared S3Client factory (api + worker import it)
  src/r2-client.ts                   #   makeR2Client() with checksum opt-out
  src/keys.ts                        #   pure: originalKey(), variantKey(mediaId,fmt,width)
packages/db/src/
  schema/media.ts                    # EXISTS — no change unless status-column decision flips
  resolve-media.ts        (NEW)      # PURE resolveMedia(row, {publicBaseUrl}) → variant set
  index.ts                           # export resolveMedia
packages/api/src/trpc/routers/
  media.ts                (NEW)      # createUpload (presign+insert) · confirmUpload (head+enqueue)
apps/worker/src/
  media.ts                (NEW)      # MEDIA_QUEUE, processMedia() executor (sharp + write-back)
  media-variants.ts       (NEW)      # PURE: pickWidths(), variant spec list, quality table
  index.ts                           # + media Queue/Worker wiring + failed handler
  env.ts                             # + DATABASE_APP_URL + r2Env (worker now touches Postgres+R2)
```

### Pattern 1: R2 S3Client with the checksum opt-out (load-bearing)
**What:** A single configured `S3Client` shared by api (presign) and worker (get/put). The checksum settings are mandatory for R2.
**When to use:** Every R2 access.
```typescript
// Source: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/ + aws-sdk-js-v3 issue #6893
import { S3Client } from "@aws-sdk/client-s3";

export function makeR2Client(env: {
  R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string;
}): S3Client {
  return new S3Client({
    region: "auto",                                   // required by SDK, ignored by R2
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // CRITICAL (aws-sdk-js-v3 >= 3.729): R2 rejects the default CRC32 streaming
    // trailer (STREAMING-UNSIGNED-PAYLOAD-TRAILER). Opt OUT or PutObject 400s.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
```

### Pattern 2: Presigned-create / confirm-enqueue (MEDIA-01, avoids orphans)
**What:** Two-phase upload that keeps tenant authority server-side and never enqueues processing for bytes that don't exist.
```typescript
// packages/api/src/trpc/routers/media.ts (sketch)
// createUpload: protectedProcedure (session → activeOrgId; client key NEVER trusted)
//   1. validate input: projectId, contentType ∈ allowlist, declared size ≤ MAX
//   2. mediaId = randomUUID(); originalKey = `originals/${activeOrgId}/${projectId}/${mediaId}.${ext}`
//   3. withTenant(activeOrgId, tx => tx.insert(media).values({ id: mediaId, organizationId,
//        projectId, originalKey }))   // variants={} default; width/height/blurhash NULL
//   4. putUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket, Key: originalKey,
//        ContentType: contentType }), { expiresIn: 3600 })
//   5. return { mediaId, putUrl }
// confirmUpload: protectedProcedure
//   1. withTenant lookup media by id (RLS scopes to caller's org → can't confirm another org's)
//   2. HeadObject(originalKey) — verify bytes landed (size/contentType sanity)
//   3. enqueue: mediaQueue.add("process", { mediaId, organizationId, projectId, originalKey },
//        { jobId: mediaId, attempts: 5, backoff: { type: "exponential", delay: 2000 } })
```
**Seed path (Phase 3, Node):** skip presign — `PutObject` the bytes directly, then call the same `insert + enqueue` core. Factor `registerAndEnqueue()` so the browser and seed paths converge.

### Pattern 3: Worker sharp pipeline — download once, single final write (MEDIA-02/03/04)
**What:** Decode the original once into a Buffer, fan out to variants + blurhash, then persist everything in ONE `withTenant` UPDATE so a crash never leaves a half-written row.
```typescript
// apps/worker/src/media.ts (sketch)
import sharp from "sharp";
import { encode as blurhashEncode } from "blurhash";
import { withTenant, schema } from "@imbau/db";
import { eq } from "drizzle-orm";

// guard against decompression bombs (ASVS V5 DoS)
sharp.cache(false);

export async function processMedia(job): Promise<void> {
  const { mediaId, organizationId, originalKey } = job.data;
  // 1. download original ONCE
  const obj = await r2.send(new GetObjectCommand({ Bucket, Key: originalKey }));
  const input = Buffer.from(await obj.Body.transformToByteArray());

  const base = sharp(input, { limitInputPixels: 268_402_689 }); // ~16k x 16k cap
  const meta = await base.metadata();
  const srcWidth = meta.width ?? 0, srcHeight = meta.height ?? 0;

  // 2. variants — skip widths larger than the source (never upscale)
  const widths = pickWidths(srcWidth);            // PURE (media-variants.ts)
  const variants: Record<string, string> = {};
  for (const w of widths) {
    for (const fmt of ["avif", "webp"] as const) {
      const buf = await sharp(input)               // fresh instance per encode
        .resize({ width: w, withoutEnlargement: true })
        [fmt](QUALITY[fmt])                         // avif {quality:50,effort:4}; webp {quality:80}
        .toBuffer();
      const key = variantKey(mediaId, fmt, w);      // PURE, deterministic → overwrite on retry
      await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: buf,
        ContentType: `image/${fmt}` }));
      variants[`${fmt}-${w}`] = key;
    }
  }

  // 3. blurhash from raw pixels (small)
  const { data, info } = await sharp(input)
    .raw().ensureAlpha().resize(32, 32, { fit: "inside" }).toBuffer({ resolveWithObject: true });
  const blurhash = blurhashEncode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);

  // 4. SINGLE atomic write under RLS (app_authenticated + GUC) — last-write wins on retry
  await withTenant(organizationId, (tx) =>
    tx.update(schema.media)
      .set({ variants, blurhash, width: srcWidth, height: srcHeight })
      .where(eq(schema.media.id, mediaId)));
}
```
**Why the single UPDATE matters:** `variants` jsonb is written exactly once, fully populated, after every R2 PutObject has succeeded. A crash before that UPDATE leaves `variants = '{}'` and `blurhash/width/height = NULL` — i.e. the original pre-processing state, which is *recoverable* and *re-runnable*. There is no DB representation of a "half-processed" row.

### Pattern 4: RLS-correct worker write-back (the tenancy decision)
**What:** The worker has no Better Auth session and no HTTP request, so it cannot derive the org from a session. It instead **receives `organizationId` in the job payload** (placed there by the authenticated enqueuer) and feeds it into `withTenant`, which sets the transaction-scoped `app.current_organization_id` GUC. The UPDATE then runs as `app_authenticated` and satisfies the existing `media_tenant` policy.
**Why not the owner role (like `partitions.ts`)?** `partitions.ts` runs DDL that only the owner may run. But `media_tenant` is `FOR ALL TO appAuthenticated` — there is **no policy granting the owner role write access**, and the table has RLS enabled. Writing as owner would be governed by RLS with no matching policy → default-deny (and using a BYPASSRLS/superuser role is explicitly forbidden by CLAUDE.md "What NOT to Use"). **The only correct path is `withTenant(organizationId, …)`** — which requires the worker to import `@imbau/db` and to carry `DATABASE_APP_URL` (new for the worker; currently it has only `REDIS_URL`).
```typescript
// from packages/db/src/with-tenant.ts (EXISTS — the sanctioned seam)
await tx.execute(sql`select set_config('app.current_organization_id', ${orgId}, true)`);
```

### Pattern 5: Pure resolver (MEDIA-05)
**What:** A side-effect-free function that maps a `media` row + a public base URL to a consumable shape. No DB, no Redis, no env read — the caller passes `publicBaseUrl` so the function stays pure and importable by both web and panel without cycles.
```typescript
// packages/db/src/resolve-media.ts  (PURE; exported from @imbau/db barrel)
export interface ResolvedMedia {
  width: number | null; height: number | null; blurhash: string | null;
  isReady: boolean;                              // variants non-empty
  originalUrl: string;
  sources: { avif: { width: number; url: string }[]; webp: { width: number; url: string }[] };
  srcset: { avif: string; webp: string };        // "<url> <w>w, …"
}
export function resolveMedia(
  row: { originalKey: string; variants: Record<string, string>; width: number | null;
         height: number | null; blurhash: string | null },
  opts: { publicBaseUrl: string },
): ResolvedMedia { /* parse "avif-1024" keys → {width,url}, build srcset strings */ }
```
**Home:** `@imbau/db`. It owns the `media` row type, web reads media via `withAnon` from `@imbau/db`, and `@imbau/api` already depends on `@imbau/db` — so no new dependency edges or cycles. (A standalone `@imbau/media` package is over-engineering for one pure function.)

### Anti-Patterns to Avoid
- **Re-decoding the original from R2 once per variant.** Download once → Buffer → reuse `sharp(input)` instances. Repeated GetObject is slow and costs egress.
- **Streaming the original through the API server for browser uploads.** Use presigned PUT; only the Node seed proxies bytes.
- **Writing `variants` incrementally (one UPDATE per variant).** Creates observable half-states and defeats the "never inconsistent" invariant. Accumulate in memory, write once.
- **Client-supplied R2 keys or org ids.** The server derives `originalKey` from `mediaId`; the org comes from the session (api) or the trusted job payload (worker).
- **Owner/BYPASSRLS connection for the write-back.** Forbidden by CLAUDE.md and breaks the RLS guarantee. Use `withTenant`.
- **Floating `^3` on `@aws-sdk/*` with mismatched client/presigner versions.** Pin both to the same exact version.
- **Accepting SVG into the pipeline.** SVG is an XSS/SSRF vector and not a raster format sharp should rasterize from untrusted input. Allowlist `image/jpeg|png|webp|avif` only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AVIF/WebP encoding + resize | Custom libvips/ffmpeg wrapper | `sharp` | Color profiles, EXIF orientation, AVIF effort tuning, memory bounds are all solved. |
| LQIP placeholder | Hand-rolled base64 tiny-JPEG | `blurhash.encode` | DCT-based, tiny string, decoders exist for web; column is already `blurhash`. |
| Presigned URL signing | Manual SigV4 HMAC | `@aws-sdk/s3-request-presigner` | SigV4 is easy to get subtly wrong; R2 expects correct canonical requests. |
| Job dedup / retry / backoff | Custom Redis SETNX + retry loop | BullMQ `jobId` + `attempts` + `backoff` | Already a dependency and already the worker's pattern (`partitions.ts`). |
| Tenant-scoped write | Manual `WHERE organization_id = …` + service role | `withTenant(orgId, fn)` | RLS does the filtering; the helper sets the GUC the policy reads. App-layer WHERE is defense-in-depth at best and bypass-prone at worst. |
| EXIF/orientation handling | Manual rotation math | `sharp(...).rotate()` (auto-orient) | sharp reads EXIF orientation and applies it; also strips metadata by default (privacy). |

**Key insight:** Almost every primitive this phase needs already exists in the repo (BullMQ idempotent-job pattern, `withTenant` RLS seam, Sentry+pino) or in a first-party library. The phase is composition, not invention — the risk is in the *seams* (R2 checksum config, worker RLS role, single-write invariant), not the algorithms.

## Runtime State Inventory

> This is an additive feature phase (no rename/refactor/migration of existing runtime state). Inventory included for completeness per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `media` rows from Phase-3 seed will reference R2 keys; no pre-existing media data to migrate (table is empty until seed). | None this phase — seed is Phase 3. |
| Live service config | **Cloudflare R2 bucket must exist** with: (a) an API token (access key/secret), (b) a public access binding (custom domain or `r2.dev`) for variant serving, (c) CORS allowing presigned PUT from the panel origin. This config lives in the Cloudflare dashboard, NOT in git. | **Human/infra step** — provision bucket + token + public domain + CORS before staging verification. Flag for the planner as a `checkpoint:human-verify`. |
| OS-registered state | None — worker runs in the existing container. | None. |
| Secrets/env vars | NEW: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`; the worker additionally needs `DATABASE_APP_URL` (it currently has none). All via SOPS/CI secrets, never hardcoded (CLAUDE.md / T-4-LOGLEAK). | Add `r2Env` preset to `packages/config/env/presets.ts`; compose it into `apps/worker/src/env.ts` and the api env. Add to `.env.example`. |
| Build artifacts | `sharp` ships a platform-specific native binary — the Docker image (Node 22 Alpine per CLAUDE.md) must build/install the correct `linux-x64`/`linux-arm64` libvips. | Verify `sharp` installs in the worker Docker stage (musl/glibc); may need `apk add vips` or sharp's prebuilt musl binary. Flag in plan 02-02. |

**Nothing found in category "OS-registered state":** None — verified, worker is a container process with no host registrations.

## Common Pitfalls

### Pitfall 1: R2 rejects PutObject with a checksum/SHA256 mismatch
**What goes wrong:** `aws-sdk-js-v3 ≥ 3.729` defaults `requestChecksumCalculation: "WHEN_SUPPORTED"`, adding a CRC32 streaming trailer (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`) R2 doesn't accept → `400` / `XAmzContentSHA256Mismatch` / `Bad digest`.
**Why it happens:** AWS changed default integrity behavior; R2 (and other S3-compatible stores) lag the new trailer format.
**How to avoid:** Set `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"` on the `S3Client` (Pattern 1), or pin `@aws-sdk/client-s3@3.726.1`. Prefer the config opt-out over pinning so you get other fixes. [CITED: github.com/aws/aws-sdk-js-v3 issue #6893; developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/]
**Warning signs:** PutObject 400s only against R2 while working against real S3; error mentions `x-amz-content-sha256` or `PAYLOAD-TRAILER`.

### Pitfall 2: Worker write-back silently denied (or worse, succeeds via a bypass role)
**What goes wrong:** The worker's UPDATE either updates 0 rows (RLS default-deny, no GUC set) or appears to work because someone used the owner/superuser URL — which CLAUDE.md forbids and which would mask a real tenancy bug.
**Why it happens:** `media_tenant` policy reads `current_setting('app.current_organization_id', true)`; if the GUC isn't set, the predicate is NULL→false and the row is invisible to the UPDATE. The worker has no session to derive the org from.
**How to avoid:** Pass `organizationId` in the job payload and wrap the UPDATE in `withTenant(organizationId, …)` (Pattern 4). Add `DATABASE_APP_URL` to the worker env. Never use `DATABASE_URL` (owner) for the write-back. A test must assert the write happens as `app_authenticated` (reuse the role-guard idea from `packages/db/tests/setup.ts`).
**Warning signs:** UPDATE returns rowCount 0 but no error; tests pass only when run as owner.

### Pitfall 3: `sharp` native binary missing in the worker container
**What goes wrong:** Worker boots in dev (macOS arm64 binary) but crashes in the Alpine/musl Docker image with `Could not load the "sharp" module using the linux-musl-x64 runtime`.
**Why it happens:** sharp resolves a platform+libc-specific prebuilt binary at install; the build platform ≠ runtime platform, or musl prebuilds weren't fetched.
**How to avoid:** Ensure the worker's Docker build installs sharp for the runtime platform (Node 22 Alpine = musl). With pnpm + `turbo prune`, the install/build stage must run on the target arch or fetch the musl prebuild; if issues persist, install libvips (`apk add vips`) and let sharp build, or use a glibc base. Add a worker boot smoke that calls `sharp(<1px>).metadata()`.
**Warning signs:** Works locally, fails at container start with a sharp module-load error.

### Pitfall 4: Dangling `media` rows (presigned upload never confirmed)
**What goes wrong:** `createUpload` inserts the row + returns a presigned URL, but the client never PUTs or never calls `confirmUpload` → a `media` row with `variants={}` and no R2 object.
**Why it happens:** Presigned PUT decouples row creation from byte arrival; you can't transactionally bind a Redis enqueue + an external R2 object to a Postgres insert.
**How to avoid:** (a) `confirmUpload` does a `HeadObject` before enqueueing — no object, no job. (b) The resolver treats `variants={}` / `width=NULL` as `isReady:false` (renders blurhash/skeleton, not a broken `<img>`). (c) Dangling-row GC (sweep rows older than N hours with empty variants and no R2 object) is **out of scope** — note it as a future cleanup. Accept dangling rows as benign for the MVP.
**Warning signs:** `media` rows that never gain variants; R2 keys referenced that 404.

### Pitfall 5: Non-idempotent retries duplicating variants or rows
**What goes wrong:** A retried job writes variants under new random keys, or a re-enqueue creates a second job, leaving stale orphan objects or racing UPDATEs.
**Why it happens:** Random variant keys + re-enqueue without dedup.
**How to avoid:** **Deterministic variant keys** `variants/{orgId}/{projectId}/{mediaId}/{width}.{fmt}` (a retry overwrites the same R2 object). **`jobId = mediaId`** so BullMQ dedups re-enqueues. The single final UPDATE is naturally idempotent (last-write-wins with identical content). No new `media` rows are ever created by the worker — it only UPDATEs.
**Warning signs:** Growing R2 object count for the same media; duplicate jobs in BullMQ for one mediaId.

### Pitfall 6: Memory blowup on large architectural renders
**What goes wrong:** A 60-megapixel render decoded + several variant buffers held simultaneously OOMs the worker.
**Why it happens:** Holding the source Buffer + N variant Buffers + raw blurhash pixels at once; unbounded input.
**How to avoid:** Cap input at upload (declared size) and at decode (`limitInputPixels`). Process variants **sequentially** (loop, not `Promise.all` of all encodes) so at most one encode buffer is live. `sharp.cache(false)` to bound the libvips cache. blurhash uses a 32×32 raw buffer (tiny).
**Warning signs:** Worker RSS spikes per job; OOM kills under concurrency.

## Code Examples

### Pure width selection (never upscale) — `media-variants.ts`
```typescript
// PURE, unit-testable with no infra
const BREAKPOINTS = [384, 640, 768, 1024, 1366, 1920, 2560] as const; // [ASSUMED] product-tunable
export function pickWidths(srcWidth: number): number[] {
  if (srcWidth <= 0) return [];
  const usable = BREAKPOINTS.filter((w) => w < srcWidth);
  // always include the source width itself (clamped to the largest breakpoint set) so the
  // largest variant matches the original; dedupe + sort.
  return [...new Set([...usable, Math.min(srcWidth, BREAKPOINTS[BREAKPOINTS.length - 1])])]
    .sort((a, b) => a - b);
}
export const QUALITY = {
  avif: { quality: 50, effort: 4 },   // [ASSUMED] good size/quality for renders; tune in QA
  webp: { quality: 80 },              // [ASSUMED]
} as const;
```

### Deterministic key derivation — `keys.ts`
```typescript
// PURE — server-owned key shapes (never client-supplied)
export const originalKey = (orgId: string, projectId: string, mediaId: string, ext: string) =>
  `originals/${orgId}/${projectId}/${mediaId}.${ext}`;
export const variantKey = (mediaId: string, fmt: "avif" | "webp", width: number) =>
  `variants/${mediaId}/${width}.${fmt}`;
```

### Worker `failed` handler — never swallow (MEDIA-04)
```typescript
// apps/worker/src/index.ts — alongside the existing worker wiring
import * as Sentry from "@sentry/node";
const mediaWorker = new Worker(MEDIA_QUEUE, (job) => processMedia(job), {
  connection, concurrency: 2,
});
mediaWorker.on("failed", (job, err) => {
  Sentry.captureException(err, { extra: { mediaId: job?.data?.mediaId, attempts: job?.attemptsMade } });
  logger.error({ err, mediaId: job?.data?.mediaId, queue: MEDIA_QUEUE }, "media job failed");
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| On-the-fly image transform service / Next `<Image>` optimizer | Pre-generate AVIF+WebP srcset at upload, serve static from R2+CDN | Standard for multi-tenant SaaS with a CDN | Cheaper, cacheable, predictable; matches CLAUDE.md "Photo Sphere Viewer / static renders, no game engine" philosophy. |
| `pg`/manual upload + LISTEN | `@aws-sdk/client-s3` v3 modular + BullMQ | aws-sdk v3 GA | Smaller bundles, presigner is a separate package. |
| Default SDK checksums | Must opt out for R2 | aws-sdk-js-v3 ≥ 3.729 (early 2025) | The single most common R2 integration break today. |
| blurhash everywhere | thumbhash gaining ground | 2023+ | Not adopted here — column is `blurhash`; switching is scope creep. |

**Deprecated/outdated:**
- aws-sdk **v2** (`aws-sdk` monolith) — use modular v3 `@aws-sdk/client-s3`.
- `sharp` `< 0.33` esm/native-loading quirks — `0.35.x` is current.

## Assumptions Log

> No CONTEXT.md / discuss step ran. These are the design choices a discuss pass would normally lock. The planner should either accept them as Claude's-discretion defaults or route the starred ones to a quick confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | **No new status column** — model `processed = variants != '{}'`; persist all derived fields in one UPDATE. ★ key fork | Summary / Pattern 3 | If product wants a panel "processing/failed" indicator, a later migration adds `status`/`processedAt`. Low risk: additive migration, no data loss. The single-write invariant already gives "never inconsistent". |
| A2 | Breakpoint widths `[384,640,768,1024,1366,1920,2560]` | Code Examples | Wrong set = re-process or extra storage. Tunable without schema change (keys are `{fmt}-{width}`). |
| A3 | AVIF q50/effort4, WebP q80 | Code Examples | Quality/size tradeoff; tune in QA. No structural impact. |
| A4 | blurhash components 4×3 | Pattern 3 | Placeholder fidelity only; cheap to change. |
| A5 | Presigned PUT for browser, server-proxy for seed | Pattern 2 | If browser uploads aren't needed yet (no panel UI this milestone), server-proxy-only is simpler. ★ Worth confirming — the panel upload UI is a *later* phase, so the only real caller this milestone is the Phase-3 seed (Node). The presigned endpoint may be built-but-unused until the panel phase. |
| A6 | Public R2 bucket + custom domain for variant serving | Alternatives / Pattern 5 | If originals/variants must be private, switch to signed GETs (resolver gains a signer). ★ depends on infra/product. |
| A7 | New shared `@imbau/storage` package vs inlining the R2 client in api+worker | Project Structure | Organizational only; either works. |
| A8 | Worker gains `DATABASE_APP_URL` + `@imbau/db` dep | Pattern 4 / Runtime State | This is forced by the RLS-correct write-back; not really optional, but it changes the worker's "Redis-only shell" contract (WR-01 in Phase-1 notes). Confirm acceptable. |
| A9 | pano360 images, if uploaded, get standard variants like any photo (no special tiling) | Scope | Out-of-scope says no pano360 *stitching/processing*; storing a pre-rendered pano360 as a normal media original is fine. |

**★ = recommend the planner surface for confirmation (ideally a short `/gsd-discuss-phase` before planning).**

## Open Questions

1. **Is a browser upload path actually needed this milestone, or only the Node seed?**
   - What we know: REQUIREMENTS out-of-scope excludes panel/web UI; the only in-milestone caller is the Phase-3 seed (Node).
   - What's unclear: whether to build the presigned `createUpload`/`confirmUpload` tRPC endpoints now (for the future panel) or defer them and ship only a Node-side `registerAndEnqueue` helper.
   - Recommendation: build the shared core (`registerAndEnqueue` + sharp pipeline + resolver) now; build the presigned tRPC endpoints too (cheap, satisfies MEDIA-01 "vía API/presigned" literally) but mark them tested-but-UI-less.

2. **Status column (A1).**
   - What we know: the table has no status column; `variants != '{}'` is a sufficient ready-flag and the single-write invariant prevents half-states.
   - What's unclear: future panel UX may want explicit pending/failed.
   - Recommendation: ship without it; revisit when the panel phase needs a processing indicator (additive migration).

3. **R2 provisioning + public domain + CORS** are human/infra steps (see Runtime State).
   - Recommendation: planner adds a `checkpoint:human-verify` gating the staging verification; unit/integration tests use a mock S3 so they don't block on real R2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | worker + api build | ✓ (per MEMORY: Node 22 via nvm) | 22.x | — |
| Redis 7 | BullMQ media queue | ✓ (compose, already used by partitions job) | 7 | — |
| PostgreSQL 16 | RLS write-back + integration tests | ✓ (compose / CI service) | 16 | — |
| Cloudflare R2 bucket + token | MEDIA-01/02 real storage | ✗ (must provision) | — | Mock S3 (`aws-sdk-client-mock` or in-mem) for CI; real R2 only in staging smoke |
| R2 public domain / CORS | variant serving + browser presign | ✗ (must provision) | — | resolver builds URLs from `R2_PUBLIC_BASE_URL`; verify on staging |
| `sharp` musl native binary | worker Docker image | ? (verify in build) | 0.35.2 | `apk add vips` / glibc base if musl prebuild missing |

**Missing dependencies with no fallback (block real end-to-end):**
- Cloudflare R2 bucket + API token + public binding + CORS — provision before staging verification (human/infra). Does **not** block unit/integration tests (mock S3).

**Missing dependencies with fallback:**
- Real R2 in CI → mock S3 client; sharp musl binary → install libvips in the image.

## Validation Architecture

> `workflow.nyquist_validation: true` — section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.8` (already configured in `apps/worker`, `packages/db`, `packages/api`) |
| Config file | per-package `vitest.config.ts`; `packages/db/tests/setup.ts` is the `globalSetup` (owner migrate + role guard) |
| Quick run command | `pnpm --filter @imbau/worker test` (pure pipeline units) |
| Full suite command | `pnpm test` (turbo) — runs worker + db + api suites |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEDIA-01 | createUpload inserts media row (withTenant) + returns presigned URL; confirmUpload HeadObject + enqueue | integration (PG16 + mock S3 + mock queue) | `pnpm --filter @imbau/api test` | ❌ Wave 0 |
| MEDIA-01 | client key never trusted; originalKey server-derived | unit | `pnpm --filter @imbau/api test` | ❌ Wave 0 |
| MEDIA-02 | `pickWidths` never exceeds source; dedupes/sorts | unit (pure) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-02 | sharp produces decodable AVIF+WebP at each width; dims correct | unit (real sharp, in-mem buffer, no infra) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-02 | variant keys deterministic | unit (pure) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-03 | blurhash round-trip: encode raw→decode non-empty; width/height persisted | unit (real blurhash) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-04 | idempotency: run processMedia twice → identical variant keys, one media row, identical variants map | integration (PG16 + mock S3) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-04 | failure injection: sharp/S3 throw → job fails, `Sentry.captureException` spy called, pino error logged, row stays `variants={}` (recoverable) | unit/integration (spies) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-04 | jobId=mediaId dedups re-enqueue | unit (BullMQ add with same jobId) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-04 | write-back runs as `app_authenticated` + GUC (not owner) | integration (role guard, reuse setup.ts pattern) | `pnpm --filter @imbau/worker test` | ❌ Wave 0 |
| MEDIA-05 | `resolveMedia` maps row→{srcset per fmt/width, blurhash, dims, urls}; `isReady=false` when variants empty | unit (pure) | `pnpm --filter @imbau/db test` | ❌ Wave 0 |
| MEDIA-05 | resolver consumable from web (anon) + panel (auth) paths | integration | `pnpm --filter @imbau/api test` | ❌ Wave 0 |

### Property-based / round-trip targets (Nyquist sampling)
- **Round-trip:** generate a synthetic image (sharp `create`) at random dimensions → process → assert every `pickWidths` width has both AVIF+WebP keys, each decodes, and decoded width == requested width (≤ source).
- **Idempotency property:** for any media, `process()` then `process()` again ⇒ identical `variants` map and exactly one row (re-query count == 1).
- **Failure-recoverability property:** inject failure at variant *k* ⇒ DB `variants` still `{}` (no partial map) and the job is retryable to a clean success.
- **blurhash property:** for any non-trivial image, `decode(encode(...))` yields a buffer of the requested size (validity, not pixel-equality).

### Infra requirements
- **Pure unit (no infra):** `pickWidths`, `variantKey`/`originalKey`, `resolveMedia`, QUALITY table, sharp encode (real native, in-mem buffers), blurhash encode/decode. Fast, run per commit.
- **Needs real Postgres 16 + Redis:** RLS write-back assertion, idempotency (row count), worker role-guard. Reuse `packages/db/tests` harness (owner migrate + app/anon role guard, `*_test` DB guard) and the compose/CI services already used by Phase 1.
- **R2:** use a **mock S3** (`aws-sdk-client-mock`, or an in-memory key→buffer fake implementing `send`) for all CI tests — assert PutObject/GetObject/HeadObject calls + keys. A **real R2** smoke (upload→process→fetch variant URL) runs only on **staging**, gated behind the human R2-provisioning checkpoint. Do not require real R2 in CI.

### Wave 0 Gaps
- [ ] `apps/worker/src/media-variants.test.ts` — `pickWidths` + key derivation (MEDIA-02)
- [ ] `apps/worker/src/media.test.ts` — sharp pipeline, blurhash round-trip, idempotency, failure-injection (MEDIA-02/03/04)
- [ ] `apps/worker/src/media-rls.test.ts` (or fold into db tests) — write-back as `app_authenticated`+GUC (MEDIA-04)
- [ ] `packages/db/src/resolve-media.test.ts` — resolver mapping + `isReady` (MEDIA-05)
- [ ] `packages/api/src/trpc/routers/media.test.ts` — createUpload/confirmUpload via `createCaller` (MEDIA-01/05)
- [ ] Mock S3 helper (in-memory) shared across worker/api tests
- [ ] Framework install: none (Vitest present); add `aws-sdk-client-mock` (dev) if chosen over a hand-rolled fake

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Tenant isolation preserved into the background worker via `withTenant` + GUC; no new trust boundary that bypasses RLS. |
| V4 Access Control | yes | Upload create/confirm under `protectedProcedure` (session→activeOrgId); `media_tenant` RLS on write-back; `media_anon_published` already restricts anon reads to published projects. |
| V5 Validation/Sanitization | yes | Content-type allowlist (`image/jpeg|png|webp|avif`), reject SVG; declared + decoded size caps; `limitInputPixels` (decompression-bomb DoS); strip EXIF (sharp default removes metadata → privacy/GPS). |
| V6 Cryptography | no (none hand-rolled) | SigV4 handled by the SDK presigner; blurhash is not crypto. |
| V8 Data Protection | yes | Originals may stay private; only variants of published projects served publicly. R2 secrets via SOPS/CI, never logged (pino never logs values — existing T-4-LOGLEAK rule). |
| V12 Files/Resources | yes | Presigned PUT scoped to one server-derived key + content-type + 1h expiry; server never accepts a client-supplied key; HeadObject verifies before processing. |
| V13 API | yes | tRPC + Zod validation at the boundary (existing pattern); rate-limit consideration for upload endpoints (Traefik edge, per CLAUDE.md). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant write via worker (no session) | Elevation / Tampering | `organizationId` from trusted job payload → `withTenant` GUC; UPDATE governed by `media_tenant`; never owner/BYPASSRLS. |
| Client supplies arbitrary R2 key / org id | Tampering | Server derives `originalKey` from `mediaId`; org from session (api) or trusted payload (worker). |
| Decompression bomb / pixel-flood DoS | DoS | `limitInputPixels`, declared+decoded size caps, sequential variant processing, `sharp.cache(false)`. |
| SVG/polyglot upload → stored XSS | Tampering / XSS | Content-type allowlist excludes SVG; sharp rasterizes only raster formats; variants served from a separate static origin. |
| Presigned URL abuse (over-broad/long-lived) | Spoofing | Single-key, content-type-bound, short-expiry presign; one URL per upload. |
| Secret leakage in logs | Info Disclosure | R2 creds via SOPS; pino logs structured fields only, never the secret values; error formatter prints var NAMEs not values (existing convention). |
| Orphan/dangling rows referencing missing objects | (integrity) | HeadObject before enqueue; resolver `isReady=false` for empty variants; future GC sweep (out of scope). |

## Sources

### Primary (HIGH confidence)
- **Codebase (direct inspection, 2026-06-29)** — `packages/db/src/schema/media.ts` (columns + RLS policies), `packages/db/src/with-tenant.ts` + `client.ts` (RLS write seam), `apps/worker/src/{index,partitions,instrument,env}.ts` (BullMQ idempotent-job pattern, Sentry/pino), `packages/api/src/trpc/{init,context,middleware,routers/projects}.ts` (protectedProcedure / activeOrgId / withTenant routing), `packages/db/tests/{db,setup,helpers}.ts` (test harness, role guard, `makeMedia`), `packages/config/env/presets.ts`, all `package.json` (installed versions). **HIGH** — VERIFIED by reading.
- **CLAUDE.md stack matrix (2026-06-12)** — decided versions, RLS+auth pattern, "What NOT to Use" (no superuser/BYPASSRLS, no manual schema edits, standalone tracing). **HIGH** (project-authoritative).
- **npm registry (`npm view`, 2026-06-29)** — `sharp@0.35.2`, `@aws-sdk/client-s3@3.1076.0`, `@aws-sdk/s3-request-presigner@3.1076.0`, `blurhash@2.0.5`; legitimacy gate verdicts. **HIGH** (versions verified) / package legitimacy OK (blurhash) + SUS-false-positive (sharp/aws-sdk).

### Secondary (MEDIUM confidence)
- [Cloudflare R2 — aws-sdk-js-v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) — `region:"auto"`, endpoint shape, `getSignedUrl` presigned PUT. **MEDIUM/HIGH** (official).
- [aws-sdk-js-v3 issue #6893](https://github.com/aws/aws-sdk-js-v3/issues/6893) + [Cloudflare community: Bad digest with x-amz-content-sha256](https://community.cloudflare.com/t/bad-digest-when-putobject-in-r2-with-x-amz-content-sha256/757888) — checksum opt-out (`requestChecksumCalculation`/`responseChecksumValidation: WHEN_REQUIRED`), 3.729 regression, 3.726.1 pin. **MEDIUM** (cross-checked, multiple corroborating reports).

### Tertiary (LOW confidence — flagged ASSUMED)
- Training knowledge for sharp pipeline params (breakpoint widths, AVIF/WebP quality, blurhash components), public-bucket vs signed-GET tradeoff. **LOW** — tagged `[ASSUMED]` in the Assumptions Log; tune in QA, none affect schema.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions npm-verified; only 3 genuinely new packages, all first-party/reference-impl.
- Architecture (RLS write-back, single-write invariant, presigned flow): HIGH — derived directly from existing, read codebase seams.
- R2 integration specifics (checksum gotcha): MEDIUM — official docs + corroborated issue reports.
- Pipeline parameters (widths/quality/components): MEDIUM/LOW — sensible defaults, flagged ASSUMED, tunable without schema change.
- Pitfalls: HIGH for #1/#2/#5 (verified/structural); MEDIUM for #3/#6 (environment-dependent).

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (30 days) — but re-check `@aws-sdk/*` version + checksum behavior before pinning (fast-moving, ~daily releases).
