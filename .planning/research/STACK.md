# Stack Research — v1.2 Cotizador

**Domain:** Argentine off-plan real-estate quoting engine (pure calc) + public quoting UI + server-side PDF + WhatsApp handoff
**Researched:** 2026-07-01
**Confidence:** HIGH (all versions verified against the npm registry 2026-07-01; react-pdf/fast-check peer ranges confirmed)

> **Scope note.** This milestone ADDS a feature to an already-validated stack (pnpm+Turborepo, Next 16/React 19, tRPC v11+Zod 4, PG16+Drizzle+RLS, BullMQ+Redis worker, Vitest 4, R2, Sentry/pino). Only NEW additions for the quoting feature are researched here. Everything else is unchanged and must NOT be re-litigated. Net new runtime deps: **2** (`decimal.js`, `@react-pdf/renderer` + its `react` peer in the worker). Net new dev deps: **2** (`fast-check`, `@fast-check/vitest`). Everything else (coverage gate, wa.me link, snapshot persistence) reuses tools already in the repo.

## Recommended Stack

### Core Technologies (NEW for this milestone)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **decimal.js** | `10.6.0` | Exact decimal arithmetic inside `packages/quoting` (percentages, CAC index ratios, cuota division/rounding) | The calc chain (base USD → anticipo % → saldo → ÷ N cuotas → × CAC index) produces non-integer intermediates. `Number` floats are banned by CLAUDE.md and would drift cents. `decimal.js` gives arbitrary-precision decimals with **explicit, per-operation rounding modes** (`ROUND_HALF_UP`, `ROUND_HALF_EVEN`) — mandatory for money where the rounding rule must be a deliberate decision, not an accident. Pure JS, zero native deps, ESM-friendly, works untouched in the Alpine worker and in RSC. |
| **fast-check** | `4.8.0` | Property-based testing of the quoting engine (invariants: monotonicity, sum-of-cuotas = saldo, no negative money, idempotent snapshot) | The de-facto standard PBT library for JS/TS, runner-agnostic, mature shrinking. modelo-mvp §3.4 explicitly demands "property-based tests además de los unitarios". Node `>=12`, works with Vitest 4 out of the box. |
| **@react-pdf/renderer** | `4.5.1` | Server-side quote PDF in the BullMQ worker (tables, logo, "cotización no vinculante" legal text, es-AR accents) | Renders a PDF to a Buffer/stream **in pure Node with no headless browser** (uses its own `@react-pdf/pdfkit` fork under the hood) — ideal for the slim `node:22-alpine` worker image. Declarative flexbox layout makes the price/cuota **tables** and branded header far cleaner than imperative PDFKit. Peer `react: ^19` matches the repo's React 19. Built-in standard Helvetica covers Latin-1 (á é í ó ú ñ ¿ ¡), so Spanish renders without extra fonts (custom brand font optional via `Font.register`). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@fast-check/vitest** | `0.4.1` | `test.prop([...])` ergonomic integration of fast-check into Vitest | Optional but recommended DX: lets property tests read like normal Vitest cases and report per-generated-case. Pull in alongside `fast-check`. |
| **react** | `19.2.x` (match repo) | Peer required by `@react-pdf/renderer` in the **worker** | Add to `apps/worker` deps only (worker has no React today). react-pdf uses its own reconciler; no `react-dom` needed. |
| **@vitest/coverage-v8** | `4.1.8` (already installed) | 100% coverage gate for `packages/quoting` | Already a root devDep — **no new install**. Enforce via a package-scoped `packages/quoting/vitest.config.ts` with `coverage.thresholds: { 100: true }` (see Patterns). |
| **drizzle-zod** | `0.8.3` (already installed) | Derive the Zod schema for the persisted quote **snapshot** (inputs+outputs+engine version) | Reuse existing lib to validate the JSONB `quotes.snapshot` shape at the tRPC/worker boundary — no new dep. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest 4 coverage thresholds | Fail CI if quoting < 100% | Use `thresholds: { 100: true }` (shorthand sets lines/functions/branches/statements all to 100). Scope it to `packages/quoting` only — do NOT set a global 100% root threshold or every other package's CI goes red. |
| tsup (worker bundler) | Ship react-pdf + fonts | Keep `react`/`@react-pdf/renderer` **external** (they're copied via `node_modules` in the Dockerfile, not inlined). If a custom brand TTF is used, it is a runtime asset — `Font.register` needs the file present in the image; tsup will NOT bundle a `.ttf`, so COPY it explicitly in the Dockerfile. |
| Native `URL` / `URLSearchParams` | wa.me deep link | **No library.** See Patterns. |

## Installation

```bash
# packages/quoting — engine + tests (dev-only; engine has ZERO runtime deps beyond decimal.js)
pnpm --filter @imbau/quoting add decimal.js@10.6.0
pnpm --filter @imbau/quoting add -D fast-check@4.8.0 @fast-check/vitest@0.4.1

# apps/worker — PDF generation
pnpm --filter @imbau/worker add @react-pdf/renderer@4.5.1 react@19.2.0

# (coverage-v8, drizzle-zod, zod already present — nothing to install)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **decimal.js** `10.6.0` | **big.js** `7.0.1` | `big.js` is smaller and also float-free, but has fewer rounding modes and no configurable precision context. Pick it only if bundle size in the engine mattered (it doesn't — engine is server/RSC). decimal.js's richer rounding control wins for money. |
| **decimal.js** | **bigint integer-cents** | Pure `bigint` works for pure integer money but forces manual fixed-point scaling + hand-rolled rounding at every `%`, `÷` and CAC multiply — error-prone in exactly the package that must be 100% correct. Use bigint only for the final **stored** integer USD values, not the intermediate math. |
| **decimal.js** | **dinero.js v2** (`2.0.2`) / `@dinero.js/core` (`2.0.0-alpha.1`) | dinero is money-*object* oriented (formatting, `allocate`). Its v2 core is still alpha and effectively unmaintained with known ESM friction. The engine is arithmetic, not money-object plumbing; implement equal-cuota split + remainder distribution yourself with decimal.js (largest-remainder). Avoid a stalled dep in the crown-jewel package. |
| **@react-pdf/renderer** | **pdfkit** (`0.19.1`) | Drop to raw PDFKit only if react-pdf's layout engine or memory footprint becomes a problem. PDFKit is battle-tested and tiny but you hand-code table geometry and page breaks — more code, more bugs. Keep as the fallback. |
| **@react-pdf/renderer** | **Playwright/Chromium print-to-PDF** | Only if the PDF must pixel-match an HTML page. Rejected here: shipping Chromium + its libs into the slim `node:22-alpine` worker bloats the image and adds Alpine glibc/font pain for a simple one-page quote. Overkill. |
| Native `URLSearchParams` for wa.me | any `wa.me`/whatsapp npm helper | Never. A one-line `URL` build has no reason to be a dependency. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `Number` / JS floats anywhere in the money path | Banned by CLAUDE.md; `0.1+0.2` class drift silently corrupts cents — fatal in the diferencial-#1 package | `decimal.js` for math; integer USD + Postgres `numeric` (Drizzle → `string`) for storage |
| Reading Postgres `numeric` as a JS number | Drizzle returns `numeric`/`decimal` as **string** on purpose; coercing to `Number` reintroduces float error | Keep ARS cuota amounts as `string`, wrap in `Decimal` for any further math |
| A **global** 100% coverage threshold in root `vitest.config.ts` | Would force every package (db, api, worker, ui) to 100% and turn CI red | Package-scoped threshold in `packages/quoting/vitest.config.ts` only |
| Chromium/Playwright in the worker image for PDF | Bloats the Alpine runner, glibc/font headaches, slow cold start | `@react-pdf/renderer` (headless, pure Node) |
| Bundling/inlining fonts or `@react-pdf/renderer` via tsup `noExternal` | tsup can't inline `.ttf`; react-pdf expects to be a normal runtime module | Keep external; COPY any custom TTF into the image and `Font.register` it by path |
| I/O, `Date.now()`, `Math.random`, or reading `cac_index` from DB **inside** `packages/quoting` | Kills purity/determinism → property tests and snapshot auditability break | Pass the CAC index value + a fixed "as-of" date **in** as function args; the caller (tRPC/worker) does the I/O |
| dinero.js v2 core (alpha) | Unmaintained alpha, ESM friction, in the one package that can't afford surprises | decimal.js + hand-written allocation |

## Stack Patterns by Variant

**Money representation across the boundary:**
- **Inside the engine:** everything is `Decimal`. Configure a module-local `Decimal` clone with an explicit rounding mode (e.g. `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })`) so the rule is one visible decision.
- **Engine output / snapshot / DB:** USD prices → integer (whole dollars per CLAUDE.md); ARS cuota amounts → decimal serialized as **string** (never float). JSON snapshot stores strings.
- **Equal-cuota split:** compute the per-cuota decimal, round each to the ARS unit, then distribute the rounding remainder across the first/last cuotas (largest-remainder) so `Σ cuotas === saldo` exactly — assert this as a fast-check property.

**100% coverage gate (package-scoped):**
```ts
// packages/quoting/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { 100: true }, // lines+functions+branches+statements = 100
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"], // adjust to taste
    },
  },
});
```

**Property tests with fast-check + Vitest:**
```ts
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
test.prop([fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 0, max: 100 })])(
  "anticipo never exceeds base price",
  (usdBase, anticipoPct) => { /* assert engine invariant */ },
);
```

**wa.me deep link (no dependency):**
- Format: `https://wa.me/<phone>?text=<encoded>` where `<phone>` is the broker number in **international form, digits only, no `+`/spaces** (e.g. `5491122223333`).
- Encode the message with `encodeURIComponent`; newlines become `%0A`. `URLSearchParams` also works and handles this.
- **Length:** keep the prefilled `text` short — WhatsApp truncates very long prefilled messages and long URLs get mangled by some clients. Put a concise summary (unidad, precio contado, anticipo, cuota) + a link to the full PDF, not the entire quote. Target well under ~2000 chars.

