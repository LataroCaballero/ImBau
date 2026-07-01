# Phase 3: Seed del edificio ficticio - Research

**Researched:** 2026-07-01
**Domain:** Deterministic/idempotent database seeding (Drizzle + Postgres RLS) with a real media pipeline (R2 + BullMQ worker) in a pnpm/Turborepo monorepo
**Confidence:** HIGH (schema + pipeline verified by direct code read; library facts verified on npm)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fidelidad / realismo**
- **D-01: Demo-grade creíble, no fixture mínimo.** Nombres, mix de tipologías, copy es-AR y precios coherentes y plausibles para Recoleta; la data debe poder mostrarse en panel/web sin retoque posterior.
- **D-02: Composición "torre Recoleta típica".** PB con amenities/locales, ~2-4 unidades por piso, mix de tipologías (monoambiente + 1/2/3 ambientes, semipiso/penthouse en los últimos pisos), ~30-40 unidades en total. Distribución de estados con **curva de venta realista de pozo** (bajos más `vendido`, medios `reservado`/`disponible`, altos premium más `disponible`). Orientaciones/m2/ambientes variados y coherentes con la tipología.

**Media de galerías**
- **D-03: Imágenes de stock libre curado.** Fotos libres de arquitectura/interiores estilo Recoleta, referenciadas de forma determinista. Documentar procedencia/licencia.
- **D-04: Media sembrada por el PIPELINE REAL R2 + worker.** El seed sube bytes originales a R2 (PutObject directo) y encola procesamiento; el worker genera variantes AVIF/WebP + blurhash/dims reales. Camino end-to-end; se descartan filas `media` pre-horneadas y el híbrido por-entorno.
- **D-05: Fail-fast claro si falta infra.** Sin R2/worker disponibles, la fase de media valida prerequisitos al arrancar y aborta con error explicativo (qué falta, cómo proveerlo). La media es parte del seed demo-grade, no opcional. La doc del comando lista prerequisitos (R2 creds + worker corriendo).

**Pricing y CAC**
- **D-06: Dos price_lists — "Contado" (USD, con descuento) y "Financiado" (USD, precio lista).** ~USD 2.500-3.500/m2 ajustado por piso/orientación/tipología. `payment_plans`: anticipo ~30% + saldo en cuotas con ajuste **CAC** + refuerzos semestrales (JSONB `Refuerzo[]`, montos USD enteros). `cac_index` con histórico de **12-24 meses** de valores decimales realistas. Dinero en enteros USD / decimal.

**Leads/events de muestra**
- **D-07: Narrativa realista variada.** ~10-20 `leads` en distintos estados (`nuevo`/`contactado`/`negociacion`/`cerrado`) con `timeline` (append-only `LeadNote[]`), algunos vía `broker` y otros directos/WhatsApp, distintos orígenes. `events` distribuidos en los últimos ~2-3 meses **cruzando límites de partición mensual**. Sembrar algunos `brokers` con slug/whatsapp/email realistas.

### Claude's Discretion (técnico — delegado)
- **Mecanismo de idempotencia (SEED-04):** UUIDs determinísticos vs upsert por clave natural vs pre-check + skip. → **Ver §Architecture Pattern 1.**
- **⚠ Tensión media + idempotencia:** `registerAndEnqueue` mintea `randomUUID()` (register.ts:52) → no determinista. → **Ver §Architecture Pattern 2 (resolución concreta).**
- **Estructura/ubicación del script + `pnpm db:seed`; owner pool para bootstrap vs `withTenant`; orden de inserción respetando FKs compuestas.** → **Ver §Architecture Pattern 3 + Pattern 4.**
- **Bytes de las imágenes: commiteados vs descargados; PutObject directo a R2.** → **Ver §Architecture Pattern 5.**

### Deferred Ideas (OUT OF SCOPE)
- **Material real de Pablo (Branch B)** — post-reunión, sin re-seed estructural.
- **Motor de cotización (`packages/quoting`) + forma interna de `quotes.snapshot`** — próximo milestone; el seed solo deja pricing/payment_plans/cac_index consumibles.
- **Superficies de producto** (panel CRUD, web, explorador, ficha, métricas, alertas) — fases futuras.
- **Scraping automático del CAC** — carga manual (histórico a mano en el seed).
- **Alcance multi-tenant del seed** (segundo org / proyecto `borrador`) — opcional para el planner, no requisito.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEED-01 | Edificio "Brigos Recoleta" ~13 pisos — org, proyecto `publicado`, floors + units realistas (tipologías, m2, orientaciones, estados variados) | Pattern 3 (bootstrap owner→withTenant), Pattern 4 (insertion order), Pattern 6 (es-AR content generation), Don't-Hand-Roll (deterministic ids) |
| SEED-02 | Pricing realista — price_lists (contado/financiado), unit_prices, payment_plans c/CAC, cac_index histórico | Pattern 4 (order + composite FKs), Pattern 7 (money/decimal rules), Code Examples (Refuerzo[] JSONB, cac_index natural key) |
| SEED-03 | Contenido — progress_posts, galleries con media, brokers, leads/events | Pattern 2 (idempotent real-pipeline media), Pattern 4 (events partition pre-create + cross-month), Pattern 6 (lead/event narrative) |
| SEED-04 | `pnpm db:seed` idempotente y re-ejecutable (no duplica filas), documentado | Pattern 1 (deterministic-UUID + onConflictDoNothing), Validation Architecture (row-count invariance test), Pattern 3 (script wiring + docs) |
</phase_requirements>

## Summary

This is a **DATA/FIXTURE phase**: no schema changes, no product surfaces, no quoting engine. The seed populates the 16 tables already shipped in Phase 1 against the RLS-correct helpers (`withTenant`, `createOwnerDb`) and the media primitives factored in Phase 2, using stock imagery run through the **real** R2 + worker pipeline. The entire technical difficulty reduces to four decisions, all delegated to the builder and all resolved below: (1) how to make re-runs insert zero duplicate rows, (2) how to make media seeding idempotent when the existing `registerAndEnqueue` mints a random `mediaId`, (3) where the script lives and how it gets owner-vs-tenant DB access, and (4) how to generate credible es-AR content deterministically.

