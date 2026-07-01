# Phase 2: Pipeline de media (R2 + sharp + blurhash) - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 14 new/modified files (MEDIA-01..05)
**Analogs found:** 13 / 14 (1 partial — R2 client factory has no in-repo S3 analog)

> No CONTEXT.md (discuss skipped). File list derived from 02-RESEARCH.md "Recommended Project Structure" (§139-156) + the locked decisions A1/A5/A6/A8 in the orchestrator prompt. Every excerpt below is from a file already read — paths + line ranges are concrete and load-bearing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/storage/src/r2-client.ts` (NEW) | config/factory | request-response (S3) | `packages/db/src/client.ts` (pool factory) | partial (no S3 analog in repo) |
| `packages/storage/src/keys.ts` (NEW) | utility (pure) | transform | `apps/worker/src/partitions.ts` pure helpers (`firstOfMonth`, `renderCreatePartitionSql`) | role-match (pure key/string derivation) |
| `packages/config/env/presets.ts` (MOD: +`r2Env`) | config | — | existing presets `dbEnv`/`redisEnv`/`sentryEnv` in same file | exact |
| `packages/api/src/trpc/routers/media.ts` (NEW) | router (controller) | request-response → CRUD + enqueue | `packages/api/src/trpc/routers/{member,projects}.ts` | exact (role) |
| `packages/db/src/resolve-media.ts` (NEW) | utility (pure resolver) | transform | `apps/worker/src/partitions.ts` pure section | role-match (pure mapper) |
| `packages/db/src/index.ts` (MOD: export `resolveMedia`) | config/barrel | — | existing barrel re-exports | exact |
| `apps/worker/src/media.ts` (NEW) | service/executor | file-I/O + CRUD write-back | `apps/worker/src/partitions.ts` (`runPartitionMaintenance` executor) | role-match (impure executor + pure helpers) |
| `apps/worker/src/media-variants.ts` (NEW) | utility (pure) | transform | `apps/worker/src/partitions.ts` pure helpers | exact |
| `apps/worker/src/index.ts` (MOD: +media Queue/Worker + `failed`) | route/wiring | event-driven (BullMQ) | itself — existing `createPartitionWorker`/`boot` wiring | exact (extend in place) |
| `apps/worker/src/env.ts` (MOD: +`DATABASE_APP_URL` +`r2Env`) | config | — | itself + `packages/db/src/env.ts` | exact |
| `apps/worker/src/media-variants.test.ts` (NEW) | test (pure unit) | — | `apps/worker/src/partitions.test.ts` | exact |
| `apps/worker/src/media.test.ts` (NEW) | test (integration, PG+mockS3) | — | `packages/db/tests/cross-tenant.test.ts` + `setup.ts` | role-match |
| `packages/db/src/resolve-media.test.ts` (NEW) | test (pure unit) | — | `apps/worker/src/partitions.test.ts` | role-match |
| `packages/api/src/trpc/routers/media.test.ts` (NEW) | test (integration, createCaller) | — | `packages/api/tests/trpc-tenant.test.ts` | exact |

## Pattern Assignments

### `packages/api/src/trpc/routers/media.ts` (router, request-response + enqueue) — MEDIA-01

**Analog:** `packages/api/src/trpc/routers/member.ts` (mutation + Zod) and `projects.ts` (withTenant routing).

**Imports + withTenant routing** — copy from `projects.ts` lines 11-12, 16-18:
```typescript
import { withTenant, withAnon, schema } from "@imbau/db";
import { router, protectedProcedure, publicProcedure } from "../init";
// ...
listForOrg: protectedProcedure.query(({ ctx }) =>
  withTenant(ctx.activeOrgId, (tx) => tx.select().from(schema.projects)),
),
```
- `createUpload`/`confirmUpload` are `protectedProcedure.mutation` — the server-derived tenant is `ctx.activeOrgId` (NEVER a client orgId). This is the exact seam `projects.ts` header documents ("There is NO app-layer `where organization_id`").

**Mutation + Zod-4 input validation** — copy the shape from `member.ts` lines 17-33:
```typescript
invite: requireRole("owner")
  .input(
    z.object({
      email: z.email(),
      role: z.enum(["owner", "developer", "viewer"]).default("viewer"),
    }),
  )
  .mutation(({ ctx, input }) =>
    auth.api.createInvitation({ body: { /* ... */ organizationId: ctx.activeOrgId }, headers: ctx.headers }),
  ),
