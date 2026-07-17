# Phase 6: UI pública del cotizador + CTA WhatsApp - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

La primera UI pública real de `apps/web`: un comprador llega a una unidad publicada sin el explorador (deep-link compartible + picker piso→unidad sobre unidades publicadas vía rol anon), cotiza en el celular contra `quotes.compute` (fase 5), ve el resultado completo mobile-first (contado vs financiado, anticipo USD+%, cuotas, primera cuota ARS "al valor del mes", refuerzos, totales, leyenda de ajuste CAC + no vinculante) y toca "Consultar por WhatsApp" — que dispara `quotes.create` (persistencia del snapshot) y abre wa.me con el resumen precargado. Todo derivado del mismo `QuoteResult` con el formateador es-AR compartido (UI-01..06, WA-01). Incluye: la fundación de estilos de la web pública (Tailwind v4 + tokens de marca), el cliente tRPC que `apps/web` estrena (link dedicado para quotes), los reads públicos anon nuevos que el picker necesita (pisos/unidades/planes del proyecto publicado), y una migración chica (`projects.whatsapp`).

Fuera de esta fase: PDF y su botón de descarga real (fase 7 — el CTA de PDF puede existir deshabilitado/placeholder si el mockup lo pide, sin wiring), creación de leads (Out of Scope v1.2), routing por broker `/b/<slug>` (fase 5 maestro), explorador/ficha de unidad (fase 2 maestro), theming por tenant desde `projects.branding` (fases posteriores).

</domain>

<decisions>
## Implementation Decisions

### Número de WhatsApp (WA-01)
- **D-01 Fuente del número:** migración Drizzle nueva que agrega `whatsapp` (text, nullable) a `projects` + seed "Brigos Recoleta" actualizado para cargarlo. Es el número default del proyecto; el routing por broker (fase 5 maestro) lo overridea después — exactamente el "slot listo para routing" de WA-01. Nota: modelo-mvp §3.3 no lista este campo en projects (solo en brokers) — la migración extiende el schema deliberadamente; el panel lo editará en fase 4 maestro.
- **D-02 Sin número cargado:** el CTA WhatsApp directamente NO se renderiza (nada de botones muertos). El seed siempre carga número, así que demo/staging nunca muestran la ausencia.
- **D-03 Composición del mensaje:** encabezado con unidad + proyecto ("Hola! Me interesa la unidad 4°B de Brigos Recoleta") + `toWhatsAppText(result)` (resumen de montos, fase 4) + la URL del deep-link compartible del cotizador (misma URL de UI-01, con unidad+plan en params). URL-encoded completo. El copy exacto es ajustable sin bump de `ENGINE_VERSION` (D-13 fase 4).

### Ajuste interactivo (UI-04) y ciclo compute/create
- **D-04 Control de ajuste: sliders con snap a presets.** Sliders de anticipo/plazo al estilo del mockup (`docs/mockup.html` §cotizador), pero que SOLO pueden caer en los planes preset autorizados del developer — el thumb encaja (snap) en los valores de los `payment_plans` existentes; nunca términos libres (el API solo acepta `paymentPlanId`, y "anticipo/plazo libres" es Out of Scope). Decisión revisada durante la discusión: primero se eligieron chips, luego el usuario optó por fidelidad literal al mockup con snap. Si el proyecto tiene un solo plan, el slider degenera a estado fijo — no inventar planes.
- **D-05 Recompute inmediato:** cada cambio de selección (unidad, plan/snap, modalidad) dispara `quotes.compute` (efímero, sin persistencia) y la pantalla se actualiza en vivo, estilo simulador. Con presets discretos el volumen de requests es bajo frente al rate limit (10r/s + burst 20). Ante 429: mensaje suave es-AR + reintento — la UI DEBE tolerarlo (nota fase 5).
- **D-06 Emisión (persistencia):** `quotes.create` se dispara ÚNICAMENTE al tocar el CTA WhatsApp (persiste snapshot → abre wa.me). Navegar/recomputar jamás persiste (D-01/D-02 fase 5, anti write-amplifier). En fase 7 el botón de PDF será el segundo trigger de create.

