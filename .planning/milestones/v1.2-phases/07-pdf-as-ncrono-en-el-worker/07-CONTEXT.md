# Phase 7: PDF asíncrono en el worker - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

El comprador descarga el PDF de su cotización: al accionar el botón (hoy placeholder "Descargar PDF · Próximamente" de fase 6), `quotes.create` persiste/reusa el snapshot y encola un job BullMQ; el worker renderiza el PDF **desde el snapshot congelado** (vía `toPdfModel`, nunca recompute), lo sube a R2 con la key determinista `quotes/{org}/{project}/{quoteId}.pdf` y escribe `quotes.pdfKey`; la UI hace polling y auto-descarga vía presigned GET. Idempotente por `quoteId` (retry nunca duplica), acentos españoles correctos en el worker Alpine (fuente embebida, sin Chromium), leyenda "cotización no vinculante" + leyenda de ajuste CAC en el documento (PDF-01/02/03). Incluye: el enqueue en `quotes.create` (cableado diferido por D-13 fase 5), el processor del worker sobre `QUOTE_PDF_QUEUE`, el endpoint de status/presigned-GET, y el wiring real del botón + estados de espera/fallo en la UI de fase 6.

Fuera de esta fase: regeneración/re-render de PDFs ya emitidos (congelados para siempre), comparación contado-vs-financiado dentro del PDF (el snapshot congela una sola modalidad), branding por tenant del documento, envío del PDF por email/WhatsApp server-side, creación de leads.

</domain>

<decisions>
## Implementation Decisions

### Flujo de emisión y descarga
- **D-01 Reuso de quoteId:** WhatsApp y PDF comparten la misma cotización emitida. El primer trigger (cualquiera de los dos) llama `quotes.create` y la UI retiene el `quoteId`; el segundo trigger lo reusa. Cambiar unidad/plan/modalidad invalida el `quoteId` retenido y el próximo trigger emite uno nuevo. Consecuencia aceptada: el `quoteId` vive en estado del cliente — recargar la página implica que el próximo trigger emite una cotización nueva (con su propio PDF).
- **D-02 Enqueue en cada create:** toda cotización emitida encola su job de PDF dentro de `quotes.create` (el cableado que D-13 de fase 5 dejó pendiente), sea cual sea el trigger. Si el comprador tocó WhatsApp primero, al pedir el PDF probablemente ya esté listo → descarga casi instantánea. Costo marginal aceptado (KBs en R2 por cotización).
- **D-03 Espera con polling + auto-descarga:** al tocar el botón, pasa a "Generando PDF…" y la UI pollea un endpoint de status hasta que `pdfKey` exista; al estar listo dispara la descarga automáticamente. Fallback a botón "Descargar" si el navegador (mobile) bloquea la descarga automática — Claude define el mecanismo exacto.
- **D-04 Entrega por presigned GET:** el endpoint de status devuelve una URL firmada de corta vida sobre R2 cuando el PDF existe; el navegador descarga directo de R2, cero bytes por el server Next. Análogo al `presignPut` de media existente (`packages/api/src/media/runtime.ts`); TTL exacto a discreción de Claude (corto, re-pedible).

### Contenido y diseño del documento
- **D-05 Solo la modalidad emitida:** el PDF refleja exactamente el snapshot persistido (una modalidad — la que el comprador emitió), mismas cifras que pantalla y WhatsApp. Sin comparación contado-vs-financiado: eso habría exigido ampliar el shape del snapshot de fase 5 y se descartó.
- **D-06 Estética neutra minimalista:** documento sobrio, sin branding fuerte — elección deliberada del usuario CONTRA la recomendación de versión-print de la marca. Sin fondos oscuros ni acento cobre; tipografía legible embebida (obligatoria igual por los acentos es-AR, PDF-02). El branding por tenant llega en fases posteriores del maestro.
- **D-07 Encabezado completo:** proyecto, unidad (identificador, piso, tipología, m²), fecha de emisión, período CAC usado y una referencia corta de la cotización (trazable contra `quotes` en el panel). Las cifras salen del snapshot; si los descriptores de unidad/proyecto no están en el snapshot, el worker puede leerlos vía `withTenant` (los montos NUNCA — esos son solo-snapshot).
- **D-08 Deep-link + QR:** el pie incluye la URL compartible del cotizador (la misma de fase 6, `?u=&plan=`) como texto clickeable MÁS un código QR (útil impreso en showroom físico). Acepta la dependencia de generación de QR en el worker (lib a elección del research). Refuerza el "no vinculante": el PDF es una foto, el link es lo vivo.
- **D-09 Leyendas legales (PDF-03):** leyenda "cotización no vinculante" + leyenda de ajuste CAC visibles en el documento — llegan en `PdfModel.leyendas` (derivadas de `payment_plans.notasLegales` congeladas en el snapshot).

