---
status: testing
phase: 01-monorepo-foundation
source: [01-VERIFICATION.md]
started: 2026-06-13T03:20:00Z
updated: 2026-06-13T03:20:00Z
---

## Current Test

number: 1
name: Status page de apps/web se renderiza en es-AR con AppStatus de @imbau/ui
expected: |
  En dev (NEXT_PUBLIC_APP_ENV=development), http://localhost:3000 muestra "ImBau · Web",
  el componente AppStatus de @imbau/ui ("Estado: en línea"), "Entorno: development" y
  "El entorno se validó correctamente al iniciar."
awaiting: user response

## Tests

### 1. Status page web (es-AR + arista app → ui)
expected: La página muestra "ImBau · Web", "Estado: en línea" (AppStatus de @imbau/ui), "Entorno: development" y "El entorno se validó correctamente al iniciar."
result: [pending]
orchestrator_precheck: PASSED — confirmado en vivo con `next dev` + curl. Como el :3000 estaba ocupado por otra app (CLINICAL), se levantó web en :3005 y devolvió GET / 200 con todo el contenido es-AR esperado (el valor del env renderiza separado por el marcador `<!-- -->` de React). El build también prerenderiza la página como estática.

### 2. apps/panel corre en :3001 (no :3000)
expected: La app arranca en http://localhost:3001 con la status page "ImBau · Panel".
result: [pending]
orchestrator_precheck: PASSED — confirmado en vivo: `pnpm --filter @imbau/panel dev` (script `next dev -p 3001`) sirvió "ImBau · Panel" + "Estado: en línea" en :3001 con GET / 200.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

(ninguno — ambos ítems pre-confirmados por el orquestador vía dev server en vivo; falta solo el sign-off humano formal vía /gsd-verify-work)
