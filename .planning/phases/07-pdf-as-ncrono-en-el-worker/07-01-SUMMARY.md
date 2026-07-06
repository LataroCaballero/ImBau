---
phase: 07-pdf-as-ncrono-en-el-worker
plan: 01
subsystem: infra
tags: [worker, pdf, react-pdf, fonts, qrcode, alpine, env, tsup]

# Dependency graph
requires:
  - phase: 04-cotizador (packages/quoting)
    provides: PdfModel type + toPdfModel serializer (leyendas strings the doc renders)
provides:
  - "QuoteDoc react-pdf document (pure layout) rendering a PdfModel + header + QR to a valid %PDF"
  - "Embedded Roboto (Apache-2.0) Regular/Bold TTF committed under apps/worker/assets + Dockerfile COPY (es-AR accents in Alpine, PDF-02)"
  - "Worker PDF/QR/React deps (@react-pdf/renderer, qrcode, react, @imbau/quoting) + @types/qrcode/@types/react (dev)"
  - "WEB_PUBLIC_BASE_URL env var (webEnv preset) validated at worker boot — for the wave-2 QR deep-link (D-08)"
affects: [07-02, 07-03, 07-04, pdf-worker-processor]

# Tech tracking
tech-stack:
  added: ["@react-pdf/renderer@4.5.1", "qrcode@1.5.4", "react@19.2.7", "@types/qrcode@1.5.5 (dev)", "@types/react@19.2.7 (dev)", "Roboto TTF (Apache-2.0)"]
  patterns:
    - "react-pdf document authored with React.createElement (no JSX/.tsx) — tsup build has no JSX transform"
    - "Font.register once at module top-level by absolute path via fileURLToPath(new URL('../assets/…', import.meta.url)) — resolves in both src (test) and dist (bundle) + container"
    - "Pure layout module: no ./env or I/O seam, so the render test needs zero infra"

key-files:
  created:
    - "apps/worker/src/quote-pdf-doc.ts — QuoteDoc component + Font.register + QuoteDocProps/QuoteHeader types"
    - "apps/worker/src/quote-pdf-doc.test.ts — renderToBuffer real-render test asserting %PDF + accents + leyendas"
    - "apps/worker/assets/doc-sans-regular.ttf + doc-sans-bold.ttf + FONT-LICENSE.txt (Roboto, Apache-2.0)"
  modified:
    - "apps/worker/package.json — PDF/QR/React deps + @types dev deps"
    - "apps/worker/Dockerfile — runner-stage COPY of apps/worker/assets"
    - "packages/config/env/presets.ts — webEnv preset (WEB_PUBLIC_BASE_URL)"
    - "apps/worker/src/env.ts — compose ...webEnv.server"
    - "apps/worker/src/env.test.ts — webEnv parity in both compositions"
    - "apps/worker/vitest.config.ts — WEB_PUBLIC_BASE_URL in test.env"

key-decisions:
  - "Roboto (Apache-2.0) chosen as the embedded font — full Latin-1 + Latin Extended-A coverage for es-AR (áéíóúñ ¿¡), permissive license committed as FONT-LICENSE.txt"
  - "Added @types/react (not in plan) as a Rule 3 blocking dep — react was added as a runtime dep but strict tsc/eslint need its types or every createElement call is unsafe-any"

patterns-established:
  - "Font.register absolute-path pattern for react-pdf in an Alpine/tsup worker (Pitfall 1/2)"
  - "react-pdf document as a pure createElement module de-risked by a real renderToBuffer test before any consumer wiring"

requirements-completed: [PDF-02, PDF-03]

