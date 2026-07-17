# Phase 7: PDF asíncrono en el worker - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-05
**Phase:** 7-PDF asíncrono en el worker
**Areas discussed:** Flujo de descarga y espera, Contenido y diseño del PDF, Fallos y regeneración

---

## Flujo de descarga y espera

### ¿WhatsApp y PDF comparten la misma cotización emitida?

| Option | Description | Selected |
|--------|-------------|----------|
| Reusar quoteId (Recomendado) | El primer trigger emite (create) y la UI guarda el quoteId; el segundo lo reusa; cambiar inputs invalida | ✓ |
| Cada acción emite la suya | Más simple, pero duplica snapshots y el PDF podría divergir del mensaje | |
| Vos decidís | Claude elige y documenta | |

**User's choice:** Reusar quoteId

### ¿Cómo espera el comprador mientras el worker genera el PDF?

| Option | Description | Selected |
|--------|-------------|----------|
| Polling + auto-descarga (Recomendado) | Botón "Generando PDF…" + polling hasta pdfKey + descarga automática | ✓ |
| Botón "Listo para descargar" | Segundo tap manual, evita bloqueos de auto-descarga mobile | |
| Vos decidís | Puede combinar auto-descarga con fallback a botón | |

**User's choice:** Polling + auto-descarga (con fallback a botón si el navegador la bloquea, a discreción de Claude)

### ¿Cómo se sirve el PDF desde R2?

| Option | Description | Selected |
|--------|-------------|----------|
| Presigned GET (Recomendado) | URL firmada de corta vida, descarga directa de R2, cero bytes por el server | ✓ |
| Proxy por el server | Route de apps/web streamea; URL estable pero carga al server | |
| Vos decidís | Según research sobre presigned GET en R2 | |

**User's choice:** Presigned GET

### ¿Cuándo se encola el job de PDF?

| Option | Description | Selected |
|--------|-------------|----------|
| En cada create (Recomendado) | Toda cotización emitida encola su render; PDF probablemente listo al pedirlo; cableado anticipado por D-13 fase 5 | ✓ |
| Solo cuando piden PDF | Lazy — sin renders desperdiciados, pero espera completa y variante en el contrato del API | |
| Vos decidís | Claude documenta el trade-off | |

**User's choice:** En cada create

---

## Contenido y diseño del PDF

### ¿Solo la modalidad cotizada o comparación contado vs financiado?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo modalidad emitida (Recomendado) | Mismo snapshot, mismas cifras que WhatsApp/pantalla; cero cambios al contrato de fase 5 | ✓ |
| Comparación completa | Más vendedor, pero requiere ampliar el snapshot en create (bump del envelope) | |
| Vos decidís | Fidelidad al contrato vs valor comercial | |

**User's choice:** Solo modalidad emitida

### ¿Qué estética lleva el PDF?

| Option | Description | Selected |
|--------|-------------|----------|
| Marca en versión print (Recomendado) | Fondo claro, tipografías de marca embebidas, acento cobre, logo | |
| Dark literal al brand book | Grafito de fondo — imprime mal, pesa más | |
| Neutro minimalista | Documento técnico sobrio sin branding fuerte | ✓ |

**User's choice:** Neutro minimalista
**Notes:** Elección deliberada CONTRA la recomendación (marca print). El wow vive en la pantalla; el PDF es el papel serio. Fuente embebida obligatoria igual por acentos (PDF-02).

### ¿Qué datos identificatorios lleva el encabezado?

| Option | Description | Selected |
|--------|-------------|----------|
| Completo (Recomendado) | Proyecto, unidad (identificador, piso, tipología, m²), fecha, período CAC, referencia corta | ✓ |
| Mínimo | Proyecto + unidad + fecha | |
| Vos decidís | Según lo que el snapshot contiene | |

**User's choice:** Completo

### ¿El PDF incluye el deep-link al cotizador online?

| Option | Description | Selected |
|--------|-------------|----------|
| Link como texto (Recomendado) | URL clickeable en el pie | |
| Link + QR | Texto + QR — útil impreso en showroom físico; suma dependencia de QR en el worker | ✓ |
| Sin link | Documento cerrado | |

**User's choice:** Link + QR
**Notes:** Elegido por el caso de uso físico (PDF impreso en showroom).

---

## Fallos y regeneración

### Si el PDF no llega, ¿qué ve el comprador?

| Option | Description | Selected |
|--------|-------------|----------|
| Mensaje suave + reintentar (Recomendado) | Tras ~30-45s: mensaje es-AR voseo + botón vuelve a estado inicial; WhatsApp siempre visible | ✓ |
| Derivar a WhatsApp | Convierte el fallo en contacto, pero promete envío manual que nadie opera | |
| Vos decidís | Claude define copy y comportamiento | |

**User's choice:** Mensaje suave + reintentar

### Una vez generado, ¿se regenera alguna vez?

| Option | Description | Selected |
|--------|-------------|----------|
| Congelado para siempre (Recomendado) | pdfKey seteado → short-circuit + entrega inmediata; foto auditable coherente con snapshot inmutable | ✓ |
| Regenerable | Re-render/overwrite posible pero rompe la semántica punto-en-el-tiempo | |
| Vos decidís | Claude fija la semántica | |

**User's choice:** Congelado para siempre

---

## Claude's Discretion

- Librería de render PDF (candidata @react-pdf/renderer, sin Chromium) + fuente exacta a embeber (constraint Alpine + acentos).
- Lib de QR y su integración.
- Mecánica del reuso de quoteId en el cliente y shape/nombres del endpoint de status (tRPC bajo quotes.* vs route handler).
- Intervalo/timeout del polling, TTL del presigned GET.
- Cómo obtiene el worker los descriptores de unidad/proyecto (extender snapshot vs read withTenant) — montos siempre solo-snapshot.
- Detalle del short-circuit de idempotencia y semántica de re-enqueue BullMQ con jobId repetido.
- Layout exacto del documento, copy es-AR final.

## Deferred Ideas

- Comparación contado vs financiado dentro del PDF (requeriría congelar ambas corridas en el snapshot).
- Branding por tenant del PDF (`projects.branding`, fases posteriores del maestro).
- Envío del PDF por email/WhatsApp server-side (requiere leads/contacto).
- Regeneración de PDFs ante cambios de template (descartada; técnicamente posible vía re-enqueue manual).
