# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Fundación (Fase 0)

**Shipped:** 2026-06-26
**Phases:** 4 | **Plans:** 18 | **Tasks:** 39

### What Was Built
- Monorepo pnpm + Turborepo con config compartida `@imbau/config` (TS 5.9 estricto, ESLint 9 flat, env presets Zod) y 3 apps + 5 packages compilando de punta a punta.
- Data layer multi-tenant: Postgres 16 + Redis vía Compose, schema base con migraciones Drizzle versionadas, `FORCE ROW LEVEL SECURITY` como código, helpers `withTenant`/`withAnon`, y suite de ausencia cross-tenant (puerta de salida DATA-04).
- Auth + API: Better Auth (orgs, roles, invitaciones por email) + capa tRPC v11 con contexto derivado de sesión; panel/web/worker leyendo por el camino de tenant correcto.
- Staging vivo en el VPS (`staging.tours.andescode.com.ar`) detrás de nginx-host + certbot, con Sentry + pino→Loki + Uptime Kuma, CI quality gate (RLS contra Postgres real) y auto-deploy a staging en cada merge.

### What Worked
- **RLS-first ordering.** Construir la capa de datos con aislamiento impuesto y probado por tests *antes* de cualquier código de app evitó retrofitear seguridad — la decisión de mayor riesgo se cerró temprano y verde.
- **Verificación contra Postgres real, no mocks.** La suite de ausencia cross-tenant corriendo como rol de app sin BYPASSRLS atrapa políticas rotas que un mock dejaría pasar; correrla también en CI cierra el lazo.
- **Owner-pool separado (A1) para Better Auth.** Aisló la escritura de tablas RLS-FORCED del camino de datos de la app sin debilitar las policies.
- **SUMMARY/VERIFICATION por fase** dieron trazabilidad clara al cierre del milestone (24/24 requirements mapeados a evidencia).

### What Was Inefficient
- **Estimación 3-4 días → 14 días calendario.** La regla de control (>1 semana = recalibrar) se cruzó. El grueso del overrun fue infra de staging *real* sobre un VPS compartido con prod, más varias iteraciones de fixes de CI — no lógica de producto. La estimación AI-first subestimó el costo de la operación de infra real vs. escribir código.
- **CI inaugural rojo por gaps pre-existentes.** El primer run de CI (04-03) destapó problemas monorepo-wide que el dev local escondía (resolución de ESLint 9 flat-config, `@imbau/db#test` necesitando Postgres en CI). Hubo que arreglarlos fuera de alcance (quick task 260626-f90) antes de poder mergear.
- **Verificación de Phase 03 quedó `human_needed`.** Los e2e Playwright y el smoke de Redis requieren stack vivo; no son machine-verificables en estático. Quedaron diferidos al cierre como override.

### Patterns Established
- **Tres-roles owner/app/anon** con contrato de connection-strings en `dbEnv`; app y anon nunca con ownership ni BYPASSRLS.
- **GUC transaction-scoped (`SET LOCAL`)** para el tenant, inyectado como parámetro bound dentro de transacción (pooling-safe).
- **Migración de journal único**: `0000_init.sql` generado por Drizzle + `0001_rls.sql` hand-written para lo que Drizzle no emite (roles, GRANTs, FORCE RLS).
- **migrate-before-swap** en el deploy: migraciones como exit-gate antes de tocar contenedores de app.
- **Deviation documentada (D-01)**: cuando la realidad de infra contradice CLAUDE.md (Traefik), se entrega la alternativa y se marca el doc maestro para revisitar.

### Key Lessons
1. **La infra real cuesta más que el código.** Para fases con componente de despliegue sobre infra compartida, presupuestar el doble del tiempo de código puro y no tratar la estimación AI-first como si aplicara al ops manual.
2. **Correr CI temprano, no al final.** El gate de CI destapó gaps monorepo-wide que el dev local ocultaba; introducirlo en la primera fase con código habría amortizado el costo.
3. **Separar "verificado por código" de "verificado en vivo".** Los flujos que necesitan stack corriendo (e2e, smokes) deben planearse con un paso de verificación humana explícito, no asumirse cubiertos por la suite estática.
4. **Anclar las deviations de infra al doc maestro.** D-01 (nginx vs Traefik) debe reflejarse en CLAUDE.md/modelo-mvp.md si persiste, para que prod no herede una expectativa equivocada.

### Cost Observations
- Model mix: predominantemente Opus (perfil GSD "quality"), desarrollo AI-first.
- Notable: el costo dominante del milestone fue iteración sobre infra/CI real, no generación de código de producto.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 Fundación | 4 | 18 | Baseline — GSD horizontal por capas en orden de dependencias; CI gate + RLS-in-CI establecidos |

### Cumulative Quality

| Milestone | Tenant isolation | RLS-in-CI | Deviations documentadas |
|-----------|------------------|-----------|-------------------------|
| v1.0 | cross-tenant absence suite verde | sí (postgres:16 service) | D-01 (nginx vs Traefik), D-03/04 (pino-loki) |

### Top Lessons (Verified Across Milestones)

1. *(se confirmará con v1.1+)* — La infra real domina el costo de las fases de despliegue.
2. *(se confirmará con v1.1+)* — RLS-first + verificación contra DB real previene retrofits de seguridad.
