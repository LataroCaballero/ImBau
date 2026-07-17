---
phase: 04-motor-de-cotizaci-n-puro-packages-quoting
plan: 02
subsystem: quoting
tags: [typescript, discriminated-union, domain-error, es-AR, intl, formatter, pure-function]

# Dependency graph
requires:
  - phase: 04-01
    provides: "money.ts (roundHalfUpUsd, allocateCuotas, decimal2), version.ts (ENGINE_VERSION), package-scoped 100%-coverage vitest.config.ts"
provides:
  - "types.ts — the single QuoteResult discriminated union (ContadoResult | FinanciadoResult) + QuoteInput/PlanInput/CacInput/RefuerzoInput + CuotaLine/RefuerzoLine/QuoteTotals + QuoteComparison/PdfModel"
  - "errors.ts — QuoteError class + exhaustive QuoteErrorCode union (7 codes) for typed domain rejection (D-07)"
  - "format.ts — deterministic es-AR formatter formatUsd/formatArs with hand-owned US$ / $ labels (defeats ICU U+202F drift, D-12)"
affects: [04-03, 04-04, fase-5-persistence, fase-6-ui-whatsapp, fase-7-pdf]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Declaration-only types module (no runtime code) so the output contract is trivially covered under the 100% gate"
    - "Discriminated union on modalidad as the single output shape — one result per modalidad, never a container holding both (D-10)"
    - "Typed domain-rejection idiom: QuoteError extends Error with a readonly exhaustive code union; engine rejects, caller reports (D-07)"
    - "Hand-owned currency label + Intl decimal grouping (never currency style) for cross-runtime-deterministic es-AR strings (D-12)"

key-files:
  created:
    - packages/quoting/src/types.ts
    - packages/quoting/src/errors.ts
    - packages/quoting/src/errors.test.ts
    - packages/quoting/src/format.ts
    - packages/quoting/src/format.test.ts
  modified: []

key-decisions:
  - "QuoteInput carries BOTH resolved USD prices; the engine does no pricing math — contado discount is the difference between the two supplied prices (D-09)"
  - "CuotaLine.ars is string | null: 2-decimal ARS string for ajuste:'CAC', null for ajuste:'fijo'"
  - "formatArs preserves the 2 input decimals verbatim and groups the integer part via BigInt (no float coercion at the display boundary)"

patterns-established:
  - "Pattern 1: types.ts is declaration-only — any runtime narrowing helper must live in engine.ts, keeping the contract at 0 executable statements"
  - "Pattern 2: every QuoteErrorCode is constructed and asserted in errors.test.ts so the code union stays exhaustive before the engine throws them"
  - "Pattern 3: formatter tests assert exact strings + a U+202F (codepoint 202f) absence guard as the deterministic UI==PDF==WhatsApp contract"

requirements-completed: [ENGINE-03]

coverage:
  - id: D1
    description: "QuoteResult discriminated union + QuoteInput/line/total/comparison/PDF-model type contract (types.ts), modalidad-discriminated, no @imbau/db import, no runtime code"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/quoting typecheck (tsc --noEmit)"
        status: pass
      - kind: other
        ref: "grep guards: modalidad literal, FinanciadoResult, ars string|null, no @imbau/db import"
        status: pass
    human_judgment: false
  - id: D2
    description: "QuoteError domain-rejection idiom + exhaustive 7-code QuoteErrorCode union (errors.ts), no observability coupling"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "packages/quoting/src/errors.test.ts#QuoteError (D-07 — typed domain rejection)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Deterministic es-AR formatter formatUsd/formatArs with hand-owned US$ / $ labels and no U+202F"
    requirement: "ENGINE-03"
    verification:
      - kind: unit
        ref: "packages/quoting/src/format.test.ts#formatUsd / formatArs / U+202F guard"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 02: Type Contract, Domain Errors & es-AR Formatter Summary

**The single `QuoteResult` discriminated union (contado | financiado) + `QuoteInput`, the exhaustive `QuoteError` domain-rejection idiom (D-07), and a deterministic es-AR formatter (`US$ 1.234` / `$ 1.234.560,00`) that owns its currency label to defeat ICU U+202F drift (D-12) — all inside the 100%-coverage gate.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-03T15:56:36Z
- **Completed:** 2026-07-03T16:01:00Z
- **Tasks:** 3
- **Files modified:** 5 created

