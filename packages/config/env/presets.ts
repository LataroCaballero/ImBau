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

// Better Auth runtime secrets + base URL (D-01) plus the transactional-email vars
// for invitations (AUTH-03). NAMES + Zod schemas only — never values (T-03-04).
// RESEND_API_KEY/INVITE_FROM are optional because dev logs the invite link to the
// console when no key is present (D-09); they are required only in staging/prod.
// The Better Auth Drizzle adapter reads its DB URL from dbEnv.DATABASE_URL (the
// owner/migration role — A1), so it is NOT redeclared here. Sentry = phase 4.
export const authEnv = {
  server: {
    BETTER_AUTH_SECRET: z.string().min(32), // signing secret; 32+ chars
    BETTER_AUTH_URL: z.string().url(), // base URL of apps/panel (auth handler host)
    RESEND_API_KEY: z.string().optional(), // dev console fallback (D-09)
    INVITE_FROM: z.string().optional(), // verified Resend sender; required only with Resend
  },
} as const;
