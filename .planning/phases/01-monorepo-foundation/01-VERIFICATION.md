---
phase: 01-monorepo-foundation
verified: 2026-06-13T00:30:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Iniciar apps/web en dev con NEXT_PUBLIC_APP_ENV=development y confirmar que la status page se renderiza en es-AR voseo con el entorno visible"
    expected: "La página muestra 'ImBau · Web', 'Entorno: development', y el componente AppStatus de @imbau/ui renderiza 'Estado: en línea'"
    why_human: "El RSC se verifica en runtime de Next, no con un comando estático. Confirma que la arista app → ui rende correctamente en el browser."
  - test: "Iniciar apps/panel en dev en el puerto 3001 con NEXT_PUBLIC_APP_ENV=development y confirmar que corre en :3001 (no en :3000)"
    expected: "La app arranca en http://localhost:3001 con status page 'ImBau · Panel'"
    why_human: "La separación de puertos es un comportamiento de runtime que no se puede verificar sin levantar el servidor."
---

# Phase 1: Monorepo Foundation — Verification Report

**Phase Goal:** El monorepo compila de punta a punta con la config compartida que todo lo demás importa, sobre una rama de milestone limpia.
**Verified:** 2026-06-13T00:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El estado inicial del repo está commiteado y existe la rama `fase-0/foundation` desde donde arranca el desarrollo del milestone | VERIFIED | Commit `b0945d6` en main contiene `.claude/` y `docs/modelo-mvp.md`. La rama `fase-0/foundation` arranca desde ese mismo commit (`git merge-base main fase-0/foundation` == `b0945d629ad08fa8a64b0f1e3404a3e3ea0049be`). HEAD actual es `fase-0/foundation`. |
| 2 | `pnpm install` y un build de Turborepo completan con apps (web, panel, worker) y packages (db, api, quoting, ui, config) esqueleto, con dependencias estrictamente descendentes (apps → api → db/ui → config) | VERIFIED | `pnpm install` (9 workspace projects, 145ms, exit 0). `pnpm build` (`NEXT_PUBLIC_APP_ENV=production`): web y panel buildean con Next standalone output; worker con tsup a `dist/index.js` 679B. 7/7 typecheck, 7/7 lint — turbo orquesta los 7 packages con el orden correcto del task graph. |
| 3 | `pnpm lint` y `pnpm typecheck` corren desde `packages/config` compartido (TypeScript 5.9 estricto sin `any` injustificado, ESLint 9 flat config) y pasan en todo el workspace | VERIFIED | `pnpm lint`: 7 successful, 7 total (sin errores ni warnings). `pnpm typecheck`: 7 successful, 7 total (exit 0). `packages/config/tsconfig/base.json` tiene `"strict": true` + `"noUncheckedIndexedAccess": true`. ESLint flat config con `projectService: true` y `prettier` último. Ningún `any` en código fuente (`grep -rn "\bany\b" packages/ apps/ --include="*.ts" --include="*.tsx"` sin resultados en src, solo en archivos generados de `.next/`). |
| 4 | Arrancar cualquier app con una variable de entorno faltante o inválida falla rápido al boot con un mensaje claro generado por el schema Zod tipado | VERIFIED | `NEXT_PUBLIC_APP_ENV="" pnpm --filter @imbau/web build` falla con: `❌ Invalid environment variables: [{code: 'invalid_value', path: ['NEXT_PUBLIC_APP_ENV'], message: 'Invalid option: expected one of "development"|"staging"|"production"'}]` seguido de `Error: Invalid environment variables` (exit 1). Misma costura verificada para el worker via `apps/worker/src/env.test.ts` (2/2 tests: DATABASE_URL inválido + REDIS_URL faltante surfacean ambos nombres). `pnpm test` 4/4 suites pasan (quoting 2, web 2, worker 2, panel 0 con --passWithNoTests). |

**Score:** 4/4 truths verified

---

### Deferred Items

