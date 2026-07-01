# Phase 3: Seed del edificio ficticio - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 3-Seed del edificio ficticio
**Areas discussed:** Realismo/fidelidad, Media de galerías, Pricing y CAC, Leads/events de muestra

---

## Realismo / fidelidad

### Nivel de fidelidad

| Option | Description | Selected |
|--------|-------------|----------|
| Demo-grade creíble | Nombres, mix de tipologías, copy es-AR y precios coherentes/plausibles para Recoleta; listo para mostrar sin retoque | ✓ |
| Fixture funcional plausible | Datos válidos/variados/tipados pero sin pulido de copy; suficiente para desarrollo, no para cliente | |
| Decidí vos | Criterio óptimo del builder | |

**User's choice:** Demo-grade creíble
**Notes:** La demo wow para Pablo va al final de fase 2-3 y las superficies futuras + el cotizador del próximo milestone renderizan/calculan sobre esta data.

### Composición del edificio

| Option | Description | Selected |
|--------|-------------|----------|
| Torre Recoleta típica | PB con amenities/locales, ~2-4 unidades/piso, mix monoamb→penthouse, curva de venta realista, ~30-40 unidades | ✓ |
| Mix uniforme simple | Misma cantidad por piso, tipologías parejas, estados al azar balanceado | |
| Decidí vos | Composición creíble a criterio del builder | |

**User's choice:** Torre Recoleta típica
**Notes:** Estados con curva de venta de pozo (bajos vendidos → altos disponibles), no reparto al azar.

---

## Media de galerías

### Origen de las imágenes

| Option | Description | Selected |
|--------|-------------|----------|
| Stock libre curado | Imágenes libres de arquitectura/interiores estilo Recoleta, referenciadas determinísticamente | ✓ |
| Renders reales propios | Assets propios del edificio ficticio si ya existen | |
| Placeholders sintéticos | Bloques de color/gradientes generados, offline | |

**User's choice:** Stock libre curado
**Notes:** El material real de Pablo (Branch B) entra después sin re-seed estructural.

### Mecanismo de siembra de media procesada

| Option | Description | Selected |
|--------|-------------|----------|
| Pipeline real R2+worker | PutObject a R2 + `registerAndEnqueue`; worker genera variantes/blurhash reales; requiere infra | ✓ |
| Filas media pre-horneadas | Insertar filas con keys/variantes/blurhash precomputados, offline y determinista | |
| Híbrido por entorno | Pre-horneado por defecto + flag opcional para pipeline real | |

**User's choice:** Pipeline real R2+worker
**Notes:** Ejercita el camino end-to-end (ya factoreado en Phase 2 para el seed). ⚠ Tensión de idempotencia con `randomUUID` de `registerAndEnqueue` capturada en CONTEXT.

### Comportamiento sin infra (R2/worker ausentes)

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast claro | Valida prerequisitos al arrancar la fase de media y aborta con error explicativo | ✓ |
| Seed sin media + aviso | Siembra el resto y saltea galerías/media con warning | |
| Decidí vos | Comportamiento a criterio del builder | |

**User's choice:** Fail-fast claro
**Notes:** La media es parte del seed demo-grade, no opcional; coherente con "errores observables, nunca silenciados". Doc del comando lista prerequisitos.

---

## Pricing y CAC

### Estructura de pricing y financiación

| Option | Description | Selected |
|--------|-------------|----------|
| Contado + Financiado c/CAC | Dos price_lists (contado USD c/descuento + financiado USD lista), ~USD 2.500-3.500/m2 ajustado, anticipo ~30% + cuotas CAC + refuerzos, cac_index 12-24 meses | ✓ |
| Una lista USD simple | Un price_list, un payment_plan básico, cac_index mínimo | |
| Decidí vos | Esquema creíble a criterio del builder | |

**User's choice:** Contado + Financiado c/CAC
**Notes:** El cotizador de Fase 3 consumirá esta data; dinero en enteros USD / decimal.

---

## Leads/events de muestra

### Historia de la actividad

| Option | Description | Selected |
|--------|-------------|----------|
| Narrativa realista variada | ~10-20 leads en distintos estados con timeline, vía broker/directos, distintos orígenes; events distribuidos 2-3 meses cruzando particiones | ✓ |
| Mínimo funcional | Unos pocos leads/events sueltos para que las tablas no estén vacías | |
| Decidí vos | Set de actividad creíble a criterio del builder | |

**User's choice:** Narrativa realista variada
**Notes:** Alimenta panel, métricas y las futuras alertas de interés (diferencial del producto); events cruzan límites de partición mensual para ejercitar el particionado de Phase 1.

---

## Claude's Discretion

- Mecanismo de idempotencia del seed (UUIDs determinísticos vs upsert por clave natural vs pre-check + skip).
- Resolución de la tensión `registerAndEnqueue` (`randomUUID`) vs idempotencia de media.
- Estructura/ubicación del script y exposición de `pnpm db:seed`; owner pool para bootstrap vs `withTenant` para escrituras RLS.
- Cómo se empaquetan/obtienen los bytes de las imágenes de stock + PutObject directo a R2.

## Deferred Ideas

- Material real de Pablo (Branch B) — post-reunión, sin re-seed estructural.
- Motor de cotización (`packages/quoting`) + forma interna de `quotes.snapshot` — próximo milestone.
- Superficies de producto (panel/web/explorador/ficha/métricas/alertas) — fases futuras.
- Scraping automático del CAC — carga manual primero.
- Alcance multi-tenant del seed (segundo org / proyecto `borrador` para published-only) — considerado, opcional para el planner.
