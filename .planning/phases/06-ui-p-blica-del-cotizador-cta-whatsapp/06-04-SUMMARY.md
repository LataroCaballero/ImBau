---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 04
subsystem: ui
tags: [frontend, presentational, whatsapp, quote-result, es-ar-format, slider]

# Dependency graph
requires:
  - phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
    plan: 02
    provides: "apps/web Tailwind v4 brand shell (@theme tokens: grafito/carbon/hormigon/cobre + font-mono), vitest jsdom infra"
  - phase: 03-motor-de-cotizacion (milestone v1.x)
    provides: "@imbau/quoting: QuoteResult contract + formatUsd/formatArs/compareQuotes/toWhatsAppText"
provides:
  - "apps/web/lib/whatsapp.ts buildWhatsappUrl — safe wa.me deep-link from a QuoteResult (WA-01)"
  - "apps/web/lib/plan-snap.ts sortPlans/planToIndex/indexToPlan/isSingle — planId <-> slider index (UI-04)"
  - "apps/web/components/quote-cards.tsx QuoteCards — contado/financiado comparison + leyendas (UI-02/03/05/06)"
  - "apps/web/components/plan-slider.tsx PlanSlider — snap-to-preset native range (UI-04)"
  - "apps/web vitest JSX/TSX render-test capability (esbuild pre-transform bridging Next jsx:preserve)"
affects: [06-05, cotizador-island, whatsapp-cta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure presentational leaves consume ONE QuoteResult; all money via @imbau/quoting formatters (no Intl/locale APIs in the app)"
    - "Snap-to-preset slider = integer index into sorted payment_plans[]; only a planId ever crosses the API boundary"
    - "vitest JSX bridge: a pre-plugin transpiles .tsx with esbuild (via Vite transformWithEsbuild) so Next's required jsx:preserve tsconfig still hosts render tests"

key-files:
  created:
    - apps/web/lib/whatsapp.ts
    - apps/web/lib/whatsapp.test.ts
    - apps/web/lib/plan-snap.ts
    - apps/web/lib/plan-snap.test.ts
    - apps/web/components/quote-cards.tsx
    - apps/web/components/quote-cards.test.tsx
    - apps/web/components/plan-slider.tsx
  modified:
    - apps/web/vitest.config.ts
    - apps/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Added @imbau/quoting as an apps/web workspace dependency (was absent) so the UI can import the engine's formatters + QuoteResult contract"
  - "Bridged Next's jsx:preserve tsconfig to vitest with a zero-new-package esbuild pre-plugin (Vite transformWithEsbuild) rather than adding @vitejs/plugin-react (honors T-06-SC no-new-packages)"

requirements-completed: [UI-02, UI-03, UI-04, UI-05, UI-06, WA-01]

# Metrics
duration: ~30min
completed: 2026-07-05
status: complete
---

# Phase 6 Plan 04: Cotizador presentational layer + wa.me builder Summary

**The pure/presentational leaves of the cotizador — a safe wa.me deep-link builder, a snap-to-preset plan slider, and the contado/financiado quote-cards comparison — all driven by one `QuoteResult` and the deterministic `@imbau/quoting` formatters, proven by 20 unit + render tests.**

## Performance
- **Duration:** ~30 min
- **Completed:** 2026-07-05
- **Tasks:** 3 (Tasks 1 & 2 TDD: RED + GREEN)
- **Files:** 7 created, 3 modified

## Accomplishments
- `buildWhatsappUrl` produces a fixed-host `https://wa.me/<digits>?text=<encoded>` URL from a `QuoteResult` + project number, stripping the number to digits (open-redirect guard, T-06-04-REDIRECT) and using `toWhatsAppText(result)` verbatim as the body (no drift, T-06-04-DRIFT). Returns `null` when the number is absent so the CTA is hidden (D-02 — no dead button).
- `plan-snap` maps a planId to/from an integer slider index over a deterministically sorted plans array (anticipoPct asc, tie-break cuotas asc) and flags the single-plan degenerate case — the only bridge between a slider position and the `paymentPlanId` the API accepts, so free terms remain structurally impossible (UI-04).
- `QuoteCards` renders the contado + financiado comparison side-by-side (stacked on mobile), the `compareQuotes` savings band, refuerzos, totals, and the `notasLegales` + "Cotización no vinculante" leyenda — every amount via `formatUsd`/`formatArs` (UI-06), including the fijo-plan primera-cuota-as-USD fallback.
- `PlanSlider` is a native `<input type="range">` snapping to plan indices, disabled for single-plan projects, labelled with the selected plan's `anticipoPct%` + cuotas.
- apps/web can now run `.tsx` component render tests: a `pre` vitest plugin transpiles JSX with esbuild, working around Next's required `jsx: "preserve"` tsconfig (which otherwise leaves raw JSX for Vite's import-analysis to reject).

