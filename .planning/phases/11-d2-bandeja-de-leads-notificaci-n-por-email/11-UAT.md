---
status: testing
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
source: [11-VERIFICATION.md]
started: 2026-07-24T21:10:44Z
updated: 2026-07-24T21:10:44Z
---

## Current Test

number: 1
name: Drag & drop de una tarjeta de lead entre columnas del kanban (mouse), incluyendo el drop-target ring cobre y el feel de optimistic-move-then-confirm.
expected: |
  La tarjeta se mueve visualmente al soltar, guarda vía leads.updateEstado y se asienta
  (o revierte con la alerta inline ante un error forzado).
awaiting: user response

## Tests

### 1. Drag & drop entre columnas del kanban
expected: La tarjeta se mueve visualmente al soltar, guarda vía `leads.updateEstado`, y se asienta; ante un error forzado revierte con la alerta inline. El drop-target muestra el ring cobre.
result: [pending]

### 2. Prompt de desenlace al entrar en Cerrado (drag + drawer select)
expected: Cerrar sin elegir desenlace es imposible; "Cancelar" deja la tarjeta en su columna de origen; "Guardar desenlace" commitea estado+desenlace y muestra el badge Ganado/Perdido (verde/rojo) en la tarjeta y en el dot del drawer. Probar ambos caminos (drag y el `<select>` del drawer).
result: [pending]

### 3. Envío real de email vía Resend en staging
expected: Con `RESEND_API_KEY` seteado, un lead nuevo dispara el email es-AR "Tenés un lead nuevo en {Proyecto}" con deep-link funcional a la bandeja del proyecto. (En verificación sólo se ejerció el fallback dev-console; falta el envío real end-to-end.)
result: [pending]

### 4. Comportamientos de overflow/backstop en viewport angosto (UI-SPEC)
expected: En un viewport de laptop angosto — el board scrollea horizontalmente con columnas de 320px intactas; un nombre/contacto largo trunca con tooltip `title` funcional sin romper el min-height de 88px de la tarjeta; una nota libre larga wrappea dentro del drawer sin empujar el form de nota fuera de vista; y el timeline del drawer scrollea internamente en viewport corto mientras header/form de nota quedan visibles.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
