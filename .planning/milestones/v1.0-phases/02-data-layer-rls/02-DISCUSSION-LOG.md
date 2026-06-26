# Phase 2: Data Layer + RLS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 2-Data Layer + RLS
**Areas discussed:** Tenant + tablas Auth, Mecánica withTenant(), Harness tests RLS, Alcance del schema

---

## Tenant + tablas Auth

### Tabla raíz del tenant
| Option | Description | Selected |
|--------|-------------|----------|
| BA `organization` extendida | Usar la tabla `organization` de Better Auth como tenant canónico + columna `plan`; GUC desde `session.activeOrganizationId` | ✓ |
| `organizations` de dominio aparte | Tabla propia separada de la de BA con FK/mapeo entre ambas | |

### Tabla de pertenencia y roles
| Option | Description | Selected |
|--------|-------------|----------|
| BA `member` canónica | Adoptar `member` del org plugin; roles owner/developer/viewer en `member.role` | ✓ |
| `memberships` propia | Mantener el nombre del modelo-mvp y mapear vía adapter | |

### BA schema → migración de fase 2
| Option | Description | Selected |
|--------|-------------|----------|
| Config mínima + CLI generate | Config mínima de BA solo para `@better-auth/cli generate`, plegar a Drizzle | ✓ |
| Autor a mano ahora | Escribir las tablas a mano y reconciliar con el CLI en fase 3 | |

**User's choice:** Las tres opciones recomendadas.
**Notes:** Resuelve el blocker `member` vs `memberships` registrado en STATE.md. Una sola noción de organización, sin sincronizar dos tablas, sin drift con el plugin.

---

## Mecánica withTenant()

### Role-switching
| Option | Description | Selected |
|--------|-------------|----------|
| Conexión como app + SET LOCAL GUC | Pool conectado directo como `app_authenticated`; migraciones con pool owner separado | ✓ |
| Conexión owner + SET LOCAL ROLE | Un solo pool owner; `SET LOCAL ROLE` por txn | |

### Nombre del GUC
| Option | Description | Selected |
|--------|-------------|----------|
| `app.current_organization_id` | Namespace `app.*`, nombre explícito, `current_setting(..., true)` | ✓ |
| `app.org_id` (corto) | Mismo namespace, nombre corto | |

### Camino anónimo
| Option | Description | Selected |
|--------|-------------|----------|
| `withAnon()` separado | Helper aparte, rol `anon`, filtra `estado='publicado'` global | ✓ |
| `withTenant({ role: 'anon' })` | Un helper parametrizado por rol | |

**User's choice:** Las tres opciones recomendadas.
**Notes:** Menor superficie de fuga RLS en runtime (rol nunca privilegiado). Implica dos connection strings (owner/migrador vs app) — anotado como nota de implementación en CONTEXT.

---

## Harness tests RLS (DATA-04, puerta de salida)

### Provisión de Postgres
| Option | Description | Selected |
|--------|-------------|----------|
| Mismo Postgres de Compose | Apuntar al PG16 de Compose; en CI = Postgres service de Actions | ✓ |
| Testcontainers | PG efímero por corrida desde Vitest | |

### Aislamiento entre tests
| Option | Description | Selected |
|--------|-------------|----------|
| Migrar+seed una vez, fixtures por test | Migraciones+roles una vez; cada test crea sus orgs/projects | ✓ |
| Transacción con rollback por test | Txn revertida por test | |

### Forma del test de ausencia
| Option | Description | Selected |
|--------|-------------|----------|
| Org A consulta, espera 0 filas de B | Conteo cero cross-tenant + espejo + write cross-tenant que falla + anon no ve borradores | ✓ |
| Solo SELECT básico A≠B | Solo cubrir el SELECT | |

**User's choice:** Las tres opciones recomendadas.
**Notes:** Paridad dev↔CI sin segunda ruta (testcontainers descartado). Rollback-por-test descartado porque chocaría con el `SET LOCAL`/txn del código bajo prueba.

---

## Alcance del schema

### Tablas en la migración
| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo: org+projects+BA | `organization`+`member`+`user`/sesión+`invitation`+`projects` | ✓ |
| Mínimo + `events`/`leads` | Agregar insert anónimo con rate-limit ahora | |

### Enum estado + policy anon
| Option | Description | Selected |
|--------|-------------|----------|
| Sí, enum + policy anon | `projects.estado` enum + policy `anon` solo-`publicado` | ✓ |
| Solo columna, policy en fase 3 | Diferir la policy anon | |

### Seed
| Option | Description | Selected |
|--------|-------------|----------|
| No, solo fixtures de test | Sin seed de dev; orgs/projects los crean los tests | ✓ |
| Seed mínimo de dev | `pnpm db:seed` con orgs/projects de ejemplo | |

**User's choice:** Las tres opciones recomendadas.
**Notes:** Mantiene la fase enfocada en la costura RLS de punta a punta; `events`/`leads`/schema completo/seed real = milestones futuros (SCHEMA-01/SEED-01).

---

## Claude's Discretion

- Nombres finos de roles owner/migrador, estructura de `drizzle.config.ts` (`entities.roles: true`), organización de carpetas en `packages/db`.
- Mecánica fina de apertura/cierre de transacción con el driver `postgres` e inyección segura del `orgId`.
- Imagen/versión exacta de Redis 7 en Compose y health-check (Redis solo contenedor en fase 2).

## Deferred Ideas

- `events`/`leads` con insert anónimo + rate-limit → SCHEMA-01 (milestone futuro).
- Seed de dev mínimo → SEED-01 (edificio "Brigos Recoleta", milestone futuro).
- Schema completo del dominio (floors/units/precios/quotes/etc.) → SCHEMA-01.
