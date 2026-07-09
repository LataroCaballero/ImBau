---
phase: 04-motor-de-cotizaci-n-puro-packages-quoting
verified: 2026-07-03T13:35:00Z
status: passed
score: 5/5
behavior_unverified: 0
overrides_applied: 0
---

# Phase 04: Motor de cotización puro — Verification Report

**Phase Goal:** Existe `packages/quoting` — un motor de cotización puro, determinista y sin I/O que emite un `QuoteResult` tipado único (el contrato del que dependen UI, PDF y WhatsApp), verificado al 100% de cobertura con property-based tests. La base peso (CAC como multiplicador) queda encodada en el contrato `QuoteInput` en esta fase; ninguna superficie puede construirse hasta que la forma de salida esté finalizada.
**Verified:** 2026-07-03T13:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Motor calcula cotización contado y financiada como funciones puras sin I/O — nunca proyecta CAC futuro ni inventa FX (ENGINE-01, ENGINE-02) | VERIFIED | `calcQuote` has no `Date.now`, `Math.random`, `process.env`, or `@imbau/db` import. CAC enters only as `input.cac`. Unit tests assert contado returns `precioContadoUsd` exactly; financiado computes anticipo + cuotas + CAC as multiplier only. |
| SC-2 | Motor emite una única estructura tipada `QuoteResult` que alimenta UI, PDF y texto de WhatsApp de forma idéntica — una sola forma de salida, sin recompute por superficie (ENGINE-03) | VERIFIED | `QuoteResult = ContadoResult | FinanciadoResult` discriminated union in `types.ts`. `serialize.ts` exports `toWhatsAppText` and `toPdfModel` — both consume the same `QuoteResult`, neither calls `calcQuote` (grep-verified). Both render amounts via the single shared `formatUsd`/`formatArs`. `compareQuotes` derives ahorro once. |
| SC-3 | `packages/quoting` pasa CI con 100% de cobertura + property-based tests que prueban los invariantes (ENGINE-04) | VERIFIED | Test run: 62 tests, 8 files, all pass. Coverage: 100% on all four metrics (69/69 stmts, 36/36 branches, 16/16 funcs, 59/59 lines). Six `test.prop` invariants: exact reconciliation, Σcuotas=saldo, no-negative-cuota, CAC monotonicity, anticipo monotonicity, determinism. No coverage-ignore pragma anywhere in `src/`. |
| SC-4 | Todo el dinero fluye en enteros (USD) / decimal (ARS) con una regla de redondeo y asignación de resto documentada y testeada — los totales cierran al centavo, nunca un float (ENGINE-05) | VERIFIED | `money.ts` uses a single `Decimal.clone({ rounding: Decimal.ROUND_HALF_UP })` clone. `allocateCuotas` uses last-cuota-absorbs-remainder (named D-02, tested with exact `===` assertions including `[33,33,34]` for `(100,3)`). `roundHalfUpUsd` wraps numeric string directly in Decimal, no `parseFloat`. `decimal2` returns exact 2-decimal ARS string via `.toFixed(2)`. No `toBeCloseTo` in any test file. |
| SC-5 | Motor exporta `ENGINE_VERSION`, embebible en un snapshot y bumpeable ante cualquier cambio de fórmula (ENGINE-06) | VERIFIED | `version.ts`: `export const ENGINE_VERSION = 1 as const`. Both contado and financiado branches of `calcQuote` embed `version: ENGINE_VERSION`. `packages/db/src/schema/json-schemas.ts` has `z.object({ version: z.literal(1) })` — values align. |

**Score:** 5/5 truths verified

---

### Required Artifacts (Three-Level Verification)