**PDF in the worker (Alpine, headless):**
- Import from the Node entry: `import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font, Image } from "@react-pdf/renderer";`
- Generate a `Buffer` in the BullMQ job, upload to R2 (existing `@imbau/storage`), store the R2 key in `quotes.pdf`.
- Spanish accents render on built-in Helvetica; only `Font.register` a custom TTF if branding demands it (then COPY the TTF into the image).

**Snapshot persistence (no new dep):**
- Export a `const ENGINE_VERSION` (e.g. semver string) from `packages/quoting`; include it in every snapshot.
- Snapshot = `{ engineVersion, inputs, outputs }` serialized into the existing `quotes.snapshot` JSONB; derive a Zod validator with `drizzle-zod` and validate before insert. No schema migration needed (column exists per §3.3).

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `decimal.js@10.6.0` | Node 22, any TS, ESM/CJS | Zero deps, ships its own types. |
| `fast-check@4.8.0` | Node `>=12.17`, Vitest 4 | Runner-agnostic. v4 is current major. |
| `@fast-check/vitest@0.4.1` | `fast-check@4`, `vitest@4` | Thin binding; keep fast-check major aligned. |
| `@react-pdf/renderer@4.5.1` | `react@^16.8‖17‖18‖19` → repo's **React 19.2** ✓ | No `react-dom`; renders in Node without a browser. |
| `@vitest/coverage-v8@4.1.8` | `vitest@4.1.8` (repo) | Keep coverage-v8 major/minor aligned with `vitest`; 4.1.9 exists — bump both together if bumping. |

