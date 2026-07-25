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
  // react-dom/server (used by @react-email/render when the Resend SDK renders the `react:`
  // prop of a notification email) is CommonJS and does an internal `require("react")`. Inlined
  // into the single ESM bundle it throws "Dynamic require of react is not supported" at render
  // time — the exact class of bug as pino above. Keep the React runtime external so it loads as
  // CJS from node_modules (the runner image carries node_modules); externalize `react` too so a
  // single React instance is shared with the external react-dom/server.
  external: [
    "pino",
    "pino-loki",
    "pino-pretty",
    "react",
    "react-dom",
    "react-dom/server",
  ],
});
