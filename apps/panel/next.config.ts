import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { NextConfig } from "next";

// Validate env at build/boot (MONO-03, D-03).
import "./env";

// Pin the monorepo root so Next does not mis-infer it from a stray lockfile.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // JIT consumption of internal workspace packages (raw src, no dist) — D-05.
  // @imbau/api carries the Better Auth runtime + tRPC router consumed by the panel
  // handlers/clients, so it must be transpiled too.
  transpilePackages: ["@imbau/api", "@imbau/ui", "@imbau/config"],
  // Standalone output for the fase-3 Docker image.
  output: "standalone",
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