## Exported contract for Plan 05 (wire without guessing)

```ts
// apps/web/lib/whatsapp.ts
type BuildWhatsappUrlArgs = {
  whatsapp: string | null;
  unitIdentificador: string;
  projectNombre: string;
  result: QuoteResult;
  deepLinkUrl: string;
};
function buildWhatsappUrl(args: BuildWhatsappUrlArgs): string | null;

// apps/web/lib/plan-snap.ts
type SnapPlan = { id: string; anticipoPct: string; cuotas: number };
function sortPlans<T extends SnapPlan>(plans: readonly T[]): T[];
function planToIndex(plans: readonly SnapPlan[], planId: string): number; // -1 if absent
function indexToPlan<T extends SnapPlan>(plans: readonly T[], index: number): T | undefined; // clamped
function isSingle(plans: readonly SnapPlan[]): boolean;

// apps/web/components/quote-cards.tsx
type QuoteCardsProps = {
  contado: ContadoResult;
  financiado: FinanciadoResult;
  anticipoPct: string;      // selected plan's anticipo %, e.g. "30"
  notasLegales: string | null;
};
function QuoteCards(props: QuoteCardsProps): JSX.Element;

// apps/web/components/plan-slider.tsx  ("use client")
type PlanSliderProps<T extends SnapPlan> = {
  plans: T[];
  planId: string;
  onSelect: (planId: string) => void;
};
function PlanSlider<T extends SnapPlan>(props: PlanSliderProps<T>): JSX.Element;
```

Plan 05's island: run two `quotes.compute`s (contado + financiado), feed both to `QuoteCards`, drive the selected plan through `PlanSlider` (`onSelect` → recompute), and on the CTA fire `quotes.create` then `window.location.href = buildWhatsappUrl(...)` (skip the CTA when it returns `null`).

## Task Commits
1. **Task 1 RED** — failing tests for wa.me + plan-snap: `ccdc250` (test)
2. **Task 1 GREEN** — buildWhatsappUrl + plan-snap + @imbau/quoting dep: `9089cb3` (feat)
3. **Task 2 RED** — failing quote-cards render test + JSX transform config: `c9372ed` (test)
4. **Task 2 GREEN** — QuoteCards component + config typing: `11a8676` (feat)
5. **Task 3** — plan-slider snap-to-preset control: `85531db` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] apps/web did not depend on @imbau/quoting**
- **Found during:** Task 1 (GREEN test run)
- **Issue:** `whatsapp.ts`/`quote-cards.tsx` import `@imbau/quoting`, but apps/web's package.json did not declare it, so vitest could not resolve the module.
- **Fix:** Added `"@imbau/quoting": "workspace:*"` to apps/web dependencies and reran `pnpm install`. Internal workspace package (already vetted in the monorepo) — not an external install, so no supply-chain/checkpoint concern.
- **Files:** apps/web/package.json, pnpm-lock.yaml
- **Commit:** 9089cb3

