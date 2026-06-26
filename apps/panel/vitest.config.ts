import { defineConfig, configDefaults } from "vitest/config";

// Per-package Vitest config for @imbau/panel.
//
// WHY THIS FILE EXISTS: Vitest's default `**/*.{test,spec}.ts` glob would also
// collect the Playwright e2e specs under `apps/panel/e2e/` (e.g.
// `e2e/auth-flow.spec.ts`). Those use Playwright's `test`/`expect` and need a
// browser + a running app, so they belong to the `test:e2e` script
// (playwright.config.ts), NOT to `vitest run`.
//
// SELF-CONTAINED on purpose: unlike packages/db|api, this does NOT import the
// repo-root `vitest.config`. That relative import (`../../vitest.config`) is
// pruned away by `turbo prune --docker`, so the production `next build` type-check
// failed with "Cannot find module '../../vitest.config'". Panel has no unit tests
// yet, so it needs none of the root coverage settings — it only widens the
// exclude list to drop the e2e specs.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
