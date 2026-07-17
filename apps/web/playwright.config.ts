import { defineConfig, devices } from "@playwright/test";

// Playwright config for the public showroom e2e (cloned from apps/panel).
//
// Port: 3110 — a reassigned high port, NOT the low dev-server defaults that
// collide with the user's CLINICAL project on this machine (MEMORY
// clinical-project-ports / Pitfall 6). The
// webServer builds + starts apps/web against the Compose Postgres `imbau` dev DB;
// apps/web hosts the app pool for anonymous quoting (D-06), so the DATABASE_*
// connection strings default to the dev DB and are overridable in CI.
const PORT = Number(process.env.WEB_E2E_PORT ?? 3110);
const BASE_URL = `http://localhost:${PORT}`;

// Connection strings default to the Compose dev DB; overridable in CI.
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://imbau:dev@localhost:5432/imbau";
const DATABASE_APP_URL =
  process.env.DATABASE_APP_URL ??
  "postgres://app_authenticated:dev@localhost:5432/imbau";
const DATABASE_ANON_URL =
  process.env.DATABASE_ANON_URL ?? "postgres://anon:dev@localhost:5432/imbau";

// apps/web mounts the FULL appRouter at /api/trpc (D-06-A1, plan 05-05) for the anonymous quote
// path, so booting @imbau/api eagerly validates the Better Auth env (auth/env.ts) at `next build`
// page-data collection AND at `next start`. The context note is explicit: when the app server is
// run directly (this webServer), the FULL env must live in that process. These two vars were
// missing, so a fresh `pnpm --filter @imbau/web test:e2e` failed to build. Dev defaults here (no
// real secret material) keep the local suite runnable; CI/staging override via process.env. The
// owner-pool DATABASE_URL the auth env also needs is already provided above.
const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "test-better-auth-secret-0123456789-abcdef";
const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build + start the web app on the reassigned port.
    command: `pnpm run build && pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL,
      DATABASE_APP_URL,
      DATABASE_ANON_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL,
      NEXT_PUBLIC_APP_ENV: "development",
      NODE_ENV: "production",
    },
  },
});
