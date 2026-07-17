# Phase 4: Motor de cotización puro (`packages/quoting`) - Research

**Researched:** 2026-07-02
**Domain:** Pure, deterministic Argentine off-plan (preventa en pozo) quoting engine — CAC-adjusted installment finance, exact decimal money, 100% coverage + property-based tests
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Regla de redondeo y asignación de resto (ENGINE-05)**
- **D-01 Granularidad USD:** anticipo, cuota-parte USD y refuerzos se expresan en **USD enteros** (dólares completos, sin centavos) — consistente con `unit_prices.precio` int y "centavos no aplican al rubro" (CLAUDE.md). La reconciliación exacta (anticipo + Σcuotas + Σrefuerzos = precio financiado) se verifica en enteros.
- **D-02 Asignación de resto:** cuota base = **floor(saldo / N)**; las N−1 primeras cuotas son iguales a la base y la **última cuota absorbe el resto** (última ≥ base, nunca menor). Regla nombrada, documentada y testeada como función pura.
- **D-03 Redondeo del anticipo:** anticipo = precio financiado × `anticipoPct`, redondeado **half-up a dólar entero**; el saldo compensa (saldo = precio − anticipo − Σrefuerzos), de modo que la reconciliación cierra exacta.
- **D-04 Cuota ARS:** la cuota expresada en ARS "al valor del mes" (cuota USD × `cac_index.valor`) se emite en `QuoteResult` como **decimal exacto a 2 decimales** (regla "ARS decimal" de CLAUDE.md; decimal.js, nunca float). Las tres superficies muestran ese valor sin re-redondear.

**Semántica de refuerzos**
- **D-05 Moneda de refuerzos:** los refuerzos se pagan en **USD fijo** tal como los declara el plan (`refuerzos[].montoUsd` int) — **sin ajuste CAC**. `QuoteResult` los lista en USD.
- **D-06 Posición en el cálculo:** los refuerzos **descuentan del saldo financiado antes de dividir en cuotas** (saldo = precio − anticipo − Σrefuerzos).
- **D-07 Planes degenerados:** el motor **rechaza con error tipado de dominio** (ej. `SALDO_NO_POSITIVO`, `REFUERZO_FUERA_DE_PLAZO`, índices duplicados). Nunca emite una cotización dudosa ni normaliza silenciosamente; la superficie decide cómo presentarlo.
- **D-08 Forma en el resultado:** cronograma de refuerzos = índice de cuota + monto USD. **Sin fechas calendario** (dependerían del boleto; no se proyecta nada).

**Contrato QuoteInput / QuoteResult**
- **D-09 Precio contado:** `QuoteInput` recibe **dos precios ya resueltos** (precio de la lista contado y precio de la lista financiado). El motor **no calcula descuentos** — el "descuento contado" es la diferencia entre listas, política del developer. Cero lógica de pricing en el motor.
- **D-10 Un resultado por modalidad:** `calcQuote` emite **un `QuoteResult` por modalidad** (contado: sin plan/cuotas; financiado: anticipo + cuotas CAC + refuerzos). La comparación contado-vs-financiado son **dos corridas** del motor.
- **D-11 Cifras de comparación:** el paquete exporta un **helper puro `compareQuotes(contado, financiado)`** que calcula las cifras derivadas (ahorro USD y %) tipadas y 100% cubiertas — las superficies nunca recomputan.

**Alcance del paquete en esta fase**
- **D-12 Motor completo:** esta fase entrega `calcQuote` + `compareQuotes` + `toWhatsAppText` + `toPdfModel` + **formateador es-AR compartido** (server y cliente, mismo output en ambos runtimes — pitfall ICU/U+202F). Todo puro, todo dentro del gate de 100% cobertura.
- **D-13 Política de ENGINE_VERSION:** **solo bumpean la versión los cambios de semántica de cálculo** (fórmula, redondeo, regla de resto). Cambios de copy en serializers NO bumpean. Garantía: misma versión + mismos inputs ⇒ mismos números.

### Claude's Discretion
- Tipado de `QuoteResult` como **unión discriminada por `modalidad`** (`'contado' | 'financiado'`) con campos específicos por variante (derivado de D-10).
- Formato de `ENGINE_VERSION`: **entero incremental**, arranca en 1.
- Modelo de error tipado (union de códigos vs clase de error vs Result type) — elegir el idioma más natural para TS estricto + tRPC downstream; lo importante es D-07 (rechazo explícito, tipado, exhaustivo).
- Nombres exactos de funciones/tipos, estructura interna del paquete, estrategia de generadores fast-check.
- Copy inicial de `toWhatsAppText` (resumen corto, WA-01) y forma del modelo de `toPdfModel` — borradores razonables; se validan contra sus superficies en fases 6/7.