No hay items diferidos. Los warnings del code review que refieren a fases posteriores se documentan en la sección de Anti-Patterns.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | Root workspace manifest con packageManager pin y scripts → turbo | VERIFIED | `"packageManager": "pnpm@11.6.0"`, `"engines": {"node": ">=22"}`, 5 scripts turbo + format |
| `pnpm-workspace.yaml` | Declaración de workspaces apps/* + packages/* | VERIFIED | `packages: ["apps/*", "packages/*"]` con `allowBuilds: {esbuild: true, sharp: true}` |
| `turbo.json` | Task graph Turborepo 2.x con key `tasks` (no `pipeline`) | VERIFIED | `"tasks"` con build/typecheck/lint/test/dev. Sin `"pipeline"`. |
| `.nvmrc` | Pin de Node 22 LTS | VERIFIED | Contenido: `22` |
| `.gitignore` | Ignora node_modules, .next, .turbo, dist, .env* / exceptúa .env.example | VERIFIED | Ignora `.env` y `.env.*`; excepción `!.env.example`; next-env.d.ts también ignorado |
| `packages/config/eslint.js` | ESLint 9 flat config (typescript-eslint + prettier last) | VERIFIED | `tseslint.config(...tseslint.configs.recommendedTypeChecked, {projectService: true}, prettier)`. Prettier es el último elemento. |
| `packages/config/tsconfig/base.json` | Preset TS 5.9 estricto | VERIFIED | `"strict": true`, `"noUncheckedIndexedAccess": true`, `"verbatimModuleSyntax": true`, `"module": "ESNext"`, `"moduleResolution": "Bundler"` |
| `packages/config/env/presets.ts` | Presets parciales de env (baseEnv, dbEnv, redisEnv) | VERIFIED | 3 exports `as const` con schemas Zod: `baseEnv` (NODE_ENV enum), `dbEnv` (DATABASE_URL url), `redisEnv` (REDIS_URL url). Ningún valor real. |
| `packages/quoting/src/index.ts` | Función pura `roundUsd` sin I/O | VERIFIED | `export function roundUsd(amount: number): number { return Math.round(amount); }` |
| `packages/ui/src/index.tsx` | Componente React trivial `AppStatus` | VERIFIED | `export function AppStatus({label}: AppStatusProps): React.JSX.Element { return <span>{label}</span>; }` |
| `packages/db/src/index.ts` | Placeholder tipado sin Drizzle | VERIFIED | `export type DbPackage = "@imbau/db"; export const dbPackage: DbPackage = "@imbau/db";` |
| `packages/api/src/index.ts` | Placeholder tipado sin tRPC | VERIFIED | `export type ApiPackage = "@imbau/api"; export const apiPackage: ApiPackage = "@imbau/api";` |
| `apps/web/env.ts` | Validación de env vía @t3-oss/env-nextjs (NODE_ENV + NEXT_PUBLIC_APP_ENV) | VERIFIED | `createEnv` de `@t3-oss/env-nextjs` con `baseEnv.server`, `client: {NEXT_PUBLIC_APP_ENV: z.enum(...)}`, `experimental__runtimeEnv`. Sin REDIS_URL. |
| `apps/worker/src/env.ts` | Validación de env vía @t3-oss/env-core (DATABASE_URL, REDIS_URL, NODE_ENV) | VERIFIED | `createEnv` componiendo `baseEnv.server + redisEnv.server + dbEnv.server`. Sin NEXT_PUBLIC_*. `SKIP_ENV_VALIDATION === "1"`. |
| `apps/web/app/page.tsx` | Página de status es-AR de web | VERIFIED | Importa `AppStatus` de `@imbau/ui` y `env` validado. Renderiza 'ImBau · Web', entorno, confirmación de env. |
| `apps/panel/app/page.tsx` | Página de status es-AR de panel | VERIFIED | Mismo patrón que web. 'ImBau · Panel', entorno, `AppStatus`. |
| `apps/worker/src/index.ts` | Shell deployable (boot + log ok, sin jobs) | VERIFIED | Importa `./env` primero. `console.log(JSON.stringify({msg: "worker boot ok", node_env: env.NODE_ENV}))`. Sin BullMQ. |
| `apps/worker/src/env.test.ts` | Test de error agregado (dos vars inválidas → ambos nombres) | VERIFIED | `createEnv` con `DATABASE_URL: "not-a-url"` y `REDIS_URL` faltante; `onValidationError` captura issues y assertea `DATABASE_URL` y `REDIS_URL` en `failedNames`. 2/2 tests pasan. |
| `apps/web/.env.example` | Placeholder consistente con schema | VERIFIED | `NODE_ENV=development`, `NEXT_PUBLIC_APP_ENV=development`. Sin REDIS_URL. Versionado en git. |
| `apps/panel/.env.example` | Placeholder consistente con schema | VERIFIED | `NODE_ENV=development`, `NEXT_PUBLIC_APP_ENV=development`. Sin REDIS_URL. |
| `apps/worker/.env.example` | Placeholder consistente con schema | VERIFIED | `DATABASE_URL=postgres://...`, `REDIS_URL=redis://...`, `NODE_ENV=development`. |
| `eslint.config.js` (root) | Re-exporta config de @imbau/config/eslint | VERIFIED | `import { config } from "@imbau/config/eslint"; export default config;` |
| `prettier.config.js` (root) | Re-exporta config de @imbau/config/prettier | VERIFIED | `export { config as default } from "@imbau/config/prettier";` |
| `vitest.config.ts` (root) | Coverage v8, descubrimiento por package | VERIFIED | Provider `v8`, sin umbral (QUOT-01 en fase 3). Sin include root-anclado. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `package.json` scripts | `turbo` | `turbo run <task>` | WIRED | 5 scripts usan `turbo run`: dev, build, lint, typecheck, test |
| `pnpm-workspace.yaml` | `apps/*, packages/*` | workspace globs | WIRED | Globs `"apps/*"` y `"packages/*"` presentes |
| `packages/{db,api,ui,quoting}/package.json` | `@imbau/config` | `workspace:*` devDependency | WIRED | Los 4 packages lo tienen como devDependency (también como dependency en ui y apps) |
| `eslint.config.js` (root) | `@imbau/config/eslint` | import del array compartido | WIRED | `import { config } from "@imbau/config/eslint"` |
| `apps/web/env.ts`, `apps/panel/env.ts` | `@imbau/config/env/presets` | import + composición de presets | WIRED | `import { baseEnv } from "@imbau/config/env/presets"` en ambas |
| `apps/worker/src/env.ts` | `@imbau/config/env/presets` | import + composición de presets | WIRED | `import { baseEnv, dbEnv, redisEnv } from "@imbau/config/env/presets"` |
| `apps/worker/src/index.ts` | `./env` | import env primero | WIRED | Primera línea de código: `import { env } from "./env";` |
| `apps/web/next.config.ts`, `apps/panel/next.config.ts` | `transpilePackages: [@imbau/ui, @imbau/config]` | consumo JIT de packages workspace | WIRED | `transpilePackages: ["@imbau/ui", "@imbau/config"]` + `output: "standalone"` |

---

### Data-Flow Trace (Level 4)

No aplica en esta fase: los artefactos que renderizan datos usan el objeto `env` validado (que proviene de `createEnv`/`process.env` en boot), no una DB. La cadena de datos es: `process.env` → `createEnv` (Zod) → `env` validado → `page.tsx` como Server Component. Esta cadena está verificada en Level 3 (wired) y demostrada por los tests de env agregado.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `pnpm install` completa sin error | `pnpm install` | "Already up to date / Done in 145ms" (exit 0) | PASS |
| `pnpm test` pasa en todo el workspace | `pnpm test` | 4 successful, 4 total (quoting 2, web 2, worker 2, panel 0+passWithNoTests) | PASS |
| `pnpm typecheck` pasa en todo el workspace | `pnpm typecheck` | 7 successful, 7 total (exit 0) | PASS |
| `pnpm lint` pasa en todo el workspace | `pnpm lint` | 7 successful, 7 total (exit 0) | PASS |
| Build sin `NEXT_PUBLIC_APP_ENV` falla con mensaje Zod | `NEXT_PUBLIC_APP_ENV="" pnpm --filter @imbau/web build` | Exit 1, mensaje con path y code `invalid_value` | PASS |
| Build con env válida produce salida standalone | `NEXT_PUBLIC_APP_ENV=production pnpm --filter @imbau/web build` | Exit 0, salida `.next/standalone` | PASS |
| Worker tsup bundle produce salida | `pnpm --filter @imbau/worker build` | `dist/index.js 679B`, exit 0 | PASS |
| `turbo.json` usa `tasks` y no `pipeline` | `grep "tasks" turbo.json && ! grep "pipeline" turbo.json` | PASS | PASS |

---

### Probe Execution

No hay probes en esta fase (no se declaran probes en los PLANs). Skipped.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROC-01 | 01-01-PLAN.md | Commitear estado inicial + crear rama `fase-0/foundation` | SATISFIED | Commit `b0945d6` en main con `.claude/` y `docs/`. Rama `fase-0/foundation` arranca desde ese commit. HEAD actual en la rama correcta. |
| MONO-01 | 01-01-PLAN.md, 01-02-PLAN.md, 01-03-PLAN.md | Monorepo compila con apps + packages esqueleto, deps descendentes | SATISFIED | `pnpm build` (3 apps, 7 typecheck, 7 lint). DAG: apps → @imbau/ui + @imbau/config; packages dependen solo de @imbau/config. Ningún package leaf tiene dep ascendente. |
| MONO-02 | 01-02-PLAN.md | TS 5.9 estricto + ESLint 9 flat config desde packages/config | SATISFIED | `pnpm typecheck` y `pnpm lint` verdes en los 7 packages. Base tsconfig con `strict` + `noUncheckedIndexedAccess`. ESLint 9 flat config con `projectService: true`. Sin `any` en código fuente. |
| MONO-03 | 01-03-PLAN.md | Env Zod tipado que falla rápido al boot | SATISFIED | Demostrado por smoke test real: `NEXT_PUBLIC_APP_ENV="" pnpm build` → exit 1 con mensaje de variable específica. Tests de env agregado: worker (2 vars fallidas → ambos nombres), web (NEXT_PUBLIC_APP_ENV inválido → nombre aparece). |

**Cobertura:** 4/4 requirements satisfechos (PROC-01, MONO-01, MONO-02, MONO-03). Los demás requirements de REQUIREMENTS.md (DATA-*, AUTH-*, APP-*, INFRA-*, CI-*, OBS-*) pertenecen a las fases 2-4 y están correctamente fuera del alcance de esta fase.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/worker/src/index.ts` | 6 | `console.log(JSON.stringify(...))` en lugar de pino | WARNING (WR-01) | El worker usa logging manual en lugar de la librería pino pinneada en CLAUDE.md como requisito de observabilidad de fase 0. Identificado en el code review (WR-01). Pino con JSON logs → Loki es requisito OBS-02, que pertenece a Phase 4. La ausencia de pino en fase 1 no bloquea la compilación ni los tests, pero el patrón que establecen las fases posteriores se copiará de este entrypoint. |
| `packages/quoting/src/index.ts` | 10 | `Math.round(amount)` con asimetría en negativos | WARNING (WR-02) | Para inputs negativos (`-2.5`), `Math.round` devuelve `-2` en lugar de `-3` (redondeo asimétrico). Los dos tests solo cubren los paths `1234.6` y `1234.4` — el boundary `.5` y negativos no están cubiertos. CLAUDE.md advierte que un error de cálculo en quoting "mata el producto". Identificado en code review (WR-02 + IN-03). Mitigado parcialmente: la cobertura 100% + property-based tests de QUOT-01 llegan en fase 3. |
| `apps/web/env.test.ts` | 9-10 | Comentario afirma que un test en web "gatea" el env de panel | WARNING (WR-03) | El comentario dice "panel reusa este patrón exacto, así que un test en web gatea ambos". Pero `apps/panel/env.ts` es un archivo separado que el test de web nunca importa. Si panel diverge, ningún test falla. Identificado en code review (WR-03). No bloquea el objetivo de la fase: la SC-4 está demostrada para web y worker; panel tiene la misma estructura y compila. |
| `apps/worker/src/env.ts` | 21 | `SKIP_ENV_VALIDATION === "1"` vs env-nextjs truthy check | WARNING (WR-04) | Inconsistencia de semántica con web/panel: si se usa `SKIP_ENV_VALIDATION=true` en Docker, las Next apps saltan validación pero el worker no. Identificado en code review (WR-04). No bloquea fase 1 (los Dockerfiles son fase 3); sí introduce una trampa futura. |
| `apps/worker/src/env.test.ts` | 28-34 | Dead `else if` branch inalcanzable | INFO (IN-01) | El branch `typeof name === "object" && "key" in name` nunca se ejecuta (t3-env paths son `(string|number)[]`). Código defensivo para una forma que no ocurre. |

**Marcadores de deuda (TBD/FIXME/XXX):** Ninguno encontrado en el código fuente. No hay BLOCKERs por marcadores sin referencia.

---

### Human Verification Required

#### 1. Status page web — renderizado en browser

**Test:** Ejecutar `NEXT_PUBLIC_APP_ENV=development pnpm --filter @imbau/web dev` y abrir `http://localhost:3000` en el browser.
**Expected:** La página muestra el texto en es-AR voseo: "ImBau · Web", "Estado: en línea" (desde `AppStatus` de `@imbau/ui`), "Entorno: development", "El entorno se validó correctamente al iniciar."
**Why human:** El Server Component de Next requiere runtime real para renderizar. Confirma que la arista app → @imbau/ui funciona en el browser y que el idioma es-AR se aplica desde el primer día.

#### 2. Panel en puerto 3001

**Test:** Ejecutar `NEXT_PUBLIC_APP_ENV=development pnpm --filter @imbau/panel dev` y confirmar que el servidor arranca en `http://localhost:3001` (no en :3000).
**Expected:** Terminal muestra "Local: http://localhost:3001"; la página muestra "ImBau · Panel".
**Why human:** La separación de puertos es un comportamiento de runtime. No verificable con comandos estáticos.

---

### Gaps Summary

No hay gaps que bloqueen el objetivo de la fase. Los 4 success criteria están verificados con evidencia directa del codebase y smoke tests de comportamiento real. Los warnings del code review (WR-01 a WR-04) son deudas técnicas reales que deben cerrar en las fases correspondientes, pero no impiden que la fundación del monorepo esté correctamente establecida.

**Warnings no bloqueantes para seguimiento:**
- **WR-01** (pino): Debe resolverse antes o durante Phase 4 (OBS-02) cuando se cable Loki. El patrón `console.log` no bloquea la compilación pero es el único runtime logueable de la fase y sentará precedente.
- **WR-02 + IN-03** (roundUsd asimetría): Debe resolverse con QUOT-01 en Phase 3 (cobertura 100% + property-based tests). No bloquea la fundación; el motor de cotización es Phase 3.
- **WR-03** (test de panel): Debe añadirse `apps/panel/env.test.ts` o extraer schema compartido antes de que panel sea funcional (Phase 3).
- **WR-04** (SKIP_ENV_VALIDATION): Debe estandarizarse antes de escribir los Dockerfiles en Phase 3.

---

_Verified: 2026-06-13T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
