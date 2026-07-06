---
status: testing
phase: 07-pdf-as-ncrono-en-el-worker
source: [07-VERIFICATION.md]
started: 2026-07-06T18:55:00Z
updated: 2026-07-06T18:55:00Z
---

## Current Test

number: 1
name: End-to-end PDF download en staging
expected: |
  Tap "Descargar PDF" → muestra "Generando PDF…" → auto-descarga cotizacion.pdf con
  acentos correctos (áéíóúñ), las dos leyendas legales, el header completo
  (proyecto/unidad/piso/tipología/m²/fecha/CAC/ref) y el footer con deep-link + QR
  escaneable. WhatsApp CTA usable durante todo el proceso.
awaiting: user response

## Tests

### 1. End-to-end PDF download en staging
expected: Tap "Descargar PDF" → "Generando PDF…" → auto-descarga cotizacion.pdf con acentos correctos (áéíóúñ), las dos leyendas legales, header completo (proyecto/unidad/piso/tipología/m²/fecha/CAC/ref) y footer con deep-link + QR escaneable. WhatsApp CTA usable durante todo el proceso.
result: [pending]

### 2. Soft-fail path en staging
expected: Cuando el worker no puede completar el PDF en ~40s, aparece el mensaje "No pudimos generar el PDF, probá de nuevo en un rato" y el botón se resetea. El CTA de WhatsApp permanece funcional.
result: [pending]

### 3. Resolución de fuente en Alpine (contenedor worker)
expected: El worker image builds y genera un PDF con acentos correctos (Roboto TTF desde /app/apps/worker/assets en Alpine — sin tofu).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