### Deferred Ideas (OUT OF SCOPE)
- None — la discusión se mantuvo dentro del alcance de la fase. Las superficies consumidoras (persistencia/API = fase 5, UI = fase 6, PDF = fase 7) están planificadas como fases posteriores de este milestone. **Cualquier I/O (DB, tRPC, snapshot persist), UI, o render/worker de PDF está fuera de esta fase.** Sin cambios de schema.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENGINE-01 | Cotización **contado** (precio USD de la lista contado) como función pura y determinista, sin I/O | D-09/D-10: modalidad `contado` recibe `precioContadoUsd` ya resuelto; sin plan/cuotas. Pattern 1 (pure engine). El motor no calcula descuento — es la diferencia entre listas. |
| ENGINE-02 | Cotización **financiada**: anticipo USD + N cuotas ajustadas por CAC + refuerzos, primera cuota en ARS "al valor del mes" con **CAC como multiplicador** (nunca proyecta CAC futuro ni FX) | Cálculo: precio financiado → anticipo (D-03) → saldo (D-06) → cuotas (D-02) → cuota ARS = cuotaUsd × cacValor (D-04). CAC entra sólo como multiplicador de display; el USD es el invariante. Pattern 2 + money.ts. |
| ENGINE-03 | Estructura tipada única `QuoteResult` que alimenta UI, PDF y WhatsApp — las tres superficies nunca difieren | Unión discriminada por `modalidad` + serializers `toWhatsAppText`/`toPdfModel` co-ubicados (D-12). Una sola forma de salida; serializers derivan del mismo `QuoteResult`. |
| ENGINE-04 | 100% cobertura en CI + property-based tests (reconciliación, Σcuotas = saldo, CAC monótono ⇒ cuota ARS monótona, determinismo) | `@vitest/coverage-v8` scoped a `packages/quoting/vitest.config.ts` (`thresholds: { 100: true }`); fast-check + @fast-check/vitest. Ver Validation Architecture + Pitfall 4. |
| ENGINE-05 | Dinero en enteros (USD) / decimal (ARS), nunca floats — regla de redondeo + asignación de resto documentada y testeada | decimal.js con `ROUND_HALF_UP` explícito; regla de resto D-02 como función pura nombrada; parseo directo de strings `numeric` a `Decimal` (Pitfall 1). |
| ENGINE-06 | Exporta `ENGINE_VERSION`, embebible en snapshot, bumpeable ante cambio de fórmula | `ENGINE_VERSION = 1` (entero, discreción). Igual al `version` del envelope `quoteSnapshotSchema`. Política de bump D-13. |
</phase_requirements>

## Summary

Phase 4 turns `packages/quoting` from a one-function placeholder (`roundUsd`) into the product's crown-jewel: a **pure, deterministic, zero-I/O** quoting engine that emits a single typed `QuoteResult` per modalidad (`contado` | `financiado`), plus the pure serializers (`toWhatsAppText`, `toPdfModel`), the comparison helper (`compareQuotes`), and a shared es-AR formatter — all inside a 100%-coverage gate with fast-check property tests. This is the type contract every downstream surface (fase 5 persistence, fase 6 UI/WhatsApp, fase 7 PDF) consumes; nothing else in the milestone can be built until this output shape is finalized.

The milestone-level research (`.planning/research/{SUMMARY,STACK,PITFALLS,ARCHITECTURE}.md`, HIGH confidence, dated 2026-07-01) already resolved the stack, the architecture, and the pitfalls specific to this engine — **do not re-research those.** This phase-level research confirms the three net-new dependencies against the npm registry (2026-07-02), verifies them through the package-legitimacy gate (all `OK`), reads the actual placeholder + the six consumed schema files, and translates the locked CONTEXT.md decisions (D-01..D-13) into a prescriptive plan for the planner. The single hardest thing here is not architecture — it is **correctness under adversarial inputs**: cent-exact reconciliation, a named remainder rule, and property tests that assert invariants rather than re-implementing the formula.

**Primary recommendation:** Build the engine bottom-up as pure TS with `decimal.js` (configured once to `ROUND_HALF_UP`) — `money.ts` (rounding + remainder rule D-02) → `types.ts` (discriminated `QuoteResult`, domain errors) → `engine.ts` (`calcQuote`) → `compare.ts` (`compareQuotes`) → `format.ts` (es-AR) → `serialize.ts` (`toWhatsAppText`, `toPdfModel`) → `version.ts` (`ENGINE_VERSION = 1`). Add a **package-scoped** `vitest.config.ts` with `coverage.thresholds: { 100: true }` plus `fast-check`; assert `anticipo + Σcuotas + Σrefuerzos === precioFinanciado` exactly (no tolerance, no `toBeCloseTo`) as the founding invariant. Never let a JS `number` sit in a money position; never `parseFloat` a `numeric` string — wrap it directly in `new Decimal(...)`.

## Architectural Responsibility Map

Every capability in this phase lives in **one tier**: a pure domain library (`packages/quoting`) with zero I/O. The "Secondary Tier" column names the *later-phase consumer* of each output — useful so the planner keeps consumer concerns out of this phase.

