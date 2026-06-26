---
phase: 01-monorepo-foundation
plan: 03
subsystem: apps
tags: [next16, react19, t3-env, env-validation, worker, tsup, tsx, status-page, es-AR, jit, monorepo]

# Dependency graph
requires:
  - phase: 01-01
    provides: Root workspace (package.json + pnpm-workspace.yaml + turbo.json) con pin pnpm@11.6.0 / Node 22 y task graph build/typecheck/lint/test/dev
  - phase: 01-02
    provides: "@imbau/config (presets tsconfig next/node + ESLint 9 flat + env presets baseEnv/dbEnv/redisEnv) y @imbau/ui (AppStatus) consumidos por las apps"
provides:
  - "Tres apps en la cima del DAG: @imbau/web (:3000), @imbau/panel (:3001) Next 16 App Router, @imbau/worker (tsx watch dev / tsup build)"
  - "Validación de env tipada por app vía @t3-oss/env: web/panel con env-nextjs (NODE_ENV + NEXT_PUBLIC_APP_ENV, sin REDIS_URL); worker con env-core (NODE_ENV + DATABASE_URL + REDIS_URL, sin NEXT_PUBLIC_*) — cada app declara solo lo que usa (D-02)"
  - "Fail-fast al boot/build con error agregado: t3-env junta todos los issues de Zod por default; SKIP_ENV_VALIDATION honrado solo para el build Docker de fase 3 (D-03)"
  - "Status page es-AR (voseo) en web y panel: nombre de app + entorno + confirmación de env validado, consumiendo @imbau/ui (arista app → ui probada, D-12)"
  - "Worker shell deployable: bootea logueando JSON estructurado, sin lógica de jobs BullMQ (out of scope)"
  - ".env.example por app (placeholders) consistente con su schema, versionado como doc viva (D-04)"
  - "Tests de env agregado (web + worker) que verifican que las vars fallidas surfacean por nombre vía onValidationError, sin filtrar el valor (V7)"
  - "pnpm build / lint / typecheck / test verdes en todo el workspace (7 typecheck, 7 lint, 3 build, 4 test)"
affects: [04-staging-cicd, all-future-phases]

# Tech tracking
tech-stack:
  added:
    - next@16.2.9
    - react@19.2.7 + react-dom@19.2.7 (apps web/panel)
    - "@t3-oss/env-nextjs@0.13.11 (web/panel)"
    - "@t3-oss/env-core@0.13.11 (worker + tests de env)"
    - tsx@4.22.4 (worker dev)
    - tsup@8.5.1 (worker prod bundle)
    - "@types/node@22.18.13"
    - "@types/react-dom@19.2.3"
  patterns:
    - "Validación de env por-app: cada env.ts compone los presets de @imbau/config que usa vía createEnv (D-01/D-02); next.config y worker/index importan ./env primero para validar al boot/build (D-03)"
    - "t3-env agrega issues por default (A2); el mensaje thrown es genérico pero los nombres de vars fallidas se capturan vía onValidationError(issues) — los tests assertean sobre issue.path[0], nunca sobre el valor (V7, D-04/D-10)"
    - "Next apps JIT: transpilePackages [@imbau/ui, @imbau/config] consume src crudo sin dist (D-05); output standalone + turbopack.root/outputFileTracingRoot pinneados al root del workspace"
    - "Worker bundle: tsup con noExternal /@imbau// inlinea los workspace packages en un solo output, listo para la imagen Docker de fase 3 (D-06)"
    - "Allowlist de build-scripts de pnpm 11 en pnpm-workspace.yaml (onlyBuiltDependencies: esbuild, sharp) — el campo pnpm de package.json ya no se lee en pnpm 11"

key-files:
  created:
    - apps/worker/package.json
    - apps/worker/tsconfig.json
    - apps/worker/tsup.config.ts
    - apps/worker/src/env.ts
    - apps/worker/src/env.test.ts
    - apps/worker/src/index.ts
    - apps/worker/.env.example
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/next.config.ts
    - apps/web/env.ts
    - apps/web/app/layout.tsx
    - apps/web/app/page.tsx
    - apps/web/env.test.ts
    - apps/web/.env.example
    - apps/panel/package.json
    - apps/panel/tsconfig.json
    - apps/panel/next.config.ts
    - apps/panel/env.ts
    - apps/panel/app/layout.tsx
    - apps/panel/app/page.tsx
    - apps/panel/.env.example
  modified:
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - .gitignore

