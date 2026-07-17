---
status: complete
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md]
started: 2026-07-17T21:34:00Z
updated: 2026-07-17T21:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. QUOTE-03 — Edge rate-limit 429 burst en staging + parity conf (DEBT-02 crit. 2, v1.2 D-12)
expected: Una ráfaga concurrente al endpoint anónimo `quotes.compute` devuelve 429 para el excedente por encima de rate=10r/s + burst=20 (nodelay), con CERO 503; los requests dentro del presupuesto pasan al app como respuestas tRPC reales (ya no el 404 pre-merge); la zona `quotes` queda registrada en el error.log; el vhost del box es idéntico a la fuente de verdad del repo y sobrevive la ráfaga (web 200 / panel 307).
result: pass
evidence: |
  Ejecutado por Claude el 2026-07-17 (curl local + SSH root@31.97.175.128, key id_vps_andescode).

  RÁFAGA (100 POSTs paralelos con reuso de conexión, curl --parallel, Content-Type: application/json)
  a https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1 — distribución de status:
    429 = 77   (rechazados por nginx: cuerpo HTML "429 Too Many Requests", nginx/1.24.0)
    400 = 21   (pasaron al app: tRPC BAD_REQUEST real — httpStatus 400, path "quotes.compute")
    503 = 0    ✓ contrato exacto (429, nunca 503)
    404 = 0    ✓ ya NO es el 404 pre-merge — fase-5 está viva post-merge (22d1e96)
  Nota (cross-ref 05-UAT): en 05-UAT los que pasaban daban 404 porque la imagen web era pre-fase-5;
  ahora dan tRPC BAD_REQUEST 400 (input vacío deliberado) = el limitador actúa en nginx antes de
  proxear y el app fase-5 responde de verdad. Un primer intento con `xargs -P 20`/40 reqs dio 40×415
  sin 429 (el setup TLS por-request espació la llegada bajo el refill de 10r/s); con reuso de conexión
  y concurrencia real (--parallel-max 100) el límite dispara determinísticamente.

  BORDE (una a cada lado del umbral): tras enfriar, un único POST in-budget → 400 (pasa al app, tRPC real).
  Bajo concurrencia toda rechazo fue 429, nunca 503 (garantía backstop).

  ZONA LOGUEADA (SSH, /var/log/nginx/error.log):
    2026/07/17 21:36:35 [error] ... limiting requests, excess: 20.820 by zone "quotes",
      client: 181.21.197.49, server: staging.tours.andescode.com.ar,
      request: "POST /api/trpc/quotes.compute?batch=1 HTTP/2.0"
    (156 líneas de zona "quotes" con fecha de hoy — todas de las ráfagas de esta UAT)

  PARIDAD BOX↔REPO (v1.2 D-12): `diff` de /etc/nginx/sites-available/staging.tours.andescode.com.ar
  (box, 8581 bytes) contra deploy/nginx/staging.tours.andescode.com.ar.conf (repo, 8581 bytes) →
  IDÉNTICOS (diff limpio, mismos sha de contenido). Líneas load-bearing en el box:
    limit_req_zone $binary_remote_addr zone=quotes:10m rate=10r/s;
    location ^~ /api/trpc/quotes {  limit_req zone=quotes burst=20 nodelay;  limit_req_status 429; }
  No hubo tuneo en el box → NO se necesitó sync-back al repo (D-12 OK).

  VHOST INTACTO post-ráfaga: web `/` = 200, panel `/` = 307 (redirect a login, normal).

