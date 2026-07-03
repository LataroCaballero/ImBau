---
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
plan: 01
subsystem: api
tags: [trpc, zod, drizzle, rls, quoting, multi-tenant, better-auth]

# Dependency graph
requires:
  - phase: 04-motor-de-cotizaci-n-packages-quoting
    provides: "packages/quoting — calcQuote, ENGINE_VERSION, QuoteError, QuoteInput/QuoteResult contract"
  - phase: 01-schema-media-seed
    provides: "quotes/cac_index/payment_plans/unit_prices/price_lists schema + quoteInsertSchema, withTenant/withAnon RLS helpers"
provides:
  - "quotesRouter with anonymous quotes.compute (resolve+calc, no write) and quotes.create (resolve+calc+persist snapshot)"
  - "resolveAndQuote core: withAnon org-resolve → withTenant reads (plan, USD prices, max-periodo CAC) → calcQuote"
  - "tRPC errorFormatter surfacing data.quoteErrorCode from a QuoteError cause"
  - "quotes registered in appRouter (AppRouter type now includes quotes.compute / quotes.create)"
affects: [05-02, 05-03, 05-04, 05-05, cotizador-ui, pdf-worker, whatsapp-cta]

# Tech tracking
tech-stack:
  added: ["@imbau/quoting workspace dep added to @imbau/api"]
  patterns:
    - "Anonymous server-side emission: withAnon(publicado project → orgId) → withTenant(orgId) reads/insert; client never supplies orgId/price/CAC"
    - "tRPC errorFormatter surfaces engine machine-code (quoteErrorCode) without leaking the error object/stack"
    - "Import-fence: quotes router binds only withAnon/withTenant/schema from @imbau/db (no elevated/owner pool)"

key-files:
  created:
    - packages/api/src/trpc/routers/quotes.ts
  modified:
    - packages/api/src/trpc/init.ts
    - packages/api/src/trpc/routers/_app.ts
    - packages/api/package.json

key-decisions:
  - "Snapshot envelope version stamped via ENGINE_VERSION (typed `1`) instead of a bare `1 as const` literal — keeps the DB snapshot version in lock-step with the engine and satisfies quoteSnapshotSchema's z.literal(1)."
  - "USD price classification: filter price_lists.moneda === 'USD', contado = the /contado/i-named list, financiado = the other USD list; either missing → PRECONDITION_FAILED."
  - "@imbau/quoting added as a workspace dependency of @imbau/api (was absent) — required for both the errorFormatter (QuoteError) and the router (calcQuote)."

patterns-established:
  - "resolveAndQuote shared core reused by compute and create so both paths resolve/read/compute identically; only create appends the withTenant INSERT."
  - "Numeric strings (anticipoPct, cac.valor) pass straight into QuoteInput — never parseFloat/Number'd (D-14 money rule)."

requirements-completed: [QUOTE-01, QUOTE-02]

coverage:
  - id: D1
    description: "errorFormatter surfaces data.quoteErrorCode from a QuoteError cause without leaking internals"
    requirement: QUOTE-02
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/api typecheck (exit 0); grep errorFormatter/quoteErrorCode in init.ts"
        status: pass
      - kind: integration
        ref: "deferred to plan 05-02 (tRPC caller against real Postgres — BAD_REQUEST + data.quoteErrorCode)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "quotes.compute resolves org via withAnon on a publicado project and returns a server-computed QuoteResult with no DB write"
    requirement: QUOTE-01
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/api typecheck + lint (exit 0); grep: single @imbau/db import binds only withAnon/withTenant/schema; no insert in compute path"
        status: pass
      - kind: integration
        ref: "deferred to plan 05-02 (anon compute against real Postgres, NOT_FOUND for non-publicado)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "quotes.create persists a versioned {version, inputs, result, cacPeriodo} snapshot via quoteInsertSchema.parse and returns {quoteId, result}"
    requirement: QUOTE-02
    verification:
      - kind: other
        ref: "pnpm --filter @imbau/api typecheck (exit 0); grep schema.quoteInsertSchema.parse( + insert(schema.quotes)"
        status: pass
      - kind: integration
        ref: "deferred to plan 05-02 (snapshot row persisted + tenant-private tables still private)"
        status: unknown
    human_judgment: false
  - id: D4
    description: "Missing CAC → PRECONDITION_FAILED (es-AR); degenerate plan → BAD_REQUEST with QuoteError cause; no 500 leaks internals"
    requirement: QUOTE-01
    verification:
      - kind: other
        ref: "grep: PRECONDITION_FAILED (missing CAC/prices/plan) + NOT_FOUND + err instanceof QuoteError→BAD_REQUEST(cause)"
        status: pass
      - kind: integration
        ref: "deferred to plan 05-02 (error-branch behavior against real Postgres)"
        status: unknown
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-03
status: complete
---

# Phase 05 Plan 01: Server-side emission core (quotesRouter) Summary

**Anonymous tRPC `quotes.compute` / `quotes.create` that resolve the tenant from the publicado project via `withAnon`, read prices + max-período CAC and persist the `{version:1}` snapshot via `withTenant(orgId)`, plus an `errorFormatter` surfacing the engine's `QuoteError.code` as `data.quoteErrorCode`.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-03T20:50Z (approx)
- **Completed:** 2026-07-03T21:10:12Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified) + lockfile

