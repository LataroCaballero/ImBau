# Deferred Items — Phase 04

## [04-03] eslint does not ignore generated `coverage/` output
- **Found during:** plan 04-03 execution (running `vitest run --coverage` locally).
- **Issue:** `packages/config/eslint.js` `ignores` lists `dist/.next/.turbo/node_modules` but NOT `**/coverage/**`. When coverage is generated before `eslint .` runs, eslint tries to parse the v8 HTML-report JS (`coverage/*.js`) and fails with "not found by the project service". `coverage/` IS gitignored so it never commits, but a lint-after-coverage order would redden CI.
- **Why deferred:** the fix is in the shared `packages/config/eslint.js` (affects every package), outside plan 04-03's `files_modified` (engine.ts + tests only). Out of scope per SCOPE BOUNDARY.
- **Suggested fix:** add `"**/coverage/**"` to the eslint `ignores` array in `packages/config/eslint.js`.