**2. [Rule 3 - Blocking] Next's jsx:preserve tsconfig blocked component render tests in vitest**
- **Found during:** Task 2 (render test infra)
- **Issue:** apps/web's tsconfig sets `jsx: "preserve"` (required by Next), so Vite's esbuild pass left JSX untransformed and `vite:import-analysis` failed on `.tsx` test files with "content contains invalid JS syntax" (the same class of issue Plan 02 hit for the trpc-client module). Root-level `esbuild.jsx`/`tsconfigRaw` overrides did not fix it.
- **Fix:** Added a `pre` vitest plugin that transpiles `.tsx`/`.jsx` with esbuild via Vite's `transformWithEsbuild` (resolved through vitest's own dependency tree). This keeps the app tsconfig Next-correct while enabling render tests, with ZERO new packages — honoring the plan's T-06-SC prohibition (`@vitejs/plugin-react` would have been the conventional but package-adding route).
- **Files:** apps/web/vitest.config.ts
- **Commit:** c9372ed (added), 11a8676 (typing finalized: local TransformWithEsbuild type + non-async hook so typecheck + lint stay clean)

**3. [Rule 1 - Bug] Explanatory comment tripped the plan's own negative grep**
- **Found during:** Task 1 (verify step)
- **Issue:** A comment in whatsapp.ts literally contained the token the plan's `! grep -q 'toLocaleString'` check forbids (same class as Plan 02 deviation 4), failing the automated verification despite correct code.
- **Fix:** Reworded the comment to describe intent without the literal token. No behavior change.
- **Files:** apps/web/lib/whatsapp.ts
- **Commit:** 9089cb3

**Total:** 3 auto-fixed (2 Rule 3, 1 Rule 1). No scope creep; no architectural changes.

## Threat mitigations applied (from plan threat_model)
- **T-06-04-REDIRECT:** `buildWhatsappUrl` host is the fixed `https://wa.me/` literal; only `[0-9]` digits of the project number are interpolated. Covered by the "fixed host" test.
- **T-06-04-DRIFT:** all amounts via `formatUsd`/`formatArs`; WhatsApp body via `toWhatsAppText(result)`; savings via `compareQuotes` — nothing re-formatted or re-computed in the app. Grep-clean of `toLocaleString`/`Intl.NumberFormat` in both whatsapp.ts and quote-cards.tsx.
- **T-06-04-XSS:** values rendered as React children (auto-escaped); no `dangerouslySetInnerHTML`.
- **T-06-SC:** no new packages added (JSX bridge uses the already-present esbuild via Vite).

## Verification
- `pnpm --filter @imbau/web test` → 5 files, 26 tests pass (20 for this plan's helpers/component + 6 pre-existing).
- `pnpm --filter @imbau/web typecheck` → exit 0.
- `pnpm --filter @imbau/web lint` → exit 0.
- Grep gates: whatsapp.ts has `https://wa.me/` + `toWhatsAppText`, no `toLocaleString`/`Intl`; quote-cards.tsx has `formatUsd`/`formatArs`/`compareQuotes`/`font-mono`/`no vinculante`, no `toLocaleString`/`Intl.NumberFormat`; plan-slider.tsx has `type="range"`, `plans.length - 1`, `disabled`.

## Known Stubs
None. All components are wired to the real `@imbau/quoting` contract and consume props supplied by Plan 05's island; no hardcoded/placeholder data.

## Next Phase Readiness
- Plan 05 (interactive island) can mount these leaves directly: `QuoteCards` for the result surface, `PlanSlider` for the anticipo/plazo control, `buildWhatsappUrl` for the CTA. The exported contract above is the wiring spec.
- Visual/brand fidelity vs the mockup (dark grafito + cobre, mono figures) is a manual judgment deferred to the island page render / staging — no mockup HTML exists in the repo to diff against (docs/mockup.html absent, consistent with Plan 02's finding).

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
