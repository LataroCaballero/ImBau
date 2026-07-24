---
phase: 10-d1-grilla-de-unidades-editable-import-export-excel
reviewed: 2026-07-24T16:19:14Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - packages/db/src/schema/unit-prices.ts
  - packages/db/migrations/0005_unit_prices_unit_list_uq.sql
  - packages/api/src/excel/money.ts
  - packages/api/src/excel/build.ts
  - packages/api/src/excel/parse.ts
  - packages/api/src/excel/types.ts
  - packages/api/src/excel/dry-run.ts
  - packages/api/src/excel/bulk.ts
  - packages/api/src/excel/template.ts
  - packages/api/src/trpc/routers/units.ts
  - packages/api/src/trpc/routers/_app.ts
  - apps/panel/app/proyectos/[id]/unidades/units-grid.tsx
  - apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx
  - apps/panel/app/proyectos/[id]/unidades/bulk-edit.tsx
  - apps/panel/app/proyectos/[id]/unidades/page.tsx
  - packages/db/src/with-tenant.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
resolved:
  - id: CR-01
    commit: 00474a0
  - id: CR-02
    commit: 85a425d
  - id: WR-01
    commit: b98e2a5
  - id: WR-02
    commit: b98e2a5
  - id: WR-03
    commit: 4e89f3f
open:
  - WR-04
  - WR-05
  - WR-06
  - IN-01
  - IN-02
  - IN-03
  - IN-04
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-24T16:19:14Z
**Depth:** deep
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 10 delivers the editable units grid plus the Excel round-trip and bulk price editor. The **server-side money core is strong**: `parseMoneyEsAr` is a rigorous `Number.isInteger`-gated es-AR parser that rejects every non-plain-number cell type; `withTenant` is a genuine parameterized-GUC transaction (verified — the all-or-nothing / audit-in-same-tx claims hold); every mutation carries `requireRole("owner","developer")` over `withTenant` (authorization is not conflated with RLS tenancy); the `unit_prices` UNIQUE + composite-FK design makes cross-tenant prices structurally impossible; `computeBulkPreview` and the import apply loop keep money as `Math.round` integers written inside one tx.

The defects cluster **at the client boundary and at the numeric edges the server-side parser was built to protect** — and one of them re-opens exactly the float/non-integer-money hole the phase's own invariant forbids:

- **The inline price editor bypasses `parseMoneyEsAr` entirely** and uses raw `Number()`, so a user typing an es-AR grouped number (`185.000`) silently writes **185** dollars instead of 185.000 — money corruption, no error (CR-01).
- **The import wizard's "Aplicar cambios" silently no-ops for drag-dropped files** — the headline irreversible operation does nothing and shows no feedback via one of its two documented upload paths (CR-02).
- Integer-overflow of the `int4` `precio` column is unguarded end-to-end (no `.max()`, `Number.isInteger` passes values > 2³¹ and > 2⁵³), turning a large Excel/bulk value into an unhandled 500 that aborts the whole import with a cryptic message (WR-01), and apply-time errors are swallowed behind a generic string (WR-03).

No structural-findings block was supplied, so all findings below are narrative.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Inline price editor bypasses the es-AR money parser — "185.000" silently saved as 185

**Status: RESOLVED** (commit `00474a0`) — extracted the es-AR string parse into a pure, dependency-free `money-core.ts` (`parseMoneyStringEsAr` + `MAX_PRECIO_USD`), exposed via the `@imbau/api/money` subpath, and routed the inline `PriceCell.commit()` through it. Now "185.000" → 185000; "185,50"/"1.5"/scientific/hex/negatives/above-cap → red + revert. `money.ts` reuses the same core, so grid and Excel import share one source of truth. Also resolves IN-04.

**File:** `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx:403-410`
**Issue:** `PriceCell.commit()` parses the typed price with raw `Number(trimmed)`:

```js
const parsed = Number(trimmed);
if (!Number.isInteger(parsed) || parsed < 0) { setState("error"); return; }
update.mutate({ projectId, unitId, priceListId, precio: parsed }, …);
```

`Number("185.000") === 185` and `Number.isInteger(185) === true`, so an operator typing the natural es-AR thousands-grouped value **`185.000` (185 thousand) silently commits `precio: 185`** ($185) with no error state. `Number("1.200.000")` → `1.2` → rejected as non-integer (confusing), and `Number("1e6")` / `Number("0x10")` are accepted as integers. This is the exact "a float/non-integer typed number reaches USD" hole the whole phase (and `money.ts`) was engineered to close — the Excel path is protected by `parseMoneyEsAr`, but the far-more-used inline editor is not. `es-AR` users habitually type `.` as a thousands separator, so this is a plausible, silent, money-corrupting action on the panel's highest-value surface.
**Fix:** Reuse the same integer discipline as the server. Reject any input containing a `.` or `,` (or normalize es-AR grouping identically to `money.ts`), e.g.:

