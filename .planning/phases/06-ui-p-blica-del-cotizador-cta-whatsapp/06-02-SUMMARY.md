---
phase: 06-ui-p-blica-del-cotizador-cta-whatsapp
plan: 02
subsystem: ui
tags: [frontend, tailwind-v4, next-font, trpc, tanstack-query, splitlink, vitest, playwright, design-tokens]

# Dependency graph
requires:
  - phase: 05-emision-y-persistencia-server-side
    provides: "apps/web hosts its own tRPC handler + app pool for anonymous quoting; nginx location ^~ /api/trpc/quotes rate limit (QUOTE-03)"
  - phase: 04-motor-de-cotizacion
    provides: "quotes.compute / quotes.create procedures on AppRouter"
provides:
  - "apps/web public-UI shell: Tailwind v4 CSS-first with ImBau brand tokens (dark grafito)"
  - "Self-hosted brand fonts (Space Grotesk / Inter / JetBrains Mono) via next/font — no runtime network font fetch"
  - "Browser tRPC client with a dual splitLink that keeps quotes.* on the /api/trpc/quotes.* path (rate-limit-safe)"
  - "apps/web vitest (jsdom) + Playwright test infrastructure with a green splitLink-predicate guard test"
  - "packages/ui carries real design tokens (tokens.css), no longer a placeholder"
affects: [06-03, 06-04, 06-05, cotizador-ui, whatsapp-cta]

# Tech tracking
tech-stack:
  added: [tailwindcss@4.3.2, "@tailwindcss/postcss@4.3.2", "@trpc/client@11.17.0", "@tanstack/react-query@5.101.0", "@trpc/tanstack-react-query@11.17.0", vitest@4.1.8, "@playwright/test@1.60.0", jsdom@26.1.0, "@testing-library/react@16.3.0", "@testing-library/jest-dom@6.9.0"]
  patterns: ["Tailwind v4 CSS-first @theme (no tailwind.config)", "next/font self-hosting brand faces", "dual splitLink to fence quotes onto their own batch path", "pure predicate module for JSX-free unit testing"]

key-files:
  created:
    - apps/web/postcss.config.mjs
    - apps/web/app/globals.css
    - apps/web/lib/trpc-client.tsx
    - apps/web/lib/trpc-split.ts
    - apps/web/vitest.config.ts
    - apps/web/playwright.config.ts
    - apps/web/tests/trpc-client-split.test.ts
    - packages/ui/src/tokens.css
  modified:
    - apps/web/package.json
    - apps/web/app/layout.tsx
    - packages/ui/package.json
    - packages/config/eslint.js
    - pnpm-lock.yaml

key-decisions:
  - "packages/ui/src/tokens.css reconstructed from 06-RESEARCH.md Pattern 6 (canonical brand palette) because docs/marca/tokens.css does not exist in the repo"
  - "isQuotesOp extracted into a JSX-free module (lib/trpc-split.ts) so the unit test imports the exact shipping predicate without pulling the use-client provider into Vitest"
  - "PostCSS config excluded from type-aware ESLint via shared ignores (config file outside any tsconfig projectService)"

patterns-established:
  - "Tailwind v4 CSS-first: @import tailwindcss + @theme mapping brand tokens; no tailwind.config.* (D-10)"
  - "Brand fonts self-hosted at build via next/font/google, CSS variables forwarded to @theme --font-* tokens (D-13)"
  - "Dual splitLink gated on isQuotesOp keeps quotes.* requests on /api/trpc/quotes.* so nginx limit_req throttles them (Pitfall 1 / T-06-02-DOS)"

requirements-completed: [UI-06]

coverage:
  - id: D1
    description: "apps/web renders the ImBau dark-grafito brand look with Tailwind v4 CSS-first tokens and self-hosted brand fonts (Space Grotesk / Inter / JetBrains Mono), no runtime network font fetch"
    requirement: UI-06
    verification:
      - kind: automated_ui
        ref: "grep: app/globals.css has @import tailwindcss + @theme --color-grafito + --font-*; layout.tsx uses next/font/google, no fonts.googleapis link; pnpm --filter @imbau/web typecheck"
        status: pass
      - kind: manual_procedural
        ref: "visual confirmation of dark grafito body + brand type on a rendered page (deferred to downstream cotizador page plan / staging)"
        status: unknown
    human_judgment: true
    rationale: "Brand look-and-feel (dark grafito, correct type rendering) is a visual judgment; no page renders a cotizador view yet in this shell-only plan"
  - id: D2
    description: "Browser tRPC client routes every quotes.* procedure through a dedicated splitLink batch so the HTTP path stays /api/trpc/quotes.* (nginx rate limit keeps throttling)"
    requirement: UI-06
    verification:
      - kind: unit
        ref: "apps/web/tests/trpc-client-split.test.ts#isQuotesOp splitLink predicate"
        status: pass
    human_judgment: false
  - id: D3
    description: "apps/web can run unit tests (vitest, jsdom) and e2e (Playwright, reassigned port 3110) via its own scripts"
    verification:
      - kind: unit
        ref: "pnpm --filter @imbau/web test — 2 files, 4 tests pass"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-05
