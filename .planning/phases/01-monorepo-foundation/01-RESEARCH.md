# Phase 1: Monorepo Foundation - Research

**Researched:** 2026-06-12
**Domain:** pnpm + Turborepo monorepo scaffolding, shared TS/ESLint/Prettier config, JIT internal packages, type-safe env validation (Zod via @t3-oss/env), greenfield branch workflow
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Validación de env (Zod) — MONO-03**
- **D-01:** Usar `@t3-oss/env-nextjs` para las apps Next y `@t3-oss/env-core` para el worker. No escribir helper propio.
- **D-02:** Schemas por app: cada app define su propio `env.ts` componiendo presets parciales compartidos exportados desde `packages/config` (ej: `dbEnv`, `redisEnv`). Cada app declara exactamente las variables que usa — web no valida `REDIS_URL`, worker no valida `NEXT_PUBLIC_*`.
- **D-03:** Validación en build + boot: el env se valida al importarse (falla en `next build` y al boot del worker). `SKIP_ENV_VALIDATION=1` permitido únicamente para el build de imagen Docker (fase 3); al boot del contenedor valida siempre.
- **D-04:** Errores agregados: el mensaje de fallo lista TODAS las variables faltantes/inválidas de una sola vez, con nombre y motivo. Se versiona un `.env.example` por app como documentación viva, consistente con el schema.

**Estrategia de build de packages**
- **D-05:** Packages internos just-in-time (JIT): los `exports` de `package.json` apuntan a `src/*.ts` crudo, sin paso de build interno ni `dist/`. Next consume vía `transpilePackages`; Vitest transpila solo.
- **D-06:** Worker: `tsx watch` en dev, `tsup` para build de producción (bundlea los workspace packages en un solo output, listo para la imagen Docker de fase 3).
- **D-07:** Type-check con `tsc --noEmit` por package/app como task `typecheck` orquestada por Turbo con cache. Sin project references de TypeScript.
- **D-08:** `pnpm dev` = `turbo dev`: levanta web, panel y worker en paralelo con output agrupado. Puertos fijos: web 3000, panel 3001. Enfoque por app con `--filter`.

**Profundidad del esqueleto**
- **D-09:** web y panel muestran una página de status mínima en es-AR: nombre de la app, entorno actual y check de que el env validó. Sirve como smoke test visual en deploys futuros. Sin layout/branding todavía (el design system no existe).
- **D-10:** Vitest se cablea en fase 1 con tests reales del esqueleto: schemas de env (una var inválida falla con mensaje agregado) y la función placeholder de quoting. `pnpm test` pasa desde el día uno — CI (fase 4) lo necesita verde.
- **D-11:** Prettier como formatter, config compartida en `packages/config`, integrado con ESLint 9 vía `eslint-config-prettier`.
- **D-12:** Cada package esqueleto exporta algo pequeño pero genuino que prueba la cadena de deps: `ui` un componente trivial usado por las apps, `quoting` una función pura con test, `db`/`api` solo tipos/placeholder tipado. Nada de código especulativo de fases 2-3.

**Flujo de ramas (PROC-01)**
- **D-13:** Merge a main por fase GSD: cada fase (1-4) se trabaja en su rama y se mergea a main al verificarse.
- **D-14:** Los commits de planning GSD (.planning/, planes, summaries) viajan junto con el código en la rama de fase y llegan a main con el merge. Los artefactos previos al branch (este CONTEXT.md) quedan en main.
- **D-15:** PR en GitHub por fase + merge commit (`--no-ff`), aunque sea solo dev.
- **D-16:** Una rama por fase GSD siguiendo `fase-N/descripcion`: `fase-0/foundation` para esta fase (cumple PROC-01 literal).

### Claude's Discretion
- Estructura interna de `turbo.json` (task graph, inputs/outputs de cache) — patrón estándar Turborepo 2.x con key `tasks`.
- Naming npm de los packages (ej: scope `@imbau/*`) y estructura interna de carpetas.
- Detalles de configuración de ESLint flat config, tsconfig presets y Vitest workspace.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-01 | Antes de comenzar el desarrollo, se commitea el estado actual del repo y se crea la rama `fase-0/foundation` para el milestone v1 | "Branch Workflow" pattern + Common Pitfall #5 (untracked `.claude/` and `docs/` must be committed first). Branch name `fase-0/foundation` is fixed by D-16 (overrides config.json `phase_branch_template`). |
| MONO-01 | Monorepo pnpm + Turborepo compila con apps (`web`,`panel`,`worker`) y packages (`db`,`api`,`quoting`,`ui`,`config`) esqueleto, deps estrictamente descendentes (apps → api → db/ui → config) | "Standard Stack" + "Recommended Project Structure" + "Pattern 1: pnpm workspace + Turborepo task graph" + "Dependency direction" responsibility map |
| MONO-02 | TS 5.9 estricto (sin `any` injustificado) + ESLint 9 flat config corren desde `packages/config` compartido en todo el workspace | "Pattern 2: Shared config package" + "Pattern 3: ESLint 9 flat config" + Pitfall #2 (flat config + typescript-eslint) |
| MONO-03 | Env vars validadas con schema Zod tipado al boot; faltante o inválida falla rápido con mensaje claro | "Pattern 4: @t3-oss/env per-app + shared presets" + Code Examples (env.ts) + Pitfall #3 (server vars in client) + Pitfall #4 (aggregated errors) |
</phase_requirements>

