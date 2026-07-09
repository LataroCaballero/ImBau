# Phase 7: PDF asíncrono en el worker - Pattern Map

**Mapped:** 2026-07-05
**Files analyzed:** 11 (7 new, 4 modified)
**Analogs found:** 11 / 11 (this phase is an 80% clone of the verified media pipeline)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/api/src/quotes/runtime.ts` (new) | service (producer + presign seam) | event-driven / request-response | `packages/api/src/media/runtime.ts` | exact |
| `packages/api/src/trpc/routers/quotes.ts` (mod) | route (tRPC router) | request-response | self (`create`) + `resolveAndQuote` step 1 | exact |
| `apps/worker/src/quote-pdf.ts` (new) | service (processor) | batch / transform | `apps/worker/src/media.ts` | exact |
| `apps/worker/src/quote-pdf-doc.ts` (new) | component (react-pdf document) | transform | none (new tech) | no analog |
| `apps/worker/src/quote-pdf-store.ts` (new) | service (withTenant read/write seam) | CRUD | `apps/worker/src/media-store.ts` | exact |
| `apps/worker/src/quote-pdf-runtime.ts` (new) | service (R2 put seam) | file-I/O | `apps/worker/src/media-runtime.ts` | exact |
| `apps/worker/src/index.ts` (mod) | config (worker boot) | event-driven | self (`createMediaWorker` + `on("failed")`) | exact |
| `apps/worker/assets/<font>.ttf` (new) | asset | — | none (new asset) | no analog |
| `apps/worker/Dockerfile` (mod) | config | — | self (runner stage COPY) | exact |
| `apps/web/env.ts` (mod) | config | — | self + `media/runtime.ts` MediaEnv shape | exact |
| `apps/web/components/cotizador-simulator.tsx` (mod) | component (client island) | request-response / polling | self (`create` mutation, `readTrpcError`, softError) | role-match |

## Shared Contracts Already Coded (fase 5 — consume as-is, DO NOT redefine)

- `packages/storage/src/quote-pdf.ts` — `QUOTE_PDF_QUEUE = "quote-pdf"`, `QuotePdfJobData {quoteId, organizationId, projectId}`, `quotePdfJobOptions(quoteId)` → `{jobId: quoteId, attempts: 5, backoff: {type:"exponential", delay:2000}}`. Deliberately bullmq-free; each side builds its own Queue/Worker.
- `packages/storage/src/keys.ts` L35-41 — `quotePdfKey(orgId, projectId, quoteId)` → `quotes/${orgId}/${projectId}/${quoteId}.pdf` (deterministic, overwrite on retry).
- `packages/quoting/src/types.ts` L147-151 — `PdfModel { modalidad: string; lineas: {label,valor}[]; leyendas: string[] }`; strings are es-AR-preformatted, worker owns layout, never re-formats numbers. `toPdfModel(result)` from `@imbau/quoting`.
- `packages/db/src/schema/quotes.ts` L23-71 — `pdfKey: text("pdf_key")` already exists (nullable, NO migration). `quotes_tenant` policy is `FOR ALL TO appAuthenticated` (no anon policy → tenant-private). **No `createdAt` column exists** (see Pattern Assignment for `quote-pdf-doc` — fecha de emisión must be render-time, frozen at first render, since neither the row nor the snapshot carries a timestamp).

## Pattern Assignments

### `packages/api/src/quotes/runtime.ts` (service, producer + presign)

**Analog:** `packages/api/src/media/runtime.ts` (exact — lazy/memoized producer)

**Lazy-memoized env + client + queue** (media/runtime.ts L44-80). Clone verbatim, swapping `MEDIA_QUEUE`→`QUOTE_PDF_QUEUE` and `mediaJobOptions`→`quotePdfJobOptions`. CRITICAL: init must stay lazy so importing `appRouter` never opens a Redis socket nor validates R2 (Pitfall 3). Env is parsed on FIRST USE, fails closed with the var NAME (never the value):

```typescript
function getEnv(): MediaEnv {
  cachedEnv ??= createEnv({
    server: { ...baseEnv.server, ...r2Env.server, ...redisEnv.server },
    runtimeEnv: process.env,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  }) as MediaEnv;
  return cachedEnv;
}
function getQueue(): Queue {
  if (!cachedQueue) {
    const connection = new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
    cachedQueue = new Queue(QUOTE_PDF_QUEUE, { connection });
  }
  return cachedQueue;
}
```

**Enqueue verb** (media/runtime.ts L117-119, `enqueueMedia`):
```typescript
export async function enqueuePdf(data: QuotePdfJobData): Promise<void> {
  await getQueue().add("render", data, quotePdfJobOptions(data.quoteId));
}
```

**Presign GET** — new verb, mirror of `presignPut` (media/runtime.ts L89-95) but `GetObjectCommand` + short TTL + Content-Disposition attachment:
```typescript
export function presignPdfGet(key: string): Promise<string> {
  return getSignedUrl(getR2(), new GetObjectCommand({
    Bucket: r2Bucket(), Key: key,
    ResponseContentType: "application/pdf",
    ResponseContentDisposition: `attachment; filename="cotizacion.pdf"`,
  }), { expiresIn: 300 }); // corto, re-pedible (D-04)
}
```
`getSignedUrl` + `@aws-sdk/s3-request-presigner` already imported in media/runtime.ts — same deps, no new packages in `packages/api`.

---

### `packages/api/src/trpc/routers/quotes.ts` (route, request-response) — MODIFY

**Analog:** self — the existing `create` mutation (L181-211) and `resolveAndQuote` step 1 (L43-56).

**1. Enqueue in `create`** (D-02): after the snapshot insert returns `row.id`, before returning, call `enqueuePdf`. The insert already yields `{ quoteId, result }`; add the enqueue as the create side-effect (mirrors how the media router pairs a DB write with `enqueueMedia`):
```typescript
await enqueuePdf({ quoteId: row.id, organizationId: orgId, projectId: input.projectId });
return { quoteId: row.id, result };
```

**2. New `pdfStatus` publicProcedure** — MUST be named `quotes.pdfStatus` so its HTTP path `/api/trpc/quotes.pdfStatus` inherits the nginx `location ^~ /api/trpc/quotes` throttle and the `isQuotesOp` dedicated link. Use `.query` (not mutation) so TanStack Query `refetchInterval` can poll. Tenant-safety clones the `resolveAndQuote` step-1 org resolve (withAnon → publicado project → orgId, L43-56) then reads `pdfKey` under `withTenant`:
```typescript
pdfStatus: publicProcedure
  .input(z.object({ projectId: z.uuid(), quoteId: z.uuid() }))
  .query(async ({ input }) => {
    const projectRows = await withAnon((tx) =>
      tx.select({ organizationId: schema.projects.organizationId })
        .from(schema.projects).where(eq(schema.projects.id, input.projectId)));
    const org = projectRows[0]?.organizationId;
    if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Proyecto no publicado." });
    const rows = await withTenant(org, (tx) =>
      tx.select({ pdfKey: schema.quotes.pdfKey })
        .from(schema.quotes).where(eq(schema.quotes.id, input.quoteId)));
    const pdfKey = rows[0]?.pdfKey ?? null;
    if (!pdfKey) return { ready: false as const };
    return { ready: true as const, url: await presignPdfGet(pdfKey) };
  }),
