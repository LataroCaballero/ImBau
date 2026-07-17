# Feature Research

**Domain:** Panel de autogestión para SaaS de preventa inmobiliaria (developer self-service: inventario de unidades, bandeja de leads, editor visual de hotspots) — milestone v1.3 / fase 4 del plan maestro
**Researched:** 2026-07-17
**Confidence:** MEDIUM-HIGH (patrones de inventory-grid / import-CSV / lightweight-CRM / polygon-editor son estándar y bien documentados = HIGH; el corte específico "preventa argentina, ~38 unidades por proyecto, un design partner" es criterio de producto = MEDIUM)

## Contexto que ancla el alcance

Tres hechos del proyecto cambian qué es "table stakes" acá respecto de un CRM inmobiliario genérico:

1. **El schema ya existe (v1.1).** `units.estado` (`disponible|reservado|vendido`), `units.polygon`, `price_lists`, `unit_prices` (con `vigencia`), `payment_plans`, `leads` (con `estado nuevo|contactado|negociación|cerrado`, `origen`, `unit?`, `broker?`, `quote?`, timeline de notas), `floors.polygon`, `media`. Este milestone es **UI + mutations tRPC sobre schema existente**, no diseño de datos.
2. **Escala real: ~38 unidades / 13 pisos por proyecto** (seed Brigos Recoleta). No es un CRM con 10.000 registros — es una grilla pequeña que un humano abarca de un vistazo. Esto degrada varias "features de CRM grande" (vistas guardadas, filtros complejos, virtualización) de table-stakes a innecesarias.
3. **Regla de corte A/B + anti-CRM explícito.** `modelo-mvp.md §2.2` excluye "CRM completo (solo el liviano de D2)". El riesgo #1 de este milestone es *scope creep hacia CRM*. Todo lo que huela a automatización de secuencias, scoring, o pipeline configurable es anti-feature por decisión de producto.

## Feature Landscape

### Table Stakes (Users Expect These)

Features que el developer asume que existen. Sin ellas el panel "no sirve para trabajar".

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **D1 · Grilla de unidades editable** (una fila por unidad: id `4°B`, piso, tipología, m², estado, precio) | Es la razón de ser del panel: "cambio el precio/estado y se refleja". Sin esto el developer sigue dependiendo del operador | MEDIUM | TanStack Table (ya decidido en stack, `shadcn/ui`). ~38 filas → sin virtualización, sin paginación. Ordenar por piso/estado sí |
| **D1 · Inline edit de precio y estado** | Editar el 90% de los casos (un precio, marcar "vendido") debe ser 2 clics, no un modal por campo | MEDIUM | **Inline para precio + estado** (los dos campos que cambian a diario). Modal/drawer solo para editar la unidad completa (tipología, m², ambientes). Ver decisión inline-vs-modal abajo |
| **D1 · Estado con transiciones `disponible→reservado→vendido`** | Es el dato que la web pública muestra en vivo; el flujo estrella del developer ("se vendió el 4°B → vendido") | LOW | Enum ya en schema. Select de 3 opciones. No hace falta máquina de estados rígida — permitir cualquier transición (se puede "des-vender"). Registrar quién/cuándo en el event log |
| **D1 · Precio por lista/forma de pago** (contado USD vs financiado vs lista broker) | El schema tiene `price_lists` + `unit_prices`; un mismo depto tiene precio distinto según forma de pago. Sin esto el cotizador queda desincronizado | MEDIUM-HIGH | La parte más sutil de D1: la grilla es en realidad una **matriz unidad × lista**. MVP: columnas por lista activa, editar la celda crea un nuevo `unit_prices` con `vigencia` (no pisa el histórico). Ver dependencia con cotizador |
| **D1 · Export a Excel** | "El formato en que ya manejan los datos" (`modelo-mvp.md D1`). El developer quiere bajar su inventario y trabajarlo offline | LOW-MEDIUM | `exceljs` o `xlsx` en el worker o server. Export define el template canónico que luego se re-importa (round-trip) |
| **D1 · Import desde Excel con validación** | Carga masiva inicial y ediciones offline; es parte del "onboarding en <1 semana" del operador | HIGH | El feature más caro del milestone. Flujo file→map→validate→preview→submit. Ver sección Excel dedicada abajo |
| **D2 · Bandeja de leads (lista + detalle)** | El lead es el producto que vende el caso ("leads reales generados por el showroom"). Verlos, ordenarlos por fecha, abrir el detalle | LOW-MEDIUM | Lista simple ordenada por `created_at desc`. Detalle = drawer con contacto, origen, unidad/cotización vinculada, timeline de notas |
| **D2 · Origen visible del lead** (broker / unidad / cotización) | Un lead sin contexto es inútil: "¿de qué depto preguntó? ¿qué broker lo trajo?". El schema ya linkea `unit?`/`broker?`/`quote?` | LOW | Solo renderizar los joins existentes. Si vino de una cotización, mostrar link al snapshot/PDF ya emitido |
| **D2 · Estados de pipeline `nuevo→contactado→negociación→cerrado`** | Es "el CRM liviano": mover el lead por 4 estados fijos y no perderlo | LOW | Enum ya en schema. Select o botones. **4 estados fijos, NO configurables** (esa es la línea anti-CRM) |
| **D2 · Notas / timeline por lead** | "Lo llamé, quiere ver el 7°A" — sin esto el developer usa un cuaderno aparte y abandona el panel | LOW-MEDIUM | `leads.timeline` (JSONB) ya en schema. Append-only de notas con fecha/autor |
| **D2 · Aviso por email al llegar un lead nuevo** | Regla de oro inmobiliaria: responder en <5 min multiplica conversión 9x. El developer no vive en el panel | MEDIUM | Resend + React Email (ya en stack). Trigger en el insert de `leads` → job BullMQ → email al owner/developer/broker según origen. Idempotente |
| **Editor de hotspots · Dibujar polígono sobre render** | Es "el contenido es configuración, no código" (§3.1.4). Sin editor, cada proyecto nuevo requiere que yo edite SVG a mano → mata "entrega en semanas" | HIGH | Click-para-agregar-vértices sobre `<img>` de fondo (render de media). Coordenadas normalizadas 0–1 (responsive). Ver sección editor abajo |
| **Editor de hotspots · Editar/borrar polígono y vincularlo a unidad/piso** | Un polígono sin destino no navega a nada; los renders cambian y hay que reajustar | HIGH | Arrastrar vértices, borrar polígono, dropdown "este polígono → unidad X / piso Y". Persistir en `units.polygon` / `floors.polygon` (schema existe) |