### 2. End-to-end PDF flow + QR/deep-link en staging (DEBT-02 crit. 3-4, D-11)
expected: Crear una cotización para una unidad seedeada de 'Brigos Recoleta' → `quotes.pdfStatus` reporta ready → descarga de `cotizacion.pdf` desde su URL presignada de R2 → pdffonts muestra Roboto embebida (sin tofu); pdftotext contiene los glifos es-AR "Cotización"/"índice", las dos leyendas legales y el header completo; el deep-link del footer apunta a `https://staging.tours.andescode.com.ar/...` (no localhost, no host pre-fase-5).
result: pass
evidence: |
  Ejecutado por Claude el 2026-07-17 (curl local contra staging + SSH para IDs del seed).

  IDs del seed (SSH psql read-only, imbau-staging-postgres-1):
    projectId = 491ba0c9-b47f-59fc-8fb3-520a86b142dc  (brigos-recoleta, estado=publicado)
    unitId    = 055e07e9-723a-52f1-9c26-4abaa5779921  (unidad 5B, precios USD contado+financiado)
    planId    = 9c1c8c90-4744-5c02-8899-35c05ab3039d  (Financiado 20/80 CAC 48 cuotas — ejercita CAC)

  CREATE (POST /api/trpc/quotes.create?batch=1, sin transformer → body {"0":{...}} directo):
    → result.quoteId = 5d67277a-1046-403d-aacb-42fc923968e3
    → result: precioUsd 151420, anticipoUsd 30284, saldoUsd 25136, 48 cuotas, primera cuota ARS 343.967.391,03

  POLL quotes.pdfStatus (GET, query): ready=True en el primer poll (t≈2s) — el worker ya había
    consumido el job. url presignada → host imbau.<hash>.r2.cloudflarestorage.com (R2 real).
    Descarga: cotizacion.pdf, "PDF document, version 1.3, 1 pages".

  pdffonts cotizacion.pdf:
    TCCJPO+Roboto-Bold      CID TrueType  Identity-H  emb=yes sub=yes uni=yes
    LPELWI+Roboto-Regular   CID TrueType  Identity-H  emb=yes sub=yes uni=yes
    → ambas embebidas y subsetadas (sin tofu).

  pdftotext -layout cotizacion.pdf - (texto real):
    Brigos Recoleta
    5B · Piso 5 · 2 ambientes · 51.19 m²
    Emitida: 17/07/2026 · CAC: 2026-06 · Ref: 5D67277A
    Precio financiado ... US$ 151.420 | Anticipo US$ 30.284 | Cuotas 48 | Primera cuota $ 343.967.391,03
    Cotización no vinculante.
    Las cuotas se ajustan por el índice CAC vigente al mes de pago.
    https://staging.tours.andescode.com.ar/p/brigos-recoleta/cotizador?u=055e07e9-...&plan=9c1c8c90-...
  Chequeos: "Cotización" ✓, "índice" ✓, "m²" ✓ (glifos es-AR ó/í/² correctos); header completo
    (proyecto/unidad/piso/ambientes/m²/fecha/CAC/ref) ✓; las DOS leyendas legales
    ("Cotización no vinculante." + leyenda de ajuste CAC) ✓.

  DEEP-LINK (D-11): extraído del texto → arranca con https://staging.tours.andescode.com.ar/ ✓
    (host de staging, con u=<unitId> y plan=<planId> correctos; NO localhost, NO host pre-fase-5).
  QR (D-11, opcional): PDF rasterizado con pdftoppm (qrpage-1.png, QR embebido visible), pero no hay
    decoder local (pyzbar/cv2/zbarimg ausentes en la máquina). Per D-11 el decode del QR es opcional
    y la aserción requerida es el deep-link de texto, que PASA — el QR codifica ese mismo deep-link ya
    verificado contra el host de staging. Decode del QR queda como no-corrido (tooling ausente), sin
    afectar el criterio.

### 3. Surface smoke de superficies vivas (DEBT-02, D-04)
expected: web `/` = 200, `/p/brigos-recoleta/cotizador` = 200, panel login = 307; worker vivo sin crash-loop; Loki/Sentry recibiendo ingest reciente.
result: pass
evidence: |
  Ejecutado por Claude el 2026-07-17 (curl local + SSH read-only al VPS compartido; D-08: sin tocar
  nginx/host de prod, sin matar procesos, sólo inspección).

  Superficies HTTP:
    web  https://staging.tours.andescode.com.ar/                         → 200
    coti https://staging.tours.andescode.com.ar/p/brigos-recoleta/cotizador → 200
    panel https://panel.staging.tours.andescode.com.ar/                   → 307 (redirect a login)

  Contenedores (docker compose ps, imbau-staging): web/panel/worker Up 15m (post-deploy 22d1e96),
  postgres healthy, redis/loki/grafana/uptime-kuma Up.
  Worker: `docker inspect imbau-staging-worker-1` → restarts=0, state=running (sin crash-loop),
  started 2026-07-17T21:22:02Z.

  Loki recibiendo (query desde la red de compose, http://loki:3100):
    label service_name/values → ["worker"]
    query {app=~".+"} últimos 15m → 1 stream (worker) con línea pino estructurada level=30 conteniendo
    nuestro quoteId 5d67277a; filtro |= "5d67277a" → 1 match:
      {"level":30,"time":1784324339478,"pid":1,"quoteId":"5d67277a-1046-403d-aacb-42fc923968e3",
       "organizationId":"bb9867e6-8b0d-5509-adf3-...
    → el worker consumió el job y logueó a Loki en vivo (ingest confirmado con nuestro quoteId real).
    Nota: `docker compose logs worker` sale vacío porque el worker usa el log-driver de Loki (los logs
    van directo a Loki, no a json-file) — consistente con "Loki recibiendo".
  Sentry: 0 líneas de error de init de Sentry en logs web/worker (últimos 20m) — SDK sano.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- **QR decode no corrido (tooling ausente, no-fail):** la máquina de verificación no tiene decoder de
  QR local (pyzbar/cv2/zbarimg). Per D-11 el decode es opcional; la aserción requerida es el deep-link
  de texto, verificado contra `https://staging.tours.andescode.com.ar/`. El QR embebido codifica ese
  mismo deep-link. No bloquea DEBT-02.
- **Pasada visual humana de fase 6 (v1.2) — DIFERIDA (D-06), no fallada:** el layout mobile-first + tema
  de marca del cotizador en viewport real sigue trackeado en Deferred Items (STATE.md) para
  `/gsd-verify-work 6`. Requiere ojos humanos; fuera de alcance de esta fase infra/ops.