## Summary

This is a greenfield monorepo scaffolding phase. The repo today contains only `CLAUDE.md`, `docs/`, `.planning/` and `.claude/` (the last two untracked). The phase creates the entire pnpm + Turborepo structure from scratch: 3 apps (`web`, `panel`, `worker`) and 5 packages (`config`, `db`, `api`, `ui`, `quoting`) as genuine-but-minimal skeletons with strictly descending dependencies, a shared config package driving TypeScript 5.9 strict + ESLint 9 flat config + Prettier, and type-safe env validation via `@t3-oss/env-*` that fails fast at boot with aggregated errors.

The CLAUDE.md "Technology Stack" section already contains version-verified, source-cited research from 2026-06-12 — treat it as the authoritative stack matrix. This RESEARCH.md does NOT re-litigate those choices; it (1) verifies the four CONTEXT-introduced packages not in CLAUDE.md (`@t3-oss/env-nextjs`, `@t3-oss/env-core`, `tsx`, `tsup`, plus `prettier`/`eslint-config-prettier`), (2) supplies the concrete wiring patterns the planner needs, and (3) flags the local-environment gaps (Node 20 vs required 22 LTS) that affect execution.

**Primary recommendation:** Build the JIT (no-build) internal-package monorepo exactly as D-05 specifies — `exports` pointing at raw `src/*.ts`, Next apps consume via `transpilePackages`, the worker bundles via `tsup` for prod and runs `tsx watch` in dev. Drive ALL lint/typecheck/format from `packages/config`. Validate env per-app with `@t3-oss/env` composing shared partial presets from `packages/config`. Commit untracked state, then branch `fase-0/foundation` before any scaffolding work.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared TS/ESLint/Prettier config | `packages/config` (build tooling) | — | Single source of truth; every app/package extends it (MONO-02). |
| Env schema definition (partial presets) | `packages/config` | consuming app | Presets (`dbEnv`, `redisEnv`) live in config; each app composes only what it uses (D-02). |
| Env validation execution | Each app's `env.ts` | — | Validation runs where the app boots; web validates `NEXT_PUBLIC_*`, worker validates `REDIS_URL`/`DATABASE_URL` (D-02). |
| Task orchestration + caching | Turborepo root (`turbo.json`) | per-package `package.json` scripts | Turbo owns the graph; packages own their script implementations (D-07, D-08). |
| Package build (prod) | `apps/worker` via `tsup`; Next apps via `next build` | — | Internal packages are JIT/no-build; only deployable apps produce artifacts (D-05, D-06). |
| Status UI smoke test | `apps/web`, `apps/panel` (frontend) | `packages/ui` (shared component) | Status page is per-app; the trivial shared component proves the `app → ui` dep edge (D-09, D-12). |
| Pure business placeholder | `packages/quoting` | — | Pure function + test proves the test harness and a leaf package (D-10, D-12). |
| Branch / commit hygiene | git / process (PROC-01) | — | Not a code tier; a process gate that must run before scaffolding (D-13–D-16). |

## Standard Stack

The authoritative version matrix is **CLAUDE.md → "Technology Stack"** (verified 2026-06-12). The table below covers only what Phase 1 actually installs/uses, plus the CONTEXT-introduced packages that are NOT in CLAUDE.md.

### Core (from CLAUDE.md, re-confirmed applicable to phase 1)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | `11.6.0` | Workspaces + package manager | Pin via `packageManager` field + Corepack so CI/local match. `[CITED: CLAUDE.md]` |
| Turborepo | `2.9.18` | Task graph + caching | `turbo.json` with `tasks` key (not legacy `pipeline`). `[CITED: CLAUDE.md]` |
| TypeScript | `5.9.x` | Strict typing | Pin 5.9 — do NOT float to TS 6.x (out of scope per REQUIREMENTS.md). `[CITED: CLAUDE.md]` |
| Node.js | `22 LTS` | Runtime (CI + Docker) | Pin in `.nvmrc` + `engines`. **Local machine runs Node 20.19.6 — see Environment Availability.** `[VERIFIED: node --version]` |
| Next.js | `16.2.x` | `apps/web`, `apps/panel` | App Router; `output: 'standalone'` for fase-3 Docker. Requires React 19. `[CITED: CLAUDE.md]` |
| React | `19.2.x` | UI runtime | Matches Next 16. `[CITED: CLAUDE.md]` |
| Zod | `4.4.x` | Env validation schemas (phase 1 use) | Peer of `@t3-oss/env`. `[CITED: CLAUDE.md]` |
| ESLint | `9.x` (flat config) | Lint gate | Pin ESLint 9 — ESLint 10 out of scope. `[CITED: CLAUDE.md + REQUIREMENTS.md]` |
| Vitest | `4.1.8` | Unit tests | Runner + coverage gate wired in phase 1 (D-10). `[CITED: CLAUDE.md]` |

