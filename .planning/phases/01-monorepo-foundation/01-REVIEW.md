---
phase: 01-monorepo-foundation
reviewed: 2026-06-13T03:06:29Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - .gitignore
  - .nvmrc
  - apps/panel/.env.example
  - apps/panel/app/layout.tsx
  - apps/panel/app/page.tsx
  - apps/panel/env.ts
  - apps/panel/next.config.ts
  - apps/panel/package.json
  - apps/panel/tsconfig.json
  - apps/web/.env.example
  - apps/web/app/layout.tsx
  - apps/web/app/page.tsx
  - apps/web/env.test.ts
  - apps/web/env.ts
  - apps/web/next.config.ts
  - apps/web/package.json
  - apps/web/tsconfig.json
  - apps/worker/.env.example
  - apps/worker/package.json
  - apps/worker/src/env.test.ts
  - apps/worker/src/env.ts
  - apps/worker/src/index.ts
  - apps/worker/tsconfig.json
  - apps/worker/tsup.config.ts
  - eslint.config.js
  - package.json
  - packages/api/package.json
  - packages/api/src/index.ts
  - packages/api/tsconfig.json
  - packages/config/env/presets.ts
  - packages/config/eslint.js
  - packages/config/package.json
  - packages/config/prettier.js
  - packages/config/tsconfig/base.json
  - packages/config/tsconfig/next.json
  - packages/config/tsconfig/node.json
  - packages/db/package.json
  - packages/db/src/index.ts
  - packages/db/tsconfig.json
  - packages/quoting/package.json
  - packages/quoting/src/index.test.ts
  - packages/quoting/src/index.ts
  - packages/quoting/tsconfig.json
  - packages/ui/package.json
  - packages/ui/src/index.tsx
  - packages/ui/tsconfig.json
  - pnpm-workspace.yaml
  - prettier.config.js
  - turbo.json
  - vitest.config.ts
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-13T03:06:29Z
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found

## Summary

This is a phase-0 monorepo scaffold (pnpm 11.6 + Turborepo 2.9 + Next 16.2 + TS 5.9
strict). The bulk of the surface is correctly wired: `strict` + `noUncheckedIndexedAccess`
are on in the shared base tsconfig, `.env*` files are git-ignored with an `.env.example`
allowlist, secrets are never committed, t3-env splits client/server vars to guard against
leaking server secrets into the browser bundle, and the env presets declare only variable
names + Zod schemas (no values). No hardcoded secrets, no `eval`/`innerHTML`, no SQL/command
injection surface, no `any`.

No Critical issues found. The findings are robustness/quality gaps that matter against the
project's own non-negotiable bar (observable errors via pino, money correctness, test gates
that actually gate). None block the scaffold from booting, but several contradict CLAUDE.md
commitments and would silently rot as later phases build on this foundation.

## Warnings

### WR-01: Worker logs via `console.log`, not pino — violates the observability bar

**File:** `apps/worker/src/index.ts:6`
**Issue:** CLAUDE.md lists structured logging with pino as a phase-0 observability
requirement ("Errores manejados y observables (Sentry + logs estructurados con pino), nunca
silenciados") and the stack table pins `pino@10.3.1` as a "Phase-0 observability requirement.
JSON logs → Loki." The worker entrypoint instead hand-rolls a `console.log(JSON.stringify(...))`.
This is the one runtime app that actually emits logs in phase 0, so it is exactly where the
pino convention should be established — every later job will copy this entrypoint pattern.
`console.log` also bypasses log levels, redaction, and the Loki/Promtail JSON contract.
**Fix:**
```ts
import pino from "pino";
import { env } from "./env";

const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
});

logger.info({ msg: "worker boot ok", node_env: env.NODE_ENV });
```
Add `pino` (and `pino-pretty` as a devDependency) to `apps/worker/package.json`.

### WR-02: `roundUsd` uses `Math.round`, which rounds half-values asymmetrically — wrong for money

**File:** `packages/quoting/src/index.ts:9-11`
**Issue:** `Math.round` rounds `.5` toward +Infinity, not away from zero:
`Math.round(2.5) === 3` but `Math.round(-2.5) === -2`, and `Math.round(-0.5) === -0`. For a
financial domain this asymmetry produces inconsistent magnitudes on negative amounts
(refunds, credits, adjustments) and a signed-zero artifact. CLAUDE.md is explicit that a
calc error here "mata el producto," and that money must never be float-shaped. While this is
a phase-0 placeholder and the 100% coverage + property-test gate lands in phase 3, the
function is already exported and already tested only on the safe `.6`/`.4` paths — the
dangerous `.5` boundary and negatives are untested, so the bug would ship looking covered.
At minimum document the rounding mode as a deliberate decision; preferably make it explicit.
**Fix:**
```ts
/** Rounds to the nearest whole USD, half away from zero (deterministic for negatives). */
export function roundUsd(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount));
}
```
And add boundary cases to the test: `roundUsd(2.5) === 3`, `roundUsd(-2.5) === -3`,
`roundUsd(-0.5)` does not return `-0`.

### WR-03: `web/env.test.ts` claims to gate panel's env but cannot — divergence goes uncaught

**File:** `apps/web/env.test.ts:9-10`; `apps/panel/package.json:12`; `apps/panel/env.ts`
**Issue:** The web env test comment asserts "panel reuses this exact env pattern, so one test
on web gates both." That guarantee does not hold. Panel's `test` script is
`vitest run --passWithNoTests` and ships zero env tests, while panel maintains its OWN copy of
the `createEnv` config (`apps/panel/env.ts`) — a separate file the web test never imports or
exercises. If panel's `env.ts` drifts (e.g. someone widens the `NEXT_PUBLIC_APP_ENV` enum,
drops a runtimeEnv wiring, or adds a server var), nothing fails. The test gives false
confidence about a file it has no reference to. The two env files are also near-identical
copy-paste, which is the root cause.
**Fix:** Either (a) extract the shared client/server schema into `@imbau/config/env/presets`
and have both apps compose it, then the web test genuinely covers the shared schema; or
(b) add a parallel `apps/panel/env.test.ts` that exercises panel's composed schema. Update the
misleading comment regardless — a test should not claim coverage it does not provide.