## Accomplishments
- `quotesRouter` with a shared `resolveAndQuote` core: `withAnon` resolves the org from the publicado project (client never supplies an orgId), then a single `withTenant(orgId)` transaction reads the payment plan, classifies the two USD price rows, reads the max-período CAC, guards missing CAC, maps rows → `QuoteInput` (numeric strings pass straight through), and computes via `calcQuote` with domain-error mapping.
- `quotes.compute` returns the `QuoteResult` with no DB write; `quotes.create` persists a versioned `{ version: ENGINE_VERSION, inputs, result, cacPeriodo }` snapshot validated by `quoteInsertSchema.parse` and returns `{ quoteId, result }`.
- tRPC `errorFormatter` on the initTRPC root exposes `data.quoteErrorCode` only when an error's `cause` is a `QuoteError` — internals/stack never leak (D-08).
- `quotes` registered in `appRouter`; `AppRouter` now types `quotes.compute` / `quotes.create` for end-to-end typed clients.
- Import fence held: the sole `@imbau/db` import binds only `withAnon`, `withTenant`, `schema`; no anon policy/GRANT touched, no PDF enqueue, no lead creation.

## Task Commits

Each task was committed atomically:

1. **Task 1: errorFormatter surfacing QuoteError.code** - `a27962a` (feat)
2. **Task 2: quotesRouter — resolveAndQuote core + compute + create** - `a107563` (feat)
3. **Task 3: register quotesRouter in appRouter** - `2b868f3` (feat)

_Note: Task 2 carried `tdd="true"`, but this plan's own verification is static (typecheck + lint + grep); the behavioral RED/GREEN proof against real Postgres is delivered by plan 05-02 (Wave 2). No behavioral test files were created in this plan by design._

## Files Created/Modified
- `packages/api/src/trpc/routers/quotes.ts` (created) - `quotesRouter` + private `resolveAndQuote`; the server-side emission core.
- `packages/api/src/trpc/init.ts` (modified) - added `errorFormatter` exposing `data.quoteErrorCode`; imports `QuoteError`.
- `packages/api/src/trpc/routers/_app.ts` (modified) - registered `quotes: quotesRouter` + updated the procedure-list doc comment.
- `packages/api/package.json` (modified) - added `@imbau/quoting: workspace:*` dependency.

## Decisions Made
- **Snapshot version via `ENGINE_VERSION`** instead of a bare `1 as const`: `ENGINE_VERSION` is typed `1`, so it satisfies `quoteSnapshotSchema`'s `z.literal(1)` while keeping the persisted envelope in lock-step with the engine and avoiding an unused import.
- **USD price classification**: filter to `price_lists.moneda === 'USD'`, take the `/contado/i` list as contado and the other USD list as financiado; either missing → `PRECONDITION_FAILED`. Faithful to the plan's "two USD rows" intent and to the seed nombres.
- **Guarded the `RETURNING` insert row** (`inserted[0]`) with an `INTERNAL_SERVER_ERROR` fallback to satisfy `noUncheckedIndexedAccess` (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@imbau/quoting` as a workspace dependency of `@imbau/api`**
- **Found during:** Task 1 (errorFormatter needs `QuoteError`; Task 2 needs `calcQuote`)
- **Issue:** `@imbau/api/package.json` did not depend on `@imbau/quoting`, so importing `QuoteError`/`calcQuote` would not resolve/typecheck.
- **Fix:** Added `"@imbau/quoting": "workspace:*"` to dependencies and ran `pnpm install` (internal workspace link — not an external package install; excluded-install rule does not apply).
- **Files modified:** packages/api/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @imbau/api typecheck` exits 0.
- **Committed in:** `a27962a` (Task 1 commit)

**2. [Rule 1 - Bug] Guarded `inserted[0]` for `noUncheckedIndexedAccess`**
- **Found during:** Task 2 (typecheck)
- **Issue:** `return { quoteId: inserted[0].id }` failed `strict` + `noUncheckedIndexedAccess` (TS2532: possibly undefined).
- **Fix:** Bound `const row = inserted[0]` and threw `TRPCError INTERNAL_SERVER_ERROR ("No se pudo persistir la cotización.")` if falsy before reading `row.id`.
- **Files modified:** packages/api/src/trpc/routers/quotes.ts
- **Verification:** `pnpm --filter @imbau/api typecheck` exits 0.
- **Committed in:** `a107563` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes essential for the code to typecheck/resolve. No scope creep — no anon policy/GRANT, no PDF enqueue, no lead creation added.

## Issues Encountered
- **Node/pnpm toolchain:** the shell defaulted to Node 20, on which the pinned `pnpm@11.6.0` (via corepack) throws `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. Resolved by activating Node 22 via nvm for all pnpm commands.
- **`pnpm --filter @imbau/api test` fails at global setup** (`tests/setup.ts` → "Missing test DB connection string") — a pre-existing environment requirement (owner test DB not provisioned in this worktree), not a regression from this plan. This plan's verification is typecheck + lint (both green); behavioral proof against real Postgres is delivered by plan 05-02.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `appRouter.quotes.compute` / `.create` are reachable through the tRPC caller and any mounted route handler — plan 05-02 (Wave 2) can now exercise them against real Postgres for the behavioral proof (anon compute/create, NOT_FOUND, PRECONDITION_FAILED, BAD_REQUEST + quoteErrorCode, snapshot persisted, tenant-private-still-private).
- No blockers.

---
*Phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit*
*Completed: 2026-07-03*
