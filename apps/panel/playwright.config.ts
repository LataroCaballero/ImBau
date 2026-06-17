import { defineConfig, devices } from "@playwright/test";

// Playwright config for the panel auth e2e (AUTH-01 / AUTH-03, RESEARCH Validation Architecture).
//
// Port: 3101 — NOT the default 3001, which collides with the user's CLINICAL project on this
// machine (Pitfall 6). The webServer boots the panel against the Compose Postgres `imbau` dev DB
// with RESEND_API_KEY intentionally UNSET so the dev console fallback fires (D-09) and no real
// email is sent. The spec reads the invitation id straight from Postgres to drive the accept
// flow (the fallback only logs the link to the server's stdout, which Playwright cannot hand to
// a test; asserting the row + accepting it proves the same invite→accept→member-with-role path).
//
// CI (CI-02, phase 4) re-points DATABASE_* at the GitHub Actions Postgres service unchanged.
const PORT = Number(process.env.PANEL_E2E_PORT ?? 3101);
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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Build + start the panel on the reassigned port. RESEND_API_KEY is left unset so the
    // invitation dispatch takes the dev console fallback (D-09).
    command: `pnpm run build && pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL,
      DATABASE_APP_URL,
      DATABASE_ANON_URL,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "e2e-secret-please-change-32chars-minimum-xx",
      NEXT_PUBLIC_APP_ENV: "development",
      NODE_ENV: "production",
    },
  },
});