### Differentiators (Competitive Advantage)

Features que separan de Urbania3D/Hauzd/Web3D (cuyo modelo es "servicio hecho a mano en meses"). Alinean con el Core Value: autogestión real + entrega en semanas.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Export → editar → import round-trip fiel** | El developer trabaja en la herramienta que ya usa (Excel) y sube; el export es exactamente el template de import. Elimina el "column mapping wizard" en el caso común | MEDIUM | El export debe incluir un id oculto/estable por unidad (o el identificador `4°B`) como clave de upsert → el import matchea por clave, no crea duplicados. Diferenciador barato sobre el import |
| **Dry-run / preview del import antes de escribir** | "Se van a cambiar 12 precios, 3 estados; fila 7 tiene un error" antes de commitear. Da confianza sobre datos de dinero | MEDIUM | Preview = diff (qué cambia por fila), no solo "se importaron N filas". Sobre datos de precio esto es casi table-stakes por el estándar de calidad del proyecto |
| **Bulk edit: ajuste de precio % o fijo sobre selección/lista** | Contexto argentino: "subí todos los USD 3%" o "actualizá la lista financiada". Con inflación/CAC, ajustes masivos son rutina | MEDIUM | Seleccionar filas o una lista completa → aplicar % o monto fijo → preview → confirmar. Muy valioso, pero cae a P2 si aprieta el tiempo (import cubre el caso masivo) |
| **Reflejo "al instante" en la web pública** (SSE/LISTEN-NOTIFY o revalidación on-demand) | User story del developer: "cambia a vendido → la web se actualiza al instante". Es el claim de marketing ("precios en tiempo real") | MEDIUM-HIGH | SSE vía LISTEN/NOTIFY está en el stack, pero el explorador público es fase 2 (posterior). MVP realista: **revalidación ISR on-demand** del cotizador/picker que ya lee unidades publicadas. SSE completo se justifica recién con el explorador. Ver dependencia |
| **Snapping de vértices en el editor de hotspots** (a grilla o a vértices vecinos) | Polígonos prolijos sin pixel-hunting; acelera la carga del operador | MEDIUM | Diferenciador puro. No bloquea nada. Agregar solo si el editor base quedó sólido |
| **Preview en vivo del hotspot** (hover resalta el polígono como se verá público) | El operador ve exactamente lo que verá el comprador; reduce iteraciones | LOW-MEDIUM | Barato una vez que el render de polígonos existe; reusar el mismo componente SVG del explorador futuro |

