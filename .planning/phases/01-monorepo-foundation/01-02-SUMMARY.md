---
phase: 01-monorepo-foundation
plan: 02
subsystem: infra
tags: [packages, config, eslint9, typescript, prettier, zod, vitest, react19, jit, monorepo]

# Dependency graph
requires:
  - phase: 01-01
    provides: Root workspace (package.json + pnpm-workspace.yaml + turbo.json) con pin pnpm@11.6.0 / Node 22 y task graph build/typecheck/lint/test/dev
provides:
  - "@imbau/config — raíz del DAG: presets tsconfig (base/next/node estricto TS 5.9), ESLint 9 flat config (typescript-eslint recommendedTypeChecked + projectService + prettier last), Prettier config compartida y env presets Zod parciales (baseEnv, dbEnv, redisEnv)"
  - "Cuatro packages leaf JIT (@imbau/db, @imbau/api, @imbau/ui, @imbau/quoting) con exports → src/*.ts crudo (sin dist/) y dep descendente @imbau/config vía workspace:*"
  - "roundUsd(amount): función pura integer-friendly en @imbau/quoting con test Vitest verde (2 assertions)"
  - "AppStatus: componente React trivial en @imbau/ui consumible por web+panel"
  - "Root eslint.config.js / prettier.config.js cableados a @imbau/config; vitest.config.ts con provider de cobertura v8"
  - "pnpm lint + pnpm typecheck + pnpm test verdes en todos los packages desde el día uno"
affects: [03-packages-apps-skeleton, 04-staging-cicd, all-future-plans]

# Tech tracking
tech-stack:
  added:
    - eslint@9.39.4
    - typescript-eslint@8.61.0
    - eslint-config-prettier@10.1.8
    - prettier@3.8.4
    - zod@4.4.3
    - vitest@4.1.8
    - "@vitest/coverage-v8@4.1.8"
    - react@19.2.7 + react-dom@19.2.7 (peer en @imbau/ui)
    - "@types/react@19.2.17"
  patterns:
    - "packages/config como única fuente de verdad de tooling: tsconfig presets + ESLint flat + Prettier + env presets, todo el workspace importa de ahí (MONO-02)"
    - "Packages JIT: exports apuntan a src/*.ts crudo, sin dist/ ni paso de build (D-05)"
    - "ESLint 9 flat config con projectService:true (no project arrays) — type-aware lint monorepo-friendly sin no-op silencioso (T-02-01, Pitfall 2); eslint-config-prettier siempre último"
    - "tsconfig estricto compartido (strict + noUncheckedIndexedAccess + verbatimModuleSyntax) que cada leaf extiende; typecheck = tsc --noEmit por package (D-07)"
    - "Vitest descubre tests por package vía glob default relativo al cwd del package (root config sólo aporta coverage/v8), orquestado por Turbo"

key-files:
  created:
    - packages/config/package.json
    - packages/config/tsconfig/base.json
    - packages/config/tsconfig/next.json
    - packages/config/tsconfig/node.json
    - packages/config/eslint.js
    - packages/config/prettier.js
    - packages/config/env/presets.ts
    - packages/quoting/package.json
    - packages/quoting/tsconfig.json
    - packages/quoting/src/index.ts
    - packages/quoting/src/index.test.ts
    - packages/db/package.json
    - packages/db/tsconfig.json
    - packages/db/src/index.ts
    - packages/api/package.json
    - packages/api/tsconfig.json
    - packages/api/src/index.ts
    - packages/ui/package.json
    - packages/ui/tsconfig.json
    - packages/ui/src/index.tsx
    - eslint.config.js
    - prettier.config.js
    - vitest.config.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "eslint@9.39.4 y typescript@5.9.3 pinneados explícitamente (npm latest es eslint 10 / TS 6) — CLAUDE.md prohíbe flotar a TS 6 / ESLint 10 hasta confirmar soporte del matrix"
  - "eslint como devDep del root (bin en node_modules/.bin) + @imbau/config como devDep del root para que el eslint.config.js raíz resuelva; los leaf corren `eslint .` heredando el bin del root"
  - "Root vitest.config.ts sin include root-anclado: la glob default de Vitest resuelve relativa al cwd del package que la invoca (Turbo corre el test script en cada package)"
  - "Root package.json marcado \"type\": \"module\" para que el eslint.config.js ESM no dispare MODULE_TYPELESS_PACKAGE_JSON"

