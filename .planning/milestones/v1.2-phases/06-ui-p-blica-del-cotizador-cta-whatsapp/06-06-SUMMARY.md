---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 06
subsystem: testing
tags: [e2e, playwright, cotizador, whatsapp, es-AR, postgres]

# Dependency graph
requires:
  - phase: 06-05
    provides: cotizador route + simulator island (picker, slider, live compute, WhatsApp CTA) at /p/[slug]/cotizador
  - phase: 06-02
    provides: apps/web Vitest + Playwright infra (port 3110, webServer against Compose dev DB)
  - phase: 06-01
    provides: picker anon router + project.whatsapp column
provides:
  - Playwright e2e coverage of the demo-critical buyer flow (picker/deep-link → live result → slider → leyenda → WhatsApp CTA)
  - Runtime seed resolver (apps/web/e2e/seed-helpers.ts) for the Brigos Recoleta fixtures
  - playwright.config webServer.env fix so a fresh `pnpm --filter @imbau/web test:e2e` builds+runs
affects: [staging-uat, phase-07-pdf, regression-suite]

# Tech tracking
tech-stack:
  added: [postgres@3.4.9 (apps/web devDep, for the e2e seed resolver)]
  patterns:
    - "e2e resolves seeded fixtures from Postgres at runtime (no hardcoded ids) — a re-seed never rots the specs"
    - "wa.me CTA verified by a page.route interceptor that captures + stubs the off-site navigation target"
    - "money assertions target the deterministic formatUsd/formatArs shape (US$ / $ es-AR), never Intl currency output (U+202F tell)"

key-files:
  created:
    - apps/web/e2e/seed-helpers.ts
    - apps/web/e2e/picker.spec.ts
    - apps/web/e2e/cotizador.spec.ts
    - apps/web/e2e/whatsapp-cta.spec.ts
  modified:
    - apps/web/playwright.config.ts
    - apps/web/package.json

key-decisions:
  - "Result/CTA specs drive the PRICIEST disponible unit — cheap unit + high-refuerzo plan legitimately yields SALDO_NO_POSITIVO (the documented soft-error path), which is not a valid result view to assert against"
  - "Seed fixtures resolved from the dev DB at runtime via `postgres`, mirroring the panel auth e2e, rather than hardcoding uuids"
  - "wa.me navigation intercepted + stubbed (fulfill), asserting the app-built URL rather than really opening WhatsApp"

patterns-established:
  - "Runtime seed resolver with fail-fast remediation message (`pnpm db:seed`) when the seeded project is absent"
  - "es-AR money assertion: match `US$ `/`$ 1.234,56` shapes and assert absence of U+202F (Intl currency tell)"

requirements-completed: [UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, WA-01]

coverage:
  - id: D1
    description: "Picker (floor→unit, disponible-only selectable) reaches the result view with ?u=; a ?u=&plan= deep-link renders the result directly, no picker (UI-01)"
    requirement: "UI-01"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/picker.spec.ts#picker: floor→unit, only disponible selectable, reaches result with ?u"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/picker.spec.ts#deep-link: ?u=&plan= renders the result view directly, no picker"
        status: pass
    human_judgment: false
  - id: D2
    description: "Result view: financiado breakdown (precio/anticipo%/cuotas/primera cuota ARS/refuerzos/totals), contado+financiado comparison with savings band, es-AR formatUsd/formatArs (not Intl), preset-slider plan swap, and the no-vinculante leyenda (UI-02..06)"
    requirement: "UI-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/cotizador.spec.ts#result, comparison, es-AR amounts, slider, leyenda"
        status: pass
    human_judgment: false
  - id: D3
    description: "WhatsApp CTA navigates to a fixed-host https://wa.me/<digits> with the seeded number and a text param decoding to the unit/proyecto header + toWhatsAppText amounts + deep-link; PDF button renders disabled (WA-01)"
    requirement: "WA-01"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/whatsapp-cta.spec.ts#CTA opens a pre-filled wa.me URL; PDF button disabled"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-07-05
