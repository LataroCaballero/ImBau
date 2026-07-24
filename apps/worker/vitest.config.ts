import { mergeConfig, defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config";

// Per-package Vitest config for @imbau/worker — REQUIRED since plan 02-02 (A8).
//
// WHY THIS FILE EXISTS: A8 extended apps/worker/src/env.ts to validate r2Env + dbEnv, and the
// new media pipeline imports @imbau/db (via media-store), whose OWN env module eagerly builds
// the app/anon Postgres pools — and validates the three DATABASE_* URLs — at IMPORT time. So
// merely importing ./index (index.test.ts) or media-store (media.test.ts) now requires R2_* +
// the three DATABASE_* to be present, or the import throws before any test runs. We inject
// non-empty DUMMY values here so the worker suites run with ZERO real R2/DB infra:
//   - R2_* are always dummies: every test mocks media-runtime, so no S3Client is ever used.
//   - DATABASE_* prefer the real CI/local value when present (so a DB-backed test could connect)
//     and fall back to a dummy URL whose db name ends in `_test`. postgres.js connects LAZILY,
//     so the pure + mocked tests in this package never open a socket against the fallback.
//   - REDIS_URL prefers the real value (index.test.ts opens a LIVE BullMQ connection against the
//     Compose Redis) and falls back to the local Compose port.
//
// This mirrors packages/db + packages/api per-package configs (mergeConfig keeps the root v8
// coverage defaults) but adds test.env instead of a globalSetup — the worker suites need
// import-time env, not a one-time DB migrate.
const dummyDbUrl = (role: string) =>
  `postgres://${role}@localhost:5432/imbau_dummy_test`;

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // src/** = pure + mocked suites; tests/** = the MEDIA-04 integration suite (PG16 + mock S3).
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      // globalSetup (tests/setup.ts) migrates the shared @imbau/db journal once and runs the
      // app_authenticated role guard before any test — REQUIRED for the integration suite (A8).
      globalSetup: ["./tests/setup.ts"],
      // The media suites run REAL sharp AVIF/WebP encoding (8 encodes + decodes per case) and the
      // MEDIA-04 integration suite hits real PG16 — legitimately slow work that Vitest's 5000ms
      // default flakes on under CI CPU contention (turbo runs the worker + db test tasks in
      // parallel). Match the @imbau/db harness timeouts so a slow encode fails loudly only when
      // genuinely stuck, not when merely contended. No production code path is affected.
      testTimeout: 30_000,
      hookTimeout: 60_000,
      env: {
        // R2: dummy non-empty values; media-runtime is always mocked, so these are never used
        // to contact R2 — they only satisfy env.ts's import-time Zod validation.
        R2_ACCOUNT_ID: "test-account",
        R2_ACCESS_KEY_ID: "test-access-key",
        R2_SECRET_ACCESS_KEY: "test-secret-key",
        R2_BUCKET: "test-bucket",
        R2_PUBLIC_BASE_URL: "https://cdn.example.test",
        // DB: prefer the real CI/local URL; fall back to a lazy dummy (db name ends in _test).
        DATABASE_URL: process.env.DATABASE_URL ?? dummyDbUrl("owner"),
        DATABASE_APP_URL:
          process.env.DATABASE_APP_URL ?? dummyDbUrl("app_authenticated"),
        DATABASE_ANON_URL: process.env.DATABASE_ANON_URL ?? dummyDbUrl("anon"),
        // Redis: prefer the real value (index.test.ts needs a live connection); local default.
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
        // Web origin (fase 7): index.test.ts imports ./env at module load, whose schema now
        // validates WEB_PUBLIC_BASE_URL. A dummy URL satisfies the import-time Zod check — the
        // pure QuoteDoc render never contacts it.
        WEB_PUBLIC_BASE_URL: process.env.WEB_PUBLIC_BASE_URL ?? "https://web.test",
        // Panel origin (fase 11): the lead-email processor imports ./env (env.BETTER_AUTH_URL) to
        // build the bandeja deep-link, and importing @imbau/api/email also validates it. A dummy
        // URL satisfies both import-time Zod checks — lead-email.test.ts mocks the send + read.
        BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "https://panel.test",
      },
    },
  }),
);