The dominant finding is that **almost no table has a business-level unique constraint** (units.identificador, floors.numero, price_lists.nombre, brokers.slug are all NON-unique; only `organization.slug` and `cac_index(organization_id, periodo)` are unique). Upsert-by-natural-key therefore does **not** generalize. The correct, uniform idempotency mechanism is **deterministic UUIDv5 ids (fixed namespace) + `.onConflictDoNothing()` on the primary key** for every row — including media, whose `mediaId` becomes deterministic and thus stops duplicating rows and R2 objects on re-run. This also composes with the pipeline's existing determinism (`originalKey`/`variantKey` are already deterministic; the worker's write-back is an UPDATE, not an INSERT), so a full re-run is idempotent end-to-end.

**Primary recommendation:** Build a standalone Node script at `packages/db/seed.ts` (mirroring `migrate.ts`), exposed as `db:seed`. Bootstrap `organization` via the owner/superuser pool (`createOwnerDb(DATABASE_URL)`, identical to `makeOrg`); write every tenant-scoped row via `withTenant(orgId, …)`. Assign every id via `uuidv5(name, NS)`; guard every insert with `.onConflictDoNothing()`. For media, do NOT call `registerAndEnqueue` (non-deterministic) — compose the existing storage primitives (`makeR2Client` + `PutObjectCommand`, `originalKey`, `mediaJobOptions`, `MEDIA_QUEUE`, `MediaJobData`) with a deterministic `mediaId`, then poll `media.variants` until the worker fills them (this doubles as the D-05 fail-fast "worker running" proof). Commit a small curated stock-image set in-repo with a license manifest.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Org/project bootstrap (SEED-01) | DB / owner pool | — | `organization` is the tenant root and is not parent-scoped; owner (superuser) bypasses FORCE RLS exactly as `makeOrg` does today |
| Catalog + pricing + content rows (SEED-01/02/03) | DB / app pool via `withTenant` | — | Exercises the real `app_authenticated` + GUC write path (`projects_tenant` withCheck); proves seeded data is writable through production RLS, not just as owner |
| Media byte upload (SEED-03/D-04) | Storage / R2 (S3 PutObject) | Seed script (producer) | Bytes land at a deterministic server-derived key before the row/job exist |
| Media processing (SEED-03/D-04) | Worker (`apps/worker`) | BullMQ queue | Variants/blurhash/dims are CPU work owned by the worker; the seed is only the producer + waiter |
| Idempotency guarantee (SEED-04) | Seed script (deterministic ids) | DB (`onConflictDoNothing`) | Determinism is authored in the script; the DB enforces no-duplicate on the PK |
| es-AR content authorship (D-01/D-02/D-06/D-07) | Seed script (curated constants + seeded PRNG) | — | Demo-grade credibility is a content decision, not a library output |
| Fail-fast prerequisite check (D-05) | Seed script (startup guard) | R2 + Redis reachability | Aborts before any partial write if infra is missing |

## Standard Stack

Everything needed already exists in the repo except one small utility. **No stack changes** — this fully honors CLAUDE.md's "stack decidido, no proponer alternativas."

### Core (already in the tree — reuse, do not re-add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `0.45.2` | Inserts + `.onConflictDoNothing()` + `withTenant` transactions | [VERIFIED: packages/db/package.json] The only sanctioned query layer |
| `postgres` (porsager) | `3.4.9` | Driver behind app/anon/owner pools | [VERIFIED: packages/db/package.json] numeric→string mapping (money rule) |
| `@aws-sdk/client-s3` | `3.1076.0` | Direct `PutObject` of original bytes to R2 | [VERIFIED: packages/api/package.json] Same version the pipeline uses |
| `bullmq` | `5.78.1` | Enqueue media jobs (producer side) | [VERIFIED: packages/api/package.json] `mediaJobOptions(jobId=mediaId)` dedup |
| `ioredis` | `5.10.1` | Redis connection for BullMQ | [VERIFIED: packages/api/package.json] `maxRetriesPerRequest: null` required |
| `zod` | `4.4.3` | Validate JSONB payloads (`Refuerzo[]`, `LeadNote[]`, `{version:1}`) before insert | [VERIFIED: packages/db/package.json] Co-located schemas in `json-schemas.ts` |
| `@imbau/storage` | workspace | `makeR2Client`, `originalKey`, `variantKey`, `MEDIA_QUEUE`, `mediaJobOptions`, `MediaJobData` | [VERIFIED: packages/storage/src] Cycle-safe (no bullmq dep); inherits CRC32 opt-out |
| `@imbau/db` | workspace | `withTenant`, `createOwnerDb`, `schema`, `resolveMedia` | [VERIFIED: packages/db/src] The RLS-correct data layer |

### Supporting (the one new dependency)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | **pin `11.1.1`** (NOT `latest`/14.x) | `uuidv5(name, NAMESPACE)` → deterministic ids for every seeded row | [VERIFIED: npm registry] Canonical UUID lib (270M downloads/wk, since 2011, MIT, zero deps, no postinstall). **Pin v11.1.1**: `latest` is 14.0.1 (published 2026-06-20) which the legitimacy seam flags `too-new`; v11.1.1 (2025-02, `legacy-11` dist-tag) is the mature, established line. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `uuid` v5 dependency | Hand-roll UUIDv5 via `node:crypto` sha1 + version/variant bit-twiddling | ~10 lines of RFC-4122 bit manipulation; classic "don't hand-roll" footgun. `uuid@11` is 3kB, MIT, zero-dep. **Use the library.** |
| `@faker-js/faker` (`10.5.0`) with `faker.seed()` | Curated es-AR content constants + a tiny seeded PRNG (mulberry32, ~5 lines) | Faker has no `es_AR` locale (only `es`/`es_MX`); generic street/company names read as filler, contradicting D-01 "demo-grade sin retoque". **Prefer curated content + seeded PRNG for numeric jitter.** Faker is optional only if bulk name variety is wanted later. |
| Deterministic-UUID + `onConflictDoNothing` | Upsert by natural key | Only `organization.slug` and `cac_index(org_id, periodo)` have unique constraints; the other 13 tables don't — natural-key upsert can't generalize. |
| `withTenant` for org bootstrap | Owner pool for org bootstrap | Both work (app has INSERT on `organization` and withCheck `id = GUC` passes when GUC=new org id); owner is the established `makeOrg` pattern and avoids granting assumptions. **Use owner for the org row, `withTenant` for everything downstream.** |

**Installation:**
```bash
pnpm --filter @imbau/db add uuid@11.1.1
pnpm --filter @imbau/db add -D @types/uuid   # if types not bundled in this line
# bullmq / ioredis / @aws-sdk/client-s3 must be added to @imbau/db so the seed can
# produce jobs + PutObject WITHOUT importing @imbau/api (see Pattern 3 — cycle avoidance):
pnpm --filter @imbau/db add bullmq@5.78.1 ioredis@5.10.1 @aws-sdk/client-s3@3.1076.0
```