| Artifact | Status | Level 1 (Exists) | Level 2 (Substantive) | Level 3 (Wired) |
|----------|--------|------------------|-----------------------|-----------------|
| `packages/quoting/package.json` | VERIFIED | Present | `decimal.js@10.6.0` runtime; `fast-check@4.8.0`, `@fast-check/vitest@0.4.1`, `@vitest/coverage-v8@4.1.8` dev — all exact pins, no `^`/`~`. `test` script is `vitest run --coverage`. | Used by all package commands |
| `packages/quoting/vitest.config.ts` | VERIFIED | Present | `mergeConfig(rootConfig, ...)` with `coverage.thresholds: { 100: true }`, `include: ["src/**/*.ts"]`, `exclude: ["src/**/*.test.ts", "src/index.ts"]`. Root config has no thresholds. | Consumed when `pnpm test` runs; thresholds gate fires |
| `packages/quoting/src/version.ts` | VERIFIED | Present | `export const ENGINE_VERSION = 1 as const`. Header documents lock-step with `quoteSnapshotSchema`. | Imported by `engine.ts`, re-exported from `index.ts` |
| `packages/quoting/src/money.ts` | VERIFIED | Present | Exports `roundHalfUpUsd` (D-03), `allocateCuotas` (D-02 last-absorbs remainder), `decimal2` (D-04) on one `ROUND_HALF_UP` Decimal clone. No `parseFloat`/`Number(str)`. | Imported by `engine.ts` and `compare.ts` |
| `packages/quoting/src/types.ts` | VERIFIED | Present | Declaration-only. `QuoteResult = ContadoResult | FinanciadoResult` discriminated on `modalidad`. `QuoteInput` carries both resolved USD prices. `CuotaLine.ars: string | null`. No `@imbau/db` import. No runtime code. | Imported (as types) by `engine.ts`, `serialize.ts`, `compare.ts`, `errors.ts`, `format.ts`; re-exported from `index.ts` |
| `packages/quoting/src/errors.ts` | VERIFIED | Present | `QuoteError extends Error` with `readonly code: QuoteErrorCode`. Exhaustive 7-code union: `PLAN_REQUERIDO`, `CAC_REQUERIDO`, `ANTICIPO_PCT_FUERA_DE_RANGO`, `CUOTAS_INVALIDAS`, `REFUERZO_FUERA_DE_PLAZO`, `REFUERZO_DUPLICADO`, `SALDO_NO_POSITIVO`. No Sentry/pino/console. | Imported by `engine.ts`; re-exported from `index.ts` |
| `packages/quoting/src/format.ts` | VERIFIED | Present | `formatUsd` (`US$ N.NNN`) + `formatArs` (`$ N.NNN,NN`) with hand-owned labels and `Intl.NumberFormat('es-AR', { style: 'decimal' })`. No `style: 'currency'`. No U+202F. | Imported by `serialize.ts` and `compare.ts`; re-exported from `index.ts` |
| `packages/quoting/src/engine.ts` | VERIFIED | Present | `export function calcQuote(input: QuoteInput): QuoteResult`. Contado and financiado branches. Validate-first with all 7 QuoteError codes. Composes `roundHalfUpUsd`/`allocateCuotas`/`decimal2`. Embeds `ENGINE_VERSION`. No clock/random/env/DB. | Imported by `engine.test.ts`, `engine.property.test.ts`, `serialize.test.ts`; re-exported from `index.ts` |
| `packages/quoting/src/engine.test.ts` | VERIFIED | Present | Unit table: contado case; financiado CAC (anticipo, saldo, 12 cuotas, primera cuota ARS, reconciliation); financiado fijo (null ars, null cac); refuerzos (saldo discount, indice lines, no dates). 8 rejection cases covering all 7 codes. No `toBeCloseTo`. | Run via `pnpm test` — 62 tests pass |
| `packages/quoting/src/engine.property.test.ts` | VERIFIED | Present | 6 `test.prop` invariants with adversarial generators (precio to 10M, anticipoPct 0..100, cuotas 1..120). No formula re-implementation as oracle. No coverage-ignore pragmas. | Run via `pnpm test` |
| `packages/quoting/src/compare.ts` | VERIFIED | Present | `compareQuotes(contado, financiado): QuoteComparison`. `ahorroUsd` as integer, `ahorroPct` via `decimal.js` to 2-decimal string. No `parseFloat`. | Imported by `compare.test.ts`; re-exported from `index.ts` |
| `packages/quoting/src/serialize.ts` | VERIFIED | Present | `toWhatsAppText` and `toPdfModel`, both consuming `QuoteResult`. No `calcQuote` import. All amounts via `formatUsd`/`formatArs`. Short es-AR voseo resumen for WA. `PdfModel` with 2 leyendas for PDF. | Imported by `serialize.test.ts`; re-exported from `index.ts` |
| `packages/quoting/src/index.ts` | VERIFIED | Present | Runtime exports: `calcQuote`, `compareQuotes`, `toWhatsAppText`, `toPdfModel`, `ENGINE_VERSION`, `QuoteError`, `formatUsd`, `formatArs`. Type-only exports: all public types + `QuoteErrorCode`. Money primitives (`roundHalfUpUsd`/`allocateCuotas`/`decimal2`) not exported. | Single public entry point; barrel excluded from coverage gate |

---

### Key Link Verification

| From | To | Via | Status |
|------|---|-----|--------|
| `packages/quoting/src/money.ts` | `decimal.js` | `Decimal.clone({ rounding: Decimal.ROUND_HALF_UP })` — single visible rounding decision | WIRED |
| `packages/quoting/src/version.ts` | `packages/db/src/schema/json-schemas.ts` (`quoteSnapshotSchema`) | `ENGINE_VERSION = 1` === `z.literal(1)` — same integer, no migration needed | WIRED |
| `packages/quoting/vitest.config.ts` | `vitest.config.ts` (root) | `mergeConfig(rootConfig, ...)` — inherits v8 provider; 100% threshold lives ONLY in package config | WIRED |
| `packages/quoting/src/engine.ts` | `packages/quoting/src/money.ts` | Imports `roundHalfUpUsd`, `allocateCuotas`, `decimal2` — all three used in financiado branch | WIRED |
| `packages/quoting/src/engine.ts` | `packages/quoting/src/version.ts` | `ENGINE_VERSION` embedded in both `ContadoResult` and `FinanciadoResult` | WIRED |
| `packages/quoting/src/engine.ts` | `packages/quoting/src/errors.ts` | `throw new QuoteError(code)` for all 7 codes before any money math (D-07) | WIRED |
| `packages/quoting/src/serialize.ts` | `packages/quoting/src/format.ts` | `formatUsd`/`formatArs` imported and used in both serializers; no inline currency strings | WIRED |
| `packages/quoting/src/serialize.ts` | `packages/quoting/src/types.ts` (QuoteResult) | Takes `QuoteResult`; branches exhaustively on `modalidad`; never calls `calcQuote` | WIRED |
| `packages/quoting/src/index.ts` | all modules | Single re-export surface; runtime via `export {}`, types via `export type {}` | WIRED |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite with 100% coverage gate | `pnpm --filter @imbau/quoting test` | 62 tests passed (8 files); Coverage: 100% stmts/branches/funcs/lines (69/69, 36/36, 16/16, 59/59) | PASS |
| TypeScript strict type-check | `pnpm --filter @imbau/quoting typecheck` | Exit 0, no output | PASS |
| ESLint | `pnpm --filter @imbau/quoting lint` | Exit 0, no output | PASS |

