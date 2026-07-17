# Project Research Summary

**Project:** ImBau — Panel de autogestión (milestone v1.3 / fase 4 del plan maestro)
**Domain:** Developer self-service admin panel on an already-shipped multi-tenant Next.js/tRPC/Drizzle-RLS SaaS — editable unit/price grid with Excel import/export (D1), lightweight leads inbox with email notification (D2), and an SVG-polygon hotspot editor
**Researched:** 2026-07-17
**Confidence:** HIGH

## Executive Summary

This milestone is integration work on a mature stack, not greenfield design. The schema (units, price_lists, unit_prices, leads with enum+timeline+origen, floors/units.poligonoSvg), the tenancy model (RLS FORCE + withTenant/SET LOCAL GUC), the async worker (BullMQ + Resend + React Email), and object storage (R2) all shipped in v1.0-v1.2. The question this research answers is precisely how three new write-heavy panel surfaces attach to those seams without breaking the money invariant, the tenant fence, or the "errores observables" mandate. Only one new runtime dependency is needed (exceljs, MIT) - everything else (grid table, SVG editor, email) is hand-rolled or reuses existing infrastructure.

The recommended approach: Excel import/export runs inline in a tRPC mutation/Route Handler, not through the worker/R2 pipeline - files are KB-scale (~38 units/project), so BullMQ is reserved for genuinely heavy async work. Hotspots need zero schema migration - floors.poligonoSvg/units.poligonoSvg already exist with anon-read RLS policies ready for the future explorador; the deliverable is a ~250-line hand-rolled SVG pointer-events component, explicitly rejecting canvas libraries (Konva) as a violation of the product's "sin motor tipo game engine" decision. Leads get a lightweight 4-state pipeline (no CRM automation) with a queued, idempotent email on state transitions. One real schema change is likely warranted: a UNIQUE(unit_id, price_list_id) constraint on unit_prices to make the grid/Excel upsert idempotent and keep the shipped quote resolver correct.

The dominant risk class is untrusted structured input reaching integer-money columns and RLS-forced tables through authenticated-but-not-necessarily-authorized users - this is the first milestone where developer-facing write surfaces are broad. The top mitigations: never trust typed numbers from Excel cells (float contamination of exact-integer-USD), validate-then-transact imports (no partial writes), add a role gate in tRPC middleware (RLS proves tenant isolation, not authorization - a viewer must not be able to write), sanitize exports against formula/CSV injection, and never install xlsx (SheetJS) from npm (unmaintained, CVE-2023-30533 prototype pollution) - use exceljs instead.

## Key Findings

### Recommended Stack

Only one net-new runtime dependency this milestone: exceljs@4.4.0 (MIT) for both Excel import and export, installed in apps/panel or packages/api. Explicitly do not install xlsx/SheetJS from npm - frozen at vulnerable 0.18.5, CVE-2023-30533 (prototype pollution on file read, i.e. the import path) unpatched on that channel. The SVG hotspot editor needs no library - a hand-rolled React 19 pointer-events `<svg>` component, since the stored format (poligonoSvg = raw SVG points) already is the editor's output; every maintained library is either canvas-based (contradicts product decision) or a heavyweight W3C-annotation framework. The leads inbox and email need no new dependency - Resend, React Email, BullMQ, and the schema are all already in place. The unit grid needs no new dependency - a plain controlled `<table>` covers ~38 rows; reach for @tanstack/react-table only if sort/filter/virtualization actually becomes necessary.

**Core technologies:**
- exceljs@4.4.0 - Excel import + export in apps/panel/packages/api - MIT, installs cleanly from npm (unlike SheetJS), one dependency covers both read and write
- Hand-rolled `<svg viewBox>` component - hotspot editor - matches existing stored data format exactly, no serialize/deserialize impedance layer, keeps page weight down
- Existing Resend + React Email + BullMQ - lead notification - reuse the invitation/quote-pdf email pattern verbatim, no new infra

### Expected Features

**Must have (table stakes, P1):**
- D1: editable grid with inline edit of price + estado (2-click flow, the panel's raison d'être)
- D1: price by list/payment-form with vigencia (schema already models this as a matrix unit x price_list)
- D1: Excel export (defines the canonical import template) then Excel import with validation + dry-run preview
- D2: leads inbox - list + detail + origin (broker/unit/quote) + 4 fixed states + notes timeline
- D2: email notification on new lead (queued, non-blocking)
- Hotspot editor: draw/edit/delete polygon + link to unit/floor (hard dependency for the future fase-2 explorador)

