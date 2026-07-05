import { defineConfig, configDefaults } from "vitest/config";

// Per-package Vitest config for @imbau/web.
//
// WHY THIS FILE EXISTS: Vitest's default `**/*.{test,spec}.ts` glob would also
// collect the Playwright e2e specs under `apps/web/e2e/`. Those use Playwright's
// `test`/`expect` and need a browser + a running app, so they belong to the
// `test:e2e` script (playwright.config.ts), NOT to `vitest run`.
//
// SELF-CONTAINED on purpose: unlike packages/db|api, this does NOT import the
// repo-root `vitest.config`. That relative import (`../../vitest.config`) is
// pruned away by `turbo prune --docker`, so the production `next build`
// type-check would fail with "Cannot find module '../../vitest.config'". This
// widens the exclude list to drop e2e specs and sets the jsdom environment so
// component/render assertions (and DOM-touching client modules) work.
export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
