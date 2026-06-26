import { defineConfig } from "tsup";

// Bundles the worker + its workspace packages (@imbau/*) into a single output,
// ready for the fase-3 Docker image (D-06). `noExternal` forces the internal
// JIT packages (raw src) to be inlined rather than resolved at runtime.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  noExternal: [/^@imbau\//],
  // pino + pino-loki arrive transitively via @imbau/observability (noExternal),
  // but they MUST stay external: pino does CJS `require()` internally and the
  // pino-loki transport runs in a worker thread that resolves the target as a
  // real module FILE — neither survives being inlined into a single ESM bundle
  // ("Dynamic require of os is not supported" / unresolvable transport). The
  // runner image carries node_modules (see Dockerfile), so these resolve at runtime.
  external: ["pino", "pino-loki", "pino-pretty"],
});
