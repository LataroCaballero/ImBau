# Phase 4: Motor de cotización puro (`packages/quoting`) - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 13 (10 new src modules + 1 modified config + 1 modified package.json + 1 removed placeholder)
**Analogs found:** 9 / 13 (4 novel — pure engine logic has no in-repo analog by design)

> This is a **pure, zero-I/O domain library**. There is no controller/service/HTTP analog because the engine touches no DB, network, clock, env, or randomness (RESEARCH.md "Planner sanity check"). Analogs therefore cover the **package scaffolding** (package.json, vitest config, tsconfig, barrel, test style) and the **input-type shapes** (schema files the `QuoteInput` contract must be structurally compatible with). The engine's arithmetic itself is net-new and follows RESEARCH.md Patterns 1–4, not an existing file.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/quoting/src/version.ts` | config/constant | transform | `packages/db/src/schema/json-schemas.ts` (`quoteSnapshotSchema` version) | exact (contract pair) |
| `packages/quoting/src/money.ts` | utility | transform | — (novel: decimal.js math, first use in repo) | no analog |
| `packages/quoting/src/errors.ts` | model | transform | `packages/db/src/schema/json-schemas.ts` (typed contract module) | role-match |
| `packages/quoting/src/types.ts` | model | transform | `packages/db/src/schema/json-schemas.ts` (`refuerzoSchema`, `Refuerzo`, discretion types) | exact (input shapes) |
| `packages/quoting/src/engine.ts` | service (pure) | transform | — (novel: `calcQuote` core logic) | no analog |
| `packages/quoting/src/compare.ts` | utility (pure) | transform | — (novel derived-figures helper) | no analog |
| `packages/quoting/src/format.ts` | utility (pure) | transform | — (novel es-AR formatter) | no analog |
| `packages/quoting/src/serialize.ts` | utility (pure) | transform | `packages/quoting/src/index.ts` (pure-fn + es-AR doc convention) | role-match |
| `packages/quoting/src/index.ts` (barrel, replace) | config/barrel | — | `packages/db/src/index.ts` | exact |
| `packages/quoting/src/*.test.ts` (unit) | test | — | `packages/quoting/src/index.test.ts` | exact |
| `packages/quoting/src/engine.property.test.ts` | test | — | — (novel: fast-check, first use in repo) | no analog (RESEARCH ex.) |
| `packages/quoting/vitest.config.ts` (new) | config | — | `packages/db/vitest.config.ts` (mergeConfig) | exact |
| `packages/quoting/package.json` (modify deps) | config | — | `packages/db/package.json` / current file | exact |

## Pattern Assignments

### `packages/quoting/vitest.config.ts` (config — NEW this phase)

**Analog:** `packages/db/vitest.config.ts` (lines 1-29) — the established per-package Vitest pattern.

**mergeConfig pattern** (`packages/db/vitest.config.ts` lines 1-18):
```typescript
import { mergeConfig, defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.test.ts"],
      globalSetup: ["./tests/setup.ts"],
      hookTimeout: 60_000,
      testTimeout: 30_000,
    },
  }),
);
```

**How to adapt (do NOT copy the db specifics):**
- Keep `mergeConfig(rootConfig, ...)` so the root v8 coverage provider (`vitest.config.ts` lines 12-15) is inherited.
- Engine is pure — **drop** `globalSetup`, `hookTimeout`, `testTimeout` (those exist only because db/api open real Postgres). This package needs none.
- ADD the package-scoped 100% gate that no existing package has (ENGINE-04):
  ```typescript
  test: {
    coverage: {
      thresholds: { 100: true },
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
    },
  }
  ```
- **Critical (RESEARCH anti-pattern + root file comment):** the root `vitest.config.ts` (lines 4-6) deliberately has NO threshold "No coverage threshold yet — the 100% quoting gate lands with QUOT-01." The threshold belongs ONLY here; a root threshold reddens every other package.

---

### `packages/quoting/package.json` (config — MODIFY)