**Should have (P2, add after validation):**
- Bulk price edit (% or fixed amount) across selection/list - Argentine inflation/CAC context makes this valuable but the import path already covers the mass-edit case
- Enriched diff in import preview (field-by-field, not just row count)
- Snapping + hover-preview in hotspot editor
- ISR on-demand revalidation for "instant" price reflection in the public picker (full SSE deferred to fase 2/explorador)

**Defer / anti-features (explicitly excluded, "CRM completo" line):**
- Configurable lead pipeline states, automated follow-up sequences/scoring/routing, multi-salesperson assignment, generic column-mapping wizard for arbitrary Excel, formula/multi-sheet Excel parsing, bezier/freeform/AI-assisted hotspot drawing, visible price-history audit UI (data is captured, UI is not), realtime multi-cursor collaboration, online reservations with payment

### Architecture Approach

Three new panel surfaces attach to the existing monorepo as new tRPC routers (units, leads, hotspots) mounted in _app.ts, each writing through withTenant(ctx.activeOrgId, ...) exactly like the shipped quotes/projects/media routers. The panel gains a project-scoped route group (proyectos/[id]/{unidades,leads,hotspots}) since today it's a single dashboard - this shared layout is a prerequisite (Wave 1) for all three features. Excel parse/build logic lives in a pure packages/api/src/excel/ module (I/O-free, unit-testable, mirroring the packages/quoting purity bias); the only I/O boundary is the mutation itself.

**Major components:**
1. units router (NEW) - grid list/updateEstado/upsertPrice/importExcel, all requireRole("owner","developer"), inline Excel parse (no worker/R2)
2. leads router (NEW) - listForOrg/updateEstado, appends LeadNote to leads.timeline JSONB, enqueues EMAIL_QUEUE job
3. hotspots mutations (NEW, folded into units/floors) - setPolygon writing to existing poligonoSvg TEXT columns, zero migration for the data model
4. apps/worker email consumer (NEW) - clones the quote-pdf worker pattern (concurrency, jobId dedup, failed->Sentry+pino handler) to send lead notifications off the critical path
5. Migration: UNIQUE(unit_id, price_list_id) on unit_prices - makes grid/Excel upsert idempotent and protects the v1.2 quote resolver's one-row-per-unit-per-list assumption

### Critical Pitfalls

1. **Float contamination of money columns via Excel import** - Excel hands back JS floats for numeric cells; es-AR locale (. as thousands separator) makes naive parsing wrong ~half the time. Avoid: read money cells as raw text, define an explicit template, write one shared parseUsd/parseArs function, assert Number.isInteger post-parse, property-test the export->re-import round-trip.
2. **Partial-import inconsistency** - row-by-row insert without a transaction leaves half-committed state on a bad row. Avoid: validate the entire file first, run the write inside one withTenant transaction (all-or-nothing), make imports idempotent by natural key (onConflictDoUpdate).
3. **Formula/CSV injection on export + malicious file on import** - a lead name like =HYPERLINK(...) executes on the developer's machine when opened in Excel; this is cross-user since leads originate from anonymous public visitors. Avoid: prefix formula-leading cells on export, use exceljs (never npm xlsx), enforce file size/type/magic-byte checks on import.
4. **Role checks enforced only in the UI** - RLS proves tenant isolation, not authorization; a viewer role can still write if only protectedProcedure guards the mutation. Avoid: add a role-gated tRPC middleware (requireRole("owner","developer")) on every write, test a cross-role matrix (viewer->403).
5. **Notification storms / non-idempotent lead email** - BullMQ is at-least-once; naive send-in-mutation duplicates emails on retry or bulk import. Avoid: idempotency key per event (lead:{id}:{event}), only notify on real state transitions, debounce bursts into a digest, never await Resend inline in the mutation.
6. **SVG hotspot coordinates tied to pixels instead of intrinsic viewBox** - drift across viewports breaks the WYSIWYG guarantee for the future public explorador. Avoid: store points normalized to the render's intrinsic space (0-1000 viewBox), share the exact overlay component between editor and future viewer, use getScreenCTM().inverse() not manual pixel math.

