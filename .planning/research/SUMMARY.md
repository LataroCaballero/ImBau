# Project Research Summary

**Project:** ImBau — v1.2 Cotizador (Fase 3)
**Domain:** Argentine off-plan (preventa en pozo) quoting engine + public quote UI + async PDF + WhatsApp handoff
**Researched:** 2026-07-01
**Confidence:** HIGH

## Executive Summary

The v1.2 milestone adds the first public-facing surface to an already-shipped multi-tenant foundation. The core product is a pure, deterministic quoting engine (`packages/quoting`) that computes Argentine CAC-adjusted installment financing — exactly the capability that competitors (Urbania3D, Hauzd, Web3D) fail to implement correctly. The engine is not a UI feature: it is the product's legal and commercial differentiator, and a single cent-level drift or a stale index silently misrepresented makes the cotizador worse than the broker's Excel. The recommended approach is to build the engine first, verify it exhaustively (100% coverage + property-based invariants), and let the UI, PDF, and WhatsApp surfaces all derive from the same typed `QuoteResult` — never recomputing independently.

The most important architectural decision for this milestone is the RLS boundary: `cac_index` and `quotes` are **tenant-private** in the committed v1.1 schema — the anon role cannot read the index or write a quote. This is not a bug to fix by adding anon policies; it is a feature. The correct path is a server-side `publicProcedure` (tRPC) that resolves the published project's org, reads CAC via `withTenant`, computes the quote, persists the snapshot, and enqueues the PDF — all server-authoritative. The public buyer triggers the flow; the server owns every privileged operation. This mirrors the existing media pipeline pattern and requires no schema migration.

The main risks are: (1) float contamination at the Drizzle `numeric`→string boundary (parse directly into `decimal.js`, never through `parseFloat`); (2) installment rounding with no named remainder rule (making cuota totals fail to foot); (3) the PDF worker running in Alpine without embedded Latin-Extended fonts (accents render as tofu); and (4) silently widening the `apps/web` isolation to hold the app pool without documenting it as a deliberate Key Decision. Address these in the engine and worker phases; they are all preventable with explicit decisions made early.

---

## Key Findings

### Recommended Stack

The existing stack (pnpm+Turborepo, Next 16/React 19, tRPC v11+Zod 4, PG16+Drizzle+RLS, BullMQ+Redis, Vitest 4, R2, Sentry/pino) is unchanged. This milestone adds exactly **two runtime deps** and **two dev deps**:

**Net-new runtime deps:**
- `decimal.js@10.6.0` — arbitrary-precision decimal arithmetic for the engine; parse `numeric` strings directly (`new Decimal(row.valor)`), never through `parseFloat`; configure an explicit rounding mode (`ROUND_HALF_UP`) as a single visible decision
- `@react-pdf/renderer@4.5.1` + `react@19.2.x` peer (worker only) — headless server-side PDF in pure Node; no Chromium; built-in Helvetica covers Latin-1 (a e i o u n); add only to `apps/worker`

**Net-new dev deps:**
- `fast-check@4.8.0` + `@fast-check/vitest@0.4.1` — property-based testing for the engine; modelo-mvp.md section 3.4 explicitly mandates PBT alongside unit tests

**Nothing else needs to be installed.** `@vitest/coverage-v8`, `drizzle-zod`, and all other tools are already present. The 100% coverage gate is scoped to `packages/quoting/vitest.config.ts` only — not the root config.

**Critical anti-patterns to avoid:** `dinero.js` v2 (alpha, unmaintained), Chromium/Playwright in Alpine for PDF, global 100% coverage threshold, any JS float in a money position.

### Expected Features

**Must have (table stakes):**
- Pure deterministic quote engine (`packages/quoting`) — 100% coverage + property tests; this IS the differentiator
- Contado (USD, discounted) result — half of every AR pozo pitch
- Financiado result: anticipo + N cuotas CAC-adjusted + refuerzos — the core Argentine financing model
- First cuota "al valor del mes" (pesos) + adjustment + non-binding legend on screen and PDF
- Server-side PDF (worker to R2, async) — shareable/archivable artifact
- WhatsApp CTA with pre-filled summary — the funnel endpoint
- Standalone unit entry (URL param + minimal picker) — NEW requirement; the explorer (Fase 2) ships later; the cotizador is the first public surface
- Full quote snapshot persistence (inputs + outputs + engine version) — auditability per section 3.4

**Should have (competitive differentiators, defer to v1.x):**
- Contado-vs-financiado side-by-side comparison
- Interactive anticipo/plazo within developer-authorized bounds
- Deep-link from ficha de unidad (blocked on Fase 2)
- Per-broker WhatsApp routing (blocked on Fase 5)

