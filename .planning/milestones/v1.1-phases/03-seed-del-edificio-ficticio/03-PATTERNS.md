# Phase 3: Seed del edificio ficticio - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 10 new / 1 modified (`packages/db/package.json`) + optional root `package.json`
**Analogs found:** 10 / 10 (every target has a strong in-repo analog)

Every file in this phase lives in `@imbau/db` and reuses established repo patterns; there are **no** "no analog" gaps. The seed's only real novelty is content authorship + deterministic ids + orchestration order — all mechanics have canonical analogs below.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/db/seed.ts` | script (standalone entry, `runSeed()`) | batch / bootstrap | `packages/db/migrate.ts` | exact (same runner style, owner pool, exit/close) |
| `packages/db/src/seed/ids.ts` | utility | transform (pure) | RESEARCH Code Examples §361-378 (no repo analog; new pure util) | role-match (mirrors purity of `partitions.ts` pure fns) |
| `packages/db/src/seed/content.ts` | config / data constants | transform (pure) | `packages/db/tests/helpers.ts` (row-shape constants) | role-match (curated constants vs random fixtures) |
| `packages/db/src/seed/building.ts` | service (row generators) | transform → CRUD | `tests/helpers.ts` `makeFloor`/`makeUnit` | role+flow match |
| `packages/db/src/seed/pricing.ts` | service (row generators) | transform → CRUD | `tests/helpers.ts` `makePriceList`/`makeUnitPrice`/`makePaymentPlan`/`makeCacIndex` | role+flow match |
| `packages/db/src/seed/content-rows.ts` | service (row generators) | transform → CRUD | `tests/helpers.ts` `makeBroker`/`makeLead`/`makeProgressPost`/`makeGallery`/`makeEvent` | role+flow match |
| `packages/db/src/seed/media.ts` | service (media producer + waiter) | file-I/O + pub-sub (enqueue) | `packages/api/src/media/register.ts` + `runtime.ts` (compose primitives, do NOT import) | role-match (cycle-safe re-composition) |
| `packages/db/src/seed/prerequisites.ts` | middleware (startup guard) | request-response (reachability probe) | `packages/db/migrate.ts` L32-39 (fail-loud env guard) + `runtime.ts` L50-61 (fail-closed env) | role-match |
| `packages/db/src/seed/assets/` + `LICENSES.md` | config / static assets | file-I/O (bytes) | none (new committed assets) | n/a (Pattern 5) |
| `packages/db/tests/seed.*.test.ts` (3 files) | test | integration | `packages/db/tests/db.ts` harness + `tests/helpers.ts` | exact (reuse `connectAs`/`ownerUrl`/`_test` guard) |
| `packages/db/package.json` (MODIFY) | config | — | its own `db:migrate:deploy` script line | exact |

---

## Pattern Assignments

### `packages/db/seed.ts` (script, batch/bootstrap)

**Analog:** `packages/db/migrate.ts` (whole file, 48 lines — standalone Node script the `db:*` scripts run via `node --experimental-strip-types`).

**Structure to clone** (`migrate.ts:19-47`): header comment explaining owner-role choice → build owner pool with `max: 1` (or `createOwnerDb`) → do work in `try` → `await sql.end({ timeout: 5 })` in `finally`. Non-zero exit aborts (throw propagates).

**Env guard** (`migrate.ts:32-39`) — copy verbatim shape (var NAME never value, V7):
```typescript
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "Missing DATABASE_URL: the migrate runner needs the OWNER-role connection string to apply the journal.",
  );
}
```

**Owner pool + close** (`migrate.ts:42-47`):
```typescript
const sql = postgres(databaseUrl, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder });
} finally {
  await sql.end({ timeout: 5 });
}
```
The seed uses `createOwnerDb(process.env.DATABASE_URL!)` instead (`packages/db/src/client.ts:28-31`), which returns `{ client, db }`; call `await client.end({ timeout: 5 })` in `finally`. Export a callable `runSeed()` so the Wave-0 tests can invoke it programmatically (Validation Architecture §520).

**Key conventions:** superuser owner ONLY for the `organization` root + events partition DDL; everything else via `withTenant`. All ids from `seedId(name)`. Fixed `SEED_REFERENCE_DATE` (no `new Date()`).

---