## Implications for Roadmap

Based on research, suggested phase structure (research already sequences this precisely - see Architecture "Recommended Build Order"):

### Phase 0: Merge debt + staging re-verification
**Rationale:** v1.2 (cotizador) shipped on branch, not yet merged/re-verified live; this gates realistic staging verification of everything built afterward and is explicitly named as this milestone's first task.
**Delivers:** fase-0/foundation (current branch) merged to main; rate-limit 429, full PDF flow, and QR-with-staging-URL re-verified live.
**Avoids:** building three new feature surfaces on top of unverified infra debt.

### Phase 1: Panel project-scoped shell
**Rationale:** D1, D2, and the hotspot editor are all project-scoped (proyectos/[id]/...), but the panel today is a single dashboard. This shared layout + tab nav is a hard prerequisite for all three features and has zero feature-specific risk - build it first and once.
**Delivers:** proyectos/[id]/layout.tsx with tab navigation, reusing projects.listForOrg.
**Addresses:** enables D1/D2/hotspot editor routes.
**Avoids:** duplicating project-context plumbing three times.

### Phase 2: D1 - Grilla de unidades + Excel import/export
**Rationale:** Highest-value surface; establishes the write-under-withTenant + requireRole pattern that D2 and hotspots then clone; forces the unit_prices uniqueness decision that also protects the v1.2 quote engine - do this before anything else touches pricing.
**Delivers:** editable grid (inline price/estado edit), Excel export (canonical template), Excel import (validate -> dry-run preview -> transactional upsert), UNIQUE(unit_id, price_list_id) migration.
**Uses:** exceljs@4.4.0, existing withTenant, Zod re-validation via drizzle-zod.
**Avoids:** Pitfall 1 (float money contamination), Pitfall 2 (partial-import inconsistency), Pitfall 3 (formula injection / unmaintained xlsx), Pitfall 4 (role-only-in-UI), Pitfall 12 (es-AR encoding/date locale).

### Phase 3: D2 - Bandeja de leads + email notification
**Rationale:** Mutually independent from D1 (can run in parallel once the shell exists); reuses the role-gate and audit patterns established in Phase 2.
**Delivers:** leads list + detail (origin joins) + 4-state pipeline + notes timeline + queued idempotent email on new lead / state change.
**Implements:** leads router, EMAIL_QUEUE cloned from quote-pdf worker contract.
**Avoids:** Pitfall 5 (notification storms/idempotency), Pitfall 6 (free-form status instead of enforced state machine).

### Phase 4: Editor de hotspots
**Rationale:** Most UI-heavy (SVG drawing), needs confirmation of where the building-level exterior render lives, and its only consumer (the fase-2 explorador) is a later milestone - lowest schedule risk if it slips to the end; fully parallelizable with Phase 2/3 if capacity allows.
**Delivers:** hand-rolled SVG polygon draw/edit/delete component, floors.setPolygon/units.setPolygon mutations, linking UI to unit/floor.
**Implements:** zero-migration hotspot data model (existing poligonoSvg columns).
**Avoids:** Pitfall 7 (pixel-tied coordinates vs viewBox), Pitfall 8 (no render-version binding/staleness flag), Pitfall 11 (degenerate/self-intersecting polygons).

### Phase Ordering Rationale

- Phase 0 is non-negotiable first: no feature work should build on unverified staging infra debt.
- Phase 1 (shell) is a structural prerequisite discovered by architecture research - none of D1/D2/hotspots have a route to live in today.
- D1 before D2: D1 forces the unit_prices uniqueness/upsert decision that protects the already-shipped quote resolver, and establishes the role-gate + audit pattern D2 and hotspots then reuse - sequencing this first de-risks the highest-stakes surface (money) earliest.
- Hotspots last: zero dependency on D1/D2, and its downstream consumer (public explorador) belongs to a future milestone, so it carries the least schedule risk if deprioritized.
- Explicitly deferred out of all phases: SSE/pg_notify price propagation (no consumer exists yet; funnel writes through one path now so fase-5 can add NOTIFY in one line later) and price-history audit UI (data captured via vigencia/audit events, UI deferred).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (D1 Excel import):** money-parsing edge cases (es-AR locale, date format DD/MM/YYYY, encoding) warrant a research-phase pass on the exact validation/error-report UX before planning the mutation.
- **Phase 4 (Hotspot editor):** the open confirmation on where the building-level exterior render lives (vs floors.renderKey for floor plans) should be resolved before planning starts - flag for --research-phase or a quick architecture spike.

