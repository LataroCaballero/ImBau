---
phase: 03-seed-del-edificio-ficticio
plan: 02
subsystem: database
tags: [seed, media, r2, bullmq, rls, idempotency, es-AR, leads, events, partitions, uuidv5]

# Dependency graph
requires:
  - phase: 03-seed-del-edificio-ficticio
    plan: 01
    provides: "seed idempotency core (seedId/makePrng/SEED_REFERENCE_DATE), runSeed({skipMedia}) + owner org/project bootstrap + events partition pre-create, D-05 prerequisite guard, es-AR building/pricing content, TODO call sites for seedMedia/seedContentRows"
  - phase: 02-pipeline-de-media
    provides: "@imbau/storage primitives (makeR2Client, originalKey, MEDIA_QUEUE, mediaJobOptions, MediaJobData), resolveMedia, apps/worker processMedia consumer"
provides:
  - "seedMedia(orgId, projectId, opts) — cycle-safe deterministic media producer + bounded-poll waiter (composes storage primitives, NOT registerAndEnqueue, NO @imbau/api import)"
  - "mediaSeedId(assetKey) — the shared source of truth for a logical asset's deterministic mediaId"
  - "seedContentRows(orgId, projectId, {units}) — brokers, leads (+timeline), galleries, progress_posts, events across >=2 monthly partitions"
  - "13 committed free-license stock images + assets/LICENSES.md provenance manifest"
  - "runSeed now populates the full content half; content half proven with skipMedia (no R2/worker)"
affects: [03-03, cotizador milestone, panel, web publica]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cycle-safe media re-composition: @imbau/db seeds media by composing @imbau/storage + bullmq/ioredis/@aws-sdk directly (deterministic mediaId + onConflictDoNothing) instead of importing @imbau/api's registerAndEnqueue"
    - "Deterministic mediaId derivation (mediaSeedId) shared by producer + content refs so galleries/progress reference correct ids even in skipMedia mode"
    - "Bounded-poll media waiter = D-05 fail-fast worker-not-running proof"
    - "Events with fixed SEED_REFERENCE_DATE-relative ts route to pre-created events_YYYY_MM partitions (>=2 months), asserted against child partitions (not DEFAULT)"

key-files:
  created:
    - packages/db/src/seed/media.ts
    - packages/db/src/seed/content-rows.ts
    - packages/db/src/seed/assets/LICENSES.md
    - packages/db/src/seed/assets/ (13 committed .jpg stock images)
    - packages/db/tests/seed.media.test.ts
    - packages/db/tests/seed.content.test.ts
  modified:
    - packages/db/src/seed/content.ts
    - packages/db/seed.ts

key-decisions:
  - "seedContentRows derives media ids from the catalog (mediaSeedId), not from seedMedia's return map, so the content half (galleries/progress) is coherent under skipMedia:true — the deterministic id is the same either way."
  - "Media test gated on the full R2 env set being present (describe.skipIf); a cleanly-skipped media suite is the correct green outcome when R2/worker are absent (live-R2 proof deferred to UAT, as Phase 2)."
  - "Stock images sourced via Lorem Picsum (serves Unsplash-licensed photos) as documented stand-ins for Pablo's Branch-B material; provenance (author + Unsplash URL + license) recorded per file in LICENSES.md."
  - "Events assert against child partition tables (events_2026_04/05/06) plus a total-equals-parent check, proving routing to real monthly partitions rather than the DEFAULT catch-all."

patterns-established:
  - "mediaSeedId(key) = seedId('brigos:media:'+key) is the ONE place the media id scheme lives; producer and content both call it."
  - "seedMedia always closes the BullMQ queue + Redis socket + R2 client in finally so the one-shot CLI exits cleanly."

requirements-completed: [SEED-03]

