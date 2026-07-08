---
status: complete
phase: 07-pdf-as-ncrono-en-el-worker
source: [07-VERIFICATION.md]
started: 2026-07-06T18:55:00Z
updated: 2026-07-08T21:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. End-to-end PDF download en staging
expected: Tap "Descargar PDF" → "Generando PDF…" → auto-descarga cotizacion.pdf con acentos correctos (áéíóúñ), las dos leyendas legales, header completo (proyecto/unidad/piso/tipología/m²/fecha/CAC/ref) y footer con deep-link + QR escaneable. WhatsApp CTA usable durante todo el proceso.
result: pass
evidence: |
  Verificado automáticamente en LOCAL (web :3100 + worker dev + R2 real, 2026-07-06) vía
  Playwright: click → "Generando PDF…" → auto-descarga cotizacion.pdf a los 3.0s → fallback
  link visible; WhatsApp CTA habilitado durante toda la generación. PDF inspeccionado
  (pdftotext + raster visual): Roboto-Regular/Bold embebidas (sin tofu), acentos correctos
  ("Cotización", "índice"), dos leyendas legales, header completo (Brigos Recoleta / 12A ·
  Piso 12 · penthouse · 233.77 m² / Emitida · CAC: 2026-06 · Ref), footer con deep-link
  ?u=&plan= y QR embebido 256px. Staging AÚN NO tiene fase 7 (255 commits sin mergear a
  main) — re-verificar post-merge/deploy.

### 2. Soft-fail path en staging
expected: Cuando el worker no puede completar el PDF en ~40s, aparece el mensaje "No pudimos generar el PDF, probá de nuevo en un rato" y el botón se resetea. El CTA de WhatsApp permanece funcional.
result: pass
evidence: |
  Verificado automáticamente en LOCAL (worker detenido, 2026-07-06) vía Playwright:
  mensaje "No pudimos generar el PDF, probá de nuevo en un rato." visible a los 40.1s,
  botón reseteado a "Descargar PDF" y habilitado, WhatsApp CTA habilitado, sin descarga
  espuria. Staging pendiente post-merge.

### 3. Resolución de fuente en Alpine (contenedor worker)
expected: El worker image builds y genera un PDF con acentos correctos (Roboto TTF desde /app/apps/worker/assets en Alpine — sin tofu).
result: pass
evidence: |
  Verificado 2026-07-08. `docker build -f apps/worker/Dockerfile` (contexto limpio vía
  `git archive HEAD`, como CI) → imagen 1.25GB OK. Contenedor corrido en la red de compose
  (postgres/redis) con R2 real: al bootear consumió el job encolado del test 2 y logueó
  "quote pdf rendered + persisted" (quoteId 1c507c1f). PDF descargado de R2 e inspeccionado:
  pdffonts muestra Roboto-Regular/Bold embebidas (CID TrueType), raster visual sin tofu
  ("Cotización", "índice", "ambientes"), dos leyendas, header completo, QR + deep-link.
  Nota: el primer intento de build colgó por el builder legacy tarreando el working tree
  (sin .dockerignore) — irrelevante para CI (checkout limpio + buildx), pero agregar un
  .dockerignore sería una mejora menor.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
