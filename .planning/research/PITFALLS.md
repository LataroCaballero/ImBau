# Pitfalls Research

**Domain:** Self-service admin panel (Excel import/export, SVG polygon editor, leads pipeline + email) on an existing multi-tenant Next.js App Router + tRPC + Drizzle/Postgres-RLS + BullMQ/Redis + Resend SaaS
**Researched:** 2026-07-17
**Confidence:** HIGH (engineering pitfalls are well-established; library/security specifics cross-checked against OWASP + npm advisories 2025-2026; stack integration points derived from this repo's own v1.0-v1.2 decisions)

> Scope note: this milestone (v1.3) adds developer-facing **write** surfaces to a system that until now was mostly read (public quoter + seed). The dominant new risk class is **untrusted structured input reaching integer-money columns and RLS-forced tables through authenticated-but-not-necessarily-authorized users**. Every pitfall below is filtered for "what breaks specifically when bolting these three features onto THIS stack."

## Critical Pitfalls

### Pitfall 1: Float contamination of integer/decimal money columns via Excel import

**What goes wrong:**
Excel cells are IEEE-754 doubles. A price of `USD 185000` can arrive as `184999.9999999998`, and es-AR sheets write `1.850.000,50` or `185.000` where `.` is a thousands separator, not a decimal point. Naive `Number(cell)` or `parseFloat` then `Math.round` silently corrupts the exact-integer-USD / decimal-ARS invariant that `packages/quoting` depends on. A one-peso rounding error in a price list flows into every quote and PDF — the CLAUDE.md line "un error de cálculo acá mata el producto" applies transitively to import.

**Why it happens:**
Developers treat the spreadsheet cell as already-clean. SheetJS/ExcelJS hand back a JS `number` for numeric cells, so the float has *already happened* before your code runs — you never see the string the user typed. Locale ambiguity (`1.234` = one-thousand-two-hundred-thirty-four in es-AR, but 1.234 in en-US) makes any format-guessing heuristic wrong ~half the time.

**How to avoid:**
- Read cells as **raw strings**, not typed numbers. In SheetJS use `sheet_to_json(ws, { raw: false, ... })` or read `cell.w` (formatted text) / `cell.v` deliberately; in ExcelJS inspect `cell.type` and reject `Number`-typed money cells in favor of a text column, OR force the template's money columns to Text format and validate.
- Define an **explicit, documented import template** (fixed column order/headers, money as plain integers USD with NO thousands separators, ARS as decimal string). Reject files that don't match the template rather than guessing locale.
- Parse money with a single shared, tested function (mirror the existing `formatUsd`/`formatArs` discipline — add `parseUsd`/`parseArs`) that: strips only known thousands separators, rejects fractional USD, converts to integer/`numeric` exactly, and throws a typed error (extend the `QuoteError`/domain-error pattern) on ambiguity. Never `parseFloat`.
- Store as the existing integer-USD / `numeric` ARS columns; assert `Number.isInteger` post-parse.

**Warning signs:**
Prices ending in `.9999` or `.0001`; totals off by one peso vs the source sheet; property-based test on round-trip (export → re-import → deep-equal) fails; a client's real sheet with `$` or `.` separators imports as 1000x too large or small.

**Phase to address:**
D1 — Grilla de unidades / Excel import.

---

### Pitfall 2: Partial-import inconsistency — half the rows land, half fail, no atomicity

**What goes wrong:**
An import of 300 units hits a bad row at #180. Without a transaction the first 179 are already committed; the developer re-uploads the fixed file and now has duplicates or a half-updated price list. Or the whole thing runs inside one giant tRPC request that times out at row 250, leaving an indeterminate state and no way to know where it stopped.

**Why it happens:**
"Loop over rows, `INSERT` each" is the obvious implementation. Row-level try/catch feels safe but produces the worst outcome: partial success with no report. Long imports blow the HTTP request budget.

**How to avoid:**
- Two-phase: **validate the entire file first** (parse + per-row schema/business validation, collect ALL errors with row numbers), return a preview/dry-run to the user, and only on confirm run the write.
- Write inside **one Drizzle transaction under `withTenant`** so it's all-or-nothing; the transaction-scoped RLS GUC (`SET LOCAL`) you already use means the whole import is tenant-fenced too. If a client legitimately needs "import the good rows, skip the bad ones," make that an *explicit* mode with a downloadable rejected-rows report — never the silent default.
- For large files, do the write in the **worker (BullMQ)**, not the request, with a job status the panel polls (you already have this exact pattern from quote-PDF: `jobId` dedup, attempts+backoff, poll endpoint). Keep the interactive path for small files.
- Make imports **idempotent** by a stable natural key (unit code within project) with `onConflictDoUpdate` — re-uploading the same file converges instead of duplicating (mirror the seed's `uuidv5` + `onConflictDoNothing` idempotency doctrine).

**Warning signs:**
Duplicate units after a re-upload; "it imported some but then errored"; import endpoint in server logs with multi-second p95; no row-level error report shown to the user.

**Phase to address:**
D1 — Excel import (validation + transaction + worker offload for large files).

---

### Pitfall 3: Formula/CSV injection on export (and macro/oversized files on import)

**What goes wrong:**
- **Export:** A lead's name or a unit note is `=HYPERLINK("http://evil","click")` or `=cmd|'/c calc'!A1`. Exported to CSV/XLSX and opened in Excel/LibreOffice on the developer's machine, it executes — data exfiltration or command execution on the *client's* computer, from data another user (a public lead form) supplied. This is a cross-user attack vector because leads originate from anonymous web visitors.
- **Import:** A malicious/oversized `.xlsx` (zip bomb, billion-laughs XML, 100MB, or a file crafted to trigger prototype pollution in the parser) DoSes the worker or poisons `Object.prototype`.

**Why it happens:**
Export is treated as "just dump the data." The npm `xlsx` (SheetJS CE) package on the public registry is **unmaintained and has known prototype-pollution CVEs** (through 0.19.2; fixes only on SheetJS's own CDN, not npm). No file-size/type gate on upload.

**How to avoid:**
- **Export sanitization:** prefix any cell whose value starts with `=`, `+`, `-`, `@`, tab (`\t`) or CR (`\r`) with a leading `'` (or space), per OWASP CSV Injection guidance. Do it in one shared export helper so no code path forgets. Note: no sanitization is universal across every spreadsheet app — prefer XLSX with cells written as explicit **text type** (ExcelJS lets you set cell type) over raw CSV where possible, and still sanitize.
- **Library choice:** do NOT pull `xlsx` from the public npm registry. Use **ExcelJS** (actively maintained, ~1.9M weekly downloads, streaming reader/writer) or SheetJS pinned from their official CDN. Prefer ExcelJS for this project — it fits the "código es la carta de presentación / no atajos" bar and avoids the stale-npm advisory noise.
- **Import hardening:** enforce max file size (edge + app), validate MIME/magic bytes not just extension, reject `.xlsm`/macros, cap row/column counts, and parse in the **worker** with a memory/time budget so a bad file can't take down the panel process. Use ExcelJS **streaming** reader for large files.

**Warning signs:**
Exported cells beginning with `=`/`+`/`-`/`@`; `npm audit` flagging `xlsx`; no size limit on the upload input; parser running in-process in the panel/web app; a lead name with a formula rendering as a formula in a test export.

**Phase to address:**
D1 — Excel import/export (library choice + sanitization + upload hardening).

---

### Pitfall 4: Role checks enforced only in the UI — RLS proves tenant isolation, NOT authorization

**What goes wrong:**
RLS answers "which org's rows can this session touch," not "may THIS member write." A `viewer` (read-only role you already have: owner/developer/viewer) hits the panel API directly (or via a stale open tab) and edits a price, changes a lead state, or imports a file. RLS happily allows it because the row is in their org — the tenant fence is intact but the *permission* fence never existed on the server. Hiding the Edit button in React is not authorization.

**Why it happens:**
The team (correctly) trusts RLS for isolation and over-generalizes it to authorization. tRPC mutations get a `protectedProcedure` that only checks "logged in + has active org," not role. Optimistic UI hides controls, creating the illusion of enforcement.

**How to avoid:**
- Add a **role gate in the tRPC middleware layer**, not just RLS: a `developerProcedure` / `editorProcedure` that asserts `member.role ∈ {owner, developer}` before any mutation (units, leads-write, hotspots). Better Auth's organization plugin + access-control (`createAccessControl`, the `ac`/roles you already configured) is the source of truth — check it server-side on every write.
- Treat RLS as **defense in depth for isolation**, role-middleware as **authorization**. Both, always. The pragmatic answer is app-layer role checks + existing tenant RLS.
- Write a test matrix: viewer→every mutation must 403; developer→allowed; cross-org→still 404/empty via RLS. Extend the existing cross-tenant absence suite with a **cross-role** suite.

**Warning signs:**
Mutations use only `protectedProcedure`; no test where a `viewer` attempts a write; authorization logic living in `.tsx` components; "we hide the button" cited as the control.

**Phase to address:**
Every write phase (D1, D2, hotspot editor) — establish the role-gated procedure once, early, and reuse.

---

### Pitfall 5: Notification storms & non-idempotent lead emails

**What goes wrong:**
- **Storm:** A broker bulk-imports 200 leads, or a retry loop / at-least-once BullMQ delivery fires the "nuevo lead" email 200+ times in seconds — the developer's inbox is flooded, Resend free-tier daily cap is blown, and the domain reputation drops (spam folder → future real alerts missed).
- **Idempotency:** BullMQ is at-least-once. A job retried after a transient failure sends the *same* lead email twice. State-change emails ("lead pasó a negociación") fire on every save even when the state didn't actually change.

**Why it happens:**
"Send email in the mutation handler" couples email to every write. Retries are assumed to be exactly-once. No dedup key on the send. No debounce/digest for bursts.

**How to avoid:**
- Send via the **worker with an idempotency key** = a natural event id (e.g. `lead:{id}:created` or `lead:{id}:state:{newState}`), and record sends in a table/Redis-set so a retried job is a no-op (same discipline as `jobId=quoteId` for PDFs). Resend also accepts an idempotency key — use it.
- **Only notify on real transitions:** compute old→new state in the handler and enqueue an email only when it actually changed. Never email on idempotent no-op saves.
- **Debounce/batch bursts:** for imports or rapid changes, coalesce into a digest ("5 nuevos leads") with a short delay window rather than one-email-per-row. Rate-limit per-org per-time-window.
- Make email **non-blocking** to the mutation (enqueue, don't await send) — a Resend outage must never fail a lead capture, exactly as the PDF path never blocks the WhatsApp CTA.

**Warning signs:**
Email `send()` called directly inside a tRPC mutation and awaited; no dedup key; duplicate emails after a worker restart; Resend usage graph spiking on imports; emails sent when state is unchanged.

**Phase to address:**
D2 — Bandeja de leads / email notifications.

---

### Pitfall 6: Free-form lead status instead of an enforced state machine

**What goes wrong:**
`leads.status` is a free string or an unguarded enum column. Code (or a future Excel import of leads) sets it to `"Negociacion"`, `"negociación"`, `"NEGOCIACION"`, or skips `nuevo → contactado → negociación → cerrado` illegally (e.g. `cerrado → nuevo`). Metrics (fase 6) and the future "interés repetido" alerts break because the state space is dirty; funnel counts become meaningless.

**Why it happens:**
Status starts as a convenient string. Transitions are done with a bare `UPDATE`. No single authority for legal transitions.

**How to avoid:**
- Model status as a **Postgres enum / CHECK-constrained column** + a Zod enum at the tRPC boundary (derive via drizzle-zod so DB and API can't drift).
- Centralize transitions in one pure function `canTransition(from, to)` (unit-tested, the `packages/quoting`-style purity you already favor) and reject illegal jumps with a typed error. All writes — UI, import, future automation — go through it.
- Record each transition as an `events` row (you already have a partitioned `events` table) so the funnel/alerts have an audit-grade history, not just current state.

**Warning signs:**
`status: text` in the schema; case-variant or accented status values in the DB; a `cerrado` lead reopened silently; metrics phase later discovering unmappable states.

**Phase to address:**
D2 — Bandeja de leads (state machine + enum). Pays off in fase 6 (métricas/alertas).

---

### Pitfall 7: SVG hotspot coordinates tied to pixels instead of the render's intrinsic viewBox

**What goes wrong:**
Polygons are stored as on-screen pixel coordinates captured at editor time (e.g. at 800px wide). On the public explorador (fase 2), the render displays at 375px on a phone or 1440px on desktop and the hotspots drift off the doors/floors they mark. Worse: the editor and the public viewer compute the mapping differently, so what the developer draws isn't what buyers see — a silent WYSIWYG break.

**Why it happens:**
Mouse/touch events give client pixel coords; the naive path stores those directly. Responsive `<img>`/render scaling and `object-fit` letterboxing aren't accounted for. `getBoundingClientRect` at draw time ≠ display box at view time.

**How to avoid:**
- Store polygon points in the **render's intrinsic coordinate space** (the image's natural width/height, or a normalized 0-1000 `viewBox`), never device pixels. Editor and viewer both render an `<svg viewBox="0 0 W H">` overlaid on the image and let the browser scale uniformly — coordinates become resolution-independent by construction.
- Convert pointer events to SVG user space with `getScreenCTM().inverse()` / `DOMPoint`, not manual `clientX - rect.left` math, so zoom/scroll/letterboxing are handled correctly.
- **Share the exact overlay/scaling component** between editor (panel) and viewer (web) so there is one mapping, not two. This is the WYSIWYG guarantee.
- **Touch support:** use Pointer Events (not mouse-only), disable `touch-action`/page-zoom on the canvas, and provide draggable vertex handles large enough for fingers (~44px hit target).

**Warning signs:**
Point values that look like screen pixels (e.g. all < 800); hotspots correct on the dev's monitor but off on mobile; editor and viewer having separate coordinate code; `object-fit: cover` on the render with no letterbox compensation; editor unusable on a touchscreen.

**Phase to address:**
Hotspot editor (this milestone) — but the acceptance test is "correct on the fase-2 public viewer at 3 viewport widths." Coordinate contract must be designed for fase 2 now.

---

### Pitfall 8: No polygon versioning when the background render is replaced

**What goes wrong:**
The developer uploads a new/updated render for a floor (different crop, angle, or resolution). All existing hotspots now point at the wrong places, or reference the old image. If polygons store no link to *which* media/version they were drawn against, there's no way to detect staleness — buyers see hotspots floating over the wrong units, or the panel silently keeps old coords over a new image.

**Why it happens:**
Hotspots are treated as belonging to "the floor" abstractly, not to "this specific render asset." Render replacement is an afterthought; media (`media` table, R2 variants) already versions images but hotspots don't reference the version.

**How to avoid:**
- Bind each hotspot set to a **specific `mediaId`/render version** (foreign key). When the underlying media changes, mark hotspots as **stale/needs-review** rather than auto-applying old coords — surface a warning in the editor.
- Because coords are normalized to the render's own space (Pitfall 7), a *same-framing* re-upload can carry over; a *re-framed* upload should force re-draw. Detect via dimension/aspect change.
- Version hotspot data (migrations + a `version` or `updated_at`), never overwrite silently; keep an audit trail (see Pitfall 10).

**Warning signs:**
Hotspots table with only `floorId`, no `mediaId`; replacing a render leaves stale hotspots with no flag; no "needs review" state after media change.

**Phase to address:**
Hotspot editor (data model — media linkage + staleness flag).

---

### Pitfall 9: Optimistic UI that lies when the server (RLS or role) rejects

**What goes wrong:**
The panel shows a price/state change as saved (optimistic update) but the server write is rejected — by a role gate (viewer), an RLS policy (`42501`), a stale `activeOrganizationId`, or a validation error. The user believes it saved; the real data diverges. Especially dangerous for prices: the developer thinks a unit is USD 190k, buyers still get quoted 185k.

**Why it happens:**
TanStack Query optimistic mutation without a proper `onError` rollback + no re-fetch of truth; assuming writes always succeed; RLS/role rejections treated as unexpected 500s rather than expected, surfaced states.

**How to avoid:**
- Every optimistic mutation must implement **rollback on error + invalidate/refetch** the affected query so the UI reconverges to server truth. TanStack Query v5 (already in the stack) supports this — use it consistently.
- Map server rejections to **clear user messages**: RLS `42501` and role-403 → "no tenés permiso / tu sesión cambió de organización," validation → field-level errors. Don't leak raw SQL/Sentry noise; do log to Sentry+pino (the errors-observable constraint).
- For money, consider **confirm-then-commit** (not optimistic) — a price is high-stakes enough to prefer a definite "guardado" over a snappy lie.

**Warning signs:**
Mutations with `onMutate` but no `onError` rollback; no `invalidateQueries` after settle; RLS/permission errors surfacing as generic "algo salió mal"; price shown as saved but DB unchanged.

**Phase to address:**
All write phases (D1/D2/hotspots) — establish the mutation pattern once.

---

### Pitfall 10: Missing audit trail for panel mutations

**What goes wrong:**
A price changes, a lead is reassigned or closed, hotspots are redrawn — and there's no record of who/when/what-before. When a buyer disputes a quoted price, or a broker's lead "disappears," or a wrong bulk import corrupts a price list, there's no way to reconstruct or roll back. For a money/sales product with multiple members per org, this is both an operational and trust gap.

**Why it happens:**
Audit logging is "later." The `events` table exists (for analytics) but write mutations don't emit to it. `updated_at` alone doesn't capture who or the prior value.

**How to avoid:**
- Emit an **audit event on every consequential mutation** (price change, status transition, import, hotspot edit) with actor (member id), org, before/after, timestamp — reuse the partitioned `events` table or a dedicated `audit_log`. This also feeds fase-6 metrics and the "interés repetido" alerts for free.
- Do it in the tRPC mutation layer (one shared helper), inside the same transaction as the write, so audit can't diverge from reality.
- Keep the actor from the authenticated session, never from client input.

**Warning signs:**
No before-value stored on price/status changes; "who changed this?" is unanswerable; import overwrote a price list with no snapshot; audit written outside the write transaction.

**Phase to address:**
D1 + D2 (establish the audit helper); enrich in fase 6.

---

### Pitfall 11: Self-intersecting / degenerate polygons accepted as valid

**What goes wrong:**
The editor lets the developer draw a bowtie (self-intersecting), a <3-point "polygon," a zero-area sliver, or points outside the image bounds. Point-in-polygon hit-testing on the public viewer then behaves erratically (SVG even-odd vs nonzero fill gives holes; hit areas are wrong), and click targets don't match the visible shape.

**Why it happens:**
No geometric validation on save; "if it draws, it's fine." Touch drawing produces accidental tiny/duplicate points.

**How to avoid:**
- Validate on save: **≥3 distinct points, no self-intersection, non-zero area, all points within the render bounds** (0-W, 0-H / 0-1000 normalized). Reject with a clear editor message.
- Snap/dedupe near-coincident points (touch jitter); offer close-path + minimum-vertex-distance.
- Decide and document the fill rule (`fill-rule: evenodd` vs `nonzero`) and use the same in editor preview and viewer so what's drawn is what's clickable.

**Warning signs:**
Hotspots with 1-2 points or duplicate coords in the DB; buyer clicks inside the visible shape but nothing triggers; bowtie shapes render with unexpected holes.

**Phase to address:**
Hotspot editor (validation on save).

---

### Pitfall 12: Encoding / es-AR locale corruption on import and export

**What goes wrong:**
CSV exports/imports mangle `á é í ó ú ñ ü` and `°`/`m²` — the developer's LibreOffice/Excel saves Latin-1 (Windows-1252) or CP1252, your parser assumes UTF-8 (or vice versa), and "Ñuñoa"/"3° piso"/"45 m²" become mojibake. Dates are `DD/MM/YYYY` in es-AR but parsed as `MM/DD` → `05/03/2026` silently becomes March 5 instead of May 3. Timezone: dates entered as local Buenos Aires get stored as UTC-shifted (off by a day near midnight).

**Why it happens:**
CSV has no encoding header; Excel-on-Windows defaults to the system codepage. `new Date("05/03/2026")` uses the runtime's locale. The repo already mandates UTC-in-DB / render-in-`America/Argentina/Buenos_Aires` but import code is a new surface that can forget it.

**How to avoid:**
- Prefer **XLSX over CSV** for round-trips (XLSX is UTF-8 internally, no codepage ambiguity) — another reason to standardize on ExcelJS. If CSV must be supported, write a UTF-8 BOM on export and detect encoding on import, rejecting ambiguous files.
- Parse dates with an **explicit `DD/MM/YYYY` format** (a date library with a fixed locale/format string), never the bare `Date` constructor. Validate and echo the parsed date back in the preview (Pitfall 2's dry-run) so the user catches a mis-parse.
- Convert Buenos Aires input → UTC on store, render back with the existing es-AR/`America/Argentina/Buenos_Aires` helpers. Reuse the established formatter discipline.

**Warning signs:**
Mojibake in unit names/notes after import; dates off by one day or month/day swapped; export opens with garbled accents in Excel; no explicit date-format in parse code.

**Phase to address:**
D1 — Excel import/export (encoding + date/timezone handling).

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Parse Excel numbers with `Number(cell)`/`parseFloat` | Fast to write | Float-corrupted prices feed every quote; near-undetectable | **Never** for money columns |
| Row-by-row insert with per-row try/catch | "Skips bad rows" | Partial imports, duplicates, no error report, no atomicity | Only as an *explicit* opt-in mode with a rejected-rows report |
| Import synchronously inside the tRPC request | Simple, no worker wiring | Timeouts on large files, no progress, blocks the panel | Small files (<~few hundred rows) with a hard row cap |
| `protectedProcedure` only (no role check) on mutations | Less middleware | Viewer can write; authorization gap masked by hidden UI | **Never** — add role gate once, reuse |
| Store hotspots in screen pixels | Matches mouse events directly | Drift across viewports; WYSIWYG break vs public viewer | **Never** — normalize to viewBox |
| `leads.status` as free text | Flexible now | Dirty state space breaks funnel + fase-6 alerts | **Never** — enum + state machine |
| Send lead email inline in the mutation (awaited) | One less moving part | Resend outage fails lead capture; retries duplicate | **Never** — enqueue, dedup key |
| `xlsx` (SheetJS CE) from public npm | Familiar API | Unmaintained, prototype-pollution CVEs, audit noise | **Never** — use ExcelJS |
| No audit trail (rely on `updated_at`) | Ship faster | Can't answer "who/what-before"; no rollback on bad import | MVP-only if a `beforeValue` snapshot is captured for money at minimum |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **ExcelJS / SheetJS** | Reading money cells as typed numbers (float already happened); using unmaintained npm `xlsx` | ExcelJS; read money as text; validate; stream large files in the worker |
| **Postgres RLS** | Assuming RLS = authorization; forgetting `withTenant` on the import transaction | RLS for isolation + app-layer role gate for authz; run import inside one `withTenant` tx |
| **BullMQ (imports & emails)** | Treating at-least-once as exactly-once → duplicate emails/writes | Idempotency key per event (`lead:{id}:{event}`, `import:{fileHash}`); dedup table/set |
| **Resend** | Awaiting send in the mutation; no dedup/idempotency key; blowing free-tier on imports | Enqueue in worker, non-blocking; Resend idempotency key; debounce/digest bursts |
| **Better Auth org plugin** | Not re-checking `member.role` server-side; trusting `activeOrganizationId` from client | Server-side role check via `ac`/access-control on every write; org id from session only |
| **TanStack Query v5** | Optimistic update with no `onError` rollback / no invalidate | Rollback + `invalidateQueries` on settle; map RLS 42501 / role-403 to clear messages |
| **SVG pointer events** | `clientX - rect.left` math ignoring scaling/letterbox; mouse-only (no touch) | `getScreenCTM().inverse()` + `DOMPoint`; Pointer Events; `<svg viewBox>` for uniform scaling |
| **Sentry + pino** | Logging RLS/role rejections as 500 noise, or swallowing them | Classify expected rejections as 4xx (surfaced), unexpected as errors; never silence |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-file parse in memory (non-streaming) | Panel/worker RAM spike, OOM on the tight-RAM staging VPS | ExcelJS streaming reader; row/size caps | Files >~10k rows or on the shared low-RAM VPS |
| Synchronous import in the request | Timeouts, no progress UI | Offload to worker + poll status | A few hundred+ rows |
| Email-per-row on bulk import | Resend rate-limit/free-tier hit, inbox flood | Debounce/digest, per-org rate limit | Any bulk lead import (10s+) |
| Re-rendering all hotspots on every pointer move | Editor lag on floors with many polygons | Throttle, render active polygon only, memoize | Floors with dozens of hotspots on mobile |
| N+1 on leads inbox (join origin per row) | Slow inbox as leads grow | Single query with joins; paginate | Hundreds+ leads per org |
| Loading full-res render in the editor | Slow editor load, mobile jank | Use the existing R2 AVIF/WebP variants, not the original | Large renders on 4G |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No formula sanitization on export | CSV/formula injection executes on the developer's/broker's machine (data from anon leads) | Prefix `= + - @ \t \r` cells with `'`; prefer text-typed XLSX cells |
| Trusting file extension, no size/type/magic check | Zip bomb / oversized / macro file DoSes or exploits the parser | Validate magic bytes + MIME, size cap (edge + app), reject macros, parse in worker |
| Viewer/role not enforced server-side | Read-only member edits prices/leads/hotspots | Role-gated tRPC procedure on every mutation |
| `activeOrganizationId` or `orgId` from client input | Cross-tenant write attempt (RLS should block, but never rely on client) | Derive org from session; RLS as backstop; test cross-tenant writes |
| Prototype pollution via unmaintained `xlsx` | RCE/DoS from a crafted file | ExcelJS (or CDN-pinned SheetJS); `npm audit` gate in CI |
| Leaking raw SQL/RLS errors to the client | Info disclosure; confusing UX | errorFormatter exposes only safe codes (you already do this for quotes); log detail to Sentry |
| No rate limit on lead/import endpoints | Abuse floods leads/emails | Reuse the existing nginx edge rate-limit pattern for new anon/write surfaces |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Import with no dry-run/preview | Developer discovers errors only after data is changed | Validate-all → preview with per-row errors → confirm → commit |
| Optimistic "saved" that silently failed | Developer trusts wrong prices; buyers quoted stale numbers | Rollback + refetch; confirm-then-commit for money |
| No visible row-error report on partial import | "Some imported, some didn't" with no why/where | Downloadable rejected-rows report with row numbers + reasons |
| Editor WYSIWYG ≠ public viewer | Hotspots drift; developer can't trust what buyers see | Shared overlay component; preview at mobile width in the editor |
| Email on every save (incl. no-op) | Notification fatigue → real alerts ignored | Notify only on real transitions; digest bursts |
| Illegal status jumps allowed in UI | Dirty funnel; confusing pipeline | Offer only legal next-states from the state machine |
| No "hotspots need review" after render swap | Stale hotspots ship to buyers unnoticed | Staleness flag + review prompt on media change |

## "Looks Done But Isn't" Checklist

- [ ] **Excel import:** Often missing round-trip integrity — verify export→re-import→deep-equal on money (property-based test), and that es-AR `1.850.000` / accented text / `DD/MM/YYYY` survive.
- [ ] **Excel import:** Often missing atomicity — verify a mid-file failure rolls back everything (transaction) and produces a row-level error report.
- [ ] **Excel export:** Often missing formula-injection sanitization — verify a lead named `=cmd|...` exports as inert text.
- [ ] **Role authz:** Often missing server-side enforcement — verify a `viewer` gets 403 on *every* mutation (units, leads, hotspots), not just a hidden button.
- [ ] **Lead email:** Often missing idempotency — verify a retried/duplicate job sends exactly one email, and no email on unchanged state.
- [ ] **Lead status:** Often missing state-machine enforcement — verify illegal transitions (`cerrado → nuevo`) are rejected server-side.
- [ ] **Hotspot editor:** Often missing viewport independence — verify a polygon drawn in the editor lands correctly on the public viewer at 375px, 768px, 1440px.
- [ ] **Hotspot editor:** Often missing render-version binding — verify replacing a floor render flags hotspots as needs-review.
- [ ] **Hotspot editor:** Often missing geometry validation — verify a self-intersecting / <3-point polygon is rejected.
- [ ] **Optimistic UI:** Often missing rollback — verify a forced RLS/role rejection reverts the UI and shows a clear message.
- [ ] **Audit trail:** Often missing before-value — verify a price change records who/when/old→new.
- [ ] **v1.2 debt (pre-req):** Often missing staging re-verification — verify 429 rate-limit, full PDF flow, and QR-with-staging-URL after merge to main (explicitly listed as this milestone's first task).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Float-corrupted prices already imported | HIGH | Requires the audit trail / before-values to restore; re-import from a clean template; add `parseUsd`/property test to prevent recurrence. Without audit → manual reconstruction from the source sheet. |
| Partial import left inconsistent state | MEDIUM | If wrapped in a tx: nothing to recover. If not: use idempotent natural-key re-import to converge; delete orphan rows by import batch id. |
| Formula injection shipped in exports | LOW | Add sanitization helper, redeploy; notify anyone who opened an export. |
| Viewer performed unauthorized writes | MEDIUM | Add role gate; use audit trail to identify + revert changes; without audit → hard to detect scope. |
| Duplicate lead emails sent | LOW | Add idempotency key + dedup store; apologize if severe; tighten rate limit. |
| Hotspots drifted across viewports | MEDIUM | Migrate stored coords to normalized viewBox space (script if uniform scale factor known); otherwise re-draw affected floors. |
| Dirty lead status values | MEDIUM | One-off migration mapping variants → canonical enum; add CHECK + state machine to prevent recurrence. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Float money contamination | D1 (Excel import) | Property test: export→re-import→deep-equal on prices; `Number.isInteger` asserts |
| Partial-import inconsistency | D1 | Force a mid-file error in a test → assert full rollback + error report |
| Formula injection / malicious file | D1 | Export a `=`-prefixed value → assert inert; oversized/macro file → assert rejected |
| Encoding / es-AR date-locale | D1 | Import accented + `DD/MM/YYYY` fixture → assert exact round-trip; date not swapped |
| Role authz (viewer can't write) | D1 (establish), reused D2 + hotspots | Cross-role test matrix: viewer→403 on every mutation |
| Notification storms / email idempotency | D2 (leads) | Retry a send job → exactly one email; bulk import → digest not N emails |
| Free-form status vs state machine | D2 | Illegal transition → typed rejection; enum/CHECK in migration |
| Optimistic UI vs RLS/role rejection | D1/D2/hotspots | Force 42501/403 → assert UI rollback + clear message |
| Audit trail | D1/D2 (establish), fase 6 (enrich) | Price/status change → assert audit row with actor + old/new |
| Hotspot coordinate/viewport | Hotspot editor (contract for fase 2) | Draw in editor → correct on viewer at 3 widths |
| Hotspot render-version staleness | Hotspot editor | Replace render → hotspots flagged needs-review |
| Self-intersecting polygon validation | Hotspot editor | Bowtie / <3 points → rejected on save |
| v1.2 staging debt | Milestone pre-req (first) | 429 burst, PDF e2e, QR URL verified on live staging |

## Sources

- [OWASP — CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) + [OWASP WSTG — Testing for CSV Injection](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/21-Testing_for_CSV_Injection) — formula-injection trigger chars (`= + - @ \t \r`), prefix mitigation and its limits. **HIGH**
- [Snyk — Prototype Pollution in xlsx (CVE-2023-30533)](https://security.snyk.io/vuln/SNYK-JS-XLSX-5457926) + [SheetJS issue #3316 — npm registry lag](https://git.sheetjs.com/sheetjs/sheetjs/issues/3316) — npm `xlsx` unmaintained, CVEs through 0.19.2, fixes only on SheetJS CDN. **HIGH**
- [ExcelJS — npm](https://www.npmjs.com/package/exceljs) + [exceljs.org](https://exceljs.org/) — maintained alternative, streaming reader/writer, cell type control (~1.9M weekly downloads). **HIGH**
- This repo's own decisions (PROJECT.md, CLAUDE.md): integer-USD/decimal-ARS money rule, RLS FORCE + `withTenant`/`SET LOCAL` GUC, `jobId`-dedup BullMQ pattern (quote-PDF), seed `uuidv5` idempotency, es-AR formatters, owner/developer/viewer roles via Better Auth org plugin, errorFormatter exposing only safe codes, nginx edge rate-limit. **HIGH** (primary source)
- MDN — SVG `getScreenCTM`, `viewBox`, `DOMPoint`, Pointer Events coordinate mapping (established API knowledge). **HIGH**
- Engineering-common knowledge on IEEE-754 in spreadsheets, es-AR number/date locale, BullMQ at-least-once semantics, TanStack Query v5 optimistic rollback. **MEDIUM/HIGH** (cross-checked against stack docs already pinned in CLAUDE.md)

---
*Pitfalls research for: self-service admin panel (Excel import/export, SVG polygon editor, leads pipeline + email) on multi-tenant Next.js + tRPC + Drizzle-RLS + BullMQ + Resend*
*Researched: 2026-07-17*
