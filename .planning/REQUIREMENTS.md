# Requirements: ImBau — Milestone v1 (Fase 0: Fundación)

**Defined:** 2026-06-12
**Core Value:** La fundación técnica queda desplegada y operable desde el día uno: cada commit a main termina en software corriendo en staging con aislamiento multi-tenant verificable por RLS.

**Regla de alcance:** estrictamente lo que define `docs/modelo-mvp.md` para la fase 0 — nada más (regla de control: <1 semana o se recalibra).

## v1 Requirements

Requirements para el milestone v1 (fase 0). Cada uno mapea a fases del roadmap.

### Proceso

- [x] **PROC-01**: Antes de comenzar el desarrollo, se commitea el estado actual del repo y se crea la rama `fase-0/foundation` para el milestone v1

### Monorepo & Tooling

- [x] **MONO-01**: El monorepo pnpm + Turborepo compila con apps (`web`, `panel`, `worker`) y packages (`db`, `api`, `quoting`, `ui`, `config`) esqueleto, con dependencias estrictamente descendentes (apps → api → db/ui → config)
- [x] **MONO-02**: TypeScript 5.9 estricto (sin `any` injustificado) y ESLint 9 flat config corren desde `packages/config` compartido en todo el workspace
- [x] **MONO-03**: Las variables de entorno se validan con schema Zod tipado al boot; una env faltante o inválida falla rápido con mensaje claro

### Data Layer

- [x] **DATA-01**: `docker compose up -d` levanta Postgres 16 y Redis locales con un comando
- [x] **DATA-02**: El schema base (organizations → projects + tablas de Better Auth) vive en `packages/db` con migraciones Drizzle versionadas (`generate` + `migrate`, nunca `push` ni cambios manuales)
- [x] **DATA-03**: Toda tabla con tenant tiene RLS con `FORCE ROW LEVEL SECURITY`, roles de DB dedicados (app sin ownership ni BYPASSRLS, `anon` limitado a proyectos `publicado`) y el contexto de tenant fluye por transacción vía helper `withTenant()` con `SET LOCAL`
- [x] **DATA-04**: Tests de aislamiento cross-tenant (de ausencia, no solo de presencia) corren contra Postgres real como rol de app: la org A no puede leer datos de la org B — puerta de salida del milestone

### Auth

- [x] **AUTH-01**: Un usuario puede registrarse y loguearse con email/contraseña vía Better Auth, y su sesión persiste entre refrescos
- [x] **AUTH-02**: Un usuario pertenece a organizaciones con roles owner/developer/viewer (organization plugin), y la organización activa de su sesión determina su contexto de tenant
- [x] **AUTH-03**: Un owner puede invitar miembros a su organización por email (Resend + React Email) y el invitado puede aceptar y entrar con el rol asignado

### App Surfaces

- [x] **APP-01**: `apps/panel` tiene login funcionando y una página que lee datos protegidos por RLS de la organización activa
- [x] **APP-02**: `apps/web` tiene una página que lee vía rol `anon` y solo ve proyectos en estado `publicado`
- [x] **APP-03**: `apps/worker` existe como shell deployable (BullMQ conectado a Redis, sin lógica de jobs)
- [x] **APP-04**: Cada app tiene Dockerfile multi-stage con `turbo prune` + Next.js standalone que produce imágenes deployables

### Infra & Deploy

- [x] **INFRA-01**: Docker Compose completo corre en el VPS de staging detrás de Traefik con TLS: web, panel, worker, Postgres, Redis, Loki/Grafana, Uptime Kuma en `staging.tours.andescode.com.ar`
- [x] **INFRA-02**: Cada merge a main deploya automáticamente a staging (build → registry → VPS), con migraciones corridas antes del swap de contenedores
- [x] **INFRA-03**: Los secrets viven cifrados en el repo (SOPS/age) con separación por entorno; nada sensible en texto plano

### CI

- [x] **CI-01**: Cada PR corre lint + type-check + tests en GitHub Actions; CI roja = no se mergea
- [x] **CI-02**: Los tests de aislamiento RLS corren en CI contra un Postgres service real
- [ ] **CI-03**: CI buildea las imágenes Docker de las tres apps con cache de Turborepo y las pushea al registry

### Observabilidad

- [x] **OBS-01**: Los errores de web, panel y worker llegan a Sentry con contexto (incl. `onRequestError` para errores de RSC)
- [x] **OBS-02**: Las tres apps loguean estructurado con pino y los logs llegan a Grafana/Loki en staging
- [x] **OBS-03**: Uptime Kuma monitorea la disponibilidad de los servicios de staging

