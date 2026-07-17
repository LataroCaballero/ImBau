# Phase 7: PDF asíncrono en el worker - Research

**Researched:** 2026-07-05
**Domain:** Server-side PDF generation in a BullMQ worker (Alpine/musl, no Chromium) + async producer/poll/presigned-download flow across `apps/web` ↔ worker ↔ R2
**Confidence:** HIGH (the pipeline is a near-clone of the existing, verified media pipeline; the only genuinely new tech is the PDF+font+QR render, verified against official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Flujo de emisión y descarga**
- **D-01 Reuso de quoteId:** WhatsApp y PDF comparten la misma cotización emitida. El primer trigger (cualquiera) llama `quotes.create` y la UI retiene el `quoteId`; el segundo lo reusa. Cambiar unidad/plan/modalidad invalida el `quoteId` retenido. Recargar la página ⇒ el próximo trigger emite una cotización nueva (con su propio PDF).
- **D-02 Enqueue en cada create:** toda cotización emitida encola su job de PDF dentro de `quotes.create` (el cableado que D-13 de fase 5 dejó pendiente), sea cual sea el trigger. Costo marginal aceptado (KBs en R2 por cotización).
- **D-03 Espera con polling + auto-descarga:** al tocar el botón → "Generando PDF…", la UI pollea un endpoint de status hasta que `pdfKey` exista y dispara la descarga automáticamente. Fallback a botón "Descargar" si mobile bloquea la descarga automática — mecanismo exacto a discreción de Claude.
- **D-04 Entrega por presigned GET:** el endpoint de status devuelve una URL firmada de corta vida sobre R2; el navegador descarga directo de R2 (cero bytes por Next). Análogo al `presignPut` de media (`packages/api/src/media/runtime.ts`); TTL a discreción de Claude (corto, re-pedible).

**Contenido y diseño del documento**
- **D-05 Solo la modalidad emitida:** el PDF refleja exactamente el snapshot persistido (una modalidad). Sin comparación contado-vs-financiado.
- **D-06 Estética neutra minimalista:** documento sobrio, sin branding fuerte — elección deliberada CONTRA la recomendación de versión-print. Sin fondos oscuros ni acento cobre; tipografía legible embebida (obligatoria por acentos es-AR, PDF-02).
- **D-07 Encabezado completo:** proyecto, unidad (identificador, piso, tipología, m²), fecha de emisión, período CAC usado y una referencia corta de la cotización. Las cifras salen del snapshot; descriptores de unidad/proyecto pueden leerse vía `withTenant` — **los montos NUNCA** (solo-snapshot).
- **D-08 Deep-link + QR:** el pie incluye la URL compartible del cotizador (`?u=&plan=`) como texto clickeable MÁS un QR. Acepta la dependencia de generación de QR en el worker.
- **D-09 Leyendas legales (PDF-03):** "cotización no vinculante" + leyenda de ajuste CAC — llegan en `PdfModel.leyendas` (ya derivadas en `toPdfModel`).

**Fallos y regeneración**
- **D-10 Fallo visible suave:** polling agotado (~30-45s) o job fallido → mensaje es-AR voseo ("No pudimos generar el PDF, probá de nuevo en un rato") + botón vuelve a estado inicial. WhatsApp siempre visible. Backend: fallo final tras 5 retries → Sentry + pino (patrón `reportMediaFailure`).
- **D-11 PDF congelado para siempre:** si `quotes.pdfKey` ya está seteado, el job corta en seco (short-circuit) y el status devuelve el existente al instante. Nunca se re-renderiza.

### Claude's Discretion
- Librería de render de PDF (candidata: `@react-pdf/renderer` — sin Chromium) y la fuente exacta a embeber.
- Lib de generación de QR y su integración.
- Mecánica exacta del reuso de quoteId en el cliente y el shape del endpoint de status (procedure tRPC bajo `quotes.*` vs route handler; nombres).
- Intervalo/timeout exactos del polling y TTL del presigned GET.
- Cómo obtiene el worker los descriptores de unidad/proyecto (extender inputs del snapshot en create vs read `withTenant` en el worker) — respetando que los montos son solo-snapshot.
- Detalle del short-circuit de idempotencia (chequeo de `pdfKey` + HeadObject opcional) y semántica de re-enqueue con el mismo `jobId` en BullMQ.
- Layout exacto (una página target), copy es-AR final.

### Deferred Ideas (OUT OF SCOPE)
- Comparación contado vs financiado dentro del PDF (exigiría congelar ambas corridas en el snapshot de fase 5).
- Branding por tenant del PDF (logo/colores — llega con `projects.branding`).
- Envío del PDF por email/WhatsApp server-side (requiere capturar contacto → leads).
- Regeneración de PDFs ante cambios de template (descartada por semántica de foto auditable).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PDF-01 | Descargar PDF generado server-side en el worker (BullMQ) desde el snapshot, en R2 con key en `quotes.pdfKey` — asíncrono, nunca bloquea la pantalla | Producer (enqueue en `quotes.create`) + worker consumer (`QUOTE_PDF_QUEUE`) + status/presigned-GET procedure. Todos los seams existen y se clonan del pipeline de media (§Architecture Patterns). Contrato de queue + key ya codeados (fase 5). |
| PDF-02 | Idempotente por `quoteId` (retry BullMQ no duplica) + acentos españoles correctos en Alpine (fuente embebida, sin Chromium) | Triple idempotencia (jobId=quoteId dedup + key determinista overwrite + short-circuit `pdfKey`). `@react-pdf/renderer` es JS puro (sin Chromium); `Font.register` embebe una TTF con glyphs es-AR (§Pitfall 1, §Pitfall 2). |
| PDF-03 | Leyenda "cotización no vinculante" + leyenda de ajuste CAC | `PdfModel.leyendas` YA las trae (`toPdfModel` en `packages/quoting/src/serialize.ts` L18-19, L53) — el worker sólo las maqueta. |
</phase_requirements>

## Summary

Esta fase es, en un 80%, un **clon del pipeline de media ya verificado en producción** (fase 2). El contrato de queue (`QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`), la key determinista (`quotePdfKey`), la columna `quotes.pdfKey` y el modelo de datos del PDF (`PdfModel` vía `toPdfModel`) **ya están codeados**. Lo nuevo se reduce a tres piezas: (1) el **producer** — un enqueue lazy en `quotes.create` análogo a `enqueueMedia`; (2) el **consumer** — un processor en el worker que abre `withTenant`, lee el snapshot, renderiza un PDF y lo sube a R2 con un único write-back de `pdfKey`; (3) el **status/presigned-GET** procedure bajo `quotes.*` que la UI de fase 6 pollea y usa para auto-descargar.

La única tecnología genuinamente nueva es el render de PDF. La recomendación es **`@react-pdf/renderer` 4.5.1** con `renderToBuffer()` (API Node que devuelve un `Buffer`, sin DOM ni Chromium) — encaja perfecto con el constraint Alpine/musl de CLAUDE.md. Los acentos es-AR (PDF-02) se resuelven **embebiendo una TTF** vía `Font.register` con path absoluto: NO confíes en las fuentes estándar PDF. El QR (D-08) se genera con **`qrcode` 1.5.4** (JS puro, sin deps nativas) a un PNG data-URL embebido como `<Image>`.

**El riesgo #1 no es el código sino el empaquetado del asset de fuente:** `tsup` bundlea sólo JS — el `.ttf` NO viaja al `dist/` automáticamente, y `Font.register` con un path que no resuelve en el contenedor Alpine es el modo de fallo más común de esta librería. El plan debe copiar explícitamente la fuente a la imagen y registrarla por path absoluto resoluble en runtime.

**Segundo hallazgo estructural:** la decisión D-02 (enqueue dentro de `quotes.create`) hace que **`apps/web` gane dos dependencias de entorno nuevas** — `REDIS_URL` (para el producer BullMQ) y `R2_*` (para presignar el GET en el status procedure). Las libs (`bullmq`/`ioredis`/`@aws-sdk/*`) ya están en el árbol de `apps/web` vía `@imbau/api` (init lazy, no abren sockets al importar), pero las **env vars y su wiring en `apps/web/env.ts` + `deploy/compose.staging.yml` son nuevas** y bloquean el deploy si faltan.

**Primary recommendation:** Clonar el triángulo del pipeline de media (producer lazy en `packages/api` → contrato en `@imbau/storage` → consumer en `apps/worker`) para el PDF; usar `@react-pdf/renderer` 4.5.1 + `renderToBuffer` + una TTF embebida por path absoluto + `qrcode` 1.5.4; ampliar el env de `apps/web` con `REDIS_URL` y `R2_*`; exponer el status como `publicProcedure` bajo `quotes.*` que resuelve el org desde el `projectId` publicado (withAnon) y luego lee `pdfKey` bajo `withTenant`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Encolar el job de PDF al emitir la cotización | API / Backend (`quotes.create` en `packages/api`, corriendo en el proceso `apps/web`) | Redis/BullMQ | El enqueue es un efecto server-side del create; el worker no tiene sesión para dispararlo. Clona `enqueueMedia`. |
| Renderizar el PDF desde el snapshot | Worker (`apps/worker`, BullMQ consumer) | — | CPU-puro + I/O R2/DB; nunca bloquea la request web. Clona `processMedia`. |
| Congelar/idempotencia | Worker + R2 + DB | BullMQ (jobId dedup) | Triple: short-circuit `pdfKey`, key R2 determinista (overwrite), jobId=quoteId. |
| Persistir `pdfKey` | Database (`withTenant` UPDATE) | — | Single atomic write-back bajo RLS `app_authenticated`. Clona `writeVariants`. |
| Status + entrega del PDF | API / Backend (`quotes.pdfStatus` bajo `quotes.*`) | CDN/Object store (R2 presigned GET) | El server sólo firma una URL; el navegador baja los bytes directo de R2 (cero bytes por Next). |
| Estado de descarga (retención quoteId, polling, auto-descarga, fallo suave) | Browser / Client (`cotizador-simulator.tsx`) | — | Estado efímero del cliente; el PDF nunca es el path crítico de la demo. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-pdf/renderer` | `4.5.1` | Render del PDF server-side vía `renderToBuffer()` | Motor PDF en JS/WASM puro — **sin Chromium, sin dependencias nativas** → corre en el worker Alpine/musl sin `libc`/`libnss` extra. Peer `react ^19` (compatible con el React 19.2 del repo). 3.9M descargas/semana, repo activo. `[VERIFIED: npm registry]` |
| `qrcode` | `1.5.4` | Generar el QR del deep-link (D-08) como PNG data-URL | JS puro, sin deps nativas; `toDataURL()` devuelve un data-URL embebible directo en `<Image src>` de react-pdf. 15M descargas/semana. `[VERIFIED: npm registry]` |
| _(fuente TTF embebida)_ | — | Glyphs es-AR (áéíóúñ¿¡, U$S/$) para PDF-02 | Requisito de CONTEXT/CLAUDE: NO confiar en fuentes estándar PDF. Recomendación: una TTF con licencia permisiva (OFL/Apache) — p.ej. **Inter**, **Roboto** o **Liberation Sans** — 1-2 pesos (Regular + Bold). Debe **commitearse al repo** (build determinista, worker offline). `[ASSUMED]` (elección exacta = discreción de Claude) |

### Supporting (ya en el repo — se reusan, no se instalan)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aws-sdk/client-s3` | `3.1076.0` | `GetObjectCommand`/`PutObjectCommand` contra R2 | Worker (put del PDF) + api (presign GET). Ya en `apps/worker` y `packages/api`. |
| `@aws-sdk/s3-request-presigner` | `3.1076.0` | `getSignedUrl` para el presigned GET | Ya en `packages/api` (se usa en `presignPut`); el GET es análogo. |
| `bullmq` | `5.78.x` | Queue (producer) + Worker (consumer) | Producer lazy en `packages/api` (patrón `media/runtime.ts`); consumer en `apps/worker/src/index.ts`. |
| `ioredis` | `5.10/5.11` | Conexión Redis (`maxRetriesPerRequest: null`) | Requerido por BullMQ. |
| `@imbau/storage` | workspace | `QUOTE_PDF_QUEUE`, `QuotePdfJobData`, `quotePdfJobOptions`, `quotePdfKey`, `makeR2Client` | **Contrato completo ya codeado (fase 5).** Consumir tal cual — no redefinir. |
| `@imbau/quoting` | workspace | `toPdfModel(result)` + tipo `PdfModel` | El worker lo importa para maquetar el snapshot. **Nuevo dep del worker** (no lo tiene hoy). |
| `@imbau/observability` | workspace | `logger` (pino) | Log estructurado en éxito/fallo. |
| `@sentry/node` | `10.61.0` | `captureException` en fallo final | Ya en el worker (`reportMediaFailure`). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@react-pdf/renderer` | `pdfkit` (base de react-pdf) | Más bajo nivel, layout imperativo. react-pdf da layout declarativo (flexbox) y ya embebe fontkit — más rápido para un doc de una página. |
| `@react-pdf/renderer` | `puppeteer`/`playwright` (HTML→PDF) | **Descartado:** requiere Chromium — pesado, deps nativas, no encaja en el worker Alpine slim (CLAUDE.md "sin motores tipo game engine / sin Chromium"). |
| `@react-pdf/renderer` | `pdf-lib` | Bueno para editar PDFs existentes, no para maquetar desde cero con texto fluido. |
| `qrcode` (PNG data-URL) | `qrcode` `toString(svg)` | react-pdf soporta `<Image>` (PNG/JPG) de forma robusta; su render de SVG es parcial. Preferir PNG data-URL. `[CITED: react-pdf.org]` |
| Leer descriptores live (`withTenant` en worker) | Extender el snapshot en `create` con descriptores | Ver §Open Questions Q1. |

**Installation:**
```bash
# apps/worker
pnpm --filter @imbau/worker add @react-pdf/renderer@4.5.1 qrcode@1.5.4 react@19.2.7
pnpm --filter @imbau/worker add -D @types/qrcode
pnpm --filter @imbau/worker add @imbau/quoting@workspace:*
# packages/api gains no new deps (bullmq/ioredis/aws-sdk ya presentes); apps/web gana env vars, no packages
```

**Version verification (2026-07-05, `npm view`):**
- `@react-pdf/renderer` → `4.5.1` (publicado 2026-04-15), peer `react ^16.8||^17||^18||^19` ✓
- `qrcode` → `1.5.4` (publicado 2024-08-05)

> Nota: el worker necesita `react` como dependencia directa (react-pdf construye elementos React). Si se prefiere evitar configurar JSX en el build `tsup`/esbuild del worker, usar `React.createElement` directamente (sin `.tsx`) — ver §Pitfall 4.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@react-pdf/renderer` | npm | pub. 2026-04-15 | ~3.9M/wk | github.com/diegomura/react-pdf | OK | Approved |
| `qrcode` | npm | pub. 2024-08-05 | ~15.6M/wk | github.com/soldair/node-qrcode | OK | Approved |

Ambos con `postinstall: null`, no deprecados, repo público conocido — verificados vía `gsd-tools query package-legitimacy check --ecosystem npm`. `[VERIFIED: npm registry]`

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

> `@types/qrcode` (devDep) y la elección exacta de la fuente TTF quedan pendientes de la decisión del planner; `@types/qrcode` es el paquete DefinitelyTyped estándar para `qrcode` — verificar antes de instalar.

## Architecture Patterns

### System Architecture Diagram

```
                      apps/web (Next, proceso que hostea appRouter)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  cotizador-simulator.tsx (client island)                              │
  │    ─ toca "Descargar PDF" ──► quotes.create (si no hay quoteId retenido)│
  │                               └─ reusa quoteId retenido (D-01)         │
  │                                                                        │
  │  quotes.create (publicProcedure, packages/api)                        │
  │    1. resolveAndQuote → snapshot insert (YA EXISTE, fase 5)           │
  │    2. enqueuePdf({quoteId, orgId, projectId})  ◄── NUEVO (producer)   │──┐
  └───────────────────────────────────────────────────────────────────────┘  │
                                                                               │ BullMQ add()
                          Redis  ◄──────────── QUOTE_PDF_QUEUE ────────────────┘ jobId=quoteId
                            │
                            ▼ (job)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  apps/worker  createQuotePdfWorker (NUEVO, junto a createMediaWorker)  │
  │    processQuotePdf(job):                                               │
  │      0. SHORT-CIRCUIT: withTenant → SELECT pdfKey; si != null → return │  (D-11 idempotencia)
  │      1. withTenant → SELECT snapshot (+ descriptores unidad/proyecto)  │
  │      2. toPdfModel(snapshot.result) → PdfModel (leyendas incluidas)    │
  │      3. renderToBuffer(<QuoteDoc model … qrPng />)  ── CPU-puro        │  (react-pdf, fuente embebida)
  │      4. PutObject R2  key=quotePdfKey(org,project,quoteId).pdf         │  (overwrite determinista)
  │      5. withTenant → UPDATE quotes SET pdf_key = key  (single write)   │  (clona writeVariants)
  │    on failed (5º retry) → Sentry + pino (reportQuotePdfFailure)        │
  └───────────────────────────────────────────────────────────────────────┘
                            │ (pdf en R2)
                            ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  quotes.pdfStatus (publicProcedure bajo quotes.*, packages/api)        │
  │    in: {projectId, quoteId}                                            │
  │    1. withAnon → resolver orgId del proyecto PUBLICADO (T-05 seguro)   │
  │    2. withTenant(org) → SELECT pdfKey WHERE id=quoteId (RLS scoped)    │
  │    3. si pdfKey → getSignedUrl(GetObject, TTL corto, Content-Disp.)    │
  │    out: { ready:true, url } | { ready:false }                          │
  └───────────────────────────────────────────────────────────────────────┘
        ▲ poll cada ~2s (nginx zone=quotes)      │ presigned GET
        │                                        ▼
   cotizador-simulator ──── auto-descarga ──► navegador baja directo de R2
```

### Recommended Project Structure
```
packages/storage/src/quote-pdf.ts     # contrato (YA EXISTE — no tocar)
packages/storage/src/keys.ts          # quotePdfKey (YA EXISTE — no tocar)

packages/api/src/quotes/runtime.ts    # NUEVO: producer lazy (enqueuePdf) + presignGet — clona media/runtime.ts
packages/api/src/trpc/routers/quotes.ts  # + enqueue en create; + pdfStatus procedure

apps/worker/src/quote-pdf.ts          # NUEVO: processQuotePdf + reportQuotePdfFailure (clona media.ts)
apps/worker/src/quote-pdf-doc.tsx     # NUEVO: el componente react-pdf (QuoteDoc) + Font.register — o .ts con createElement
apps/worker/src/quote-pdf-store.ts    # NUEVO: readSnapshot + writePdfKey withTenant (clona media-store.ts)
apps/worker/src/index.ts              # + createQuotePdfWorker + on("failed")
apps/worker/assets/<font>.ttf         # NUEVO: fuente embebida (commiteada)
apps/worker/Dockerfile                # + COPY del asset de fuente al runner

apps/web/env.ts                       # + REDIS_URL (redisEnv) + R2_* (r2Env)
apps/web/components/cotizador-simulator.tsx  # reemplazar placeholder por wiring real
deploy/compose.staging.yml            # web: + REDIS_URL/R2_* (env_file .env ya cubre si están en .env); depends_on redis
```

### Pattern 1: Producer lazy en packages/api (clona `enqueueMedia`)
**What:** Una `Queue` BullMQ memoizada + verbos exportados, inicializada en el primer uso (nunca al importar el router).
**When to use:** El enqueue del PDF en `quotes.create` (D-02).
**Example:**
```typescript
// packages/api/src/quotes/runtime.ts  — mirror de media/runtime.ts
// Source: packages/api/src/media/runtime.ts (verificado en el repo)
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { QUOTE_PDF_QUEUE, quotePdfJobOptions, makeR2Client, type QuotePdfJobData } from "@imbau/storage";
// env parse lazy + cache (fail-closed, nombre de var nunca el valor) — idéntico a media/runtime.ts

export async function enqueuePdf(data: QuotePdfJobData): Promise<void> {
  await getQueue().add("render", data, quotePdfJobOptions(data.quoteId));
}

export function presignPdfGet(key: string): Promise<string> {
  return getSignedUrl(getR2(), new GetObjectCommand({
    Bucket: r2Bucket(), Key: key,
    ResponseContentType: "application/pdf",
    ResponseContentDisposition: `attachment; filename="cotizacion.pdf"`,
  }), { expiresIn: 300 }); // TTL corto, re-pedible (D-04)
}
```
**Idempotencia:** `jobId=quoteId` (via `quotePdfJobOptions`) hace que BullMQ dedupe re-enqueues del mismo quote — dos triggers (WhatsApp+PDF) sobre el mismo `quoteId` no apilan jobs. `[VERIFIED: codebase grep — packages/storage/src/quote-pdf.ts]`

### Pattern 2: Consumer worker (clona `processMedia` + `writeVariants`)
**What:** Un processor que separa el render CPU-puro de los seams de I/O (R2 get/put + `withTenant`).
**Example:**
```typescript
// apps/worker/src/quote-pdf.ts  — mirror de media.ts
import type { Job } from "bullmq";
import { renderToBuffer } from "@react-pdf/renderer";
import { quotePdfKey, type QuotePdfJobData } from "@imbau/storage";
import { toPdfModel } from "@imbau/quoting";
import { readQuoteForPdf, writePdfKey } from "./quote-pdf-store"; // withTenant seams
import { putPdf } from "./quote-pdf-runtime";                     // R2 put
import { QuoteDoc } from "./quote-pdf-doc";

export async function processQuotePdf(job: Job<QuotePdfJobData>): Promise<void> {
  const { quoteId, organizationId, projectId } = job.data;

  // 0. SHORT-CIRCUIT (D-11): si pdfKey ya está, no re-render.
  const row = await readQuoteForPdf(organizationId, quoteId); // snapshot + pdfKey + descriptores
  if (row.pdfKey) return;

  // 1. maquetar desde el snapshot (montos SOLO del snapshot — D-07)
  const model = toPdfModel(row.snapshot.result);

  // 2. render CPU-puro → Buffer (sin Chromium)
  const pdf = await renderToBuffer(QuoteDoc({ model, header: row.header, qrPng: row.qrPng }));

  // 3. put a key determinista (overwrite en retry — nunca duplica)
  const key = quotePdfKey(organizationId, projectId, quoteId);
  await putPdf(key, pdf);

  // 4. single atomic write-back bajo RLS
  await writePdfKey(organizationId, quoteId, key);
}
```
**Nota:** `renderToBuffer` es una API Node oficial que devuelve un `Buffer` — no requiere DOM. `[CITED: react-pdf.org, pkgpulse 2026]`

### Pattern 3: Status procedure tenant-safe para un caller anónimo
**What:** El buyer anónimo consulta el estado de SU quote sin que `quotes` tenga policy anon.
**When to use:** El endpoint de polling (D-03/D-04).
**Example:**
```typescript
// packages/api/src/trpc/routers/quotes.ts  — nuevo procedure bajo quotes.*
pdfStatus: publicProcedure
  .input(z.object({ projectId: z.uuid(), quoteId: z.uuid() }))
  .query(async ({ input }) => {
    // 1. resolver org del proyecto PUBLICADO (withAnon) — nunca del body (T-05-03)
    const org = await resolveOrgFromPublishedProject(input.projectId); // clona el step 1 de resolveAndQuote
    if (!org) throw new TRPCError({ code: "NOT_FOUND" });
    // 2. leer pdfKey bajo withTenant → RLS scopea el SELECT al org resuelto
    const rows = await withTenant(org, (tx) =>
      tx.select({ pdfKey: schema.quotes.pdfKey })
        .from(schema.quotes).where(eq(schema.quotes.id, input.quoteId)));
    const pdfKey = rows[0]?.pdfKey ?? null;
    if (!pdfKey) return { ready: false as const };
    return { ready: true as const, url: await presignPdfGet(pdfKey) };
  }),
```
**Por qué es tenant-safe:** un atacante que pase `projectId` de orgA + `quoteId` de orgB → `withTenant(orgA)` filtra por RLS → cero filas → `{ready:false}`. Nunca lee el quote de otro org. `quoteId` es un uuid v4 no-adivinable. `[VERIFIED: codebase — quotes.ts resolveAndQuote L43-56 + RLS policy quotes.ts schema L63-69]`

**Importante — split link (Pitfall fase 6):** el procedure DEBE llamarse `quotes.pdfStatus` para que su path HTTP sea `/api/trpc/quotes.pdfStatus` y quede bajo el `location ^~ /api/trpc/quotes` de nginx (throttle QUOTE-03), y debe ir por el link dedicado `isQuotesOp` (`apps/web/lib/trpc-split.ts`). Con `query` en vez de `mutation`, el polling puede usar TanStack Query `refetchInterval`. `[VERIFIED: codebase — trpc-split.ts, nginx conf L83-85]`

### Anti-Patterns to Avoid
- **Re-computar el motor en el worker:** el PDF sale de `snapshot.result` vía `toPdfModel` — NUNCA `calcQuote` de nuevo (T-04-06 drift). Los montos son solo-snapshot (D-07).
- **Confiar en un `pdfKey` provisto por el cliente:** la key se deriva SIEMPRE server-side con `quotePdfKey(org, project, quoteId)` (patrón `originalKey`/T-02-01).
- **Fuentes estándar PDF para acentos:** aunque Helvetica WinAnsi cubre Latin-1, CONTEXT/CLAUDE mandan fuente embebida — determinista y a prueba de bugs de encoding. Embeber siempre.
- **Presignar en el proceso Next devolviendo bytes:** el server sólo firma la URL; los bytes salen de R2 (D-04).
- **Owner/BYPASSRLS role para el write-back de `pdfKey`:** usar `withTenant` (`app_authenticated`) — `quotes_tenant` es `FOR ALL TO appAuthenticated`, un UPDATE del owner pega contra default-deny (patrón `writeVariants`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Layout + embedding de PDF | Escribir bytes PDF/PostScript a mano | `@react-pdf/renderer` | Kerning, embedding de fuentes, xref tables, compresión — todo resuelto. |
| Encoding de acentos | Tabla de mapeo de caracteres | `Font.register` con una TTF | fontkit (dentro de react-pdf) hace subsetting + embedding correcto. |
| Generar el QR | Matriz QR + máscara + ECC a mano | `qrcode` (`toDataURL`) | Reed-Solomon, versiones, niveles de corrección — no reinventar. |
| Presigned URL | Firmar SigV4 manualmente | `getSignedUrl` (`@aws-sdk/s3-request-presigner`) | Ya en el repo; el mismo patrón que `presignPut`. |
| Dedup de jobs / retry / backoff | Locks en Redis propios | `quotePdfJobOptions` (jobId + attempts + backoff) | Ya codeado (fase 5). |
| Idempotencia de key | UUID por archivo + limpieza | `quotePdfKey` determinista (overwrite) | Ya codeado (fase 5). |

**Key insight:** El 80% de esta fase ya está construido y verificado como el pipeline de media. El trabajo real es maquetar UN documento de una página y cablear tres seams conocidos — no inventar infraestructura.

## Runtime State Inventory

> Esta fase NO es un rename/refactor/migración — es feature nueva sobre seams existentes. Sección incluida sólo para el ítem de config de deploy, que sí es estado runtime que un grep no encuentra.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `quotes.pdfKey` ya en el schema (nullable, sin migración). Los PDFs viven en R2 bajo `quotes/{org}/{project}/{quoteId}.pdf`. | Ninguna migración de schema. |
| Live service config | **`apps/web` necesita `REDIS_URL` + `R2_*` en runtime** (nuevo por D-02). En `deploy/compose.staging.yml` el servicio `web` sólo `depends_on: postgres` y hoy no recibe esas vars más allá de lo que haya en `.env`. El `.env` de staging (SOPS) YA tiene `R2_*` (fase 3, memoria) y `REDIS_URL` (worker) — verificar que el servicio `web` las herede vía `env_file: [.env]` y agregar `depends_on: redis`. | Editar `apps/web/env.ts` (+redisEnv +r2Env) y `deploy/compose.staging.yml` (web depends_on redis; confirmar env_file cubre REDIS_URL/R2_*). Config live que un grep de código no revela. |
| OS-registered state | Ninguno. | Ninguna. |
| Secrets/env vars | `REDIS_URL` y `R2_ACCESS_KEY_ID/SECRET/ACCOUNT_ID/BUCKET/PUBLIC_BASE_URL` — YA existen en el `.env` SOPS de staging (usados por worker/media). Sólo hay que **declararlas en el env de web**; los valores no cambian. | Añadir a `apps/web/env.ts`; ningún secreto nuevo que generar. |
| Build artifacts | La **fuente `.ttf`** debe viajar en la imagen del worker. `tsup` NO copia assets → hay que COPYarla en el Dockerfile y resolverla por path en runtime (§Pitfall 1). | Añadir asset al repo + COPY en `apps/worker/Dockerfile` + verificar resolución de path. |

**La pregunta canónica:** después de mergear el código, ¿qué systems runtime siguen sin la config? → El servicio `web` de staging necesita `REDIS_URL`/`R2_*` cableadas y `depends_on: redis`; el worker necesita el `.ttf` dentro de la imagen. Ambos verificables sólo en el deploy a VPS (mergear PR a main).

## Common Pitfalls

### Pitfall 1: La fuente `.ttf` no está en la imagen / el path no resuelve en Alpine
**What goes wrong:** `Font.register({ src: "./assets/font.ttf" })` con path relativo, o el `.ttf` que nunca fue copiado al `dist/` por `tsup`. En runtime react-pdf no encuentra la fuente → o falla, o cae a una fuente sin acentos → PDF-02 roto.
**Why it happens:** `tsup`/esbuild bundlea SÓLO JS; los assets binarios no viajan. react-pdf en Node acepta URL o **path absoluto** — un path relativo desde `apps/worker/dist/index.js` no apunta a donde uno cree. El Dockerfile actual del worker copia sólo `dist` + `node_modules`.
**How to avoid:**
1. Commitear el `.ttf` (p.ej. `apps/worker/assets/inter-regular.ttf`).
2. `COPY --from=builder /app/apps/worker/assets ./apps/worker/assets` en el runner stage del Dockerfile (o configurar `tsup` `publicDir`/`onSuccess` para copiar a `dist/assets`).
3. Registrar por **path absoluto** resoluble en runtime — p.ej. `new URL("../assets/inter-regular.ttf", import.meta.url)` (ajustando al layout post-bundle) o un path anclado en `process.cwd()`/una env `FONT_DIR`. Verificar el path efectivo dentro del contenedor.
**Warning signs:** el PDF renderiza en dev (macOS, paths locales) pero los acentos salen como cuadros/faltantes en staging (Alpine); o `renderToBuffer` tira "no such file".
`[CITED: github.com/diegomura/react-pdf issues #409, #2223; react-pdf.org/fonts]`

### Pitfall 2: `Font.register` async + `renderToBuffer` corre antes de que la fuente cargue
**What goes wrong:** La fuente se registra por URL remota; el render dispara antes de que termine la descarga → texto sin la fuente o error "loading".
**Why it happens:** `Font.register` inicia una carga; no hay await built-in del readiness. Es sobre todo un problema del path remoto/browser.
**How to avoid:** Registrar por **path local absoluto** (carga desde fs, efectivamente síncrona en Node) y hacerlo **una vez a nivel de módulo** (top-level, no por job). Evitar URLs remotas en el worker. Un test de integración que renderice "áéíóúñ ¿Cuánto?" y verifique que el buffer es un `%PDF` válido con la fuente embebida cierra el riesgo.
**Warning signs:** flakiness — a veces con acentos, a veces sin.
`[CITED: github.com/diegomura/react-pdf issue #2675]`

### Pitfall 3: `apps/web` sin `REDIS_URL`/`R2_*` → `quotes.create` 500 o el deploy no bootea
**What goes wrong:** Con D-02 el enqueue corre en el proceso web. Si `apps/web/env.ts` no declara `REDIS_URL`, el primer `enqueuePdf` valida env y tira (fail-closed) → `quotes.create` rompe. Si el status presigna en web sin `R2_*`, el presign tira.
**Why it happens:** Hoy `apps/web/env.ts` sólo declara DB + Sentry/Loki. Las libs están en el árbol (vía `@imbau/api`) pero las env vars no.
**How to avoid:** Añadir `...redisEnv.server` y `...r2Env.server` a `apps/web/env.ts` (server block — nunca `NEXT_PUBLIC_`, T-03-01). Mantener el init lazy en el producer/presign para que importar `appRouter` NO abra Redis ni valide R2 (Pitfall del pattern media). Verificar en staging que el servicio `web` recibe esas vars.
**Warning signs:** `quotes.create` OK en local (con `.env` completo) pero 500 en staging; o el contenedor web no bootea nombrando `REDIS_URL`.
`[VERIFIED: codebase — apps/web/env.ts, media/runtime.ts lazy pattern]`

### Pitfall 4: JSX en el build `tsup` del worker
**What goes wrong:** `QuoteDoc` en `.tsx` sin config JSX → esbuild/tsup no transpila, o `react/jsx-runtime` no resuelve.
**Why it happens:** El worker es un proyecto Node sin setup JSX (a diferencia de las apps Next).
**How to avoid:** O configurar `tsup`/esbuild `jsx: "automatic"` + `react` como dep, O — más simple — escribir el documento con `React.createElement` en un `.ts` (sin JSX). react-pdf funciona igual con createElement.
**Warning signs:** el build del worker falla con "Unexpected token <" o "jsx is not defined".
`[ASSUMED]` (patrón conocido de esbuild/tsup; verificar la config `tsup` del worker al planificar)

### Pitfall 5: El short-circuit compite con el dedup de BullMQ (re-enqueue de un job fallido)
**What goes wrong:** Con `jobId=quoteId`, BullMQ ignora un `add()` si ya existe un job con ese id (aunque esté completed/failed) → un re-trigger podría no encolar nada, o un job "completed" viejo bloquear un re-intento.
**Why it happens:** El dedup por jobId es sobre la existencia del job en Redis, independiente del resultado.
**How to avoid:** El short-circuit por `pdfKey` (D-11) es la fuente de verdad de "ya está hecho" — el job puede correr dos veces sin daño (lee pdfKey, corta). Para PDF-02 basta con: (a) idempotencia real en el processor (short-circuit + overwrite), (b) aceptar que un `add()` deduplicado es benigno porque el PDF o ya existe o el job pendiente lo generará. Documentar la semántica de re-enqueue (BullMQ retiene el job hasta que expira por `removeOnComplete`/`removeOnFail` — considerar setear esas opciones si un re-trigger debe poder re-encolar tras un fallo terminal).
**Warning signs:** un segundo trigger tras un fallo terminal "no hace nada".
`[ASSUMED]` (comportamiento de BullMQ jobId dedup; confirmar contra docs de BullMQ al planificar — ver Q2)

### Pitfall 6: Memoria / concurrencia del worker con render de PDF
**What goes wrong:** Muchos renders concurrentes acumulan buffers.
**How to avoid:** El pipeline de media corre `concurrency: 2` — un PDF de una página es liviano (mucho menos que sharp+AVIF), así que `concurrency: 2` o más es seguro. No hay decode de imágenes grandes salvo el QR PNG (pequeño).
`[VERIFIED: codebase — index.ts createMediaWorker concurrency 2]`

## Code Examples

### Registrar la fuente + documento minimalista (createElement, sin JSX)
```typescript
// apps/worker/src/quote-pdf-doc.ts
// Source: react-pdf.org/fonts + react-pdf.org (Document/Page/View/Text/Image API)
import { createElement as h } from "react";
import { Document, Page, View, Text, Image, Font, StyleSheet } from "@react-pdf/renderer";
import { fileURLToPath } from "node:url";

// Registro top-level, una sola vez, por PATH ABSOLUTO (Pitfall 1 + 2).
Font.register({
  family: "Doc",
  fonts: [
    { src: fileURLToPath(new URL("../assets/inter-regular.ttf", import.meta.url)) },
    { src: fileURLToPath(new URL("../assets/inter-bold.ttf", import.meta.url)), fontWeight: "bold" },
  ],
});

const s = StyleSheet.create({
  page: { padding: 48, fontFamily: "Doc", fontSize: 11, color: "#1a1a1a" }, // neutro (D-06)
  h1: { fontSize: 16, fontWeight: "bold", marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", marginVertical: 3 },
  legal: { fontSize: 8, color: "#555", marginTop: 4 },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" },
});

export function QuoteDoc({ model, header, qrPng }: QuoteDocProps) {
  return h(Document, {},
    h(Page, { size: "A4", style: s.page },
      h(Text, { style: s.h1 }, header.proyecto),
      h(Text, {}, `${header.unidad} · Piso ${header.piso} · ${header.tipologia} · ${header.m2} m²`),
      h(Text, {}, `Emitida: ${header.fecha} · CAC: ${header.cacPeriodo} · Ref: ${header.ref}`),
      ...model.lineas.map((l) => h(View, { style: s.row }, h(Text, {}, l.label), h(Text, {}, l.valor))),
      ...model.leyendas.map((t) => h(Text, { style: s.legal }, t)), // PDF-03
      h(View, { style: s.footer },
        h(Text, {}, header.deepLink),
        h(Image, { src: qrPng, style: { width: 64, height: 64 } })))); // D-08
}
```

### Generar el QR como PNG data-URL
```typescript
// Source: npmjs.com/package/qrcode
import QRCode from "qrcode";
const qrPng = await QRCode.toDataURL(deepLinkUrl, { margin: 1, width: 256 });
// → "data:image/png;base64,..."  embebible directo en <Image src>
```

### Write-back de `pdfKey` bajo withTenant (clona `writeVariants`)
```typescript
// apps/worker/src/quote-pdf-store.ts
// Source: apps/worker/src/media-store.ts (verificado)
import { withTenant, schema } from "@imbau/db";
import { eq } from "drizzle-orm";
export async function writePdfKey(orgId: string, quoteId: string, pdfKey: string): Promise<void> {
  await withTenant(orgId, (tx) =>
    tx.update(schema.quotes).set({ pdfKey }).where(eq(schema.quotes.id, quoteId)));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML→PDF con Chromium (puppeteer) | Render JS puro (react-pdf/pdfkit) para docs estructurados | maduro desde ~2021 | Sin deps nativas → imágenes Alpine slim, arranque rápido, determinista. |
| `Font.registerHyphenationCallback` manual | Layout flexbox declarativo de react-pdf | react-pdf v2+ | Menos código imperativo para un doc de una página. |
| aws-sdk v2 presign | `@aws-sdk/s3-request-presigner` (v3) | v3 (2020+) | Ya adoptado en el repo (`presignPut`). |

**Deprecated/outdated:**
- Puppeteer/Playwright para este PDF: descartado por CLAUDE.md (sin Chromium) — no aplica.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Elección exacta de la fuente TTF (Inter/Roboto/Liberation) y sus pesos | Standard Stack | Bajo — cualquier TTF OFL/Apache con glyphs Latin-1 sirve; sólo afecta estética. Verificar licencia antes de commitear. |
| A2 | `@types/qrcode` es el typings correcto | Installation | Bajo — DefinitelyTyped estándar; verificar con `npm view`. |
| A3 | JSX en el build tsup del worker requiere config o usar createElement | Pitfall 4 | Medio — si no se resuelve, el build del worker falla; mitigable con createElement. Confirmar la config tsup al planificar. |
| A4 | Semántica de re-enqueue de BullMQ con jobId dedup tras fallo terminal | Pitfall 5, Q2 | Medio — afecta si un re-trigger tras fallo puede re-encolar. El short-circuit por pdfKey cubre el caso feliz; confirmar contra docs BullMQ. |
| A5 | Descriptores de unidad/proyecto se leen live vía withTenant (no se extiende el snapshot) | Open Q1 | Bajo — drift menor de descriptores no-monetarios; CONTEXT D-07 lo permite explícitamente. |
| A6 | El `.env` SOPS de staging ya contiene `REDIS_URL` + `R2_*` que el servicio `web` puede heredar | Runtime State Inventory | Medio — si el servicio `web` no los hereda, el deploy de la feature falla. Verificable sólo en el VPS. |

## Open Questions

1. **¿Descriptores de header (unidad/proyecto): read-live vs extender el snapshot?**
   - What we know: los montos son solo-snapshot (D-07); los descriptores (identificador, piso, tipología, m²) NO son montos ni PII → CONTEXT permite leerlos vía `withTenant` en el worker.
   - What's unclear: leer live introduce un drift menor si el descriptor cambia entre emisión y primer render (mínimo, y el PDF se congela en el primer render).
   - Recommendation: **read-live vía `withTenant`** en el worker (más simple, sin tocar el contrato de snapshot de fase 5). Si se quiere auditoría perfecta, extender `snapshot` (el envelope `.passthrough()` lo permite sin migración) capturando descriptores en `create`. Lean read-live (A5).

2. **¿Semántica exacta de re-enqueue con `jobId=quoteId` tras un fallo terminal?**
   - What we know: `quotePdfJobOptions` fija `jobId=quoteId, attempts=5`. El short-circuit por `pdfKey` hace idempotente el caso exitoso.
   - What's unclear: si un job quedó `failed` (5 retries agotados) y el buyer re-triggerea, ¿el `add()` con el mismo jobId re-encola o es ignorado? Depende de `removeOnFail`/`removeOnComplete`.
   - Recommendation: al planificar, confirmar contra docs BullMQ y considerar setear `removeOnComplete`/`removeOnFail` (o un `add()` que reemplace) para que un re-trigger tras fallo pueda re-encolar. Verificar en un test.

3. **¿Fecha de emisión: del snapshot o `now()` en el worker?**
   - What we know: D-07 pide "fecha de emisión". El snapshot de fase 5 no incluye timestamp explícito (habría que mirar si `quotes` tiene `createdAt`).
   - Recommendation: usar el `createdAt` de la fila `quotes` (leído en el worker) como fecha de emisión — determinista y auditable. Confirmar que la columna existe; si no, usar el momento del primer render (aceptable, se congela).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis 7 | Producer (web) + consumer (worker) | ✓ (compose `redis:7-alpine`) | 7 | — |
| R2 (Cloudflare) | put del PDF + presigned GET | ✓ (creds en SOPS staging, fase 3) | — | — |
| `@react-pdf/renderer` | render | ✗ (a instalar) | 4.5.1 | Ninguno viable (pdfkit sería fallback pero peor DX) |
| `qrcode` | QR | ✗ (a instalar) | 1.5.4 | — |
| Fuente TTF | acentos es-AR | ✗ (a commitear) | — | Sin fallback — es requisito PDF-02 |
| `REDIS_URL` en `apps/web` env | enqueue en create | ✗ (a declarar) | — | Sin fallback — bloquea D-02 |
| `R2_*` en `apps/web` env | presigned GET en status | ✗ (a declarar) | — | Alternativa: mover el status a un proceso con R2 (no aplica — web hostea appRouter) |

**Missing dependencies with no fallback:**
- La fuente TTF embebida (PDF-02) y las env vars `REDIS_URL`/`R2_*` en `apps/web` — el planner DEBE incluir tasks para ambas o el deploy de la feature falla.

**Missing dependencies with fallback:**
- Ninguna con fallback real; todas son requisito.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (worker + api) / Playwright (web e2e, opcional) |
| Config file | `apps/worker` usa `vitest run` (patrón `*.test.ts` co-locado) |
| Quick run command | `pnpm --filter @imbau/worker test` |
| Full suite command | `pnpm test` (turbo) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PDF-01 | El worker renderiza + sube + escribe `pdfKey` (seams mockeados) | unit | `pnpm --filter @imbau/worker test -t "processQuotePdf"` | ❌ Wave 0 |
| PDF-01 | `quotes.create` encola el job (producer mock) | unit | `pnpm --filter @imbau/api test -t "enqueuePdf"` | ❌ Wave 0 |
| PDF-01 | `quotes.pdfStatus` devuelve `{ready,url}` y es tenant-safe | unit/integration | `pnpm --filter @imbau/api test -t "pdfStatus"` | ❌ Wave 0 |
| PDF-02 | `renderToBuffer` produce un `%PDF` válido con acentos "áéíóúñ ¿¡" (fuente embebida) | unit | `pnpm --filter @imbau/worker test -t "acentos"` | ❌ Wave 0 |
| PDF-02 | Short-circuit: con `pdfKey` seteado el processor no re-renderiza ni re-sube | unit | `pnpm --filter @imbau/worker test -t "idempotente"` | ❌ Wave 0 |
| PDF-02 | Key determinista: dos renders → mismo `quotePdfKey` (overwrite) | unit | (cubierto por keys.test si existe) + assert en processor | ❌ Wave 0 |
| PDF-03 | El `PdfModel.leyendas` incluye "no vinculante" + CAC y se maquetan | unit | `pnpm --filter @imbau/quoting test` (ya existe) + assert render | parcial ✓ |

### Sampling Rate
- **Per task commit:** `pnpm --filter @imbau/worker test` (+ api si tocado)
- **Per wave merge:** `pnpm test` (turbo, full)
- **Phase gate:** full suite verde + UAT de descarga end-to-end en staging (depende de mergear PR a main → imagen web/worker post-fase-7 al VPS)

### Wave 0 Gaps
- [ ] `apps/worker/src/quote-pdf.test.ts` — processQuotePdf (render+put+write) con seams mockeados (vi.mock del store + runtime, como `media.test.ts`)
- [ ] `apps/worker/src/quote-pdf-doc.test.ts` — renderToBuffer real: assert `%PDF`, acentos, leyendas presentes (PDF-02/03)
- [ ] `packages/api/src/**/quotes.test.ts` — extender: enqueue en create + pdfStatus tenant-safe (cross-tenant assert)
- [ ] Fixture de fuente TTF de test (o la real) accesible en el entorno de test del worker

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Path público anónimo (buyer sin sesión) — igual que fase 5/6. |
| V3 Session Management | no | Sin sesión; el `quoteId` vive en estado del cliente (D-01). |
| V4 Access Control | **yes** | `pdfStatus` resuelve el org desde el `projectId` PUBLICADO (withAnon) y lee `pdfKey` bajo `withTenant` → RLS scopea al org resuelto. Cross-tenant imposible (quoteId de otro org → cero filas). `quotes` sigue tenant-private (sin policy anon). |
| V5 Input Validation | **yes** | `pdfStatus` input `{projectId: z.uuid(), quoteId: z.uuid()}` — zod en el boundary tRPC. |
| V6 Cryptography | no (indirecto) | Presigned URL SigV4 vía `getSignedUrl` — nunca firmar a mano. |
| V7 Error/Logging | **yes** | Fallo final → Sentry + pino (`reportQuotePdfFailure`), sólo campos estructurados (quoteId, attempts, queue) — nunca el valor de un secreto ni el payload crudo. |
| V12 Files/Resources | **yes** | Key R2 derivada server-side (`quotePdfKey`) — nunca una key provista por el cliente (T-02-01). PDF sube con `ContentType: application/pdf`. |
| V13 API | **yes** | Polling bajo el rate-limit nginx `zone=quotes` (10r/s burst 20). El status DEBE ir bajo `quotes.*` + link dedicado para heredar el throttle. |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Enumerar `quoteId` de otro tenant para leer su PDF | Information Disclosure | uuid v4 no-adivinable + resolución de org por proyecto publicado + RLS `withTenant` (cero filas para otro org). |
| Presigned URL filtrada expone el PDF | Information Disclosure | TTL corto (~300s) re-pedible; el PDF es finance-only sin PII (snapshot PII-free D-04); URL de un solo GET. |
| Spam de `quotes.create` (write-amp: cada create sube un PDF a R2) | Denial of Service | Rate-limit nginx `zone=quotes` (ya activo) + el enqueue dedup por jobId. Objetos de KBs. |
| Polling agresivo al status | Denial of Service | Mismo `zone=quotes`; intervalo ~2s por cliente es trivial vs 10r/s. |
| Secreto R2 filtrado al bundle browser | Information Disclosure | `R2_*` en el `server` block de `apps/web/env.ts` (t3-env split) — nunca `NEXT_PUBLIC_`. Presign corre server-side. |
| Client-supplied `pdfKey` | Tampering | La key se deriva server-side siempre (`quotePdfKey`); el status lee `pdfKey` de la fila, no del cliente. |

## Sources

### Primary (HIGH confidence)
- Codebase (grep/read, verificado 2026-07-05): `packages/storage/src/quote-pdf.ts`, `keys.ts`, `apps/worker/src/media.ts` + `media-store.ts` + `media-runtime.ts` + `index.ts`, `packages/api/src/media/runtime.ts` + `trpc/routers/media.ts` + `quotes.ts`, `packages/quoting/src/serialize.ts` + `types.ts` + `index.ts`, `packages/db/src/schema/quotes.ts` + `json-schemas.ts`, `apps/web/env.ts` + `lib/trpc-split.ts` + `components/cotizador-simulator.tsx`, `apps/worker/Dockerfile`, `compose.yml` + `deploy/compose.staging.yml`, `deploy/nginx/staging.tours.andescode.com.ar.conf`, `packages/config/env/presets.ts`.
- npm registry (`npm view`, 2026-07-05): `@react-pdf/renderer@4.5.1`, `qrcode@1.5.4` — versiones + peers.
- `gsd-tools query package-legitimacy check` — ambos `OK`.

### Secondary (MEDIUM confidence)
- [react-pdf.org/fonts](https://react-pdf.org/fonts) — `Font.register`, TTF/WOFF only, path absoluto en Node.
- [npmjs.com/package/qrcode](https://www.npmjs.com/package/qrcode) — `toDataURL`.
- [pkgpulse — react-pdf vs jsPDF 2026](https://www.pkgpulse.com/blog/react-pdf-vs-react-pdf-renderer-vs-jspdf-pdf-in-react-2026) — `renderToBuffer()` devuelve Buffer Node.
- GitHub issues diegomura/react-pdf [#409](https://github.com/diegomura/react-pdf/issues/409), [#2223](https://github.com/diegomura/react-pdf/issues/2223), [#2675](https://github.com/diegomura/react-pdf/issues/2675) — footguns de path/async de fuentes.

### Tertiary (LOW confidence)
- Semántica exacta de BullMQ jobId dedup tras fallo terminal (Q2/A4) — confirmar contra docs BullMQ al planificar.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versiones verificadas en npm; el resto ya en el repo.
- Architecture: HIGH — clon directo del pipeline de media verificado en producción; seams leídos.
- Pitfalls: MEDIUM/HIGH — font/Alpine y env de web verificados contra código y docs; semántica de re-enqueue BullMQ pendiente de confirmar (LOW).

**Research date:** 2026-07-05
**Valid until:** 2026-08-04 (stack estable; re-verificar versiones de react-pdf si pasa >30 días)
