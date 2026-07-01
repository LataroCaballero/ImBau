# Pitfalls Research

**Domain:** Argentine financial quoting engine (CAC-adjusted installments) added to an existing multi-tenant Next.js/Drizzle/BullMQ SaaS
**Researched:** 2026-07-01
**Confidence:** HIGH (grounded in the committed v1.1 schema) / MEDIUM on external specifics (Alpine fonts, ICU spacing, wa.me limits)

> **Scope note:** These are pitfalls specific to *adding the cotizador (P4) on top of the already-shipped v1.1 schema*. The money-column types, the tenant-private RLS posture of `cac_index`/`quotes`, and the versioned `snapshot` envelope are already committed — several pitfalls below are consequences of those exact decisions, not hypotheticals.
>
> **Load-bearing schema facts (verified in `packages/db/src/schema/`):**
> - `unit_prices.precio` → **`integer`** (USD whole units). `payment_plans.refuerzos[].montoUsd` → **`integer`**. `payment_plans.cuotas` → **`integer`**.
> - `payment_plans.anticipoPct` → **`numeric`** and `cac_index.valor` → **`numeric(12,4)`** → **Drizzle/`postgres.js` return these as JS `string`, not `number`.**
> - `cac_index` is **TENANT-PRIVATE**: only a tenant policy for the app role, **NO anon policy, NO anon GRANT** → an anon SELECT raises `42501`.
> - `quotes` is **TENANT-PRIVATE**: **NO anon policy, NO anon insert** → the public web cannot insert a quote via the `anon` role.
> - `quotes.snapshot` is a versioned envelope `{ version: 1 }` with a `.passthrough()` interior owned by `packages/quoting`; `pdfKey` and `leadId` are nullable.

## Critical Pitfalls

### Pitfall 1: Float contamination at the numeric-string boundary (Drizzle returns `numeric` as string)

**What goes wrong:**
`anticipoPct` and `cac_index.valor` come back from the DB as **strings** (`"30"`, `"1234.5600"`). The reflex is `parseFloat(row.valor)` or `Number(row.anticipoPct)`, then `precio * (anticipoPct/100)` and `saldo * cacMes/cacBase`. Now the whole "dinero en enteros, nunca floats" rule is silently violated: `0.1 + 0.2` errors accumulate across 60 installments and the total drifts a few cents/dollars from `precio`.

**Why it happens:**
The columns *look* numeric and TypeScript happily coerces `string → number`. The float only leaks at the CAC ratio and the percentage steps — the integer columns (`precio`, `montoUsd`) lull you into thinking the engine is float-free when the multipliers aren't.

**How to avoid:**
- Do the engine's internal math in a **decimal / integer-scaled domain**: keep `precio` and `montoUsd` as integers; represent `anticipoPct` as basis points (integer) or run a decimal library (`decimal.js`/`big.js`) at every ratio step; carry the CAC ratio as a decimal, never a float.
- Parse `numeric` strings with the decimal library **directly from the string** (`new Decimal(row.valor)`), never through `parseFloat` — going through `number` is the contamination.
- Assert engine boundary types: the engine input should be `bigint`/integer/`Decimal`, and there should be no `number` in money positions. A lint/type rule (branded `Usd` / `Cents` type) makes float positions un-typable.
- Property test: `sum(anticipo + cuotas + refuerzos) === precioTotal` must hold **exactly** for all generated plans (see Pitfall 4).

**Warning signs:**
`parseFloat`/`Number(...)` around price/CAC values; totals that are off by cents; snapshot totals that don't reconstruct `precio`; test tolerances like `toBeCloseTo`.

**Phase to address:** Engine (`packages/quoting`) — this is the founding invariant of the package.

---

### Pitfall 2: Installment rounding — nobody owns the remainder cent, so the sum ≠ the balance

**What goes wrong:**
`saldo / cuotas` rarely divides evenly. Naive `round(saldo/cuotas)` per installment makes N equal installments whose sum is `saldo ± a few units`. Displayed 60× "US$ 1.667" implies 100.020 but the balance was 100.000 — the cotización doesn't foot. Buyers and Pablo *will* add up the cuotas.