### `packages/db/src/seed/ids.ts` (utility, pure transform)

**Analog:** RESEARCH Code Examples §361-378 (no direct repo analog — new file). Mirrors the purity contract of `apps/worker/src/partitions.ts:33-99` (side-effect-free helpers unit-testable without infra).

**Content to author** (from RESEARCH §363-377): `SEED_NS` fixed UUID constant, `seedId = (name) => uuidv5(name, SEED_NS)`, and `makePrng(seed)` (mulberry32) for numeric jitter only. Import `import { v5 as uuidv5 } from "uuid"` (new dep, pin `11.1.1`).

**Key conventions:** deterministic ids by NAME, never `randomUUID`/`Math.random`/`Date.now`. This file is the idempotency core (Pattern 1).

---

### `packages/db/src/seed/building.ts` (service, transform → CRUD)

**Analog:** `packages/db/tests/helpers.ts:125-160` (`makeFloor`, `makeUnit`).

**Row shape — floors** (`helpers.ts:130-139`; schema `floors.ts`): columns `{ id, organizationId, projectId, numero (int, NOT unique), nombre, renderKey?, poligonoSvg? }`. Seed uses real floor numbers (PB=0..~13) + es-AR `nombre`, NOT `Math.random()`.

**Row shape — units** (`helpers.ts:144-159`; schema `units.ts`): columns `{ id, organizationId, projectId, floorId, identificador (e.g. "4B"), tipologia?, m2 (numeric→STRING), orientacion?, ambientes (int), planoKey?, estado (enum default 'disponible'), poligonoSvg?, orden (int) }`.

**es-AR enum values** (`enums.ts`): `estado ∈ {disponible, reservado, vendido}`. Pozo sale curve (D-02): low floors weighted `vendido`, mid `reservado`/`disponible`, high `disponible` — deterministic mapping seeded by `makePrng`, not random.

**Insertion order + composite FK** (`units.ts` foreignKey blocks): units carry composite FKs to BOTH `(projectId, organizationId)→projects` AND `(floorId, organizationId)→floors`; insert floors before units, always set the same denormalized `organizationId`. Write via `withTenant(orgId, tx => tx.insert(schema.units).values(rows).onConflictDoNothing())`.

**Money/measure typing** (Pitfall 6 / `helpers.ts:197`): `m2` is `numeric` → pass as STRING; `ambientes`/`orden` are integers.

---

### `packages/db/src/seed/pricing.ts` (service, transform → CRUD)

**Analog:** `packages/db/tests/helpers.ts:163-236` (`makePriceList`, `makeUnitPrice`, `makePaymentPlan`, `makeCacIndex`).

**price_lists** (`helpers.ts:168-177`; schema `price-lists.ts`): `{ id, organizationId, projectId, nombre, moneda (enum 'USD'|'ARS') }`. D-06: two lists — "Contado" and "Financiado", both `moneda: "USD"`.

**unit_prices** (`helpers.ts:189-200`; schema `unit-prices.ts`): `{ id, organizationId, projectId, unitId, priceListId, precio (INTEGER USD whole units), vigencia (Date tz) }`. Three composite FKs all share `organizationId`; insert AFTER units + price_lists. `precio` is a JS **integer**, never float (~USD 2500-3500/m2 × m2).

**payment_plans + Refuerzo[]** (`helpers.ts:204-221`; schema `payment-plans.ts` + `json-schemas.ts`):
```typescript
// anticipoPct is numeric → STRING; refuerzos jsonb $type<Refuerzo[]>; ajuste enum {CAC, fijo}
{ id, organizationId, projectId, nombre, anticipoPct: "30", cuotas: 36, ajuste: "CAC",
  refuerzos: [{ cuota: 6, montoUsd: 15000 }, ...], notasLegales? }
```
Validate each `Refuerzo` with `refuerzoSchema.parse` before insert (`json-schemas.ts:3-6`: `{ cuota: int, montoUsd: int }` — both integers, USD). `paymentPlanInsertSchema` (drizzle-zod) also available.

**cac_index** (`helpers.ts:225-235`; schema `cac-index.ts`): `{ id, organizationId, periodo (text, e.g. "2025-06"), valor (numeric(12,4) → STRING) }`. ORG-scoped, NO `projectId`. `UNIQUE(organizationId, periodo)` — the one table where natural-key conflict target is available:
```typescript
.onConflictDoNothing({ target: [schema.cacIndex.organizationId, schema.cacIndex.periodo] })
```
Author 12-24 monotonic-ish monthly rows in `content.ts` (documented synthetic).

