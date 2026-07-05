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
      NEXT_PUBLIC_APP_ENV: "development",
      NODE_ENV: "production",
    },
  },
});