| Capability | Primary Tier | Secondary Tier (consumer, NOT this phase) | Rationale |
|------------|-------------|-------------------------------------------|-----------|
| Contado calc (`calcQuote` modalidad contado) | Domain lib (pure) | fase 5 API / fase 6 UI | Pure arithmetic over resolved USD prices; no DB, no clock, no env. |
| Financiada calc (anticipo, cuotas CAC, refuerzos) | Domain lib (pure) | fase 5 API / fase 6 UI / fase 7 PDF | The differentiator; CAC value is passed *in* as an arg, never read. |
| Money rounding + remainder rule (D-02/D-03) | Domain lib (pure) | — (internal) | Named pure functions; the founding invariant of the package. |
| `QuoteResult` type contract | Domain lib (pure) | ALL downstream surfaces | Single source of output shape; discriminated union by modalidad. |
| `compareQuotes` (ahorro USD + %) | Domain lib (pure) | fase 6 UI (UI-03) | Derived figures computed once; surfaces never recompute. |
| es-AR formatter | Domain lib (pure) | fase 6 UI (both runtimes) + fase 7 PDF | Owns symbol/grouping deterministically to defeat ICU/U+202F drift. |
| `toWhatsAppText` / `toPdfModel` serializers | Domain lib (pure) | fase 6 WhatsApp / fase 7 PDF | Derive from the same `QuoteResult` → three surfaces can't drift. |
| `ENGINE_VERSION` | Domain lib (pure) | fase 5 snapshot envelope | Embedded in every snapshot; bump = the only way calc shape changes. |
| **Persistence / snapshot INSERT** | — | **fase 5 (OUT OF SCOPE)** | tRPC + `withTenant`; the RLS crux (anon can't read `cac_index`). |
| **PDF render (react-pdf)** | — | **fase 7 (OUT OF SCOPE)** | The engine emits a pure `PdfModel` (data); the worker owns the JSX/render. |

**Planner sanity check:** if any task in this phase imports `@imbau/db`, `@imbau/api`, `@imbau/storage`, `postgres`, `bullmq`, `react`, or touches `Date.now()`/`Math.random()`/`process.env`, it is misassigned — the engine is pure and those belong to later phases.

## Standard Stack

### Core (net-new for this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `decimal.js` | `10.6.0` | Exact decimal arithmetic (anticipo %, CAC ratio, cuota division/rounding) — the only runtime dep of the engine | [VERIFIED: npm registry] 65.9M weekly downloads, created 2014, repo `MikeMcl/decimal.js`. Arbitrary-precision decimals with **explicit per-operation rounding modes** (`ROUND_HALF_UP`), pure JS, zero native deps, ESM-friendly. JS floats are banned by CLAUDE.md (D-14). Already blessed in `.planning/research/STACK.md`. |
| `fast-check` | `4.8.0` | Property-based testing of engine invariants (dev-only) | [VERIFIED: npm registry] 29.3M weekly downloads, repo `dubzzz/fast-check`. De-facto standard PBT lib for JS/TS; `modelo-mvp.md` §3.4 explicitly mandates "property-based tests además de los unitarios". |
| `@fast-check/vitest` | `0.4.1` | `test.prop([...])` ergonomic Vitest binding for fast-check (dev-only) | [VERIFIED: npm registry] repo `dubzzz/fast-check`; peer `vitest: ^4.1.0` → matches repo's `vitest@4.1.8`. Lets property tests read like normal Vitest cases with per-case reporting. |

### Supporting (already installed — NO new install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@vitest/coverage-v8` | `4.1.8` (root devDep) | 100% coverage gate for `packages/quoting` | [VERIFIED: repo] Already in root `package.json` + `node_modules`. Enforce via a **package-scoped** `packages/quoting/vitest.config.ts`, never a global root threshold. |
| `vitest` | `4.1.8` | Test runner | [VERIFIED: repo] Already a devDep of `packages/quoting`. |
| `typescript` | `5.9.3` | Strict typing | [VERIFIED: repo] Already pinned in the package; `strict` + `noUncheckedIndexedAccess` via `@imbau/config/tsconfig/base.json`. |

### Alternatives Considered (settled in milestone research — do not re-litigate)
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `decimal.js` | `big.js` `7.0.1` | Smaller & float-free but fewer rounding modes / no precision context. Engine is server/RSC — bundle size irrelevant; decimal.js's richer rounding control wins for money. |
| `decimal.js` | `bigint` integer-cents | Forces manual fixed-point scaling + hand-rolled rounding at every %, ÷, and CAC multiply — error-prone in the one package that must be 100% correct. Use `bigint`/integer only for final **stored** whole-USD values, not intermediate math. |
| `decimal.js` | `dinero.js` v2 (`2.0.2` / core alpha) | Money-object oriented; v2 core is alpha, effectively unmaintained, ESM friction. Avoid a stalled dep in the crown-jewel package. Implement the equal-cuota split + remainder yourself with decimal.js. |

**Installation:**
```bash
# packages/quoting — engine + tests (engine has ZERO runtime deps beyond decimal.js)
pnpm --filter @imbau/quoting add decimal.js@10.6.0
pnpm --filter @imbau/quoting add -D fast-check@4.8.0 @fast-check/vitest@0.4.1
# @vitest/coverage-v8, vitest, typescript already present — nothing else to install
```

**Version verification (2026-07-02):** `npm view` confirms `decimal.js@10.6.0`, `fast-check@4.8.0`, `@fast-check/vitest@0.4.1` are all the current `latest`. `@fast-check/vitest` peer is `vitest: ^4.1.0` — satisfied by the repo's `vitest@4.1.8`. `@react-pdf/renderer` from the milestone STACK.md is **NOT** this phase (that is fase 7's worker dependency); the engine emits a pure `PdfModel` data object only.

## Package Legitimacy Audit

Run via `gsd-tools query package-legitimacy check --ecosystem npm decimal.js fast-check @fast-check/vitest` (2026-07-02) — all `OK`, no postinstall scripts.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| decimal.js | npm | ~11 yrs (2014) | 65.9M/wk | github.com/MikeMcl/decimal.js | OK | Approved |
| fast-check | npm | ~8 yrs (2017) | 29.3M/wk | github.com/dubzzz/fast-check | OK | Approved |
| @fast-check/vitest | npm | published 2026-04-28 | 170k/wk | github.com/dubzzz/fast-check | OK | Approved |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none. All three have deep download histories, official source repos, no postinstall scripts, and were independently blessed in `.planning/research/STACK.md`.

## Architecture Patterns

### System Architecture Diagram

Data flow inside the pure engine (no external boundaries — every input arrives as a function argument; every output is a plain value):

```
                     QuoteInput (plain, structurally schema-compatible)
                     ├─ modalidad: 'contado' | 'financiado'
                     ├─ precioContadoUsd: int        (from unit_prices.precio, contado list)
                     ├─ precioFinanciadoUsd: int     (from unit_prices.precio, financiado list)
                     ├─ plan?: { anticipoPct: string, cuotas: int,
                     │           ajuste: 'CAC'|'fijo',
                     │           refuerzos: {cuota:int, montoUsd:int}[] }   (financiado only)
                     └─ cac?: { periodo: 'YYYY-MM', valor: string }        (financiado + ajuste CAC)
                                        │
                                        ▼
        ┌───────────────────  calcQuote(input)  ───────────────────┐
        │                                                          │
   modalidad='contado'                              modalidad='financiado'
        │                                                          │
        ▼                                                          ▼
  ContadoResult                              validate plan (D-07) ──► throw QuoteError
  { modalidad:'contado',                     │  (SALDO_NO_POSITIVO, REFUERZO_FUERA_DE_PLAZO,
    precioUsd, version }                     │   CAC_PERIODO_DUPLICADO, ...)
                                             ▼
                          anticipoUsd = roundHalfUpUsd(precioFin × anticipoPct/100)   [D-03]
                                             ▼
                          saldoUsd = precioFin − anticipoUsd − Σrefuerzos.montoUsd     [D-06]
                                             ▼
                          allocateCuotas(saldoUsd, N):                                  [D-02]
                            base = floor(saldo/N); cuota[0..N-2]=base; cuota[N-1]=base+resto
                                             ▼
                          each cuota: usd, ars = (ajuste==='CAC')                       [D-04]
                                        ? decimal2(usd × cac.valor)   (decimal.js)
                                        : null (fijo → USD only)
                                             ▼
                          FinanciadoResult { modalidad:'financiado', precioUsd,
                            anticipoUsd, saldoUsd, cuotas: CuotaLine[],
                            refuerzos: RefuerzoLine[], cac?, totals, version }
                                             │
              ┌──────────────────────────────┼──────────────────────────────┐
              ▼                               ▼                              ▼
       toWhatsAppText(result)         toPdfModel(result)          compareQuotes(contado, financiado)
       (es-AR formatter)              (es-AR formatter)           → { ahorroUsd, ahorroPct }
```