**Version verification (done this session):**
- `npm view uuid version` → `14.0.1` (latest); `uuid@11` line → `11.1.1` (pin this). MIT, `deps: none`, `postinstall: null`. [VERIFIED: npm registry, 2026-07-01]
- `bullmq 5.78.1`, `ioredis 5.10.1`, `@aws-sdk/client-s3 3.1076.0` — copy the EXACT versions already resolved in `packages/api/package.json` so the lockfile stays consistent. [VERIFIED: packages/api/package.json]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `uuid` (pin `11.1.1`) | npm | package since 2011; v11.1.1 since 2025-02 | ~270M/wk | github.com/uuidjs/uuid | `SUS` (reason: `too-new`, applies to the `14.0.1` latest tag only) → **downgraded to OK by pinning v11.1.1** | Approved at `11.1.1` |
| `bullmq` | npm | existing repo dep | — | github.com/taskforcesh/bullmq | OK | Approved (reuse api's version) |
| `ioredis` | npm | existing repo dep | — | github.com/redis/ioredis | OK | Approved (reuse api's version) |
| `@aws-sdk/client-s3` | npm | existing repo dep | — | github.com/aws/aws-sdk-js-v3 | OK | Approved (reuse api's version) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `uuid` — the `too-new` signal is against the freshly-published v14 major, NOT the package. Pinning the mature `11.1.1` (`legacy-11` dist-tag, MIT, zero-dep, no postinstall, 270M downloads/wk) resolves it. The planner does **not** need a `checkpoint:human-verify` for `uuid@11.1.1`; it is the canonical, universally-used UUID library. If the planner prefers zero new dependencies, the hand-rolled `node:crypto` UUIDv5 alternative (see Alternatives) removes it entirely.

## Architecture Patterns

### System Architecture Diagram

```
                          pnpm db:seed  (packages/db/seed.ts, standalone Node)
                                   │
                 ┌─────────────────┼──────────────────────────────────────────┐
                 │ 0. FAIL-FAST PREREQUISITE GUARD (D-05)                       │
                 │    parse env (DATABASE_*, R2_*, REDIS_URL) → names only      │
                 │    R2 reachable? (HeadBucket)   Redis reachable? (PING)      │
                 │    ── missing → throw explicit "what/how" error, abort ──    │
                 └─────────────────┬──────────────────────────────────────────┘
                                   │ all deterministic ids = uuidv5(name, NS)
   ┌───────────────────────────────┼───────────────────────────────────────────┐
   │ 1. OWNER POOL  createOwnerDb(DATABASE_URL)                                  │
   │      • INSERT organization  .onConflictDoNothing()   (superuser: bypass RLS)│
   │      • pre-create events_YYYY_MM partitions for target months (idempotent)  │
   └───────────────────────────────┬───────────────────────────────────────────┘
                                   │ orgId known
   ┌───────────────────────────────┼───────────────────────────────────────────┐
   │ 2. withTenant(orgId, tx => …)  — app_authenticated + GUC, RLS-correct       │
   │    projects(publicado) → floors → units → price_lists → payment_plans →     │
   │    unit_prices → cac_index → brokers → progress_posts → leads → quotes →     │
   │    events   [each row: deterministic id + .onConflictDoNothing()]           │
   └───────────────────────────────┬───────────────────────────────────────────┘
                                   │ for each stock image asset (deterministic mediaId)
   ┌───────────────────────────────┼───────────────────────────────────────────┐
   │ 3. MEDIA (real pipeline, D-04)                                              │
   │    a. read committed bytes  → PutObject(originalKey(org,proj,mediaId,ext))  │
   │       via makeR2Client (CRC32 opt-out inherited)   [idempotent overwrite]   │
   │    b. withTenant: INSERT media{id:mediaId,…}.onConflictDoNothing()          │
   │    c. enqueueMedia(job, jobId=mediaId)  → MEDIA_QUEUE                        │
   └───────────────────────────────┬───────────────────────────────────────────┘
                                   │            ┌──────────────────────────────┐
                                   └──────────► │ apps/worker  processMedia()   │
                                                │  getOriginal → renderVariants │
                                                │  → putVariant(variantKey…)    │
                                                │  → writeVariants (withTenant  │
                                                │    UPDATE media.variants/…)   │
                                                └──────────────┬───────────────┘
   ┌───────────────────────────────────────────────────────────┼───────────────┐
   │ 4. WAIT + ASSERT: poll media.variants until non-empty (bounded timeout).    │
   │    timeout ⇒ "worker not running" fail-fast.  resolveMedia(row) ⇒ isReady.  │
   │    galleries(imagenes:[mediaId…]) + progress_posts(mediaId) reference media. │
   └─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/db/
├── seed.ts                    # standalone entry (mirrors migrate.ts); the db:seed target
├── src/seed/
│   ├── ids.ts                 # NAMESPACE + uuidv5 helpers + seeded PRNG (mulberry32)
│   ├── content.ts             # curated es-AR constants: building, floors, typologies,
│   │                          #   amenity copy, broker names, lead narratives, CAC series
│   ├── building.ts            # generateFloors/generateUnits (curva de venta, m2, orientación)
│   ├── pricing.ts             # price_lists + unit_prices + payment_plans + cac_index
│   ├── content-rows.ts        # progress_posts + galleries + brokers + leads + events
│   ├── media.ts               # deterministic PutObject + insert + enqueue + poll (Pattern 2)
│   └── prerequisites.ts       # D-05 fail-fast guard (env + R2 + Redis reachability)
│   └── assets/                # committed stock images + LICENSES.md manifest (Pattern 5)
```

### Pattern 1: Deterministic UUIDv5 ids + `onConflictDoNothing` (SEED-04 — the idempotency core)

**What:** Every seeded row's id is derived by name, not random: `uuidv5("brigos:unit:04-B", NAMESPACE)`. Every insert ends with `.onConflictDoNothing()`. A re-run computes the SAME ids → the PK conflict makes each insert a no-op → row counts are invariant.

**Why this over natural-key upsert:** verified by reading all 16 schema modules — the only DB-level unique constraints are `organization.slug` (unique), `cac_index UNIQUE(organization_id, periodo)`, and the structural `UNIQUE(id, organization_id)` pairs (which are just the PK + tenant). `units.identificador`, `floors.numero`, `price_lists.nombre`, `brokers.slug`, `unit_prices`, `payment_plans.nombre`, `leads`, `galleries`, `media`, `progress_posts` have **no** business unique key. Natural-key upsert cannot generalize; deterministic-id + PK-conflict is uniform across all tables.

**Example:**
```typescript
// Source: uuid v11 docs + drizzle-orm onConflict; NAMESPACE is a fixed constant you author once.
import { v5 as uuidv5 } from "uuid";
export const SEED_NS = "b1a7c0de-0000-4000-8000-000000000000"; // any fixed valid UUID
export const seedId = (name: string) => uuidv5(name, SEED_NS);

await withTenant(orgId, (tx) =>
  tx.insert(schema.floors).values(rows).onConflictDoNothing(), // conflict on PK id → no-op on re-run
);
```
`cac_index` may alternatively conflict on its natural key: `.onConflictDoNothing({ target: [schema.cacIndex.organizationId, schema.cacIndex.periodo] })`. `events` PK is composite `(id, ts)` — deterministic id + fixed ts, conflict target `(events.id, events.ts)` if a target is specified (bare `.onConflictDoNothing()` also works).

### Pattern 2: Idempotent media through the REAL pipeline (resolves the ⚠ tension)

**The tension (verified):** `registerAndEnqueue` (`packages/api/src/media/register.ts:52`) calls `randomUUID()` for `mediaId`. `insertMediaRow` (same file, lines 21-42) does a plain `tx.insert(schema.media)` with **no** `onConflict`. So calling `registerAndEnqueue` in the seed would, on every run, (a) mint a new id, (b) insert a NEW media row, and (c) enqueue a NEW job that re-uploads to R2 — duplicating rows and objects. **Do not call `registerAndEnqueue` from the seed.**

**Resolution — compose the lower-level primitives with a deterministic `mediaId`:**

First run:
1. `mediaId = seedId("brigos:media:amenities-pileta")` (deterministic).
2. `key = originalKey(orgId, projectId, mediaId, "jpg")` (already deterministic — `packages/storage/src/keys.ts`).
3. `PutObject({ Bucket, Key: key, Body: bytes })` via `makeR2Client(env)` (inherits the CRC32 `WHEN_REQUIRED` opt-out — R2 rejects the default trailer).
4. `withTenant(orgId, tx => tx.insert(schema.media).values({ id: mediaId, organizationId, projectId, originalKey: key }).onConflictDoNothing())`.
5. `enqueueMedia`-equivalent: `queue.add("process", { mediaId, organizationId, projectId, originalKey: key } satisfies MediaJobData, mediaJobOptions(mediaId))` — `jobId = mediaId` dedups.
6. Worker `processMedia` downloads once, `renderVariants`, `putVariant(variantKey(mediaId,…))` (deterministic keys → overwrite in place), then a **single `withTenant` UPDATE** of `variants/blurhash/width/height` (an UPDATE, not INSERT — inherently idempotent).

Re-run:
1-2. Same `mediaId`/`key`. 3. PutObject overwrites the same object (or skip via `headOriginal(key)` returning true). 4. Insert is a no-op (`onConflictDoNothing`). 5. `jobId=mediaId` dedups the enqueue; and step 7 below skips it entirely. 6. If it does reprocess, it overwrites the same variant keys and re-UPDATEs the same row — still zero new rows.

7. **Skip-if-processed optimization (also the fail-fast waiter):** before enqueue, `SELECT variants FROM media WHERE id = mediaId`; if non-empty (`resolveMedia(row).isReady === true`), the asset is already processed — skip PutObject+enqueue. After enqueueing the not-yet-ready assets, **poll each media row until `variants` is non-empty, with a bounded timeout (e.g. 90s)**. Timeout ⇒ throw "worker is not consuming MEDIA_QUEUE — is `apps/worker` running?" (D-05). Success ⇒ the seed guarantees a demo-ready, fully-resolvable media set synchronously.

**Net:** row-count invariant, R2-object invariant, exercises the real pipeline end-to-end, and Phase 2 code is untouched.

### Pattern 3: Script location, `db:seed` wiring, and the dependency-cycle constraint

**Location:** `packages/db/seed.ts` (standalone Node script, mirrors `packages/db/migrate.ts`). Add to `packages/db/package.json` scripts:
```jsonc
"db:seed": "node --experimental-strip-types seed.ts"   // same runner style as db:migrate:deploy
```
Expose a root passthrough in the root `package.json` (currently absent — SEED-04 requires it) or document `pnpm --filter @imbau/db db:seed`. Recommend a root script `"db:seed": "pnpm --filter @imbau/db db:seed"` for discoverability, plus README/`## Comandos` documentation listing prerequisites (compose up Postgres + Redis + worker; R2 creds in env).

**⚠ Cycle constraint (verified):** `@imbau/api` depends on `@imbau/db` (`register.ts` imports `withTenant`, `schema`). Therefore the seed, living in `@imbau/db`, **must NOT import `@imbau/api`** — that would create a `db ↔ api` package cycle. This is exactly why Pattern 2 composes `@imbau/storage` primitives + `bullmq`/`ioredis`/`@aws-sdk/client-s3` directly instead of calling `registerAndEnqueue`. The ~10-line enqueue/PutObject duplication is the deliberate cost of staying acyclic. (Deferred cleanup option, out of scope: push the enqueue primitive down into `@imbau/storage` so both api and seed share it — not required this phase.)

**DB access (owner vs tenant):** the seed process imports `@imbau/db`, whose `client.ts` builds the app + anon pools at import from `DATABASE_APP_URL`/`DATABASE_ANON_URL` (env fails closed on all three). So the seed env must carry `DATABASE_URL` (owner), `DATABASE_APP_URL`, `DATABASE_ANON_URL`, plus `R2_*` and `REDIS_URL`.
- **Owner pool** (`createOwnerDb(process.env.DATABASE_URL)`): insert the `organization` row (the tenant root — not parent-scoped) and run events partition pre-create DDL. This mirrors `makeOrg` in `packages/db/tests/helpers.ts`, which seeds `organization` via the owner. The owner/migration role is the superuser that runs `CREATE ROLE`/`FORCE ROW LEVEL SECURITY` in the migrations, so it bypasses RLS for setup. *(See Assumptions A1 — if a non-superuser owner is ever used, wrap the org insert in `withTenant(ORG_ID)` since `organization_self.withCheck` is `id = GUC`.)*
- **`withTenant(orgId, …)`** (app pool): every tenant-scoped domain row. Exercises the `app_authenticated` + `set_config('app.current_organization_id', …, true)` GUC path and the `*_tenant` `withCheck` policies — proving the seeded data is writable through production RLS, not merely as owner.

### Pattern 4: Insertion order (hierarchical composite FKs) + events partitions

The composite FKs `(parent_id, organization_id)` (Phase 1 D-02) force a strict order — a child insert with a mismatched or not-yet-present parent is rejected by the DB, not a trigger. Verified order:

```
organization (owner)
  └─ projects (estado='publicado')
       ├─ floors ──────────► units (FK→projects AND FK→floors, both share organization_id)
       ├─ price_lists ─────┐
       ├─ payment_plans    │
       │                   └─► unit_prices (FK→projects, →units, →price_lists — all share org_id)
       ├─ cac_index (org-scoped, NO project_id; UNIQUE(org_id, periodo))
       ├─ brokers ─────────► leads (optional FK→units, →brokers; nullable MATCH SIMPLE)
       ├─ media ───────────► galleries.imagenes[]=mediaId, progress_posts.mediaId  (plain uuid refs, no FK)
       ├─ quotes (optional; snapshot={version:1}; FK→units,→payment_plans)
       └─ events (partitioned; FK→projects; unitId/brokerId are plain nullable, NO FK)
```

**Events partitioning (SEED-03 + D-07 cross-month requirement):** `events` is `PARTITION BY RANGE (ts)`, one partition per month `events_YYYY_MM`, plus a DEFAULT catch-all (migration `0003_rls_domain.sql`). Migration ships the initial + next-month partitions; older months land in DEFAULT (still insertable/queryable). To genuinely exercise per-month partitioning across "últimos ~2-3 meses," **pre-create the target monthly partitions idempotently** via the owner pool before inserting events, reusing the exact DDL style of `apps/worker/src/partitions.ts` (`CREATE TABLE IF NOT EXISTS "events_YYYY_MM" PARTITION OF "events" FOR VALUES FROM ('…') TO ('…')`). Insert events with fixed `ts` values spread across ≥2 distinct months so the validation asserts real partition routing. Insert events via `withTenant` (the `events` tenant policy `withCheck` is `org = GUC`). Note `events` is excluded from `drizzle.config.ts` but its `schema.events` object exists for typed inserts.

### Pattern 5: Committed stock images + license manifest (D-03/D-04/D-05)

**What:** Commit a small curated set of free-license architecture/interior/exterior photos in-repo under `packages/db/src/seed/assets/`, each read as bytes at seed time and PutObject'd to R2 (Pattern 2). Do **not** download at seed/build time.

**Why committed, not downloaded:** determinism (D-03) and reproducibility — a network fetch introduces flakiness, URL rot, and license drift, and would make `pnpm db:seed` fail in offline/CI without cause. Bytes-in-repo make the asset set a fixed, reviewable input.

**Sourcing + provenance:** use **Unsplash License**, **Pexels License**, or **CC0/Openverse/Wikimedia** imagery (all permit commercial use). Curate ~8-15 images spanning amenities/exteriores/interiores + obra/avance. Prefer images without recognizable people or trademarks. Keep each modest (~150-400 KB, downscaled source ~1600-2000px — the worker regenerates variants anyway). Record every asset in `assets/LICENSES.md`: filename, source URL, license, author/attribution. This satisfies D-03's "documentar la procedencia/licencia."

**Sizing note:** total asset payload stays a few MB — acceptable committed to git; use git-lfs only if it grows unexpectedly. [ASSUMED — see A2]

### Pattern 6: Deterministic es-AR content generation (D-01/D-02/D-07)

**What:** Author demo-grade content as **curated constants** (building name, floor labels, typology mix, amenity copy, broker identities, lead narratives + timelines, progress-post copy, CAC series) in `src/seed/content.ts`, and use the seeded PRNG (`makePrng`) only for controlled numeric variation (m2 by typology, price adjustment by floor/orientation, `orden`).

**Pozo sale curve (D-02):** distribute `estado` by floor band, not at random — low floors weighted `vendido`, mid floors `reservado`/`disponible`, high/premium floors mostly `disponible`. Implement as a deterministic mapping `floorNumero → weighted estado` seeded by the PRNG so it's stable across runs.

**Typology coherence:** derive `ambientes`/`m2`/`orientacion` from the typology label (monoambiente ~30-38 m², 1-amb ~40-50, 2-amb ~55-70, 3-amb ~85-110, semipiso/penthouse larger) so units read credibly. All copy in es-AR voseo (CLAUDE.md: UI/data en español, identificadores en inglés).

**Why not faker:** no `es_AR` locale; generated names/streets read as filler and violate D-01 "mostrar sin retoque." Curated content is the credibility lever here.

### Pattern 7: Money & measure typing (D-06 / CLAUDE.md non-negotiable)

**What:** Integer USD for prices; `numeric` (driver strings) for measures/rates.
- `unit_prices.precio`, `Refuerzo.montoUsd` → **JS integers** (whole USD). Never floats.
- `units.m2`, `payment_plans.anticipoPct`, `cac_index.valor` → **strings** (postgres-js maps `numeric`→string; see `helpers.ts`: `anticipoPct: "30"`, `valor: "1234.5678"`).
- Validate `Refuerzo[]` via `refuerzoSchema.parse` before insert (both `cuota` and `montoUsd` are `z.number().int()`).
- `payment_plans.ajuste = "CAC"`, `refuerzos` = semestral balloons; `cac_index` = 12-24 monthly rows, `UNIQUE(organization_id, periodo)` (natural-key upsert available here).

### Anti-Patterns to Avoid
- **Calling `registerAndEnqueue` in the seed.** Non-deterministic `randomUUID` → duplicate rows + R2 objects on every re-run (Pattern 2).
- **Importing `@imbau/api` from `@imbau/db`.** Creates a package cycle (Pattern 3).
- **`Math.random()` / `randomUUID()` / `Date.now()` anywhere in the seed.** Breaks determinism → breaks idempotency and reproducible demos. Use `seedId(name)` and a seeded PRNG + fixed reference dates.
- **Constructing a bare `S3Client`** instead of `makeR2Client(env)`. Misses the CRC32 `WHEN_REQUIRED` opt-out → every R2 PutObject fails with `XAmzContentSHA256Mismatch`.
- **Floats for money.** `precio`/`Refuerzo.montoUsd` are integer USD; `m2`/`anticipoPct`/`cac_index.valor` are `numeric` (strings in the driver). Never `real`/`doublePrecision`.
- **Seeding as owner for everything.** Owner bypasses RLS; the tenant write path stays unexercised. Use owner only for the `organization` root + partition DDL.
- **Silent skip when R2/worker absent.** D-05 mandates explicit fail-fast, not a warning-and-continue.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deterministic ids from names | Custom sha1 → UUID bit-twiddling | `uuid` v5 (`uuidv5`) | RFC-4122 version/variant bits are easy to get subtly wrong |
| R2 upload | Raw `fetch` PUT with manual SigV4 | `makeR2Client` + `PutObjectCommand` | SigV4 + the R2 CRC32 opt-out are already solved in `@imbau/storage` |
| Media processing (variants/blurhash/dims) | sharp/blurhash in the seed | Enqueue → `apps/worker` `processMedia` | D-04 mandates the real pipeline; memory caps + EXIF + sequential encode already handled |
| Object-key derivation | Ad-hoc string templates | `originalKey`/`variantKey` from `@imbau/storage` | Server-owned, deterministic, retry-overwrites-in-place |
| RLS-scoped writes | Manual `SET LOCAL` / role switching | `withTenant` | Parameterized `set_config(...,true)`, transaction-scoped, pool-safe |
| Media→URL resolution (validation) | Rebuild srcset by hand | `resolveMedia` | The exact shape web/panel render; use it to assert seed correctness |
| BullMQ job options | Custom retry/jobId logic | `mediaJobOptions(mediaId)` | jobId-dedup + exponential backoff already tuned |

**Key insight:** Phase 2 explicitly factored the media path so "the seed calls the shared core." Every non-content concern (keys, client, queue options, RLS transaction, resolution) already has a canonical helper — the seed's real work is **content authorship + deterministic ids + orchestration order**, nothing more.

## Runtime State Inventory

> This is a greenfield DATA phase (populates empty tables; no rename/refactor). Included for the external-state surface the seed writes to.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Postgres `imbau` DB (16 tables, currently unseeded for this org); the seed writes them | Idempotent inserts (Pattern 1) |
| Live service config | R2 bucket objects: `originals/{org}/{proj}/{mediaId}.{ext}` + `variants/{mediaId}/{w}.{fmt}` written by seed+worker | Deterministic keys ⇒ re-run overwrites in place, no orphans (Pattern 2) |
| OS-registered state | BullMQ jobs on `media-processing` queue (Redis), jobId=mediaId | Dedup by jobId; completed jobs retained by default — skip-if-processed guard (Pattern 2 step 7) |
| Secrets/env vars | Seed process needs `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL`, `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL`, `REDIS_URL` | Document in `## Comandos`; fail-fast names any missing var (D-05) |
| Build artifacts | Committed stock images under `packages/db/src/seed/assets/` (Pattern 5) | Ship in repo; keep modest size |

## Common Pitfalls

### Pitfall 1: R2 rejects PutObject without the CRC32 opt-out
**What goes wrong:** Direct `PutObject` returns `400 XAmzContentSHA256Mismatch`.
**Why:** `@aws-sdk/client-s3 >= 3.729` adds a streaming CRC32 trailer R2 refuses.
**Avoid:** Build the client with `makeR2Client(env)` (`requestChecksumCalculation/responseChecksumValidation: "WHEN_REQUIRED"`) — never a raw `new S3Client()`. [VERIFIED: packages/storage/src/r2-client.ts]

### Pitfall 2: Non-deterministic anything → broken idempotency
**What goes wrong:** Second `pnpm db:seed` doubles rows.
**Why:** `randomUUID`, `Math.random`, `new Date()`/`Date.now()`, or `faker` without a fixed seed.
**Avoid:** `seedId(name)` for ids, seeded PRNG for jitter, fixed reference dates (author a `SEED_REFERENCE_DATE` constant); `.onConflictDoNothing()` on every insert. **Warning sign:** row counts differ between run 1 and run 2 (the Validation test catches this).

### Pitfall 3: Worker not running → seed hangs or leaves media unprocessed
**What goes wrong:** media rows exist with empty `variants`; galleries render broken.
**Why:** enqueue succeeds even with no consumer; async processing never completes.
**Avoid:** the bounded-poll waiter (Pattern 2 step 7) turns a missing/idle worker into an explicit fail-fast, and guarantees `resolveMedia().isReady` before the seed returns.

### Pitfall 4: composite-FK / insertion-order violations
**What goes wrong:** insert rejected — a child references a parent not yet inserted, or `organization_id` drifts from the parent's.
**Why:** the `(parent_id, organization_id)` composite FKs (D-02) require the parent + a matching denormalized org id.
**Avoid:** follow Pattern 4's exact order; always set the denormalized `organizationId` to the same tenant on every child row.

### Pitfall 5: events land only in the DEFAULT partition
**What goes wrong:** D-07's "cruzando límites de partición mensual" isn't actually exercised.
**Why:** only current+next-month partitions ship in the migration; older `ts` values fall to DEFAULT.
**Avoid:** pre-create the target monthly partitions idempotently via owner DDL before inserting (Pattern 4); assert ≥2 distinct populated monthly partitions.

### Pitfall 6: `numeric` columns are strings in the driver
**What goes wrong:** type errors or silent precision loss inserting `m2`/`anticipoPct`/`cac_index.valor`.
**Why:** `postgres`(porsager) maps `numeric` → string (see `makePaymentPlan` using `anticipoPct: "30"`, `makeCacIndex` using `valor: "1234.5678"`).
**Avoid:** pass numeric/decimal columns as strings; pass integer money columns (`precio`, `Refuerzo.montoUsd`) as JS integers. [VERIFIED: packages/db/tests/helpers.ts]

## Code Examples

### Deterministic ids + seeded PRNG (no extra dep for the PRNG)
```typescript
// src/seed/ids.ts
import { v5 as uuidv5 } from "uuid";
export const SEED_NS = "b1a7c0de-0000-4000-8000-000000000000";
export const seedId = (name: string): string => uuidv5(name, SEED_NS);

// mulberry32 — tiny deterministic PRNG for numeric jitter (m2, price adjustments).
export function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### Owner bootstrap + tenant writes
```typescript
// Source: packages/db/tests/helpers.ts (makeOrg) + packages/db/src/with-tenant.ts
import { createOwnerDb, schema, withTenant } from "@imbau/db";
const { db: owner, client } = createOwnerDb(process.env.DATABASE_URL!);
const orgId = seedId("brigos:org");
await owner.insert(schema.organization).values({
  id: orgId, name: "Desarrollos Brigos", slug: "brigos", createdAt: SEED_REFERENCE_DATE,
}).onConflictDoNothing();

const projectId = seedId("brigos:project");
await withTenant(orgId, (tx) =>
  tx.insert(schema.projects).values({
    id: projectId, organizationId: orgId, nombre: "Brigos Recoleta",
    slug: "brigos-recoleta", estado: "publicado",
  }).onConflictDoNothing(),
);
```

### Payment plan with CAC + semestral Refuerzo[] (money rule)
```typescript
// Source: packages/db/src/schema/payment-plans.ts + json-schemas.ts (Refuerzo = {cuota:int, montoUsd:int})
import { refuerzoSchema } from "@imbau/db"; // validate before insert (D-12)
const refuerzos = [ { cuota: 6, montoUsd: 15000 }, { cuota: 12, montoUsd: 15000 } ];
refuerzos.forEach((r) => refuerzoSchema.parse(r));
await withTenant(orgId, (tx) =>
  tx.insert(schema.paymentPlans).values({
    id: seedId("brigos:plan:financiado"), organizationId: orgId, projectId,
    nombre: "Financiado 30/70 CAC", anticipoPct: "30.00", cuotas: 36, ajuste: "CAC",
    refuerzos, notasLegales: "Cuotas ajustadas por índice CAC…",
  }).onConflictDoNothing(),
);
```

### Deterministic media (Pattern 2, cycle-safe — no @imbau/api import)
```typescript
// Source: packages/storage/src (makeR2Client, originalKey, MEDIA_QUEUE, mediaJobOptions, MediaJobData)
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { makeR2Client, originalKey, MEDIA_QUEUE, mediaJobOptions, type MediaJobData } from "@imbau/storage";

const mediaId = seedId("brigos:media:amenities-pileta");
const key = originalKey(orgId, projectId, mediaId, "jpg");
await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: "image/jpeg" }));
await withTenant(orgId, (tx) =>
  tx.insert(schema.media).values({ id: mediaId, organizationId: orgId, projectId, originalKey: key })
    .onConflictDoNothing(),
);
const job: MediaJobData = { mediaId, organizationId: orgId, projectId, originalKey: key };
await queue.add("process", job, mediaJobOptions(mediaId)); // jobId = mediaId dedups
```

### Assert media resolvability (validation)
```typescript
// Source: packages/db/src/resolve-media.ts
const [row] = await withTenant(orgId, (tx) =>
  tx.select().from(schema.media).where(eq(schema.media.id, mediaId)));