Phases with standard patterns (skip research-phase):
- **Phase 0 (merge/verify):** mechanical - no new research needed, reruns existing UAT.
- **Phase 1 (shell):** standard Next.js App Router route-group + layout pattern, already proven elsewhere in the panel.
- **Phase 3 (D2 leads/email):** clones the shipped quote-pdf worker/BullMQ/Resend contract almost verbatim; well-documented pattern in-repo.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry 2026-07-17; SheetJS CVE cross-checked against official advisory; single net-new dependency minimizes risk surface |
| Features | MEDIUM-HIGH | Inventory-grid/CSV-import/lightweight-CRM/polygon-editor patterns are standard and well-documented (HIGH); the specific Argentine-preventa/~38-unit/single-design-partner scope cut is product judgment (MEDIUM) |
| Architecture | HIGH | Verified directly against in-repo schema, routers, worker, and panel code - not inferred from generic patterns |
| Pitfalls | HIGH | Engineering pitfalls well-established; library/security specifics cross-checked against OWASP + npm advisories; stack-integration points derived from this repo's own shipped v1.0-v1.2 decisions |

**Overall confidence:** HIGH

### Gaps to Address

- **Building-level exterior render location:** confirm whether the building/exterior background image (for floor-level hotspots) lives on a projects field or a designated media row, before wiring the floor editor's canvas - flagged as LOW-risk but blocking for Phase 4 planning.
- **Inline vs queued email default:** architecture research recommends queuing (matches the async/observability precedent) but flags inline Resend (the invitation pattern) as an acceptable fallback if queue wiring is deemed out of budget - this trade-off should be explicitly decided during Phase 3 planning, not left ambiguous.
- **Bulk edit (%/fixed) placement:** currently P2 (add after validation); confirm at Phase 2 planning whether it should be pulled into the initial D1 scope if the design partner (Pablo) requests it early - respects the project's A/B scope rule (don't build [B] speculatively).
- **events row emission per lead/price transition:** optional and cheap per architecture research, but the metrics consumer (fase 6) is out of scope - decide at Phase 2/3 planning whether to emit now (cheap, forward-compatible) or defer entirely.

## Sources

### Primary (HIGH confidence)
- npm registry (npm view <pkg> version license peerDependencies time.modified), 2026-07-17 - exact versions/peers/licenses for exceljs, @protobi/exceljs, read/write-excel-file, polygon-annotation, react-konva, @annotorious/react
- CVE-2023-30533 - Prototype Pollution in SheetJS (GitHub Advisory GHSA-4r6h-8v6p-xvw6) - confirms unpatched npm xlsx affects the file-read (import) path
- OWASP - CSV Injection - formula-injection trigger characters and prefix mitigation
- In-repo schema/routers/worker/storage: packages/db/src/schema/{units,floors,unit-prices,price-lists,leads,quotes,events,enums}.ts, packages/api/src/trpc/routers/{quotes,projects,media}.ts, apps/worker/src/index.ts, packages/storage/src/queue.ts - source of truth for the existing tenancy/queue contracts being extended
- .planning/PROJECT.md, docs/modelo-mvp.md §2.1-§3.3 - feature scope, A/B cut rule, anti-CRM boundary

### Secondary (MEDIUM confidence)
- Kalzumeus - Design & Implementation of CSV/Excel Upload for SaaS - why a canonical template beats arbitrary-format wizards
- RoofAI - 2026 real estate lead management playbook - <5min response = 9x conversion rationale; lightweight-vs-CRM boundary
- ExcelJS maintenance status discussion #2987/#3008 - upstream "inactive" but stable, active fork exists as escape hatch

### Tertiary (LOW confidence)
- None flagged - all findings cross-checked against at least one HIGH-confidence primary source.

---
*Research completed: 2026-07-17*
*Ready for roadmap: yes*
