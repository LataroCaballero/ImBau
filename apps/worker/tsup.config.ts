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
});