**Why it happens:**
Integer division + independent per-row rounding has no rule for where the remainder goes. Developers round each installment identically and never reconcile against the total.

**How to avoid:**
- Pick an explicit **remainder allocation rule** and encode it as a named invariant: e.g. base installment = `floor(saldo/cuotas)`, distribute the `saldo mod cuotas` remaining units one-per-installment to the **first k** installments (or all to the last — decide and document). The rule must be a pure function with its own test.
- Hard invariant (property test): `anticipo + Σcuotas + Σrefuerzos === precioTotal` for **every** input, exactly, no tolerance.
- Do the same for the CAC-adjusted **peso** amount of the first cuota — rounding to whole pesos (ARS, no centavos per CLAUDE.md) must also foot.
- Keep the rule in the snapshot semantics so a re-render reproduces the identical breakdown.

**Warning signs:**
UI shows N identical installments; no test named for "remainder"/"resto"; `Σcuotas !== saldo`; a `toBeCloseTo` anywhere in the money suite.

**Phase to address:** Engine.

---

### Pitfall 3: CAC index staleness / missing month — engine silently uses the wrong (or a fabricated) index

**What goes wrong:**
`cac_index` is a **manual monthly load** (one value per org per período, e.g. `"2026-06"`). If June isn't loaded yet and a quote is generated in June, the engine either (a) throws mid-quote, (b) silently falls back to May, or (c) worst: interpolates/extrapolates a "current" CAC. Any silent fallback produces a quote with an index that doesn't match the leyenda — a correctness *and* trust failure.

**Why it happens:**
The index is human-maintained and lags; the engine treats "latest row" as "current month" without asserting the período actually equals the quote's month.