coverage:
  - id: D1
    description: "QuoteDoc renders a financiado PdfModel + header + QR to a valid %PDF buffer with both leyendas and the footer QR"
    requirement: "PDF-03"
    verification:
      - kind: unit
        ref: "apps/worker/src/quote-pdf-doc.test.ts#renders a financiado model to a valid %PDF buffer with both leyendas + QR footer"
        status: pass
    human_judgment: false
  - id: D2
    description: "es-AR accents render from the embedded font (no glyph fallback) — accented header produces a valid %PDF"
    requirement: "PDF-02"
    verification:
      - kind: unit
        ref: "apps/worker/src/quote-pdf-doc.test.ts#renders es-AR accents (embedded font, PDF-02) without throwing"
        status: pass
    human_judgment: false
  - id: D3
    description: "WEB_PUBLIC_BASE_URL is a validated worker env var; existing worker suites stay green with the new var"
    verification:
      - kind: unit
        ref: "apps/worker/src/env.test.ts#worker env validation"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Docker runner image ships the embedded font so ../assets resolves at /app/apps/worker/assets in the container"
    verification:
      - kind: manual_procedural
        ref: "apps/worker/Dockerfile runner-stage COPY of /app/apps/worker/assets — image build verified in CI (Phase 4), no local Docker daemon"
        status: unknown
    human_judgment: true
    rationale: "Container-runtime font resolution can only be confirmed against a built worker image (CI/staging), not by the local render test which reads from the src tree."

# Metrics
duration: 10min
completed: 2026-07-06
status: complete
---

# Phase 7 Plan 01: Worker PDF foundation + QuoteDoc document Summary

**react-pdf QuoteDoc that renders a neutral one-page A4 cotización PDF from a PdfModel + header + QR with correct es-AR accents (embedded Roboto TTF) and both legal leyendas — proven by a real renderToBuffer test, plus the worker deps, Dockerfile font COPY, and WEB_PUBLIC_BASE_URL env for wave 2.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (Task 2 via TDD: RED → GREEN)
- **Files modified:** 11 (6 modified, 5 created) + pnpm-lock.yaml

## Accomplishments
- Worker now carries the PDF render stack: `@react-pdf/renderer@4.5.1`, `qrcode@1.5.4`, `react@19.2.7`, `@imbau/quoting` (+ `@types/qrcode`, `@types/react` dev), all pinned.
- Committed an embedded Roboto (Apache-2.0) Regular/Bold TTF + license under `apps/worker/assets/`; the Dockerfile runner stage COPYs it so it resolves at `/app/apps/worker/assets` in the Chromium-free Alpine container (PDF-02).
- `WEB_PUBLIC_BASE_URL` is a new validated worker env var (`webEnv` preset) for the wave-2 QR deep-link (D-08); all existing worker suites stay green.
- `QuoteDoc` renders a neutral minimalist (D-06) A4 document with the model lines, both leyendas (PDF-03), and a footer deep-link + QR (D-08), authored with `React.createElement` (no JSX) and `Font.register` by absolute path — proven by a real `renderToBuffer` test asserting `%PDF` magic for accented content.

## Task Commits

Each task was committed atomically:

1. **Task 1: Worker PDF deps + embedded font + Dockerfile COPY + WEB_PUBLIC_BASE_URL** - `9911d6e` (feat)
2. **Task 2 (RED): failing renderToBuffer test for QuoteDoc** - `77a10cf` (test)
3. **Task 2 (GREEN): implement QuoteDoc react-pdf document** - `c8f66f6` (feat)

_Note: Task 2 is TDD — RED (`test`) then GREEN (`feat`); no refactor commit needed (implementation was clean)._