patterns-established:
  - "DAG de tooling con raíz única @imbau/config — un cambio de config se propaga a todo el workspace"
  - "Packages leaf JIT con export genuino mínimo (D-12): quoting función pura, ui componente, db/api placeholder tipado; nada especulativo de fases 2-3"

requirements-completed: [MONO-01, MONO-02]

# Metrics
duration: 12min
completed: 2026-06-13
---

# Phase 1 Plan 02: Shared Config + Leaf Packages Summary

**`@imbau/config` como raíz del DAG (tsconfig estricto TS 5.9 + ESLint 9 flat con projectService + Prettier + env presets Zod) y cuatro packages leaf JIT (quoting con `roundUsd` + test verde, ui con `AppStatus`, db/api placeholders tipados) — `pnpm lint`/`typecheck`/`test` verdes en todo el workspace.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-13T02:31:00Z (aprox.)
- **Completed:** 2026-06-13T02:43:00Z (aprox.)
- **Tasks:** 2 (Task 2 con ciclo TDD RED→GREEN)
- **Files modified:** 25 (23 creados + 2 modificados)

## Accomplishments
- `packages/config` (`@imbau/config`) creado como única fuente de verdad de tooling (MONO-02): tres presets tsconfig (`base`/`next`/`node`) con `strict: true` + `noUncheckedIndexedAccess: true` + `verbatimModuleSyntax: true`; ESLint 9 flat config (`tseslint.config(...recommendedTypeChecked, { projectService: true }, prettier)` con prettier último); Prettier config compartida; env presets Zod parciales (`baseEnv`, `dbEnv`, `redisEnv`) que sólo declaran nombres/schemas, nunca valores (T-02-02).
- Cuatro packages leaf JIT con dep descendente `@imbau/config` `workspace:*` (MONO-01): `@imbau/quoting` (`roundUsd` pura + test Vitest), `@imbau/ui` (`AppStatus` React), `@imbau/db` y `@imbau/api` (placeholders tipados sin Drizzle/tRPC — fases 2-3). Exports apuntan a `src/*.ts` crudo, ningún `build`/`dist`.
- `pnpm lint`, `pnpm typecheck` y `pnpm test` verdes en los 4 leaf packages vía Turbo, sin warnings; cobertura v8 cableada (sin umbral todavía — el 100% de quoting llega con QUOT-01 en fase 3).

## Task Commits

Cada task se commiteó atómicamente; Task 2 (tdd) se dividió en gate RED y gate GREEN:

1. **Task 1: packages/config — presets tsconfig + ESLint 9 flat + Prettier + env presets (MONO-02)** — `d9eb651` (feat)
2. **Task 2 (RED): test fallido de roundUsd + root Vitest config** — `e22655c` (test)
3. **Task 2 (GREEN): roundUsd + packages db/api/ui leaf (MONO-01)** — `1009618` (feat)

_Nota: el commit de metadata (este SUMMARY) lo registra el paso final en modo worktree._