const resolved = resolveMedia(row, { publicBaseUrl: process.env.R2_PUBLIC_BASE_URL! });
if (!resolved.isReady) throw new Error(`media ${mediaId} not processed — is apps/worker running?`);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pre-baked `media` rows with hardcoded variants | Real R2+worker pipeline exercised by the seed | This phase (D-04) | Seed proves the whole media path; no drift between seed data and production shape |
| `faker` for all fixture data | Curated es-AR content + seeded PRNG for jitter | This phase (D-01) | Demo-grade credibility; faker's lack of `es_AR` locale makes it filler-quality |
| Random-UUID inserts | Deterministic UUIDv5 + `onConflictDoNothing` | This phase (SEED-04) | Re-runnable seed; row-count invariance |

**Deprecated/outdated:**
- `uuid@latest` (14.x, published 2026-06-20): avoid for now; pin the mature `11.1.1`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The owner/migration role (`DATABASE_URL`) is a superuser and bypasses FORCE RLS for the `organization` insert (matches how `makeOrg` seeds today). | Pattern 3 | If a non-superuser owner is used, org bootstrap must run inside `withTenant(ORG_ID)` (withCheck `id = GUC`). Low risk — mitigation is one-line and documented. |
| A2 | Committed stock images (Unsplash/Pexels/CC0) are license-compatible for this demo use and will be documented per-file. | Pattern 5 | Wrong license ⇒ must swap assets. Mitigated by choosing Unsplash/Pexels/CC0 and recording provenance. Needs user confirmation only if a specific source is disallowed. |
| A3 | `uuid@11.1.1` is acceptable as the one new dependency (vs hand-rolling UUIDv5). | Standard Stack | If the user forbids new deps, use the `node:crypto` UUIDv5 alternative. Low risk. |
| A4 | Seeding a `user`+`member` (a demo login) is OPTIONAL and out of SEED-01..04 scope (auth/login surfaces are future phases); the base seed is org + published project + catalog/content/pricing/media/leads/events. | Pattern 3 | If a demo login is expected now, add owner-seeded `user`+`member` rows. Flagged for planner. |
| A5 | Adding `bullmq`/`ioredis`/`@aws-sdk/client-s3` to `@imbau/db` (to avoid the api cycle) is acceptable. | Pattern 3 | Alternative: relocate the seed or push the enqueue primitive into `@imbau/storage`. Planner's call. |