key-decisions:
  - "El error thrown de t3-env es genérico ('Invalid environment variables'); los nombres de vars fallidas viven en los issues que pasa onValidationError. Los tests de env agregado se reescribieron para capturar issues y assertear sobre los nombres (path[0]) en vez de regex sobre el mensaje — el RESEARCH asumía los nombres en el thrown string (A2 corregido contra el paquete instalado)"
  - "@t3-oss/env-core agregado como devDep de web para que el test de env corra framework-agnostic (sin runtime de Next); env-nextjs está construido sobre env-core, así que testear el schema compuesto vía core es válido"
  - "panel reusa el patrón de env de web; un solo test en web gatea ambos (mismo schema compuesto, D-09). panel usa vitest run --passWithNoTests para que su suite vacía pase limpio bajo turbo"
  - "turbopack.root + outputFileTracingRoot pinneados al root del workspace para silenciar el warning de Next que inferia un lockfile externo (/Users/.../package-lock.json) como root"
  - "onlyBuiltDependencies (esbuild, sharp) en pnpm-workspace.yaml — es el home de pnpm 11 para la allowlist de build-scripts; package.json.pnpm ya no se lee"

patterns-established:
  - "Costura de env probada end-to-end: cada app compone solo los presets que usa (D-02) y falla cerrado al boot/build con error agregado accionable (D-04)"
  - "Status page es-AR como smoke target de deploy: primera UI visible, aplica la convención de idioma voseo desde el día uno"
  - "Apps como cima del DAG: que web/panel/worker compilen consumiendo @imbau/ui + @imbau/config valida toda la cadena descendente (MONO-01)"

requirements-completed: [MONO-01, MONO-03]

# Metrics
duration: 28min
completed: 2026-06-13
---

# Phase 1 Plan 03: Apps (web + panel + worker) Summary

**Las tres apps en la cima del DAG con validación de env tipada por @t3-oss/env que falla rápido al boot/build con error agregado: web/panel (Next 16) muestran status page es-AR consumiendo @imbau/ui, el worker es un shell deployable bundleado con tsup — `pnpm build`/`lint`/`typecheck`/`test` verdes en todo el workspace, cerrando MONO-01 y MONO-03.**

## Performance

- **Duration:** ~28 min
- **Completed:** 2026-06-13
- **Tasks:** 2 (ambas con ciclo TDD para el gate de env)
- **Files modified:** 25 (22 creados + 3 modificados)

## Accomplishments
- **Worker (`@imbau/worker`)**: shell deployable con `tsx watch` (dev) y `tsup` (build prod, bundlea `@imbau/*` en un solo output listo para Docker fase 3, D-06). `src/env.ts` valida `NODE_ENV` + `DATABASE_URL` + `REDIS_URL` con `@t3-oss/env-core` componiendo `baseEnv`/`dbEnv`/`redisEnv` (D-02 — sin vars de browser). `SKIP_ENV_VALIDATION` honrado solo para el build Docker (D-03). `src/index.ts` importa `./env` primero (valida al boot) y loguea JSON estructurado de boot ok, sin lógica de jobs BullMQ (out of scope, APP-03).
- **web + panel (`@imbau/web` :3000, `@imbau/panel` :3001)**: apps Next 16 App Router. `env.ts` valida `NODE_ENV` + `NEXT_PUBLIC_APP_ENV` con `@t3-oss/env-nextjs` (split client/server contra leak al bundle, T-03-01; sin `REDIS_URL`, D-02). `next.config.ts` con `transpilePackages` (consumo JIT, D-05), `output: standalone` (Docker fase 3) y `turbopack.root`/`outputFileTracingRoot` pinneados. `app/layout.tsx` con `lang="es-AR"`; `app/page.tsx` status page es-AR voseo (nombre app + entorno + confirmación de env validado) consumiendo `AppStatus` de `@imbau/ui` (arista app → ui, D-12).
- **Tests de env agregado (D-04, D-10)**: worker assertea que `DATABASE_URL` inválido + `REDIS_URL` faltante surfacean **ambos** nombres; web assertea que `NEXT_PUBLIC_APP_ENV` inválido surfacea su nombre. Ambos capturan los issues vía `onValidationError` y assertean sobre `issue.path[0]`, nunca sobre el valor ofensor (V7).
- **`.env.example` por app** (placeholders, nunca valores reales) consistente con cada schema; `.gitignore` (plan 01) ya bloquea `.env*` excepto `.env.example`.
- **Workspace verde**: `pnpm typecheck` (7/7), `pnpm lint` (7/7), `pnpm test` (4/4), `pnpm build` (3/3 — web+panel compilan con salida standalone, worker bundlea con tsup) — sin warnings.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Worker — shell deployable + env-core con error agregado (MONO-03, D-06)** — `f32fa4d` (feat)
2. **Task 2: web + panel — Next 16, env-nextjs, status page es-AR (MONO-01, MONO-03, D-09)** — `28d444f` (feat)

