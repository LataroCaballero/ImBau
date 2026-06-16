import { z } from "zod";

// Partial env presets composed by each app's `env.ts` via `@t3-oss/env-*`
// (the actual `createEnv` wiring lives per-app in plan 03, D-01). These presets
// only declare variable NAMES + Zod schemas — never values (T-02-02). No
// speculative phase 2-3 presets here.

export const baseEnv = {
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
} as const;

// Three connection strings for the role split (D-04) and anon-read path (D-06):
// DATABASE_URL is the owner/migration role (DDL via drizzle-kit); DATABASE_APP_URL
// is the runtime `app_authenticated` role; DATABASE_ANON_URL is the published-only
// `anon` role. NOT speculative — each is justified by a locked decision. Each app
// composes only the URLs it uses; in phase 2 only the test harness consumes these.
export const dbEnv = {
  server: {
    DATABASE_URL: z.string().url(), // owner/migration role — DDL (drizzle.config.ts)
    DATABASE_APP_URL: z.string().url(), // app_authenticated — runtime queries (D-04)
    DATABASE_ANON_URL: z.string().url(), // anon — public published-only read path (D-06)
  },
} as const;

export const redisEnv = {
  server: { REDIS_URL: z.string().url() },
} as const;
