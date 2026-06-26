import { mergeConfig, defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

// Per-package Vitest config for @imbau/api — mirrors packages/db/vitest.config.ts.
//
// The default glob does not register the suite-once setup, so we register tests/setup.ts as
// globalSetup: it verifies the owner connection reaches a `_test` DB that already carries the
// phase-2 auth tables (no migration is run here — packages/db owns the journal). The auth
// integration test opens real Postgres connections through the Better Auth runtime, so the
// hook/test timeouts are generous but bounded (a dead DB fails instead of hanging).
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.test.ts"],
      globalSetup: ["./tests/setup.ts"],
      hookTimeout: 60_000,
      testTimeout: 30_000,
    },
  }),
);