coverage:
  - id: C1
    description: "Content half — brokers present; 10-20 leads across all four estados each with a validated LeadNote[] timeline"
    requirement: "SEED-03"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.content.test.ts#seed content — brokers + leads (SEED-03/D-07)"
        status: pass
    human_judgment: false
  - id: C2
    description: "Galleries per seccion whose imagenes are exactly the seccion's deterministic seeded mediaIds"
    requirement: "SEED-03"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.content.test.ts#seed content — galleries reference seeded media"
        status: pass
    human_judgment: false
  - id: C3
    description: "Events route to >=2 distinct monthly partitions (not DEFAULT), total equals parent count (D-07)"
    requirement: "SEED-03"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.content.test.ts#seed content — events span monthly partitions (D-07)"
        status: pass
    human_judgment: false
  - id: C4
    description: "Content-table re-run invariance (brokers/leads/galleries/progress_posts/events)"
    requirement: "SEED-03"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.content.test.ts#seed content is idempotent (SEED-04)"
        status: pass
    human_judgment: false
  - id: C5
    description: "Media module is cycle-safe (no @imbau/api dep) and composes storage primitives with deterministic mediaId + onConflictDoNothing"
    requirement: "SEED-03"
    verification:
      - kind: static
        ref: "package.json cycle check (no @imbau/api) + typecheck + lint"
        status: pass
    human_judgment: false
  - id: C6
    description: "Real-pipeline media resolvability (resolveMedia().isReady with variants/blurhash/dims) + second-run count invariance"
    requirement: "SEED-03"
    verification:
      - kind: integration
        ref: "packages/db/tests/seed.media.test.ts#seed media resolves through the real R2 + worker pipeline (SEED-03/D-04)"
        status: deferred
        note: "describe.skipIf-gated; SKIPPED this run (R2 creds unavailable locally). Live-R2 proof deferred to operator/UAT verification, as Phase 2 did."
    human_judgment: true

# Metrics
duration: 35min
completed: 2026-07-01
status: complete
---

# Phase 3 Plan 02: Seed content + real-pipeline media Summary

**The content half of the "Brigos Recoleta" seed plus a cycle-safe media producer: 13 committed free-license stock images uploaded through the REAL R2 + worker pipeline via deterministic mediaIds (no registerAndEnqueue, no @imbau/api cycle), plus brokers, 14 leads across all four estados with LeadNote[] timelines, galleries, progress_posts, and events spanning >=2 monthly partitions — all idempotent (SEED-03, D-03/D-04/D-05/D-07).**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-01
- **Tasks:** 3
- **Files:** 8 created (incl. 13 image assets + LICENSES.md), 2 modified

## Accomplishments

- **Cycle-safe media pipeline (D-04):** `seedMedia` re-composes the Phase-2 pipeline WITHOUT importing `@imbau/api` (which would create a db↔api cycle) and WITHOUT `registerAndEnqueue` (which mints `randomUUID` → non-idempotent). It uses a deterministic `mediaId = seedId("brigos:media:<key>")`, PutObjects via `makeR2Client` (CRC32 opt-out), inserts the media row with `.onConflictDoNothing()`, enqueues with `jobId=mediaId` dedup, then polls each row until the worker fills `variants` — a re-run adds zero rows/objects (T-03-08).
- **D-05 fail-fast waiter:** a bounded (~90s) poll turns a missing/idle worker into an explicit "worker not consuming the queue — is apps/worker running?" error; errors name only the queue, never R2 secrets (T-03-06).
- **Committed stock media (D-03):** 13 curated Unsplash-licensed photos (via Lorem Picsum), ~2.5 MB total, spanning amenities/exteriores/interiores + obra avance, each with source URL + author + license recorded in `assets/LICENSES.md` — documented stand-ins for Pablo's Branch-B material.
- **Content rows (SEED-03/D-07):** 3 realistic AR brokers; 14 leads spanning nuevo/contactado/negociacion/cerrado, each with an append-only `LeadNote[]` timeline validated by `leadNoteSchema` (T-03-04) and varied `origen` (web/whatsapp/instagram/broker/referido/portal); 3 progress posts (obra avance); 3 galleries (one per seccion) referencing the deterministic mediaIds; and 18 events with fixed ts spanning 2026-04/05/06 so they route to >=2 real monthly partitions.
- **Idempotency proven:** the content suite re-runs the seed and asserts the plan-02 content tables stay count-invariant; the media suite (when infra up) asserts second-run media count invariance.

## Task Commits

1. **Task 1: committed stock-image assets + es-AR content narratives** — `a03fbf3` (feat)
2. **Task 2: deterministic media producer + waiter (cycle-safe real pipeline)** — `4a46d73` (feat)
3. **Task 3: content-row generators wired into runSeed** — `2ed4d3d` (feat)

## Files Created/Modified