### Flujo y URLs de página (UI-01)
- **D-07 Estructura de rutas:** `/p/[slug]/cotizador` con la selección en query params (`?u=<unitId>&plan=<planId>`). Con params = deep-link directo al resultado; sin params = abre el picker. La jerarquía `/p/[slug]/*` queda lista para el explorador (fase 2 maestro). El deep-link es la misma URL que viaja en el mensaje de WhatsApp (D-03).
- **D-08 Picker en dos pasos:** primero piso (lista/grilla de los 13), después las unidades de ese piso con tipología/m²/ambientes. Solo las unidades `disponible` son cotizables (los estados semánticos de marca — disponible/reservado/vendido — existen en tokens.css). Necesita reads públicos anon nuevos (floors/units/payment_plans del proyecto publicado), clonando el patrón `listPublished` + withAnon.
- **D-09 Comparación contado vs financiado:** dos cards apiladas en mobile ("Contado" y "Financiado", dos corridas del motor) que en desktop se ponen lado a lado, con las cifras de `compareQuotes` (ahorro USD y %) como banda de resumen. Todo visible sin interacción — la comparación es el punch de la demo.

### Base de estilos (primera UI pública)
- **D-10 Stack:** Tailwind CSS v4 (config CSS-first via `@import`/`@theme`, sin tailwind.config). Los design tokens de `docs/marca/tokens.css` son la fuente de verdad y se mapean al theme de Tailwind; `packages/ui` deja de ser placeholder y exporta la base estilada consumible por web (y panel después).
- **D-11 Nivel visual: demo wow desde ya.** Elección deliberada del usuario CONTRA la recomendación de base neutra — el cotizador es el diferencial #1 y la primera impresión de la web pública cuenta. El look sigue la marca ImBau: dark-first grafito `#14181E`, superficies carbón, acento cobre (nunca fondo), Space Grotesk para display, Inter para UI, JetBrains Mono para TODAS las cifras financieras, motion sutil 200-800ms con `prefers-reduced-motion` (ver `docs/marca/brand-book.md`).
- **D-12 Mockup literal (visual):** la pantalla del cotizador replica `docs/mockup.html` §s-cotizador en layout y sensación — incluido el **wa-preview** (preview del mensaje de WhatsApp visible antes de enviar) y el botón de PDF (que en esta fase queda como placeholder no funcional o oculto — el wiring es fase 7). El alcance NO es literal: lead-por-cotización y selector de lista de broker del mockup quedan explícitamente fuera (ver Deferred).
- **D-13 Performance sigue siendo constraint:** presupuesto <3s en 4G en gama media aplica desde esta fase (primera web pública). Fuentes vía `next/font` (self-hosted, sin FOUT pesado), Tailwind purgado, motion barato (transform/opacity). El "wow" no puede costar el budget.