### Anti-Features (Commonly Requested, Often Problematic)

La amenaza central del milestone: deslizarse hacia un CRM completo o un editor tipo Figma.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Pipeline / estados de lead configurables por el developer** | "Cada inmobiliaria tiene su proceso" | Explota el schema, la UI y el testing; es exactamente "CRM completo" excluido en §2.2. Nadie con 38 unidades necesita estados custom | 4 estados fijos `nuevo/contactado/negociación/cerrado`. Punto |
| **Secuencias automáticas de follow-up (drip email/SMS, recordatorios, scoring)** | Los CRM grandes (Follow Up Boss, HubSpot) lo tienen | Es un producto entero. Requiere motor de automatización, plantillas, opt-out, deliverability. Fuera del MVP explícitamente | Un único email transaccional "tenés un lead nuevo". Las alertas de interés (D6) son otro milestone |
| **Asignación/routing de leads entre vendedores, permisos por vendedor** | "Mi equipo de ventas" | Multi-usuario de ventas con reglas es CRM enterprise; el design partner es un developer chico | El lead llega por email según origen (broker→su WhatsApp/email). Owner ve todo. Sin routing rules |
| **Column-mapping wizard completo estilo Flatfile (mapear cualquier Excel arbitrario)** | "Que importe cualquier planilla del cliente" | Cada developer trae un formato distinto → wizard genérico es semanas de trabajo y bugs infinitos (celdas combinadas, fórmulas, multi-hoja) | Template canónico descargable = el export. Auto-match de headers con confirmación. El operador normaliza al template una vez |
| **Import que parsea fórmulas, celdas combinadas, múltiples hojas, formatos regionales de número** | "Mi Excel tiene todo eso" | Fuente inagotable de bugs sobre datos de dinero; viola el estándar "un error de cálculo mata el producto" | Aceptar solo el template plano (una hoja, headers conocidos, números crudos). Rechazar con error claro lo que no matchea |
| **Editor de hotspots con curvas bezier / trazo libre / capas / auto-detección por IA** | "Que quede pixel-perfect / que detecte los deptos solo" | Un editor vectorial completo es un producto; la auto-detección IA es I+D. Los polígonos de un plano son rectas simples | Polígonos de vértices rectos (click points + drag). Sin curvas. Sin IA |
| **Historial de precios visible / auditoría completa en la grilla** | "Quiero ver cómo evolucionó el precio" | `unit_prices.vigencia` ya guarda el histórico; exponerlo con UI de timeline por celda es sobre-ingeniería para v1.3 | Escribir el histórico correctamente (nueva fila con vigencia). Exponer la UI de auditoría recién si un cliente lo pide |
| **Realtime bidireccional / colaboración multi-cursor en la grilla** | "Que dos personas editen a la vez" | Un solo developer edita su inventario; CRDT/OT es complejidad sin usuario | Optimistic update + last-write-wins. TanStack Query invalida tras la mutation |
| **Reservas online con seña/pago desde el panel** | El estado "reservado" sugiere flujo de reserva | §2.2 excluye "reserva online con pagos" | `reservado` es solo un estado manual que pone el developer. Sin pagos, sin timers |

## Feature Dependencies