_Nota: el commit de metadata (este SUMMARY) lo registra el paso final en modo worktree._

## Files Created/Modified
- `apps/worker/{package.json,tsconfig.json,tsup.config.ts}` — `@imbau/worker` (ESM, private); deps `@t3-oss/env-core` 0.13.11 + `zod` 4.4.3 + `@imbau/config`; devDeps `tsx` 4.22.4, `tsup` 8.5.1, `@types/node` 22.18.13, `typescript` 5.9.3. tsconfig extiende `@imbau/config/tsconfig/node.json`. tsup con `noExternal: [/^@imbau\//]`.
- `apps/worker/src/{env.ts,index.ts,env.test.ts}` — env-core compuesto + boot shell + test de error agregado (dos vars mal → ambos nombres vía onValidationError).
- `apps/worker/.env.example` — `DATABASE_URL`/`REDIS_URL`/`NODE_ENV` con placeholders.
- `apps/web/{package.json,tsconfig.json,next.config.ts,env.ts,env.test.ts,.env.example}` + `apps/web/app/{layout.tsx,page.tsx}` — `@imbau/web` Next 16 (:3000). Mismo set para `apps/panel/*` (`@imbau/panel`, :3001).
- `pnpm-workspace.yaml` (modificado) — `onlyBuiltDependencies: [esbuild, sharp]`.
- `pnpm-lock.yaml` (modificado) — lockfile con las 3 apps (9 workspace projects).
- `.gitignore` (modificado) — ignora `next-env.d.ts` (generado por Next en cada build).

## Decisions Made
- **Tests de env reescritos para capturar `onValidationError`:** el RESEARCH (A4/Code Examples) asumía que los nombres de vars fallidas estaban en el mensaje thrown. La verificación contra `@t3-oss/env-core` 0.13.11 mostró que el thrown es genérico (`"Invalid environment variables"`) y los nombres viven en los `issues` que recibe `onValidationError(issues: readonly StandardSchemaV1.Issue[])`. Los tests capturan esos issues y assertean sobre `issue.path[0]` — cumple D-04/D-10 (error agregado por nombre) sin override que filtre valores (V7).
- **`@t3-oss/env-core` como devDep de web:** permite testear el schema compuesto framework-agnostic (sin runtime de Next, que requiere contexto de request para client vars). env-nextjs está construido sobre env-core, así que es la forma canónica de testear el gate.
- **`panel` con `--passWithNoTests`:** el plan especifica que un test en web gatea ambos (mismo schema compuesto, D-09); `vitest run` sin tests sale con código 1 y rompía `pnpm test`, así que panel usa `--passWithNoTests`.
- **`turbopack.root` + `outputFileTracingRoot` pinneados:** Next 16 detectaba un `package-lock.json` externo del home del usuario y lo inferia como workspace root (warning). Pinnear ambos al root del worktree silencia el warning (CLAUDE.md: warnings se resuelven, no se silencian).
- **`onlyBuiltDependencies` en `pnpm-workspace.yaml`:** pnpm 11.6.0 imprime explícitamente que el campo `pnpm` de `package.json` "is no longer read"; el home correcto de la allowlist de build-scripts es `pnpm-workspace.yaml`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Allowlist de build-scripts de pnpm (esbuild, sharp)**
- **Found during:** Task 1 (`pnpm install` / `pnpm test` con el worker) y Task 2 (instalación de Next, que arrastra sharp)
- **Issue:** pnpm 11.6.0 ignora por default los install-scripts de `esbuild` (transitivo de vitest/tsx/tsup) y `sharp` (optimizador de imágenes de Next 16). Su `runDepsStatusCheck` (corre antes de `turbo`) trataba el `ERR_PNPM_IGNORED_BUILDS` como fatal (exit 1), rompiendo `pnpm test`/`build`/`typecheck`/`lint` en todo el workspace. El placeholder inválido `allowBuilds:` que traía `pnpm-workspace.yaml` no es una key que pnpm lea.
- **Fix:** Se reemplazó por `onlyBuiltDependencies: [esbuild, sharp]` en `pnpm-workspace.yaml` (el home de pnpm 11; el campo `pnpm` de package.json ya no se lee). Se reseteó una vez `node_modules/.modules.yaml` para que el estado de builds ignorados se re-evaluara. Ambos paquetes son legítimos y esperados (verificados en el Package Legitimacy Audit del RESEARCH para esbuild/tsup/tsx; sharp es el optimizador oficial de Next). No se instaló ningún alternativo ni se cambió ninguna versión pinneada.
- **Files modified:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- **Verification:** `pnpm install` sale 0 sin `ERR_PNPM_IGNORED_BUILDS`; `pnpm test`/`build`/`typecheck`/`lint` verdes.
- **Committed in:** `f32fa4d` (esbuild) y `28d444f` (sharp)