**Analog:** current `packages/quoting/package.json` (lines 1-19) — keep the exact shape, only add deps.

**Established shape to preserve** (lines 1-13): `"type": "module"`, `exports: { ".": "./src/index.ts" }` (JIT raw-TS, no build step), scripts `lint`/`typecheck`/`test` unchanged.

**Deps to add** (per RESEARCH Installation, lines 108-113):
```jsonc
"dependencies": { "decimal.js": "10.6.0" },
"devDependencies": {
  "@imbau/config": "workspace:*",
  "typescript": "5.9.3",
  "vitest": "4.1.8",
  "@vitest/coverage-v8": "4.1.8",   // present at root; add here for the package gate
  "fast-check": "4.8.0",
  "@fast-check/vitest": "0.4.1"
}
```

---

### `packages/quoting/src/index.ts` (barrel — REPLACE placeholder)

**Analog:** `packages/db/src/index.ts` (lines 1-9) — the repo's barrel convention.

**Barrel pattern** (`packages/db/src/index.ts`):
```typescript
export { withTenant, withAnon } from "./with-tenant";
export type { ResolvedMedia } from "./resolve-media";
export * as schema from "./schema";
```

**Apply:** re-export runtime (`calcQuote`, `compareQuotes`, `toWhatsAppText`, `toPdfModel`, `ENGINE_VERSION`) with `export {}`, and every type + `QuoteError` type-surface with `export type {}`. **`verbatimModuleSyntax: true`** is on (config base.json) — type-only re-exports MUST use `export type`, matching the db barrel's `export type { ResolvedMedia }`. Remove the placeholder `roundUsd`; no external caller imports it (RESEARCH Runtime State Inventory, verified).

---

### `packages/quoting/src/version.ts` (constant — NEW)

**Analog:** `packages/db/src/schema/json-schemas.ts` lines 33-34 — the fixed snapshot envelope this constant must equal.

**Contract pair** (`json-schemas.ts` line 33):
```typescript
export const quoteSnapshotSchema = z.object({ version: z.literal(1) }).passthrough();
```

**Apply:** `export const ENGINE_VERSION = 1 as const;` (RESEARCH lines 369-376). It MUST equal the `z.literal(1)` envelope so fase 5 persists `{ version: ENGINE_VERSION, ... }` with no migration. Bump only on calc-semantics change (D-13).

---

### `packages/quoting/src/types.ts` (model — NEW)

**Analog:** `packages/db/src/schema/json-schemas.ts` (lines 6-15) — the hand-authored typed-contract convention, plus the six consumed schema files for the exact input scalar types.

**Contract module pattern** (`json-schemas.ts` lines 11-15):
```typescript
export const refuerzoSchema = z.object({
  cuota: z.number().int(),
  montoUsd: z.number().int(),
});
export type Refuerzo = z.infer<typeof refuerzoSchema>;
```

**Input scalar types the `QuoteInput` contract MUST mirror** (structurally compatible — the engine never imports `@imbau/db`, callers map rows in):

| Source column | Type as it leaves Drizzle | `QuoteInput` field |
|---------------|---------------------------|--------------------|
| `unit_prices.precio` (`integer`) — `unit-prices.ts:46` | `number` (int USD) | `precioContadoUsd` / `precioFinanciadoUsd`: `number` |
| `payment_plans.anticipoPct` (`numeric`) — `payment-plans.ts:34` | **`string`** decimal | `plan.anticipoPct: string` |
| `payment_plans.cuotas` (`integer`) — `payment-plans.ts:35` | `number` | `plan.cuotas: number` |
| `payment_plans.ajuste` (enum) — `payment-plans.ts:37` | `'CAC' \| 'fijo'` | `plan.ajuste` |
| `payment_plans.refuerzos` (JSONB `Refuerzo[]`) — `payment-plans.ts:40` | `{cuota:number,montoUsd:number}[]` | `plan.refuerzos` (reuse `Refuerzo` shape) |
| `cac_index.valor` (`numeric(12,4)`) — `cac-index.ts:25` | **`string`** decimal | `cac.valor: string` |
| `cac_index.periodo` (`text`) — `cac-index.ts:23` | `string` "YYYY-MM" | `cac.periodo: string` |