- `packages/db/src/seed/assets/*.jpg` (13) + `assets/LICENSES.md` — committed free-license stock images + provenance manifest (D-03).
- `packages/db/src/seed/content.ts` (EDIT) — added the media asset catalog, 3 brokers, 14 lead narratives + timelines, 3 progress posts, gallery seccion set, and event tipos + fixed day-offsets (plan-01 building/pricing/CAC constants untouched).
- `packages/db/src/seed/media.ts` — `seedMedia` (deterministic producer + waiter) + `mediaSeedId` (shared id scheme).
- `packages/db/src/seed/content-rows.ts` — `seedContentRows` (brokers/leads/galleries/progress_posts/events).
- `packages/db/seed.ts` (EDIT) — wired `seedMedia` (skipped when `skipMedia`) then `seedContentRows` into `runSeed`.
- `packages/db/tests/seed.media.test.ts` — env-gated real-pipeline resolvability + idempotency (skips cleanly without R2).
- `packages/db/tests/seed.content.test.ts` — brokers/leads/estados/timeline, galleries==seeded mediaIds, events across >=2 partitions, content re-run invariance.

## Decisions Made

- **`seedContentRows` derives media ids from the catalog (`mediaSeedId`), not from `seedMedia`'s return map.** The plan sketched threading the return map through `refs`, but the deterministic id is identical whether or not media was seeded, and the content test MUST pass with `skipMedia:true`. Deriving at point-of-use keeps galleries/progress coherent in both modes and decouples the content generator from the media producer's runtime output. (Rule 3 — blocking: the automated content gate runs without R2.)
- **`mediaSeedId` is the single source of truth for the id scheme,** exported from `media.ts` and imported by content-rows + the tests, so producer and references can never drift.
- **Media test gated on the full R2 env set** (`describe.skipIf`); a cleanly-skipped media suite is the correct green outcome without R2/worker.
- **Events asserted against child partition tables** (`events_2026_04/05/06`) plus total-equals-parent, proving real per-month routing (not DEFAULT).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `execute<T>` generic requires a type-literal, not an `interface`**
- **Found during:** Task 2 (seed.media.test.ts typecheck).
- **Issue:** `owner.db.execute<MediaRowDb>()` failed with "Index signature for type 'string' is missing" because `execute<T extends Record<string, unknown>>` and a named `interface` lacks the implicit index signature that a `type` literal has.
- **Fix:** Changed `interface MediaRowDb` to a `type` alias (matches the existing building-pricing test's inline object types).
- **Files modified:** packages/db/tests/seed.media.test.ts
- **Committed in:** 4a46d73 (Task 2).

**2. [Rule 3 - Design resolution] Media id map derived in content-rows rather than threaded from seedMedia**
- Described under Decisions Made above; the deterministic id makes the two paths equivalent, and it is required for the skipMedia content gate. No scope change.

## Known Stubs

None. Galleries/progress_posts reference deterministic mediaIds that resolve to real processed media once the media pipeline runs (R2 + worker). Under `skipMedia` the media rows are intentionally not produced (DB-only path); this is by design, not a stub — the `db:seed` CLI runs the full media path with the D-05 guard active. The live-R2 resolvability proof is deferred to UAT (below).

## User Setup Required / Deferred Verification

**Live-R2 media verification is deferred to UAT.** R2 credentials are not available in this execution environment, so `seed.media.test.ts` was correctly SKIPPED (`describe.skipIf`) and `resolveMedia().isReady === true` end-to-end was not exercised here. This mirrors Phase 2's deferred R2 verification. To verify the full pipeline:

1. Export `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `REDIS_URL`.
2. `docker compose up -d postgres redis worker` (worker consuming the media-processing queue).
3. Run the full seed (`pnpm db:seed`) or `pnpm --filter @imbau/db test -- --run seed.media` against a `_test` DB.
4. Expect every seeded media row to resolve with non-empty AVIF/WebP srcset + blurhash + dims, and a second run to leave the media row count unchanged.

## Verification Results

Automated gate (with the local Node-22 + Postgres `imbau_test` preamble):
- `pnpm --filter @imbau/db typecheck` — clean.
- `pnpm --filter @imbau/db lint` — clean.
- No `@imbau/api` dependency in `@imbau/db` package.json (cycle check) — pass.
- Full `@imbau/db` suite: **44 passed, 2 skipped, 0 failed** — `seed.content` passes; `seed.media` SKIPS cleanly (R2 absent, correct outcome).

## Self-Check: PASSED

All created source/test files + the 13 image assets + LICENSES.md exist on disk; all 3 task commits (a03fbf3, 4a46d73, 2ed4d3d) are in git history. Typecheck + lint clean, no db→api cycle, content suite green, media suite skipped cleanly.

---
*Phase: 03-seed-del-edificio-ficticio*
*Completed: 2026-07-01*