```js
const trimmed = draft.trim().replace(/\s/g, "");
// whole USD only: plain integer, or es-AR grouped (1.234.567) — mirror money.ts
const isPlain = /^\d+$/.test(trimmed);
const isGrouped = /^\d{1,3}(\.\d{3})+$/.test(trimmed);
if (!isPlain && !isGrouped) { setState("error"); return; }
const parsed = Number(trimmed.replace(/\./g, ""));
if (!Number.isSafeInteger(parsed) || parsed < 0) { setState("error"); return; }
```

Ideally factor the es-AR string→integer logic out of `parseMoneyEsAr` into a shared pure helper the panel imports, so the grid and the Excel import cannot drift.

### CR-02: Import "Aplicar cambios" silently does nothing for drag-and-dropped files

**Status: RESOLVED** (commit `85a425d`) — the wizard now holds the selected `File` in component state (set on both the browse `onChange` and the `onDrop` handler); `confirmApply` reuses that stored File instead of re-reading `fileInputRef.current.files`. The exact File that produced the dry-run is the one applied through both upload paths.

**File:** `apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx:70-84` (with `124-129`)
**Issue:** `confirmApply()` re-reads the file exclusively from the hidden `<input>`:

```js
const input = fileInputRef.current?.files?.[0];
if (!input) return;   // <- silent dead-end
```

