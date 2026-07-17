---
status: complete
phase: 05-emisi-n-y-persistencia-server-side-api-rls-rate-limit
source: [05-VERIFICATION.md]
started: 2026-07-04T22:01:30Z
updated: 2026-07-04T22:32:30Z
---

## Current Test

[testing complete]

## Tests

### 1. QUOTE-03 — Edge rate-limit 429 burst en staging VPS
expected: Con la conf aplicada y nginx recargado, una ráfaga de ~40 requests al endpoint anónimo de cotización devuelve 429 para el excedente por encima de rate=10r/s + burst=20 (nodelay); el panel y el resto del vhost no quedan afectados.
result: pass
evidence: |
  Ejecutado por Claude vía SSH (root@31.97.175.128, key id_vps_andescode) el 2026-07-04:
  - Backup del vhost previo en /root/staging.tours.andescode.com.ar.bak-20260704-222939.
  - Repo conf copiada a /etc/nginx/sites-available/staging.tours.andescode.com.ar
    (symlink existente en sites-enabled conservado, sin sufijo .conf en el box).
  - `nginx -t` OK (solo warnings preexistentes de otros vhosts) + `systemctl reload nginx`.
  - Ráfaga: 40 POSTs paralelos (xargs -P 20) a
    https://staging.tours.andescode.com.ar/api/trpc/quotes.compute?batch=1
    → 29× 404 (pasaron al app) y 11× 429 (rechazados por nginx). CERO 503.
    Secuencia: primeros 20 pasan (burst=20), luego 429 intercalados con pasajes por
    refill de 10r/s durante la cola de la ráfaga — comportamiento exacto de
    rate=10r/s + burst=20 nodelay + limit_req_status 429.
  - /var/log/nginx/error.log confirma: `limiting requests ... by zone "quotes"`.
  - Post-burst: web 200, panel 307 (redirect a login, normal) — vhost intacto.
  - rate/burst NO se tunearon → el archivo del repo ya es idéntico al del box (D-12 OK).
  Nota: el app respondió 404 (no 200/4xx de tRPC) porque la imagen web de staging es
  a599bb7 (pre-fase-5; PR #1 aún no mergeado a main, y staging deploya desde main).
  Esto NO afecta el test: el limitador actúa en nginx antes de proxear. La ruta tRPC
  de quotes quedará servida en staging al mergear el PR.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