### Fallos y regeneración
- **D-10 Fallo visible suave:** si el polling se agota (~30-45s) o el job falló, el comprador ve un mensaje es-AR voseo ("No pudimos generar el PDF, probá de nuevo en un rato") y el botón vuelve a estado inicial para reintentar. El CTA WhatsApp queda siempre visible como camino vivo — el PDF nunca es el path crítico de la demo. Backend: fallo final tras los 5 retries → Sentry + pino (patrón `reportMediaFailure`).
- **D-11 PDF congelado para siempre:** si `quotes.pdfKey` ya está seteado, el job corta en seco (short-circuit) y el endpoint de status devuelve el existente al instante. Nunca se re-renderiza: el PDF es la foto auditable de la emisión, coherente con el snapshot inmutable. Cambios de template/copy solo afectan cotizaciones nuevas.

### Claude's Discretion
- Librería de render de PDF (candidata: @react-pdf/renderer — sin Chromium; STATE.md ya anota que react-pdf en Alpine exige fuente embebida) y la fuente exacta a embeber — lo confirma el research contra el constraint Alpine + acentos.
- Lib de generación de QR y su integración en el render.
- Mecánica exacta del reuso de quoteId en el cliente (dónde vive el estado, cómo se invalida) y el shape del endpoint de status (procedure tRPC bajo `quotes.*` — hereda el rate-limit nginx del path dedicado — vs route handler; nombres).
- Intervalo/timeout exactos del polling y TTL del presigned GET.
- Cómo obtiene el worker los descriptores de unidad/proyecto para el encabezado (extender inputs del snapshot en create vs read `withTenant` en el worker) — respetando que los montos son solo-snapshot.
- Detalle del short-circuit de idempotencia (chequeo de `pdfKey` al inicio del processor + HeadObject opcional) y semántica de re-enqueue de un job fallido con el mismo `jobId` en BullMQ.
- Layout exacto del documento (una página target), copy es-AR final.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec de producto y requirements
- `docs/modelo-mvp.md` §3.4 — spec del cotizador: PDF server-side desde snapshot, leyenda legal
- `.planning/REQUIREMENTS.md` — PDF-01/02/03 + Out of Scope (nunca proyectar CAC, snapshot = auditoría no garantía)
- `.planning/ROADMAP.md` — Phase 7 goal + 3 success criteria verificables

### Contratos de fases anteriores (consumidor directo)
- `packages/storage/src/quote-pdf.ts` — el contrato de queue YA CODEADO (D-13 fase 5): `QUOTE_PDF_QUEUE`, `QuotePdfJobData` ({quoteId, organizationId, projectId}), `quotePdfJobOptions` (jobId=quoteId dedup, attempts 5, backoff exponencial 2000ms). El producer y el consumer de esta fase lo consumen tal cual — no redefinir.
- `packages/storage/src/keys.ts` — `quotePdfKey(orgId, projectId, quoteId)`: key determinista, retry sobreescribe el MISMO objeto (PDF-02)
- `packages/quoting/src/serialize.ts` + `packages/quoting/src/types.ts` — `toPdfModel(result)` y el tipo `PdfModel` ({modalidad, lineas[{label,valor}], leyendas[]}): strings ya formateados es-AR, el worker es dueño del layout, jamás re-formatea números
- `packages/api/src/trpc/routers/quotes.ts` — `quotes.create` (devuelve `{quoteId, result}`) donde se cablea el enqueue; el errorFormatter y `resolveAndQuote` existentes
- `packages/db/src/schema/quotes.ts` — `pdfKey: text("pdf_key")` ya existe en el schema (sin migración prevista); `quoteInsertSchema`
- `.planning/phases/05-emisi-n-y-persistencia-server-side-api-rls-rate-limit/05-CONTEXT.md` — D-01/D-02 (compute efímero vs create persistente), D-04 (snapshot PII-free), D-13 (contrato queue)
- `.planning/phases/06-ui-p-blica-del-cotizador-cta-whatsapp/06-CONTEXT.md` — D-05/D-06 (ciclo compute/create, el botón PDF como segundo trigger de create), D-12 (placeholder del botón)
- `.planning/phases/04-motor-de-cotizaci-n-puro-packages-quoting/04-CONTEXT.md` — D-12/D-13 del motor (serializers puros, copy ajustable sin bump de ENGINE_VERSION)

