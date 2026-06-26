import * as Sentry from "@sentry/nextjs";

// Server (Node runtime) Sentry init, loaded by instrumentation.ts register().
// Server-only DSN (never NEXT_PUBLIC_). Optional — no DSN means the SDK is a no-op.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_APP_ENV,
});