## Open Questions

1. **Demo login (user/member) now or later?**
   - Known: SEED-01..04 name org/project/catalog/content/pricing/media/leads/events — not a login.
   - Unclear: whether the eventual panel demo needs a seeded `member` to log in as.
   - Recommendation: seed a single owner-created `user`+`member` (deterministic ids) as a cheap, idempotent add so the panel demo isn't blocked; keep it clearly optional (A4).

2. **Exact CAC series values (12-24 months).**
   - Known: `cac_index.valor` is `numeric(12,4)`, one row per `(org, periodo)`, monotonic-ish upward for Argentina.
   - Unclear: whether the user wants specific historical CAC figures vs plausible synthetic ones.
   - Recommendation: author a plausible monotonic monthly series in `content.ts` (documented as synthetic); trivially swappable since it's a constant.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 16 | all inserts | ✓ (compose) | 16-alpine | none — blocking |
| Redis 7 | BullMQ enqueue | ✓ (compose) | 7 | none — blocking (D-05 fail-fast) |
| `apps/worker` running | media processing (D-04) | conditional | — | none — D-05 fail-fast with explicit error |
| Cloudflare R2 creds | PutObject + worker get/put | conditional (env/SOPS) | — | none — D-05 fail-fast |
| Node 22 | runtime | ✓ | 22 LTS | none |

