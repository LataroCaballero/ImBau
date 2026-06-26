import * as Sentry from "@sentry/nextjs";

// Next 16 App Router server instrumentation hook (OBS-01). `register()` runs once
// per runtime at server startup; we dynamic-import the matching Sentry config so
// the Node and Edge SDKs initialize only in their own runtime (RESEARCH Pattern 5).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures Server Component / route-handler / middleware errors — including RSC
// and the panel's auth middleware errors (OBS-01). Without this hook those errors
// never reach Sentry.
export const onRequestError = Sentry.captureRequestError;
