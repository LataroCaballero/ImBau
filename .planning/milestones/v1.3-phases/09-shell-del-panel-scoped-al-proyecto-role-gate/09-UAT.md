---
status: complete
phase: 09-shell-del-panel-scoped-al-proyecto-role-gate
source: [09-VERIFICATION.md]
started: 2026-07-21T20:48:04Z
updated: 2026-07-21T21:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Navegación del shell (owner/developer)
expected: Con `pnpm dev` up, logueado como owner/developer en `/proyectos/[id]/unidades`, se ven las tres tabs (Unidades / Leads / Hotspots), la tab activa lleva el indicador `aria-current="page"`, y se muestra el placeholder es-AR bajo el heading del proyecto.
result: pass

### 2. Deep-link cross-org / inexistente → 404 es-AR uniforme (no-enumeración)
expected: Deep-link a un id de proyecto de otra org (o un uuid aleatorio inexistente) en `/proyectos/[id]/unidades` renderiza el boundary 404 es-AR ("No encontramos ese proyecto.") de forma idéntica para ambos casos — sin distinción 403/404, sin stack trace, sin 500. (Nota: el fix WR-01 movió el boundary a `app/proyectos/not-found.tsx` para que efectivamente pinte el 404 es-AR y no el 404 default en inglés.)
result: pass

### 3. Viewer no ve la afordancia de escritura
expected: Logueado como viewer, las tres tabs son accesibles en modo lectura; el párrafo placeholder de la afordancia de escritura ("Acá vas a poder…") NO se renderiza para el rol viewer.
result: pass

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
