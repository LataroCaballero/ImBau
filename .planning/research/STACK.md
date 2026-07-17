# Stack Research — v1.3 Panel de autogestión

**Domain:** Developer self-service panel — editable unit/price grid with Excel import/export, leads inbox with email notification, and a visual SVG-polygon hotspot editor. Additions layered on an already-validated Next.js 16 / tRPC v11 / Drizzle+RLS / BullMQ+Resend stack.
**Researched:** 2026-07-17
**Confidence:** HIGH (all versions verified against the npm registry 2026-07-17; SheetJS npm/CVE situation confirmed against the official CVE-2023-30533 advisory and SheetJS issue tracker; polygon-library peer ranges read directly from npm)

## TL;DR — what to add

- **Excel:** add **`exceljs@4.4.0`** (MIT). Handles both import and export in one dependency. **Do NOT install `xlsx` (SheetJS) from npm** — the npm build is frozen at a vulnerable 0.18.5.
- **SVG hotspot editor:** add **nothing** — hand-roll a ~250-line React 19 pointer-events `<svg>` component. The stored format already *is* the editor's output (`poligonoSvg` = raw SVG `points`). Every maintained library is either canvas-based (Konva) or a heavyweight W3C-annotation framework — both fight the architecture.
- **Leads inbox + email:** add **nothing**. Schema, RLS, Resend, React Email and the BullMQ worker are all in place. Reuse the invitation/quote-pdf email pattern.
- **Editable grid UI:** add **nothing** for now — a plain controlled `<table>` covers ~38 rows. Reach for `@tanstack/react-table` only if sort/filter/virtualization actually appears.

The schema needs **no changes**: `floors.poligonoSvg` / `units.poligonoSvg` / `floors.renderKey` already store hotspot geometry; `leads` already has the `lead_estado` enum (`nuevo|contactado|negociacion|cerrado`), `origen`, the `unitId`/`brokerId`/`quoteId` in-tenant pointers and a typed `timeline` JSONB; `unit_prices`/`price_lists`/`units.estado` already model the grid.

## Recommended Stack

### Core Technologies (net-new for v1.3)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **exceljs** | `4.4.0` | Read (import) + write (export) `.xlsx` server-side | MIT-licensed and installs cleanly from npm (unlike SheetJS — see "What NOT to Use"). One dependency covers both directions. Rich cell/format API produces the styled, human-legible sheet developers expect to open in Excel. Streaming API exists if ever needed, but our files are tiny (~38 unit rows), so the simple `workbook.xlsx.load()/write()` path is enough. |

That is the **only** new runtime dependency this milestone strictly requires.

### Supporting Libraries (optional / conditional)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@tanstack/react-table** | `8.21.x` (verify at adoption) | Headless table state (sort/filter/column sizing) for the unit grid | ONLY if the plain controlled `<table>` becomes unwieldy (many columns, client-side sort/filter, virtualization). Headless = no imposed styling, pairs with existing Tailwind v4 tokens. Not needed for the v1.3 MVP grid. |
| **@protobi/exceljs** | `4.4.0-protobi.10` | Drop-in exceljs replacement | Escape hatch only: if a security advisory lands against exceljs's transitive deps (it bumps `archiver` to 7.x and is actively maintained). 100% API-compatible; swap the import, nothing else. |
| **read-excel-file** + **write-excel-file** | `9.3.2` / `4.1.1` | Schema-driven parse + minimal write | Alternative to exceljs if you want a smaller, actively-maintained pair and don't need rich export styling. `read-excel-file`'s schema API maps rows → typed objects and pairs naturally with a Zod re-validation. Two packages instead of one; weaker export formatting. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| (none new) | — | Vitest + Playwright already present. Add unit tests for the row-parse/validation mapper and a Playwright test for the import→preview→commit and export-download flows. Test the SVG editor via Playwright pointer actions (`page.mouse` / `dispatchEvent`) against a fixed `viewBox`. |

## Installation