## Accomplishments
- `types.ts`: the load-bearing output contract every downstream surface consumes — `QuoteResult = ContadoResult | FinanciadoResult` discriminated on `modalidad` (D-10), `QuoteInput` carrying both resolved USD prices with no pricing math (D-09), plus `CuotaLine` (`ars: string | null`), `RefuerzoLine` (no dates, D-08), `QuoteTotals`, `QuoteComparison` and `PdfModel`. Declaration-only, no `@imbau/db` import, no runtime code.
- `errors.ts` + tests: `QuoteError extends Error` with a `readonly code` and an exhaustive 7-code `QuoteErrorCode` union (`PLAN_REQUERIDO`, `CAC_REQUERIDO`, `ANTICIPO_PCT_FUERA_DE_RANGO`, `CUOTAS_INVALIDAS`, `REFUERZO_FUERA_DE_PLAZO`, `REFUERZO_DUPLICADO`, `SALDO_NO_POSITIVO`) — every code constructed and asserted; no observability coupling.
- `format.ts` + tests (TDD): `formatUsd` / `formatArs` with hand-owned `US$ ` / `$ ` labels and Intl decimal grouping (never currency style), preserving input decimals verbatim; a test guards against the U+202F narrow no-break space (codepoint 202f).
- 100% coverage maintained package-wide (17/17 stmts, 2/2 branches, 7/7 funcs, 16/16 lines); typecheck + lint green.

## Task Commits

Each task was committed atomically:

1. **Task 1: QuoteInput / QuoteResult type contract** - `b87e1f3` (feat)
2. **Task 2: QuoteError domain-rejection idiom** - `e12df71` (feat)
3. **Task 3: es-AR formatter (TDD RED)** - `c961a8c` (test)
4. **Task 3: es-AR formatter (TDD GREEN)** - `c6dbc38` (feat)

_TDD task 3 produced test → feat commits; no REFACTOR was needed (implementation was clean on first pass)._

## Files Created/Modified
- `packages/quoting/src/types.ts` - The single output contract: `QuoteResult` union + `QuoteInput` + line/total/comparison/PDF-model types (declaration-only)
- `packages/quoting/src/errors.ts` - `QuoteError` class + exhaustive `QuoteErrorCode` union for typed domain rejection
- `packages/quoting/src/errors.test.ts` - Constructs every code, asserts `code`/`name`/`instanceof Error` + message handling
- `packages/quoting/src/format.ts` - Deterministic es-AR `formatUsd`/`formatArs` with hand-owned labels
- `packages/quoting/src/format.test.ts` - Exact-string cases + U+202F absence guard + label discipline

## Decisions Made
- None beyond the plan — followed the D-07/D-09/D-10/D-12 decisions as specified. `PdfModel` shipped as a reasonable draft data shape (worker owns the JSX), no `ENGINE_VERSION` bump (D-12).

## Deviations from Plan

None - plan executed exactly as written. (Two in-file explanatory comments were reworded so the plan's own `grep` verify guards — which scan for `sentry|pino|console.` in `errors.ts` and `style: 'currency'` in `format.ts` — did not false-positive on prose that merely named the forbidden patterns. No behavior change.)

## Issues Encountered
- The plan's `format.ts` verify includes `grep -q "US\$"`, but shell/BRE quoting turns `\$` into an end-of-line anchor (tests for a line *ending* in "US"), which never matches. Confirmed the `US$ ` label is present via a fixed-string grep (`grep -qF 'US$'`) instead. Verify-command quirk only; the artifact is correct.
- Running `vitest run --coverage` generates a `coverage/` directory whose JS trips ESLint; `coverage/` is already gitignored at the repo root, so it is never committed and `pnpm lint` on source is clean after removing the artifact. Pre-existing infra behavior, not introduced here.

## User Setup Required
None - no external service configuration required. `packages/quoting` is pure (no I/O), tests need no DB/Redis.

## Next Phase Readiness
- Plan 04-03 (`engine.ts` / `calcQuote`) can now import `QuoteInput`, `QuoteResult` and throw `QuoteError` — the shape and the rejection idiom are finalized.
- Plan 04-04 serializers can consume `QuoteResult` + `formatUsd`/`formatArs`; `QuoteComparison`/`PdfModel` drafts are in place.
- Barrel (`index.ts`) re-exports for these new symbols are intentionally deferred to plans 03/04 per the phase plan (not in this plan's `files_modified`).

## Self-Check: PASSED

---
*Phase: 04-motor-de-cotizaci-n-puro-packages-quoting*
*Completed: 2026-07-03*
