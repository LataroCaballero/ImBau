# Feature Research

**Domain:** Argentine off-plan (preventa en pozo) property quoting/financing — the ImBau cotizador (P4), milestone v1.2 / Fase 3
**Researched:** 2026-07-01
**Confidence:** HIGH (domain mechanics cross-checked against Argentine industry sources + grounded in the already-built v1.1 schema & seed)

## Scope note

This researches ONLY the NEW quoting feature set. The multi-tenant foundation, full data model
(`quotes`, `payment_plans`, `cac_index`, `price_lists`, `unit_prices`, `units`), media pipeline, and
the deterministic "Brigos Recoleta" seed already exist and ship unchanged. There is **no public
product UI yet** — the explorador/ficha are a LATER milestone (Fase 2). So the cotizador is the
*first* public-facing surface and must reach a unit **without** the building explorer.

---

## Domain mechanics (the accuracy baseline)

How Argentine developers/brokers actually present pozo financing (confirmed by industry sources,
matches the seed):

- **Precio de lista en USD.** Off-plan units are priced in whole USD. Two price lists are standard
  and already seeded: *Financiado* (list price) and *Contado* (discounted; the seed applies **−12%**).
- **Anticipo (down payment) in USD**, typically **20–40%** (30% is the modal case). Seeded plans:
  30/70 and 20/80.
- **Saldo en cuotas mensuales ajustadas por índice CAC.** The balance is paid over **24–48 months**
  (seed: 36 and 48). Cuotas are **paid in pesos** and re-priced monthly by the **CAC index** (Cámara
  Argentina de la Construcción) — a public monthly construction-cost index that keeps the balance in
  "construction-cost-constant" terms (an inflation proxy, not an FX rate). Seed carries an 18-month
  synthetic monotonic-up series, one value per org per período (`cac_index`).
- **Refuerzos (balloon payments)**, usually **semestrales/anuales**, timed to *aguinaldos* (June/Dec).
  Seeded as `Refuerzo[] = { cuota: int, montoUsd: int }` — one every 6 cuotas.
- **Contado con descuento** — paying cash up-front earns a real discount (seed: −12%), presented
  side-by-side with the financed plan.
- **Leyenda de ajuste + no-vinculante.** Real cotizaciones always carry a disclaimer that peso values
  are referential "al valor del mes" and adjust by CAC, and that the quote is **not binding** (valores
  sujetos a la lista de precios vigente al momento del boleto). This is already encoded in the seed's
  `notasLegales` per plan.

**What a real cotización screen/PDF shows:** unit id + m²/tipología/orientación; price (USD);
anticipo (USD + %); number of cuotas; **the first cuota expressed in ARS "al valor del mes"** with
the adjustment disclaimer; refuerzos listed; total financed; and a contado-vs-financiado comparison.
Additional real-world costs (sellos ~3.5%, escribanía ~2%) are sometimes shown but are **out of MVP
scope** unless the plan explicitly adds them (see anti-features).

### ⚠️ Load-bearing design decision (flag for the roadmap)