**Missing dependencies with no fallback:** By D-05, ALL of the above are hard prerequisites; the seed's startup guard aborts with an explicit "what is missing + how to provide it" message rather than degrading. Document the full prerequisite list (`docker compose up -d postgres redis worker`, R2 env vars) in `## Comandos`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.8` [VERIFIED: root package.json] |
| Config file | `packages/db/vitest.config.ts` (exists) |
| Quick run command | `pnpm --filter @imbau/db test` |
| Full suite command | `pnpm test` (turbo) |
| Test DB harness | `packages/db/tests/db.ts` (`connectAs`/`ownerUrl`/`appUrl`/`anonUrl`, `_test`-DB guard) — reuse |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEED-04 | **Row-count invariance:** run seed twice → per-table `count(*)` identical | integration | `pnpm --filter @imbau/db test -t "seed is idempotent"` | ❌ Wave 0 |
| SEED-04 | Deterministic ids stable across runs (no duplicate ids) | integration | same file | ❌ Wave 0 |
| SEED-01 | Counts in range: floors ~13, units 30-40, project `publicado`, estados span disponible/reservado/vendido with pozo curve | integration | `-t "seed building composition"` | ❌ Wave 0 |
| SEED-02 | 2 price_lists; payment_plans with `ajuste='CAC'` + `Refuerzo[]` (montoUsd int); cac_index 12-24 rows; all `precio` integers > 0 | integration | `-t "seed pricing"` | ❌ Wave 0 |
| SEED-03 | 10-20 leads across all 4 estados w/ timeline; events span ≥2 monthly partitions; brokers present | integration | `-t "seed content and events"` | ❌ Wave 0 |
| SEED-03/D-04 | **Media resolvability:** every seeded media row → `resolveMedia().isReady === true`, variants/blurhash/dims populated, srcset non-empty | integration (needs R2+worker) | `-t "seed media resolves"` | ❌ Wave 0 |
| SEED-01 | **Anon/published readiness:** `withAnon` reads seeded floors/units/galleries/media (project is `publicado`) | integration | `-t "seed published visibility"` | ❌ Wave 0 |
| SEED-04 | **RLS-correct writes:** cross-tenant read with a different GUC returns 0 seeded rows | integration | `-t "seed tenant isolation"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/db test` (idempotency + composition + pricing; media test may be skipped locally without R2/worker via an env-gated `describe.skipIf`).
- **Per wave merge:** full `@imbau/db` suite including the media integration test (R2+worker up).
- **Phase gate:** full suite green before `/gsd-verify-work`; the row-count-invariance test is the non-negotiable SEED-04 gate.