---

### `packages/db/src/seed/content-rows.ts` (service, transform → CRUD)

**Analog:** `packages/db/tests/helpers.ts:260-366` (`makeBroker`, `makeLead`, `makeProgressPost`, `makeGallery`, `makeEvent`).

**brokers** (`helpers.ts:265-274`; schema `brokers.ts`): `{ id, organizationId, projectId, nombre, slug (NOT unique), whatsapp?, email? }`. Seed realistic slug/whatsapp/email (D-07).

**leads + timeline** (`helpers.ts:284-293`; schema `leads.ts` + `json-schemas.ts`): `{ id, organizationId, projectId, unitId?, brokerId?, quoteId?, nombre, contacto, origen?, estado (enum default 'nuevo'), timeline: jsonb $type<LeadNote[]> }`. D-07: 10-20 leads across all 4 estados `{nuevo, contactado, negociacion, cerrado}` (`enums.ts`), some with `brokerId`, some direct/WhatsApp `origen`. `timeline` = append-only `LeadNote[]` (`json-schemas.ts:8-15`: `{ ts, autor?, nota, estadoPrev?, estadoNuevo? }`); validate with `leadNoteSchema`/`leadInsertSchema`. Nullable `unitId`/`brokerId` FKs are MATCH SIMPLE — safe to omit.

**progress_posts** (`helpers.ts:297-312`; schema `progress-posts.ts`): `{ id, organizationId, projectId, fecha (Date tz, use fixed reference dates), titulo, mediaId? (plain uuid ref, no FK), cuerpo? }`.

**galleries** (`helpers.ts:315-329`; schema `galleries.ts`): `{ id, organizationId, projectId, seccion (enum {amenities, exteriores, interiores}), imagenes: jsonb string[] (array of mediaId), pano360s: jsonb string[] }`. `imagenes` holds seeded media ids (plain refs, no FK).

**events** (`helpers.ts:350-366`; schema `events.ts`): `{ id, organizationId, projectId, tipo (text e.g. "view"), unitId? (no FK), brokerId?, sessionId?, ts (Date tz) }`. PK is composite `(id, ts)`; `events` excluded from `drizzle.config.ts` but `schema.events` exists for typed inserts. D-07: fixed `ts` values spread across ≥2 distinct months to exercise partition routing. Insert via `withTenant` (tenant policy `withCheck org = GUC`).

**Insertion order** (RESEARCH Pattern 4 §248-259): `organization(owner) → projects → floors → units → price_lists/payment_plans → unit_prices → cac_index → brokers → leads → media → galleries/progress_posts → quotes → events`. Every insert ends `.onConflictDoNothing()`.

---

### `packages/db/src/seed/media.ts` (service, file-I/O + enqueue)

**Analogs:** `packages/api/src/media/register.ts` (the shape) + `runtime.ts` (the primitives) + `packages/storage/src/{keys,r2-client,queue}.ts`. **⚠ Do NOT import `@imbau/api`** (cycle — RESEARCH Pattern 3 §238). Do NOT call `registerAndEnqueue` (`register.ts:52` mints `randomUUID()` → non-idempotent).

**What `register.ts` does that the seed replicates deterministically** (`register.ts:21-42` `insertMediaRow`):
```typescript
const key = originalKey(orgId, projectId, mediaId, ext); // packages/storage/src/keys.ts:10
await withTenant(orgId, (tx) =>
  tx.insert(schema.media).values({ id: mediaId, organizationId: orgId, projectId, originalKey: key })
    .onConflictDoNothing(),  // seed ADDS onConflictDoNothing (register.ts has none)
);
```

**R2 client — MUST use `makeR2Client(env)`** (`r2-client.ts:25-38`), never `new S3Client()` (Pitfall 1: `requestChecksumCalculation/responseChecksumValidation: "WHEN_REQUIRED"` opt-out, else R2 400 XAmzContentSHA256Mismatch). PutObject with `new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType })`.