---

### Requirements Coverage

| Requirement | Phase Plans | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ENGINE-01 | 04-03 | Motor calcula cotización contado como función pura y determinista, sin I/O | SATISFIED | `calcQuote` contado branch returns `precioContadoUsd` + `ENGINE_VERSION`. No I/O. Unit test + property determinism test pass. |
| ENGINE-02 | 04-03 | Motor calcula cotización financiada: anticipo + N cuotas CAC + refuerzos, primera cuota en ARS con CAC como multiplicador, nunca proyecta CAC | SATISFIED | `calcQuote` financiado branch: `roundHalfUpUsd` (anticipo), `allocateCuotas` (cuotas), `decimal2` (ARS = usd × CAC). CAC enters only as `input.cac`. Unit + property tests pass. |
| ENGINE-03 | 04-02, 04-04 | Motor emite única estructura tipada `QuoteResult` que alimenta UI, PDF y WhatsApp — tres superficies nunca difieren | SATISFIED | Discriminated union `QuoteResult`. `toWhatsAppText`/`toPdfModel` consume same result, never re-run engine (grep-verified). All amounts via shared formatter. |
| ENGINE-04 | 04-03, 04-04 | 100% cobertura exigida en CI + property-based tests (reconciliación, Σcuotas=saldo, monotonía CAC, determinismo) | SATISFIED | Test script is `vitest run --coverage`. All four metrics 100%. Six `test.prop` invariants with adversarial generators. No coverage-ignore pragmas. |
| ENGINE-05 | 04-01 | Todo el dinero en enteros (USD) / decimal (ARS), regla de redondeo y asignación de resto documentada y testeada | SATISFIED | `decimal.js` throughout. `ROUND_HALF_UP` clone. `allocateCuotas` last-cuota-absorbs remainder (named D-02). No `parseFloat`. No `toBeCloseTo`. |
| ENGINE-06 | 04-01 | Motor exporta `ENGINE_VERSION`, embebible en snapshot, bumpeable ante cambio de fórmula | SATISFIED | `ENGINE_VERSION = 1 as const`. Every `QuoteResult` embeds `version: ENGINE_VERSION`. Matches `quoteSnapshotSchema z.literal(1)`. |

All 6 requirements declared for Phase 4 in REQUIREMENTS.md are SATISFIED. No orphaned requirements.

---

### Anti-Patterns Found

| File | Pattern | Severity | Result |
|------|---------|----------|--------|
| `packages/quoting/src/*.ts` | TBD/FIXME/XXX markers | BLOCKER | None found |
| `packages/quoting/src/*.ts` | TODO/HACK/PLACEHOLDER | WARNING | None found |
| `packages/quoting/src/*.test.ts` | `toBeCloseTo` (float-approx money assertion) | BLOCKER | None found |
| `packages/quoting/src/` | `c8 ignore` / `v8 ignore` coverage-ignore pragmas | BLOCKER | None found |
| `packages/quoting/src/engine.ts` | `Date.now`, `Math.random`, `process.env` (impurity) | BLOCKER | None found |
| `packages/quoting/src/engine.ts` | `from '@imbau/db'` import (I/O violation) | BLOCKER | None found |
| `packages/quoting/src/serialize.ts` | `calcQuote` import (engine re-run, drift risk) | BLOCKER | None found |
| `packages/quoting/src/format.ts` | `style: 'currency'` (ICU U+202F drift) | WARNING | None found; `style: 'decimal'` confirmed |
| `packages/quoting/src/index.ts` | `roundHalfUpUsd`/`allocateCuotas` exported (leaks internals) | WARNING | None found; money primitives kept internal |

No anti-patterns detected.

---

### Human Verification Required

None. `packages/quoting` is a pure computation package with no I/O, no external services, no visual UI, and no network calls. All behaviors are deterministically exercised by the test suite and the property-based invariants.

---

## Gaps Summary

No gaps identified. All 5 ROADMAP success criteria verified, all 6 ENGINE requirements satisfied, test suite passes at 100% coverage across all four metrics.

---

_Verified: 2026-07-03T13:35:00Z_
_Verifier: Claude (gsd-verifier)_