## v2 Requirements

Diferido a milestones futuros (fases 1-6 de modelo-mvp.md, en orden ventana-Fable). Trackeado pero fuera del roadmap actual.

### Fase 1 — Schema + Media + Seed

- **SCHEMA-01**: Schema completo de modelo-mvp.md §3.3 (floors, units, price_lists, payment_plans, quotes, brokers, leads, etc.)
- **MEDIA-01**: Pipeline de media (R2 + sharp + blurhash, variantes AVIF/WebP)
- **SEED-01**: Seed del edificio ficticio ~13 pisos estilo "Brigos Recoleta"

### Fase 3 — Cotizador

- **QUOT-01**: `packages/quoting` puro con cobertura 100% + property-based tests, UI del cotizador, PDF server-side, CTA WhatsApp

### Fase 4 — Panel

- **PANEL-01**: Grilla de unidades + import/export Excel, bandeja de leads, editor de hotspots

### Fase 2 — Explorador

- **EXPL-01**: Explorador del edificio + ficha de unidad con realtime (SSE)

### Fases 5-6 — Portada/Obra/Brokers y Métricas/QA

- **PORT-01**: Portada, avance de obra, galería, links de broker
- **METR-01**: Métricas, alertas de interés, branding, e2e completos, performance budget

### Fundación diferida (pre-primer cliente pago)

- **FOUND-01**: Backups Postgres (pgBackRest/wal-g a B2/R2) con restore ensayado
- **FOUND-02**: Dashboards OTel completos, PgBouncer si la concurrencia lo pide, TLS on-demand para dominios custom

## Out of Scope

Excluido explícitamente. Documentado para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Todo lo marcado `[B]` en modelo-mvp.md | Específico del design partner Pablo; no se construye hasta su feedback (regla A/B) |
| Lógica de jobs en BullMQ | Fase 0 solo necesita el worker como shell deployable; los jobs reales llegan con media/PDFs |
| Motor 3D tipo game engine | Decisión de producto: renders estáticos + hotspots SVG (90% de percepción, 10% de costo) |
| Terminaciones, día/noche, reserva online, API/SDK, CRM completo, apps nativas/VR | Fuera del MVP explícitamente (modelo-mvp.md §2.2) |
| PocketBase u otros atajos de prototipo | Estándar SaaS profesional desde día uno; el código es la carta de presentación |
| TypeScript 6.x / ESLint 10 | Matriz de herramientas sin soporte confirmado; pinear TS 5.9 + ESLint 9 y revisitar post-fase-0 |

## Traceability

Qué fases cubren qué requirements. Se actualiza durante la creación del roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROC-01 | Phase 1 | Complete |
| MONO-01 | Phase 1 | Complete |
| MONO-02 | Phase 1 | Complete |
| MONO-03 | Phase 1 | Complete |
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 2 | Complete |
| DATA-03 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| AUTH-01 | Phase 3 | Complete |
| AUTH-02 | Phase 3 | Complete |
| AUTH-03 | Phase 3 | Complete |
| APP-01 | Phase 3 | Complete |
| APP-02 | Phase 3 | Complete |
| APP-03 | Phase 3 | Complete |
| APP-04 | Phase 3 | Complete |
| INFRA-01 | Phase 4 | Complete |
| INFRA-02 | Phase 4 | Complete |
| INFRA-03 | Phase 4 | Complete |
| CI-01 | Phase 4 | Complete |
| CI-02 | Phase 4 | Complete |
| CI-03 | Phase 4 | Pending |
| OBS-01 | Phase 4 | Complete |
| OBS-02 | Phase 4 | Complete |
| OBS-03 | Phase 4 | Complete |

**Coverage:**

- v1 requirements: 24 total (PROC×1, MONO×3, DATA×4, AUTH×3, APP×4, INFRA×3, CI×3, OBS×3)
- Mapped to phases: 24 ✓
- Unmapped: 0 ✓

> Nota: la versión inicial registraba "21 total" en el conteo de cobertura, pero los IDs enumerados arriba suman 24. Se corrige el conteo a 24 (la lista de IDs es la fuente de verdad).

---
*Requirements defined: 2026-06-12*
*Last updated: 2026-06-18 — APP-03 marked Complete (worker deployable shell delivered & verified 4/4 in Phase 3)*
