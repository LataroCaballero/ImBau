import { mergeConfig, defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

// Per-package Vitest config for @imbau/quoting — REQUIRED (ENGINE-04), not conditional.
//
// WHY THIS FILE EXISTS: `packages/quoting` is the crown-jewel engine — "un error de cálculo
// acá mata el producto" (CLAUDE.md). CLAUDE.md + ENGINE-04 demand 100% coverage on THIS
// package only. The threshold lives here (package-scoped) and NEVER in the root config: a root
// threshold would redden every other package that does not (yet) hit 100% (RESEARCH anti-pattern).
//
// mergeConfig inherits the workspace defaults (the v8 coverage provider) from the root config and
// adds only the package-scoped gate. The engine is PURE (no I/O) — so, unlike packages/db, this
// config drops globalSetup/hookTimeout/testTimeout: there is no Postgres to migrate or time-box.
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        // lines + functions + branches + statements all must equal 100 (ENGINE-04).
        thresholds: { 100: true },
        include: ["src/**/*.ts"],
        // The barrel (src/index.ts) is re-export only; test files are not production code.
        exclude: ["src/**/*.test.ts", "src/index.ts"],
      },
    },
  }),
);