**Anti-features (never build):**
- Predicting/projecting future CAC values — legal liability
- Free-form anticipo/plazo outside developer-authorized plans
- Fabricated USD-to-ARS FX rate; use CAC as the peso basis
- Full 48-cuota amortization table with projected CAC
- Persisting a lead on every quote view; persist on commit only
- Closing-cost (sellos/escribania) calculation

**Load-bearing domain decision (resolve before engine is built):** The spec states cuota amounts in pesos but the schema has no USD-to-ARS FX rate. **Recommendation: Option 1** — express the peso cuota as `cuota_usd_share * CAC_valor_vigente`, treating the balance as a fixed number of CAC "unidades" at boleto time. This uses only the stated inputs, keeps USD as the monetary invariant, and is consistent with how the seed CAC index is modeled.

### Architecture Approach

The architecture follows the proven `createUpload -> BullMQ -> processMedia -> withTenant UPDATE` pattern from v1.1. Quote emission = a `publicProcedure` tRPC route that resolves the published project's org via `withAnon`, reads CAC + persists snapshot via `withTenant(orgId)`, then enqueues to `QUOTE_PDF_QUEUE`. The worker renders the PDF from the frozen snapshot (never from live DB re-reads), writes to R2, and updates `quotes.pdfKey`. On-screen result + WhatsApp CTA return synchronously from the in-memory `QuoteResult`; PDF is fully async. No schema migration is needed — all columns exist.

**Major components:**
1. `packages/quoting` (NEW) — pure engine: `calcQuote()`, `toWhatsAppText()`, `toPdfModel()`, `ENGINE_VERSION`; zero I/O; 100% coverage gate; Vitest unit + fast-check property tests
2. `packages/api` quotesRouter (NEW) — `compute` (preview, no persist) + `create` (persist + enqueue); resolves org from published project; `withTenant` for CAC read + quote INSERT; Zod-validated; rate-limited
3. `apps/web` `[projectSlug]/[unitId]` route (NEW) — RSC reads unit_price/plans/broker via `withAnon`; client configurator calls `quotes.*`; renders `QuoteResult`; WhatsApp CTA; minimal unit picker for standalone entry
4. `apps/worker` `processQuotePdf` (NEW) — renders `toPdfModel()` output via react-pdf; R2 upload via deterministic key; `withTenant` UPDATE `pdfKey`; `failed` to Sentry/pino
5. `packages/storage` (MODIFIED) — adds `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`, `quotePdfKey()` following the existing queue.ts/keys.ts pattern

**The tenant-private crux (planner must choose explicitly):**
- Option A1 (recommended): `apps/web` gains `DATABASE_APP_URL`, used only in `quotesRouter`; deliberately widens D-03 "web is anon-only"; must be documented as a Key Decision and grep-fenced
- Option A2: Quote emission from a separate server surface already holding the app pool; cleaner isolation, one more moving part
- Option B (avoid): Add anon policies to `cac_index`/`quotes` — leaks tenant pricing index; violates committed isolation posture

**Rate limiting reality:** Staging uses nginx + certbot (D-01), not Traefik. Implement `limit_req` in nginx and/or a Redis token bucket in-app. Do not plan a Traefik middleware for quote-create.

### Critical Pitfalls

1. **Float contamination at the Drizzle numeric boundary** — `anticipoPct` and `cac_index.valor` return as JS strings; the reflex `parseFloat()` reintroduces floats. Parse straight into `new Decimal(row.valor)`. Assert with a property test: `anticipo + sum(cuotas) + sum(refuerzos) === precioTotal` exactly, no tolerance.

2. **Installment rounding with no named remainder rule** — `saldo / cuotas` rarely divides evenly. Naive per-row rounding makes totals fail to foot. Pick an explicit rule (floor base installment, distribute remainder to the first k installments), encode it as a named pure function, assert the footing invariant as a fast-check property.

3. **Wrong-layer RLS integration (anon 42501)** — `cac_index`/`quotes` have no anon policy. The fix is NOT adding anon policies (that leaks tenant pricing data). Compute and persist server-side in a `publicProcedure` scoped to the published project's org via `withTenant`.

4. **Property tests that game coverage or test the implementation against itself** — test invariants (totals foot, monotonicity, determinism, boundary inputs) with adversarial generators. Forbid `c8 ignore` in `packages/quoting`. Engine is the product; false confidence here is the highest-risk outcome.

