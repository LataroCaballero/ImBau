---
status: complete
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
source: [11-VERIFICATION.md]
started: 2026-07-24T21:10:44Z
updated: 2026-07-24T22:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Drag & drop entre columnas del kanban
expected: La tarjeta se mueve visualmente al soltar, guarda vía `leads.updateEstado`, y se asienta; ante un error forzado revierte con la alerta inline. El drop-target muestra el ring cobre.
result: pass

### 2. Prompt de desenlace al entrar en Cerrado (drag + drawer select)
expected: Cerrar sin elegir desenlace es imposible; "Cancelar" deja la tarjeta en su columna de origen; "Guardar desenlace" commitea estado+desenlace y muestra el badge Ganado/Perdido (verde/rojo) en la tarjeta y en el dot del drawer. Probar ambos caminos (drag y el `<select>` del drawer).
result: pass

### 3. Envío real de email vía Resend en staging
expected: Con `RESEND_API_KEY` seteado, un lead nuevo dispara el email es-AR "Tenés un lead nuevo en {Proyecto}" con deep-link funcional a la bandeja del proyecto. (En verificación sólo se ejerció el fallback dev-console; falta el envío real end-to-end.)
result: pass
note: "Inicialmente FALLÓ (blocker G-11-3): el worker construido con tsup inlineaba react-dom/server (CJS) en el bundle ESM → 'Dynamic require of react' y luego 'Cannot find package react-dom'. Fix aplicado en sesión (bypass autorizado): apps/worker/tsup.config.ts externaliza react/react-dom/react-dom/server + apps/worker/package.json declara react-dom como dep directa (pnpm lo linkea). Verificado E2E dos veces: (1) worker con key dummy renderiza OK y llega hasta Resend ('API key is invalid'); (2) usuario con key real recibió el mail en imbautech@gmail.com."

### 4. Comportamientos de overflow/backstop en viewport angosto (UI-SPEC)
expected: En un viewport de laptop angosto — el board scrollea horizontalmente con columnas de 320px intactas; un nombre/contacto largo trunca con tooltip `title` funcional sin romper el min-height de 88px de la tarjeta; una nota libre larga wrappea dentro del drawer sin empujar el form de nota fuera de vista; y el timeline del drawer scrollea internamente en viewport corto mientras header/form de nota quedan visibles.
result: pass

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-11-3
  truth: "Con RESEND_API_KEY seteado, un lead nuevo dispara y ENVÍA el email es-AR de notificación (render server-side vía react-dom/server) en el worker construido con tsup — el mismo artefacto que corre en staging."
  status: resolved
  resolved_by: "in-session fix (bypass autorizado) — apps/worker/tsup.config.ts + apps/worker/package.json"
  resolved_at: 2026-07-24
  reason: "User reported: el worker construido (tsup) falla con 'Dynamic require of react is not supported' al renderizar el template; el email nunca se envía. Latente: solo aparece con una RESEND_API_KEY real (el fallback dev-console retorna antes de renderizar)."
  severity: blocker
  test: 3
  root_cause: "apps/worker/tsup.config.ts inlinea @imbau/api (noExternal:[/^@imbau//]) y con él react-dom/server (CJS) dentro del bundle ESM único; react/react-dom no figuran en `external`, por lo que el require('react') interno de react-dom/server falla bajo ESM — misma clase de bug que el config ya documenta para pino."
  artifacts:
    - path: "apps/worker/tsup.config.ts"
      issue: "external solo lista pino/pino-loki/pino-pretty; faltan react, react-dom (y la cadena de render @react-email) → react-dom/server se inlinea y su require('react') CJS rompe bajo ESM."
  missing:
    - "Agregar react, react-dom (y @react-email/render / react-dom/server según haga falta) a `external` en apps/worker/tsup.config.ts, replicando el precedente de pino; asegurar que el runner image lleve esos módulos en node_modules."
    - "Verificar E2E: worker construido + RESEND_API_KEY real → un lead nuevo envía el email sin el ReferenceError/Dynamic-require."
