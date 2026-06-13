---
phase: 01-monorepo-foundation
plan: 01
subsystem: infra
tags: [pnpm, turborepo, monorepo, toolchain, corepack, node22]

# Dependency graph
requires: []
provides:
  - Root workspace manifest (package.json) con pin de pnpm@11.6.0 y engines.node >=22
  - pnpm-workspace.yaml declarando apps/* + packages/*
  - turbo.json con key `tasks` (Turborepo 2.x) y task graph build/typecheck/lint/test/dev
  - .nvmrc (Node 22 LTS) y .gitignore (node_modules/.next/.turbo/dist/.env*, excepto .env.example)
  - pnpm-lock.yaml de un install limpio (turbo 2.9.18 + typescript 5.9.3)
  - Toolchain pinneada y activa: Corepack → pnpm 11.6.0 sobre Node 22.22.3
affects: [02-config-tooling, 03-packages-apps-skeleton, 04-staging-cicd, all-future-plans]

# Tech tracking
tech-stack:
  added:
    - turbo@2.9.18
    - typescript@5.9.3
    - pnpm@11.6.0 (vía Corepack)
    - Node 22.22.3 (instalado vía nvm para satisfacer el pin)
  patterns:
    - "Toolchain pinneada vía packageManager field + Corepack (no pnpm global por npm)"
    - "turbo.json usa key `tasks` (nunca `pipeline`); typecheck con arista ^typecheck impone orden de deps sin TS project references (D-07)"
    - "Scripts root delegan todo a `turbo run <task>` (D-08)"
    - ".gitignore bloquea .env* desde el primer commit, excepto !.env.example (V14, T-01-01)"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - turbo.json
    - .nvmrc
    - .gitignore
    - pnpm-lock.yaml
  modified: []

key-decisions:
  - "Naming npm scope @imbau/* reservado para packages (Discretion D); root package name = 'imbau'"
  - "turbo.json: build outputs .next/** (sin cache) + dist/**; test dependsOn ^build; dev cache:false persistent:true"
  - "engines.node >=22 como warning en fase 1 (Pitfall 1); hard-enforce llega con CI en fase 4"

patterns-established:
  - "Pin de toolchain reproducible: packageManager + Corepack + .nvmrc + engines"
  - "Workspace JIT-ready: globs apps/* + packages/* listos para los esqueletos de planes posteriores"

requirements-completed: [PROC-01, MONO-01]

# Metrics
duration: 7min
completed: 2026-06-13
---

# Phase 1 Plan 01: Monorepo Workspace Root Summary

**Raíz del monorepo pnpm + Turborepo con toolchain pinneada (Corepack → pnpm 11.6.0 sobre Node 22.22.3), `turbo.json` con key `tasks` y `pnpm install` corriendo limpio.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-13T02:09:56Z
- **Completed:** 2026-06-13T02:16:58Z
- **Tasks:** 2
- **Files modified:** 6 (creados)

## Accomplishments
- Toolchain pinneada y verificada de punta a punta: `pnpm --version` == `11.6.0` sobre Node 22.22.3.
- Raíz del workspace creada: root `package.json` (pin pnpm + engines + scripts → turbo), `pnpm-workspace.yaml` (apps/* + packages/*), `turbo.json` con key `tasks` y task graph estándar 2.x, `.nvmrc` (22) y `.gitignore` (bloquea `.env*`, exceptúa `.env.example`).
- `pnpm install` corre sin error e instala turbo 2.9.18 + typescript 5.9.3; lockfile commiteado.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Activar toolchain pinneada (PROC-01 — toolchain)** — sin commit de archivos fuente (operación de toolchain/Corepack; el `<files>` del task es ".git + corepack, sin archivos fuente"). Parte git-lifecycle deferida al orchestrator (ver Deviations).
2. **Task 2: Crear raíz del workspace** — `2629e5b` (chore)

_Nota: el commit de metadata del plan (este SUMMARY) lo registra el paso final en modo worktree._

## Files Created/Modified
- `package.json` — Root manifest: `name: imbau`, `private`, `packageManager: pnpm@11.6.0`, `engines.node >=22`, scripts dev/build/lint/typecheck/test → `turbo run`, `format` → prettier; devDeps turbo 2.9.18 + typescript 5.9.3.
- `pnpm-workspace.yaml` — Globs de workspace `apps/*` y `packages/*`.
- `turbo.json` — `$schema` Turborepo + key `tasks`: build (`^build`, outputs .next/dist), typecheck (`^typecheck`), lint, test (`^build`), dev (cache:false, persistent).
- `.nvmrc` — Pin Node `22`.
- `.gitignore` — Ignora node_modules/.next/.turbo/dist y `.env*`; exceptúa `!.env.example`.
- `pnpm-lock.yaml` — Lockfile del install limpio.

## Decisions Made
- Root package name `imbau`, scope `@imbau/*` reservado para packages (Claude's Discretion del CONTEXT).
- Estructura interna de `turbo.json` siguiendo el patrón estándar 2.x del RESEARCH (Discretion D-07/D-08).

## Deviations from Plan

### Deferred Work (worktree lifecycle constraint)

**1. [Rule 3 / worktree-scope] Porción git-lifecycle de Task 1 deferida al orchestrator**
- **Found during:** Task 1
- **Issue:** Task 1 (PROC-01) pedía commitear el estado untracked (`.claude/`, `docs/`) a `main` y crear la rama `fase-0/foundation` desde main. Este plan corre como executor PARALELO en un git worktree (`worktree-agent-a42703e1a53d3a160`); las reglas de ejecución prohíben a un sub-agente manipular `main` o el ciclo de vida de ramas — eso lo posee el orchestrator. Además, los archivos `.claude/`/`docs/` no existen en el árbol del worktree (los worktrees no arrastran untracked del checkout principal), así que no había nada que commitear acá.
- **Fix:** Se ejecutó la única parte de Task 1 que es relevante al scaffolding y verificable en el worktree: activación de la toolchain pinneada (`corepack enable` + `corepack prepare pnpm@11.6.0 --activate`), verificada con `pnpm --version` == `11.6.0`. La parte de commit-a-main + creación de `fase-0/foundation` queda para el orchestrator al integrar el worktree (D-15 ya califica el PR/merge como acción de ship-time fuera del scope de tasks de scaffolding).
- **Verification:** `pnpm --version` imprime `11.6.0`; rama del worktree intacta.
- **Committed in:** N/A (sin archivos fuente)

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Instalación de Node 22 LTS para satisfacer el pin de toolchain**
- **Found during:** Task 1 (activación de Corepack/pnpm)
- **Issue:** El entorno tenía Node v20.19.6 (no v22). `corepack prepare pnpm@11.6.0 --activate` seguido de `pnpm --version` crasheaba con `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — el shim CJS de pnpm 11.x bajo Corepack de Node 20 no soporta el dynamic import que usa. pnpm 11.6.0 requiere Node 22+, que CLAUDE.md y el plan pinnean explícitamente (`.nvmrc`=22, engines >=22).
- **Fix:** `nvm install 22` (instaló Node 22.22.3) y se reactivó Corepack → pnpm 11.6.0 bajo Node 22. No se cambió ninguna versión pinneada ni se eligió una alternativa; se cumplió el requisito de runtime ya documentado.
- **Files modified:** Ninguno (cambio de entorno/runtime, no de archivos del repo).
- **Verification:** `node --version` == `v22.22.3`; `pnpm --version` == `11.6.0`; `pnpm install` corre limpio.
- **Committed in:** N/A (cambio de toolchain)

---

**Total deviations:** 1 deferred (worktree-scope) + 1 auto-fixed (Rule 3 - blocking).
**Impact on plan:** Sin scope creep. La toolchain quedó exactamente en las versiones pinneadas. La porción git-lifecycle de PROC-01 (commit-a-main + rama `fase-0/foundation`) la debe completar el orchestrator al integrar este worktree — no se perdió alcance, sólo cambió de dueño por la mecánica de worktrees.

## Issues Encountered
- Node 20 en el entorno vs pin Node 22 → resuelto instalando Node 22.22.3 vía nvm (ver Deviation 2).
- `pnpm` no estaba en PATH (el RESEARCH anticipaba un 0.34.1 stale; acá no había ninguno) → resuelto vía Corepack bajo Node 22.

## User Setup Required
None — no se requiere configuración de servicios externos en este plan.

## Threat Surface
- T-01-01 (Information Disclosure / `.env`): mitigado — `.gitignore` bloquea `.env*` desde el primer commit, sólo `!.env.example` se versionará (lo crea el plan 03).
- T-01-02 (Tampering / pnpm en PATH): mitigado — pin vía `packageManager` + Corepack `prepare --activate`, verificado `pnpm --version` == 11.6.0.
- Sin nuevas superficies de amenaza fuera del threat_model del plan.

## Next Phase Readiness
- Raíz del workspace lista; planes posteriores pueden agregar `apps/*` y `packages/*` y correr `pnpm install` / `turbo run`.
- **Acción pendiente del orchestrator (no de este sub-agente):** al integrar el worktree, commitear el estado untracked a `main` y abrir/crear la rama `fase-0/foundation` (PROC-01 git-lifecycle), y cerrar la fase vía PR + merge `--no-ff` (D-15).
- **Nota de entorno:** el host necesita Node 22 activo (`nvm use 22` / `.nvmrc`) para que pnpm 11.6.0 funcione; Node 20 no alcanza.

## Self-Check: PASSED

- Archivos creados verificados en disco: package.json, pnpm-workspace.yaml, turbo.json, .nvmrc, .gitignore, pnpm-lock.yaml, 01-01-SUMMARY.md — todos FOUND.
- Commits verificados en git log: `2629e5b` (scaffold), `e760679` (SUMMARY) — ambos FOUND.

---
*Phase: 01-monorepo-foundation*
*Completed: 2026-06-13*