5. **PDF in Alpine without embedded Latin-Extended fonts** — use `@react-pdf/renderer` (pure Node, no browser); verify accents in a smoke test against the actual Alpine worker image; make the PDF job idempotent by `quoteId` (deterministic R2 key + overwrite) for BullMQ at-least-once retries.

6. **Snapshot drift — re-rendering from live data instead of the frozen snapshot** — UI, PDF, and WhatsApp must all derive from the same `QuoteResult`; the worker renders from `quotes.snapshot`, never re-runs the engine from IDs. A price change after issuance must not alter an existing quote's numbers.

7. **es-AR formatting drift between browser and Node** — `Intl.NumberFormat('es-AR', {style:'currency'})` inserts a narrow no-break space (U+202F) whose exact form varies across ICU versions. Own the symbol (`US$`/`$` as literal labels), use `Intl.NumberFormat('es-AR', {style:'decimal'})` for grouping, test the formatter in both runtimes.

---

## Implications for Roadmap

### Phase 1: Pure Quoting Engine
**Rationale:** `QuoteResult` is the type contract for every other surface. Must exist and be verified before any surface is built. Densest pure-logic work — ideal for the Fable window without integration complexity.
**Delivers:** `packages/quoting` — `calcQuote()`, serializers, `ENGINE_VERSION`, typed I/O; Vitest unit suite + fast-check property tests (invariants: footing, monotonicity, determinism, boundary inputs); 100% coverage gate scoped to the package
**Addresses:** Engine table-stakes; CAC-as-peso-basis design decision (must be encoded in `QuoteInput` contract here); installment remainder rule; money types
**Avoids:** Float contamination (Pitfall 1), installment rounding (Pitfall 2), weak property tests (Pitfall 4), snapshot drift (Pitfall 7 — engine owns the output shape)
**Research flag:** Standard patterns — well-specified in docs/modelo-mvp.md section 3.4 and STACK.md. Skip `--research-phase`.

### Phase 2: API Persistence + Queue Contract
**Rationale:** Once the engine type is stable, the tRPC router and RLS-aware persistence layer can be built. The tenant-private crux (Option A1 vs A2) must be resolved here as a documented Key Decision before any public UI exists.
**Delivers:** `packages/api` quotesRouter (`compute` + `create`); `packages/storage` queue/key contract; Zod validation; `withTenant` org resolution from published project; snapshot INSERT; queue enqueue; nginx `limit_req` config for quote endpoint
**Implements:** Architecture Option A1 or A2; BullMQ producer side of the media-pipeline pattern
**Avoids:** Wrong-layer RLS integration (Pitfall 5); quote spam + PII in snapshot (Pitfall 6); client-supplied prices/CAC (Anti-Pattern 4)
**Research flag:** No new research — `withTenant`/`withAnon` patterns established in codebase. A1/A2 is a product decision, not a research question.

### Phase 3: Public Web UI + WhatsApp CTA
**Rationale:** With engine type and tRPC router in place, the public UI is a consumer. The standalone unit entry (URL param + minimal picker) must be designed here since the explorer does not exist yet.
**Delivers:** `apps/web/app/[projectSlug]/[unitId]` — RSC page (reads via `withAnon`); client configurator; `QuoteResult` render (contado + financiado, first cuota ARS, refuerzos, totals, non-binding legend); WhatsApp CTA; minimal unit picker
**Addresses:** Standalone entry requirement; WhatsApp handoff; mobile-first performance budget (<3s on 4G)
**Avoids:** es-AR formatting drift (Pitfall 9 — shared formatter tested in both runtimes); wa.me phone/encode (Pitfall 10); `$` vs `US$` label confusion
**Research flag:** Standard Next.js RSC + tRPC client patterns. Skip `--research-phase`.

### Phase 4: Async PDF Worker
**Rationale:** PDF is async and non-blocking — it can slip without blocking the demo-critical on-screen + WhatsApp path. Build last so a PDF issue never delays the milestone's primary value.
**Delivers:** `apps/worker/src/quote-pdf.ts` + `quote-pdf-render.tsx` — `processQuotePdf` (renders from snapshot, uploads to R2, writes back `pdfKey`); `reportQuotePdfFailure` to Sentry/pino; queue/worker registered in `boot()`; PDF download/poll wired in UI
**Implements:** Async PDF pipeline mirroring `processMedia`; idempotent by `quoteId` (deterministic R2 key, overwrite on retry)
**Avoids:** PDF fonts/memory/retry (Pitfall 8 — react-pdf not Chromium, accent smoke test in actual Alpine image); snapshot drift (Pitfall 7 — renders from stored snapshot only)
**Research flag:** No new research — react-pdf pattern is documented in STACK.md; BullMQ idempotency pattern established from v1.1 media pipeline (D-04).

