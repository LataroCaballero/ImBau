---
status: testing
phase: 03-seed-del-edificio-ficticio
source: [03-VERIFICATION.md]
started: 2026-07-01T17:15:15Z
updated: 2026-07-01T17:15:15Z
---

## Current Test

number: 1
name: Prueba end-to-end del pipeline de media con R2 + worker reales
expected: |
  Corriendo el seed completo con credenciales R2 reales y el worker activo, cada fila
  de la tabla `media` sembrada por `mediaSeedId()` resuelve con `resolveMedia().isReady === true`:
  arrays srcset AVIF y WebP no vacíos, `blurhash` no vacío, y `width`/`height` > 0. Una segunda
  corrida completa del seed deja el conteo de filas de `media` sin cambios (idempotencia live-R2).
awaiting: user response

## Tests

### 1. Live-R2 media pipeline end-to-end (SEED-03 / D-04)
expected: |
  Con R2 + worker arriba, cada media sembrada resuelve isReady=true (srcset AVIF/WebP no vacío,
  blurhash poblado, dims > 0) y una segunda corrida no agrega filas de media.
steps: |
  1. Export de credenciales R2 + Redis:
     R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, REDIS_URL
     (más el preamble de Node 22 + DATABASE_* apuntando a la DB de dev/test).
  2. `docker compose up -d postgres redis worker` — el worker debe consumir MEDIA_QUEUE.
  3. `pnpm db:migrate` (si la DB no está migrada) y luego `pnpm db:seed`.
  4. Verificar: `pnpm --filter @imbau/db test -- --run seed.media` corre las 2 aserciones del
     bloque `describe.skipIf` (ya NO se saltean) y pasan; o consultar las filas `media` y llamar
     `resolveMedia(row, { publicBaseUrl })` en cada una.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
