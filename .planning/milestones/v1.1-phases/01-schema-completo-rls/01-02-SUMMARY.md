---
phase: 01-schema-completo-rls
plan: 02
subsystem: database
tags: [drizzle, postgres, rls, multi-tenant, drizzle-zod, jsonb, money]

# Dependency graph
requires:
  - phase: 01-schema-completo-rls (plan 01-01)
    provides: projects.ts RLS template, enums.ts (monedaEnum, ajusteTipoEnum), json-schemas.ts (Refuerzo, QuoteSnapshot), roles.ts (appAuthenticated, anonRole), units.ts composite-FK parent
provides:
  - price_lists table (tenant clone, anon-published, monedaEnum)
  - unit_prices table (FLAG-D denormalized project_id, triple composite-FK, integer USD precio)
  - payment_plans table (typed refuerzos jsonb + paymentPlanInsertSchema validator)
  - cac_index table (org-scoped, tenant-private, decimal valor)
  - quotes table (tenant-private, versioned snapshot envelope + quoteInsertSchema, deferred lead FK)
affects: [01-04 (registration + migration + lead FK hand SQL), 01-06 (RLS behavior tests), Fase-3 cotizador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pricing/quotes tables as tenant clones of projects.ts RLS template"
    - "FLAG-D: denormalized project_id on grandchild tables for uniform single-level anon EXISTS"
    - "Tenant-private exception: tenant-only pgPolicy, no anon policy/grant (cac_index, quotes)"
    - "Typed JSONB + co-located drizzle-zod createInsertSchema refine as boundary validator"
    - "Module-graph cycle-break: nullable leadId with no .references()/import; FK deferred to hand SQL"

key-files:
  created:
    - packages/db/src/schema/price-lists.ts
    - packages/db/src/schema/unit-prices.ts
    - packages/db/src/schema/payment-plans.ts
    - packages/db/src/schema/cac-index.ts
    - packages/db/src/schema/quotes.ts
  modified: []

key-decisions:
  - "Money typing per D-14: unit_prices.precio is integer (USD whole units); cac_index.valor and payment_plans.anticipo_pct are numeric (decimal) — never float"
  - "cac_index is the org-scoped exception (no project_id) and tenant-private (no anon policy/grant)"
  - "quotes is tenant-private (only quotes_tenant policy); snapshot is the versioned { version: 1 } envelope"
  - "leadId on quotes is a nullable pointer with no Drizzle reference; the FK to leads is added in 01-04 hand SQL to keep the module graph acyclic"
  - "vigencia uses timestamp with timezone (UTC in DB per CLAUDE.md)"

patterns-established:
  - "FLAG-D denormalized project_id keeps the anon-published policy a uniform single-level EXISTS across the whole catálogo (floors, units, price_lists, unit_prices)"
  - "Tenant-private tables omit the anon pgPolicy entirely; the hand migration grants app DML only so anon SELECT raises 42501"

requirements-completed: [SCHEMA-02, SCHEMA-03]

coverage:
  - id: D1
    description: "price_lists tenant clone with monedaEnum + anon-published EXISTS policy"
    requirement: "SCHEMA-02"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/db typecheck && pnpm --filter @imbau/db lint"
        status: pass
    human_judgment: false
  - id: D2
    description: "unit_prices FLAG-D (denormalized project_id), triple composite-FK (projects/units/price_lists), integer USD precio"
    requirement: "SCHEMA-02"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/db typecheck (3 foreignKey + integer precio + anon EXISTS on project_id)"
        status: pass
    human_judgment: false
  - id: D3
    description: "payment_plans typed refuerzos jsonb + co-located paymentPlanInsertSchema validator"
    requirement: "SCHEMA-02"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/db typecheck && lint"
        status: pass
    human_judgment: false
  - id: D4
    description: "cac_index org-scoped, tenant-private (no project_id, single tenant policy, decimal valor)"
    requirement: "SCHEMA-02"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/db typecheck && lint"
        status: pass
    human_judgment: false
  - id: D5
    description: "quotes tenant-private versioned-snapshot table + quoteInsertSchema, deferred lead FK"
    requirement: "SCHEMA-03"
    verification:
      - kind: automated_ui
        ref: "pnpm --filter @imbau/db typecheck && lint"
        status: pass
    human_judgment: false
  - id: D6
    description: "RLS runtime behavior: anon cannot read quotes/cac_index (42501); published pricing visible; tenant isolation"
    requirement: "SCHEMA-02"
    verification: []
    human_judgment: true
    rationale: "RLS enforcement is only observable after migrate against a live Postgres; asserted in plan 01-06, not at schema-authoring time"

# Metrics
duration: 14min
completed: 2026-06-27
status: complete
---

# Phase 01 Plan 02: Pricing + Quotes Domain Summary

**Five tenant-scoped Drizzle tables (price_lists, unit_prices, payment_plans, cac_index, quotes) cloned from the projects.ts RLS template — integer/decimal money, typed-and-validated JSONB, FLAG-D project_id denormalization, and the two tenant-private exceptions.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-27T17:11Z
- **Completed:** 2026-06-27T17:25Z
- **Tasks:** 3
- **Files modified:** 5 created

## Accomplishments
- `price_lists` + `unit_prices` (SCHEMA-02): tenant clones; unit_prices is FLAG-D-uniform (denormalized `project_id`) with triple composite-FK integrity to projects, units, and price_lists, and `precio` typed as `integer` (USD whole units — D-14).
- `payment_plans` + `cac_index` (SCHEMA-02): payment_plans carries typed `refuerzos` jsonb (`$type<Refuerzo[]>()`) with a co-located `paymentPlanInsertSchema` runtime validator (D-12); cac_index is the org-scoped, tenant-private exception (no project_id, no anon policy/grant) with decimal `valor`.
- `quotes` (SCHEMA-03): tenant-private versioned-envelope table with `snapshot` typed `$type<QuoteSnapshot>()` + `quoteInsertSchema`, ready for the Fase-3 cotizador; `leadId` is a nullable pointer with the FK deferred to 01-04 hand SQL (cycle-break).
- All five modules pass `typecheck` + `lint` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: price_lists + unit_prices (FLAG-D)** - `96efeac` (feat)
2. **Task 2: payment_plans (refuerzos JSONB) + cac_index (tenant-private)** - `a867206` (feat)
3. **Task 3: quotes (versioned snapshot, tenant-private)** - `dba684e` (feat)

_Note: tasks were marked `tdd="true"` but their `<verify>` blocks specify only `typecheck && lint` (no test target in `<files>`); behavioral RLS verification is deferred to plan 01-06. Executed as auto tasks gated on typecheck+lint+structural acceptance greps — see TDD Gate Compliance below._

## Files Created/Modified
- `packages/db/src/schema/price-lists.ts` - project-scoped price list; monedaEnum; tenant + anon-published policies
- `packages/db/src/schema/unit-prices.ts` - FLAG-D project_id; triple composite-FK; integer USD precio; anon single-level EXISTS
- `packages/db/src/schema/payment-plans.ts` - anticipo/cuotas/ajuste; typed refuerzos jsonb; paymentPlanInsertSchema
- `packages/db/src/schema/cac-index.ts` - org-scoped, tenant-private; decimal valor; unique(org, periodo)
- `packages/db/src/schema/quotes.ts` - tenant-private; versioned snapshot envelope; quoteInsertSchema; deferred lead FK

## Decisions Made
- Followed the plan exactly. Money typing per D-14 (integer USD / numeric decimal, never float); `vigencia` typed `timestamp` with timezone (UTC in DB per CLAUDE.md); `refuerzos` defaults to an empty `'[]'::jsonb` literal so a row with no refuerzos is well-formed.
- `index.ts` / `drizzle.config.ts` left untouched per plan — table registration and migration are owned by plan 01-04.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The interactive shell defaulted to Node 20, under which `pnpm` (via Corepack) crashed with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`. Resolved by sourcing nvm and selecting Node 22 LTS before every pnpm invocation (matches the project's pinned runtime). No code impact.

## TDD Gate Compliance
The three tasks carry `tdd="true"`, but each `<verify>` block defines only `pnpm --filter @imbau/db typecheck && lint` and lists no test file in `<files>`. These are declarative Drizzle schema modules whose correctness is verified by the compiler, ESLint, and structural acceptance-criteria greps (all passed); their runtime RLS behavior (anon 42501 on quotes/cac_index, tenant isolation, published-pricing visibility) is intentionally asserted post-migration in plan 01-06. No standalone RED/GREEN test commits were produced because no behavioral test target exists at this layer. Phase config `tdd_mode` is `false`, so the MVP+TDD runtime gate did not apply.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All five pricing/quotes tables compile and lint clean, ready for registration + migration in plan 01-04 (which also adds the `quotes.lead_id → leads` single-column FK in hand SQL and the no-anon-GRANT for quotes/cac_index).
- RLS behavior assertions (anon cannot read quotes/cac_index; tenant isolation; published pricing visible) are queued for plan 01-06 after migrate.
- Boundary validators `paymentPlanInsertSchema` and `quoteInsertSchema` are exported for the Fase-3/Fase-4 API to consume.

## Self-Check: PASSED
- All 5 schema files present (price-lists, unit-prices, payment-plans, cac-index, quotes).
- All 4 commits present in git log (96efeac, a867206, dba684e, 1ed4016).
- `typecheck` + `lint` exit 0; structural acceptance greps satisfied.

---
*Phase: 01-schema-completo-rls*
*Completed: 2026-06-27*
