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

## Milestone: v1.1 — Schema + Media + Seed (Fase 1)

**Shipped:** 2026-07-01
**Phases:** 3 | **Plans:** 12 | **Tasks:** 30

### What Was Built
- Schema completo de modelo-mvp §3.3: 13 tablas nuevas (catálogo, pricing, quotes, capture, contenido, events particionada por mes) en migraciones Drizzle versionadas (0002 + 0003), todas clonadas del template RLS de v1.0 con `FORCE ROW LEVEL SECURITY`, dinero en enteros/decimal y JSONB tipado con Zod.
- Suite cross-tenant extendida a las 13 tablas — tenant isolation, anon published-only, tenant-private, partition routing — 14 tests verdes en CI contra Postgres 16 real con roles NOBYPASSRLS.
- Pipeline de media: `@imbau/storage` + tRPC createUpload/confirmUpload + worker sharp (variantes AVIF/WebP srcset, blurhash, dimensiones) con idempotencia, reintentos, role-guard y errores a Sentry + pino; UAT live-R2 en staging.
- Seed determinista e idempotente de "Brigos Recoleta": 13 pisos / 38 unidades con curva de venta pozo, pricing USD + planes CAC + cac_index 18 meses, brokers/leads/galerías/obra/events, y 13 imágenes procesadas por el pipeline REAL R2+worker con mediaId determinista.

### What Worked
- **Clonar el template RLS de v1.0.** Autorar cada tabla nueva como clon fiel de `projects.ts` (policy, GRANTs, FORCE) hizo el schema masivo (13 tablas) mecánico y uniforme — la suite cross-tenant pasó sin retrofits.
- **Exit gates por fase.** SCHEMA-08 (suite de aislamiento) y SEED-04 (gate run-twice de invariancia) como puertas de salida explícitas dieron verificación binaria, no "parece que anda".
- **Mock-S3 en CI + live-R2 como gate humano (D6).** CI nunca toca infra real (sin secrets en repo) pero el round-trip real se verifica en UAT staging — las dos UAT live-R2 (Fase 2 y Fase 3) pasaron a la primera.
- **Seed cycle-safe componiendo primitivas.** Detectar el ciclo db↔api en planning (no en ejecución) y re-componer `@imbau/storage` directamente evitó un refactor a mitad de fase.
- **Estimación mucho más ajustada:** 5 días calendario para 3 fases / 12 plans — la lección de v1.0 (la infra real domina el costo) no aplicó porque este milestone fue casi todo código puro sobre infra ya operativa.

### What Was Inefficient
- **CI rojo post-merge de Phase 1.** El gate `quality` volvió a destapar gaps (turbo strict-env passthrough, servicio Redis faltante, envs DATABASE_*/auth, exclusión de e2e del panel, paso de migrate en CI) que costaron 5 commits de fixes. El patrón de v1.0 se repitió: el dev local esconde lo que CI exige.
- **Verificación live dependiente de credenciales.** Las UAT live-R2 quedaron bloqueadas hasta tener credenciales R2 en SOPS; el flujo humano de secrets (decrypt con `SOPS_AGE_KEY_FILE` explícito) generó fricción de ida y vuelta.
- **Un SUMMARY con one-liner ruidoso (01-05).** El extract automático de accomplishments arrastró texto de deviation en lugar del resumen — costo menor, pero ensucia el archivado automático (se curó a mano en MILESTONES.md).

### Patterns Established
- **Tabla nueva = clon del template RLS** (`projects.ts`): policy por tenant + GRANTs + FORCE, verificada por la suite cross-tenant extendida — el patrón escala a cualquier tabla futura.
- **Idempotencia por identidad determinista:** `seedId(name) = uuidv5(name, SEED_NS)` + `onConflictDoNothing` como mecanismo único para todas las tablas; mediaId determinista hace que re-corridas sobreescriban los mismos objetos R2.
- **JSONB tipado:** todo campo JSONB lleva envelope Zod (`Refuerzo[]`, `LeadNote[]`, variants map) validado en el boundary — nunca JSON libre.
- **Worker jobs con tres garantías probadas:** idempotencia, recoverabilidad (fallo deja estado recuperable, nunca inconsistente) y role-guard (write-back como `app_authenticated`, jamás owner) — harness de integración contra Postgres real + mock S3.

### Key Lessons
1. **Confirmada (v1.0 → v1.1): correr CI temprano.** El primer merge de la fase volvió a destapar gaps CI-only; los fixes de CI deberían ser parte del exit gate del primer plan que toca CI, no post-merge.
2. **Los templates verificados amortizan.** La inversión de v1.0 en el patrón RLS + suite hizo que 13 tablas nuevas costaran días, no semanas, sin pérdida de rigor.
3. **Separar "verificado con mock" de "verificado en vivo" funciona como contrato.** Declarar el live-check como item UAT trackeado (no asumirlo cubierto) mantuvo CI hermético y la verificación real explícita — repetir en fases futuras con infra externa.
4. **La estimación AI-first aplica bien a código puro:** 5 días para schema+media+seed vs 14 días de la fase de infra. Presupuestar distinto según el mix código/ops de cada fase.

### Cost Observations
- Model mix: predominantemente Opus/Fable (perfil GSD "quality"), desarrollo AI-first.
- Notable: milestone casi todo código puro — la fricción residual fue CI env-matrix y el handoff humano de secrets (R2/SOPS), no generación de código.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 Fundación | 4 | 18 | Baseline — GSD horizontal por capas en orden de dependencias; CI gate + RLS-in-CI establecidos |
| v1.1 Schema + Media + Seed | 3 | 12 | Template-driven scaling (clon RLS por tabla) + exit gates binarios (suite cross-tenant, run-twice) + UAT live como gate humano trackeado |

### Cumulative Quality

| Milestone | Tenant isolation | RLS-in-CI | Deviations documentadas |
|-----------|------------------|-----------|-------------------------|
| v1.0 | cross-tenant absence suite verde | sí (postgres:16 service) | D-01 (nginx vs Traefik), D-03/04 (pino-loki) |
| v1.1 | suite extendida a 13 tablas nuevas + partition routing (14 tests) | sí (postgres:16 + redis services, migrate step) | D6 (mock-S3 en CI, live-R2 en UAT), D-04 (seed cycle-safe sin @imbau/api) |

### Top Lessons (Verified Across Milestones)

1. **Verificada (v1.0, v1.1)** — La infra real domina el costo: 14 días la fase de infra vs 5 días tres fases de código puro. Presupuestar por mix código/ops.
2. **Verificada (v1.0, v1.1)** — RLS-first + verificación contra DB real previene retrofits: el template de v1.0 escaló a 13 tablas nuevas sin fricción.
3. **Verificada (v1.0, v1.1)** — CI destapa gaps que el dev local esconde; ambos milestones pagaron fixes de CI post-merge. Pendiente: mover el smoke de CI al primer plan de cada milestone.
