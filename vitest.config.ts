import { defineConfig } from "vitest/config";

// Root Vitest config (D-10): discovers tests across workspace packages and wires
// the v8 coverage provider. No coverage threshold yet — the 100% quoting gate
// lands with QUOT-01 in phase 3.
export default defineConfig({
  test: {
    // Vitest resolves the default `**/*.{test,spec}.ts` glob against the cwd it
    // is invoked from, so each package's `test` script (run via Turbo) discovers
    // its own `src/**/*.test.ts`. No root-anchored include — that would only
    // resolve when invoked from the repo root.
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
    },
  },
});