```
**Tenant-safe because:** a `quoteId` from another org → `withTenant(orgA)` RLS filters to zero rows → `{ready:false}`. quoteId is uuid v4 non-guessable. Same fence as this file's header comment: import ONLY `withTenant`/`withAnon`/`schema` from `@imbau/db` (T-05-07).

---

### `apps/worker/src/quote-pdf.ts` (service, processor) — NEW

**Analog:** `apps/worker/src/media.ts` (exact — `processMedia` L124-148 + `reportMediaFailure` L166-177)

**Processor structure** — mirror `processMedia`: pull `{quoteId, organizationId, projectId}` off `job.data`, SHORT-CIRCUIT on existing `pdfKey` (D-11), render CPU-pure, put to deterministic key, single `withTenant` write-back. Delegate all I/O to `quote-pdf-store` (withTenant) and `quote-pdf-runtime` (R2) seams — construct NO S3Client/transaction inline, so `quote-pdf.test.ts` can `vi.mock` both seams (same as `media.test.ts`):
```typescript
export async function processQuotePdf(job: Job<QuotePdfJobData>): Promise<void> {
  const { quoteId, organizationId, projectId } = job.data;
  const row = await readQuoteForPdf(organizationId, quoteId); // snapshot + pdfKey + descriptores
  if (row.pdfKey) return;                                     // SHORT-CIRCUIT (D-11)
  const model = toPdfModel(row.snapshot.result);             // montos SOLO del snapshot (D-07)
  const pdf = await renderToBuffer(QuoteDoc({ model, header: row.header, qrPng: row.qrPng }));
  const key = quotePdfKey(organizationId, projectId, quoteId);
  await putPdf(key, pdf);
  await writePdfKey(organizationId, quoteId, key);           // single atomic write-back
  logger.info({ quoteId, organizationId }, "quote pdf rendered + persisted");
}
```

**Failure reporting** — clone `reportMediaFailure` (media.ts L166-177) as `reportQuotePdfFailure`, swapping `mediaId`→`quoteId`, `MEDIA_QUEUE`→`QUOTE_PDF_QUEUE`. Sentry `captureException` + pino `error`; only structured fields (quoteId, attempts, queue) — never the raw payload (V7):
```typescript
export function reportQuotePdfFailure(err: unknown, ctx: { quoteId?: string; attempts?: number }): void {
  Sentry.captureException(err, { extra: { quoteId: ctx.quoteId, attempts: ctx.attempts } });
  logger.error({ err, quoteId: ctx.quoteId, queue: QUOTE_PDF_QUEUE }, "quote pdf job failed");
}
```

**QR generation** (D-08) belongs here (or in a helper): `const qrPng = await QRCode.toDataURL(deepLinkUrl, { margin: 1, width: 256 });` → embeddable in `<Image src>`. `qrcode@1.5.4`.

---

### `apps/worker/src/quote-pdf-doc.ts` (component, react-pdf) — NEW — NO ANALOG

No existing analog (genuinely new tech). Follow RESEARCH §Code Examples. Key constraints:
- **Write with `React.createElement` (`.ts`, no JSX)** to avoid configuring JSX in the worker's tsup build (Pitfall 4). react-pdf works identically with `createElement`.
- **`Font.register` top-level, once, by ABSOLUTE path** (Pitfall 1 + 2): `fileURLToPath(new URL("../assets/<font>.ttf", import.meta.url))`. NEVER a remote URL, NEVER a relative path — the `.ttf` must resolve inside the Alpine container. Registering by local fs path makes load effectively synchronous.
- `renderToBuffer()` (Node API, returns Buffer, no DOM/Chromium).
- Neutro minimalista (D-06): `#1a1a1a` text, no dark backgrounds, no cobre accent. One A4 page. Header (proyecto, unidad·piso·tipología·m², fecha, CAC período, ref), `model.lineas`, `model.leyendas` (PDF-03), footer deep-link + QR.
- **Fecha de emisión:** neither `quotes` (no `createdAt` column — verified) nor the snapshot carries a timestamp → use render-time `now()`, frozen at first render by D-11 idempotency. Document this in the plan.

