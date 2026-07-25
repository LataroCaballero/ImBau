# API Coverage — Resend (email transaccional)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
>
> Alcance de la fase 11: enviar **una** notificación transaccional por email
> cuando entra un lead (`sendLeadNotification` → `resend.emails.send`). Reusa el
> mismo patrón dev-console/real de `sendInvitation`. Ninguna otra capacidad de
> Resend forma parte del producto en este momento — todas las demás se marcan
> `OPT-OUT` con motivo, no por olvido.

| capability | decision | reason |
|---|---|---|
| `emails.send` | INTEGRATE | Único uso real: envío transaccional de la notificación de lead (y de la invitación de org). |
| `emails.sendBatch` | OPT-OUT | No se necesita — un lead genera un email; sin envíos masivos. |
| `emails.get` / `emails.update` / `emails.cancel` (scheduled) | OPT-OUT | No programamos ni consultamos/cancelamos emails; envío fire-and-forget vía cola BullMQ. |
| `domains.*` (create/get/verify/list/update/remove) | OPT-OUT | El dominio remitente se verifica una vez en el panel de Resend, fuera de la app; no se gestiona por API. |
| `apiKeys.*` (create/list/remove) | OPT-OUT | Las API keys se gestionan manualmente en el dashboard de Resend; la app solo consume `RESEND_API_KEY`. |
| `audiences.*` (create/get/list/remove) | OPT-OUT | No hay listas/segmentos de marketing — solo transaccional. |
| `contacts.*` (create/get/update/remove/list) | OPT-OUT | Los leads viven en nuestra propia tabla `leads` (Postgres+RLS), no en Resend. |
| `broadcasts.*` (create/get/send/list/update/remove) | OPT-OUT | No hay campañas/newsletters — fuera de alcance del MVP. |

**Nota de fallback:** cuando `RESEND_API_KEY` está ausente (dev/test) no se llama
a ninguna capacidad de Resend; se loguea un resumen público del lead
(to/nombre/origen, nunca el secreto) y se retorna. Esto no es una capacidad de la
API sino el branch dev/prod clonado de `send-invitation.ts`.
