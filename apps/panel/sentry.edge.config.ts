import * as Sentry from "@sentry/nextjs";

// Edge runtime Sentry init, loaded by instrumentation.ts register() when
// NEXT_RUNTIME === "edge" (middleware / edge routes). Server-only DSN, optional.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_APP_ENV,
});