### Phase Ordering Rationale

- **Engine before everything:** `QuoteResult` is the type contract; no surface can be built correctly until the output shape is finalized and the CAC-as-peso-basis decision is encoded.
- **API before UI:** The tRPC router and the A1/A2 RLS crux must be resolved before the UI calls any procedure. The decision affects `apps/web/env.ts` and must be a documented Key Decision, not a surprise.
- **UI before PDF:** WhatsApp and on-screen result are the demo-critical path. PDF is a background artifact. Decoupling them means a PDF slip does not block the milestone.
- **PDF last:** Async, isolated, non-blocking. BullMQ queue already exists; react-pdf is new but self-contained in the worker.

### Research Flags

Phases needing deeper research during planning:
- **None.** All phases build on well-specified patterns. The engine is fully spec'd in docs/modelo-mvp.md section 3.4; the queue/persistence pattern mirrors v1.1 media pipeline; tRPC/RLS patterns are established in the codebase. The one genuine open question (USD-to-ARS basis) is a product decision, not a research gap.

Phases with standard patterns (skip `--research-phase`):
- **All four phases** — research is complete; grounded in the existing codebase and committed schema.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry 2026-07-01; react-pdf peer range confirmed against React 19; fast-check/vitest pairing confirmed |
| Features | HIGH | Domain mechanics cross-checked against Argentine industry sources; seeded v1.1 data confirms the financing model is correctly represented |
| Architecture | HIGH | Grounded in direct codebase reads (schema, RLS policies, tRPC context, media pipeline) — not generic patterns |
| Pitfalls | HIGH (schema-specific) / MEDIUM (Alpine/ICU) | Schema-specific pitfalls verified against committed files. Alpine font and ICU spacing pitfalls are ecosystem-documented but not tested in this specific image version |

**Overall confidence: HIGH**

### Gaps to Address

- **USD-to-ARS peso basis (design decision):** Must be resolved before the engine's `QuoteInput` type is finalized. Recommendation is Option 1 (CAC as the peso multiplier). Planner must make this explicit and encode it in the engine contract.
- **Option A1 vs A2 (app pool location):** Must be a documented Key Decision before Phase 2 implementation. Recommendation is A1 with grep-fence and documented D-03 widening.
- **CAC missing-month UX:** The engine will fail loudly on a missing CAC month (correct). For v1.2, the error should be a clear server message ("CAC del mes no cargado"), not a cryptic 500. Panel warning is a later milestone.
- **`apps/web` tRPC client:** `apps/web` currently has no tRPC client (panel does). The quote configurator needs one. Must be scoped explicitly in the Phase 3 plan.

---

## Sources

### Primary (HIGH confidence)
- `packages/db/src/schema/{quotes,payment-plans,cac-index,unit-prices,brokers,json-schemas}.ts` — committed v1.1 schema; money column types, RLS policies, snapshot envelope
- `packages/api/src/trpc/{init,context,middleware}.ts`, `routers/{projects,media,_app}.ts` — existing withTenant/withAnon patterns
- `packages/storage/src/{queue,keys,index}.ts` + `apps/worker/src/index.ts` — existing BullMQ queue/worker/media patterns
- `docs/modelo-mvp.md` sections 2.3, 3.3, 3.4, 3.5 — user flow, data model, engine spec, cotizador requirements
- `.planning/PROJECT.md` — v1.2 milestone goal, Key Decisions (D-01 nginx, D-03 web anon-only, D-04 idempotent keys)
- `CLAUDE.md` — money rules, quality gates, stack constraints
- npm registry 2026-07-01 — exact versions for decimal.js, fast-check, @fast-check/vitest, @react-pdf/renderer

### Secondary (MEDIUM confidence)
- Modalidades de Pago de Departamentos en Pozo (Estudio Kohon) — anticipo 30%, CAC cuotas mechanics
- Indice CAC (Spazios) — CAC index semantics and monthly adjustment behavior
- Claves para comprar en pozo (Infobae, 2025) — refuerzos semestrales, sellos/escribania
- Node.js issue #15223 — Intl.NumberFormat ICU spacing drift across versions
- General Alpine/BullMQ retry idempotency patterns

### Tertiary (LOW confidence)
- URL length limits (~2000 chars for wa.me deep links) — practical ceiling from multiple guides, not officially documented by WhatsApp

---
*Research completed: 2026-07-01*
*Ready for roadmap: yes*