### Claude's Discretion
- Arquitectura de data fetching (RSC para picker/datos estáticos + client component para el simulador interactivo; TanStack Query v5 + `@trpc/tanstack-react-query`) — respetando el link httpBatchLink DEDICADO para `/api/trpc/quotes` (nota STATE.md: si se co-batchea con otros procedures el nginx no los throttlea).
- Plan preseleccionado al aterrizar sin `?plan=`, estados de carga/skeleton, manejo fino de errores tRPC tipados (D-08 fase 5: `quoteErrorCode`).
- Forma exacta de los reads públicos nuevos (procedures tRPC vs RSC con withAnon directo) y sus nombres.
- Mapping exacto tokens.css → Tailwind theme, estructura de componentes en `packages/ui` vs `apps/web`.
- Detalles del snap de sliders (cómo se mapean N planes a posiciones discretas; qué pasa con 1 solo plan).
- Copy es-AR final (voseo) de labels, leyendas de error y estados vacíos.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Marca y diseño (referenciados por el usuario — obligatorios para la UI)
- `docs/mockup.html` — mockup del producto completo; la sección `#s-cotizador` es la referencia visual literal de esta fase (sliders, pay-opts, quote-out, wa-preview, CTA row)
- `docs/marca/brand-book.md` — fuente de verdad de la marca: color (grafito/carbón/hormigón/cobre/blueprint), tipografía (Space Grotesk/Inter/JetBrains Mono), voz es-AR voseo, motion (grid blueprint, glow cobre, 200-800ms, prefers-reduced-motion)
- `docs/marca/tokens.css` — design tokens v1 (importar en packages/ui): paleta, semánticos disponible/reservado/vendido, escala tipográfica, radios/sombras, espaciado base 4px
- `docs/marca/logo/` — isotipo.svg, isotipo-animado.svg (loop 4s), logo-dark/light.svg, favicon.svg (reglas de uso en brand-book §Logo)

### Spec de producto y requirements
- `docs/modelo-mvp.md` §3.4 — spec del cotizador (P4) + P7 WhatsApp-first; §2.3 journey del comprador (<2 min portada→cotización)
- `.planning/REQUIREMENTS.md` — UI-01..06 + WA-01 + Out of Scope (sin proyección CAC, sin términos libres, sin tabla de amortización completa, sin lead por vista, sin policies anon sobre quotes/cac_index)
- `.planning/ROADMAP.md` — Phase 6 goal + 4 success criteria verificables

### Contratos de fases anteriores (consumidor directo)
- `.planning/phases/04-motor-de-cotizaci-n-puro-packages-quoting/04-CONTEXT.md` — decisiones del motor (QuoteResult por modalidad, cuota ARS 2 decimales, refuerzos USD fijos, compareQuotes)
- `.planning/phases/05-emisi-n-y-persistencia-server-side-api-rls-rate-limit/05-CONTEXT.md` — D-01/D-02 (compute efímero vs create persistente), D-08 (errores tipados quoteErrorCode), D-10..12 (rate limit y 429)
- `packages/quoting/src/index.ts` — barrel del contrato: `calcQuote`, `compareQuotes`, `toWhatsAppText`, `toPdfModel`, `formatUsd`/`formatArs`, tipos `QuoteResult`/`QuoteComparison`
- `packages/api/src/trpc/routers/quotes.ts` — `quotes.compute`/`quotes.create`, input `{projectId, unitId, paymentPlanId, modalidad}`, resolveAndQuote, errorFormatter