```
[Schema v1.1: units/price_lists/unit_prices/payment_plans/leads/floors.polygon/media]
    │  (ya existe — este milestone consume, no crea)
    │
    ├──habilita──> [D1 Grilla editable]
    │                   ├──requires──> [TanStack Table + tRPC mutations bajo withTenant/RLS]
    │                   ├──enables───> [Export Excel] ──define template──> [Import Excel]
    │                   │                                                      └──requires──> [validación + dry-run preview]
    │                   └──enables───> [Bulk edit % / fijo]
    │
    ├──habilita──> [D2 Bandeja de leads]
    │                   ├──requires──> [render de joins origen (broker/unit/quote)]
    │                   ├──requires──> [Email nuevo-lead: Resend + React Email + job BullMQ]
    │                   └──requires──> [timeline de notas (leads.timeline JSONB)]
    │
    └──habilita──> [Editor de hotspots]
                        ├──requires──> [render de fondo (media pipeline v1.1)]
                        ├──requires──> [componente SVG draw/edit/delete + coords normalizadas]
                        ├──requires──> [linking polígono → unit/floor]
                        └──ENABLES───> [Explorador público fase 2] (dependencia downstream: sin polígonos no hay explorador)

[Reflejo "al instante" en web pública]
    ├──depends on──> [D1 (cambia el estado)]
    └──conflicts/defers──> [SSE completo] espera al [Explorador fase 2]; en v1.3 basta revalidación ISR on-demand del picker/cotizador

[Cotizador v1.2 ya en prod]
    └──consume──> [unit_prices / payment_plans que D1 edita]  ← D1 debe mantener el snapshot del cotizador coherente
```

### Dependency Notes

- **Import Excel requiere Export Excel primero:** el export define el template canónico y provee la clave de upsert (identificador de unidad). Construir import sin export estable = column mapping arbitrario (anti-feature). Orden de fases: export → import.
- **Import requiere el dry-run/preview en el mismo entregable:** sobre datos de dinero, escribir sin preview viola el estándar de calidad del proyecto. No son features separables.
- **D1 toca `unit_prices`/`payment_plans` que el cotizador v1.2 ya lee:** editar precios debe respetar el mismo modelo de vigencia y no romper el snapshot auditable de cotizaciones ya emitidas (los snapshots son inmutables; cambiar un precio hoy no reescribe cotizaciones viejas). Verificar en integración.
- **Email de lead nuevo se dispara sobre el insert anónimo de `leads`** (la web pública inserta el lead vía rol anon con rate-limit). El worker/job corre bajo `withTenant` para resolver destinatarios. Reusa el patrón async idempotente ya probado en el PDF (BullMQ jobId dedup).
- **Editor de hotspots es dependencia HARD del explorador (fase 2, siguiente milestone):** sin polígonos cargados no hay nada que explorar. Por eso está en este milestone aunque su "consumidor" sea el próximo. El componente de render SVG debería diseñarse para reusarse en ambos lados (editor y explorador).
- **Reflejo "al instante" conflicto con timing de SSE:** el explorador público (donde más se nota el realtime) es fase 2. En v1.3 el único consumidor público de estado/precio es el picker del cotizador → alcanza revalidación ISR on-demand. No construir la tubería SSE completa acá; diferirla a fase 2 evita over-engineering.

## MVP Definition

### Launch With (v1.3)

Lo mínimo para que el developer "administre su proyecto sin tocar código ni depender del operador".

- [ ] **D1 · Grilla editable con inline edit de precio + estado** — el flujo estrella del developer; sin esto no hay panel
- [ ] **D1 · Precio por lista/forma de pago con vigencia** — sin esto el cotizador queda desincronizado del panel
- [ ] **D1 · Export Excel (template canónico)** — habilita el round-trip y es barato
- [ ] **D1 · Import Excel con validación + dry-run preview** — carga masiva y "onboarding <1 semana"; el más caro pero es table-stakes del operador
- [ ] **D2 · Bandeja de leads: lista + detalle + origen + estados + notas** — el lead es lo que vende el caso
- [ ] **D2 · Email al llegar lead nuevo** — responder rápido es el ROI del showroom
- [ ] **Editor de hotspots: dibujar/editar/borrar polígono + vincular a unit/floor** — habilita fase 2, es "contenido = configuración"

### Add After Validation (v1.x — cuando el import base esté sólido)

- [ ] **Bulk edit % / monto fijo sobre selección o lista** — trigger: el developer pide ajustar muchos precios a la vez (inflación). El import ya cubre el caso extremo, así que es P2
- [ ] **Diff enriquecido en el preview de import** (qué cambia campo por campo) — trigger: si el preview simple "N filas" genera errores en producción
- [ ] **Snapping + preview-hover en el editor de hotspots** — trigger: el operador se queja de que dibujar es lento/impreciso
- [ ] **Reflejo SSE en vivo** — trigger: llega la fase 2 (explorador), donde el realtime se nota de verdad

### Future Consideration (v2+ / otros milestones)

