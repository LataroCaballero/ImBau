import { mergeConfig, defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

// Per-package Vitest config for @imbau/db — REQUIRED (W2), not conditional.
//
// WHY THIS FILE EXISTS: the default glob discovers `tests/*.test.ts`, but it does NOT
// register the suite-once setup. The cross-tenant absence suite (the DATA-04 exit gate) is
// only meaningful if the migration journal was applied AND the role guard ran first — so we
// register `tests/setup.ts` as `globalSetup` here. globalSetup runs ONCE before any test
// file: it migrates a dedicated test DB and asserts the app/anon roles cannot bypass RLS
// (Pitfall 1 / T-02-14). Without this file the guard could be silently skipped.
//
// mergeConfig keeps the workspace defaults (v8 coverage) from the root config and only adds
// the package-specific globalSetup + the tests/ include (root has no root-anchored include —
// its comment explains it resolves the default glob per-package cwd; we make tests/ explicit).
export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.test.ts"],
      // Suite-once: programmatic migrate (same journal as prod) + ensure roles + role guard.
      globalSetup: ["./tests/setup.ts"],
      // Serialize the suite (no cross-file parallelism). Every test file shares the ONE dedicated
      // `_test` DB and several drive `runSeed`, whose owner DDL pre-creates the monthly `events`
      // partitions via `CREATE TABLE IF NOT EXISTS … PARTITION OF events`. Postgres' IF NOT EXISTS
      // is NOT atomic against a concurrent creator, so parallel seed files race and one worker gets
      // `relation "events_2026_04" already exists` (SQLSTATE 42P07). Prod/staging seed once, so this
      // is purely a shared-DB test-harness concern; serial file execution removes the race without
      // touching the shipping seed path. The suite is I/O-bound on a single Postgres anyway.
      fileParallelism: false,
      // The harness opens real Postgres connections + applies migrations; never time-box it
      // to the unit-test default. Generous but bounded so a dead DB fails instead of hangs.
      hookTimeout: 60_000,
      testTimeout: 30_000,
    },
  }),
);