### WR-04: Inconsistent `SKIP_ENV_VALIDATION` semantics across apps

**File:** `apps/worker/src/env.ts:21`
**Issue:** The worker gates validation on `process.env.SKIP_ENV_VALIDATION === "1"` (strict
equality to the literal `"1"`). The Next apps (`apps/web/env.ts`, `apps/panel/env.ts`) rely on
`@t3-oss/env-nextjs`'s built-in handling, which treats any truthy `SKIP_ENV_VALIDATION` value
as "skip." So in a Docker build that exports `SKIP_ENV_VALIDATION=true` (the common idiom), the
web/panel builds skip validation but the worker build still validates and fails closed — and
vice-versa for `SKIP_ENV_VALIDATION=1`. Since the comment explicitly says this exists for the
fase-3 Docker image, the mismatch will produce confusing "works for web, breaks worker" build
failures. Standardize on the library's truthiness check.
**Fix:**
```ts
skipValidation: !!process.env.SKIP_ENV_VALIDATION,
```
so all three apps respond identically to the same env var.

## Info

### IN-01: Dead `else if` branch in worker env test issue handling

**File:** `apps/worker/src/env.test.ts:28-34`
**Issue:** The `else if (... typeof name === "object" && "key" in name)` branch is unreachable.
t3-env / Zod issue paths are `(string | number)[]`; `issue.path?.[0]` is a string or number,
never an object with a `key` property. The branch reads as defensive code for a shape that
does not occur and adds noise.
**Fix:** Drop the `else if` block; keep only the `typeof name === "string"` push.

### IN-02: `@imbau/api` and `@imbau/db` are declared but consumed by nothing

**File:** `packages/api/src/index.ts`; `packages/db/src/index.ts`
**Issue:** Both packages export only a string-literal placeholder and are imported by no app
or package (grep across `apps/` + `packages/` returns no consumers). This is intentional
phase-0 scaffolding per the in-file comments, so it is acceptable — flagged only so the
unused-export status is recorded. Neither package has a `test` script, so `turbo run test`
silently skips them; ensure real tests are wired when their logic lands (phase 2/3).
**Fix:** No action now. When implementing, add `test` scripts so the Turbo gate covers them.

### IN-03: `roundUsd` test omits the half-rounding boundary

**File:** `packages/quoting/src/index.test.ts:5-13`
**Issue:** The two cases (`1234.6`, `1234.4`) only exercise the unambiguous round-up /
round-down paths. The `.5` tie-break — the single most error-prone case for money rounding,
and the one that exposes WR-02 — is untested, as are negative inputs. The suite looks
complete but covers the easy paths only.
**Fix:** Add `expect(roundUsd(2.5))`, `expect(roundUsd(-2.5))`, and a no-`-0` assertion (see
WR-02). Full boundary + property coverage is the phase-3 QUOT-01 gate.

### IN-04: Duplicated Next `env.ts` and `next.config.ts` across web/panel

**File:** `apps/panel/env.ts`; `apps/web/env.ts`; `apps/panel/next.config.ts`; `apps/web/next.config.ts`
**Issue:** The two apps carry near-byte-identical `env.ts` (only differing in comments) and
`next.config.ts` (identical except `transpilePackages`/output which are the same). Copy-paste
config drifts silently — this is the structural cause behind WR-03. As more shared Next
config accrues (Sentry wiring, image config, headers), the divergence risk grows.
**Fix:** Hoist a shared `createWebEnv()` helper and a `baseNextConfig` factory into
`@imbau/config`, and have each app import + spread them. Keeps a single source of truth.

### IN-05: `web/env.ts` and `panel/env.ts` lack `emptyStringAsUndefined`

**File:** `apps/web/env.ts:11`; `apps/panel/env.ts:7`
**Issue:** Neither `createEnv` call sets `emptyStringAsUndefined: true`. In practice an empty
`NEXT_PUBLIC_APP_ENV=` (common in `.env` files where a key is present but blank) is passed as
`""` to the enum validator and fails with a confusing "invalid enum value" rather than the
clearer "missing variable." Low impact but it is the standard t3-env hardening and improves
the boot-failure message quality the phase aims for.
**Fix:** Add `emptyStringAsUndefined: true` to both `createEnv` calls (and the worker's for
consistency).

---

_Reviewed: 2026-06-13T03:06:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