## Files Created/Modified
- `packages/config/package.json` — `@imbau/config` (private, ESM); `exports` map (eslint/prettier/3 tsconfig/env presets); devDeps eslint 9 + typescript-eslint 8.61 + eslint-config-prettier 10.1.8 + prettier 3.8.4 + typescript 5.9.3; dep zod 4.4.3.
- `packages/config/tsconfig/base.json` — preset TS 5.9 estricto (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `module ESNext`, `moduleResolution Bundler`).
- `packages/config/tsconfig/next.json` / `node.json` — extienden base (next: `jsx preserve` + lib DOM; node: lib ES2022 + types node).
- `packages/config/eslint.js` — flat config array (`tseslint.config`, `projectService: true`, `prettier` último, ignores de dist/.next/.turbo).
- `packages/config/prettier.js` — config Prettier compartida (`singleQuote: false`, `semi: true`, `trailingComma: all`).
- `packages/config/env/presets.ts` — `baseEnv`/`dbEnv`/`redisEnv` (`as const`), sólo nombres + schemas Zod.
- `packages/quoting/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}` — `roundUsd(amount): number` (Math.round, integer USD) + test Vitest (1234.6→1235, 1234.4→1234).
- `packages/db/{package.json,tsconfig.json,src/index.ts}` — placeholder tipado (`DbPackage`/`dbPackage`), sin Drizzle.
- `packages/api/{package.json,tsconfig.json,src/index.ts}` — placeholder tipado (`ApiPackage`/`apiPackage`), sin tRPC.
- `packages/ui/{package.json,tsconfig.json,src/index.tsx}` — componente React `AppStatus` (peer react/react-dom 19.2, tsconfig extiende next.json).
- `eslint.config.js` (root) — re-exporta default el array de `@imbau/config/eslint`.
- `prettier.config.js` (root) — re-exporta default la config de `@imbau/config/prettier`.
- `vitest.config.ts` (root) — provider de cobertura v8 (sin umbral); descubrimiento de tests por package vía glob default.
- `package.json` (root, modificado) — `"type": "module"`; devDeps añadidos: `@imbau/config` (workspace:*), `eslint` 9.39.4, `vitest` 4.1.8, `@vitest/coverage-v8` 4.1.8.
- `pnpm-lock.yaml` (modificado) — lockfile actualizado con los 5 packages del workspace.