**Critical:** `anticipoPct` and `cac.valor` arrive as **strings** (Drizzle `numeric`→string) — the discretion note in `payment-plans.ts:34` ("numeric (decimal), never float") is the money rule this contract enforces. `QuoteResult` is a discriminated union on `modalidad: 'contado' | 'financiado'` (Claude's discretion, D-10). Comment each type in English following the `json-schemas.ts` header style.

---

### `packages/quoting/src/errors.ts` (model — NEW, novel idiom)

**Analog:** role-match to `json-schemas.ts` (a typed-contract module), but the error idiom itself is net-new (Open Question 1).

**Apply (RESEARCH recommendation, lines 401-404):** a discriminated `QuoteError` with an exhaustive `code` union — `SALDO_NO_POSITIVO | REFUERZO_FUERA_DE_PLAZO | CAC_PERIODO_DUPLICADO | ...` — thrown from `calcQuote`. Reads cleanly and maps to a fase-5 tRPC error. D-07: reject explicitly, never normalize silently. Every branch must be unit-tested (required for the 100% gate anyway).

---

### `packages/quoting/src/money.ts` (utility — NEW, NO ANALOG)

**Analog:** none — first `decimal.js` use in the repo. Follow RESEARCH Pattern 2 (lines 231-254) verbatim.

**Core pattern (RESEARCH lines 237-253):**
```typescript
import Decimal from "decimal.js";
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });   // one visible decision

export function roundHalfUpUsd(precio: number, anticipoPct: string): number {
  return new D(precio).times(new D(anticipoPct)).div(100).round().toNumber();  // D-03
}
export function allocateCuotas(saldo: number, n: number): number[] {           // D-02
  const base = Math.floor(saldo / n);
  const resto = saldo - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + resto : base));
}
export function decimal2(cuotaUsd: number, cacValor: string): string {         // D-04
  return new D(cuotaUsd).times(new D(cacValor)).toFixed(2);
}
```

**Rules (money discipline):** never `parseFloat`/`Number` a `numeric` string — wrap directly in `Decimal` (Pitfall 1). USD leaves as integer, ARS leaves as 2-decimal string. D-02 remainder rule (last cuota absorbs) is deliberate over research's original suggestion — respect it.

---

### `packages/quoting/src/engine.ts` (service pure — NEW, NO ANALOG)

**Analog:** none — `calcQuote` core logic is net-new. Follow RESEARCH Pattern 1 (lines 205-228) and the data-flow diagram (lines 136-175). Founding invariant, exact, no tolerance: `anticipoUsd + Σcuotas.usd + Σrefuerzos.montoUsd === precioFinanciadoUsd`.

---

### `packages/quoting/src/compare.ts` / `format.ts` / `serialize.ts` (pure utilities — NEW)

- **`compare.ts`** — no analog; `compareQuotes(contado, financiado) → { ahorroUsd, ahorroPct }` (D-11). Surfaces never recompute.
- **`format.ts`** — no analog; es-AR formatter owning `US$ `/`$ ` literal labels + `Intl.NumberFormat('es-AR', {style:'decimal'})` for digits. Do NOT use `{style:'currency'}` (Pitfall 5 / U+202F ICU drift).
- **`serialize.ts`** — role-match to the existing `src/index.ts` (pure functions with es-AR-aware doc comments). `toWhatsAppText` / `toPdfModel` consume the SAME `QuoteResult`, never re-run the engine (Pattern 3). Copy is es-AR voseo; drafts OK (D-12, does not bump ENGINE_VERSION).

---

### Test files (`*.test.ts` unit — NEW)

**Analog:** `packages/quoting/src/index.test.ts` (lines 1-13) — the repo's unit test style.

**Style pattern:**
```typescript
import { describe, expect, it } from "vitest";
import { roundUsd } from "./index";

describe("roundUsd", () => {
  it("rounds up to the nearest whole USD", () => {
    expect(roundUsd(1234.6)).toBe(1235);
  });
});
```

**Apply:** co-located `src/*.test.ts` (NOT a `tests/` dir — that's the db/api integration convention; this package's default glob resolves `src/**/*.test.ts` per the root config comment). Remove `index.test.ts` (`roundUsd`) once superseded.

### `packages/quoting/src/engine.property.test.ts` (test — NEW, NO ANALOG)

**Analog:** none — first `fast-check` use in the repo. Follow RESEARCH property-test example (lines 346-367).

```typescript
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { calcQuote } from "./engine";

test.prop([
  fc.integer({ min: 1_000, max: 10_000_000 }),
  fc.integer({ min: 0, max: 100 }),
  fc.integer({ min: 1, max: 120 }),
])("anticipo + Σcuotas + Σrefuerzos reconciles exactly", (precio, pct, n) => { /* EXACT ===, no toBeCloseTo */ });
```

**Test invariants, never recompute the formula** (Pitfall 4): reconciliation (exact), monotonicity (more anticipo ⇒ smaller cuotas; CAC monótono ⇒ ARS monótona), domain rejection, determinism, no cuota ≤ 0. Forbid `/* c8 ignore */`.

## Shared Patterns

### Strict TypeScript boundary
**Source:** `packages/config/tsconfig/base.json` (inherited via `packages/quoting/tsconfig.json`)
**Apply to:** all `src/*.ts`
`strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`. Consequences: array access is `T | undefined` (guard `cuotas[i]`); type-only imports/exports need `import type`/`export type`; no `any` without a justifying comment (CLAUDE.md).

### Money discipline (never float)
**Source:** RESEARCH Pattern 2 + column doc comments (`unit-prices.ts:46`, `payment-plans.ts:34`, `cac-index.ts:25`)
**Apply to:** `money.ts`, `engine.ts`, `compare.ts`, all money tests
Integer USD in/out; ARS as 2-decimal string via `decimal.js`; `numeric` strings wrapped directly in `Decimal`; assertions use exact `===`, never `toBeCloseTo`.

### English code / es-AR voseo user output
**Source:** CLAUDE.md + existing `src/index.ts` header convention
**Apply to:** all files — identifiers/comments/commits in English; only `toWhatsAppText` copy and `toPdfModel` labels in es-AR voseo.

### Typed contract co-location
**Source:** `packages/db/src/schema/json-schemas.ts` (lines 1-34)
**Apply to:** `types.ts`, `errors.ts`, `version.ts` — hand-authored types + inferred aliases, English header comment explaining the contract's role and who consumes it downstream.

## No Analog Found

Files whose core logic has no in-repo precedent (use RESEARCH.md patterns, cited above, instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/money.ts` | utility | transform | First `decimal.js` use; follow RESEARCH Pattern 2 |
| `src/engine.ts` | service (pure) | transform | `calcQuote` core arithmetic is net-new; RESEARCH Pattern 1 + diagram |
| `src/compare.ts` | utility | transform | Derived-figures helper; no precedent |
| `src/format.ts` | utility | transform | es-AR deterministic formatter; RESEARCH Pattern 4 |
| `src/engine.property.test.ts` | test | — | First `fast-check`/PBT use; RESEARCH property example |

## Metadata

**Analog search scope:** `packages/quoting`, `packages/db` (schema + barrel + vitest), `packages/api`, root `vitest.config.ts`, `packages/config/tsconfig`.
**Files scanned:** ~14 (quoting skeleton x4, db schema x4, db/api/root vitest configs x3, db barrel, config base, grep for decimal.js/fast-check — none exist yet).
**Pattern extraction date:** 2026-07-02
