# Phase 10: D1 — Grilla de unidades editable + import/export Excel - Research

**Researched:** 2026-07-21
**Domain:** Editable data grid + transactional Excel round-trip (es-AR money parsing) + cross-app ISR revalidation, on a multi-tenant RLS panel
**Confidence:** HIGH (stack, patterns, parse strategy, transactional apply all grounded in this codebase) · MEDIUM on GRID-07 mechanism (a real architecture decision surfaces below — see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Price edit = **single-row UPSERT per unit×list** (`UNIQUE(unit_id, price_list_id)`, versioned Drizzle migration). Edit overwrites `precio` and sets `vigencia = now()` ("vigente desde"). **No** multi-row price history in `unit_prices` (would break the UNIQUE and force a rewrite of the v1.2 cotizador resolver). The cotizador already snapshots price at emit time.
- **D-02:** Change trail (audit: who / when / old→new price, estado transition) is emitted to the **`events`** table. Resolves the STATE.md open decision: emit events on price/estado transitions **now** (cheap, forward-compatible), do not defer.
- **D-03:** **Flat grid, one row per unit** (38 rows × 2 price lists). Columns: `identificador`, piso, tipología/m2 (read-only reference), **Financiado** (USD), **Contado** (USD), **Estado**.
- **D-04:** **Inline per-cell edit**: click price cell → inline editable, Enter/blur saves (per-cell mutation via the `requireRole`+`withTenant` mold). Estado = **inline dropdown** (disponible/reservado/vendido). **Per-row checkbox** builds the bulk selection.
- **D-05:** **No design system this phase** — functional UI es-AR voseo, same Phase 9 pattern. `/gsd-ui-phase 10` already ran (10-UI-SPEC.md exists) — the executor SHOULD honor that contract.
- **D-06:** Import in two phases: upload Excel → **validate (dry-run)** → **preview** → confirm. Preview lists **classified** rows: nuevas / con cambios (**old→new per field**) / sin cambios. Summary on top (N nuevas, N cambios, N errores).
- **D-07:** Invalid rows listed separately with **row number + es-AR reason** (e.g. "Fila 12: precio no entero"). **Aplicar stays disabled until the file is 100% valid.**
- **D-08:** Apply is **all-or-nothing in a single `withTenant` transaction**: one invalid row aborts everything, no partial writes. Idempotent by natural key (`UNIQUE(unit_id, price_list_id)`). Money never contaminated by floats: es-AR parse with `Number.isInteger` post-parse.
- **D-09:** **One sheet, one row per unit**, key = **`identificador`** (e.g. "4B"). Read-only reference columns (orient, not imported): piso, tipología, m2. Editable columns: Financiado (USD), Contado (USD), Estado.
- **D-10:** Export includes **ALL units of the project** (central use case = "download everything, edit, upload"; no selection export).
- **D-11:** **Cells sanitized** against formula/CSV injection: prefix with `'` any cell starting with `=`, `+`, `-`, `@` (applies in the export build).
- **D-12:** Bulk edit over the **selection** (D-04 checkboxes): apply **% or fixed amount** to **ONE chosen list** (Financiado or Contado). Round to **integer USD** (`Math.round`). No estado (estado change is individual via dropdown).
- **D-13:** Bulk edit shows a **preview before confirm** (how many units + old→new), reusing the import confirmation pattern. Never blind apply (irreversible money op over many units).
- **D-14:** Every price/estado change (inline, bulk, applied import) triggers **on-demand ISR revalidation** of the public picker/cotizador instantly. Exact mechanism (`revalidateTag`/`revalidatePath` + per-project/slug tags) = **research + planning**. Product requirement: **instant**, no TTL wait.

### Claude's Discretion
- Concrete mutation names/API (`units.updatePrice`, `units.updateEstado`, `units.bulkUpdatePrice`, `units.importExcel`, etc.) and granularity — planner chooses, following the Phase 9 mold.
- Internal structure of the pure `packages/api/src/excel/` module (parse vs build, dry-run result types) — planner/executor discretion; requirement: I/O-free and testable.
- Grid/import-wizard layout/styling details — functional UI, executor decides; `/gsd-ui-phase 10` optional.
- Exact ISR revalidation mechanism (D-14) — research + planning (resolved below).

### Deferred Ideas (OUT OF SCOPE)
- Downloadable annotated error report (Excel/CSV) — errors shown inline per row (D-07), no download.
- Multi-row price history in `unit_prices` — discarded for UPSERT + `events` audit (D-01/D-02).
- Bulk estado edit — out (D-12); estado is individual via dropdown.
- Selection export — export is all units (D-10).
- `/gsd-ui-phase 10` design-system contract already produced; functional UI is the baseline.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRID-01 | Inline price edit per list (unit × price_list matrix), persisted with vigencia | `units.updatePrice` mutation cloning `projects.updateSettings`; UPSERT on the new `UNIQUE(unit_id, price_list_id)` setting `vigencia=now()` (Pattern 3, Pattern 5) |
| GRID-02 | Change unit estado (disponible/reservado/vendido) from the grid | `units.updateEstado` mutation, same mold; `unidadEstadoEnum` validated at the Zod boundary (Pattern 5) |
| GRID-03 | Export grid to Excel, canonical template, sanitized vs formula injection | Pure `buildWorkbook()` in `packages/api/src/excel/`; exceljs write to Buffer; `'`-prefix sanitizer on `= + - @` (Pattern 1, Pattern 2, Security Domain) |
| GRID-04 | Import Excel, full validation + dry-run diff preview field-by-field before apply | Pure `parseWorkbook()` → classified `DryRunResult`; UI wizard per 10-UI-SPEC Import Flow (Pattern 2, Pattern 6) |
| GRID-05 | Transactional + idempotent import (all-or-nothing, upsert by natural key; `UNIQUE(unit_id, price_list_id)` migration) | Versioned Drizzle migration + single `withTenant` tx with `ON CONFLICT DO UPDATE` (Pattern 5, Pitfall 3) |
| GRID-06 | Bulk price edit (% or fixed amount) over a selection | `units.bulkUpdatePrice` mutation; pure `computeBulkPreview()` (`Math.round`); mandatory preview (Pattern 5, D-12/D-13) |
| GRID-07 | Price/estado changes reflected in public web instantly (on-demand ISR revalidation) | **UNRESOLVED architecture decision — see Open Questions #1.** apps/web is `force-dynamic` today (no cache to revalidate). Two viable paths documented (Pattern 4) |
</phase_requirements>

## Summary

Phase 10 is the panel's highest-value, highest-risk (money) surface. Almost everything it needs already exists as a proven mold in this repo: the write path (`requireRole("owner","developer")` over `withTenant`, `.returning()` 0-row → `NOT_FOUND`) is copied verbatim from `projects.updateSettings`; the "pure I/O-free module tested exhaustively before wiring" pattern is `packages/quoting`; the cross-role test matrix is `projects-role-gate.test.ts`; the es-AR money **formatter** already lives in `packages/quoting/src/format.ts` (`formatUsd` → `US$ 1.234`). The one net-new runtime dependency is `exceljs@4.4.0` (MIT, 11M weekly downloads, no postinstall, verdict OK) — **`xlsx`/SheetJS remains forbidden** (CVE-2023-30533).

The two genuinely new problems are (1) the **inverse of the formatter**: a defensive es-AR → integer-USD **parser** that never trusts an exceljs cell typed as number and gates every value on `Number.isInteger`; and (2) **GRID-07's cross-app revalidation** — where research surfaced a load-bearing fact the requirement's wording does not anticipate: **`apps/web` renders `force-dynamic` today** (every request reads live from Postgres via the anon pool; there is no Full Route Cache / Data Cache to invalidate). So "instant reflection" is already true by construction, and the phrase "ISR on-demand revalidation" is not literally applicable to the current architecture. This is a real decision for the planner/user (Open Questions #1).

**Primary recommendation:** Build a pure `packages/api/src/excel/` module (build + parse + dry-run diff + bulk-preview, exhaustively unit- and property-tested against the es-AR money invariants) FIRST, then wire four thin mutations that clone the Phase 9 mold, all inside `withTenant`, with the import apply as a single all-or-nothing transaction using `ON CONFLICT (unit_id, price_list_id) DO UPDATE`. For GRID-07, **keep apps/web `force-dynamic` and satisfy the requirement's intent with a cross-surface integration test** (clone the existing estado→`listPublished` test) rather than adding revalidation plumbing for a cache that does not exist — but flag this to the user, because it deviates from the literal "ISR on-demand" wording.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Excel build (export) — bytes in/out | Pure module (`packages/api/src/excel`) | API mutation (streams Buffer to client) | I/O-free logic; sanitization and template shape are pure functions, unit-testable without a DB |
| Excel parse + dry-run diff | Pure module | API mutation (feeds it current DB rows) | Money-parse correctness is the #1 risk; must be tested in isolation, no I/O |
| Money parse (es-AR → int USD) | Pure module | — | Inverse of `packages/quoting/format.ts`; property-tested; single owner of the `Number.isInteger` gate |
| Price/estado/bulk/import writes | API / Backend (tRPC + `withTenant`) | DB (RLS + UNIQUE constraint) | All writes route through the one sanctioned tenant seam; RLS + composite FKs enforce isolation |
| Transactional all-or-nothing apply | DB (single Postgres tx) | API (orchestrates within `withTenant`) | Atomicity is a DB guarantee; `withTenant` already wraps `fn` in one transaction |
| Audit trail | DB (`events` insert in same tx) | API | Emitted inside the same transaction as the mutation (D-02) |
| Grid UI (inline edit, selection, wizard) | Frontend Server (RSC shell) + Client island | — | RSC resolves project via RLS (already wired in placeholder); interactive cells/wizard are client components calling tRPC |
| Public reflection (GRID-07) | Frontend Server (`apps/web` read path) | API (revalidation trigger, IF caching is adopted) | See Open Questions #1 — currently `force-dynamic`, so the read tier already reflects writes with no trigger needed |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `exceljs` | `4.4.0` | Excel `.xlsx` build (export) + parse (import) | STATE.md-mandated; MIT; the only maintained pure-JS xlsx lib that is NOT SheetJS. Reads/writes `Buffer` → fits a pure I/O-free module. `[VERIFIED: npm registry — legitimacy gate OK, 11.1M weekly dl, no postinstall]` |
| `drizzle-orm` | `0.45.2` (installed) | Migration (`UNIQUE`), upsert `.onConflictDoUpdate`, `events` insert | Already the ORM; supports composite-target `onConflictDoUpdate` `[VERIFIED: package.json + codebase]` |
| `@trpc/server` | `11.x` (installed) | Four new mutations on a `units` router | Existing typed API seam; no codegen `[VERIFIED: package.json]` |
| `zod` | `4.4.3` (installed) | Boundary validation (uuid, estado enum, bulk params) | Existing boundary validator; `unidadEstadoEnum` mirrorable via `z.enum` `[VERIFIED: package.json]` |
| `vitest` | `4.1.8` (installed) | Unit + integration tests | Existing runner; `packages/api/vitest.config.ts` already wires a real `_test` Postgres via globalSetup `[VERIFIED: codebase]` |
| `fast-check` | `4.8.0` (installed in quoting) | Property tests for the money parser | Already used by `packages/quoting/src/engine.property.test.ts`; add to `packages/api` devDeps for the excel module `[VERIFIED: codebase]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | latest (MIT) | ~6 grid glyphs (upload/download/chevron/check/x/alert) | Optional per 10-UI-SPEC; inline SVG also acceptable — executor discretion. **Run legitimacy gate before install if adopted.** `[ASSUMED — not verified this session]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `exceljs` | `xlsx` (SheetJS) | **FORBIDDEN** — CVE-2023-30533 (prototype pollution) has no patch on the npm-published path (STATE.md). Do not introduce. |
| `exceljs` in-memory Buffer | exceljs streaming (`WorkbookWriter`/`WorkbookReader`) | Streaming only matters at 10k+ rows; ~38 rows × few columns is trivially in-memory. Use `workbook.xlsx.writeBuffer()` / `.load(buffer)`. |
| `.onConflictDoUpdate` per row | Raw `INSERT ... ON CONFLICT` SQL | Drizzle's typed upsert is cleaner and stays in the schema types; use it. |
| A brand-new `unit_prices` history model | Single-row UPSERT (D-01) | Locked — history reconstructs from `events`, not schema. |

**Installation:**
```bash
pnpm --filter @imbau/api add exceljs
pnpm --filter @imbau/api add -D fast-check @types/node  # fast-check for the money property tests
```
> exceljs ships its own TypeScript types (`index.d.ts`) — no `@types/exceljs` needed.

**Version verification (this session):**
- `exceljs`: latest = `4.4.0`, published `2023-10-19`, modified `2024-12-20`, license MIT, repo github.com/exceljs/exceljs, `scripts.postinstall` = none. `[VERIFIED: npm view]`

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `exceljs` | npm | ~2 yrs (4.4.0) | 11.1M/wk | github.com/exceljs/exceljs | **OK** | Approved (STATE.md-mandated, MIT, no postinstall) |
| `xlsx` (SheetJS) | npm | — | — | — | **FORBIDDEN** | REMOVED — CVE-2023-30533, never install (STATE.md) |
| `lucide-react` | npm | — | — | — | not run | Optional/UI-only — planner runs gate IF adopted |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Forbidden (policy):** `xlsx`/SheetJS — do not add under any circumstance.

## Architecture Patterns

### System Architecture Diagram

```
                          PANEL (apps/panel) — authenticated, org-scoped
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  proyectos/[id]/unidades/page.tsx  (RSC: params→z.uuid→resolveProject via RLS) │
  │        │                                                                       │
  │        ▼  renders                                                              │
  │  <UnitsGrid> (client island)                                                   │
  │   ├─ price cell edit ──┐                                                        │
  │   ├─ estado dropdown ──┤                                                        │
  │   ├─ selection + bulk ─┤   tRPC mutations (typed, no codegen)                   │
  │   └─ import wizard ────┘                                                        │
  └───────────────────────────┬────────────────────────────────────────────────────┘
                              │
             ┌────────────────▼──────────────────────────────────────────┐
             │  units router (packages/api/src/trpc/routers/units.ts)     │
             │  requireRole("owner","developer")  ── FORBIDDEN if viewer  │
             │        │                                                   │
             │        ▼  withTenant(ctx.activeOrgId, tx => { ... })       │  ← ONE transaction
             │  ┌───────────────────────────────────────────────────┐    │    (set_config GUC first)
             │  │ updatePrice  : UPSERT unit_prices ON CONFLICT       │    │
             │  │ updateEstado : UPDATE units.estado                  │    │
             │  │ bulkUpdatePrice: N× UPSERT (one tx)                 │    │
             │  │ importExcel  : validate→ (if 100% valid) N× UPSERT  │    │  all-or-nothing
             │  │  + INSERT events (audit, same tx)  ── D-02          │    │
             │  │  .returning() 0-row → NOT_FOUND                      │    │
             │  └───────────────────────────────────────────────────┘    │
             └───────────┬─────────────────────────────────┬─────────────┘
                        │ calls (pure, no I/O)             │ RLS + composite FKs + UNIQUE
                        ▼                                  ▼
   packages/api/src/excel/  (PURE, I/O-free)      PostgreSQL 16 (app_authenticated role)
   ┌─────────────────────────────────────┐       ┌──────────────────────────────────────┐
   │ buildWorkbook(rows) → Buffer        │       │ unit_prices (precio INT, UNIQUE new) │
   │  └ sanitize(= + - @) prefix '       │       │ units (estado enum)                  │
   │ parseWorkbook(Buffer) → RawRow[]    │       │ events (audit, partitioned)          │
   │  └ parseMoneyEsAr → int | error     │       │ RLS: *_tenant + *_anon_published     │
   │ buildDryRun(raw, current) → Report  │       └──────────────────────────────────────┘
   │  └ classify: nueva|cambio|igual|err │                     ▲
   │ computeBulkPreview(sel, mode, val)  │                     │ anon pool (withAnon)
   └─────────────────────────────────────┘                     │ SELECT ... WHERE publicado
                                                               │
                        WEB (apps/web) — anonymous, public ────┘
   ┌──────────────────────────────────────────────────────────────────────┐
   │  p/[slug]/cotizador/page.tsx   ── export const dynamic="force-dynamic" │  ← NO CACHE today.
   │  reads picker.* via createCaller → withAnon → live Postgres each req.  │    Reflects writes
   │  GRID-07: already instant by construction (see Open Questions #1)      │    with no trigger.
   └──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/api/src/
├── excel/                      # NEW — pure, I/O-free (clone the packages/quoting discipline)
│   ├── template.ts             # canonical column order/headers (single source of truth)
│   ├── build.ts                # buildWorkbook(rows): Promise<Buffer> + sanitizeCell()
│   ├── parse.ts                # parseWorkbook(buf): Promise<RawRow[]> (cell-type-safe reads)
│   ├── money.ts                # parseMoneyEsAr(cell): {ok:true,value:int}|{ok:false,reason}
│   ├── dry-run.ts              # buildDryRun(raw, currentRows): DryRunResult (classify + diff)
│   ├── bulk.ts                 # computeBulkPreview(selection, mode, value): BulkPreview
│   ├── types.ts                # RawRow, DryRunResult, RowClass, ValidationError, BulkPreview
│   ├── money.test.ts           # unit + fast-check property tests (the #1 risk)
│   ├── parse.test.ts           # cell-type coercion, formula/date/richText rejection
│   ├── build.test.ts           # sanitization, round-trip (build→parse identity)
│   └── dry-run.test.ts         # classification + diff correctness
└── trpc/routers/
    └── units.ts                # NEW — 4 mutations, all clone projects.updateSettings mold
packages/db/
├── src/schema/unit-prices.ts   # EDIT — add unique().on(unitId, priceListId)
└── drizzle/00XX_*.sql          # NEW versioned migration (UNIQUE constraint)
apps/panel/app/proyectos/[id]/unidades/
├── page.tsx                    # REPLACE body of the Phase 9 placeholder
├── units-grid.tsx              # client island
└── import-wizard.tsx           # client modal (4 steps per 10-UI-SPEC)
```

### Pattern 1: Pure Excel build with formula-injection sanitization (GRID-03, D-11)
**What:** Build a single-sheet workbook to a `Buffer`; sanitize every user-derived string cell.
**When to use:** Export mutation returns the Buffer; the client downloads it.
```typescript
// Source: exceljs README (github.com/exceljs/exceljs) — Workbook/writeBuffer; OWASP CSV-injection guidance
import ExcelJS from "exceljs";

// D-11: neutralize formula/CSV injection. A cell whose text starts with = + - @ (also \t, \r per OWASP)
// is prefixed with a single quote so spreadsheet apps treat it as literal text, not a formula.
export function sanitizeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildWorkbook(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Unidades");
  ws.addRow(TEMPLATE_HEADERS); // identificador, piso, tipología, m2, Financiado, Contado, Estado
  for (const r of rows) {
    ws.addRow([
      sanitizeCell(r.identificador),
      sanitizeCell(r.piso),
      sanitizeCell(r.tipologia ?? ""),
      r.m2,                    // numeric reference (read-only)
      r.financiado ?? null,    // integer USD as a NUMBER cell (empty → null → renders blank)
      r.contado ?? null,
      sanitizeCell(r.estado),
    ]);
  }
  // writeBuffer returns a Node Buffer/ArrayBuffer — no fs, keeps the module I/O-free.
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}
```
> Note: `identificador` values like `4B`/`10A` never start with `= + - @`, but `estado` and any free-text ref column MUST still pass through `sanitizeCell` — apply it uniformly to all string cells (defense in depth), not selectively.

### Pattern 2: Defensive cell read + es-AR money parse (GRID-04, the #1 risk)
**What:** Never trust `cell.value` typed as `number`. Read via cell type, coerce to a **non-negative integer USD** or produce an es-AR error.
**When to use:** `parseWorkbook` for every editable price cell.
```typescript
// Source: exceljs index.d.ts (ValueType enum: Number|String|Date|Formula|SharedString|RichText|Boolean|Error|Hyperlink)
import ExcelJS from "exceljs";

type ParseResult = { ok: true; value: number } | { ok: false; reason: string };

// Domain fact (CLAUDE.md): USD prices are WHOLE integers — "centavos no aplican al rubro".
// So ANY fractional result is INVALID, which conveniently dissolves the es-AR `.`-thousands vs
// `,`-decimal ambiguity: a valid price is a non-negative integer, full stop.
export function parseMoneyEsAr(cell: ExcelJS.Cell): ParseResult {
  const t = cell.type; // ExcelJS.ValueType
  // Reject formula/richText/hyperlink/boolean/error-typed cells outright (D-08 defensiveness).
  if (t === ExcelJS.ValueType.Formula)   return { ok: false, reason: "el precio es una fórmula; pegá solo el número" };
  if (t === ExcelJS.ValueType.Error)     return { ok: false, reason: "la celda de precio tiene un error de Excel" };
  if (t === ExcelJS.ValueType.Date)      return { ok: false, reason: "el precio no puede ser una fecha" };
  if (t === ExcelJS.ValueType.Null)      return { ok: false, reason: "falta el precio" };

  if (t === ExcelJS.ValueType.Number) {
    const n = cell.value as number;
    if (!Number.isInteger(n))            return { ok: false, reason: "el precio no es un número entero" };
    if (n < 0)                           return { ok: false, reason: "el precio no puede ser negativo" };
    return { ok: true, value: n };
  }
  // String / RichText → normalize es-AR: strip `.` thousands + spaces; a remaining `,` (decimals)
  // or any non-digit means it's not a whole USD price → reject.
  const raw = (t === ExcelJS.ValueType.RichText ? cell.text : String(cell.value)).trim();
  if (raw === "")                        return { ok: false, reason: "falta el precio" };
  const stripped = raw.replace(/\./g, "").replace(/\s/g, ""); // es-AR thousands `.` removed
  if (!/^\d+$/.test(stripped))           return { ok: false, reason: "el precio no es un número entero" };
  const n = Number(stripped);
  if (!Number.isInteger(n) || n < 0)     return { ok: false, reason: "el precio no es un número entero" };
  return { ok: true, value: n };
}
```
> Reference formatter (the inverse this must round-trip against): `packages/quoting/src/format.ts` `formatUsd(185000)` → `"US$ 185.000"`. The parser must accept `185.000`, `185000`, and the raw number `185000`, and reject `185.5`, `185,50`, `185.000,00`, `-1`, `""`, formulas, dates.
>
> **Vigencia/dates:** `vigencia` is server-set `now()` on write (D-01) — it is **NOT imported**. Do not add a date column to the editable set; DD/MM/YYYY parsing is therefore **out of scope**. (Confirms research flag question — the only date concern is *rejecting* a date-typed cell in a price column, handled above.)

### Pattern 3: Versioned UNIQUE migration (GRID-05)
**What:** Add `UNIQUE(unit_id, price_list_id)` to `unit_prices` so the upsert has a conflict target and the cotizador's one-row-per-unit×list invariant is enforced at the DB.
```typescript
// Source: this repo — packages/db/src/schema/unit-prices.ts (edit), Drizzle Kit generates the SQL
import { unique } from "drizzle-orm/pg-core";
// inside the pgTable extras array:
unique("unit_prices_unit_list_uq").on(t.unitId, t.priceListId),
```
```bash
pnpm --filter @imbau/db drizzle-kit generate   # emits drizzle/00XX_*.sql — reviewed in PR (CLAUDE.md: no manual DDL)
```
> **Pre-flight:** confirm the seed produces exactly one `unit_prices` row per (unit, list) so the constraint applies cleanly against existing data (seed comment `pricing.ts` L66: "one row per unit per price_list" — clean).

### Pattern 4: GRID-07 public reflection — the two paths (see Open Questions #1)
**What:** How a panel write becomes visible on the public cotizador.
**Current reality:** `apps/web/app/p/[slug]/cotizador/page.tsx` and `app/page.tsx` both declare `export const dynamic = "force-dynamic"` and read Postgres via `createCaller` (NOT via `fetch`). There is **no Full Route Cache and no Data Cache** in play — every public request already reads live rows.

**Path A — RECOMMENDED for this phase (keep force-dynamic, no plumbing):**
The public read is already live; a committed panel write is visible on the very next public request. Satisfy GRID-07 with a **cross-surface integration test** (clone the existing `estado toggle → listPublished` test in `projects-role-gate.test.ts`): assert a price/estado mutation is observable through the anon picker caller.
- Pros: honest to the actual architecture, zero cross-app coupling, no shared secret to manage, nothing to break.
- Cons: does not literally implement "ISR on-demand revalidation" (there is no ISR cache); every public hit reads DB (fine at MVP scale, but does not deliver the CLAUDE.md "ISR en la web pública" / <3s-4G caching intent long-term).

**Path B — if the team wants CDN/ISR caching NOW (real cross-app revalidation):**
Because panel and web are **separate Next deployments/processes**, `revalidateTag`/`revalidatePath` called inside the panel process **cannot** touch the web process's cache (revalidation is in-process only). Wiring:
1. Convert the web read path to cacheable: wrap the anon reads in `"use cache"` + `cacheTag(\`project:\${slug}\`)` (Next 16 Cache Components) or `unstable_cache(..., { tags: [\`project:\${slug}\`] })`. Remove `force-dynamic` on those routes.
2. Add `apps/web/app/api/revalidate/route.ts` (POST, guarded by a shared `REVALIDATE_SECRET` env) that calls `revalidateTag(\`project:\${slug}\`)` in the web process.
3. Each panel mutation, after commit, does a server-side `fetch(\`\${WEB_ORIGIN}/api/revalidate\`, { method:"POST", headers:{ authorization: secret }, body: slug })`.
- Pros: real ISR + instant invalidation; matches the literal requirement.
- Cons: new env/secret in both apps, new endpoint (rate-limit + auth-gate it — anon-writable revalidation is a DoS vector), couples panel→web by HTTP, and only pays off once the read path is actually cached.

**Recommendation:** ship **Path A** now (it already meets "instant"), and record Path B as the forward-compatible plan for when the public site adopts ISR/CDN caching. **This needs a one-line user/planner confirmation** because it reinterprets the requirement's "ISR on-demand" wording against the shipped force-dynamic reality.

### Pattern 5: All-or-nothing transactional apply + audit, one `withTenant` tx (GRID-05, D-08, D-02)
```typescript
// Source: this repo — packages/db/src/with-tenant.ts (single tx), projects.updateSettings (mold)
// dryRun already proved 0 errors client-side; the server RE-VALIDATES (never trust the client) then applies.
importExcel: requireRole("owner", "developer")
  .input(z.object({ projectId: z.uuid(), file: z.string() /* base64 */ }))
  .mutation(async ({ ctx, input }) => {
    const raw = await parseWorkbook(Buffer.from(input.file, "base64"));
    return withTenant(ctx.activeOrgId, async (tx) => {
      const current = await tx.select().from(schema.units) /* + unit_prices */ ;
      const report = buildDryRun(raw, current);
      if (report.errors.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", cause: report.errors }); // aborts tx → no writes (D-08)
      }
      for (const chg of report.priceChanges) {
        const rows = await tx.insert(schema.unitPrices)
          .values({ /* org/project/unit/list */ precio: chg.value, vigencia: sql`now()` })
          .onConflictDoUpdate({
            target: [schema.unitPrices.unitId, schema.unitPrices.priceListId],
            set: { precio: chg.value, vigencia: sql`now()` },
          })
          .returning({ id: schema.unitPrices.id });
        if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      }
      // estado changes: tx.update(units)... ; audit: tx.insert(events) old→new (D-02) — SAME tx.
      return { applied: report.priceChanges.length + report.estadoChanges.length };
    });
  }),
```
> **Idempotency (GRID-05):** re-importing an unchanged file classifies every row `sin cambios` → zero writes (a no-op). `ON CONFLICT DO UPDATE` makes re-applying the *same* values harmless even if it runs. **Bulk edit (D-13)** uses the identical pattern minus the file parse: `computeBulkPreview` (pure, `Math.round`) → confirm → one `withTenant` tx of N upserts + events.

### Pattern 6: Import wizard states (GRID-04 UX) — reference 10-UI-SPEC, do not re-derive
**What:** 4-step modal: Upload → Validation report (dry-run) → Diff preview (only when errors=0) → Confirm.
**Copy & states are fully specified** in `10-UI-SPEC.md` §Import Flow + §Copywriting Contract + §UI Considerations. The planner MUST lift copy verbatim (e.g. `Fila 12: el precio no es un número entero`, summary bar `{N} nuevas · {N} con cambios · {N} sin cambios · {N} con errores`, apply-blocked hint) — do not invent new strings. `Aplicar cambios` stays disabled while `errores > 0` (D-07). Backstop/unresolved rows to lift: grid load-error state, long-text truncation in diff rows, and the toast error-shape (10-UI-SPEC §Unresolved).

### Anti-Patterns to Avoid
- **Trusting `cell.value as number`.** exceljs returns typed values, but a "number-looking" cell can be a `Formula` object `{formula, result}` or a `RichText` object. Always branch on `cell.type` and gate on `Number.isInteger` (Pattern 2, Pitfall 1).
- **Client-side-only validation.** The dry-run runs client-side for UX, but the apply mutation MUST re-parse and re-validate server-side inside the tx (never trust the uploaded file or a client "isValid" flag).
- **Per-row transactions in the import loop.** Defeats all-or-nothing. One `withTenant` (= one tx) wraps the whole apply (Pattern 5).
- **`revalidateTag` from the panel process expecting to hit web.** In-process only; separate deployments need the HTTP endpoint (Pattern 4, Path B).
- **Multi-row price history in `unit_prices`.** Breaks the new UNIQUE and the cotizador resolver (D-01). Audit lives in `events`.
- **`xlsx`/SheetJS.** Forbidden (CVE-2023-30533).
- **`SET LOCAL` string-interpolating orgId, or `createOwnerDb`/`appDb` in the router.** Use `withTenant` exclusively (it parameter-binds the GUC via `set_config(...,true)`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `.xlsx` read/write | A ZIP+XML (OOXML) serializer | `exceljs` | OOXML is a large spec; exceljs handles shared strings, styles, types |
| es-AR number formatting (export display) | A new grouping function | `packages/quoting/src/format.ts` `formatUsd` | Already the deterministic UI==PDF==WhatsApp label owner; reuse |
| Tenant-scoped transaction | A raw pg transaction with manual GUC | `withTenant(orgId, fn)` | Parameter-binds the GUC, auto-clears at commit/rollback; the only sanctioned seam |
| Idempotent upsert | SELECT-then-INSERT-or-UPDATE race | Drizzle `.onConflictDoUpdate` on the new UNIQUE | Atomic; no TOCTOU |
| Role gate | Ad-hoc `if role !==` in the handler | `requireRole("owner","developer")` | Runs inside RLS, pre-mutation FORBIDDEN, already tested |
| Cross-role test harness | New fixtures | Clone `projects-role-gate.test.ts` + `tests/fixtures` | Real invite→accept→setActive members, real Postgres |

**Key insight:** This phase is ~80% *cloning proven molds* and ~20% *new pure logic (the es-AR parser + dry-run diff)*. The risk concentrates entirely in that 20%, which is why it must live in an I/O-free module with property tests before any mutation is wired.

## Common Pitfalls

### Pitfall 1: exceljs cell typed as number is not always a plain number
**What goes wrong:** `cell.value` can be `number`, `string`, `Date`, `{formula, result}`, `{richText:[...]}`, `{sharedFormula, result}`, `{error}`, or `null`. Coercing blindly (`Number(cell.value)`) yields `NaN` or `[object Object]`, or silently accepts a formula's cached `result`.
**Why it happens:** OOXML stores heterogeneous cell types; exceljs faithfully surfaces them.
**How to avoid:** Branch on `cell.type` (`ExcelJS.ValueType`) and reject Formula/Date/Error/RichText for price columns; only accept Number (gated `Number.isInteger`) or a String that normalizes to a whole integer (Pattern 2).
**Warning signs:** A test importing a file where a user typed `=185000` or pasted a formatted `185.000,00` passes when it should fail.

### Pitfall 2: es-AR `.`-thousands vs `,`-decimal ambiguity
**What goes wrong:** `185.000` means 185000 (es-AR) but 185.0 (en-US); Excel's own coercion depends on the file/locale, so a number-typed cell may already be wrong.
**Why it happens:** Locale-dependent separators; the file may be edited on a machine with a different locale.
**How to avoid:** Exploit the domain rule — **USD prices are whole integers, no cents** (CLAUDE.md). Any fractional result is *invalid*, so you never have to disambiguate decimals: strip `.` (thousands), reject any residual `,` or non-digit, gate `Number.isInteger`. Property-test with fast-check that no input ever yields a non-integer.
**Warning signs:** A price of `185.5` or `185,50` is accepted as `1855`/`18550`.

### Pitfall 3: partial writes on a bad row
**What goes wrong:** Looping upserts and committing per row leaves the DB half-updated when row 20 fails.
**Why it happens:** Not wrapping the loop in a single transaction, or catching mid-loop.
**How to avoid:** One `withTenant` = one transaction; throw on the first error to roll everything back (D-08). Re-validate server-side (dry-run inside the tx) before writing.
**Warning signs:** An integration test that injects one bad row still finds some rows changed.

### Pitfall 4: false-green RLS/role tests
**What goes wrong:** Asserting through the owner SQL pool makes a broken role/RLS gate look like it works.
**Why it happens:** Seeding and asserting on the same elevated connection.
**How to avoid:** Assert exclusively through `createCaller` (the app_authenticated/anon roles), owner pool only for seeding — exactly as `projects-role-gate.test.ts` does.
**Warning signs:** A viewer "successfully" edits a price in a test.

### Pitfall 5: formula injection survives export
**What goes wrong:** A unit `identificador` or estado containing `=cmd|...` exports as a live formula; opening the file in Excel executes it.
**Why it happens:** Writing user strings to cells unsanitized.
**How to avoid:** `sanitizeCell` on every string cell (`= + - @ \t \r` → prefix `'`) at build time (D-11, Pattern 1). Test with an adversarial `identificador`.
**Warning signs:** Exported cell text starts with `=`/`+`/`-`/`@` without a leading `'`.

## Runtime State Inventory

> Not a rename/refactor/migration-of-existing-data phase — it adds a UNIQUE constraint and new write paths. The only stored-state concern is the constraint's compatibility with existing seed data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `unit_prices` seed rows: one per (unit, list) already (pricing.ts L66) | Add `UNIQUE(unit_id, price_list_id)` — verify no dup rows before migrating (clean per seed) |
| Live service config | None — no external service holds unit/price state | None |
| OS-registered state | None | None |
| Secrets/env vars | Path B (GRID-07) *would* add `REVALIDATE_SECRET` + `WEB_ORIGIN` in both apps — only if Path B chosen | None if Path A (recommended) |
| Build artifacts | None (new package dir, no rename) | `pnpm install` after adding exceljs |

## Code Examples

### Reading current rows for the dry-run inside the tenant tx
```typescript
// Source: this repo — withTenant + Drizzle select; current state feeds buildDryRun for the diff
const current = await withTenant(ctx.activeOrgId, (tx) =>
  tx.select({
      unitId: schema.units.id,
      identificador: schema.units.identificador,
      estado: schema.units.estado,
      priceListId: schema.unitPrices.priceListId,
      precio: schema.unitPrices.precio,
    })
    .from(schema.units)
    .leftJoin(schema.unitPrices, eq(schema.unitPrices.unitId, schema.units.id))
    .where(eq(schema.units.projectId, input.projectId)),
);
```

### Round-trip identity test (build → parse is lossless for valid rows)
```typescript
// Source: mirrors packages/quoting property-test discipline
import fc from "fast-check";
test("build→parse round-trips valid integer USD prices", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({ identificador: fc.string({ minLength: 1 }), financiado: fc.nat(), contado: fc.nat() }),
    async (row) => {
      const buf = await buildWorkbook([toExportRow(row)]);
      const [parsed] = await parseWorkbook(buf);
      const p = parseMoneyEsAr(parsed.financiadoCell);
      return p.ok && p.value === row.financiado;
    },
  ));
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SheetJS `xlsx` as the default xlsx lib | `exceljs` (SheetJS forbidden) | CVE-2023-30533 (2023) | Must not `pnpm add xlsx` |
| `unstable_cache` + `revalidateTag` (Next 14/15) | `"use cache"` + `cacheTag`/`cacheLife` (Next 16 Cache Components) | Next 16 | If Path B adopted, prefer `"use cache"`; `unstable_cache` still works |
| Pages-router ISR `revalidate` export | App-router on-demand `revalidateTag`/`revalidatePath` | App Router | On-demand tag invalidation is the modern primitive — but in-process only (Pattern 4) |

**Deprecated/outdated:**
- `xlsx`/SheetJS on the import path — forbidden here.
- Any assumption that `revalidateTag` crosses process/deployment boundaries — it does not.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GRID-07 is satisfied by the existing `force-dynamic` read path (Path A); "ISR on-demand revalidation" is reinterpreted, not literally implemented | Pattern 4 / Open Q #1 | If the user requires literal ISR caching now, Path B (endpoint + secret + cache tags) must be planned instead — larger scope |
| A2 | `vigencia` is server-set `now()` and never imported, so DD/MM/YYYY date parsing is out of scope | Pattern 2 | If a date column is later added to the editable template, a defensive es-AR date parser is needed |
| A3 | USD prices are whole integers (no cents) — so any fractional parse is simply invalid, dissolving the `.`/`,` ambiguity | Pitfall 2 | If a list ever needs cents, the parser's "reject fractional" rule must change |
| A4 | The base64-in-tRPC file transport for import is acceptable for ~38-row files | Pattern 5 | For very large files a multipart/upload route would be better; fine at this scale |
| A5 | `lucide-react` (if used for glyphs) is legitimate — not verified this session | Supporting stack | Planner must run the legitimacy gate before adding it; inline SVG avoids the dependency entirely |

## Open Questions (ALL RESOLVED)

> Resolution recorded 2026-07-21: Q1 → **Path A** (user-confirmed; locked in 10-CONTEXT.md D-14); Q2 → reject negative previewed bulk results (locked in D-12, implemented 10-02/10-03); Q3 → `events.tipo` constants `unit_price_changed` / `unit_estado_changed` (10-03). None remain open for planning.

1. **(RESOLVED — Path A) GRID-07 mechanism: Path A (keep force-dynamic) vs Path B (real ISR + cross-app revalidation)?**
   - What we know: `apps/web` is `force-dynamic` today → public reads are already live; `revalidateTag` cannot cross the panel→web process boundary.
   - What's unclear: whether the team wants CDN/ISR caching adopted *in this phase* (Path B) or deferred (Path A). CLAUDE.md states "ISR en la web pública" as intent, but the shipped v1.2 web is dynamic.
   - Recommendation: **Path A + a cross-surface integration test**; record Path B as the forward plan. Get one-line user confirmation before planning.

2. **Bulk edit rounding direction on `%` (D-12 says `Math.round`).**
   - What we know: D-12 mandates `Math.round` to integer USD.
   - What's unclear: whether a `-100%`/absurd input should be clamped or rejected (e.g. negative result).
   - Recommendation: reject any operation whose previewed result is `< 0` with an es-AR reason, mirroring the import predicate; `computeBulkPreview` returns errors the same shape as the dry-run.

3. **`events.tipo` vocabulary for the audit trail (D-02).**
   - What we know: emit price/estado transitions to `events`; `tipo` is free `text`.
   - What's unclear: exact `tipo` string constants (e.g. `unit_price_changed`, `unit_estado_changed`).
   - Recommendation: planner picks stable English constants; document them so later analytics phases reuse them.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test | ✓ | 22 LTS (nvm; shell defaults to 20 — use `nvm use 22`) | — |
| pnpm | install exceljs | ✓ | 11.x | — |
| PostgreSQL `_test` DB | integration tests | ✓ (Docker) | 16 | — must be up for api tests |
| Redis | not needed this phase | n/a | — | — |
| `exceljs` | export/import | ✗ (not yet installed) | to add `4.4.0` | none — required, `pnpm --filter @imbau/api add exceljs` |

**Missing dependencies with no fallback:** `exceljs@4.4.0` — must be installed (approved, OK verdict).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (+ fast-check 4.8.0 for property tests) |
| Config file | `packages/api/vitest.config.ts` (integration: real `_test` Postgres via `tests/setup.ts` globalSetup); pure excel tests need no DB |
| Quick run command | `pnpm --filter @imbau/api test -- excel` (pure module, sub-second) |
| Full suite command | `pnpm --filter @imbau/api test` (includes role-gate integration vs Postgres) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRID-01 | Inline price UPSERT persists + sets vigencia; owner/dev ✓, viewer 403, cross-org NOT_FOUND | integration (createCaller vs PG) | `pnpm --filter @imbau/api test -- units-role-gate` | ❌ Wave 0 (clone projects-role-gate) |
| GRID-02 | Estado change persists; enum validated; role gate | integration | same suite | ❌ Wave 0 |
| GRID-03 | Export sanitizes `= + - @`; template column order | unit (pure) | `pnpm --filter @imbau/api test -- build` | ❌ Wave 0 |
| GRID-04 | Money parse never yields non-integer; formula/date/richText rejected; es-AR `185.000`→185000 | unit + **property (fast-check)** | `pnpm --filter @imbau/api test -- money parse` | ❌ Wave 0 |
| GRID-04 | Dry-run classifies nueva/cambio/igual/inválida + per-row es-AR reason | unit | `pnpm --filter @imbau/api test -- dry-run` | ❌ Wave 0 |
| GRID-05 | All-or-nothing: one bad row → zero writes; idempotent re-import = no-op | integration (vs PG) | `pnpm --filter @imbau/api test -- import-apply` | ❌ Wave 0 |
| GRID-05 | UNIQUE(unit_id, price_list_id) migration present + enforced | integration (dup insert rejected) | same suite | ❌ Wave 0 |
| GRID-06 | Bulk % / fixed → `Math.round` int USD; negative result rejected; preview matches apply | unit + integration | `pnpm --filter @imbau/api test -- bulk` | ❌ Wave 0 |
| GRID-07 | Price/estado mutation visible through anon picker caller (Path A) | integration (cross-surface) | `pnpm --filter @imbau/api test -- public-reflection` | ❌ Wave 0 (clone estado→listPublished test) |

### Critical behaviors that MUST be validated (Nyquist)
- Money parse **never** yields a float / non-integer (property test, the load-bearing invariant).
- All-or-nothing rollback: one invalid row → zero DB writes.
- Idempotent re-import of an unchanged file → no-op (zero writes).
- Formula-injection sanitization on export (adversarial identificador).
- Cross-role gate on **every** mutation (owner✓/developer✓/viewer 403/other-org NOT_FOUND) — clone the matrix.
- Public reflection of a committed write (Path A) via the anon caller.

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/api test -- excel` (pure module — fast feedback).
- **Per wave merge:** `pnpm --filter @imbau/api test` (full, includes Postgres integration).
- **Phase gate:** full `@imbau/api` + `@imbau/db` suites green before `/gsd-verify-work`; TS strict + lint clean.

### Wave 0 Gaps
- [ ] `packages/api/src/excel/*.test.ts` — money (property), parse, build/sanitize, dry-run, bulk
- [ ] `packages/api/tests/units-role-gate.test.ts` — clone `projects-role-gate.test.ts` for the 4 mutations
- [ ] `packages/api/tests/import-apply.test.ts` — all-or-nothing + idempotency vs real Postgres
- [ ] `packages/api/tests/public-reflection.test.ts` — cross-surface anon visibility (GRID-07 Path A)
- [ ] Migration test: dup `(unit_id, price_list_id)` insert rejected
- [ ] Add `fast-check` to `@imbau/api` devDependencies

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | via Phase 9 | Better Auth session (inherited; not re-implemented here) |
| V3 Session Management | via Phase 9 | `activeOrganizationId` → tenant GUC (inherited) |
| V4 Access Control | **yes** | `requireRole("owner","developer")` + RLS `*_tenant` policies + composite FKs; viewer/cross-org denied server-side, tested via matrix |
| V5 Input Validation | **yes** | Zod at the tRPC boundary (uuid, estado enum, bulk params) + the defensive es-AR money parser (reject formula/date/richText/negative/non-integer) |
| V6 Cryptography | no (Path A); minor (Path B) | Path B revalidation endpoint would need a shared secret compare — never hand-roll; use a constant-time compare |
| V12 Files & Resources | **yes** | Uploaded `.xlsx` parsed in-memory; reject malformed workbooks with a friendly parse error; no path/filename trust; size-bound the base64 payload |

### Known Threat Patterns for {panel mutations + Excel round-trip}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSV/formula injection in exported cells | Tampering | `sanitizeCell` prefixes `= + - @ \t \r` with `'` (D-11, Pattern 1) |
| Float contamination of money | Tampering/Integrity | Integer-only parse + `Number.isInteger` gate + property test (Pattern 2) |
| Partial write on bad import row | Integrity | Single `withTenant` transaction, throw-to-rollback (D-08) |
| Cross-tenant price write | Elevation/Info disclosure | RLS `unit_prices_tenant` + triple composite FK org-pin; assert via createCaller, never owner pool |
| Viewer performing a write | Elevation | `requireRole` FORBIDDEN pre-mutation |
| Malicious/huge `.xlsx` (zip-bomb / DoS) | DoS | Size-bound the payload; in-memory parse of ~38-row files; reject on parse error |
| Anon-triggerable revalidation (Path B only) | DoS | Auth-gate + rate-limit the `/api/revalidate` endpoint; shared-secret constant-time compare |

## Sources

### Primary (HIGH confidence)
- This repo — `packages/api/src/trpc/routers/projects.ts`, `middleware.ts`, `packages/db/src/with-tenant.ts`, `schema/unit-prices.ts`, `schema/units.ts`, `schema/enums.ts`, `schema/events.ts`, `packages/quoting/src/format.ts` + `money.ts`, `projects-role-gate.test.ts`, `apps/web/app/**` (force-dynamic reads), `apps/panel/.../unidades/page.tsx` — verified molds, schema, and the GRID-07 architecture reality.
- `npm view exceljs` — version 4.4.0, MIT, no postinstall, repo, publish/modify dates. `[VERIFIED]`
- `gsd-tools query package-legitimacy check` — exceljs verdict OK (11.1M weekly dl). `[VERIFIED]`
- `.planning/config.json` — nyquist_validation + security_enforcement both enabled.

### Secondary (MEDIUM confidence)
- [Next.js — revalidateTag / cacheTag / ISR docs](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) — on-demand revalidation is server/in-process only; `"use cache"`+`cacheTag` in Next 16 (Path B). Cross-checked against the app's actual `force-dynamic` config.
- [exceljs index.d.ts — ValueType enum & cell value interfaces](https://github.com/exceljs/exceljs/blob/master/index.d.ts) — Number/String/Date/Formula/RichText/Hyperlink/Boolean/Error cell shapes (Pattern 2, Pitfall 1).

### Tertiary (LOW confidence)
- OWASP CSV-injection guidance (formula-prefix characters) — cross-checked against D-11's explicit `= + - @` list.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — exceljs verified on npm + legitimacy gate; everything else already installed.
- Architecture / molds: HIGH — cloning verbatim from shipped Phase 9 + quoting patterns in this repo.
- es-AR money parse: HIGH — grounded in the existing formatter + the whole-USD domain rule; property-testable.
- GRID-07 mechanism: MEDIUM — the force-dynamic finding is verified, but which path to ship is a user/planner decision (Open Q #1).
- Pitfalls: HIGH — each tied to a concrete repo artifact or exceljs type fact.

**Research date:** 2026-07-21
**Valid until:** ~2026-08-20 (stable stack; exceljs unchanged since 2023, Next 16 caching APIs the only fast-moving area)

## RESEARCH COMPLETE

- **80% clone, 20% new risk.** The four mutations, role gate, tenant transaction, cross-role test matrix, and es-AR money *formatter* already exist as proven molds (`projects.updateSettings`, `withTenant`, `projects-role-gate.test.ts`, `packages/quoting`). Risk concentrates entirely in the new pure `packages/api/src/excel/` module — build it and property-test it before wiring any mutation.
- **es-AR money parse is dissolved by the domain rule.** USD prices are whole integers (no cents), so *any* fractional parse is simply invalid — this eliminates the `.`-thousands vs `,`-decimal ambiguity. Never trust an exceljs cell typed as number: branch on `cell.type`, reject Formula/Date/RichText/Error, gate on `Number.isInteger`. `vigencia` is server-set `now()`, so DD/MM/YYYY date import is out of scope (confirmed).
- **GRID-07 is the one real decision.** `apps/web` is `force-dynamic` today — it reads live Postgres on every request, so "instant reflection" already holds and there is *no ISR cache to revalidate*. Recommend Path A (keep dynamic + a cross-surface integration test) over Path B (convert to `"use cache"`+`cacheTag` and add a shared-secret `/api/revalidate` endpoint the panel calls). **Needs one-line user confirmation** — Path A reinterprets the requirement's literal "ISR on-demand" wording.
- **Apply is one `withTenant` transaction:** server re-validates the dry-run, then N× `onConflictDoUpdate` on the new `UNIQUE(unit_id, price_list_id)` + `events` audit inserts, all-or-nothing (throw-to-rollback), idempotent (unchanged re-import = no-op).
- **`exceljs@4.4.0` approved (OK verdict, MIT, no postinstall); `xlsx`/SheetJS forbidden (CVE-2023-30533).** Sanitize every string cell (`= + - @ \t \r` → `'` prefix) on export.