```bash
# Excel import/export — the one net-new runtime dep.
# Install where the parsing lives: apps/panel (Route Handler) or packages/api.
pnpm --filter @imbau/panel add exceljs
pnpm --filter @imbau/panel add -D @types/exceljs   # ships its own types in 4.x; add only if TS complains

# Optional, only if the grid UI grows beyond a controlled <table>:
# pnpm --filter @imbau/panel add @tanstack/react-table

# SVG hotspot editor: NOTHING to install — hand-rolled component in packages/ui or apps/panel.
# Leads inbox + email: NOTHING to install — reuse resend + react-email + bullmq already in the repo.
```

## Integration with the existing stack

### D1 — Unit/price grid + Excel import/export

- **File size reality:** a project is ~13 floors / ~38 units. Import/export files are kilobytes and dozens of rows. **No streaming, no worker, no chunking.** Parse inline in the request. (Contrast with the PDF pipeline, which *is* offloaded to the worker because rendering is heavy — Excel parsing here is not.)
- **Upload path:** tRPC/JSON is a poor fit for binary. Prefer a **Next.js App Router Route Handler** in `apps/panel` that accepts `multipart/form-data` (`await req.formData()`), reads the `File` into a `Buffer`, and hands it to a parse function. (Acceptable alternative for these tiny files: base64 the sheet into a tRPC mutation input — keeps everything in the typed Zod boundary — but mind Next's body-size limit and the base64 bloat.)
- **The real work is validation, not the library.** Pipeline: `exceljs.load(buffer)` → map each row to a raw record → **re-validate every row with a Zod schema** (reuse/derive from the `drizzle-zod` schemas already in `packages/db`) → return a per-row error report to the UI for a preview/confirm step → on confirm, **transactional upsert under `withTenant`** so RLS pins every write to the developer's org. Never trust cell values (types, ranges, enum membership for `estado`, integer USD for `precio` per the money rule — never float).
- **Export path:** a Route Handler that builds the workbook from a `withTenant` query and streams it back with `Content-Disposition: attachment; filename="..."` and the xlsx content-type — the same download ergonomics already used for the quote PDF's presigned GET. Round-trip the column headers so an exported sheet re-imports cleanly.
- **RLS:** all reads/writes go through the existing `withTenant` transaction wrapper; the app role is `NOSUPERUSER NOBYPASSRLS`, so a bug can't leak or cross-write another tenant's grid.

### Hotspot editor — hand-rolled SVG, no dependency

- **Storage already dictates the format.** `floors.poligonoSvg` and `units.poligonoSvg` are `text` columns holding SVG polygon geometry; the public explorer (future fase 2) will consume them as raw `<polygon points="x1,y1 x2,y2 …">`. The editor's job is exactly to *produce that string* over a static render (`floors.renderKey`). Any library that models geometry as canvas objects or W3C-annotation JSON adds a serialize/deserialize impedance layer around a format we already own.
- **Shape of the component:** an inline `<svg viewBox="0 0 W H">` overlaying the render `<image>`; `onPointerDown` adds a vertex, dragging a vertex uses `setPointerCapture` + `onPointerMove`, double-click / Enter closes the polygon, emit `points` in **normalized `viewBox` coordinates** so the same polygon scales responsively on mobile. React 19's pointer-event handling makes this ~200-400 LOC with full control over snap/delete/keyboard UX, strict typing, and Playwright-testability.
- **Why not a library:** see "What NOT to Use." The maintained options pull in Konva (a canvas 2D engine — directly contradicts the product's explicit "renders estáticos + SVG, sin motor tipo game engine" decision and the per-page weight budget) or Annotorious (a full W3C image-annotation framework with its own data model). Crib UX patterns from `choutkamartin/image-annotation` (MIT, React Hooks, SVG polygons) as a **reference**, not a dependency.

### D2 — Leads inbox + email notification

- **Nothing new.** The `leads` table is complete: `lead_estado` enum drives the `nuevo → contactado → negociacion → cerrado` pipeline, `origen` records source (broker/unidad/cotización), the nullable composite-FK'd `unitId`/`brokerId`/`quoteId` link back into the same tenant, and `timeline` is a typed `LeadNote[]` JSONB for notes. RLS `leads_tenant` scopes all panel reads/writes.
- **Inbox** = tRPC queries + Drizzle under `withTenant`; status changes and notes are tRPC mutations. Live updates (SSE via Postgres `LISTEN/NOTIFY`) are already the decided stack but are **not required** for v1.3 — a normal query + refetch/poll is fine; defer SSE unless UX demands it.
- **Email on new lead:** reuse **Resend + React Email** (already used for org invitations). The anon lead-insert path is server-side, so enqueue a **BullMQ** job on insert and let the **worker** send the notification — the exact decoupling pattern already proven by `quote-pdf` (jobId-dedup, retries, Sentry+pino observability). No new dependency.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `exceljs@4.4.0` (npm, MIT) | **SheetJS `xlsx` via CDN override** (Apache-2.0) | Only if you need format breadth exceljs lacks — legacy `.xls`, `.ods`, `.xlsb`. We only need `.xlsx`, so the off-npm operational cost isn't worth it. If ever adopted, install via a `package.json` `overrides` entry pointing at `https://cdn.sheetjs.com/xlsx-0.20.x/...tgz` (a current, patched build) — **never** the npm `xlsx@0.18.5`. |
| `exceljs@4.4.0` | `read-excel-file` + `write-excel-file` (MIT, more actively maintained) | If you want smaller, currently-maintained packages and minimal export styling; `read-excel-file`'s schema API is a clean Zod pairing. Trade-off: two deps, and plainer exports than developers may expect. |
| `exceljs@4.4.0` | `@protobi/exceljs@4.4.0-protobi.10` (active fork) | If a vuln surfaces in exceljs's transitive deps before upstream moves — it's a drop-in with `archiver@7` and security fixes. Fork = supply-chain trust cost, so treat as a reactive swap, not the default. |
| Hand-rolled SVG editor | `@annotorious/react@3.8.8` (maintained Jul 2026) | If the product ever needs full W3C Web Annotation semantics (comments, tags, multi-user annotation layers) over images. Overkill for "draw a polygon, store its points." |
| Hand-rolled SVG editor | `polygon-annotation@2.0.0` (Konva) | If you deliberately move rendering to a canvas engine for very large/complex scenes. Contradicts the SVG-as-data architecture and the no-game-engine product decision — avoid for hotspots. |
| Plain controlled `<table>` | `@tanstack/react-table@8` (headless) | When the grid genuinely needs client-side sort/filter/column resize/virtualization. Not for ~38 rows. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`xlsx` (SheetJS) from the npm registry** | npm is frozen at **`0.18.5` (2022)** and is no longer maintained there. It carries **CVE-2023-30533** (prototype pollution on **file read** — i.e. exactly our import path) and a ReDoS advisory, both fixed only in ≥0.19.3/0.20.x distributed via `cdn.sheetjs.com`, not npm. Shipping it into a multi-tenant SaaS that parses developer-uploaded files is a known, Dependabot-flagging hole. | `exceljs@4.4.0` (npm, MIT). If SheetJS features are truly required, pin a patched build via `overrides` → `cdn.sheetjs.com`, never the npm tarball. |
| **Unofficial SheetJS npm mirrors** (`@e965/xlsx`, etc.) | Third-party republishes of SheetJS to dodge the CDN. Supply-chain trust risk for a security-conscious, RLS-everywhere codebase where "el código es la carta de presentación." | `exceljs`, or the official CDN override if SheetJS is unavoidable. |
| **Konva / react-konva for hotspots** | A canvas 2D engine — adds weight, contradicts the explicit product decision (renders estáticos + SVG, *sin motor tipo game engine*), and forces canvas-object ↔ SVG-string serialization around a format we already store natively. | Hand-rolled inline `<svg>` + React 19 pointer events. |
| **`react-image-annotate`** | Unmaintained since **2022**, targets React 16, heavy full-screen annotation UI. | Hand-rolled SVG editor (crib patterns from `choutkamartin/image-annotation`). |
| **ag-grid / react-data-grid** for the unit grid | Heavyweight, styling/licensing baggage, and unnecessary for dozens of rows; fights the Tailwind-tokens design system and the page-weight budget. | Controlled `<table>`; `@tanstack/react-table` (headless) only if it grows. |
| **Streaming/worker offload for Excel** | Files are kilobytes / dozens of rows. Streaming APIs and a BullMQ hop add complexity with zero benefit here (unlike the genuinely-heavy PDF job). | Parse inline in a Route Handler (or tRPC mutation), validate row-by-row with Zod, upsert transactionally under `withTenant`. |
| **New tables / migrations for these features** | The v1.1 schema already models units, prices, price lists, leads (with enum/timeline/origen) and hotspot geometry columns. Adding columns risks drift. | Reuse existing tables; a migration is only warranted if a genuinely new field emerges during planning. |

## Version Verification (npm registry, 2026-07-17)

| Package | Version | License | Notes |
|---------|---------|---------|-------|
| `exceljs` | `4.4.0` | MIT | Last published Dec 2024; upstream "inactive" (maintainer on leave) but API-stable and low-risk for this workload. Active fork `@protobi/exceljs@4.4.0-protobi.10` (May 2026) as escape hatch. |
| `xlsx` (SheetJS, npm) | `0.18.5` | Apache-2.0 | **Rejected.** Stale/frozen on npm; CVE-2023-30533 unpatched on this channel. Current builds only on `cdn.sheetjs.com`. |
| `read-excel-file` / `write-excel-file` | `9.3.2` / `4.1.1` | MIT | Actively maintained alternative pair. |
| `@annotorious/react` | `3.8.8` | BSD-3 | Maintained (Jul 2026) but heavyweight W3C annotation framework — mismatch for raw-SVG storage. |
| `polygon-annotation` | `2.0.0` | MIT | Requires `konva`+`react-konva` (canvas) — architectural mismatch. |
| `react-konva` | `19.2.5` | MIT | React 19 compatible (peer `^19.2.0`) — noted only to confirm the canvas route is *available* but not chosen. |
| `@tanstack/react-table` | `8.21.x` | MIT | React 19 compatible; optional, conditional. |

## Sources

- [SheetJS issue #2961 / #3098 / #3316 — 0.18.5 is the last npm build; fixes only via cdn.sheetjs.com](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961) — **HIGH**
- [CVE-2023-30533 — Prototype Pollution in SheetJS, GitHub Advisory GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — affects file **read** (import) path, all CE ≤0.19.2. **HIGH**
- [ReversingLabs — xlsx@0.18.5 vulnerabilities](https://secure.software/npm/packages/xlsx/vulnerabilities/0.18.5) — **HIGH**
- [ExcelJS Discussion #2987 / Issue #2969 — maintenance status "inactive", maintainer on leave](https://github.com/exceljs/exceljs/discussions/2987) — **HIGH**
- [ExcelJS Discussion #3008 — active community fork @protobi/exceljs](https://github.com/exceljs/exceljs/discussions/3008) — **MEDIUM/HIGH**
- npm registry (`npm view <pkg> version license peerDependencies time.modified`), 2026-07-17 — exact versions/peers/licenses of exceljs, @protobi/exceljs, read/write-excel-file, polygon-annotation, react-konva, @annotorious/react, react-image-annotate. **HIGH**
- [definite2/polygon-annotation](https://github.com/definite2/polygon-annotation) + [Annotorious](https://annotorious.dev/getting-started/) + [choutkamartin/image-annotation (SVG polygons, React Hooks)](https://github.com/choutkamartin/image-annotation) — polygon-editor landscape; canvas vs SVG vs W3C-framework trade-offs. **HIGH** (peer deps verified) / **MEDIUM** (fit judgment)
- Local schema inspection: `packages/db/src/schema/{floors,units,leads,unit-prices,price-lists,enums}.ts` — confirmed `poligonoSvg`/`renderKey`, `lead_estado`, `origen`, `timeline`, `unit_prices.precio` (integer), RLS `withTenant` — **HIGH**