### Supporting (CONTEXT-introduced — verified this session on npm)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@t3-oss/env-nextjs` | `0.13.11` | Type-safe env for `apps/web`, `apps/panel` | D-01. Wraps `createEnv` with Next client/server split + `experimental__runtimeEnv`. `[VERIFIED: npm registry]` |
| `@t3-oss/env-core` | `0.13.11` | Type-safe env for `apps/worker` | D-01. Framework-agnostic `createEnv`. `[VERIFIED: npm registry]` |
| `tsx` | `4.22.4` | `tsx watch` dev runner for worker | D-06. No build step in dev. `[VERIFIED: npm registry]` |
| `tsup` | `8.5.1` | Prod bundle of worker (bundles workspace packages) | D-06. Single output ready for fase-3 Docker image. `[VERIFIED: npm registry]` |
| `prettier` | `3.8.4` | Formatter | D-11. Config shared from `packages/config`. `[VERIFIED: npm registry]` |
| `eslint-config-prettier` | `10.1.8` | Disable ESLint rules conflicting with Prettier | D-11. Last in the flat-config array. `[VERIFIED: npm registry]` |
| `@vitest/coverage-v8` | `4.1.8` | Coverage provider for Vitest | D-10 coverage gate. Matches Vitest 4.1.8. `[VERIFIED: npm registry]` |
| `typescript-eslint` | latest 8.x (verify supports ESLint 9 + TS 5.9) | Typed lint in flat config | The unified `typescript-eslint` package exposes `config()` helper for flat config. `[ASSUMED]` |

> **Note on `0.13.x` for `@t3-oss/env`:** The package has been stable at the `0.13.x` line; `0.x` here is the project's chosen versioning, not pre-release instability (1.5M+/2M+ weekly downloads). Treat as production-ready. `[VERIFIED: npm registry — weeklyDownloads 1.49M / 2.09M]`

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JIT raw-`src` packages (D-05) | Per-package `tsup` build with `dist/` | JIT is simpler, no stale-build class of bugs, faster iteration. `dist/` builds only needed if a non-transpiling consumer existed — none do in phase 1. Decision is LOCKED. |
| `@t3-oss/env` (D-01) | Hand-rolled `zod.parse(process.env)` | t3-env solves the client/server leak guard, aggregated errors, and `SKIP_ENV_VALIDATION` for free. Decision is LOCKED. |
| `tsup` for worker prod (D-06) | `tsc` emit + run from `dist` | `tsup` bundles workspace packages into one file (no `node_modules` resolution of internal `src` at runtime), which the fase-3 Docker image needs. Decision is LOCKED. |
| Turbo task `typecheck` (D-07) | TS project references (`composite`) | Project refs add config overhead + ordering constraints; Turbo cache on `tsc --noEmit` is simpler and the chosen path. Decision is LOCKED. |

**Installation (indicative — planner places per-package):**
```bash
# root (Corepack pins pnpm — do not `npm i -g pnpm`)
corepack enable
corepack prepare pnpm@11.6.0 --activate

# root devDeps
pnpm add -Dw turbo@2.9.18 typescript@5.9 prettier@3.8 eslint@9 typescript-eslint eslint-config-prettier vitest@4.1.8 @vitest/coverage-v8@4.1.8

# apps/web, apps/panel
pnpm --filter web add @t3-oss/env-nextjs zod@4
# apps/worker
pnpm --filter worker add @t3-oss/env-core zod@4
pnpm --filter worker add -D tsx@4 tsup@8
```

**Version verification (run before locking the plan):**
```bash
npm view @t3-oss/env-nextjs version   # expect 0.13.11
npm view @t3-oss/env-core version     # expect 0.13.11
npm view tsx version                  # expect 4.22.x
npm view tsup version                 # expect 8.5.x
npm view typescript-eslint version    # confirm 8.x supports ESLint 9 + TS 5.9
```

## Package Legitimacy Audit

> Run 2026-06-12 via `gsd-tools query package-legitimacy check --ecosystem npm`.

| Package | Registry | Age (last publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|--------------------|-----------|-------------|---------|-------------|
| `@t3-oss/env-nextjs` | npm | 2026-03-22 | 1.49M/wk | github.com/t3-oss/t3-env | OK | Approved |
| `@t3-oss/env-core` | npm | 2026-03-22 | 2.09M/wk | github.com/t3-oss/t3-env | OK | Approved |
| `tsx` | npm | 2026-05-31 | 56.4M/wk | github.com/privatenumber/tsx | OK* | Approved (see note) |
| `tsup` | npm | 2025-11-12 | 5.56M/wk | github.com/egoist/tsup | OK | Approved |
| `prettier` | npm | 2026-06-09 | 113M/wk | github.com/prettier/prettier | OK* | Approved (see note) |
| `eslint-config-prettier` | npm | 2025-07-18 | 59.1M/wk | github.com/prettier/eslint-config-prettier | OK | Approved |
| `@vitest/coverage-v8` | npm | — | (Vitest org) | github.com/vitest-dev/vitest | OK | Approved |

\* `tsx` and `prettier` were auto-flagged `SUS` solely on a `too-new` heuristic (a routine version published within the freshness window). Both are long-established, ubiquitous packages (56M and 113M weekly downloads, canonical repos). The `too-new` signal is a **false positive** here — no checkpoint needed. None has a `postinstall` script.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS] requiring human checkpoint:** none (the two `too-new` hits are explained false positives)