### Wave 0 Gaps
- [ ] `packages/db/tests/seed.idempotency.test.ts` — run seed twice, assert per-table `count(*)` equality (SEED-04)
- [ ] `packages/db/tests/seed.content.test.ts` — composition/pricing/leads/events range + money + partition assertions (SEED-01/02/03)
- [ ] `packages/db/tests/seed.media.test.ts` — env-gated real-pipeline resolvability (SEED-03/D-04), reuses `resolveMedia`
- [ ] Reuse existing `packages/db/tests/db.ts` harness + `_test` DB guard — **no new framework install needed**
- [ ] A callable seed entry (e.g. `runSeed()` exported from `seed.ts`) so tests invoke it programmatically against the `_test` DB

## Security Domain

> `security_enforcement: true`, ASVS level 1. This is a seed script (no new endpoints/attack surface); the relevant controls are input-shape validation and preserving the RLS write path.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Seed runs offline as owner/app roles; no auth surface added |
| V3 Session Management | no | No sessions |
| V4 Access Control | yes | Tenant writes go through `withTenant` (RLS `app_authenticated` + GUC); owner used ONLY for the org root + partition DDL — never for tenant data |
| V5 Input Validation | yes | Validate JSONB payloads before insert: `refuerzoSchema`, `leadNoteSchema`, `quoteSnapshotSchema` (co-located Zod). Even seed data passes the boundary validators |
| V6 Cryptography | no | Deterministic UUIDv5 is an identifier scheme, not a secret; no crypto secrets authored |
| V7 (secret logging) | yes | The fail-fast guard reports missing var NAMES, never values (matches `env.ts`/`runtime.ts`); pino logs structured fields only |