---

### `apps/worker/src/quote-pdf-store.ts` (service, withTenant CRUD) — NEW

**Analog:** `apps/worker/src/media-store.ts` (exact — `writeVariants` L40-48)

**Write-back** — clone `writeVariants` exactly, swap `media`→`quotes`, variant map → `pdfKey`. Runs as `app_authenticated` via `withTenant` (NEVER owner — `quotes_tenant` is `FOR ALL TO appAuthenticated`, an owner UPDATE hits default-deny):
```typescript
export async function writePdfKey(orgId: string, quoteId: string, pdfKey: string): Promise<void> {
  await withTenant(orgId, (tx) =>
    tx.update(schema.quotes).set({ pdfKey }).where(eq(schema.quotes.id, quoteId)));
}
```

**Read** — new sibling verb `readQuoteForPdf(orgId, quoteId)`: `withTenant` SELECT of `{ snapshot, pdfKey }` from `quotes` WHERE id, plus the header descriptors (unidad identificador/piso/tipología/m², proyecto nombre) joined from `units`/`floors`/`projects` under the same `withTenant` tx (Open Q1 recommendation: read-live descriptors, montos stay snapshot-only). Import ONLY `withTenant`/`schema` from `@imbau/db` (T-03-09 fence).

---

### `apps/worker/src/quote-pdf-runtime.ts` (service, R2 file-I/O) — NEW