status: complete
---

# Phase 06 Plan 06: Cotizador e2e (picker → result → WhatsApp CTA) Summary

**Playwright e2e proving the demo-critical buyer flow end to end against the seeded Brigos Recoleta project — picker/deep-link, live contado-vs-financiado result with es-AR amounts, preset-slider plan swap, no-vinculante leyenda, and a fixed-host wa.me CTA — closing the phase's Nyquist apps/web e2e gap.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-05T18:45:00Z (approx)
- **Completed:** 2026-07-05T22:25:00Z
- **Tasks:** 3
- **Files created/modified:** 6 (4 created, 2 modified; + pnpm-lock.yaml)

## Accomplishments
- `picker.spec.ts` (UI-01): the floor→unit picker with disponible-only selectability (reservado/vendido disabled) reaches the result view and writes `?u=`; a `?u=&plan=` deep-link renders the result directly with no picker step.
- `cotizador.spec.ts` (UI-02..06): the financiado breakdown, the contado/financiado comparison + compareQuotes savings band, deterministic `US$ `/`$ 1.234,56` es-AR formatting (asserted absent of the U+202F Intl-currency tell), the preset-slider plan swap (URL `?plan=` + cuotas change), and the `notasLegales` + "Cotización no vinculante" leyenda. Plus a slider burst asserting the 429 soft-tolerance never leaks a raw stack.
- `whatsapp-cta.spec.ts` (WA-01): the CTA target is intercepted and asserted as a fixed `https://wa.me/<seeded-digits>` URL whose `text` decodes to the unit/proyecto header, a `toWhatsAppText` amount and the shareable deep-link; the PDF button renders disabled ("Próximamente").
- `seed-helpers.ts`: a runtime resolver that reads the seeded project/floors/units/plans from the dev DB (fail-fast with a `pnpm db:seed` hint), so ids/identificadores are never hardcoded.
- Phase gate green locally: apps/web e2e 4/4, unit 26/26, typecheck clean, eslint clean.

## Task Commits

1. **Task 1: Picker + deep-link e2e (UI-01)** - `ef765c4` (test)
2. **Task 2: Result render + comparison + slider + es-AR e2e (UI-02..06)** - `661aa1f` (test)
3. **Task 3: WhatsApp CTA e2e + phase gate (WA-01)** - `72c5f52` (test)

## Files Created/Modified
- `apps/web/e2e/seed-helpers.ts` - Runtime resolver of the Brigos Recoleta fixtures (project, mixed floor, priciest result unit, plans) via `postgres`.
- `apps/web/e2e/picker.spec.ts` - UI-01 picker + deep-link specs.
- `apps/web/e2e/cotizador.spec.ts` - UI-02..06 result/comparison/es-AR/slider/leyenda spec.
- `apps/web/e2e/whatsapp-cta.spec.ts` - WA-01 CTA target + PDF-disabled spec.
- `apps/web/playwright.config.ts` - Added `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` to `webServer.env` (see deviation 1).
- `apps/web/package.json` - Added `postgres@3.4.9` devDep for the seed resolver.