**Enqueue — compose `runtime.ts:72-118` primitives directly** (build own `Queue`/`IORedis` since api is off-limits):
```typescript
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const queue = new Queue(MEDIA_QUEUE, { connection });          // storage/src/queue.ts:12
const job: MediaJobData = { mediaId, organizationId: orgId, projectId, originalKey: key };
await queue.add("process", job, mediaJobOptions(mediaId));      // queue.ts:29 jobId=mediaId dedup
```

**Wait + assert (D-05 fail-fast waiter)** — reuse `resolveMedia` (`resolve-media.ts:57-91`), which the worker (`apps/worker/src/media.ts:142` `writeVariants`) fills:
```typescript
const resolved = resolveMedia(row, { publicBaseUrl: process.env.R2_PUBLIC_BASE_URL! });
if (!resolved.isReady) throw new Error(`media ${mediaId} not processed — is apps/worker running?`);
```
`isReady` = `variants` non-empty (`resolve-media.ts:86`). Poll each row with a bounded timeout (~90s); timeout ⇒ explicit "worker not consuming MEDIA_QUEUE" error. Skip-if-processed: `SELECT variants` first, skip PutObject+enqueue when already ready.

**Key conventions:** deterministic `mediaId = seedId(...)`; `originalKey`/`variantKey` already deterministic (overwrite in place); worker write-back is an UPDATE (idempotent).

---

### `packages/db/src/seed/prerequisites.ts` (middleware, startup guard)

**Analogs:** `migrate.ts:32-39` (fail-loud, var NAME not value) + `runtime.ts:50-61` (fail-closed env validation) + `runtime.ts:100-113` (`headOriginal` HeadObject reachability probe pattern) + `partitions.ts:124-129` (owner-URL guard).

**Pattern to build** (D-05): parse required env (`DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL`, `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL`, `REDIS_URL`) → report ALL missing var NAMES (never values, V7) → probe R2 (`HeadBucket` via `makeR2Client`) and Redis (`PING` via `IORedis`) → throw a single explicit "what is missing + how to provide it" error and abort BEFORE any write. Never warn-and-continue.

---

### `packages/db/src/seed/assets/` + `LICENSES.md` (static assets, file-I/O)

**Analog:** none (new committed input). Follow RESEARCH Pattern 5 §264-272: ~8-15 curated free-license images (Unsplash/Pexels/CC0) committed in-repo, ~150-400 KB each, read as bytes at seed time. `LICENSES.md` records filename, source URL, license, author per asset (satisfies D-03). Do NOT download at build time.

---

### `packages/db/tests/seed.*.test.ts` (test, integration)

**Analog:** `packages/db/tests/db.ts` harness (`connectAs`/`ownerUrl`/`appUrl`/`anonUrl`, `_test`-DB guard) + `tests/helpers.ts` fixture style. No new framework install (Vitest 4.1.8 already configured, `packages/db/vitest.config.ts`).

**Three files** (RESEARCH Wave-0 gaps §516-519):
- `seed.idempotency.test.ts` — run `runSeed()` twice, assert per-table `count(*)` equality (SEED-04, the non-negotiable gate).
- `seed.content.test.ts` — composition/pricing/leads ranges + money-integer + ≥2 populated monthly partitions (SEED-01/02/03).
- `seed.media.test.ts` — env-gated (`describe.skipIf` without R2/worker) real-pipeline `resolveMedia().isReady` (SEED-03/D-04).

---

### `packages/db/package.json` (MODIFY) + root `package.json`

**Analog:** the existing `db:migrate:deploy` script line (`packages/db/package.json:14`):
```jsonc
"db:migrate:deploy": "node --experimental-strip-types migrate.ts"
```
Add the sibling: `"db:seed": "node --experimental-strip-types seed.ts"`. Add deps (RESEARCH §102-108): `uuid@11.1.1` (+ `@types/uuid` if needed), `bullmq@5.78.1`, `ioredis@5.10.1`, `@aws-sdk/client-s3@3.1076.0` — matching api's exact versions so the lockfile stays consistent. Root `package.json` currently has NO `db:*` passthrough; add `"db:seed": "pnpm --filter @imbau/db db:seed"` (SEED-04 discoverability) and document prerequisites in `## Comandos`.

---

## Shared Patterns