> `typescript-eslint` exact version is `[ASSUMED]` (not yet pinned); planner should `npm view` it during planning to confirm an 8.x release supporting ESLint 9 + TS 5.9. Not a legitimacy concern — it is the canonical typed-lint package (github.com/typescript-eslint/typescript-eslint).

## Architecture Patterns

### System Architecture Diagram

```
                         pnpm workspace root
                  (package.json: packageManager=pnpm@11.6.0,
                   pnpm-workspace.yaml, turbo.json [tasks key],
                   .nvmrc=22, root tsconfig.base, eslint root)
                                  │
            ┌─────────────────────┴──────────────────────┐
            │   turbo run <task> --filter ...             │
            │   (dev | build | lint | typecheck | test)   │
            └─────────────────────┬──────────────────────┘
                                  │ dependency direction (strictly descending)
   apps  ───────────────────────▼──────────────────────────────────
   ┌──────────┐  ┌──────────┐  ┌──────────────┐
   │ web      │  │ panel    │  │ worker       │
   │ (Next16) │  │ (Next16) │  │ (tsx/tsup)   │
   │ env.ts ──┼──┼─ env.ts ─┼──┼─ env.ts      │   each env.ts = createEnv(
   │ status   │  │ status   │  │ shell        │     ...shared presets from config)
   │ page es-AR  │ page es-AR  │ (no jobs)    │   fail-fast at import → boot
   └────┬─────┘  └────┬─────┘  └──────┬───────┘
        │ transpilePackages           │ tsup bundles workspace pkgs
        ▼                             ▼
   packages/api ──────────────────────────────────  (typed placeholder)
        │
        ▼
   ┌──────────────┐        ┌──────────────┐
   │ packages/db  │        │ packages/ui  │  (trivial component used by apps)
   │ (typed       │        └──────┬───────┘
   │  placeholder)│               │
   └──────┬───────┘               │
          │            packages/quoting (pure fn + test)
          ▼                       │
   ┌───────────────────────────────────────────────┐
   │ packages/config  ← root of the dep DAG          │
   │ tsconfig presets, eslint flat config,           │
   │ prettier config, env partial presets            │
   │ (dbEnv, redisEnv, baseEnv)                       │
   └───────────────────────────────────────────────┘

   Boot/build flow:  app starts → imports ./env.ts → createEnv parses
   process.env against composed Zod presets → on any miss/invalid,
   aggregated error lists every failing var → process exits non-zero.
   SKIP_ENV_VALIDATION=1 only honored during Docker image build (fase 3).
```

### Recommended Project Structure
```
imbau/                          # repo root (greenfield)
├── package.json                # "packageManager":"pnpm@11.6.0", root scripts → turbo
├── pnpm-workspace.yaml         # packages: apps/*, packages/*
├── turbo.json                  # tasks: dev, build, lint, typecheck, test
├── .nvmrc                      # 22
├── tsconfig.base.json          # OR live in packages/config (discretion D)
├── .gitignore                  # node_modules, .next, .turbo, dist, .env*
├── apps/
│   ├── web/      # Next16, env.ts, app/page.tsx (status es-AR), .env.example
│   ├── panel/    # Next16, env.ts, app/page.tsx (status es-AR), port 3001
│   └── worker/   # tsx watch dev / tsup build, env.ts, src/index.ts shell
└── packages/
    ├── config/   # tsconfig presets, eslint.config, prettier config, env presets
    ├── db/       # typed placeholder export (no Drizzle yet — fase 2)
    ├── api/      # typed placeholder export (no tRPC yet — fase 3)
    ├── ui/       # one trivial React component consumed by web+panel
    └── quoting/  # one pure function + Vitest test
```

### Pattern 1: pnpm workspace + Turborepo task graph
**What:** `pnpm-workspace.yaml` declares `apps/*` + `packages/*`; internal deps referenced as `"@imbau/config": "workspace:*"`. `turbo.json` defines tasks with `dependsOn: ["^build"]`/`["^typecheck"]` so the DAG is honored and outputs are cached.
**When to use:** Always — this is the backbone of MONO-01.
**Example:**
```jsonc
// turbo.json — Source: turborepo.dev/docs (tasks key, 2.x)  [CITED: CLAUDE.md]
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint":      {},
    "test":      { "dependsOn": ["^build"] },
    "dev":       { "cache": false, "persistent": true }
  }
}
```
> JIT packages have no `build` output, so `^build` resolves to a no-op for leaf packages — that is fine. The `dependsOn: ["^typecheck"]` edge is what enforces dependency-order typechecking without TS project references (D-07).

### Pattern 2: Shared config package (`packages/config`) — MONO-02
**What:** `packages/config` exports tsconfig presets (`base.json`, `next.json`, `node.json`), an ESLint flat-config array, a Prettier config object, and the env partial presets. Every app/package `extends` the tsconfig and re-exports the eslint config.
**When to use:** Always — single source of truth (MONO-02, D-11).
**Example:**
```jsonc
// apps/web/tsconfig.json
{ "extends": "@imbau/config/tsconfig/next.json",
  "compilerOptions": { "outDir": ".next" },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"] }
```
```jsonc
// packages/config/tsconfig/base.json  (strict everything)
{ "compilerOptions": {
    "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022",
    "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true } }
```

