import { createRequire } from "node:module";
import { defineConfig, configDefaults } from "vitest/config";

// JSX/TSX transform bridge. apps/web's tsconfig sets `jsx: "preserve"` (required by Next), which
// makes Vite's built-in esbuild pass leave JSX untransformed → `vite:import-analysis` then fails on
// component render tests with "content contains invalid JS syntax". We transpile JSX ourselves with
// esbuild (via Vite's `transformWithEsbuild`) in a `pre` plugin so the app tsconfig stays
// Next-correct while `.tsx` render tests still run. `vite` is resolved through vitest's own
// dependency tree because pnpm does not hoist it to apps/web.
const req = createRequire(import.meta.url);
const viteReq = createRequire(req.resolve("vitest/config"));
const { transformWithEsbuild } = viteReq("vite") as typeof import("vite");

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
  plugins: [
    {
      name: "imbau-tsx-jsx",
      enforce: "pre",
      async transform(code: string, id: string) {
        const file = id.split("?")[0] ?? "";
        if (id.includes("/node_modules/") || !/\.[jt]sx$/.test(file)) return null;
        return transformWithEsbuild(code, file, {
          loader: "tsx",
          jsx: "automatic",
          jsxImportSource: "react",
        });
      },
    },
  ],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
