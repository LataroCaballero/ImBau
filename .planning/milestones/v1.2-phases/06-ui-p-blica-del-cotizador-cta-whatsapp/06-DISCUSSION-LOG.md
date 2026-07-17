# Phase 6: UI pública del cotizador + CTA WhatsApp - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 6 - UI pública del cotizador + CTA WhatsApp
**Areas discussed:** Número de WhatsApp, Ajuste interactivo (UI-04), Flujo y URLs de página, Base de estilos

---

## Número de WhatsApp

| Option | Description | Selected |
|--------|-------------|----------|
| Migración projects.whatsapp | Columna nullable via Drizzle + seed actualizado; número default del proyecto, broker routing lo overridea (fase 5 maestro) | ✓ |
| Reusar brokers.whatsapp | Sin schema change, pero mezcla semántica y adelanta routing de otra fase | |
| Guardarlo en branding/textos JSONB | Evita migración pero sin tipado fuerte | |

| Option | Description | Selected |
|--------|-------------|----------|
| Ocultar el CTA | Sin número → el botón no se renderiza; cero estados muertos | ✓ |
| CTA deshabilitado con mensaje | Botón gris con "Contacto no disponible" | |
| Vos decidís | Claude decide en planning | |

| Option | Description | Selected |
|--------|-------------|----------|
| Encabezado + resumen + deep-link | Unidad+proyecto + toWhatsAppText(result) + URL compartible del cotizador | ✓ |
| Solo encabezado + resumen | Sin URL; el vendedor no puede reabrir la cotización | |
| Vos decidís | Claude define la composición | |

**User's choice:** Migración `projects.whatsapp`; CTA oculto sin número; mensaje = encabezado + resumen + deep-link.
**Notes:** modelo-mvp §3.3 no tiene WhatsApp a nivel proyecto — la migración extiende el schema deliberadamente.

---

## Ajuste interactivo (UI-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Chips/cards de planes | Cada plan preset como chip seleccionable; honesto con planes discretos | ✓ (revertido después) |
| Sliders que ajustan al preset | Sliders con snap al plan más cercano; sensación simulador | (adoptado al final vía mockup) |
| Dropdown simple de planes | Select clásico, mínimo esfuerzo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Recompute inmediato al tocar | Cada tap dispara compute; ante 429 mensaje suave + reintento | ✓ |
| Botón "Cotizar" explícito | Menos requests, más fricción | |
| Vos decidís | Claude elige según el flujo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Solo al tocar WhatsApp | El CTA llama create, persiste y abre wa.me; fase 7 suma el botón PDF | ✓ |
| Create al ver el resultado | Persiste cada resultado; contradice D-01 fase 5 (write-amplifier) | |
| Vos decidís | Claude respeta D-01/D-02 fase 5 | |

**User's choice:** Recompute inmediato; create solo al accionar WhatsApp. El control pasó de chips a **sliders con snap a presets** al reconciliar con el mockup (ver Base de estilos).
**Notes:** El API de fase 5 solo acepta `paymentPlanId` — el ajuste siempre es entre presets, cualquiera sea el control.

---

## Flujo y URLs de página

| Option | Description | Selected |
|--------|-------------|----------|
| /p/[slug]/cotizador?u=…&plan=… | Ruta bajo el proyecto; deep-link con selección en params; jerarquía lista para fase 2 | ✓ |
| /cotizador?proyecto=…&u=… | Ruta global única; URLs menos legibles | |
| Vos decidís | Claude define pensando en el explorador futuro | |

| Option | Description | Selected |
|--------|-------------|----------|
| Dos pasos: piso → unidad | Piso primero, después unidades con tipología/m2/ambientes; solo disponibles cotizables | ✓ |
| Lista única agrupada | Una pantalla scrolleable; larga con 38 unidades | |
| Vos decidís | Claude elige mobile-first | |

| Option | Description | Selected |
|--------|-------------|----------|
| Dos cards apiladas + resumen | Contado y Financiado apiladas (lado a lado en desktop) + banda compareQuotes | ✓ |
| Tabs contado/financiado | Compacto pero nunca se ven juntas | |
| Financiado protagonista + contado secundario | Jerarquiza pero el contado pierde detalle | |

**User's choice:** Ruta por proyecto con query params; picker dos pasos; comparación en cards apiladas.
**Notes:** —

---

## Base de estilos

| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind CSS v4 | CSS atómico purgado, config CSS-first, packages/ui exporta base estilada | ✓ |
| CSS Modules + tokens propios | Sin dependencia nueva, más lento de iterar | |
| Vos decidís | Claude elige por budget y velocidad | |

| Option | Description | Selected |
|--------|-------------|----------|
| Base neutra prolija (Recomendado) | Sistema mínimo profesional; theming por tenant después | |
| Demo wow desde ya | Look distintivo ahora; consume ventana Fable en pulido | ✓ |
| Lo mínimo funcional | HTML apenas estilado | |

| Option | Description | Selected |
|--------|-------------|----------|
| Premium inmobiliario oscuro | Boutique dark + acentos dorados | |
| Fintech claro y vivo | Simulador financiero claro con micro-animaciones | |
| Editorial minimalista | Blanco, serif display, aireado | |
| Other (free text) | "Tiene que seguir el diseño de marca que te lo dejo en /docs, hay un mockup y también una carpeta de marca con todo lo necesario" | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Marca manda, mockup referencia (Recomendado) | tokens.css + brand-book fuente de verdad; conflictos los ganan las decisiones | |
| Seguir el mockup literal | Reproducir la pantalla del cotizador tal cual | ✓ |
| Vos decidís | Claude resuelve punto por punto | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sí: visual literal + sliders con snap | Fidelidad visual total (dark, cobre, wa-preview) + sliders snap a presets; lead/broker-list fuera | ✓ |
| Visual literal, pero mantengo chips | Estética del mockup con chips | |
| Literal en todo, incluso alcance | Lead + broker selector ya (cambiaría requirements bloqueados) | |

**User's choice:** Tailwind v4; demo wow siguiendo la marca ImBau (`docs/marca/`) y el mockup (`docs/mockup.html`) de forma visualmente literal, con sliders-snap; alcance v1.2 intacto.
**Notes:** "Demo wow" fue elección deliberada contra la recomendación de base neutra. La aclaración de "literal" excluyó explícitamente lead-por-cotización y selector de broker (scope bloqueado de otras fases).

## Claude's Discretion

- Arquitectura de data fetching (RSC + client component; TanStack Query v5) con link httpBatchLink dedicado para quotes.
- Plan preseleccionado por defecto, estados de carga, manejo de errores tipados (quoteErrorCode).
- Forma y nombres de los reads públicos anon nuevos del picker.
- Mapping tokens.css → Tailwind theme; reparto de componentes entre packages/ui y apps/web.
- Mecánica exacta del snap de sliders (N planes → posiciones discretas; caso de plan único).
- Copy es-AR final (voseo).

## Deferred Ideas

- Lead por cotización (mockup) — Out of Scope v1.2; bandeja de leads = fase 4 maestro, flujo de contacto = fase 5 maestro.
- Selector de lista de precios de broker (mockup) — fase 5 maestro (broker links P8).
- Botón "Descargar PDF" funcional — fase 7 (placeholder permitido en esta fase).
- Theming por tenant (projects.branding) — fase 5 maestro (portada/galería).