The spec's stated engine inputs are exactly **`unidad + lista de precios + plan de pago + índice CAC
vigente`** — there is **no USD→ARS FX rate** anywhere in the schema or inputs. Yet §3.4 wants "cuota
inicial **en pesos** al valor del mes." A USD balance cannot become a peso installment without a
conversion basis. The planner MUST resolve one of:

1. **Cuotas in USD, CAC as the peso multiplier** — express each cuota's peso value as
   `cuota_usd_share × CAC_valor_vigente` (treating the balance as a fixed number of CAC "unidades" at
   boleto). Computable from the stated inputs; the pesos figure is illustrative and moves with CAC.
2. **Cuotas presented in USD only**, with CAC shown purely as the textual adjustment legend (no hard
   peso number). Safest, but weaker as the "#1 differentiator."
3. **Add an explicit FX/base input** to the engine (a reference `valorCuotaBaseArs` on the plan, or a
   quote-time USD→ARS) — a schema/contract addition, so scope-relevant.

Recommendation: option **1** for the engine (keeps money in USD as the invariant, uses only stated
inputs, honors "en pesos al valor del mes"), and NEVER predict future CAC (anti-feature). This is the
single most important domain-accuracy decision and belongs in the engine SPEC before the UI is built.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing these = the cotizador feels incomplete or untrustworthy for the AR pozo market.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pure deterministic quote engine (`packages/quoting`) | The differentiator dies on any calc error; CLAUDE.md mandates 100% coverage + property-based tests | HIGH | Inputs: unit price (USD) + payment_plan + CAC vigente. Pure, no I/O. Emits one typed struct feeding UI + PDF + WhatsApp. Money as integers/decimal, never float. |
| Contado (USD) result | The cash path is half of every AR pozo pitch | LOW | Read `unit_prices` on the *Contado* list; show discounted total. Trivial once engine exists. |
| Financiado result: anticipo + N cuotas ajustadas por CAC + refuerzos | The core AR financing model | HIGH | Anticipo USD, saldo, cuota (see design decision above), refuerzos from `payment_plans.refuerzos`. Present first cuota "al valor del mes". |
| Adjustment + non-binding legend on screen and PDF | Legal/trust table stakes; already in `notasLegales` | LOW | Surface `payment_plans.notasLegales` + a fixed "cotización no vinculante" line. |
| Server-side PDF of the quote (worker) | Buyers/brokers expect a shareable/downloadable artifact | MEDIUM | Generated in `apps/worker` (BullMQ), stored to R2, key → `quotes.pdfKey`. Branding-consistent, archived (probative value). |
| WhatsApp CTA with the quote pre-filled | P7/P4: the whole funnel ends in WhatsApp; "portada→cotización por WhatsApp <2 min" | LOW | `wa.me/<broker.whatsapp>?text=<encoded summary>`. Broker number when arriving via `/b/<slug>`, else project default. |
| Reaching a unit WITHOUT the explorer | Explorer ships later; the quoter is the first public surface | MEDIUM | Needs a standalone entry: URL param (`/cotizar?unit=<id>` or `/u/<projectSlug>/<unitId>`) and/or a minimal unit picker (floor→unit select) reading published units. **New requirement, not in original P4 wording.** |
| Plan presets (select from the project's payment_plans) | Developers define the offered plans; buyer picks, not free-form | LOW | Drive selects from seeded `payment_plans`; do not invent plans in the UI. |
| Full quote snapshot persistence (inputs + outputs + engine version) | §3.4 "auditabilidad total"; probative value in price disputes | MEDIUM | `quotes.snapshot` is a versioned envelope `{ version: 1, ... }.passthrough()` — engine owns the interior; bump `version` to evolve without a migration. Persist on quote emission. |

### Differentiators (Competitive Advantage)

Where ImBau beats Urbania3D/Hauzd/Web3D — "nadie resuelve bien la financiación argentina."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Genuinely correct CAC-adjusted math, provably tested | Trust is the product; 100%-covered pure engine is a demoable claim competitors can't make | HIGH | The property-based + unit suite IS the differentiator. Test invariants: anticipo+saldo+refuerzos reconcile to price; monotonic CAC ⇒ monotonic peso cuota; determinism. |
| Contado-vs-financiado comparison, side by side | Buyers instantly grasp the cost of financing; a common friction point in AR sales | LOW-MED | Two engine runs (Contado list vs Financiado list+plan) rendered together. High value, low cost. |
| Interactive inputs (anticipo % / plazo) within developer-allowed bounds | "Play with the plan" converts better than a static table | MEDIUM | Sliders/selects, but **only within values the developer authorized** (preset plans, or bounded anticipo range). Do NOT let buyers invent terms the developer won't honor. |
| Pre-filled, human-readable WhatsApp handoff | Turns a cold "info?" into a warm, specific lead the broker can act on | LOW | See handoff spec below. Differentiator #1 of the funnel. |
| Shareable/branded PDF as a leave-behind | Broker forwards a professional PDF, not a screenshot | MEDIUM | Reuses the worker/R2/PDF stack from earlier phases. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Predicting/projecting future CAC values ("your cuota in month 24 will be $X") | Buyers want certainty about future cost | CAC is unknowable; a wrong projection is a legal/trust landmine and contradicts "no vinculante" | Show ONLY today's cuota "al valor del mes" + the adjustment legend. Never forecast. |
| Binding/committal quotes ("precio garantizado") | Feels stronger to the buyer | Prices track the lista vigente al boleto; a binding quote is a legal liability | Prominent "cotización no vinculante" legend on screen + PDF; snapshot for audit, not for guarantee. |
| Free-form anticipo/plazo the developer never offered | "Let me pay 5% down over 120 months" | Generates leads for terms the developer will reject → wasted broker time, bad UX | Constrain to `payment_plans` presets or developer-authorized bounded ranges only. |
| Inventing a USD→ARS exchange rate to show pesos | "Buyers think in pesos" | A made-up FX rate is wrong the instant it's shown and invites disputes | Use CAC as the peso basis per the design decision, or show USD + CAC legend. No FX guessing. |
| Full amortization schedule (every one of 48 cuotas with projected CAC) | Looks thorough | Implies forecasting CAC (see above) + heavy UI for little conversion lift on mobile | First cuota + refuerzo schedule (by cuota index, USD) + totals. |
| Sellos/escribanía/IVA/closing-cost calculator | "Show the true total cost" | Jurisdiction-variable, changes over time, scope creep on a v1 differentiator | Defer to v1.x; optionally a static informational note, not a computed line. |
| Persisting a lead/PII on every quote view | "Capture everyone who quotes" | Privacy + noise; a quote isn't a lead until the buyer acts | Persist the `quotes` snapshot (allowed anon insert) but create a `lead` only on the WhatsApp/CTA action. |
| Live CAC scraping now | "Keep the index current automatically" | Fragile scraping for a value that's loaded monthly; §3.3 says manual load now, scraping later | Manual `cac_index` load (panel is a later milestone; seed already has the series). |

---

## Feature Dependencies

```
packages/quoting (pure engine)
    └──consumes──> unit_prices (USD) + payment_plans + cac_index   [EXIST from v1.1]
    └──resolves──> USD→pesos basis DESIGN DECISION                 [must precede UI + PDF]