**2. [Rule 3 - Blocking] `@types/node` faltante para el typecheck del worker**
- **Found during:** Task 1 (`tsc --noEmit` del worker)
- **Issue:** El preset `@imbau/config/tsconfig/node.json` declara `"types": ["node"]`, pero el worker no tenía `@types/node` → `TS2688: Cannot find type definition file for 'node'`.
- **Fix:** Se añadió `@types/node@22.18.13` (línea Node 22 LTS) como devDep del worker (y de web/panel para sus `next.config.ts`/runtime).
- **Files modified:** `apps/worker/package.json` (+ web/panel package.json en Task 2)
- **Verification:** `pnpm --filter @imbau/worker typecheck` sale 0.
- **Committed in:** `f32fa4d`

**3. [Rule 3 - Blocking] `@t3-oss/env-core` faltante para el test de env de web**
- **Found during:** Task 2 (`vitest run` de web)
- **Issue:** `apps/web/env.test.ts` importa `createEnv` de `@t3-oss/env-core` para testear el schema framework-agnostic, pero web solo tenía `@t3-oss/env-nextjs` como dep → `Cannot find package '@t3-oss/env-core'` (aislamiento estricto de pnpm).
- **Fix:** Se añadió `@t3-oss/env-core@0.13.11` como devDep de web. Es la base de env-nextjs, así que testear el schema compuesto vía core es válido y evita necesitar un runtime de Next.
- **Files modified:** `apps/web/package.json`
- **Verification:** `pnpm --filter @imbau/web test` → 2/2 passed.
- **Committed in:** `28d444f`

**4. [Rule 1 - Bug] Warning de workspace-root de Next (lockfile externo inferido)**
- **Found during:** Task 2 (`next build` de web)
- **Issue:** Next 16 detectaba un `package-lock.json` en el home del usuario y lo inferia como root del workspace (warning de "multiple lockfiles"). CLAUDE.md exige resolver warnings, no silenciarlos.
- **Fix:** Se pinneó `turbopack.root` + `outputFileTracingRoot` al root del worktree (`../..` resuelto desde `import.meta.url`) en ambos `next.config.ts`.
- **Files modified:** `apps/web/next.config.ts`, `apps/panel/next.config.ts`
- **Verification:** `pnpm build` sin warning de workspace root.
- **Committed in:** `28d444f`

**5. [Rule 1 - Bug] `next-env.d.ts` generado quedaba untracked**
- **Found during:** Task 2 (post-build, antes de commitear)
- **Issue:** `next build` genera `next-env.d.ts` por app; no estaba en `.gitignore` → quedaba como archivo generado untracked.
- **Fix:** Se añadió `next-env.d.ts` al `.gitignore` (Next lo regenera en cada build).
- **Files modified:** `.gitignore`
- **Verification:** `git diff --cached --name-only | grep next-env` → vacío (excluido del commit).
- **Committed in:** `28d444f`