### Pattern 3: ESLint 9 flat config from shared package
**What:** Root `eslint.config.js` imports the shared array from `@imbau/config` and ends with `eslint-config-prettier`.
**When to use:** Always (MONO-02, D-11).
**Example:**
```js
// eslint.config.js (root) — Source: typescript-eslint flat config docs  [ASSUMED version]
import { config } from "@imbau/config/eslint";
export default config;

// packages/config/eslint.js (shape)
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export const config = tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,   // requires parserOptions.projectService
  { languageOptions: { parserOptions: { projectService: true } } },
  prettier  // MUST be last — turns off stylistic rules Prettier owns
);
```

### Pattern 4: `@t3-oss/env` per-app with shared presets — MONO-03
**What:** `packages/config` exports partial Zod preset objects; each app's `env.ts` composes the presets it needs via `extends`/spread, calling `createEnv`. Import `./env.ts` at the top of the app's entry so validation runs at boot/build.
**When to use:** Every app (D-01, D-02, D-03, D-04). See Code Examples for full code.

### Anti-Patterns to Avoid
- **`pipeline` key in `turbo.json`:** removed in Turborepo 2.x → use `tasks`. `[CITED: CLAUDE.md]`
- **Installing pnpm globally via npm:** breaks version pinning → use Corepack (`corepack prepare pnpm@11.6.0`). `[CITED: CLAUDE.md]`
- **Reading `process.env.FOO` directly in app code:** defeats type-safety and the leak guard → always read from the validated `env` object. `[CITED: t3-env docs]`
- **Putting a server-only secret in the `client` block (or referencing it in a `NEXT_PUBLIC_` var):** t3-env throws, but the anti-pattern is naming a secret with the public prefix. `[CITED: t3-env docs]`
- **Building internal packages to `dist/` then importing `dist`:** contradicts D-05 (JIT). Point `exports` at raw `src/*.ts`. 
- **`SKIP_ENV_VALIDATION` anywhere except the Docker build stage:** boot-time validation is the whole point of MONO-03 (D-03).
- **TS project references / `composite`:** explicitly not used (D-07).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Env validation + client/server split + fail-fast | Custom `zod.parse(process.env)` wrapper | `@t3-oss/env-nextjs` / `-core` | Solves client-leak guard, aggregated errors, `SKIP_ENV_VALIDATION`, and runtimeEnv wiring for free (D-01). |
| Monorepo task ordering + caching | Shell scripts / `npm run` fan-out | Turborepo `tasks` graph | Topological ordering, content-hash cache, `--filter` for free. |
| pnpm version consistency CI↔local | README "please use pnpm 11" note | Corepack + `packageManager` field | Enforced, not documented. |
| Worker prod bundling | Manual `tsc` + path rewrites | `tsup` (D-06) | Bundles workspace `src` packages into one file for the Docker image. |
| Prettier ↔ ESLint conflicts | Manually disabling rules | `eslint-config-prettier` (D-11) | Maintained list of conflicting rules; just append last. |

**Key insight:** Every "Don't Build" here is a LOCKED decision in CONTEXT.md — the planner must not generate a custom alternative for any of them.

## Runtime State Inventory

> This is a greenfield scaffolding phase, NOT a rename/refactor. There is no pre-existing runtime state, stored data, live service config, OS registration, or build artifact. The only "existing state" is untracked files in git (`.claude/`, `docs/`) which PROC-01 explicitly handles by committing before branching.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB exists yet (fase 2) | None |
| Live service config | None — no deployed services yet (fase 4) | None |
| OS-registered state | None — verified, greenfield repo | None |
| Secrets/env vars | None stored yet; `.env.example` files are *created* this phase as docs (D-04) | Create per-app `.env.example` |
| Build artifacts | None — no prior build; `node_modules`, `.next`, `.turbo`, `dist` must be gitignored from the start | Add `.gitignore` |

## Common Pitfalls

### Pitfall 1: Node version mismatch (local 20 vs required 22 LTS)
**What goes wrong:** Next 16 requires Node `>=20.9` so it *runs* on local Node 20.19.6, but CI/Docker pin Node 22 LTS — subtle behavior or engine-warning drift, and `engines` may warn/block.
**Why it happens:** Local machine has Node 20.19.6 (verified this session); project standard is 22 LTS.
**How to avoid:** Add `.nvmrc` = `22` and `"engines": { "node": ">=22" }`. Planner should include a task/step to `nvm install 22 && nvm use` (or note it as an execution prerequisite). Decide whether `engines` is `warn` or `error` for phase 1 dev.
**Warning signs:** `Unsupported engine` warnings on `pnpm install`; CI green but local subtly different.

### Pitfall 2: ESLint 9 flat config + typescript-eslint type-checked rules need a parser project
**What goes wrong:** `recommendedTypeChecked` rules silently no-op or throw `parserOptions.project` errors across a monorepo.
**Why it happens:** Type-aware linting needs each file mapped to a tsconfig; in a monorepo this is fiddly.
**How to avoid:** Use `parserOptions: { projectService: true }` (the modern, monorepo-friendly replacement for per-package `project` arrays). Verify the pinned `typescript-eslint` 8.x supports `projectService` with ESLint 9 + TS 5.9.
**Warning signs:** Lint passes but type-aware rules never fire; or "file not found in any project" errors.

