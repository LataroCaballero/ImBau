import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";

// Validate env at build/boot: importing ./env runs createEnv, so a missing or
// invalid var fails `next build` and `next dev` fast (MONO-03, D-03).
import "./env";

// Pin the monorepo root so Next does not mis-infer it from a stray lockfile
// outside the workspace (the build is multi-app; the root is two levels up).
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // JIT consumption of internal workspace packages (raw src, no dist) — D-05.
  transpilePackages: ["@imbau/ui", "@imbau/config"],
  // Standalone output for the fase-3 Docker image.
  output: "standalone",
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