**6. [Rule 1 - Bug] Comentarios con tokens `REDIS_URL` / `NEXT_PUBLIC_` rompían los grep de aceptación**
- **Found during:** Task 1 y Task 2 (verificación automatizada del plan)
- **Issue:** Los criterios de aceptación usan `! grep -q 'REDIS_URL'` (web env.ts) y `! grep -q 'NEXT_PUBLIC_'` (worker env.ts). Mis comentarios explicativos mencionaban esos tokens literalmente, haciendo fallar el grep negado aunque el código fuera correcto.
- **Fix:** Se reformularon los comentarios para no usar los tokens literales (p.ej. "la var Redis worker-only" / "vars de browser") manteniendo el sentido.
- **Files modified:** `apps/worker/src/env.ts`, `apps/web/env.ts`, `apps/panel/env.ts`
- **Verification:** Los verify automatizados de ambos tasks pasan (`TASK2 VERIFY OK`).
- **Committed in:** `f32fa4d` (worker) y `28d444f` (web/panel)

---

**Total deviations:** 6 auto-fixed (3 blocking, 3 bug). Sin Rule 4 (ningún cambio arquitectónico).
**Impact on plan:** Sin scope creep. Todas son correcciones de wiring/correctitud (allowlist de builds, tipos faltantes, dep de test, warnings de Next, gitignore, tokens en comentarios) necesarias para que MONO-01/MONO-03 corran verde. Ninguna versión pinneada cambió; no se añadió alcance funcional. El único descubrimiento de fondo —que t3-env agrega los nombres en `onValidationError` y no en el thrown string— se reflejó en los tests sin alterar el comportamiento fail-closed de producción.

## Issues Encountered
- pnpm 11 trata `ERR_PNPM_IGNORED_BUILDS` como fatal en el deps-check pre-turbo → resuelto con `onlyBuiltDependencies` + reset puntual de `.modules.yaml` (Deviation 1).
- El thrown de t3-env es genérico; los nombres de vars fallidas están en los issues de `onValidationError` (Deviation contextual reflejada en los tests).
- El host requiere Node 22 activo (`nvm use 22`) para que pnpm 11.6.0 corra; se mantuvo activo en toda la ejecución.

## User Setup Required
None — no se requiere configuración de servicios externos en este plan. Para correr web/panel en build/dev se necesita `NEXT_PUBLIC_APP_ENV` (placeholder en `.env.example`); `NODE_ENV` tiene default en el preset.

## Threat Surface
- **T-03-01 (Information Disclosure / server var → client bundle):** mitigado — split client/server de env-nextjs; solo `NEXT_PUBLIC_APP_ENV` en el bloque client; web/panel no declaran `REDIS_URL`; las páginas leen el `env` validado, no `process.env` directo.
- **T-03-02 (Information Disclosure / mensaje de error):** mitigado — los tests y el código usan los issues por nombre (`path`); nunca se imprime el valor ofensor; no hay override de onValidationError en producción que filtre valores.
- **T-03-03 (Information Disclosure / `.env` reales):** mitigado — `.gitignore` bloquea `.env*`; solo `.env.example` con placeholders se versiona.
- **T-03-04 (DoS / fail-open):** mitigado — env-nextjs/core validan al import (boot/build) y fallan cerrado; `SKIP_ENV_VALIDATION` solo en build Docker (fase 3), nunca al boot.
- **T-03-SC (Tampering / npm installs):** mitigado — todos los paquetes (env-nextjs/core, next, react, tsx, tsup, sharp, @types/*) aprobados; `onlyBuiltDependencies` limita los install-scripts a esbuild + sharp (ambos conocidos).
- Sin nuevas superficies de amenaza fuera del threat_model del plan.

## Next Phase Readiness
- MONO-01 y MONO-03 cerrados: las tres apps compilan consumiendo la cadena descendente (apps → ui/config) y validan su env con fail-fast accionable. La fase 01 (monorepo foundation) queda lista para CI (fase 4): `pnpm lint`/`typecheck`/`test`/`build` verdes en todo el workspace.
- **Pendiente del orchestrator (no de este sub-agente):** integrar el worktree, actualizar STATE.md/ROADMAP.md, y el ship-time PR/merge de la fase.
- **Nota de entorno:** el host necesita Node 22 activo (`nvm use 22` / `.nvmrc`) para pnpm 11.6.0.

## Known Stubs
- `@imbau/db` y `@imbau/api` siguen siendo placeholders tipados (creados en plan 02) — Drizzle/tRPC llegan en fases 2-3. No bloquean el objetivo de este plan (las apps no los consumen todavía).
- `apps/worker/src/index.ts` es intencionalmente un shell sin jobs BullMQ (out of scope explícito, APP-03 — los jobs de media/PDFs llegan en fases posteriores). Documentado en el plan como deployable shell.

## Self-Check: PASSED