**How to avoid:**
- The engine takes the CAC value as an **explicit input** (it's already designed pure/no-I/O) — the *caller* resolves "which período" and must **fail loudly** if the required período row is absent. No implicit "latest".
- Define policy explicitly: a CAC plan quotes the **cuota inicial en pesos al valor del mes vigente** with a leyenda — so the contract is "value of the load-month", and a missing month is a hard error surfaced to the panel ("cargá el CAC de junio"), never a silent substitution.
- Snapshot must record `{ periodo, valor }` used, so the quote is self-describing regardless of later loads.
- Add a panel/health signal: "CAC del mes no cargado" before it blocks a sale.

**Warning signs:**
Engine reads "most recent" CAC without comparing período to the quote date; no error path for a missing month; quotes generated at month-start silently using last month.

**Phase to address:** CAC-index resolution (caller/panel) + Engine input contract. Add a panel warning for the missing month.

---

### Pitfall 4: Property-based tests that test the implementation, game coverage, or use weak generators

**What goes wrong:**
The 100%-coverage gate is met with example tests plus a couple of `fc.property` runs over `fc.integer()` in a narrow range — so the suite is green, coverage is 100%, and the remainder-cent / large-cuota / zero-anticipo / all-refuerzos cases were never generated. Or the property test re-implements the engine's arithmetic as the "oracle" (tests the code against itself). Or a `/* c8 ignore */` hides a branch to hit the gate.

**Why it happens:**
100% line coverage is easy to reach without exercising *value* edge cases; property tests are hard to write as true invariants, so people default to "run the function, assert it equals a re-derived number".

**How to avoid:**
- Test **invariants, not recomputation**: (1) totals foot exactly; (2) monotonicity (more anticipo → smaller saldo → smaller cuotas); (3) `anticipoPct ∈ [0,100]`, `cuotas ≥ 1`, refuerzos sum ≤ saldo — reject out-of-domain; (4) determinism (same input → byte-identical snapshot); (5) no cuota is negative or zero when saldo>0.
- Use **realistic, adversarial generators**: prices up to millions of USD, `cuotas` up to 120+, `anticipoPct` at 0 and 100 boundaries, refuerzos that consume the whole balance, CAC ratios far from 1.
- Coverage gate is **necessary, not sufficient** — forbid `c8 ignore` in `packages/quoting`; review that branches are covered by *meaningful* assertions, not just execution.
- Seed/shrink reporting on so CI prints the failing case.

**Warning signs:**
Property body recomputes the formula; generators are `fc.nat()` with no `max`; `c8 ignore` comments; coverage 100% but few `assert`/`expect` per test.

**Phase to address:** Engine (test suite is part of the deliverable).

---

### Pitfall 5: The anon public web cannot read CAC or write quotes — wrong-layer integration attempt

**What goes wrong:**
The cotizador lives on the **public (anon) web**, but `cac_index` and `quotes` are **tenant-private** (no anon policy). The instinct is to fetch CAC and insert the quote from the public client via the `anon` role → every call raises `42501` and looks like an RLS bug. The "fix" people reach for is disastrous: add an anon SELECT policy to `cac_index` (leaks every tenant's index) or an anon INSERT to `quotes` (opens spam/PII writes), or run the public path with the app/owner pool (bypasses tenant isolation entirely).

**Why it happens:**
The public web only has the `anon` grant; the quoting inputs deliberately don't. The layering (compute + persist on the **server**, scoped to the project's org) isn't obvious from the client's vantage point.

**How to avoid:**
- Compute and persist **server-side**: a tRPC route/server action running in a **transaction scoped to the target project's organization** (`SET LOCAL app.current_organization_id = <org of the published project>`), using the app role — not the anon browser role, not the owner pool. The public visitor triggers it; the server resolves the org from the published project and runs with that tenant's GUC.
- **Do not** add anon policies to `cac_index` or `quotes`. Keep them tenant-private (as committed). The only anon-readable pricing inputs are `unit_prices`/`payment_plans` (published-only), which is enough to *display*; the authoritative compute + snapshot happen server-side.
- Treat the quote-generation endpoint as an **anonymous write funnel**: validate with Zod, rate-limit at the edge (see Pitfall 6), and never trust client-supplied prices/CAC — the server re-reads them.

**Warning signs:**
`42501` on the cotizador path; a migration adding `anon` to `cac_index`/`quotes`; the public request using `DATABASE_URL`/owner pool instead of the app pool with a project-scoped GUC; prices/CAC coming from the request body.

**Phase to address:** Persistence / API wiring (server-side quote endpoint). This is the #1 integration pitfall for this milestone.

---

### Pitfall 6: Anonymous quote spam, PII in snapshots, and unbounded quote/lead writes

**What goes wrong:**
A public "generate quote" endpoint that persists a snapshot per call is a free write amplifier: a bot generates thousands of quotes (and PDFs — see Pitfall 8), filling the table and the worker queue. Separately, if the quote captures buyer name/phone (for the WhatsApp hand-off) and that lands in `snapshot` JSONB, you've put **PII in an audit blob** that's hard to redact and may not need to be there.

**Why it happens:**
modelo-mvp.md §3.3 explicitly allows anonymous inserts for `events`/`leads` with edge rate-limiting — the same discipline must extend to the quote funnel, but quotes are a heavier write and easy to forget. PII creeps into the snapshot because it's convenient to stuff everything in one JSONB.

**How to avoid:**
- **Rate-limit the quote endpoint** (per-IP / per-session, edge middleware + Zod validation) exactly like `leads`/`events`. Note: staging uses **nginx (not Traefik)** per D-01 — the CLAUDE.md "Traefik rate-limit middleware" doesn't exist there; implement the limit in nginx (`limit_req`) and/or app-level (Redis token bucket) so it's real on staging, not just in the design doc.
- Decide deliberately whether a public compute even needs to **persist**: consider persisting the snapshot only when the visitor commits (opens WhatsApp / leaves contact → becomes a `lead`), and computing ephemerally otherwise. Reduces spam surface and PII.
- Keep the **snapshot PII-free**: `snapshot` = financial inputs/outputs + engine version. Buyer contact belongs in `leads` (which already models contact + `quote?`), linked via the nullable `quotes.leadId`, not embedded in the audit envelope.
- Cap PDF generation to committed quotes, not every compute.

**Warning signs:**
No rate limit on the quote route; buyer name/phone appearing inside `snapshot`; a PDF job enqueued on every keystroke/compute; quote table growth uncorrelated with leads.

**Phase to address:** Persistence + edge/rate-limit config (nginx-aware). PII decision at snapshot design time.

---

### Pitfall 7: Snapshot drifts from what's rendered — re-render uses live data instead of the frozen snapshot

**What goes wrong:**
The quote is stored as a snapshot, but the PDF/UI re-render **re-reads live** `unit_prices`/`cac_index`/`payment_plans` (or re-runs the current engine) instead of rendering *from the snapshot*. Weeks later the price changed or the engine formula changed, and the "same" quote now shows different numbers than the buyer saw / the PDF says. Auditability — the whole point of the snapshot — is lost.

**Why it happens:**
It's easier to call the engine again with IDs than to render a stored blob; and the snapshot interior is `.passthrough()` (open shape), so nothing forces the renderer to consume it faithfully.

**How to avoid:**
- **One source of truth for rendering: the snapshot.** UI result screen, PDF, and WhatsApp text all format **from the persisted snapshot object**, never from a fresh engine run or a live DB read. Compute once, freeze, render many.
- Store enough in the snapshot to render everything (per-installment breakdown, anticipo, refuerzos, CAC período+valor, totals, currency labels) so no live lookup is needed.
- **Bump `version` on every engine change** and store `engineVersion` in the snapshot. A renderer must be able to read old versions (or explicitly refuse) — never reinterpret v1 data with v2 math.
- Test: given a stored snapshot, PDF text and UI totals are derived purely from it (golden-file / snapshot test), independent of current DB rows.

**Warning signs:**
PDF/worker code that imports the engine and recomputes from IDs; renderer reads `unit_prices` at render time; `version` never incremented across formula changes; two quotes with the same inputs but different stored numbers after a price edit.

**Phase to address:** Persistence (snapshot shape) + PDF + UI (all render-from-snapshot).

---

### Pitfall 8: PDF-in-worker — Alpine fonts, memory/timeouts, and retries that duplicate PDFs

**What goes wrong:**
Three distinct failures stack up in the BullMQ worker (Node **Alpine** image):
1. **Fonts/accents:** If the PDF is rendered via headless Chromium (Puppeteer), Alpine has no bundled fonts → Spanish accents (á é í ó ú ñ) and the `US$`/`$` glyphs render as tofu/□, or Chromium won't launch (musl vs glibc, missing `chromium` apk). If via a JS PDF lib (pdfkit/@react-pdf), the default font may lack Latin-Extended glyphs → accents drop.
2. **Memory/timeout:** Chromium in a small VPS container is heavy; concurrent PDF jobs OOM-kill the worker or exceed the job timeout, leaving jobs stuck.
3. **Retry duplication:** BullMQ **retries on failure**; a job that generated the PDF, uploaded to R2, but timed out before acking will **re-run and create a second PDF** (and possibly a second `pdfKey`), or double-charge the queue. Non-idempotent side effects on retry.

**Why it happens:**
Alpine ships minimal; PDF rendering is the heaviest thing the worker does; and BullMQ's at-least-once semantics meet a non-idempotent upload.

**How to avoid:**
- **Fonts:** If Chromium, install `chromium` + `font-noto`/`ttf-freefont`/`fontconfig` in the image and set the Puppeteer executable path; verify accents render in a smoke test. Prefer a **pure-JS PDF path** (e.g. pdfkit/@react-pdf with an **embedded** font that includes Latin-Extended, like Noto/Inter) to avoid Chromium in Alpine entirely — lighter memory, no browser deps. Add a CI/worker test that asserts "ácéíóúñ US$" round-trips visibly (render → extract text).
- **Memory/timeout:** bound worker **concurrency** for PDF jobs, set a realistic job timeout, and size the container; the media pipeline (sharp) already runs here — don't let PDF + sharp contend unbounded.
- **Idempotency:** make the PDF job **idempotent by `quoteId`** — deterministic R2 key (`quotes/{quoteId}.pdf`), upsert/overwrite, and set `pdfKey` in a way that a retry produces the *same* object, not a new one. The v1.1 media pipeline already established "deterministic key + overwrite on re-run" (D-04) — reuse that pattern.
- Errors observable (Sentry + pino) — never a silently swallowed PDF failure.

**Warning signs:**
Tofu/□ in generated PDFs; Chromium launch errors in Alpine logs; worker OOM/restarts under load; two R2 objects for one quote; `pdfKey` changing on retry.

**Phase to address:** PDF worker phase. Font/idempotency are the load-bearing bits.

---

### Pitfall 9: es-AR formatting wrong — `1,234.56` instead of `1.234,56`, and Node-vs-browser ICU spacing

**What goes wrong:**
Two levels:
1. **Locale wrong:** numbers formatted with default/`en-US` grouping show `1,234.56` (US) instead of the Argentine `1.234,56` — thousands `.`, decimals `,`. Peso vs dólar labels get mixed (`$` for ARS vs `US$`/`USD` for dollars — Argentines read `$` as pesos; showing `$ 100.000` for a USD price is a serious misread).
2. **ICU spacing drift:** `Intl.NumberFormat('es-AR', { style:'currency' })` inserts a **narrow no-break space (U+202F/U+00A0)** between the symbol and the number, and the exact symbol/spacing **changed across ICU versions** (documented: currency spacing shifted on Node's ICU bumps). So the string rendered in the **browser** (one ICU version) differs from the **worker/Node** PDF (another ICU version), and naive test assertions (`expect(s).toBe("US$ 1.234,56")` with a normal space) fail or, worse, UI and PDF disagree by an invisible character.

**Why it happens:**
Default `toLocaleString()`/no locale → runtime locale. And ICU is bundled per-runtime; browser V8 and Node ship different ICU versions, and Node/Alpine's ICU may differ from dev — so `Intl` output is not byte-stable across the stack.

**How to avoid:**
- **Format from the snapshot in one place**, with an explicit `es-AR` formatter and explicit currency handling — and **decide symbol conventions in code** (`US$` for USD, `$` for ARS), don't rely on ICU's currency symbol which may render `US$`, `USD`, or `$` differently per version.
- To guarantee UI == PDF, consider **not** relying on `Intl` currency style for the money string: format the integer/decimal grouping deterministically (own thousands-`.`/decimals-`,` formatter, or `Intl.NumberFormat('es-AR', {style:'decimal'})`) and **prepend your own literal `US$ `/`$ ` label** with a normal space you control. This removes the U+202F variability and the cross-runtime ICU divergence.
- If keeping `Intl`, pin behavior: test against the **actual** output (copy the real narrow-space char) and run the format test in **both** the web build and the Node/worker env so drift is caught in CI. Node 22 ships full-ICU (es-AR works in Alpine), but *which* ICU version is not guaranteed equal to the browser's.
- ARS cuotas are whole pesos (no centavos per CLAUDE.md) — format with 0 fraction digits; USD prices are whole units too.

**Warning signs:**
`1,234.56` anywhere in es-AR UI; `$` on a USD amount; assertions with a literal normal space passing locally but flaky in CI; PDF and web showing different spacing/symbol for the same number; use of `toLocaleString()` with no locale arg.

**Phase to address:** UI + PDF (shared formatter in `packages/ui` or `packages/quoting` output-formatting helper, tested in both runtimes).

---

### Pitfall 10: wa.me link — phone format, accent/newline encoding, and URL length

**What goes wrong:**
- **Phone:** wa.me needs an international number **digits only, no `+`, no spaces/dashes**. Argentine mobiles need the `54` **country code + `9`** for mobile (`54 9 <área> <número>`) — omitting the `9`, or including `+`/`15`/spaces, silently opens WhatsApp to a broken/empty chat.
- **Encoding:** the prefilled text must be `encodeURIComponent`-encoded. Spanish accents and the `$`/newlines break if you hand-concatenate; line breaks must be `%0A`. Double-encoding (encoding an already-encoded string) produces literal `%25` garbage in the message.
- **Length:** very long prefilled text (a full installment table) risks truncation — practical cross-browser/deep-link URL ceiling is ~**2000 chars**; WhatsApp/browsers may cut long `text` params.

**Why it happens:**
`wa.me/<phone>?text=<...>` looks trivial, so the phone normalization and single-encode discipline get skipped; and the temptation is to cram the whole quote into the message.

**How to avoid:**
- **Normalize the phone** through one function: strip non-digits, ensure `54` + `9` for AR mobiles, validate length; store broker WhatsApp already-normalized (schema has `brokers.whatsapp`).
- Build `text` with **exactly one** `encodeURIComponent` on the final assembled string; use `\n` (encoded to `%0A`) for line breaks; unit-test that `áéíóú ñ US$` and newlines round-trip.
- **Keep the message short:** a summary (unidad, precio, anticipo, N cuotas, total) + a link back to the full quote/PDF, **not** the whole table. Budget the URL under ~2000 chars. The authoritative detail lives in the PDF/snapshot, the WhatsApp text is a teaser + contact trigger.

**Warning signs:**
`+` or spaces in the wa.me phone; missing `9` for AR mobiles; `%25` in the delivered message (double-encode); WhatsApp opening with truncated/garbled text; message length near/over 2000 chars.

**Phase to address:** WhatsApp CTA phase (text built from the snapshot).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Do CAC/percentage math in JS `number` (float) | Less code, no decimal lib | Cent drift, totals don't foot, violates CLAUDE.md money rule | **Never** in `packages/quoting` |
| Hit 100% coverage with example tests + `c8 ignore` | Green gate fast | Value edge cases (remainder, boundaries) untested; false confidence in the diferencial | **Never** — engine is the product |
| Recompute the quote from IDs at PDF/render time | No snapshot plumbing | Snapshot drift, non-auditable, PDF ≠ what buyer saw | Never once quotes persist |
| Add anon SELECT/INSERT to `cac_index`/`quotes` to "fix" 42501 | Public path works immediately | Cross-tenant index leak / open write spam / PII exposure | **Never** — compute server-side |
| Render PDF via Chromium in Alpine without pinning fonts | Familiar HTML→PDF flow | Tofu accents, OOM, heavy image | Only with `font-noto` + concurrency cap tested; JS PDF lib preferred |
| Rely on `Intl` currency string for UI==PDF equality | One-liner | Invisible U+202F + ICU-version drift → UI/PDF disagree, flaky tests | Only if tested in both runtimes against real output |
| Compute-and-persist a quote on every public keystroke | Live preview | Quote spam, PDF flood, table bloat | Debounced ephemeral compute; persist only on commit |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| RLS + public cotizador | Reading `cac_index`/inserting `quotes` via anon role (→ `42501`) | Compute + persist in a server tx scoped to the published project's org (app role + `SET LOCAL` GUC); anon reads only published `unit_prices`/`payment_plans` |
| Drizzle `numeric` columns | `parseFloat(anticipoPct/valor)` → float math | Parse strings straight into `Decimal`; keep integers integer |
| BullMQ retries | Non-idempotent PDF upload → duplicate PDFs on retry | Idempotent by `quoteId`, deterministic R2 key, overwrite (reuse v1.1 media D-04 pattern) |
| Alpine Node image (worker) | No fonts → accent tofu in PDF; Chromium won't launch | Embed a Latin-Extended font (JS PDF lib) or install `chromium`+`font-noto`; smoke-test accents |
| Edge rate limiting | Assume Traefik middleware exists (CLAUDE.md) | Staging is nginx (D-01) → `limit_req` in nginx and/or Redis token bucket in-app |
| wa.me | `+`/spaces/missing `9` phone; double-encode; whole table in text | One phone-normalizer (`54 9…`), single `encodeURIComponent`, short summary + link |
| `Intl.NumberFormat` | Default locale (`1,234.56`), `$` on USD, browser≠Node ICU spacing | Explicit `es-AR`, own `US$`/`$` label, deterministic grouping, test in both runtimes |
| Snapshot ↔ engine version | Formula changes, `version` stays 1, old quotes re-read with new math | Bump `version` + store `engineVersion`; renderers read the stored version faithfully |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded PDF concurrency in worker | Worker OOM/restart, stuck jobs | Cap PDF job concurrency + timeout; size container | A handful of concurrent quotes on the shared VPS |
| PDF-per-compute (public preview) | Queue floods, R2 write storm | Persist/PDF only on commit; debounce preview | Any bot or busy launch day |
| Chromium in Alpine for every PDF | High per-job memory, slow cold start | Pure-JS PDF lib; or warm a single browser pool | Immediately on a small VPS |
| Live DB re-read on every quote render | Extra queries + drift | Render from snapshot only | As quote views scale |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Anon policy added to `cac_index` | Every tenant's pricing index leaks cross-tenant | Keep tenant-private; server-side compute only |
| Anon insert to `quotes` | Open write funnel: spam, forged snapshots, PII dumping | No anon insert; server endpoint, Zod-validated, rate-limited |
| Trusting client-supplied price/CAC in the quote request | Buyer fabricates a favorable quote / snapshot poisoning | Server re-reads authoritative `unit_prices`/`cac_index` by ID; never trust body amounts |
| PII (name/phone) inside `snapshot` JSONB | Hard-to-redact PII in an audit blob | Contact lives in `leads`; snapshot is finance-only, linked via `quotes.leadId` |
| Public quote endpoint unthrottled | Table/queue flooding, cost | nginx `limit_req` + app token bucket (Traefik middleware doesn't exist on staging, D-01) |
| Running public path with owner/superuser pool | Full RLS bypass, cross-tenant exposure | App role (NOSUPERUSER, NOBYPASSRLS) with project-scoped GUC |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `$` shown on a USD price | Argentine reads it as pesos → 1000× misread of the price | `US$` for dollars, `$` reserved for ARS cuotas; label explicitly |
| Installments that don't sum to the total | Buyer adds cuotas, distrust the diferencial | Enforce footing invariant; show the reconciled breakdown |
| No "cotización no vinculante" leyenda / implying CAC prediction | Legal exposure; quote read as a binding future-price promise | Mandatory non-binding legend on screen **and** PDF; state CAC is applied at the load-month value, no future CAC is predicted |
| Quote silently using last month's CAC | Buyer/seller see a stale index vs the stated month | Fail loud on missing month; show the período used |
| Long unreadable WhatsApp dump | Message truncated/ignored | Short summary + link to full PDF/quote |

## "Looks Done But Isn't" Checklist

- [ ] **Money math:** Totals foot **exactly** (`anticipo + Σcuotas + Σrefuerzos === precio`) for property-generated inputs — not just the demo case. Verify no `number` in money positions.
- [ ] **Remainder cent:** A named rule + test decides who absorbs the division remainder; sum reconciles.
- [ ] **CAC missing month:** Generating a quote when the current período isn't loaded **errors visibly** (with a panel signal), never silently substitutes.
- [ ] **Non-binding legend:** Present on screen AND PDF; no wording implies a predicted future CAC value.
- [ ] **Snapshot fidelity:** PDF + UI + WhatsApp all render from the stored snapshot; a price edit after issuance does **not** change an existing quote's numbers.
- [ ] **Engine version:** `version`/`engineVersion` bumped on any formula change; old snapshots still render correctly.
- [ ] **RLS path:** Public cotizador computes/persists server-side (app role + project GUC); no anon policy added to `cac_index`/`quotes`; `42501` cannot occur on the happy path.
- [ ] **Rate limit real:** Quote endpoint throttled in nginx/app (not just a Traefik doc reference).
- [ ] **PDF fonts:** Accents (á é í ó ú ñ) and `US$` render in the actual Alpine worker image (smoke test), not just locally.
- [ ] **PDF idempotency:** Retrying a PDF job produces the same R2 object, not a duplicate.
- [ ] **es-AR format:** `1.234,56` grouping; UI and PDF produce byte-identical money strings (ICU/U+202F drift handled).
- [ ] **wa.me:** Phone `54 9…` digits-only; single-encode; accents/newlines round-trip; URL < ~2000 chars.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Float contamination shipped | MEDIUM | Convert engine to decimal/integer, add footing property test; affected quotes are historical snapshots (already frozen) — fix forward, bump `version` |
| Snapshot drift (renders from live data) | HIGH | Backfill missing fields into snapshots if recoverable; switch all renderers to snapshot-only; some past quotes may be unreconstructable |
| Anon leak of `cac_index` shipped | HIGH | Drop the anon policy immediately, audit access logs; move compute server-side |
| Duplicate PDFs from retries | LOW | Switch to deterministic `quoteId` key + overwrite; dedupe R2 objects |
| es-AR/ICU mismatch UI vs PDF | LOW | Replace `Intl` currency style with own deterministic formatter + literal label; add cross-runtime test |
| Wrong `$`/`US$` label | LOW | Fix shared formatter; single source of truth means one change |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Float contamination (P1) | Engine (`packages/quoting`) | Branded money types; footing property test exact |
| Installment remainder (P2) | Engine | Named remainder rule + test; `Σ === precio` |
| CAC staleness/missing month (P3) | Engine input contract + CAC resolution/panel | Missing-month generates a visible error; período in snapshot |
| Weak property tests / coverage gaming (P4) | Engine test suite | Invariant-based props, adversarial generators, no `c8 ignore` |
| Anon RLS wrong-layer (P5) | Persistence / API wiring | Server-side compute in project-scoped tx; `cac_index`/`quotes` stay tenant-private |
| Quote spam / PII (P6) | Persistence + edge rate-limit (nginx) | Throttle test; snapshot PII-free; PDF only on commit |
| Snapshot drift / version (P7) | Persistence + PDF + UI | Golden render from stored snapshot; `version` bumped on change |
| PDF fonts/memory/retry (P8) | PDF worker | Accent smoke test in Alpine image; idempotent `quoteId` key |
| es-AR / ICU formatting (P9) | UI + PDF (shared formatter) | `1.234,56`; UI==PDF byte-identical; tested in both runtimes |
| wa.me phone/encode/length (P10) | WhatsApp CTA | Phone normalizer + single-encode round-trip test; URL length budget |

## Sources

- `packages/db/src/schema/{quotes,cac-index,unit-prices,payment-plans,json-schemas}.ts` (committed v1.1 schema) — money column types, tenant-private RLS posture of `cac_index`/`quotes`, versioned snapshot envelope. **HIGH**
- `docs/modelo-mvp.md` §3.3, §3.4, §5 — data model, cotizador spec (pure/deterministic, 100% coverage, property tests, snapshot + engine version), non-binding legend risk, anon insert + edge rate-limit pattern. **HIGH**
- `CLAUDE.md` + `.planning/PROJECT.md` — money-in-integers rule, es-AR/voseo, D-01 (nginx not Traefik on staging), D-04 (deterministic-key + overwrite media idempotency pattern to reuse). **HIGH**
- [Node.js issue #15223 — Intl.NumberFormat currency spacing changed on ICU bump](https://github.com/nodejs/node/issues/15223) — confirms currency symbol/spacing drift across ICU versions (browser vs Node). **MEDIUM→HIGH**
- [MDN — Intl.NumberFormat constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat) — locale/currency display behavior. **HIGH**
- [Oracle — Notes on deep link URL length](https://docs.oracle.com/cd/E49933_01/studio.320/studio_users/src/csu_deeplinking_url_length.html) + [URL length limits guide](https://www.lineserve.net/blog/ultimate-guide-to-url-length-limits-browsers-http-specs-and-best-practices) — ~2000-char practical ceiling for deep links / custom protocols. **MEDIUM**
- General Alpine/Puppeteer + BullMQ at-least-once retry semantics — known ecosystem gotchas (fonts via `font-noto`/`fontconfig`, idempotent job side-effects). **MEDIUM**

---
*Pitfalls research for: Argentine CAC-adjusted quoting engine added to a multi-tenant Next.js/Drizzle/BullMQ SaaS*
*Researched: 2026-07-01*