### Seams y patrones existentes (a clonar)
- `apps/worker/src/media.ts` — el patrón processor: render CPU-puro separado de seams de I/O, download-once, single-write `withTenant`, Sentry + pino en fallo final (`reportMediaFailure` en `media-failure.test.ts` / boot)
- `apps/worker/src/index.ts` — boot del worker: `createConnection` (maxRetriesPerRequest null), createXWorker por queue, registro del handler `failed` — el `createQuotePdfWorker` nuevo se suma acá
- `packages/api/src/media/runtime.ts` — el patrón producer: Queue lazy cacheada + `getSignedUrl` (presignPut → el presigned GET es análogo) + enqueue con jobOptions del contrato
- `apps/web/components/cotizador-simulator.tsx` — línea ~304: el placeholder "Descargar PDF · Próximamente" a reemplazar por el wiring real; ahí vive el estado del cliente (quoteId retenido, polling, estados generando/fallo)
- `deploy/nginx/staging.tours.andescode.com.ar.conf` — el `location ^~ /api/trpc/quotes` con rate-limit: si el endpoint de status va bajo `quotes.*`, el polling queda dentro del throttle (dimensionar intervalo de polling vs 10r/s burst 20)
- `apps/worker/src/env.ts` — env tipado del worker (R2_* ya presentes por el pipeline de media)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Contrato completo de queue PDF ya codeado en fase 5 (`QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`, `quotePdfKey`) — esta fase solo lo consume de ambos lados.
- `toPdfModel` + `PdfModel` (fase 4): data pre-formateada es-AR con leyendas incluidas — el worker solo maqueta.
- `quotes.pdfKey` ya existe en el schema — sin migración prevista.
- Pipeline de media del worker: patrón completo de processor idempotente con R2 + `withTenant` + observabilidad, directamente clonable.
- `makeR2Client` compartido + patrón presign en `packages/api` (`getSignedUrl` ya en deps).
- Snapshot persistido de fase 5: `{version, inputs (con cacPeriodo), result, ENGINE_VERSION}` — la única fuente de montos del PDF.

### Established Patterns
- Idempotencia por diseño: jobId determinista (dedup BullMQ) + key R2 determinista (overwrite) + short-circuit si el resultado ya está persistido — mismo triple del pipeline de media.
- El worker recibe `organizationId` en el payload y abre `withTenant` (no tiene sesión) — igual que `MediaJobData`.
- Fence T-03-09: routers/worker importan solo `withTenant`/`withAnon`/`schema` de `@imbau/db`.
- Errores observables: fallo final del job → Sentry + pino estructurado, nunca silenciado.
- UI es-AR voseo; la UI de quotes tolera 429 (link dedicado nginx-throttleado).

### Integration Points
- `quotes.create` gana el enqueue (producer) — único cambio en `packages/api` junto al endpoint de status/presigned-GET.
- `apps/worker/src/index.ts` suma `createQuotePdfWorker` al boot existente.
- `cotizador-simulator.tsx` reemplaza el placeholder por el flujo real (create/reuso → polling → auto-descarga → estados de fallo).
- Staging: la UAT de descarga end-to-end depende de que la imagen web/worker post-fase-7 llegue al VPS (mergear PR a main).

</code_context>

<specifics>
## Specific Ideas

- **Neutro minimalista es una elección deliberada del usuario CONTRA la recomendación** (marca en versión print) — no "subir" el nivel visual del PDF en planning; documento sobrio. Contrasta conscientemente con el "demo wow" de la pantalla (D-11 fase 6): el wow vive en la web, el PDF es el papel serio.
- **Link + QR elegido por el caso de uso físico** (PDF impreso en showroom) — el QR no es decorativo, apunta al deep-link vivo del cotizador.
- El PDF nunca es el path crítico de la demo (pantalla + WhatsApp lo son) — todo fallo degrada suave sin bloquear nada.

</specifics>

<deferred>
## Deferred Ideas

- **Comparación contado vs financiado dentro del PDF** — exigiría congelar ambas corridas en el snapshot (cambio al contrato de fase 5); reevaluar si el design partner lo pide.
- **Branding por tenant del PDF** (logo/colores del proyecto) — llega con `projects.branding` en fases posteriores del maestro.
- **Envío del PDF por email o WhatsApp server-side** — hoy la entrega es descarga directa; un envío requiere capturar contacto (leads, fase 4-5 del maestro).
- **Regeneración de PDFs ante cambios de template** — descartada por semántica de foto auditable; si alguna vez hace falta, la key determinista + re-enqueue manual lo permiten técnicamente.

</deferred>

---

*Phase: 7 - PDF asíncrono en el worker*
*Context gathered: 2026-07-05*