### Pitfall 3: Server env var leaking into the client bundle
**What goes wrong:** A non-`NEXT_PUBLIC_` secret referenced in client code → either build error (good) or accidental exposure.
**Why it happens:** Misplacing a var in t3-env's `server` vs `client` block, or reading `process.env` directly in a Client Component.
**How to avoid:** Define `client` vars with the `NEXT_PUBLIC_` prefix only; never read `process.env` directly — read the typed `env`. t3-env enforces the split at build (D-02 already says web won't even declare `REDIS_URL`).
**Warning signs:** t3-env throws "Attempted to access a server-side environment variable on the client".

### Pitfall 4: Non-aggregated / unclear env errors
**What goes wrong:** First missing var throws, user fixes it, next missing var throws — death by a thousand restarts. Violates D-04.
**Why it happens:** Default `.parse` short-circuits; or a custom `onValidationError` that only prints the first issue.
**How to avoid:** t3-env aggregates all Zod issues by default; do NOT override `onValidationError` in a way that prints only the first. Add a Vitest test (D-10) asserting that an env with *two* bad vars surfaces *both* names. Keep `.env.example` in sync with the schema.
**Warning signs:** Error message shows one var when two are wrong; the env test only checks a single failure.

### Pitfall 5: Scaffolding before committing untracked state (PROC-01 violation)
**What goes wrong:** `.claude/` and `docs/` are untracked today; creating the branch/scaffolding first muddies the initial commit and violates PROC-01's literal sequence.
**Why it happens:** Eagerness to start building.
**How to avoid:** First task = commit the current repo state on `main`, THEN create `fase-0/foundation` from it (D-16). Note: the *literal* branch name is `fase-0/foundation`, which **overrides** config.json's `phase_branch_template` (`gsd/phase-{phase}-{slug}`) — D-16 is explicit and wins.
**Warning signs:** First scaffolding commit also contains unrelated `.claude/`/`docs/` adds.

### Pitfall 6: pnpm version drift (local pnpm is 0.34.1 on PATH)
**What goes wrong:** A stray/old `pnpm` (0.34.1 detected on PATH) shadows the Corepack-managed `pnpm@11.6.0`.
**Why it happens:** A globally installed binary takes precedence over Corepack shims.
**How to avoid:** `corepack enable` + set `packageManager: "pnpm@11.6.0"`; verify `pnpm --version` reports 11.6.0 after enabling Corepack. Planner should add a verification step.
**Warning signs:** `pnpm --version` ≠ 11.6.0; lockfile format mismatches.

## Code Examples

### Shared env presets in `packages/config`
```ts
// packages/config/env/presets.ts  — Source: t3-oss/t3-env docs (createEnv)  [CITED: github.com/t3-oss/t3-env]
import { z } from "zod";

export const baseEnv = {
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
} as const;

export const dbEnv = {
  server: { DATABASE_URL: z.string().url() },
} as const;

export const redisEnv = {
  server: { REDIS_URL: z.string().url() },
} as const;
```

### Next app env (web/panel) — `@t3-oss/env-nextjs`
```ts
// apps/web/env.ts  — Source: t3-oss/env-nextjs docs  [CITED: github.com/t3-oss/t3-env]
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { baseEnv } from "@imbau/config/env/presets";

export const env = createEnv({
  ...baseEnv,                       // composes shared server vars
  server: {
    ...baseEnv.server,
    // web declares ONLY what it uses (D-02) — no REDIS_URL here
  },
  client: {
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
  },
  // Next inlines NEXT_PUBLIC_* — must be listed explicitly:
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  },
  // emptyStringAsUndefined: true,  // optional: treat "" as missing
});
```
```tsx
// apps/web/app/page.tsx  — status page (D-09), es-AR voseo
import { env } from "../env";
export default function StatusPage() {
  return (
    <main>
      <h1>ImBau · Web</h1>
      <p>Entorno: {env.NEXT_PUBLIC_APP_ENV}</p>
      <p>El entorno se validó correctamente al iniciar.</p>
    </main>
  );
}
```

### Worker env — `@t3-oss/env-core`
```ts
// apps/worker/src/env.ts  — Source: t3-oss/env-core docs  [CITED: github.com/t3-oss/t3-env]
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { baseEnv, redisEnv, dbEnv } from "@imbau/config/env/presets";

export const env = createEnv({
  server: { ...baseEnv.server, ...redisEnv.server, ...dbEnv.server },
  runtimeEnv: process.env,            // core needs the runtime source
  // SKIP_ENV_VALIDATION honored only during Docker build (fase 3) (D-03):
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});
```
```ts
// apps/worker/src/index.ts — import env first so validation runs at boot
import { env } from "./env";
console.log(JSON.stringify({ msg: "worker boot ok", node_env: env.NODE_ENV }));
// no BullMQ job logic in phase 1 (out of scope)
```

### Vitest test for aggregated env error (D-10, D-04)
```ts
// apps/worker/src/env.test.ts  — Source: t3-env behavior  [CITED]
import { describe, it, expect } from "vitest";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

describe("env validation", () => {
  it("reports every missing/invalid var at once", () => {
    expect(() =>
      createEnv({
        server: { DATABASE_URL: z.string().url(), REDIS_URL: z.string().url() },
        runtimeEnv: { DATABASE_URL: "not-a-url" }, // REDIS_URL missing AND DATABASE_URL invalid
      }),
    ).toThrowError(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
  });
});
```

### Pure placeholder + test in `packages/quoting` (D-10, D-12)
```ts
// packages/quoting/src/index.ts
export function roundUsd(amount: number): number {
  return Math.round(amount); // pure, no I/O — proves the leaf package + test chain
}
// packages/quoting/src/index.test.ts
import { expect, it } from "vitest";
import { roundUsd } from "./index";
it("rounds to integer USD", () => { expect(roundUsd(1234.6)).toBe(1235); });
```

### JIT package `exports` (D-05)
```jsonc
// packages/ui/package.json
{ "name": "@imbau/ui", "type": "module",
  "exports": { ".": "./src/index.tsx" } }   // raw src, no build/dist
// apps consuming it (Next): next.config → transpilePackages: ["@imbau/ui","@imbau/config", ...]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `turbo.json` `pipeline` key | `tasks` key | Turborepo 2.0 | Use `tasks`; `pipeline` removed. `[CITED: CLAUDE.md]` |
| ESLint `.eslintrc` + `extends` | Flat config (`eslint.config.js`) | ESLint 9 default | Phase uses flat config from shared package (MONO-02). `[CITED: REQUIREMENTS.md]` |
| `@typescript-eslint/*` separate parser+plugin | Unified `typescript-eslint` pkg + `config()` helper + `projectService` | typescript-eslint v8 | Simpler flat-config composition; `projectService` replaces manual `project` arrays. `[ASSUMED]` |
| Per-package `tsup`/`tsc` build of internal libs | JIT raw-`src` + `transpilePackages` | — | D-05; less ceremony, no stale builds. |
| Hand-rolled env parsing | `@t3-oss/env` | — | D-01; standard in the T3/Next ecosystem. |

**Deprecated/outdated:**
- `turbo.json` `pipeline` key — replaced by `tasks`.
- ESLint legacy `.eslintrc` — ESLint 9 defaults to flat config.

## Project Constraints (from CLAUDE.md)

- **TypeScript estricto:** `strict: true`, no `any` without a justifying comment. `noUncheckedIndexedAccess: true`.
- **Quality gate:** every change passes lint + type-check + tests before commit (`pnpm test`/`lint`/`typecheck`). CI roja = no merge.
- **`packages/quoting`:** pure functions, no I/O. (Phase 1 only seeds a placeholder; 100% coverage + property-based tests land in fase 3 per QUOT-01 — do NOT over-build now.)
- **Language convention:** code/identifiers/commits in English; UI + docs in Spanish (es-AR, voseo). Status pages (D-09) are es-AR.
- **Commits:** Conventional Commits (`feat:`, `chore:`, ...). Branches: `fase-N/descripcion` (this phase: `fase-0/foundation`).
- **No prototype shortcuts:** professional SaaS standard from day one (no PocketBase-style shortcuts).
- **Stack is decided — do not propose alternatives** unless a real blocker. Pin TS 5.9 + ESLint 9 (TS 6.x / ESLint 10 explicitly out of scope).
- **Money:** integers/decimal, never floats (relevant only to the quoting placeholder signature — keep it integer-friendly).
- **Dates/times:** UTC in DB, render in `America/Argentina/Buenos_Aires` (not exercised this phase).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All apps/build | ✓ (but below target) | 20.19.6 local; **22 LTS required** | `nvm install 22 && nvm use`; Next 16 runs on ≥20.9 but pin 22 |
| Corepack | pnpm pinning | ✓ | bundled w/ Node 20 (`~/.nvm/.../corepack`) | n/a |
| pnpm | Package manager | ⚠ wrong version on PATH | 0.34.1 detected; **11.6.0 required** | `corepack enable && corepack prepare pnpm@11.6.0 --activate` |
| git | PROC-01 branch workflow | ✓ | 2.50.1 | n/a |
| gh CLI | PR creation (D-15) | ? not verified this session | — | Create PR via web UI if `gh` absent |

**Missing/mismatched dependencies with fallback:**
- Node 20.19.6 vs 22 LTS → use `nvm` to install/select 22 (add `.nvmrc`). Functional fallback exists (Next runs on ≥20.9) but pin 22 for CI/Docker parity.
- pnpm 0.34.1 on PATH vs 11.6.0 → Corepack activation overrides it. **Planner must include a Corepack-activation + `pnpm --version` verification step.**

**Missing dependencies with no fallback:** none — git present, Corepack present.

> **Validation Architecture section omitted:** `workflow.nyquist_validation` is `false` in `.planning/config.json`. (Vitest is still wired per D-10, but the Nyquist test-map section is intentionally skipped.)

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`. This is a tooling/scaffolding phase with no auth, no data, no network endpoints — most ASVS categories are N/A this phase. The one live security concern is **secret handling in env config**.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | None this phase (Better Auth = fase 3). |
| V3 Session Management | no | None this phase. |
| V4 Access Control | no | RLS = fase 2. |
| V5 Input Validation | partial | Env validation via Zod/t3-env (MONO-03) — validate at boundary, fail closed. |
| V6 Cryptography | no | SOPS/age secrets = fase 4 (INFRA-03). |
| V7 Errors & Logging | partial | Env errors must be actionable but must NOT print secret *values* — print var name + reason only (D-04). |
| V14 Configuration | yes | `.env*` gitignored; only `.env.example` (no real values) committed; secrets never in plaintext in repo. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server secret inlined into client bundle | Information Disclosure | t3-env client/server split; `NEXT_PUBLIC_` only for non-secrets; never read `process.env` in client (Pitfall 3). |
| Real secrets committed via `.env` | Information Disclosure | `.gitignore` `.env*`; commit only `.env.example` with placeholder values (D-04, V14). |
| Env error message leaking secret values in logs | Information Disclosure | Ensure error prints var name + validation reason, not the offending value. |
| Slopsquatted/typo'd dependency | Tampering | Package Legitimacy Audit run (all OK); Corepack-pinned pnpm + `frozen-lockfile` in CI later. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `typescript-eslint` latest 8.x supports ESLint 9 flat config + TS 5.9 with `projectService` | Standard Stack / Pattern 3 / Pitfall 2 | If unsupported, type-aware lint breaks; planner should `npm view typescript-eslint` and confirm before locking. Low risk — well-established support. |
| A2 | t3-env aggregates all Zod issues by default (satisfies D-04 without custom `onValidationError`) | Pitfall 4 / Code Examples | If it only shows the first error, a small custom error formatter is needed. Mitigated by the D-10 test asserting two failures. |
| A3 | `gh` CLI availability for PR creation (D-15) | Environment Availability | If absent, PR is created via web UI — no blocker. |
| A4 | `@t3-oss/env` `experimental__runtimeEnv` is the current Next API for `NEXT_PUBLIC_*` wiring | Code Examples | API name could differ in 0.13.x; planner/executor verifies against installed package's README. Low risk. |

## Open Questions

1. **`engines` enforcement strictness for phase 1**
   - What we know: local Node is 20.19.6; target is 22 LTS; Next runs on ≥20.9.
   - What's unclear: whether to set `engines.node` to `>=22` (warn) vs hard-fail in dev before CI/Docker exist.
   - Recommendation: `>=22` as a warning + `.nvmrc=22`; hard enforcement arrives with CI in fase 4.
2. **`typescript-eslint` exact pinned version**
   - What we know: it's the canonical typed-lint package; needs ESLint 9 + TS 5.9 compatibility.
   - What's unclear: exact 8.x version to pin (not verified this session).
   - Recommendation: planner runs `npm view typescript-eslint version` and pins an 8.x that lists ESLint 9 + TS 5.9 support.
3. **Branch-name authority conflict**
   - What we know: D-16 mandates literal `fase-0/foundation`; config.json `phase_branch_template` is `gsd/phase-{phase}-{slug}`.
   - What's unclear: nothing — D-16 (locked decision) wins.
   - Recommendation: planner uses `fase-0/foundation` and ignores the template for this phase.

## Sources

### Primary (HIGH confidence)
- `CLAUDE.md` → "Technology Stack" (version-verified research, 2026-06-12) — full pinned matrix, RLS/Docker notes, "What NOT to Use". Authoritative.
- `.planning/REQUIREMENTS.md`, `.planning/phases/01-monorepo-foundation/01-CONTEXT.md` — phase scope + 16 locked decisions.
- npm registry via `npm view` (2026-06-12) — exact versions: `@t3-oss/env-nextjs`/`-core` 0.13.11, tsx 4.22.4, tsup 8.5.1, prettier 3.8.4, eslint-config-prettier 10.1.8, @vitest/coverage-v8 4.1.8.
- `gsd-tools query package-legitimacy check` (2026-06-12) — all packages OK (two false-positive `too-new` flags explained).
- Local probes: `node --version` (20.19.6), `pnpm --version` (0.34.1 on PATH), `git --version` (2.50.1), Corepack present under nvm.

### Secondary (MEDIUM confidence)
- github.com/t3-oss/t3-env (official repo, linked from npm metadata) — `createEnv`, client/server split, `experimental__runtimeEnv`, `skipValidation`/`SKIP_ENV_VALIDATION`, aggregated errors.
- Turborepo official docs (`tasks` key, Docker `turbo prune`) — cited via CLAUDE.md.
- typescript-eslint flat-config docs — `config()` helper, `projectService`.

### Tertiary (LOW confidence)
- Exact `typescript-eslint` version compatibility with the pinned ESLint 9 + TS 5.9 — `[ASSUMED]`, to verify at plan time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — CLAUDE.md matrix + this-session npm verification of the four new packages.
- Architecture/patterns: HIGH — all backed by locked CONTEXT decisions + official docs idioms.
- Pitfalls: HIGH — derived from verified local-env gaps (Node/pnpm) + documented t3-env/ESLint/Turbo behaviors.
- Env API specifics (`experimental__runtimeEnv` exact name): MEDIUM — verify against installed 0.13.x README.

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stable tooling; re-verify `typescript-eslint` + `@t3-oss/env` versions at plan time if later).