### Seams y patrones existentes
- `packages/api/src/trpc/routers/projects.ts` — patrón publicProcedure + withAnon (`listPublished`) a clonar para los reads del picker
- `apps/web/app/api/trpc/[trpc]/route.ts` + `apps/web/env.ts` — mount tRPC ya montado en fase 5 (A1/D-06) y env tipado con `DATABASE_APP_URL`
- `apps/web/app/page.tsx` — patrón RSC + createCaller + force-dynamic de la web anon
- `packages/db/src/schema/projects.ts` — tabla que recibe la columna `whatsapp` (migración nueva); `units.ts` (estado disponible/reservado/vendido, identificador, tipología, m2), `payment-plans.ts` (anticipoPct, cuotas, refuerzos, notasLegales — la leyenda de UI-05)
- `deploy/nginx/staging.tours.andescode.com.ar.conf` — rate limit `^~ /api/trpc/quotes` (la razón del link dedicado y la tolerancia a 429)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/quoting` completo: `QuoteResult`, `compareQuotes` (cifras de ahorro para la banda de comparación), `toWhatsAppText` (borrador del resumen, copy ajustable sin bump), `formatUsd`/`formatArs` (es-AR determinista server+cliente — UI-06 prácticamente resuelto).
- `quotes.compute`/`quotes.create` (fase 5): el API que la UI consume tal cual — sin cambios de API previstos; el ajuste UI-04 se expresa eligiendo `paymentPlanId` entre presets.
- Mount tRPC de web ya existente (fase 5, A1) — falta solo el CLIENTE (`@trpc/client` + `@tanstack/react-query` + `@trpc/tanstack-react-query` no están en deps de web).
- `payment_plans.notasLegales` — el texto de la leyenda UI-05 viene de DB, no hardcodeado.
- Seed "Brigos Recoleta": 13 pisos, 38 unidades, 2 listas, planes CAC con refuerzos — data real para desarrollo y demo.
- `docs/marca/tokens.css` — los tokens ya existen y dicen explícitamente "importar en packages/ui".

### Established Patterns
- Reads públicos = publicProcedure + `withAnon` (la policy anon filtra a `publicado`) — patrón `listPublished` a clonar para floors/units/plans del picker.
- Routers importan SOLO `withTenant`/`withAnon`/`schema` de `@imbau/db` (fence T-03-09, grep-verificable) — cualquier procedure nuevo lo hereda.
- Migraciones Drizzle versionadas, jamás cambios manuales; la columna nueva en `projects` (tabla RLS-forced) sigue el template RLS existente sin tocar policies.
- Env tipado fail-fast (`@t3-oss/env-nextjs`); UI es-AR voseo; commits en inglés.

### Integration Points
- `apps/web` estrena: layout con marca (fonts, dark grafito), Tailwind v4 global, cliente tRPC con DOS links (uno dedicado a quotes por el rate limit nginx, otro para el resto), ruta `/p/[slug]/cotizador`.
- `packages/ui` pasa de placeholder a base real del design system (tokens + componentes del cotizador reusables).
- Fase 7 se engancha en el botón PDF (placeholder en esta fase) y consume el `quoteId` que devuelve `create`.
- Staging corre imagen web pre-fase-5 (`a599bb7`): la ruta tRPC de quotes llega a staging al mergear PR #1 a main — la UAT de esta fase depende de ese merge.

</code_context>

<specifics>
## Specific Ideas

- **"Tiene que seguir el diseño de marca que te lo dejo en /docs"** — el usuario apuntó explícitamente a `docs/mockup.html` + `docs/marca/` como la dirección visual. La sección cotizador del mockup (sliders, botones de modalidad, quote-out, wa-preview, CTA cobre de WhatsApp) es la referencia literal de layout.
- El usuario eligió "demo wow desde ya" contra la recomendación de base neutra, y "mockup literal" contra "mockup como referencia" — la fidelidad visual es una prioridad de producto (reunión con Pablo al final de fase 2-3 del maestro con la demo wow lista). Respetar esa intención: no rebajar el nivel visual en planning.
- La reversión chips→sliders-con-snap fue explícita y consciente del constraint de presets: el snap es la forma de mantener la sensación del mockup sin violar UI-04/Out of Scope.

</specifics>

<deferred>
## Deferred Ideas

- **Lead por cotización** (el mockup dice "cada cotización queda registrada como lead") — Out of Scope explícito de v1.2; la bandeja de leads es fase 4 del maestro y el flujo de contacto (P7 formulario) fase 5 del maestro. `quotes.leadId` ya deja el slot.
- **Selector de lista de precios de broker** (mockup: "Inmobiliaria Norte (link de broker)") — broker links `/b/<slug>` son fase 5 del maestro (P8); el slot de routing queda en el mensaje WhatsApp (WA-01).
- **Botón "Descargar PDF" funcional** — fase 7 (esta fase puede mostrar el botón como placeholder deshabilitado para fidelidad al mockup, sin wiring).
- **Theming por tenant** (`projects.branding`) — la marca ImBau es el look de esta fase; el branding por proyecto llega con portada/galería (fase 5 maestro).

</deferred>

---

*Phase: 6 - UI pública del cotizador + CTA WhatsApp*
*Context gathered: 2026-07-04*