## Decisions Made
- **Priciest-unit fixture for result assertions.** The seed contains unit+plan combinations that legitimately fail (`SALDO_NO_POSITIVO`) when a cheap unit meets a high-refuerzo plan — this is the documented soft-error path, not a bug. The result/CTA specs therefore drive the most expensive disponible unit (12A), whose financiado quote is valid for both seeded plans, guaranteeing a real result view to assert against. The picker spec still exercises a mixed floor (disponible + non-disponible side by side) for the selectability rule.
- **Runtime seed resolution over hardcoded ids**, mirroring the panel auth e2e's `postgres` usage — deterministic seed, but resilient to any future re-seed.
- **wa.me asserted via route interception + stub fulfill**, so no real off-site navigation occurs while still verifying the exact URL the app constructs (open-redirect guard T-06-06-REDIRECT).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `playwright.config.ts` webServer.env was missing the Better Auth vars**
- **Found during:** Task 1 (first build of apps/web under the e2e webServer)
- **Issue:** apps/web mounts the FULL `appRouter` at `/api/trpc` (D-06-A1, plan 05-05). Booting `@imbau/api` eagerly validates the Better Auth env (`auth/env.ts`) at `next build` page-data collection AND at `next start`. The webServer.env set only the `DATABASE_*` + `NEXT_PUBLIC_APP_ENV` vars, so a fresh `pnpm --filter @imbau/web test:e2e` failed to build with `Invalid environment variables: BETTER_AUTH_SECRET / BETTER_AUTH_URL`.
- **Fix:** Added `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` to `webServer.env` with dev defaults (no real secret material), overridable via `process.env` — mirroring the existing `DATABASE_*` pattern and honoring the context note ("when running the app server directly, export the full env in that process"). The owner-pool `DATABASE_URL` the auth env also needs was already present.
- **Files modified:** apps/web/playwright.config.ts
- **Verification:** Build succeeds; all 4 e2e specs run green.
- **Committed in:** `ef765c4` (Task 1 commit)

**2. [Rule 3 - Blocking] `postgres` devDependency added to apps/web**
- **Found during:** Task 1 (seed resolver import)
- **Issue:** The seed resolver reads the dev DB with the `postgres` driver (as the panel e2e does), but `postgres` was not a dependency of apps/web (only apps/panel).
- **Fix:** Added `postgres@3.4.9` to apps/web devDependencies — an already-approved workspace dependency (RESEARCH Package Legitimacy Audit; no new package introduced). Ran a full `pnpm install`.
- **Files modified:** apps/web/package.json, pnpm-lock.yaml
- **Verification:** `postgres` resolves in apps/web; typecheck + lint clean; specs pass.
- **Committed in:** `ef765c4` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). No new third-party packages; no architectural change; no scope creep.
**Impact on plan:** Both fixes were prerequisites for the plan's own verification (the suite could not build/run without them).

## Issues Encountered
- **`next start` prints "does not work with output: standalone".** apps/web sets `output: 'standalone'` for its Docker image; `next start` warns but still serves from `.next` — all pages rendered and every spec (real compute + render) passed. No action needed for e2e; the standalone artifact remains the Docker runtime path.

## Threat surface / prohibitions
- WA-01 spec asserts the CTA host is the fixed `https://wa.me/` literal with only seeded digits (T-06-06-REDIRECT mitigated).
- Money assertions match the exact `US$ `/`$ ` es-AR formatter output and assert the absence of U+202F, satisfying the plan's prohibition against Intl-currency/`toLocaleString` assertions.

## User Setup Required
None - no external service configuration required for the e2e run (uses the local Compose dev DB + seeded Brigos Recoleta).

## Next Phase Readiness
- The demo-critical cotizador flow is covered by automated e2e; the apps/web suite is green as the phase gate.
- **Staging UAT dependency (unchanged):** the authoritative live re-check of QUOTE-03 (429 burst tolerance in the browser) depends on PR #1 → main landing the fase-5 quotes tRPC route on staging (STATE.md: staging currently runs a pre-fase-5 image). Deploy ordering: merge the quotes route to main first, then the staging UAT of the 429 soft-path can run against the live edge rate-limiter. The in-browser slider-burst assertion here confirms the soft-degradation locally in the meantime.
- **Seed provisioning for e2e:** `pnpm db:seed` must have populated the Compose dev DB (`imbau`) with Brigos Recoleta before the suite; `seed-helpers.ts` fails fast with that remediation if the project is absent.

## Self-Check: PASSED

- All 4 e2e spec/helper files present on disk.
- All 3 task commits (`ef765c4`, `661aa1f`, `72c5f52`) present in git history.
- Local gate green: apps/web e2e 4/4, unit 26/26, typecheck clean, eslint clean.

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