status: complete
---

# Phase 6 Plan 02: apps/web public-UI shell Summary

**Tailwind v4 CSS-first ImBau brand shell (dark grafito, self-hosted Space Grotesk/Inter/JetBrains Mono) with a dual-splitLink tRPC browser client that fences quotes.* onto /api/trpc/quotes.*, plus vitest + Playwright infra proven by a green split-predicate test.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-05T02:32:33Z
- **Completed:** 2026-07-05T02:45:00Z
- **Tasks:** 3 (Task 3 was TDD: RED + GREEN)
- **Files modified:** 13 (8 created, 5 modified)

## Accomplishments
- apps/web now carries all cotizador dependencies + a `test:e2e` script, Tailwind v4 wired CSS-first with the full ImBau brand palette in `@theme`, and `packages/ui` ships real design tokens instead of a placeholder.
- The public layout self-hosts the three brand faces via `next/font/google` (no render-blocking network font fetch — protects the <3s-4G budget) on a dark grafito body, keeping `lang="es-AR"`.
- The browser tRPC client uses a single `splitLink` gated on `isQuotesOp(op.path)`, so quotes requests can only co-batch with each other and stay on the `/api/trpc/quotes.*` path the nginx `limit_req` (QUOTE-03) matches — the load-bearing defense against T-06-02-DOS.
- vitest (jsdom) + Playwright (port 3110, avoiding the CLINICAL collision) are configured, and a unit test proves only `quotes.*` takes the dedicated batch link.

## Task Commits

Each task was committed atomically:

1. **Task 1: Dependencies, Tailwind v4 CSS-first, brand tokens** - `be45d84` (feat)
2. **Task 2: Brand fonts in layout + dual-splitLink tRPC client** - `e53c5c0` (feat)
3. **Task 3 (RED): failing splitLink predicate guard** - `7cd23ae` (test)
4. **Task 3 (GREEN): wire predicate + Playwright config** - `5cd5699` (feat)

**Plan metadata:** committed separately with this SUMMARY.

## Files Created/Modified
- `apps/web/postcss.config.mjs` - Single Tailwind v4 `@tailwindcss/postcss` plugin (no autoprefixer/postcss-import; v4 folds them in)
- `apps/web/app/globals.css` - `@import "tailwindcss"` + `@theme` mapping brand colors + `--font-*` tokens
- `apps/web/app/layout.tsx` - next/font Space Grotesk/Inter/JetBrains Mono variables on `<html>`, dark grafito body
- `apps/web/lib/trpc-client.tsx` - Cloned panel client; links = single splitLink using `isQuotesOp`
- `apps/web/lib/trpc-split.ts` - Pure `isQuotesOp` predicate (JSX-free, unit-testable in isolation)
- `apps/web/vitest.config.ts` - Self-contained, jsdom env, excludes `e2e/**`
- `apps/web/playwright.config.ts` - `testDir ./e2e`, port 3110, Compose dev DB env defaults
- `apps/web/tests/trpc-client-split.test.ts` - Asserts `isQuotesOp` true for quotes.*, false for picker.*/projects.*
- `packages/ui/src/tokens.css` - ImBau design tokens (palette + type stacks) exported via `./tokens.css`
- `apps/web/package.json` - New deps/devDeps + `test:e2e` script
- `packages/ui/package.json` - Added `./tokens.css` export
- `packages/config/eslint.js` - Ignore `**/postcss.config.mjs` for type-aware linting
- `pnpm-lock.yaml` - Lockfile updated by `pnpm install`

**Pinned versions chosen at install time (verified on npm 2026-07-05):** tailwindcss@4.3.2, @tailwindcss/postcss@4.3.2, @trpc/client@11.17.0, @tanstack/react-query@5.101.0, @trpc/tanstack-react-query@11.17.0, vitest@4.1.8, @playwright/test@1.60.0, jsdom@26.1.0, @testing-library/react@16.3.0, @testing-library/jest-dom@6.9.0. All pinned exact (no `^`).