## Decisions Made
- **Pin explícito eslint@9.39.4 + typescript@5.9.3:** npm latest es ESLint 10 / TS 6.0.3, pero CLAUDE.md ("What NOT to Use") prohíbe flotar hasta que typescript-eslint/drizzle-kit/next confirmen soporte. Se pinnea la línea segura de fase 0.
- **eslint + @imbau/config como devDeps del root:** ver Deviations (Rule 3) — necesario para que el bin de eslint y el `eslint.config.js` raíz resuelvan al correr `eslint .` desde cada leaf.
- **Vitest sin include root-anclado:** la glob default `**/*.test.ts` resuelve relativa al cwd; como Turbo corre el `test` script dentro de cada package, cada uno descubre sus propios tests. Un include `packages/**/...` sólo funcionaría invocando desde el root.
- **`"type": "module"` en root package.json:** elimina el warning `MODULE_TYPELESS_PACKAGE_JSON` del `eslint.config.js` ESM (CLAUDE.md: warnings no se silencian, se resuelven).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wiring del binario de ESLint y del config raíz para los leaf packages**
- **Found during:** Task 2 (`pnpm lint`)
- **Issue:** Los leaf packages corren `eslint .` pero `eslint` sólo era devDep de `@imbau/config`; el aislamiento estricto de pnpm no expone el bin transitivo a cada leaf → `sh: eslint: command not found` en los 4 packages. Además el `eslint.config.js` raíz importa de `@imbau/config` y necesita resolver ese package desde el root.
- **Fix:** Se añadió `eslint@9.39.4` y `@imbau/config` (`workspace:*`) como devDeps del root. El bin queda en `node_modules/.bin/eslint` y los scripts de los leaf lo heredan vía el PATH de pnpm; el config raíz resuelve `@imbau/config`.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm lint` → 4 successful, 4 total (sin errores).
- **Committed in:** `1009618` (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Vitest no descubría el test con include root-anclado**
- **Found during:** Task 2 (RED, primer `pnpm --filter @imbau/quoting test`)
- **Issue:** El `vitest.config.ts` inicial tenía `include: ["packages/**/src/**/*.test.ts"]`; al correr el script dentro del package quoting, esa glob resuelve relativa al cwd del package y no matcheaba → "No test files found, exiting with code 1".
- **Fix:** Se quitó el include root-anclado; Vitest usa su glob default relativa al cwd del package. El root config retiene sólo la config de cobertura v8.
- **Files modified:** `vitest.config.ts`
- **Verification:** RED post-fix falla correctamente por "Cannot find module './index'" (test descubierto); GREEN pasa 2/2.
- **Committed in:** `e22655c` (Task 2 RED commit — el config quedó correcto antes de impl)

**3. [Rule 1 - Bug] Warning MODULE_TYPELESS_PACKAGE_JSON al lintear**
- **Found during:** Task 2 (`pnpm lint`, primera corrida verde)
- **Issue:** El `eslint.config.js` raíz es ESM pero el root `package.json` no declaraba `"type": "module"` → Node emitía `MODULE_TYPELESS_PACKAGE_JSON` + overhead de re-parseo en cada corrida de lint. CLAUDE.md exige errores/warnings observables, no silenciados.
- **Fix:** Se añadió `"type": "module"` al root `package.json`.
- **Files modified:** `package.json`
- **Verification:** `pnpm lint --force` → 4 successful, sin warnings.
- **Committed in:** `1009618` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bug).
**Impact on plan:** Sin scope creep. Las tres correcciones son de correctitud de wiring (bin de eslint, descubrimiento de tests, warning de módulo) necesarias para que MONO-02 corra verde; ninguna versión pinneada cambió y no se añadió alcance funcional.

## Issues Encountered
- pnpm strict isolation no expone el bin de eslint desde un dep transitivo → resuelto añadiéndolo al root (Deviation 1).
- Interacción glob-de-Vitest vs cwd-del-package → resuelto quitando el include root-anclado (Deviation 2).
- El host requiere Node 22 activo (`nvm use 22`) para que pnpm 11.6.0 corra; se mantuvo activo en toda la ejecución (heredado del entorno de fase 1).

## User Setup Required
None — no se requiere configuración de servicios externos en este plan.

## Threat Surface
- **T-02-01 (Tampering / typescript-eslint type-checked):** mitigado — `projectService: true` (no `project` arrays) evita el no-op silencioso de reglas type-aware; typescript-eslint 8.61.0 verificado contra ESLint 9 + TS 5.9.
- **T-02-02 (Information Disclosure / env presets):** aceptado — los presets sólo declaran nombres + schemas Zod (NODE_ENV, DATABASE_URL, REDIS_URL); ningún valor/secret cruza al repo.
- **T-02-03 (Denial of Service / tsconfig estricto roto):** mitigado — `tsc --noEmit` por package (typecheck gate) detecta config rota antes de propagarse a las apps del plan 03; `pnpm typecheck` verde en los 4 leaf.
- Sin nuevas superficies de amenaza fuera del threat_model del plan.

## Next Phase Readiness
- DAG de tooling listo: cualquier nuevo package/app puede `extends @imbau/config/tsconfig/*` y heredar ESLint/Prettier sin redefinir config.
- `pnpm lint`/`typecheck`/`test` verdes desde el día uno → prerequisito de CI (fase 4) cumplido.
- **Pendiente del orchestrator (no de este sub-agente):** integrar el worktree y, al cerrar la fase, el ship-time PR/merge.
- **Nota de entorno:** el host necesita Node 22 activo (`nvm use 22` / `.nvmrc`) para pnpm 11.6.0.

## Self-Check: PASSED

- Archivos creados verificados en disco: los 23 archivos del plan (packages/config/*, packages/{quoting,db,api,ui}/*, eslint.config.js, prettier.config.js, vitest.config.ts) — todos FOUND.
- Commits verificados en git log: `d9eb651` (config), `e22655c` (RED test), `1009618` (GREEN feat) — todos FOUND.
- Verificaciones automatizadas de ambos tasks pasaron; `pnpm lint`/`typecheck`/`test` verdes.

---
*Phase: 01-monorepo-foundation*
*Completed: 2026-06-13*
