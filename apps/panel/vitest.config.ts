import { mergeConfig, defineConfig, configDefaults } from "vitest/config";
import rootConfig from "../../vitest.config";

// Per-package Vitest config for @imbau/panel.
//
// WHY THIS FILE EXISTS: the root config relies on Vitest's default
// `**/*.{test,spec}.ts` glob, which would also collect the Playwright e2e specs
// under `apps/panel/e2e/` (e.g. `e2e/auth-flow.spec.ts`). Those use Playwright's
// `test`/`expect` and need a browser + a running app, so they belong to the
// `test:e2e` script (playwright.config.ts), NOT to `vitest run`.
//
// We keep the workspace defaults (v8 coverage) via mergeConfig and only widen the
// exclude list: spread `configDefaults.exclude` (node_modules, dist, .idea, etc.)
// so nothing is lost, then add `e2e/**`. Panel's unit tests live under `src/**`
// and `*.test.ts`, so they keep running.
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, "e2e/**"],
    },
  }),
);