- [ ] **UI de auditoría de histórico de precios** — defer: `vigencia` ya guarda el dato; exponerlo espera demanda real
- [ ] **D4 Métricas / D6 Alertas / D5 Configuración** — explícitamente fuera de este milestone (fase 6)
- [ ] **Cualquier automatización de leads (secuencias, scoring, routing)** — defer indefinido: es "CRM completo", fuera del producto

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| D1 grilla + inline edit precio/estado | HIGH | MEDIUM | P1 |
| D1 precio por lista/forma de pago (vigencia) | HIGH | MEDIUM-HIGH | P1 |
| D1 export Excel | MEDIUM | LOW | P1 |
| D1 import Excel + validación + dry-run | HIGH | HIGH | P1 |
| D2 bandeja leads (lista/detalle/origen/estados/notas) | HIGH | MEDIUM | P1 |
| D2 email lead nuevo | HIGH | MEDIUM | P1 |
| Editor hotspots draw/edit/delete + linking | HIGH | HIGH | P1 |
| Bulk edit % / fijo | MEDIUM-HIGH | MEDIUM | P2 |
| Reflejo "al instante" (revalidación ISR) | MEDIUM | MEDIUM | P2 |
| Snapping / preview-hover hotspots | LOW-MEDIUM | MEDIUM | P2 |
| SSE realtime completo | MEDIUM | HIGH | P3 (fase 2) |
| Pipeline/estados configurables, automatización leads | (anti) | — | NO |

**Priority key:** P1 = must-have para el milestone · P2 = agregar si el tiempo lo permite / post-validación · P3 = milestone futuro

## Detalle por área

### (1) Grilla de unidades + Excel

- **Inline vs modal:** inline para los 2 campos de alta frecuencia (**precio, estado**); modal/drawer para editar la unidad entera (tipología, m², ambientes, orientación, orden). Regla estándar de UX de grillas: editar en la fila lo que se cambia seguido, modal para lo estructural. Con ~38 filas no hace falta virtualización ni paginación.
- **La matriz precio × lista es el punto sutil:** la "grilla de unidades" es realmente unidad × `price_list`. MVP: una columna por lista activa; editar una celda inserta un nuevo `unit_prices` con `vigencia` (append, no update destructivo) para preservar auditoría y no romper snapshots de cotizaciones ya emitidas.
- **Estados:** enum de 3, transiciones libres (permitir des-reservar/des-vender), registrar el cambio en `events`. Sin máquina de estados rígida.
- **Excel — pipeline recomendado (estándar de la industria: file→map→validate→preview→submit):**
  1. **Export = template canónico**, con clave de upsert estable por unidad (identificador `4°B` o id oculto).
  2. **Import:** auto-match de headers contra el template + confirmación; rechazar con error claro lo que no matchea (no wizard genérico).
  3. **Validación client + server**, errores a nivel fila con mensaje accionable ("Fila 7: estado inválido 'vendida'").
  4. **Dry-run / preview** = diff de qué cambia (no solo conteo), especialmente sobre precios.
  5. **Submit** transaccional bajo `withTenant`; resumen con importadas/errores + descarga de filas fallidas.
- **Anti-scope:** un solo sheet plano, sin fórmulas/celdas combinadas/multi-hoja/formatos regionales de número.

### (2) Bandeja de leads (CRM liviano)

- **La línea liviano vs completo:** table-stakes = capturar, ver con contexto, mover por 4 estados fijos, anotar, avisar por email. Todo lo demás (secuencias, scoring, routing, estados configurables, permisos por vendedor) es CRM completo = fuera.
- **Origen es el diferencial de utilidad:** un lead que dice "vino del 4°B, lo trajo broker García, ya cotizó anticipo 30%+36 CAC (link al PDF)" es 10x más útil que un nombre suelto. El schema ya linkea `unit/broker/quote`; solo hay que renderizarlo.
- **Email nuevo-lead:** un único transaccional (Resend + React Email), disparado por job idempotente (patrón BullMQ ya probado en PDF), destinatario según origen (broker→su email; si no, owner/developer). Responder <5 min = 9x conversión es el racional de negocio.

### (3) Editor visual de hotspots

