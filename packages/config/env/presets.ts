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

export const dbEnv = {
  server: { DATABASE_URL: z.string().url() },
} as const;

export const redisEnv = {
  server: { REDIS_URL: z.string().url() },
} as const;
