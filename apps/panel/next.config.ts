import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Validate env at build/boot (MONO-03, D-03).
import "./env";

// Pin the monorepo root so Next does not mis-infer it from a stray lockfile.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // JIT consumption of internal workspace packages (raw src, no dist) — D-05.
  // @imbau/api carries the Better Auth runtime + tRPC router consumed by the panel
  // handlers/clients, so it must be transpiled too. @imbau/observability ships the
  // shared pino logger (OBS-02) consumed by server code.
  transpilePackages: [
    "@imbau/api",
    "@imbau/ui",
    "@imbau/config",
    "@imbau/observability",
  ],
  // Standalone output for the fase-3 Docker image.
  output: "standalone",
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
};

// Wrap with Sentry to enable source-map upload in CI + RSC instrumentation
// (OBS-01). All build-time vars are optional/CI-only (turbo passThroughEnv); with
// no auth token the upload is skipped, so local builds work with zero Sentry deps.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