```
- For `createUpload`: validate `projectId` (uuid), `contentType` (z.enum allowlist `image/jpeg|png|webp|avif` — reject SVG per RESEARCH Pitfall/anti-pattern), declared `size` (≤ MAX). Derive `originalKey` server-side from `mediaId` (RESEARCH §379-382, never client-supplied).
- The INSERT runs inside `withTenant(ctx.activeOrgId, tx => tx.insert(schema.media).values({...}))` — `media_tenant` `withCheck` enforces the org (see schema excerpt below).
- `confirmUpload`: `withTenant` lookup (RLS scopes to caller org) → `HeadObject` → `mediaQueue.add("process", {...}, { jobId: mediaId, attempts: 5, backoff: { type: "exponential", delay: 2000 } })` (RESEARCH §198-199).

**Register in `_app.ts`** — mirror `_app.ts` lines 7-18: import `mediaRouter`, add `media: mediaRouter` to the `router({...})`.

**Dependency note:** `packages/api/package.json` (lines 25-37) must gain `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (same pinned version) and `@imbau/storage` (if created). `@imbau/db` is already a dep (line 26).

---

### `apps/worker/src/media.ts` (service/executor, file-I/O + RLS write-back) — MEDIA-02/03/04

**Analog:** `apps/worker/src/partitions.ts` — the "PURE helpers + a thin impure executor" structure (header lines 1-15), and the RLS write seam `packages/db/src/with-tenant.ts`.

**Executor shape** — mirror `runPartitionMaintenance` (`partitions.ts` lines 121-149): a single impure async function that owns ALL side effects, opens short-lived resources, logs a structured pino line on success, errors propagate to BullMQ (never swallowed). KEY DIFFERENCE from partitions: partitions uses the OWNER URL via raw `process.env.DATABASE_URL` for DDL; media MUST use `withTenant` (app_authenticated), NOT owner — see RESEARCH Pattern 4 §255-261.