## Files Created/Modified
- `apps/worker/src/quote-pdf-doc.ts` - QuoteDoc component (createElement) + top-level Font.register + QuoteDocProps/QuoteHeader
- `apps/worker/src/quote-pdf-doc.test.ts` - real renderToBuffer test (%PDF + accents + leyendas + QR)
- `apps/worker/assets/doc-sans-regular.ttf`, `doc-sans-bold.ttf`, `FONT-LICENSE.txt` - embedded Roboto + Apache-2.0 license
- `apps/worker/package.json` - render/QR/React deps + @types dev deps
- `apps/worker/Dockerfile` - runner-stage COPY of apps/worker/assets
- `packages/config/env/presets.ts` - webEnv preset (WEB_PUBLIC_BASE_URL)
- `apps/worker/src/env.ts` - compose ...webEnv.server
- `apps/worker/src/env.test.ts` - webEnv parity (both compositions)
- `apps/worker/vitest.config.ts` - WEB_PUBLIC_BASE_URL in test.env
- `pnpm-lock.yaml` - dep additions

## Decisions Made
- **Font:** Roboto (Apache-2.0) — permissive license, full Latin-1 + Latin Extended-A coverage for es-AR glyphs; committed the license text as required.
- Followed the plan's layout/API guidance (StyleSheet, footer QR, absolute-path Font.register) as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/react dev dependency**
- **Found during:** Task 2 (GREEN — implementing QuoteDoc)
- **Issue:** The plan added `react` as a runtime dep (react-pdf builds React elements) but not its type declarations. Under strict `tsc --noEmit` and `eslint`, `createElement` and all react-pdf calls resolved to `any`, failing typecheck (TS7016) and lint (`no-unsafe-call`).
- **Fix:** `pnpm --filter @imbau/worker add -D @types/react@19.2.7` (version-matched to react@19.2.7).
- **Files modified:** apps/worker/package.json, pnpm-lock.yaml
- **Verification:** `pnpm --filter @imbau/worker typecheck` and `lint` both pass.
- **Committed in:** c8f66f6 (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] Full workspace `pnpm install`**
- **Found during:** Task 1 verification
- **Issue:** The fresh worktree's `node_modules` was incomplete — `drizzle-zod` (a declared `packages/db` dep) was unlinked, so importing `@imbau/db` (transitively pulled by the worker test globalSetup) threw ERR_MODULE_NOT_FOUND before any test ran.
- **Fix:** Ran `pnpm install` at the workspace root (linked 300 previously-missing packages; lockfile unchanged/up-to-date).
- **Files modified:** none (node_modules only)
- **Verification:** worker env + QuoteDoc suites run green.
- **Committed in:** n/a (environment fix, no repo change)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking).
**Impact on plan:** Both were prerequisites to make the plan's own verify commands pass — `@types/react` is the natural type companion to the plan-specified `react` dep, and the install fixed an incomplete worktree checkout. No scope creep.

## Issues Encountered
- Local shell defaults to Node 20 (pnpm target is Node 22) — activated Node 22 via nvm for all pnpm/test/typecheck runs.
- The worker test globalSetup migrates `@imbau/db` and requires live Postgres/Redis + DATABASE_*/REDIS_URL/auth env; supplied the documented local `_test` env (Docker Postgres :5432 owner imbau:dev, Redis :6380) so the suites run. Both containers were already up (healthy).

## Known Stubs
None. `QuoteDoc` is a real, fully-rendering document; the QR is passed in by the (wave-2) consumer — this plan intentionally ships only the pure layout + its render proof, per the plan's scope.

## User Setup Required
None - no external service configuration required. (`WEB_PUBLIC_BASE_URL` must be set in the worker's staging/prod env by the wave-2/deploy plan; in tests it defaults to a dummy.)

## Next Phase Readiness
- `QuoteDoc` + `QuoteDocProps`/`QuoteHeader` + `PdfModel` are ready for the wave-2 processor to call `renderToBuffer(QuoteDoc(...))`, generate the QR from `WEB_PUBLIC_BASE_URL` + deep-link, and persist/upload the PDF.
- **Deferred to CI/staging (D4):** container-runtime font resolution is only confirmable against a built worker image (no local Docker daemon) — the Dockerfile COPY is in place; verify in the Phase-4 image build / staging.

---
*Phase: 07-pdf-as-ncrono-en-el-worker*
*Completed: 2026-07-06*