But the drop handler (`onDrop → handleFile(f)`, lines 124-129) feeds the dry-run directly from `e.dataTransfer.files[0]` and **never populates `fileInputRef.current.files`** (browsers do not set an input's `FileList` from a drag-drop). So the full flow "drag a valid Excel → see the correct dry-run diff → click *Aplicar cambios*" hits `if (!input) return;` and **silently applies nothing** — the button is enabled, no error, no status, no write. The headline irreversible import is non-functional through one of its two explicitly-implemented upload paths, and it fails silently, which is the worst failure mode for a money operation.
**Fix:** Do not re-read the file from the DOM at apply time. Persist the base64 (or the `File`) captured in `handleFile` in state and reuse it in `confirmApply`:

```js
const [fileB64, setFileB64] = useState<string | null>(null);
// in handleFile: const base64 = await fileToBase64(file); setFileB64(base64); dryRunMut.mutate(...)
// in confirmApply:
if (!fileB64) return;
applyMut.mutate({ projectId, file: fileB64 }, { onSuccess: …, onError: … });
```

This also removes the double-read TOCTOU in IN-02.

## Warnings

### WR-01: `precio` integer overflow is unguarded — large Excel/bulk value → unhandled 500, whole import aborts

**Status: RESOLVED** (commit `b98e2a5`, cap defined in `money-core.ts` at `00474a0`) — added `MAX_PRECIO_USD` (int4 max) as the single shared cap: `parseMoneyEsAr` now rejects a Number cell or grouped string above the cap with "el precio es demasiado grande", and the `updatePrice` Zod input is `z.number().int().min(0).max(MAX_PRECIO_USD)`. Oversized values are a clean 400/es-AR reason, never a 22003 DB fault.

**File:** `packages/api/src/trpc/routers/units.ts:196` and `packages/api/src/excel/money.ts:56-76`
**Issue:** `precio` is a Postgres `integer` (int4, max 2,147,483,647 — `unit-prices.ts:47`), but nothing bounds the value against it. `updatePrice` input is `z.number().int().nonnegative()` with no `.max()`, and `parseMoneyEsAr` only checks `Number.isInteger(n)` — which is `true` for `1e21` and for any value above 2³¹. So a grouped Excel cell like `999.999.999.999`, or a direct `updatePrice({ precio: 3_000_000_000 })`, passes every validation and reaches the `INSERT`, where Postgres raises `integer out of range (22003)`. In the import path that fault throws *inside* the tx → the entire all-or-nothing import rolls back and the operator gets an opaque 500 instead of a clean "Fila N: el precio es demasiado grande." The `money.ts:72` comment claims to guard overflow, but `Number.isInteger` does not catch int4 overflow.
**Fix:** Add a domain cap everywhere money is admitted. In `money.ts`, gate on `Number.isSafeInteger(n) && n <= MAX_PRECIO_USD`; in the router input, `precio: z.number().int().min(0).max(MAX_PRECIO_USD)`; surface a per-row es-AR reason ("el precio es demasiado grande") from the dry-run instead of letting the DB throw. Pick `MAX_PRECIO_USD` well under 2³¹ (e.g. a realistic real-estate ceiling).

### WR-02: Bulk `value` is unbounded and non-finite on the server — Infinity/huge percent reaches `Math.round` → invalid write → 500

**Status: RESOLVED** (commit `b98e2a5`) — both `bulkPreview` and `bulkUpdatePrice` inputs are now `z.number().finite().min(-MAX_PRECIO_USD).max(MAX_PRECIO_USD)`, and `computeBulkPreview` re-asserts `Number.isFinite(next) && next <= MAX_PRECIO_USD` before pushing a row (rejecting with "el precio es demasiado grande"). Infinity/NaN/above-cap can no longer reach the INSERT.

**File:** `packages/api/src/trpc/routers/units.ts:430,454` and `packages/api/src/excel/bulk.ts:34-37`
**Issue:** Both `bulkPreview` and `bulkUpdatePrice` accept `value: z.number()` — no `.finite()`, no bounds. The client (`bulk-edit.tsx:67`) gates `Number.isFinite`, but a direct tRPC call is not so constrained. `computeBulkPreview` then evaluates `Math.round(current * (1 + Infinity/100))` → `Infinity` (which is not `< 0`, so it is *not* rejected) or a value far above int4, and writes `precio: Infinity`/overflow → Postgres error → 500 aborting the bulk tx. Same root cause as WR-01 (missing numeric bounds at the trust boundary).
**Fix:** `value: z.number().finite()` on both procedures, plus a sane range (e.g. percent within `[-100, 10000]`, fixed within `±MAX_PRECIO_USD`), and re-assert `Number.isFinite(next) && next <= MAX_PRECIO_USD` inside `computeBulkPreview` before pushing a row (reject with an es-AR reason otherwise).

### WR-03: Apply-time error detail is swallowed behind a generic message (import + bulk)

**Status: RESOLVED** (commit `4e89f3f`) — added a shared `describeApplyError` (apply-error.ts) that maps known tRPC codes (INTERNAL_SERVER_ERROR, UNAUTHORIZED/FORBIDDEN) to es-AR reasons and otherwise surfaces the server's own es-AR message; both wizards wire it via `onError` and render the real cause (falling back to the generic copy only when absent).

**File:** `apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx:74-83,261-265` and `apps/panel/app/proyectos/[id]/unidades/bulk-edit.tsx:78-88,229-233`
**Issue:** Neither `confirmApply` passes an `onError`; both rely on `applyMut.isError` to render a fixed string ("No se aplicó ningún cambio. Si una fila falla, no se aplica nada."). But the server distinguishes real causes: a `BAD_REQUEST` with `cause: report.errors`, a `BAD_REQUEST` "El proyecto no tiene una lista de precios financiado" (units.ts:371), a preview-error `BAD_REQUEST` (units.ts:478), or an unhandled 500 (e.g. the stale-dev-DB fault already seen in UAT, or the overflow in WR-01/WR-02). All of these collapse into the same misleading sentence — the message even asserts "si una fila falla" for a server 500 that has nothing to do with a row. The operator gets no actionable detail on an irreversible money operation.
**Fix:** Add `onError: (err) => setApplyError(err.message)` and render `applyMut.error?.message` (fall back to the generic copy only when absent). For import, surface `err.data?.cause` row errors the same way Step 2 renders dry-run errors.

### WR-04: Bulk apply recomputes from live DB — the confirmed preview numbers are not guaranteed to be the applied numbers

**File:** `packages/api/src/trpc/routers/units.ts:457-513`
**Issue:** `bulkUpdatePrice` does not apply the previewed rows; it re-fetches each unit's current price (`buildBulkSelection`) and re-runs `computeBulkPreview(selection, mode, value)` at apply time. This is correct in spirit (never trust a client-sent price), but it means that if any selected unit's price changes between the preview click and the confirm click (another editor, a concurrent import), the actually-written `new` value differs from the exact `viejo → nuevo` numbers the operator reviewed and approved under copy that says "es una operación de dinero: no se puede deshacer." For a mandatory-preview money control, "what you confirmed" and "what was written" can silently diverge.
**Fix:** Either (a) send the previewed `{unitId, expectedOld, new}` rows to the apply mutation and reject (whole tx) any unit whose live price no longer equals `expectedOld` (optimistic-concurrency guard), or (b) explicitly document the recompute semantics in the confirm copy. Option (a) is the safer money contract.

### WR-05: Contado/Financiado column mapping depends on a free-text `/contado/i` list-name regex

**File:** `packages/api/src/trpc/routers/units.ts:99-103` (used by export, dry-run, and import apply at `366-369`)
**Issue:** Which USD price list is the "Financiado" column vs the "Contado" column is resolved purely by `nombre` matching `/contado/i`. A project whose two USD lists are named e.g. "Lista A" / "Lista B" yields `contadoListId = null` and `financiadoListId = A`, so the Contado column becomes silently uneditable, exports blank, and an import that carries a Contado price throws `BAD_REQUEST "no tiene una lista de precios contado"` — aborting the whole import. A list accidentally named "Contado especial" could capture the wrong column and route price writes to the wrong list (money written against the wrong list). The mapping of a money column to a DB list should not hinge on operator free-text.
**Fix:** Resolve the list mapping from a stable attribute (a `tipo`/`slug` enum column, or the ordered list ids the panel already knows) rather than a name regex; at minimum, validate at read time that exactly one USD list matches each role and surface a clear configuration error otherwise.

### WR-06: xlsx decompression-bomb — the size bound is on base64, not on decompressed content

**File:** `packages/api/src/trpc/routers/units.ts:58,315,331` and `packages/api/src/excel/parse.ts:23-28`
**Issue:** `MAX_FILE_B64 = 10_000_000` bounds the *base64 upload* before `parseWorkbook` runs, but `.xlsx` is a zip; a ~10 MB workbook can inflate to hundreds of MB of XML that ExcelJS materializes in memory (`wb.xlsx.load(buf)`), a classic decompression-bomb / memory-exhaustion vector (the code even cites ASVS V12 for the size cap). Mitigated by the `requireRole("owner","developer")` gate (only an authenticated org member can reach it), which lowers but does not eliminate the risk.
**Fix:** Bound decompressed size and/or row/cell count (reject once `ws.rowCount`/`actualRowCount` exceeds a sane ceiling for a units sheet), or stream-parse with a hard limit. Given the workbook is ~38 rows, an explicit row cap is cheap insurance.

## Info

### IN-01: Sanitize/unsanitize round-trip is not perfectly lossless for an identifier starting with `'` + injection char

**File:** `packages/api/src/excel/build.ts:20-22` and `packages/api/src/excel/parse.ts:13-17`
**Issue:** `sanitizeCell` only prefixes `'` when the string starts with `=+-@\t\r`. A value like `'=X` (already starting with a quote) is exported unchanged, but `unsanitizeCell` matches `ESCAPED_LEAD` (`'=`) and strips it → import yields `=X`. Not lossless. The code documents the assumption ("Identificadores/estados never legitimately start with `'`"), so this is low-risk, but the round-trip is not provably lossless as claimed.
**Fix:** Make sanitize escape any leading `'` too (or make unsanitize idempotent with sanitize's exact inverse), so the pair is a true bijection regardless of input.

### IN-02: Import wizard reads and re-parses the same file twice

**File:** `apps/panel/app/proyectos/[id]/unidades/import-wizard.tsx:61-68,71-73`
**Issue:** The file is read to base64 once for the dry-run and again (from the DOM) at apply. Besides driving CR-02, this opens a TOCTOU window: if the file on disk changed between dry-run and apply, a different-but-still-valid file could be applied than the one previewed (the server re-validates, so it is safe, but the preview would not match what was written).
**Fix:** Reuse the base64 captured for the dry-run (see CR-02 fix); never re-read the file for apply.

### IN-03: Dry-run "nueva" classification misses estado-only first-touch rows

**File:** `packages/api/src/excel/dry-run.ts:115-119`
**Issue:** A previously-unpriced unit whose import changes *only* `estado` (no price) has `nowPriced === false`, so it classifies as "con cambios" rather than "nueva". Purely a label/summary nuance (the write is correct either way), but the summary counts could read slightly unintuitively.
**Fix:** If the intent is "nueva = first meaningful edit", broaden the predicate; otherwise document that "nueva" specifically means "first price".

### IN-04: Inline price input accepts scientific/hex notation

**File:** `apps/panel/app/proyectos/[id]/unidades/units-grid.tsx:403`
**Issue:** Same root as CR-01: `Number("1e6")` (1000000) and `Number("0x10")` (16) pass `Number.isInteger`, so odd notations are silently accepted as prices. Resolved by the CR-01 fix (restrict to plain/es-AR-grouped digit strings).
**Fix:** Covered by CR-01.

---

_Reviewed: 2026-07-24T16:19:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