## Sources

- npm registry (`npm view <pkg> version` / `peerDependencies` / `engines`), 2026-07-01 — exact current versions: fast-check `4.8.0`, `@fast-check/vitest` `0.4.1`, decimal.js `10.6.0`, big.js `7.0.1`, dinero.js `2.0.2`, `@dinero.js/core` `2.0.0-alpha.1`, `@react-pdf/renderer` `4.5.1` (peer react `^19`, no engines pin), pdfkit `0.19.1`, `@vitest/coverage-v8` `4.1.9` (repo pinned 4.1.8). **HIGH**
- Repo inspection — `packages/quoting/package.json` (vitest 4.1.8, no runtime deps), `apps/worker/package.json` (node:22-alpine, tsup, no React), `apps/worker/Dockerfile` (slim Alpine runner, copies node_modules), root `vitest.config.ts` (v8 provider, no threshold yet), `docs/modelo-mvp.md` §3.4/§3.3 (pure engine, 100% coverage, PBT, snapshot JSONB, wa.me). **HIGH**
- CLAUDE.md / PROJECT.md — money rules (USD integer, ARS decimal, never floats), quality gates, Node 22, existing stack matrix. **HIGH**

---
*Stack research for: v1.2 Cotizador (Fase 3) — new-feature additions only*
*Researched: 2026-07-01*