**Invariant enforced everywhere (property test, exact, no tolerance):**
`anticipoUsd + Σcuotas.usd + Σrefuerzos.montoUsd === precioFinanciadoUsd`

### Recommended Project Structure
```
packages/quoting/src/
├── index.ts             # barrel: calcQuote, compareQuotes, toWhatsAppText, toPdfModel,
│                        #         ENGINE_VERSION, all public types + QuoteError
├── version.ts           # ENGINE_VERSION = 1  (== quoteSnapshotSchema envelope version)
├── money.ts             # Decimal clone (ROUND_HALF_UP), roundHalfUpUsd(), allocateCuotas() [D-02/D-03]
├── errors.ts            # QuoteError domain model (discretion: union code / class / Result)  [D-07]
├── types.ts             # QuoteInput, QuoteResult (discriminated union), CuotaLine, RefuerzoLine
├── engine.ts            # calcQuote(input): QuoteResult — pure; embeds { version: ENGINE_VERSION }
├── compare.ts           # compareQuotes(contado, financiado) — pure derived figures  [D-11]
├── format.ts            # es-AR formatter: US$ / $ literal labels, deterministic grouping [D-12]
├── serialize.ts         # toWhatsAppText(result), toPdfModel(result) — pure, es-AR      [D-12]
├── money.test.ts        # remainder rule, rounding boundaries
├── engine.test.ts       # unit tables (contado / CAC / fijo / refuerzos / degenerate → error)
├── engine.property.test.ts  # fast-check invariants (reconciliation, monotonicity, determinism)
├── format.test.ts       # es-AR grouping + label; run assertions valid in Node (worker) semantics
└── serialize.test.ts    # golden-ish text/model derived purely from a QuoteResult
```
*(Replaces the current `src/index.ts` placeholder `roundUsd` + `src/index.test.ts`. Exact filenames are Claude's discretion per CONTEXT.md.)*

### Pattern 1: Pure engine, versioned output, no I/O
**What:** `calcQuote(input): QuoteResult` is a pure function. It reads no clock, DB, env, or randomness; the caller passes the resolved prices and the CAC value in. Every result embeds `{ version: ENGINE_VERSION }`.
**When to use:** Always — it is the founding constraint of the package (ENGINE-01/02, `modelo-mvp.md` §3.4).
**Example:**
```typescript
// Source: derived from CONTEXT.md D-01..D-06 + ARCHITECTURE.md Pattern 1
import { ENGINE_VERSION } from "./version";
import { roundHalfUpUsd, allocateCuotas, decimal2 } from "./money";

export function calcQuote(input: QuoteInput): QuoteResult {
  if (input.modalidad === "contado") {
    return { modalidad: "contado", precioUsd: input.precioContadoUsd, version: ENGINE_VERSION };
  }
  const { precioFinanciadoUsd: precio, plan, cac } = input;
  const anticipoUsd = roundHalfUpUsd(precio, plan.anticipoPct);        // D-03 half-up whole USD
  const refuerzosTotal = plan.refuerzos.reduce((s, r) => s + r.montoUsd, 0);
  const saldoUsd = precio - anticipoUsd - refuerzosTotal;             // D-06
  if (saldoUsd <= 0) throw new QuoteError("SALDO_NO_POSITIVO");        // D-07 reject, never normalize
  const cuotaUsd = allocateCuotas(saldoUsd, plan.cuotas);            // D-02 last absorbs remainder
  const cuotas = cuotaUsd.map((usd, i) => ({
    indice: i + 1,
    usd,
    ars: plan.ajuste === "CAC" ? decimal2(usd, cac.valor) : null,     // D-04 usd × CAC, 2 decimals
  }));
  // ... refuerzos lines (D-08: indice + montoUsd, no dates), totals
  return { modalidad: "financiado", precioUsd: precio, anticipoUsd, saldoUsd,
           cuotas, refuerzos: plan.refuerzos, cac, /* totals */ version: ENGINE_VERSION };
}
```

### Pattern 2: Money discipline — Decimal in, integer/decimal-string out
**What:** Configure one module-local `Decimal` clone with an explicit rounding mode so the rule is a single visible decision. Parse `numeric` strings (`anticipoPct`, `cac.valor`) **directly** into `Decimal` — never through `parseFloat`/`Number`. USD amounts leave the engine as integers; ARS cuota amounts leave as a 2-decimal value (string or a typed decimal), never a float.
**When to use:** Every arithmetic step (ENGINE-05, Pitfall 1).
**Example:**
```typescript
// Source: STACK.md "Money representation across the boundary" + CONTEXT.md D-01/D-04
import Decimal from "decimal.js";
const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP });        // one visible decision

export function roundHalfUpUsd(precio: number, anticipoPct: string): number {
  // anticipoPct arrives as a numeric STRING from Drizzle — wrap directly, never parseFloat
  return new D(precio).times(new D(anticipoPct)).div(100).round().toNumber();
}

export function allocateCuotas(saldo: number, n: number): number[] {   // D-02
  const base = Math.floor(saldo / n);          // integer USD, no float
  const resto = saldo - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + resto : base));
}

export function decimal2(cuotaUsd: number, cacValor: string): string { // D-04
  return new D(cuotaUsd).times(new D(cacValor)).toFixed(2);            // ARS, exact 2 decimals
}
```

### Pattern 3: One `QuoteResult`, many serializers (no drift)
**What:** `toWhatsAppText` and `toPdfModel` are pure and consume the **same** `QuoteResult` object — never re-run the engine, never re-read data. This is why the three surfaces (UI on screen, PDF, WhatsApp) can never disagree (ENGINE-03).
**When to use:** All surface output originates here; fases 6/7 only *render* these outputs.
**Anti-pattern it prevents:** a surface recomputing figures independently and drifting from the on-screen number.

### Pattern 4: es-AR formatter owns symbol + grouping deterministically
**What:** Do **not** rely on `Intl.NumberFormat('es-AR', {style:'currency'})` for the money string — its narrow no-break space (U+202F) and symbol vary across ICU versions, so browser (fase 6) and Node/worker (fase 7) can disagree by an invisible character. Own the label (`US$ ` for USD, `$ ` for ARS) as a literal with a normal space you control, and use `Intl.NumberFormat('es-AR', {style:'decimal'})` (or a hand-rolled `1.234,56` grouper) for digits only.
**When to use:** Every user-facing amount (Pitfall 9, D-12). Build it here so both later runtimes share one tested implementation.

### Anti-Patterns to Avoid
- **JS `number` in a money position / `parseFloat` a `numeric` string:** reintroduces float drift; banned by CLAUDE.md. Wrap the raw string in `Decimal`.
- **Global 100% coverage threshold in root `vitest.config.ts`:** would force every other package red. Scope the threshold to `packages/quoting/vitest.config.ts` only.
- **Property tests that re-implement the formula as the oracle, or `/* c8 ignore */` to hit the gate:** false confidence in the differentiator. Test invariants, not recomputation.
- **Both prices/plan in one result object:** CONTEXT.md D-10 is deliberate — one `QuoteResult` per modalidad; comparison is `compareQuotes`, not a container object.
- **Distributing the remainder across the first k cuotas:** the research recommended this, but the **user overrode it** (D-02) — last cuota absorbs, N−1 identical. Respect the locked decision.
- **Projecting future CAC or inventing FX:** out of scope (REQUIREMENTS Out of Scope); the engine only multiplies by the passed-in current CAC value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exact decimal % / CAC-ratio / division math | Custom fixed-point scaler on `number` | `decimal.js` (`ROUND_HALF_UP`) | Float drift over N cuotas fails the cent-exact reconciliation; rounding must be a deliberate, per-op decision. |
| Adversarial input generation for tests | Ad-hoc loops over `Math.random()` | `fast-check` + `@fast-check/vitest` | Mature shrinking prints the minimal failing case; `modelo-mvp.md` §3.4 mandates PBT. Random loops aren't reproducible or shrinkable. |
| es-AR currency string | `toLocaleString()` / `Intl` currency style | Own literal label + `Intl` decimal grouping (or hand grouper) | ICU U+202F + version drift makes browser ≠ Node output; breaks "UI == PDF == WhatsApp". |
| Coverage enforcement | Manual "did we test it?" review | `@vitest/coverage-v8` `thresholds: { 100: true }` (package-scoped) | Machine-enforced gate in CI is the ENGINE-04 requirement. |

**Key insight:** In a quoting engine the expensive bugs are *value* bugs (a cent that doesn't reconcile, an invisible space that makes the PDF disagree with the screen), not structural bugs. Every hand-rolled shortcut above trades a well-tested library for a new class of silent value error in the one package CLAUDE.md demands be provably correct.

## Common Pitfalls

### Pitfall 1: Float contamination at the Drizzle `numeric`→string boundary
**What goes wrong:** `anticipoPct` and `cac.valor` arrive as JS **strings** (`"30"`, `"1234.5600"`). The reflex `parseFloat(...)` then `precio * (pct/100)` or `usd * cacValor` reintroduces float error that accumulates across cuotas, and totals drift a few cents from `precio`.
**Why it happens:** The columns look numeric; TS coerces `string → number` silently. Integer columns (`precio`, `montoUsd`) lull you into thinking the engine is float-free when the *multipliers* aren't.
**How to avoid:** Wrap the raw string directly: `new Decimal(row.valor)`. Keep integers integer. Assert `anticipo + Σcuotas + Σrefuerzos === precio` exactly as a fast-check property — no `toBeCloseTo`.
**Warning signs:** `parseFloat`/`Number(...)` near price/CAC; `toBeCloseTo` anywhere in the money suite; totals off by cents.

### Pitfall 2: Installment rounding with no owner for the remainder cent
**What goes wrong:** `saldo / cuotas` rarely divides evenly; naive per-row rounding makes N cuotas whose sum ≠ saldo. Buyers *will* add up the cuotas.
**Why it happens:** Integer division + independent per-row rounding has no rule for the leftover units.
**How to avoid:** Encode the **named** rule D-02 as a pure function (`allocateCuotas`): base = `floor(saldo/N)`, last cuota = `base + resto`. Property-assert `Σcuotas === saldo`.
**Warning signs:** N identical installments in a financiado result; no test named "resto"/"remainder"; `Σcuotas !== saldo`.

### Pitfall 3: CAC missing/duplicated período — silent wrong index
**What goes wrong:** If the caller passes a stale or duplicated CAC value, the engine could silently emit a quote whose ARS number doesn't match the leyenda.
**Why it happens:** The engine is pure, so *resolution* of "which período" is the caller's job (fase 5) — but the engine's **input contract** must make a bad CAC un-representable and reject degenerate combinations (D-07).
**How to avoid (this phase's part):** The `QuoteInput` requires an explicit `{ periodo, valor }` for financiado + CAC; the engine rejects with a typed domain error (e.g. `CAC_PERIODO_DUPLICADO`) rather than "picking latest". No implicit fallback exists inside a pure function. The snapshot (fase 5) records `{ periodo, valor }` so the quote is self-describing.
**Warning signs:** The engine defaulting a missing CAC to `1`; no error path for absent CAC on a `ajuste:'CAC'` plan.

### Pitfall 4: Property tests that game coverage or test the code against itself
**What goes wrong:** 100% line coverage is hit with a couple of narrow `fc.integer()` runs, so remainder-cent / zero-anticipo / all-refuerzos / huge-cuota cases are never generated; or the property body re-derives the engine's arithmetic (tests code against itself); or a `c8 ignore` hides a branch.
**Why it happens:** 100% coverage is easy to reach without exercising *value* edge cases; true invariants are harder to write than "recompute and assert equal".
**How to avoid:** Test **invariants**: (1) totals reconcile exactly; (2) monotonicity — more anticipo ⇒ smaller saldo ⇒ smaller cuotas; CAC monótono ⇒ cuota ARS monótona (ENGINE-04); (3) domain rejection — `anticipoPct ∈ [0,100]`, `cuotas ≥ 1`, Σrefuerzos < precio−anticipo → else typed error; (4) determinism — same input ⇒ byte-identical result; (5) no cuota ≤ 0 when saldo > 0. Use **adversarial generators** (prices to millions, cuotas 1..120+, anticipoPct at 0 and 100, refuerzos consuming the balance, CAC far from 1). **Forbid `c8 ignore`** in the package.
**Warning signs:** property body recomputes the formula; generators are `fc.nat()` with no `max`; 100% coverage but few assertions per test.

### Pitfall 5: es-AR / ICU formatter drift between runtimes
**What goes wrong:** `Intl.NumberFormat('es-AR', {style:'currency'})` inserts U+202F and a symbol whose exact form changed across ICU versions → the string rendered in the browser (fase 6) differs from Node/worker (fase 7) by an invisible character, and `$` on a USD amount reads as pesos (1000× misread).
**How to avoid:** Own `US$ `/`$ ` as literal labels with a normal space; format digits with `Intl.NumberFormat('es-AR', {style:'decimal'})` or a hand grouper. Build it once here, test the exact output string. (Full cross-runtime assertion lands with the surfaces, but the deterministic formatter is authored here per D-12.)
**Warning signs:** `1,234.56` in es-AR output; `$` on a USD value; assertions with a literal normal space that are flaky.

## Runtime State Inventory

> Not a rename/refactor/migration phase — this fills an empty placeholder with new pure logic and adds dev dependencies. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a renamed string. The only replacement is the code-level swap of the placeholder `roundUsd` export.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — engine is pure, reads/writes no datastore. Verified: `packages/quoting` imports nothing from `@imbau/db`. | None |
| Live service config | None — no service touched this phase (persistence is fase 5). | None |
| OS-registered state | None. | None |
| Secrets/env vars | None — engine reads no `process.env`. | None |
| Build artifacts | The placeholder `src/index.ts` (`roundUsd`) + `src/index.test.ts` are removed/replaced by the real modules. No stale compiled artifact (package is `type: module`, `exports` points at `./src/index.ts`, no build step). | Replace placeholder; update the barrel export. Callers importing `roundUsd` (none exist outside the package — verified) are unaffected. |

## Code Examples

### Package-scoped 100% coverage gate (ENGINE-04)
```typescript
// Source: STACK.md "100% coverage gate (package-scoped)" — packages/quoting/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { 100: true },      // lines+functions+branches+statements all = 100
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"], // barrel is re-export only; adjust to taste
    },
  },
});
// NOTE: do NOT add a threshold to the ROOT vitest.config.ts — it would fail every other package.
```

### Property test with fast-check + Vitest (invariant, not recomputation)
```typescript
// Source: STACK.md "Property tests with fast-check + Vitest" + CONTEXT.md D-01 reconciliation
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import { calcQuote } from "./engine";

test.prop([
  fc.integer({ min: 1_000, max: 10_000_000 }),  // precio financiado USD (adversarial range)
  fc.integer({ min: 0, max: 100 }),             // anticipoPct boundaries included
  fc.integer({ min: 1, max: 120 }),             // cuotas
])("anticipo + Σcuotas + Σrefuerzos reconciles to precio exactly", (precio, pct, n) => {
  const r = calcQuote({ modalidad: "financiado", precioFinanciadoUsd: precio,
    precioContadoUsd: precio, plan: { anticipoPct: String(pct), cuotas: n, ajuste: "fijo", refuerzos: [] },
    cac: undefined });
  if (r.modalidad !== "financiado") throw new Error("expected financiado");
  const sum = r.anticipoUsd + r.cuotas.reduce((s, c) => s + c.usd, 0)
              + r.refuerzos.reduce((s, x) => s + x.montoUsd, 0);
  // EXACT — no tolerance, no toBeCloseTo
  if (sum !== precio) throw new Error(`reconcile failed: ${sum} !== ${precio}`);
});
```

### Snapshot envelope alignment (ENGINE-06)
```typescript
// Source: packages/db/src/schema/json-schemas.ts (quoteSnapshotSchema) + CONTEXT.md D-13
// The DB envelope is fixed: z.object({ version: z.literal(1) }).passthrough()
// The engine's ENGINE_VERSION MUST equal that envelope version so fase 5 can persist
//   { version: ENGINE_VERSION, inputs, result } with no migration.
export const ENGINE_VERSION = 1 as const;   // bump ONLY on calc-semantics change (D-13)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Placeholder `roundUsd(amount: number)` on JS float | Full engine on `decimal.js` with explicit `ROUND_HALF_UP`, integer-USD I/O | This phase | The placeholder's `Math.round(number)` is exactly the float pattern CLAUDE.md bans in money positions — it is removed. |
| `dinero.js` v2 for money objects | `decimal.js` + hand-written allocation | Milestone decision | v2 core is alpha/unmaintained with ESM friction; avoid in the crown-jewel package. |
| `Intl` currency style for the money string | Own literal label + deterministic decimal grouping | Milestone decision | Defeats U+202F/ICU cross-runtime drift so UI == PDF == WhatsApp. |

**Deprecated/outdated:**
- `packages/quoting/src/index.ts` placeholder `roundUsd` — superseded by `money.ts`/`engine.ts`.

## Assumptions Log

> All package versions, schema facts, and stack choices are VERIFIED (npm registry 2026-07-02, direct schema reads, package-legitimacy gate) or CITED from the HIGH-confidence milestone research. The items below are the only non-verified modeling assumptions the planner should confirm during planning/discuss.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | For `ajuste: 'fijo'` plans the cuota carries **no ARS value** (`ars: null`), i.e. CAC multiplier applies only to `ajuste: 'CAC'`. CONTEXT.md/REQUIREMENTS emphasize the CAC path; the fijo ARS treatment is inferred, not stated. | Pattern 1 / engine | Low — a fijo plan showing/omitting an ARS cuota is a display choice; either way USD reconciliation is unaffected. Confirm the intended fijo display with the user. |
| A2 | `QuoteInput` supplies **both** resolved USD prices on every call (contado + financiado) even for a single-modalidad run, mirroring D-09's "dos precios ya resueltos". Alternative: only the price relevant to the requested modalidad. | types.ts | Low — a typing-shape choice within Claude's discretion; affects the input contract fases 5/6 map rows into. Planner should pick and document. |
| A3 | ENGINE-02's "primera cuota en ARS" is realized by giving **every** cuota line an `ars` field (first cuota is `cuotas[0].ars`), rather than a single scalar first-cuota field. | Pattern 1 / types.ts | Low — internal shape (discretion); all surfaces read from the same result either way. |

## Open Questions (RESOLVED)

> Both open questions were resolved in `04-CONTEXT.md` (`/gsd-discuss-phase`) and are implemented in the phase plans. Retained here with inline resolutions for traceability.

1. **Q1 RESOLVED — Domain-error idiom (union code vs error class vs `Result` type).**
   - **Resolution:** a discriminated `QuoteError` class carrying a `QuoteErrorCode` union (`SALDO_NO_POSITIVO | REFUERZO_FUERA_DE_PLAZO | CAC_PERIODO_DUPLICADO | ...`) thrown from `calcQuote` (D-07). Implemented in **plan 04-02**; each code branch is unit-tested for the 100% coverage gate.
   - What we knew: D-07 mandates explicit, typed, exhaustive rejection of degenerate plans; the specific idiom was Claude's discretion.
   - Why this idiom: cleanest for TS-strict + the fase-5 tRPC boundary — a thrown `QuoteError` maps directly to a tRPC error (vs. a `Result` type that forces every caller to branch).

2. **Q2 RESOLVED — `toWhatsAppText` / `toPdfModel` initial copy fidelity.**
   - **Resolution:** ship reasonable draft copy now (es-AR voseo, borradores razonables) and do **not** bump `ENGINE_VERSION` when copy is later refined (D-12/D-13). Implemented in **plan 04-04**; the serializer contract (shape) is load-bearing, the copy is not.
   - What we knew: D-12/CONTEXT mark the initial copy as "borradores razonables"; final copy is validated against surfaces in fases 6/7 without an `ENGINE_VERSION` bump (D-13).
   - Why: the shape is the fixed contract downstream fases map into; exact wording and PDF field names are refined against real surfaces later.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | build/test of the package | ✓ (via nvm) | 22 (shell default is 20 — use `nvm use 22`) | — |
| pnpm | install deps / run scripts | ✓ (via corepack) | 11.6.0 pinned | — |
| vitest | test runner | ✓ | 4.1.8 (installed) | — |
| @vitest/coverage-v8 | 100% gate | ✓ | 4.1.8 (root devDep) | — |
| decimal.js | engine math | ✗ (to install) | 10.6.0 | none needed — install per Installation |
| fast-check / @fast-check/vitest | property tests | ✗ (to install) | 4.8.0 / 0.4.1 | none needed — install per Installation |

**Missing dependencies with no fallback:** none — the two net-new install groups are the plan's first task; no external service, DB, or network is required (the engine is pure).
**Note:** the local shell defaults to Node 20 (per user memory); CI and Docker use Node 22. Ensure `nvm use 22` before running the package's tests locally.

## Validation Architecture

> `workflow.nyquist_validation` is `true` — section included. This phase **is** the validation-heaviest of the milestone (100% coverage + PBT is a hard requirement, ENGINE-04).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 + `@fast-check/vitest` 0.4.1 (fast-check 4.8.0) |
| Config file | `packages/quoting/vitest.config.ts` — **NEW this phase** (Wave 0); adds package-scoped `coverage.thresholds: { 100: true }` |
| Quick run command | `pnpm --filter @imbau/quoting test` |
| Full suite command | `pnpm --filter @imbau/quoting test -- --coverage` (fails if any metric < 100%) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENGINE-01 | Contado result = resolved contado USD price, pure/deterministic | unit | `pnpm --filter @imbau/quoting test engine.test` | ❌ Wave 0 |
| ENGINE-02 | Financiada: anticipo + cuotas CAC + refuerzos; first cuota ARS = usd×CAC | unit + property | `pnpm --filter @imbau/quoting test engine` | ❌ Wave 0 |
| ENGINE-03 | Single `QuoteResult` feeds `toWhatsAppText`/`toPdfModel` identically | unit | `pnpm --filter @imbau/quoting test serialize.test` | ❌ Wave 0 |
| ENGINE-04 | 100% coverage + invariants (reconcile, Σcuotas=saldo, CAC monótono⇒cuota ARS monótona, determinism) | property + coverage gate | `pnpm --filter @imbau/quoting test -- --coverage` | ❌ Wave 0 |
| ENGINE-05 | Money integer USD / decimal ARS; remainder rule (D-02) foots to the cent | unit + property | `pnpm --filter @imbau/quoting test money` | ❌ Wave 0 |
| ENGINE-06 | `ENGINE_VERSION` exported, equals snapshot envelope version | unit | `pnpm --filter @imbau/quoting test version` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/quoting test` (fast — pure functions, no I/O).
- **Per wave merge:** `pnpm --filter @imbau/quoting test -- --coverage` (enforces the 100% gate).
- **Phase gate:** full suite + coverage green before `/gsd-verify-work`; also `pnpm --filter @imbau/quoting typecheck` and `lint`.

### Wave 0 Gaps
- [ ] `packages/quoting/vitest.config.ts` — package-scoped coverage gate `thresholds: { 100: true }` (does not exist yet).
- [ ] Install `fast-check@4.8.0` + `@fast-check/vitest@0.4.1` (dev) and `decimal.js@10.6.0` (runtime).
- [ ] `packages/quoting/src/engine.property.test.ts` — invariants for ENGINE-04 (reconciliation, monotonicity, determinism).
- [ ] `packages/quoting/src/money.test.ts` — remainder rule D-02 + rounding boundaries (ENGINE-05).
- [ ] Remove placeholder `src/index.test.ts` (`roundUsd`) once superseded.
- [ ] (Optional) forbid `/* c8 ignore */` in the package via lint or review checklist (Pitfall 4).

## Security Domain

> `security_enforcement` is `true`, `security_asvs_level` 1 — section included. This is a **pure, I/O-free library**: no auth, no session, no network, no filesystem, no crypto. The only relevant control class is input validation of the domain contract.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Engine has no auth surface (persistence/auth is fase 5). |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No data access — RLS/tenant isolation is enforced by the fase-5 caller, not here. |
| V5 Input Validation | **yes** | Reject degenerate/out-of-domain `QuoteInput` with typed domain errors (D-07): `SALDO_NO_POSITIVO`, `REFUERZO_FUERA_DE_PLAZO`, duplicate/absent CAC período, `anticipoPct ∉ [0,100]`, `cuotas < 1`. Never normalize silently. Callers (fase 5) additionally Zod-validate at the tRPC boundary and never trust client-supplied prices/CAC. |
| V6 Cryptography | no | No secrets, tokens, or hashing in the engine. |

### Known Threat Patterns for a pure quoting engine

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/degenerate plan yields a plausible-but-wrong quote | Tampering / Repudiation | Explicit typed rejection (D-07); exhaustive branch tests; exact reconciliation invariant. |
| Float drift silently misrepresents money | Tampering | `decimal.js` only; no `number` in money positions; cent-exact property tests (Pitfall 1). |
| Non-determinism (clock/random) breaks snapshot auditability | Repudiation | Purity constraint — no `Date.now()`/`Math.random()`/env; determinism property test (Pitfall 4). |

**Note for downstream:** the real access-control / anon-write / rate-limit threats (leaking `cac_index`, quote spam, PII in snapshot) belong to **fase 5** (see `.planning/research/PITFALLS.md` P5/P6) — they are out of scope for this pure-engine phase and must not be pulled forward.

## Sources

### Primary (HIGH confidence)
- `packages/db/src/schema/{payment-plans,json-schemas,cac-index,unit-prices,price-lists,quotes}.ts` — direct reads; money column types (`precio` int, `anticipoPct`/`valor` numeric→string), `refuerzoSchema` (`{cuota:int, montoUsd:int}`), `quoteSnapshotSchema` (`{version: z.literal(1)}.passthrough()`), tenant-private RLS posture.
- `packages/quoting/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}` + root `vitest.config.ts` + `packages/config/tsconfig/base.json` — existing skeleton, strict TS, no threshold yet.
- npm registry (`npm view`) + `gsd-tools query package-legitimacy check`, 2026-07-02 — decimal.js 10.6.0, fast-check 4.8.0, @fast-check/vitest 0.4.1 (all `OK`, peer `vitest ^4.1.0`).
- `.planning/research/{SUMMARY,STACK,PITFALLS,ARCHITECTURE}.md` (2026-07-01, HIGH) — stack, engine architecture, money/rounding/formatter pitfalls, build order.
- `docs/modelo-mvp.md` §3.4 — engine spec (pure/deterministic, 100% coverage, PBT, snapshot + engine version).
- `.planning/phases/04-.../04-CONTEXT.md` — locked decisions D-01..D-13 + Claude's discretion.
- `CLAUDE.md` — money rules (integer USD / decimal ARS, never floats), quality gates, es-AR voseo.

### Secondary (MEDIUM confidence)
- Node.js issue #15223 (via PITFALLS.md) — `Intl.NumberFormat` currency spacing/U+202F drift across ICU versions.

### Tertiary (LOW confidence)
- None load-bearing for this phase (wa.me URL-length ceiling etc. belong to fase 6).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — three deps verified on npm 2026-07-02 + legitimacy gate `OK` + independently blessed in milestone STACK.md.
- Architecture: HIGH — grounded in direct schema/skeleton reads and the HIGH-confidence milestone ARCHITECTURE.md; the engine is self-contained pure logic.
- Pitfalls: HIGH (money/rounding/purity, schema-verified) / MEDIUM (ICU formatter drift — ecosystem-documented, not re-tested this session).

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (stable domain; decimal.js/fast-check are mature — re-verify versions only if planning slips past ~30 days).

## Project Constraints (from CLAUDE.md)

Directives the planner must honor (same authority as locked decisions):
- **TypeScript estricto** (`strict: true`, `noUncheckedIndexedAccess: true`), sin `any` salvo justificación comentada.
- `packages/quoting`: **funciones puras sin I/O, cobertura 100% exigida, property-based tests además de unitarios.** "Un error de cálculo acá mata el producto."
- **Dinero en enteros (USD) / decimal (ARS), nunca floats.**
- Todo cambio pasa **lint + type-check + tests** antes de commit; CI roja = no se mergea.
- Errores manejados y observables — pero la observabilidad (Sentry/pino) es de las superficies; el motor **rechaza con error tipado de dominio** (D-07), no loguea.
- Idioma: código/identificadores/commits en **inglés**; output de usuario (texto WhatsApp, labels PDF) en **es-AR voseo**.
- Commits: Conventional Commits; rama `fase-N/descripcion` (actual: `fase-0/foundation`).
