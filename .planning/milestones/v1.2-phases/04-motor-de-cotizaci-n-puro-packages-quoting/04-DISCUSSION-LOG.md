# Phase 4: Motor de cotización puro (`packages/quoting`) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 4-Motor de cotización puro (`packages/quoting`)
**Areas discussed:** Regla de redondeo y resto, Semántica de refuerzos, Descuento contado en QuoteInput, Alcance del paquete

---

## Regla de redondeo y resto

**Q1 — Granularidad de los montos USD del plan:**

| Option | Description | Selected |
|--------|-------------|----------|
| USD enteros (Recomendado) | Anticipo y cuota-parte USD a dólar entero; reconciliación exacta en enteros | ✓ |
| USD con centavos | Decimal con 2 decimales; totales cierran al centavo literal | |
| Mixto | Anticipo/refuerzos enteros, cuota-parte interna con centavos | |

**Q2 — Quién absorbe el resto de saldo ÷ N:**

| Option | Description | Selected |
|--------|-------------|----------|
| Primeras k cuotas +1 (Recomendado) | Base floor; primeras k cuotas llevan US$ 1 más (regla del research) | |
| Última cuota ajusta | N−1 cuotas iguales; la última absorbe la diferencia (estilo bancario) | ✓ |
| Primera cuota ajusta | La primera absorbe todo el resto | |

**Q3 — Cálculo de la cuota base con 'última ajusta':**

| Option | Description | Selected |
|--------|-------------|----------|
| floor — última ≥ base (Recomendado) | Base = floor(saldo/N); la última siempre igual o mayor | ✓ |
| round — última compensa | Base = round half-up; la última puede quedar menor | |

**Q4 — Redondeo de la cuota ARS "al valor del mes":**

| Option | Description | Selected |
|--------|-------------|----------|
| Peso entero, half-up (Recomendado) | Cuota ARS redondeada a peso entero en QuoteResult | |
| ARS con 2 decimales | Decimal exacto a 2 decimales (regla "ARS decimal" de CLAUDE.md) | ✓ |
| Ambos en el resultado | Exacto + redondeado, superficies muestran el redondeado | |

**Notes:** El usuario eligió dos veces contra la recomendación (resto a la última cuota; ARS con decimales) — preferencia por la práctica bancaria clásica y por la fidelidad del cálculo. El redondeo del anticipo (half-up a dólar entero, saldo compensa) quedó a discreción de Claude.

---

## Semántica de refuerzos

**Q1 — Moneda de pago de los refuerzos:**

| Option | Description | Selected |
|--------|-------------|----------|
| USD fijo (Recomendado) | Se pagan en dólares tal cual el plan (montoUsd), sin ajuste CAC | ✓ |
| Ajustados por CAC | Expresados en unidades CAC al boleto, pagados "al valor del mes" | |

**Q2 — Comportamiento ante planes degenerados:**

| Option | Description | Selected |
|--------|-------------|----------|
| Rechaza con error tipado (Recomendado) | Error de dominio explícito (SALDO_NO_POSITIVO, REFUERZO_FUERA_DE_PLAZO) | ✓ |
| Tolera lo tolerable | Normaliza casos recuperables, rechaza solo lo imposible | |

**Notes:** La posición de los refuerzos en el cálculo (descuentan del saldo antes de dividir) ya venía fijada por el invariante de ENGINE-04; la forma en el resultado (índice + monto USD, sin fechas) por UI-02.

---

## Descuento contado en QuoteInput

**Q1 — Cómo entra el precio contado al motor:**

| Option | Description | Selected |
|--------|-------------|----------|
| Dos precios resueltos (Recomendado) | precioContado + precioFinanciado ya resueltos (uno por lista); cero pricing en el motor | ✓ |
| Precio base + % descuento | El motor computa el contado; requeriría campo de descuento que el schema no tiene | |

**Q2 — Forma de QuoteResult:**

| Option | Description | Selected |
|--------|-------------|----------|
| Ambas en un QuoteResult (Recomendado) | { contado, financiado } en una sola estructura | |
| Un resultado por modalidad | calcQuote por corrida; la comparación son dos corridas | ✓ |

**Q3 — Cifras derivadas de la comparación (ahorro USD/%):**

| Option | Description | Selected |
|--------|-------------|----------|
| Helper puro del motor (Recomendado) | compareQuotes(contado, financiado) tipado y 100% cubierto | ✓ |
| Lo computa cada superficie | La UI resta y calcula; fuera del perímetro testeado | |
| No se muestra ahorro | Comparación solo visual, sin cifra | |

**Notes:** "Un resultado por modalidad" fue elección deliberada contra la recomendación; se mitiga el riesgo de drift con compareQuotes como único cómputo derivado. Tipado como unión discriminada por modalidad quedó a discreción de Claude.

---

## Alcance del paquete

**Q1 — Qué entrega esta fase:**

| Option | Description | Selected |
|--------|-------------|----------|
| Motor completo (Recomendado) | calcQuote + compareQuotes + toWhatsAppText + toPdfModel + formateador es-AR | ✓ |
| Solo el núcleo de cálculo | Serializers y formateador llegan con su superficie (fases 6/7) | |
| Núcleo + formateador | Serializers esperan; formateador entra ahora | |

**Q2 — Política de bump de ENGINE_VERSION:**

| Option | Description | Selected |
|--------|-------------|----------|
| Solo cambios de cálculo (Recomendado) | Fórmula/redondeo/regla de resto bumpean; copy no | ✓ |
| Cualquier cambio del paquete | Todo cambio observable bumpea | |
| Dos versiones | ENGINE_VERSION + versión de serializers separada | |

**Notes:** El cierre del área lo respondió con "1" (texto libre), interpretado como la primera opción ("Listo, cerrar discusión").

## Claude's Discretion

- Redondeo del anticipo: half-up a dólar entero, saldo compensa.
- Tipado de QuoteResult: unión discriminada por `modalidad`.
- Formato de ENGINE_VERSION: entero incremental desde 1.
- Modelo de error tipado (códigos/clase/Result), nombres de API, estructura interna, generadores fast-check.
- Copy inicial de toWhatsAppText y forma del modelo toPdfModel (borradores; se validan en fases 6/7).

## Deferred Ideas

None — la discusión se mantuvo dentro del alcance de la fase.
