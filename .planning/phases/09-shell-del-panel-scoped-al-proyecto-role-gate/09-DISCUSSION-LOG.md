# Phase 9: Shell del panel scoped al proyecto + role gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-21
**Phase:** 9-shell-del-panel-scoped-al-proyecto-role-gate
**Areas discussed:** Routing de tabs, Dashboard `/` actual, Shell vacío, Probar el gate, Proyecto ajeno, Viewer UX

---

## Routing de tabs

| Option | Description | Selected |
|--------|-------------|----------|
| Sub-rutas reales | `proyectos/[id]/unidades\|leads\|hotspots`, layout compartido con barra de tabs, deep-linkeable; índice redirige a tab default | ✓ |
| Tab state en cliente | Una sola ruta con tabs como estado React; sin deep-link, fuerza todo bajo un RSC | |
| Vos decidís | Delegar a Claude | |

**User's choice:** Sub-rutas reales
**Notes:** `proyectos/[id]` redirige a la tab por defecto = `unidades`.

---

## Dashboard `/` actual

| Option | Description | Selected |
|--------|-------------|----------|
| `/` = selector | `/` sigue siendo home: lista proyectos org activa + link a `proyectos/[id]`; mantiene bloque invitación owner-only | ✓ |
| Redirect a último/único | `/` redirige directo si hay un solo proyecto; selector si hay varios | |
| Vos decidís | Delegar a Claude | |

**User's choice:** `/` = selector
**Notes:** Cero pérdida de lo existente; el `InviteForm` owner-only se preserva.

---

## Shell vacío (contenido de tabs hoy)

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder + seam | Cada segmento con `page.tsx` real (RSC resuelve proyecto por RLS) + placeholder es-AR; contrato de layout cableado para D1/D2/hotspots | ✓ |
| Solo tab activa cableada | Solo unidades con page real; leads/hotspots muertos hasta su fase | |
| Vos decidís | Delegar a Claude | |

**User's choice:** Placeholder + seam
**Notes:** Prueba SC-1/SC-2 de punta a punta ya en esta fase; fases siguientes reemplazan solo el cuerpo.

---

## Probar el gate (matriz cross-rol)

| Option | Description | Selected |
|--------|-------------|----------|
| Mutación canary real | `projects.updateSettings` protegida por `requireRole('owner','developer')`, queda en producción, molde para D1/D2/hotspots; matriz owner✓/dev✓/viewer✗403/cross-org✗ contra Postgres real | ✓ |
| Probe descartable | Endpoint `noop` solo para tests, sin valor de producto | |
| Test directo del middleware | Tests que invocan `requireRole` sin endpoint; no ejercita path RSC→caller→RLS | |

**User's choice:** Mutación canary real
**Notes:** No descartable — es el ejemplo canónico de "mutación de escritura del panel bien hecha".

---

## Proyecto ajeno / inexistente

| Option | Description | Selected |
|--------|-------------|----------|
| 404 `notFound()` | Si RLS no devuelve el proyecto → 404; mismo trato "no existe"/"no es tuyo"; no-enumeración | ✓ |
| 403 explícito | Distinguir "existe pero sin acceso" (403) de "no existe" (404); filtra existencia cross-org | |
| Vos decidís | Delegar a Claude | |

**User's choice:** 404 `notFound()`
**Notes:** Alineado con que RLS ya hace invisible el proyecto ajeno.

---

## Viewer UX

| Option | Description | Selected |
|--------|-------------|----------|
| Shell completo, acciones ocultas | Viewer navega las 3 tabs en lectura; botones de escritura no se renderizan; server 403 igual si intenta mutar (defensa en profundidad) | ✓ |
| Viewer sin acceso al shell | Viewer no puede abrir `proyectos/[id]` | |
| Vos decidís | Delegar a Claude | |

**User's choice:** Shell completo, acciones ocultas
**Notes:** UI oculta + gate server-side; nunca solo UI.

---

## Claude's Discretion

- Campo concreto que muta `projects.updateSettings` (nombre vs estado vs ambos) — el mínimo real y útil.
- Estilo visual del shell/tabs: sin design system esta fase (UI funcional es-AR voseo); `/gsd-ui-phase 9` opcional aparte.
- Micro-layout (posición de tabs, breadcrumb al selector, indicador de tab activa).

## Deferred Ideas

- Org switcher en el shell — la org activa se toma de sesión; candidato a fase de configuración/branding (D5).
- Contrato de diseño / design system del panel — `/gsd-ui-phase 9` opcional.
- Breadcrumbs / navegación global rica — a criterio del executor.