**RLS write-back** — copy the seam from `with-tenant.ts` lines 22-34 (call it, don't reimplement):
```typescript
export async function withTenant<T>(orgId: string, fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${orgId}, true)`,
    );
    return fn(tx);
  });
}
```
- The worker receives `organizationId` in the job payload (placed by the authenticated enqueuer) and feeds it into `withTenant`. The single final `tx.update(schema.media).set({ variants, blurhash, width, height }).where(eq(schema.media.id, mediaId))` satisfies `media_tenant` (excerpt below). This forces the worker to import `@imbau/db` and carry `DATABASE_APP_URL` (A8).

**Target table policy** — from `packages/db/src/schema/media.ts` lines 30-37, 47-53 (the columns the UPDATE writes + the policy the write must satisfy):
```typescript
variants: jsonb("variants").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
width: integer("width"),
height: integer("height"),
blurhash: text("blurhash"),
// ...
pgPolicy("media_tenant", {
  as: "permissive", for: "all", to: appAuthenticated,
  using: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
  withCheck: sql`${t.organizationId} = current_setting('app.current_organization_id', true)::text`,
}),
```
- `processed = variants != '{}'` (A1 — no new column/migration). Single atomic UPDATE = "never inconsistent" (RESEARCH §246-253).

**Sharp pipeline + blurhash:** see RESEARCH Pattern 3 §205-251 (download once → Buffer → per-width AVIF/WebP loop → 32×32 raw → `blurhashEncode` → single UPDATE). `sharp.cache(false)` + `limitInputPixels` per Pitfall 6.

**Dependency note:** `apps/worker/package.json` (lines 13-24) must gain `sharp@0.35.2`, `@aws-sdk/client-s3`, `blurhash@2.0.5`, `@imbau/db` (workspace:*). `postgres` (3.4.9) already present.

---

### `apps/worker/src/media-variants.ts` (utility, pure) — MEDIA-02

**Analog:** `apps/worker/src/partitions.ts` lines 32-99 — the pure-helper convention (side-effect-free, unit-testable with no infra, documented as such in the header lines 11-13).

**Pattern to copy** — `pad2`/`firstOfMonth`/`renderCreatePartitionSql` are small, exported, pure, fully-commented:
```typescript
function pad2(n: number): string { return n.toString().padStart(2, "0"); }
export function renderCreatePartitionSql(spec: PartitionSpec): string { /* pure string build */ }
```
- `media-variants.ts` houses `pickWidths(srcWidth)`, `variantKey`/`originalKey`, and the `QUALITY` table (RESEARCH §358-383). Same export-pure-and-comment style; no infra import.

---

### `packages/db/src/resolve-media.ts` (utility, pure resolver) — MEDIA-05

**Analog:** pure-function convention from `partitions.ts`; barrel-export convention from `packages/db/src/index.ts`.

**Barrel export** — extend `packages/db/src/index.ts` (currently lines 5-7):
```typescript
export { withTenant, withAnon } from "./with-tenant";
export { appDb, anonDb, createOwnerDb } from "./client";
export * as schema from "./schema";
```
- Add `export { resolveMedia } from "./resolve-media";` (+ `export type { ResolvedMedia }`). `@imbau/db` already owns the `media` row type and is depended on by `@imbau/api` → no new edges/cycles (RESEARCH §280).
- Signature is `resolveMedia(row, { publicBaseUrl })` (RESEARCH §266-279) — pure, no env read, `publicBaseUrl` passed in (sourced from `R2_PUBLIC_BASE_URL`, A6). `isReady = variants != '{}'` mirrors the A1 derived-flag rule.

---

### `apps/worker/src/index.ts` (wiring, event-driven BullMQ) — MEDIA-04 failed handler

**Analog:** itself — extend the existing `createPartitionWorker` + `boot` pattern (lines 52-98).

**Worker factory + boot wiring** — mirror lines 52-56 and 86-92:
```typescript
export function createPartitionWorker(connection: IORedis): Worker {
  return new Worker(PARTITIONS_QUEUE, () => runPartitionMaintenance(), { connection });
}
// in boot():
const partitionsQueue = new Queue(PARTITIONS_QUEUE, { connection });
await partitionsQueue.upsertJobScheduler(/* ... */);
const partitionWorker = createPartitionWorker(connection);
```
- Add a `createMediaWorker(connection)` returning `new Worker(MEDIA_QUEUE, (job) => processMedia(job), { connection, concurrency: 2 })`, a `mediaQueue = new Queue(MEDIA_QUEUE, { connection })` in `boot()`, and add both to the returned handles object (lines 63-69, 97).
- `jobId = mediaId` dedups re-enqueue (RESEARCH Pitfall 5); the media queue uses `attempts`/`backoff` on `.add`, NOT `upsertJobScheduler` (that's only for the repeatable partition cron).

**Failed handler (never swallow)** — combine the Sentry import style from `instrument.ts` line 1 with the structured-error logging already used in `boot().catch` (lines 106-109). RESEARCH §386-395 gives the exact handler:
```typescript
import * as Sentry from "@sentry/node";
mediaWorker.on("failed", (job, err) => {
  Sentry.captureException(err, { extra: { mediaId: job?.data?.mediaId, attempts: job?.attemptsMade } });
  logger.error({ err, mediaId: job?.data?.mediaId, queue: MEDIA_QUEUE }, "media job failed");
});
```
- `logger` is already imported (line 9); `Sentry` is initialized via `./instrument` (imported first, line 3).

---

### `apps/worker/src/env.ts` (config) — A8 + R2 creds

**Analog:** itself (lines 18-32) + `packages/config/env/presets.ts`.

**Pattern** — the worker composes presets via `createEnv` (lines 18-29). Currently it deliberately OMITS `DATABASE_URL` (lines 12-13, 21-22). MEDIA reverses that for `DATABASE_APP_URL` only:
```typescript
export const env = createEnv({
  server: {
    ...baseEnv.server,
    ...redisEnv.server,
    ...sentryEnv.server,
    ...lokiEnv.server,
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```
- Add `...r2Env.server` and `DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL` (or a focused new preset) to `server`. Update the file header comment (lines 4-17) — the "Redis-only shell / no Postgres" contract is intentionally changed by A8. Note: the worker now uses `@imbau/db`'s `withTenant` which reads `DATABASE_APP_URL` via its own `packages/db/src/env.ts`; ensure the var is present in the worker's runtime env.

---

### `packages/config/env/presets.ts` (config) — MEDIA-01/02 R2 creds

**Analog:** the existing presets in the SAME file (`dbEnv` lines 19-25, `redisEnv` 27-29, `sentryEnv` 51-58).

**Pattern** — names + Zod schemas only, never values; documented justification per preset:
```typescript
export const redisEnv = {
  server: { REDIS_URL: z.string().url() },
} as const;
```
- Add `r2Env` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (all `z.string().min(1)`), `R2_PUBLIC_BASE_URL` (`z.string().url()`). Follow the comment convention: declare NAMES only, cite the decision (A6), never log values (T-4-LOGLEAK).

---

### `packages/storage/src/r2-client.ts` (factory) — MEDIA-01/02 [PARTIAL ANALOG]

**Analog:** `packages/db/src/client.ts` (lines 11-31) — the "build a configured client from validated env, export a singleton + a factory" shape. There is NO existing S3 client in the repo, so the R2-specific body comes from RESEARCH Pattern 1 §161-180 (the checksum opt-out is load-bearing).

**Factory convention to copy** — `client.ts` lines 16-31:
```typescript
const appClient = postgres(env.DATABASE_APP_URL);
export const appDb = drizzle(appClient, { schema });
// factory variant taking an explicit URL (avoids hard-dep on a privileged var):
export function createOwnerDb(url: string) {
  const ownerClient = postgres(url);
  return { client: ownerClient, db: drizzle(ownerClient, { schema }) };
}
```
- `makeR2Client(env)` mirrors `createOwnerDb` (takes config in, returns the client) so both `@imbau/api` and `apps/worker` import one factory. MUST set `requestChecksumCalculation: "WHEN_REQUIRED"` + `responseChecksumValidation: "WHEN_REQUIRED"` (RESEARCH Pattern 1 / Pitfall 1 — R2 rejects the default CRC32 trailer). `packages/storage/package.json` is new: copy the shape of `packages/db/package.json` / `apps/worker/package.json` (private, type module, lint/typecheck/test scripts).

---

### Tests

**`apps/worker/src/media-variants.test.ts` (pure unit, MEDIA-02)** — analog `apps/worker/src/partitions.test.ts` (pure date-math/DDL tests, no infra). Cover `pickWidths` (never upscale, dedupe/sort), `variantKey`/`originalKey` determinism, `QUALITY` table.

**`packages/db/src/resolve-media.test.ts` (pure unit, MEDIA-05)** — same pure-unit analog. Assert srcset/sources mapping + `isReady=false` when `variants={}`.

**`apps/worker/src/media.test.ts` (integration, MEDIA-02/03/04)** — analog `packages/db/tests/cross-tenant.test.ts` + the `globalSetup` in `packages/db/tests/setup.ts`.
- **Role guard** — reuse the `assertUnprivileged` idea from `setup.ts` lines 28-67 to prove the write-back runs as `app_authenticated` (rolsuper=false, rolbypassrls=false), NOT owner (RESEARCH Pitfall 2 / §329).
- **Fixtures** — reuse `makeOrg`/`makeProject`/`makeMedia` from `packages/db/tests/helpers.ts` (lines 49-78, 332-346); `makeMedia` already inserts a `media` row with `originalKey` via the owner pool.
- **Mock S3** — in-memory `send` fake (or `aws-sdk-client-mock`) per RESEARCH §498; real R2 only on staging.
- Idempotency: run `processMedia` twice → identical variant keys, one row, identical `variants`. Failure-injection: spy on `Sentry.captureException` + `logger.error`, assert row stays `variants={}`.

**`packages/api/src/trpc/routers/media.test.ts` (integration, MEDIA-01/05)** — analog `packages/api/tests/trpc-tenant.test.ts`.
- Build a caller via `createCaller({ headers })` (api `index.ts` lines 34-37); seed orgs with `makeUserWithActiveOrg` (test fixtures) per the trpc-tenant pattern lines 42-52.
- Assert `createUpload` inserts under `withTenant` + returns a presigned URL; `confirmUpload` HeadObjects + enqueues. Assert a client-supplied key/orgId is never trusted (originalKey server-derived). Use the mock S3 + a mock queue.

## Shared Patterns

### RLS-correct write seam (the tenancy decision)
**Source:** `packages/db/src/with-tenant.ts` lines 22-34
**Apply to:** `media.ts` (api INSERT) and `apps/worker/src/media.ts` (worker UPDATE write-back)
```typescript
await tx.execute(sql`select set_config('app.current_organization_id', ${orgId}, true)`);
```
- orgId is PARAMETER-bound, never interpolated. Worker gets orgId from the trusted job payload; api gets it from `ctx.activeOrgId`. NEVER owner/BYPASSRLS (CLAUDE.md "What NOT to Use").

### Server-derived tenant (never trust the client)
**Source:** `packages/api/src/trpc/init.ts` lines 22-36 (`protectedProcedure` → `ctx.activeOrgId`)
**Apply to:** every procedure in `media.ts`
- `createUpload`/`confirmUpload` derive org SOLELY from `session.session.activeOrganizationId`; `originalKey` is server-derived from `mediaId`.

### Pure-helper + thin-impure-executor split
**Source:** `apps/worker/src/partitions.ts` (pure §32-99, executor §121-149)
**Apply to:** `media-variants.ts` (pure) + `media.ts` (executor); `resolve-media.ts` (pure)
- Side-effect-free helpers are unit-tested with no infra; the one executor owns all I/O and lets errors propagate to BullMQ → pino + Sentry.

### Structured error reporting (never swallow)
**Source:** `apps/worker/src/instrument.ts` line 1 (Sentry init) + `apps/worker/src/index.ts` lines 106-109 (`logger.error({ err }, ...)`)
**Apply to:** the media worker `failed` handler (MEDIA-04)
- `Sentry.captureException(err, { extra })` + `logger.error({ err, mediaId, queue }, "...")`. pino logs structured fields only, never secret values (T-4-LOGLEAK).

### Env presets: names + Zod only, justified, never values
**Source:** `packages/config/env/presets.ts` (whole file) + `apps/worker/src/env.ts` composition (lines 18-29)
**Apply to:** `r2Env` preset + worker/api env composition
- Default formatter prints variable NAME + reason, never the offending VALUE (V7). `SKIP_ENV_VALIDATION` honored only for the Docker build.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/storage/src/r2-client.ts` | factory | S3 request-response | No S3/AWS client exists in the repo. The *factory shape* is borrowed from `packages/db/src/client.ts`, but the R2-specific body (endpoint, `region:"auto"`, checksum opt-out) comes from RESEARCH Pattern 1 §161-180. Planner: take the checksum opt-out verbatim — it is the single most common R2 break. |

## Metadata

**Analog search scope:** `apps/worker/src`, `packages/db/src`, `packages/db/tests`, `packages/api/src/trpc`, `packages/api/tests`, `packages/config/env`
**Files scanned:** ~25 read in full (worker, db client/schema/with-tenant/index/tests, api routers/init/context/middleware/index/tests, config presets, package.json ×3)
**Pattern extraction date:** 2026-06-29
</content>
</invoke>