Cotizador UI (web público)
    └──requires──> packages/quoting
    └──requires──> standalone unit entry (URL param / minimal picker)  [NEW — explorer not built]
    └──reads─────> published units + price_lists via anon RLS role

Server-side PDF (worker)
    └──requires──> packages/quoting (same typed output)
    └──requires──> R2 + worker + BullMQ  [EXIST]
    └──writes────> quotes.pdfKey

WhatsApp CTA
    └──requires──> quote output (summary text)
    └──enhanced-by──> broker context (/b/<slug> → broker.whatsapp)  [broker links are Fase 5]

Quote snapshot persistence
    └──requires──> packages/quoting output + quotes table  [table EXISTS, versioned envelope]
    └──feeds─────> PDF (pdfKey) and (optionally) lead on CTA

lead creation ──triggered-by──> WhatsApp/CTA action (NOT on quote view)
```

### Dependency Notes

- **Engine before everything:** UI, PDF, and WhatsApp text all consume the *same* typed engine
  output. Build/verify `packages/quoting` first (it's also the densest pure-logic work — ideal for
  the Fable window).
- **USD→pesos decision gates the engine's public contract:** resolve it in the engine SPEC before UI,
  because it changes the output shape (whether a peso figure exists and how it's labeled).
- **Standalone entry is a genuinely new requirement:** original P4 assumed arrival from the ficha
  (Fase 2). Since the explorer ships later, the quoter needs its own entry (URL param and/or a minimal
  floor→unit picker over published units). Keep it thin so the later ficha just deep-links in.
- **Broker context is partial:** per-broker WhatsApp links (P8) are a later milestone. For v1.2, the
  CTA should degrade gracefully to a project-level WhatsApp number, with a `broker` slot ready.
- **Snapshot envelope already reserved:** `quotes.snapshot` is `{ version: 1 }.passthrough()` and
  `quotes` is tenant-private (no anon read). Engine owns the interior shape and its version.

---

## MVP Definition

### Launch With (v1.2 — this milestone)

- [ ] **`packages/quoting`** pure engine, 100% coverage + property-based tests — the differentiator; a calc error kills the product.
- [ ] **Contado + Financiado (CAC) results on screen**, mobile-first — the core value.
- [ ] **First cuota "al valor del mes" + refuerzos + totals**, with adjustment & non-binding legend — table-stakes trust.
- [ ] **Standalone entry to a unit** (URL param and/or minimal picker) — explorer isn't built yet.
- [ ] **Server-side PDF** generated in worker, stored to R2 (`pdfKey`) — shareable artifact.
- [ ] **WhatsApp CTA** with pre-filled summary — the funnel endpoint.
- [ ] **Full quote snapshot persistence** (inputs + outputs + engine version) — auditability.

### Add After Validation (v1.x)

- [ ] Contado-vs-financiado **side-by-side** comparison view — trigger: engine + both paths stable.
- [ ] **Interactive anticipo/plazo** within developer bounds — trigger: presets working + real developer-authorized ranges.
- [ ] Deep-link from the **ficha de unidad** — trigger: Fase 2 explorer/ficha ships.
- [ ] Per-**broker** WhatsApp routing on the CTA — trigger: Fase 5 broker links ship.

### Future Consideration (v2+)

- [ ] Closing-cost (sellos/escribanía) informational module — defer: jurisdiction-variable scope creep.
- [ ] Automated CAC ingestion (scraping/API) — defer: manual load is fine at MVP volume.
- [ ] Buyer-facing saved/emailed quote history — defer: needs auth/PII handling not in scope.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Pure quoting engine (100% tested) | HIGH | HIGH | P1 |
| Financiado (CAC) on-screen result | HIGH | HIGH | P1 |
| Contado result | HIGH | LOW | P1 |
| Adjustment + non-binding legend | HIGH | LOW | P1 |
| Standalone unit entry (param/picker) | HIGH | MEDIUM | P1 |
| Quote snapshot persistence | MEDIUM | MEDIUM | P1 |
| Server-side PDF | HIGH | MEDIUM | P1 |
| WhatsApp CTA pre-filled | HIGH | LOW | P1 |
| Contado-vs-financiado comparison | HIGH | LOW-MED | P2 |
| Interactive anticipo/plazo (bounded) | MEDIUM | MEDIUM | P2 |
| Broker-routed WhatsApp | MEDIUM | LOW | P2 (blocked on Fase 5) |
| Closing-cost calculator | LOW | MEDIUM | P3 |
| CAC scraping | LOW | MEDIUM | P3 |

## WhatsApp handoff message (what it typically contains)

A good pre-filled `wa.me` text for AR pozo is short, specific, and copy-paste-ready for the broker:

- Greeting + intent: *"Hola, me interesa el/la [Unidad 4°B] en [Proyecto]."*
- Unit essence: identificador, tipología, m², orientación.
- The chosen quote: precio (USD), plan (ej. "Anticipo 30% + 36 cuotas CAC"), anticipo (USD), primera cuota "al valor del mes" (ARS), refuerzos.
- A link back to the quote/ficha (so the broker sees the same numbers) and an implicit non-binding framing.
- Keep it URL-encoded and under WhatsApp's practical length; prefer a compact summary + link over dumping the full table.

The message is generated from the **same engine output** as the screen/PDF (single source of truth),
so the three surfaces never disagree.

## Quote persistence / auditability expectations

- Persist a **snapshot** on emission containing: the resolved **inputs** (unit id, price used, plan
  params, CAC período+valor vigente), the **outputs** (anticipo, saldo, cuota, refuerzos, totals), and
  the **engine version**. Already modeled as `quotes.snapshot = { version, ... }` (versioned envelope).
- Store the generated **PDF key** (`quotes.pdfKey`) so the exact document is retrievable — probative
  value in price disputes (§3.2).
- `quotes` is **tenant-private** (no anon SELECT); an anonymous buyer can trigger a quote insert
  (like `events`/`leads`) but cannot read others' quotes.
- Because CAC and lista vigente change, a snapshot is a **point-in-time record**, never a live
  recompute — reproducibility is the whole point of pinning inputs + version.

## Competitor Feature Analysis

| Feature | Urbania3D / Hauzd / Web3D | Our Approach |
|---------|---------------------------|--------------|
| AR-specific CAC financing math | Weak/absent — generic or none ("nadie lo resuelve bien") | Purpose-built, 100%-tested pure engine; contado + CAC + refuerzos |
| Quote → PDF | Varies; often manual/broker-made | Server-side branded PDF, archived snapshot |
| Quote → WhatsApp | Generic contact forms | Pre-filled `wa.me` with the exact quote + broker routing |
| Time-to-quote on mobile | Heavy 3D engines, slow on 4G | Mobile-first, <3s budget; quoter works before the explorer even exists |
| Auditability | Not a stated concern | Full input+output+version snapshot per quote |

## Sources

- [Modalidades de Pago de Departamentos en Pozo — Estudio Kohon](https://estudiokohon.com/modalidades-pago-departamentos-en-pozo/) — anticipo 30%, saldo 70% en cuotas pesos ajustadas por CAC, boleto de compraventa. **HIGH**
- [Índice CAC en Argentina — Spazios](https://spazios.com.ar/blogs/que-es-el-indice-cac-y-como-influye-en-tu-camino-a-ser-dueno-en-argentina/) — CAC = Cámara Argentina de la Construcción, ajuste mensual, referencia objetiva y pública. **MEDIUM** (developer blog; cross-checked → effectively HIGH)
- [Índice CAC y cuotas en pozo — psocialista.org](https://psocialista.org/indice-cac-y-cuotas-en-pozo-como-entender-los-ajustes-inmobiliarios) — cuotas no fijas pero no arbitrarias, mantienen valor real. **MEDIUM**
- [Claves para comprar en pozo — Infobae](https://www.infobae.com/economia/2025/03/23/claves-para-comprar-departamentos-en-pozo-y-evitar-complicaciones-legales-y-financieras/) — refuerzos semestrales atados a aguinaldos, sellos ~3.5%, escribanía ~2%, contrato vincula pagos a CAC. **HIGH**
- [Roomix — Comprar en pozo Argentina 2026](https://roomix.ai/blog/que-es-pozo) — anticipo 20–40%, 24–30 meses, financiación directa del desarrollador. **MEDIUM**
- Existing codebase (v1.1 SHIPPED): `packages/db/src/schema/{quotes,payment-plans,cac-index,price-lists}.ts`, `json-schemas.ts`, `seed/{content,pricing}.ts` — seeded presets (30/70 CAC 36, 20/80 CAC 48, semestral refuerzos, contado −12%, 18-month CAC series), versioned snapshot envelope, money-as-integers. **HIGH**
- `docs/modelo-mvp.md` §2.3, §3.3, §3.4 — user flow, data model, engine spec. **HIGH**

---
*Feature research for: Argentine off-plan (preventa en pozo) property quoting — ImBau cotizador (P4)*
*Researched: 2026-07-01*