### Deterministic idempotency (applies to EVERY insert)
**Source:** RESEARCH Pattern 1 + `uuid` v5. **Apply to:** all seed row modules.
```typescript
import { v5 as uuidv5 } from "uuid";
export const SEED_NS = "b1a7c0de-0000-4000-8000-000000000000";
export const seedId = (name: string) => uuidv5(name, SEED_NS);
// every insert:
tx.insert(schema.X).values(rows).onConflictDoNothing()  // PK conflict → no-op on re-run
```
Only `cac_index` may target its natural key `(organizationId, periodo)`; all others conflict on PK `id`. NEVER `randomUUID`/`Math.random`/`Date.now` (use a `SEED_REFERENCE_DATE` constant + `makePrng` for jitter).

### RLS-correct tenant writes
**Source:** `packages/db/src/with-tenant.ts:22-34`. **Apply to:** all rows except the `organization` root + events partition DDL.
```typescript
await withTenant(orgId, (tx) =>
  tx.insert(schema.floors).values(rows).onConflictDoNothing(),
);
```
Sets `app.current_organization_id` GUC (parameterized), runs as `app_authenticated`; exercises production `*_tenant` `withCheck (organization_id = GUC)`. Owner pool (`createOwnerDb`, `client.ts:28-31`) is used ONLY for the `organization` insert (tenant root, not parent-scoped — matches `makeOrg` `helpers.ts:49-60`) and the events partition DDL.

### Composite FK insertion order
**Source:** every schema `foreignKey({ columns: [t.parentId, t.organizationId] })` block + RESEARCH Pattern 4. **Apply to:** all row modules. Insert parents before children; always set the same denormalized `organizationId` on every child, or the `(id, organization_id)` composite FK rejects the insert.

### Money & measure typing (CLAUDE.md non-negotiable)
**Source:** `helpers.ts` + Pitfall 6. **Apply to:** building + pricing modules.
- INTEGER (JS number): `unit_prices.precio`, `Refuerzo.montoUsd` — whole USD, never floats.
- STRING (postgres-js maps `numeric`→string): `units.m2`, `payment_plans.anticipoPct`, `cac_index.valor`.

### JSONB payload validation before insert
**Source:** `packages/db/src/schema/json-schemas.ts` + drizzle-zod insert schemas. **Apply to:** pricing (`refuerzoSchema`) + content-rows (`leadNoteSchema`) + any `quotes.snapshot` (`quoteSnapshotSchema` `{version:1}`). Even seed data passes the boundary validators (ASVS V5).

### Events partition pre-create (owner DDL)
**Source:** `apps/worker/src/partitions.ts:94-99` (`renderCreatePartitionSql`) + `:140` (`sql.unsafe(ddl)`). **Apply to:** seed bootstrap before inserting cross-month events.
```typescript
`CREATE TABLE IF NOT EXISTS "events_YYYY_MM" PARTITION OF "events" FOR VALUES FROM ('<from>') TO ('<to>')`
```
Run via owner pool (`IF NOT EXISTS` = idempotent); pre-create the target months so D-07 events route to ≥2 real monthly partitions, not just DEFAULT.

### Fail-fast, secret-safe errors
**Source:** `migrate.ts:34-38`, `runtime.ts:16` (names-not-values), `client.ts:5-8`. **Apply to:** `prerequisites.ts` + `seed.ts`. Report missing var NAMES only, never values; never log R2 keys/secrets; errors propagate (never swallowed).

## No Analog Found

None. Every file reuses an in-repo pattern. The only genuinely new artifacts are content constants (`content.ts`, authored per D-01/D-06/D-07) and the committed image assets (`assets/`, per Pattern 5) — both are data, not code patterns, so they need no code analog.

## Metadata

**Analog search scope:** `packages/db/{migrate.ts, src/, tests/}`, `packages/api/src/media/`, `packages/storage/src/`, `apps/worker/src/`.
**Files scanned:** migrate.ts, with-tenant.ts, client.ts, resolve-media.ts, tests/helpers.ts, tests/db.ts, register.ts, runtime.ts, queue.ts, keys.ts, r2-client.ts, worker media.ts + partitions.ts, 12 schema modules (floors/units/price-lists/unit-prices/payment-plans/cac-index/leads/galleries/progress-posts/brokers/events/enums/json-schemas), packages/db/package.json.
**Pattern extraction date:** 2026-07-01
