---
status: complete
phase: 03-seed-del-edificio-ficticio
source: [03-VERIFICATION.md]
started: 2026-07-01T17:15:15Z
updated: 2026-07-01T19:20:00Z
---

## Current Test

[testing complete]

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
result: pass
evidence: |
  Ejecutado 2026-07-01 por Claude con credenciales R2 reales (apps/worker/.env) contra
  imbau_test + worker local (tsx apps/worker/src/index.ts, Redis :6380):
  - `vitest run seed.media` → 2/2 passed (88.6s): (1) toda media sembrada resuelve
    resolveMedia().isReady === true con srcset AVIF/WebP no vacíos, blurhash y dims > 0;
    (2) segunda corrida completa de runSeed() dejó el conteo de filas media sin cambios.
  - DB: la org del seed (bb9867e6-8b0d-5509-adf3-54298e3547ba) tiene exactamente 13 filas
    de media, 13/13 con variants != '{}' (8–12 variantes c/u), blurhash poblado y
    width/height > 0 (800×600 y 1600×1067).
  - Worker log: 13 × "media processed (variants + blurhash persisted)".

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