- **Dos niveles** (espeja el explorador de fase 2): render exterior → polígonos de **pisos** (`floors.polygon`); plano de planta → polígonos de **unidades** (`units.polygon`).
- **Interacciones table-stakes:** click para agregar vértices, drag para mover vértices, borrar vértice/polígono, dropdown para vincular el polígono a una unidad/piso, guardar en **coordenadas normalizadas 0–1** (responsive al resize del render).
- **Diferenciadores baratos:** hover-preview (cómo se ve público), snapping. **Anti-features:** curvas bezier, trazo libre, capas tipo Figma, auto-detección por IA.
- **Diseñar el componente SVG para reuso:** el mismo render de polígonos sirve al editor (panel) y al explorador (web pública, fase 2). Ahorra reescribir y garantiza que "lo que dibujo = lo que ve el comprador".

## Competitor Feature Analysis

| Feature | Urbania3D / Hauzd / Web3D | Nuestra aproximación |
|---------|---------------------------|----------------------|
| Carga/edición de inventario | Servicio hecho a mano por el proveedor (meses); el developer no autogestiona | Grilla self-service + import Excel → developer autónomo, onboarding <1 semana |
| Precio/estado en vivo | Existe, pero cambios pasan por el proveedor | Developer edita desde el panel (incl. celular) → reflejo en la web pública |
| Cotizador financiero argentino | No lo resuelven bien (diferencial #1, ya shipped v1.2) | Motor puro 100% cobertura; D1 mantiene sus precios coherentes |
| Gestión de leads | CRM externo o feature pesada | Bandeja liviana de 4 estados + email; sin pretensión de reemplazar un CRM |
| Editor de hotspots | Producción manual por el proveedor sobre motores 3D pesados | Editor de polígonos SVG en el panel sobre renders estáticos (90% percepción, 10% costo) |

## Sources

- [Real Estate CRM With Inventory Management — Sell.do](https://www.sell.do/real-estate-crm/inventory-management) — bulk pricing, grid inventory status (MEDIUM)
- [Bulk editing in grids — Dynamicspedia](https://dynamicspedia.com/2023/10/back-to-the-feature-bulk-editing-in-grids/) — orden de campos en bulk update, saved views (MEDIUM)
- [Real estate inventory management UX/UI case study — Medium (Apoorv Gupta)](https://apoorvg1.medium.com/real-estate-inventory-management-system-ux-ui-case-study-25f16a89617c) — "usuario en control", editar todo, status de un vistazo (MEDIUM)
- [CSV Upload UI: File Import UX Patterns — CSVBox](https://blog.csvbox.io/file-upload-patterns/) y [Column mapping in your SaaS](https://blog.csvbox.io/column-mapping-saas/) — pipeline file→map→validate→submit, auto-match de headers (MEDIUM-HIGH)
- [Validate CSV before DB — CSVBox](https://blog.csvbox.io/validate-csv-before-db/) — validación client+server, errores por fila accionables (MEDIUM-HIGH)
- [Design & Implementation of CSV/Excel Upload for SaaS — Kalzumeus](https://www.kalzumeus.com/2015/01/28/design-and-implementation-of-csvexcel-upload-for-saas/) — realidades de Excel arbitrario, por qué el template canónico gana (HIGH)
- [How To Design Bulk Import UX — Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/bulk-ux/) — preview de primeras filas, resumen importadas/errores, descarga de fallidas (HIGH)
- [Real Estate Lead Management pipeline — iHomefinder](https://www.ihomefinder.com/blog/uncategorized/real-estate-lead-management/) y [Copper — pipeline stages](https://www.copper.com/resources/pipeline-stages) — etapas de pipeline, capture→nurture→convert (MEDIUM)
- [2026 real estate lead management playbook — RoofAI](https://www.roofai.com/blog/real-estate-lead-management-2026-playbook-for-brokers-and-teams) — respuesta <5 min = 9x conversión; lightweight vs full CRM boundary (MEDIUM)
- [Image Hotspots — WYSIWYG Web Builder](https://www.wysiwygwebbuilder.com/imagehotspots.html) — polígonos por click/coords, edición por menú, recálculo responsive de coords (MEDIUM)
- [Method Draw / SVG editors — editor.method.ac](https://editor.method.ac/) — patrones de draw/edit de polígonos y paths en el browser (MEDIUM)
- `docs/modelo-mvp.md` §2.1/§2.2/§2.3/§3.2/§3.3 y `.planning/PROJECT.md` — alcance D1/D2/hotspots, schema existente, regla anti-CRM, decisiones de stack (HIGH, fuente interna)

---
*Feature research for: panel de autogestión de preventa inmobiliaria (v1.3 / fase 4)*
*Researched: 2026-07-17*