## Decisions Made
- **Reconstructed tokens.css from RESEARCH** rather than copying `docs/marca/tokens.css` (absent in repo) — RESEARCH Pattern 6 carries the authoritative palette + font-stack values, and `globals.css` `@theme` uses the identical values.
- **Predicate in a dedicated JSX-free module** so the unit test asserts the exact shipping `isQuotesOp` without Vitest having to transform the `"use client"` provider (which fails to parse under the app's `jsx: "preserve"` tsconfig). `trpc-client.tsx` imports + re-exports it, so the acceptance criterion "trpc-client.tsx exports the split predicate" holds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Brand token source files absent — reconstructed from RESEARCH**
- **Found during:** Task 1 (Tailwind tokens)
- **Issue:** The plan's `read_first` referenced `docs/marca/tokens.css` and `docs/marca/brand-book.md`, neither of which exists in the repo, blocking the "copy tokens.css into packages/ui" step.
- **Fix:** Built `packages/ui/src/tokens.css` and the `globals.css` `@theme` block from the canonical brand palette + font stacks defined verbatim in `06-RESEARCH.md` Pattern 6 (authoritative source).
- **Files modified:** packages/ui/src/tokens.css, apps/web/app/globals.css
- **Verification:** grep confirms `--color-grafito` + `--font-*` present; typecheck/lint clean
- **Committed in:** be45d84

**2. [Rule 3 - Blocking] Vitest could not parse the use-client tRPC module**
- **Found during:** Task 3 (split-predicate test)
- **Issue:** Importing `lib/trpc-client.tsx` into the unit test failed with "content contains invalid JS syntax" — the app tsconfig sets `jsx: "preserve"`, so Vite/esbuild left the provider's JSX untransformed. `esbuild.jsx` / `tsconfigRaw` overrides did not fix the `vite:import-analysis` failure.
- **Fix:** Extracted the pure `isQuotesOp` predicate into a JSX-free `lib/trpc-split.ts`; the test imports that module, and `trpc-client.tsx` imports + re-exports it and uses it in the splitLink condition. This is exactly the plan's stated intent ("assert it without booting a client").
- **Files modified:** apps/web/lib/trpc-split.ts, apps/web/lib/trpc-client.tsx, apps/web/tests/trpc-client-split.test.ts
- **Verification:** `pnpm --filter @imbau/web test` — 4 tests pass
- **Committed in:** 7cd23ae (RED), 5cd5699 (GREEN)

**3. [Rule 3 - Blocking] ESLint projectService failed on the new .mjs config**
- **Found during:** Task 1 (post-commit lint gate)
- **Issue:** `apps/web/postcss.config.mjs` is outside every tsconfig project, so the shared `projectService: true` type-aware config errored ("not found by the project service").
- **Fix:** Added `**/postcss.config.mjs` to the shared ignores in `packages/config/eslint.js` (config files carry no app logic to type-lint, matching the existing dist/.next/coverage ignores).
- **Files modified:** packages/config/eslint.js
- **Verification:** `pnpm --filter @imbau/web lint` clean
- **Committed in:** 5cd5699

**4. [Rule 3 - Blocking] Comment text tripped the plan's own automated grep verifications**
- **Found during:** Task 2 and Task 3
- **Issue:** Explanatory comments literally contained `fonts.googleapis.com` (layout.tsx) and `3000/3001` (playwright.config.ts), which the plan's negative-grep verifications (`! grep fonts.googleapis`, `! grep 3000|3001`) flagged despite the code being correct.
- **Fix:** Reworded the comments to describe the intent without the literal strings. No behavior change.
- **Files modified:** apps/web/app/layout.tsx, apps/web/playwright.config.ts
- **Verification:** all plan grep checks pass
- **Committed in:** e53c5c0, 5cd5699

---

**Total deviations:** 4 auto-fixed (all Rule 3 - blocking).
**Impact on plan:** All fixes necessary to complete the plan as specified; no scope creep. Deviation 1 sources tokens from the authoritative RESEARCH doc; deviation 2 realizes the plan's explicit testability goal via a cleaner module split.

## Issues Encountered
- The Vite JSX-preserve parse failure (deviation 2) cost the most iteration; resolved definitively by the pure-predicate module split rather than fighting the esbuild/tsconfig interaction.

## User Setup Required
None - no external service configuration required. (Live 429 rate-limit re-verification against staging is owned by the downstream e2e plan, not this shell plan.)

## Next Phase Readiness
- The themed, testable shell is ready: downstream cotizador plans (06-03+) render into `globals.css` + `layout.tsx` and mount `TRPCReactProvider` around their interactive islands.
- The splitLink predicate (`isQuotesOp`) and its guard test are in place; the live 429 re-check remains for the e2e plan against staging.

---
*Phase: 06-ui-p-blica-del-cotizador-cta-whatsapp*
*Completed: 2026-07-05*