**Analog:** `apps/worker/src/media-runtime.ts` (exact — `putVariant` L39-52)

Eager module-level client is correct here (worker already validated R2_* at boot via `./env`, unlike the api's lazy runtime). Clone the `makeR2Client(env)` construction (L20) and `putVariant` (L39-52) as `putPdf`:
```typescript
export async function putPdf(key: string, body: Buffer): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body, ContentType: "application/pdf",
  }));
}
```

---

### `apps/worker/src/index.ts` (config, worker boot) — MODIFY

**Analog:** self — `createMediaWorker` (L68-75) + the media `on("failed")` handler (L128-133) + boot wiring (L120-121).

Add `createQuotePdfWorker` mirroring `createMediaWorker` (typed `Worker<QuotePdfJobData>`, `concurrency: 2` is safe — a one-page PDF is far lighter than sharp+AVIF, Pitfall 6):
```typescript
export function createQuotePdfWorker(connection: IORedis): Worker<QuotePdfJobData> {
  return new Worker<QuotePdfJobData>(QUOTE_PDF_QUEUE, (job) => processQuotePdf(job),
    { connection, concurrency: 2 });
}
```
In `boot()`: declare `new Queue(QUOTE_PDF_QUEUE, { connection })`, stand up the worker, and wire the `failed` handler (clone L128-133):
```typescript
quotePdfWorker.on("failed", (job, err) => {
  reportQuotePdfFailure(err, { quoteId: job?.data.quoteId, attempts: job?.attemptsMade });
});
```
Add both handles to the `boot()` return object. Worker gains new deps: `@react-pdf/renderer@4.5.1`, `qrcode@1.5.4`, `react@19.2.7`, `@imbau/quoting@workspace:*`.

---

### `apps/worker/Dockerfile` (config) — MODIFY

**Analog:** self — the runner-stage `COPY --from=builder --chown=node:node` block (L43-45).

tsup bundles JS only — the `.ttf` will NOT reach `dist/` automatically (Pitfall 1). Add to the runner stage:
```dockerfile
COPY --from=builder --chown=node:node /app/apps/worker/assets ./apps/worker/assets
```
Verify the runtime path resolves relative to `dist/index.js` (the `new URL("../assets/…", import.meta.url)` in quote-pdf-doc must point at the copied `assets/`). Keep the no-prod-install discipline (L41-42).

---

### `apps/web/env.ts` (config) — MODIFY

**Analog:** self — the phase-5 A1 widening (L27-43, DATABASE_APP_URL/ANON_URL server block) + the `MediaEnv` shape (media/runtime.ts L34-42).

D-02 makes the enqueue + presign run in the web process → `apps/web` gains `REDIS_URL` + `R2_*` (Pitfall 3). Add to the `server` block (NEVER `NEXT_PUBLIC_`, T-03-01), reusing the presets already imported by media/runtime.ts:
```typescript
server: {
  ...baseEnv.server,
  DATABASE_ANON_URL: dbEnv.server.DATABASE_ANON_URL,
  DATABASE_APP_URL: dbEnv.server.DATABASE_APP_URL,
  ...redisEnv.server,   // NEW — enqueuePdf producer
  ...r2Env.server,      // NEW — presignPdfGet
  ...sentryEnv.server,
  ...lokiEnv.server,
},
```
Import `redisEnv, r2Env` from `@imbau/config/env/presets`. Values already exist in the staging SOPS `.env` (worker/media use them) — no new secret to generate, but `deploy/compose.staging.yml` needs the `web` service to inherit them (`env_file`) + `depends_on: redis`.

---

### `apps/web/components/cotizador-simulator.tsx` (component, client) — MODIFY

**Analog:** self — the `create` mutation (L103), `readTrpcError` (L62-75), the `softError` state + rendering (L99, L273-280), and the existing button block (L293-312).

Replace the disabled placeholder (L304-311) with the real wiring. Reuse existing patterns:
- `create` mutation already exists (L103) and is already the WhatsApp CTA trigger. Per D-01, retain `quoteId` in client state; the PDF button reuses it or triggers `create` if none. Invalidate the retained `quoteId` on any `{unitId, planId, modalidad}` change (mirror the `seqRef`/selection-effect logic at L110-120).
- Poll via `trpc.quotes.pdfStatus.queryOptions` with TanStack Query `refetchInterval` (~2s, inside nginx `zone=quotes` 10r/s). On `ready:true` → auto-download the presigned `url` (anchor click); fallback "Descargar" button if mobile blocks auto-download.
- Timeout ~30-45s → soft es-AR voseo message reusing the `softError` slot (L273-280): "No pudimos generar el PDF, probá de nuevo en un rato" + button back to initial. WhatsApp CTA stays visible (PDF never the critical path).
- Error branching: reuse `readTrpcError` (L62-75) for 429 tolerance on the poll.

## Shared Patterns

### Idempotency (triple)
**Sources:** `quote-pdf.ts` short-circuit (`if (row.pdfKey) return`) + `quotePdfKey` deterministic overwrite + `quotePdfJobOptions` jobId=quoteId dedup.
**Apply to:** processor, producer, store. The `pdfKey` short-circuit is the source of truth for "already done" — a job may run twice harmlessly. Note Pitfall 5 / Open Q2: confirm BullMQ jobId dedup semantics after terminal failure (consider `removeOnComplete`/`removeOnFail`) so a re-trigger after 5 failed attempts can re-enqueue.

### Tenant safety (worker has no session)
**Source:** `media-store.ts` header + `writeVariants` (withTenant with orgId from payload, never owner/BYPASSRLS).
**Apply to:** `quote-pdf-store.ts` (both read + write), `pdfStatus` procedure. `withTenant(orgId)` sets the transaction GUC satisfying `quotes_tenant.withCheck`. Fence T-03-09: worker/routers import ONLY `withTenant`/`withAnon`/`schema` from `@imbau/db`.

### Lazy producer init (never at import)
**Source:** `packages/api/src/media/runtime.ts` L44-80.
**Apply to:** `packages/api/src/quotes/runtime.ts`. Importing `appRouter` must not open Redis or validate R2 — build clients on first use, fail closed with the var NAME.

### Observable failure
**Source:** `reportMediaFailure` (media.ts L166-177) + boot `on("failed")` (index.ts L128-133).
**Apply to:** `reportQuotePdfFailure` + the quote-pdf worker's failed handler. Sentry + pino, structured fields only, never swallowed (CLAUDE.md).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/worker/src/quote-pdf-doc.ts` | component | transform | First react-pdf document in the repo — new tech. Follow RESEARCH §Code Examples + Pitfalls 1/2/4. |
| `apps/worker/assets/<font>.ttf` | asset | — | First embedded binary asset in the worker. Commit an OFL/Apache TTF (Inter/Roboto/Liberation) with es-AR glyphs; verify license before commit (A1). |

## Metadata

**Analog search scope:** `apps/worker/src`, `packages/api/src`, `packages/storage/src`, `packages/quoting/src`, `packages/db/src/schema`, `apps/web` (env, components, lib).
**Files scanned:** 12 read in full/targeted + 2 grep-verified.
**Pattern extraction date:** 2026-07-05
</content>
</invoke>
