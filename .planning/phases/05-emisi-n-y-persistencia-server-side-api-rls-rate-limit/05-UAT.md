---
status: testing
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
source: [05-VERIFICATION.md]
started: 2026-07-04T22:01:30Z
updated: 2026-07-04T22:01:30Z
---

## Current Test

number: 1
name: QUOTE-03 — Edge rate-limit 429 burst en staging VPS
expected: |
  Aplicar `deploy/nginx/staging.tours.andescode.com.ar.conf` en `root@andescode.com.ar`
  (copiar a sites-available, `nginx -t && systemctl reload nginx` — nunca `certbot --nginx`).
  Luego disparar ~40 POSTs rápidos a
  `https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1`:
  los primeros ~20 pasan (200/4xx del tRPC) y el excedente devuelve **429** (no 503).
  Registrar los estados observados; si se tunean rate/burst en el VPS, sincronizar los
  valores de vuelta al archivo del repo (D-12 — el repo es la fuente de verdad).
awaiting: user response

## Tests

### 1. QUOTE-03 — Edge rate-limit 429 burst en staging VPS
expected: Con la conf aplicada y nginx recargado, una ráfaga de ~40 requests al endpoint anónimo de cotización devuelve 429 para el excedente por encima de rate=10r/s + burst=20 (nodelay); el panel y el resto del vhost no quedan afectados.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