### Known Threat Patterns for a seed script
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Seeding into prod/dev DB by accident | Tampering | Idempotent by design; document that `db:seed` targets the configured DB; consider a `_test`-style name guard for CI (harness already does this) |
| Secret leakage via logs | Information Disclosure | Names-not-values in errors/logs (V7); never log R2 keys/secrets |
| Cross-tenant contamination | Elevation/Tampering | All tenant rows via `withTenant`; `withCheck org = GUC` structurally rejects a wrong org id |
| Committed image with hidden/malicious payload | Tampering | Use reputable stock sources; images pass through sharp (worker) which re-encodes, stripping most embedded payloads |

## Sources

### Primary (HIGH confidence)
- Direct code read (this session): `packages/db/src/schema/*` (all 16 modules), `with-tenant.ts`, `client.ts`, `env.ts`, `resolve-media.ts`, `migrate.ts`, `drizzle.config.ts`, `tests/helpers.ts`, `tests/db.ts`; `packages/api/src/media/{register,runtime}.ts`; `packages/storage/src/{queue,keys,r2-client}.ts`; `apps/worker/src/{media,partitions}.ts`; `packages/config/env/presets.ts`; migrations `0000-0003`. — schema shapes, natural keys, FKs, RLS, pipeline determinism, cycle direction.
- `npm view uuid` — version 14.0.1 latest, `legacy-11`=11.1.1, deps none, MIT, `postinstall: null`, 270M downloads/wk, repo uuidjs/uuid. [VERIFIED: npm registry, 2026-07-01]
- CONTEXT.md / DISCUSSION-LOG.md / REQUIREMENTS.md / STATE.md / CLAUDE.md — locked decisions, requirement IDs, money/quality/idempotency constraints.

### Secondary (MEDIUM confidence)
- `gsd-tools query package-legitimacy check --ecosystem npm uuid` → `SUS: too-new` (against the 14.x latest tag) — resolved by pinning 11.1.1.

### Tertiary (LOW confidence)
- Stock-image license generalities (Unsplash/Pexels/CC0 permit commercial demo use) — [ASSUMED]; confirm per-asset provenance at implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every reused library verified in the repo; the one new dep verified on npm.
- Architecture (idempotency, media path, script location, order): HIGH — grounded in direct reads of schema, pipeline, and the api↔db dependency direction.
- Pitfalls: HIGH — each traced to a specific verified source file.
- es-AR content specifics + image licenses: MEDIUM/LOW — content is authored, not verified; provenance to be recorded at build.

**Research date:** 2026-07-01
**Valid until:** 2026-07-31 (stable stack; re-check `uuid` pin if bumping, and confirm R2/worker infra availability at execution)
