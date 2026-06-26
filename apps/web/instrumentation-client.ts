import * as Sentry from "@sentry/nextjs";

// Client-side Sentry init (Next >= 15.3 moved this out of the deprecated
// sentry.client.config.ts). Uses the PUBLIC DSN — designed to ship in the browser
// bundle (T-4-CLIENTLEAK accepted). With no DSN the SDK is a no-op, so dev runs
// with zero external deps.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_APP_ENV,
});

// Captures client-side router transitions for navigation tracing (OBS-01).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
