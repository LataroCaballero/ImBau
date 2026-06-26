# Phase 1: Monorepo Foundation - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

El monorepo pnpm + Turborepo compila de punta a punta sobre una rama de milestone limpia: apps (`web`, `panel`, `worker`) y packages (`db`, `api`, `quoting`, `ui`, `config`) esqueleto con dependencias estrictamente descendentes (apps → api → db/ui → config), config compartida (TypeScript 5.9 estricto, ESLint 9 flat config, Prettier) corriendo en todo el workspace, y validación de env con Zod que falla rápido al boot. Requirements: PROC-01, MONO-01, MONO-02, MONO-03.

**Fuera de esta fase:** Docker Compose / Postgres / Redis (fase 2), Better Auth y tRPC reales (fase 3), CI/CD y staging (fase 4). Los packages esqueleto NO adelantan interfaces de fases futuras.

</domain>

<decisions>
## Implementation Decisions

### Validación de env (Zod) — MONO-03
- **D-01:** Usar `@t3-oss/env-nextjs` para las apps Next y `@t3-oss/env-core` para el worker. No escribir helper propio.
- **D-02:** Schemas por app: cada app define su propio `env.ts` componiendo presets parciales compartidos exportados desde `packages/config` (ej: `dbEnv`, `redisEnv`). Cada app declara exactamente las variables que usa — web no valida `REDIS_URL`, worker no valida `NEXT_PUBLIC_*`.
- **D-03:** Validación en build + boot: el env se valida al importarse (falla en `next build` y al boot del worker). `SKIP_ENV_VALIDATION=1` permitido únicamente para el build de imagen Docker (fase 3); al boot del contenedor valida siempre.
- **D-04:** Errores agregados: el mensaje de fallo lista TODAS las variables faltantes/inválidas de una sola vez, con nombre y motivo. Se versiona un `.env.example` por app como documentación viva, consistente con el schema.

### Estrategia de build de packages
- **D-05:** Packages internos just-in-time (JIT): los `exports` de `package.json` apuntan a `src/*.ts` crudo, sin paso de build interno ni `dist/`. Next consume vía `transpilePackages`; Vitest transpila solo.
- **D-06:** Worker: `tsx watch` en dev, `tsup` para build de producción (bundlea los workspace packages en un solo output, listo para la imagen Docker de fase 3).
- **D-07:** Type-check con `tsc --noEmit` por package/app como task `typecheck` orquestada por Turbo con cache. Sin project references de TypeScript.
- **D-08:** `pnpm dev` = `turbo dev`: levanta web, panel y worker en paralelo con output agrupado. Puertos fijos: web 3000, panel 3001. Enfoque por app con `--filter`.

### Profundidad del esqueleto
- **D-09:** web y panel muestran una página de status mínima en es-AR: nombre de la app, entorno actual y check de que el env validó. Sirve como smoke test visual en deploys futuros. Sin layout/branding todavía (el design system no existe).
- **D-10:** Vitest se cablea en fase 1 con tests reales del esqueleto: schemas de env (una var inválida falla con mensaje agregado) y la función placeholder de quoting. `pnpm test` pasa desde el día uno — CI (fase 4) lo necesita verde.
- **D-11:** Prettier como formatter, config compartida en `packages/config`, integrado con ESLint 9 vía `eslint-config-prettier`.
- **D-12:** Cada package esqueleto exporta algo pequeño pero genuino que prueba la cadena de deps: `ui` un componente trivial usado por las apps, `quoting` una función pura con test, `db`/`api` solo tipos/placeholder tipado. Nada de código especulativo de fases 2-3.

### Flujo de ramas (PROC-01)
- **D-13:** Merge a main por fase GSD: cada fase (1-4) se trabaja en su rama y se mergea a main al verificarse. Main avanza en piezas verificadas; cuando fase 4 active el auto-deploy, los merges siguientes ya disparan staging.
- **D-14:** Los commits de planning GSD (.planning/, planes, summaries) viajan junto con el código en la rama de fase y llegan a main con el merge. Los artefactos previos al branch (este CONTEXT.md) quedan en main.
- **D-15:** PR en GitHub por fase + merge commit (`--no-ff`), aunque sea solo dev. Preserva los commits atómicos de GSD y prepara el hábito para el gate de CI de fase 4 (CI roja = no merge).
- **D-16:** Una rama por fase GSD siguiendo `fase-N/descripcion`: `fase-0/foundation` para esta fase (cumple PROC-01 literal), luego `fase-0/data-rls`, `fase-0/auth-api-apps`, `fase-0/staging-cicd`.

### Claude's Discretion
- Estructura interna de `turbo.json` (task graph, inputs/outputs de cache) — patrón estándar Turborepo 2.x con key `tasks`.
- Naming npm de los packages (ej: scope `@imbau/*`) y estructura interna de carpetas.
- Detalles de configuración de ESLint flat config, tsconfig presets y Vitest workspace.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Producto y alcance
- `CLAUDE.md` — Estándar de calidad no negociable, stack decidido, convenciones (idioma, commits, ramas `fase-N/descripcion`, dinero, fechas). Ante conflicto con modelo-mvp.md, manda CLAUDE.md.
- `docs/modelo-mvp.md` — Documento maestro de producto (§3.6 plan de fases y estimaciones). Para esta fase solo contexto; el alcance ejecutable es PROC/MONO de REQUIREMENTS.md.

### Planning
- `.planning/PROJECT.md` — Core value, constraints (timeline 3-4 días para fase 0, regla de control de 1 semana), key decisions.
- `.planning/REQUIREMENTS.md` — PROC-01, MONO-01, MONO-02, MONO-03 (alcance exacto de esta fase). Nota: TS 6.x / ESLint 10 explícitamente out of scope — pinear TS 5.9 + ESLint 9.
- `.planning/ROADMAP.md` — Success criteria de la fase 1 y dependencias hacia fases 2-4.

### Stack pineado
- Sección "Technology Stack" de `CLAUDE.md` (research 2026-06-12) — versiones exactas verificadas: pnpm 11.6.0 (pin vía `packageManager` + Corepack), Turborepo 2.9.18 (key `tasks`, no `pipeline`), TS 5.9.x, Node 22 LTS (`.nvmrc` + `engines`), Next 16.2.x, React 19.2.x, Zod 4.4.x, Vitest 4.1.8, ESLint 9 flat config.

</canonical_refs>

<code_context>
## Existing Code Insights

Repo greenfield: solo existen `CLAUDE.md`, `docs/modelo-mvp.md`, `.planning/` y `.claude/`. No hay código, package.json ni lockfile — esta fase crea la estructura desde cero. No hay assets reutilizables ni patrones establecidos; los patrones que esta fase establezca (config compartida, JIT packages, env por app) serán los canónicos para las fases 2-4.

### Integration Points
- Las fases 2-4 construyen sobre lo que esta fase deja: `packages/config` será importado por todo, los presets de env (`dbEnv`, `redisEnv`) los consumirá fase 2, y los Dockerfiles de fase 3 dependen del enfoque JIT + tsup del worker y del flag `SKIP_ENV_VALIDATION`.

</code_context>

<specifics>
## Specific Ideas

- La página de status de web/panel debe estar en es-AR (voseo) — es la primera UI visible del proyecto y aplica la convención de idioma desde el día uno.
- El mensaje de error de env debe ser accionable: lista completa de variables con nombre y motivo, no "invalid environment".
- PROC-01 incluye commitear el estado actual del repo (`.claude/` y `docs/` están untracked hoy) antes de crear `fase-0/foundation`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Monorepo Foundation*
*Context gathered: 2026-06-12*
