# Phase 1: Monorepo Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 1-Monorepo Foundation
**Areas discussed:** Validación de env (Zod), Estrategia de build de packages, Profundidad del esqueleto, Flujo de ramas (PROC-01)

---

## Validación de env (Zod)

### ¿Cómo implementamos la validación con Zod?

| Option | Description | Selected |
|--------|-------------|----------|
| @t3-oss/env-nextjs | Lib establecida sobre Zod: split server/client, valida en build e import, env-core para worker | ✓ |
| Helper propio en packages/config | createEnv() casero con Zod puro; cero deps extra pero más código propio | |
| Decidí vos | Claude elige durante planning | |

### ¿Dónde viven los schemas?

| Option | Description | Selected |
|--------|-------------|----------|
| Por app, con base compartida | packages/config exporta presets parciales (dbEnv, redisEnv); cada app compone su env.ts | ✓ |
| Centralizado en packages/config | Un schema global; web validaría variables que no usa | |
| Por app, sin compartir nada | Máxima independencia, duplicación de DATABASE_URL/REDIS_URL | |

### ¿Cuándo se valida?

| Option | Description | Selected |
|--------|-------------|----------|
| Build + boot, con escape para Docker | Valida al importar (falla en next build y boot); SKIP_ENV_VALIDATION=1 solo para build de imagen | ✓ |
| Solo al boot (runtime) | Más simple; typos se descubren al deployar | |
| Decidí vos | Claude define durante planning | |

### ¿Qué ve el dev cuando falta una variable?

| Option | Description | Selected |
|--------|-------------|----------|
| Errores agregados + .env.example | Lista TODAS las vars faltantes/inválidas de una; .env.example por app versionado | ✓ |
| Errores agregados, sin .env.example | Mismo reporte; el schema es la única fuente de verdad | |
| Decidí vos | Claude define durante planning | |

---

## Estrategia de build de packages

### ¿Cómo se consumen los packages internos?

| Option | Description | Selected |
|--------|-------------|----------|
| Just-in-time / TS crudo | exports apuntan a src/; Next transpilePackages, worker bundlea, Vitest transpila. Patrón Turborepo | ✓ |
| Compilados (tsc/tsup → dist/) | Build graph explícito y cacheable, pero watch-mode en dev y más configs | |
| Híbrido | JIT para ui/config, compilado para db/quoting | |

### ¿Cómo corremos el worker?

| Option | Description | Selected |
|--------|-------------|----------|
| tsup build + tsx en dev | tsx watch en dev; tsup bundlea workspace packages para Docker | ✓ |
| tsc + node | Compilación clásica; rompe el enfoque JIT | |
| Decidí vos | Claude elige durante planning | |

### ¿Type-check del workspace?

| Option | Description | Selected |
|--------|-------------|----------|
| tsc --noEmit por package/app | Task typecheck por workspace, orquestada por Turbo con cache | ✓ |
| Project references | tsc -b incremental; más frágil y redundante con cache de Turbo | |
| Decidí vos | Claude define durante planning | |

### ¿Qué hace `pnpm dev`?

| Option | Description | Selected |
|--------|-------------|----------|
| Todo en paralelo vía Turbo | turbo dev levanta las tres apps; web 3000, panel 3001; --filter para enfocar | ✓ |
| Por app explícito | Sin dev global; más control, más fricción | |
| Decidí vos | Claude define durante planning | |

---

## Profundidad del esqueleto

### ¿Qué muestran web y panel?

| Option | Description | Selected |
|--------|-------------|----------|
| Página de status útil | Página mínima es-AR: nombre de app, entorno, check de env — smoke test visual | ✓ |
| Placeholder mínimo | Solo un h1 con el nombre | |
| Layout base + branding inicial | Adelanta trabajo visual sin design system definido | |

### ¿Vitest en fase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, con tests reales del esqueleto | Tests de schemas de env y placeholder de quoting; pnpm test pasa desde el día uno | ✓ |
| Sí, pero solo smoke test | Test trivial por package para validar la infra de testing | |
| No, diferir a fase 2 | Sin Vitest hasta que haya lógica que testear | |

### ¿Formatter?

| Option | Description | Selected |
|--------|-------------|----------|
| Prettier | Estándar de facto, eslint-config-prettier, config en packages/config | ✓ |
| Sin formatter dedicado | Solo ESLint stylistic | |
| Decidí vos | Claude elige durante planning | |

### ¿Contenido de los packages esqueleto?

| Option | Description | Selected |
|--------|-------------|----------|
| Export mínimo real por package | ui componente trivial, quoting función pura con test, db/api tipos placeholder | ✓ |
| Solo index.ts vacío | Compilan pero no demuestran la cadena de imports | |
| Adelantar interfaces de fase 2-3 | Riesgo de especular APIs que se redefinirán | |

---

## Flujo de ramas (PROC-01)

### ¿Cómo fluye el trabajo entre fase-0/foundation y main?

| Option | Description | Selected |
|--------|-------------|----------|
| Merge a main por fase GSD | Cada fase en rama, merge a main al verificarse; main avanza en piezas verificadas | ✓ |
| Una rama para todo el milestone | Un solo merge al final; el lazo de deploy recién se prueba al último merge | |
| Trunk-based en main | Commits directos; contradice el espíritu de PROC-01 | |

### ¿Dónde van los commits de planning GSD?

| Option | Description | Selected |
|--------|-------------|----------|
| Todo junto en la rama de fase | Planning y código viajan juntos; cada merge trae el qué y el porqué | ✓ |
| Planning en main, código en rama | Separa preocupaciones pero obliga a saltar de rama | |
| Decidí vos | Claude define durante ejecución | |

### ¿Cómo se mergea a main?

| Option | Description | Selected |
|--------|-------------|----------|
| PR + merge commit | PR por fase con --no-ff; preserva commits atómicos, prepara gate de CI de fase 4 | ✓ |
| PR + squash | Main limpio pero se pierden los commits atómicos por task | |
| Merge local sin PR | Menos fricción hoy, migración de hábito después | |

### ¿Naming de ramas?

| Option | Description | Selected |
|--------|-------------|----------|
| Una rama por fase GSD | fase-0/foundation, fase-0/data-rls, fase-0/auth-api-apps, fase-0/staging-cicd | ✓ |
| Reutilizar fase-0/foundation | Misma rama recreada por fase; PRs menos descriptivos | |
| Decidí vos | Claude define durante planning | |

---

## Claude's Discretion

- Estructura interna de `turbo.json` (task graph, inputs/outputs de cache).
- Naming npm de los packages (scope) y estructura interna de carpetas.
- Detalles de ESLint flat config, tsconfig presets y configuración de Vitest workspace.

## Deferred Ideas

None — discussion stayed within phase scope.
