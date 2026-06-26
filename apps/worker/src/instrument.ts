import * as Sentry from "@sentry/node";

// Worker Sentry init (OBS-01). This module is imported on the FIRST line of
// index.ts — BEFORE ./env and any Redis/BullMQ wiring — so @sentry/node can
// auto-instrument other modules as they load (the Sentry Node SDK requires init
// before the libraries it patches are imported). Optional DSN: with no SENTRY_DSN
// the SDK is a no-op, so the worker still boots with zero external deps in dev.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
