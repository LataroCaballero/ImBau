# Modelo de MVP — Showroom 3D para preventa en pozo

*Junio 2026. Documento de trabajo interno. Basado en producto-ideal.md, relevamiento-competidores.md y estrategia-interna.md.*

---

## 0. Contexto y estrategia de dos ramas

La reunión con Pablo todavía no ocurrió, pero se decide avanzar ahora con el desarrollo del núcleo. Para no violar el principio de "validar antes de construir", el trabajo se divide en dos ramas:

- **Rama A (propia, arranca ya):** núcleo del producto agnóstico al proyecto, con un edificio ficticio de ~13 pisos (estilo Brigos Recoleta) como dataset de demo. Solo se construye lo que es *table stakes* para cualquier cliente del rubro — riesgo de tirar trabajo: bajo.
- **Rama B (Pablo, post-reunión):** carga del material real de su proyecto + features específicas que surjan del feedback. Si su proyecto sigue las líneas de la Rama A, gran parte del camino ya está caminado; si no, solo se descarta lo específico.

**Regla de corte:** todo lo que en este documento esté marcado como `[B]` no se construye hasta tener feedback de Pablo. Lo demás es `[A]` y arranca ahora.

---

## 1. Objetivo del MVP

Un showroom web publicable que permita a **un** desarrollador inmobiliario vender unidades en pozo: explorar el edificio, ver precio y disponibilidad en vivo, cotizar con financiación argentina y contactar por WhatsApp — con un panel de autogestión para que el desarrollador actualice todo sin depender de mí.

**Definición de "MVP terminado":** una demo con el edificio ficticio, desplegada en el VPS, que carga en <3 segundos en un celular de gama media con 4G, donde un visitante puede llegar de la portada a una cotización por WhatsApp en menos de 2 minutos, y donde yo puedo cambiar el precio de una unidad desde el panel y verlo reflejado al instante.

## 2. Alcance de producto

### 2.1 Dentro del MVP

**Web pública (mobile-first, sin descargas):**

| # | Feature | Detalle | Rama |
|---|---|---|---|
| P1 | Portada del proyecto | Render hero, datos clave, ubicación con puntos de interés | A |
| P2 | Explorador del edificio | Render exterior → selección de piso → planta del piso → unidad. Hotspots SVG sobre renders estáticos. Estados (disponible/reservado/vendido) y precios en vivo | A |
| P3 | Ficha de unidad | Plano amoblado, m², orientación, ambientes, precio, estado. Compartir por link, descargar PDF, QR | A |
| P4 | Cotizador argentino | Contado USD / anticipo + cuotas ajustadas por CAC / refuerzos. Resultado en pantalla + PDF + CTA WhatsApp con la cotización precargada. **Es el diferencial #1 — nadie lo resuelve bien** | A |
| P5 | Avance de obra | Timeline de fotos/videos por mes | A |
| P6 | Galería y amenities | Renders + visor 360 si el cliente tiene panoramas | A |
| P7 | Contacto WhatsApp-first | wa.me con mensaje precargado (unidad + cotización). Formulario corto como secundario | A |
| P8 | Links por broker | Cada broker/inmobiliaria tiene su URL propia: su WhatsApp recibe los leads y sus métricas se separan | A |

**Panel del desarrollador:**

| # | Feature | Detalle | Rama |
|---|---|---|---|
| D1 | Grilla de unidades | Editar precio, estado, lista por forma de pago. Import/export Excel (formato en que ya manejan los datos) | A |
| D2 | Bandeja de leads | Origen (broker, unidad, cotización generada), estados nuevo/contactado/negociación/cerrado, aviso por email | A |
| D3 | Avance de obra | Subir fotos con fecha y descripción | A |
| D4 | Métricas | Unidades más vistas, sesiones, cotizaciones generadas, conversión a lead, ranking de brokers | A |
| D5 | Configuración | Logo, colores, textos, formas de pago, brokers | A |
| D6 | Alertas de interés repetido | "X miró 3 veces el 4°B esta semana" → email al vendedor. Diferencial #2, barato de hacer sobre D4 | A |

### 2.2 Fuera del MVP (explícitamente)

Cambio de terminaciones/materiales, modo día/noche, reserva online con pagos, API/SDK, CRM completo (solo el liviano de D2), apps nativas/VR, producción de renders (el cliente trae su material o se terceriza), multi-proyecto en UI `[B]`, modo self-service para resellers `[B]`, integración con CRMs externos `[B]`, post-obra/post-venta `[B]`.

### 2.3 Flujos principales (user stories)

**Comprador:** llega desde Instagram/WhatsApp al link → portada → toca el edificio → elige piso 4 → ve la planta con 3 unidades disponibles → abre el 4°B → cotiza anticipo 30% + 36 cuotas CAC → "Consultar por WhatsApp" abre el chat del broker con la cotización pegada.

**Desarrollador:** se vendió el 4°B → entra al panel desde el celular → cambia estado a "vendido" → la web pública se actualiza al instante. Lunes a la mañana revisa métricas: el 7°A es el más visto de la semana y hay 2 alertas de interés repetido.

**Broker:** comparte `proyecto.com/b/inmobiliaria-garcia` en sus redes → todos los leads de ese link le llegan a su WhatsApp → el desarrollador ve en el ranking que García generó 12 leads este mes.

**Yo (operador):** cliente nuevo → creo el proyecto, cargo renders y polígonos de hotspots, importo el Excel de unidades, configuro branding y formas de pago → publico en subdominio. Objetivo de carga: **menos de una semana de trabajo** con material existente del cliente (vs. 2-3 meses de Urbania/Hauzd).

---

## 3. Arquitectura técnica

> Decisión de diseño: la plataforma se construye con estándar de SaaS profesional desde el día uno. El código es la carta de presentación del producto (y de Andescode); no se eligen atajos de prototipo. Se descarta PocketBase: excelente para prototipar, pero limita multi-tenancy real, migraciones versionadas y el techo de escala que este producto declara como ambición (benchmark Hauzd).

### 3.1 Principios

1. **Renders estáticos + 360 + transiciones, no motor 3D.** Esto NO es un atajo: es la decisión de producto correcta — 90% de la percepción con 10% del costo y carga instantánea en móvil (lección anti-Hauzd). La sofisticación va en la plataforma, no en un engine.
2. **Multi-tenant nativo.** Organizaciones → proyectos → unidades, con aislamiento por Row-Level Security en Postgres. Dar de alta un proyecto nuevo es un registro en la DB, no un deploy. Es lo que convierte "servicio por proyecto" en SaaS.
3. **Tipado end-to-end y calidad verificable.** TypeScript estricto del schema a la UI, motor de cotización con cobertura total de tests, e2e en CI. La calidad se demuestra, no se declara.
4. **El contenido es configuración, no código.** Un proyecto nuevo se carga por panel (incluido el editor visual de hotspots), sin tocar el código. Esto habilita "entrega en semanas" y, a futuro, el modo self-service para resellers.
5. **Operable y observable.** Logs estructurados, tracing, errores y uptime monitoreados desde el primer deploy. Un SaaS que vende "disponibilidad y precios en tiempo real" no puede enterarse de caídas por WhatsApp del cliente.

### 3.2 Stack

| Capa | Elección | Por qué |
|---|---|---|
| Lenguaje y repo | **TypeScript estricto, monorepo pnpm + Turborepo** | Un solo lenguaje del schema a la UI; `packages/` compartidos (dominio, cotización, UI kit, config) entre apps |
| Web pública | **Next.js (App Router, RSC + ISR)** | SEO real para las páginas de proyecto (se comparten en redes), OG images dinámicas por unidad/cotización, streaming SSR para LCP en 4G |
| Panel | App Next.js separada en el monorepo | shadcn/ui + TanStack Table/Query para grillas y bandejas; deploy y superficie de ataque separados de la web pública |
| API | **tRPC** (procedimientos compartidos vía `packages/api`) | Contratos tipados end-to-end sin codegen; validación con Zod en el borde |
| Base de datos | **PostgreSQL 16 + Drizzle ORM** | Migraciones versionadas en el repo, **RLS para aislamiento por tenant**, transacciones reales, `LISTEN/NOTIFY` para realtime. Tabla de eventos particionada por mes |
| Auth | **Better Auth** | Sesiones, roles por organización (owner/developer/viewer), invitaciones por email; brokers no loguean en MVP pero el modelo de membresías ya lo contempla |
| Jobs en background | **BullMQ + Redis** | Procesado de imágenes, generación de PDFs, emails, cálculo de alertas de interés repetido — nada pesado en el request path |
| Storage | **S3-compatible: Cloudflare R2** (cero egress) | Originales + variantes; URLs firmadas para el panel |
| Imágenes | Worker con **sharp**: variantes AVIF/WebP responsive al subir | El requisito de <3s en 4G se gana o pierde acá; presupuesto de peso por página en CI (Lighthouse budget) |
| Realtime | SSE alimentado por Postgres LISTEN/NOTIFY | Precio/estado de unidades en vivo en la web pública sin polling |
| Hotspots | Editor visual de polígonos SVG **en el panel** | Parte del pipeline de carga en <1 semana; los polígonos son datos, no código |
| Visor 360 | Photo Sphere Viewer, carga lazy | Solo si el proyecto tiene panoramas |
| PDF | Generación **server-side** en worker (react-pdf / HTML→PDF) | Branding consistente, snapshot archivado de cada cotización emitida (valor probatorio ante disputas de precio) |
| Email | Resend/Postmark + React Email | Avisos de leads, alertas, invitaciones |
| Analytics | Endpoint de ingesta propio → Postgres particionado | Las alertas (D6) necesitan los eventos en mi DB. Path a ClickHouse si el volumen lo pide |
| Observabilidad | **Sentry + OpenTelemetry**, logs estructurados (pino) → Grafana/Loki, Uptime Kuma | Errores con contexto, trazas de requests lentos, alertas de caída |
| Testing | **Vitest** (motor de cotización al 100%), **Playwright** e2e de los flujos críticos, type-check y lint en CI | El cotizador es el diferencial: un error de cálculo mata la confianza |
| CI/CD | **GitHub Actions**: lint + tests + e2e → build de imágenes Docker → registry → deploy automático a staging, manual a prod | Cada commit a main es deployable; staging y prod idénticos |
| Infra | **Docker Compose** en VPS + **Traefik** (TLS automático, incluido on-demand para dominios custom de clientes) | Reproducible, versionada en el repo; dominios propios por proyecto vía CNAME sin tocar infra |

### 3.3 Modelo de datos (Postgres, esquema lógico)

```
organizations    nombre, slug, plan                       ← el tenant (desarrollador/estudio)
memberships      organization, user, rol [owner|developer|viewer]
users            Better Auth
projects         organization, nombre, slug, branding, textos, ubicación,
                 estado [borrador|publicado|archivado], dominio custom (opc.)
floors           project, número, nombre, render de planta, polígono sobre render exterior
units            project, floor, identificador (4°B), tipología, m2, orientación,
                 ambientes, plano, estado [disponible|reservado|vendido], polígono, orden
price_lists      project, nombre (contado USD / financiado / lista broker X), moneda
unit_prices      unit, price_list, precio, vigencia
payment_plans    project, nombre, anticipo %, cuotas, ajuste [CAC|fijo],
                 refuerzos (JSONB), notas legales
cac_index        período, valor (carga manual mensual; scraping después)
quotes           project, unit, payment_plan, snapshot del cálculo (JSONB),
                 pdf (storage key), lead (opc.)
brokers          project, nombre, slug del link, whatsapp, email
leads            project, unit?, broker?, quote?, nombre, contacto, origen,
                 estado [nuevo|contactado|negociación|cerrado], timeline de notas
progress_posts   project, fecha, título, media
galleries        project, sección [amenities|exteriores|interiores], imágenes, pano360s
media            project, original + variantes (keys de R2), dimensiones, blurhash
events           project, tipo, unit?, broker?, session_id, ts   ← particionada por mes
```

RLS: toda tabla con `project`/`organization` tiene policy por tenant; la web pública lee vía un rol `anon` limitado a proyectos `publicado`. `events` y `leads` aceptan insert anónimo con rate limit en el edge (Traefik middleware + validación Zod).

### 3.4 Cotizador (el paquete más cuidado del repo)

`packages/quoting`: motor **puro y determinista** (sin I/O), tipado exhaustivo, property-based tests además de los unitarios, cobertura 100% exigida en CI. Entrada: unidad + lista de precios + plan de pago + índice CAC vigente. Cálculo: precio base USD → anticipo → saldo en cuotas (plan CAC: cuota inicial en pesos al valor del mes, con leyenda de ajuste) → refuerzos. Salida: estructura tipada que alimenta la UI, el PDF server-side y el texto para WhatsApp. Cada cotización emitida persiste su snapshot completo (inputs + outputs + versión del motor) — auditabilidad total.

### 3.5 Deploy y operación

- **Staging:** VPS actual, `staging.tours.andescode.com.ar` (andescode.com.ar queda intacto). Docker Compose: Traefik, web pública, panel, worker, Postgres, Redis, Loki/Grafana, Uptime Kuma. Deploy automático en cada merge a main.
- **Prod:** VPS dedicado al producto desde el primer cliente pago. Misma composición, secrets separados (SOPS/age en el repo), dominio propio del producto + dominios custom de clientes vía CNAME con TLS on-demand de Traefik.
- **Backups:** Postgres con **pgBackRest/wal-g** a Backblaze B2 o R2 (point-in-time recovery), media ya vive en R2. **Restore ensayado** antes del primer cliente — un backup no probado no existe.
- **Costo operativo:** staging ~USD 0 sobre la infra existente + R2/B2 (~USD 1-5/mes). Prod: VPS dedicado USD 10-20/mes + dominio. Sentry/Resend tienen free tier suficiente para el MVP.

### 3.6 Estimación de esfuerzo (desarrollo AI-first con Fable)

El desarrollo es AI-first: Fable genera la mayor parte del código bajo dirección y revisión de Lautaro. Eso comprime mucho — pero no uniforme:

- **Comprime 3-5x:** boilerplate de monorepo/CI/infra, schema + migraciones + RLS, CRUD del panel, motor de cotización + suite de tests, generación de PDFs, e2e.
- **Comprime poco (sigue siendo tiempo humano):** QA en celulares reales de gama media, ajuste visual/UX de la pantalla "wow" (es la que vende — se itera mirando, no generando), debugging de integración (DNS, TLS, R2, emails que caen en spam), carga y curaduría del contenido del edificio ficticio.

| Fase | Contenido | Base | Con Fable |
|---|---|---|---|
| 0 | Monorepo, CI/CD, Docker Compose, staging, observabilidad, auth + multi-tenancy + RLS | 2 sem | 3-4 días |
| 1 | Schema completo + pipeline de media (R2 + sharp + blurhash) + seed del edificio ficticio | 1,5 sem | 2-3 días |
| 2 | Explorador del edificio (P2) + ficha de unidad (P3) con realtime — la pantalla "wow" | 2,5 sem | 1-1,5 sem |
| 3 | `packages/quoting` + UI del cotizador + PDF server-side + WhatsApp (P4) | 2 sem | 3-4 días |
| 4 | Panel: grilla de unidades + import Excel (D1), leads (D2), editor de hotspots | 2 sem | 4-5 días |
| 5 | Portada, avance de obra, galería, links de broker (P1, P5, P6, P8) | 1 sem | 2-3 días |
| 6 | Métricas + alertas (D4, D6), branding (D5), e2e completos, performance budget, QA mobile | 2 sem | 1 sem |
| | **Total** | ~13 sem | **~5-6 semanas** full-time |

**Estrategia "ventana Fable":** el acceso a Fable es temporal (después se encarece). Conviene front-loadear las fases densas en código, donde Fable rinde máximo (0, 1, 3, 4), y dejar para después lo que depende de ojo humano o de terceros (pulido visual, QA, contenido, feedback de Pablo). Si la ventana es corta, el orden óptimo pasa a ser **0 → 1 → 3 → 4 → 2 → 5 → 6**: generar primero el esqueleto y el músculo del sistema, dedicar el tiempo post-Fable a la piel.

**Regla de control:** las estimaciones "con Fable" se validan en la fase 0 — si toma más de una semana, recalibrar todo el plan antes de seguir. La demo "wow" (explorador + cotizador) existe a las ~2,5-3 semanas de este plan; la reunión con Pablo puede agendarse con esa fecha a la vista. La fase 0 sigue siendo la inversión que paga todo: con CI/CD y staging desde el día uno, cada día termina en software desplegado, no en "funciona en mi máquina".

---

## 4. Negocio

### 4.1 Pricing del MVP (dentro del rango validado)

| Concepto | Precio | Referencia |
|---|---|---|
| Setup por proyecto | **USD 1.000-2.000** según unidades (<30 / 30-80 / 80+) | Web3D cobra 1.000-1.300 el primer año; Urbania no publica. Setup levemente menor que el mercado porque no incluyo producción de renders |
| Renovación anual (hosting + soporte + actualizaciones) | **USD 700-900/año** | Rango Web3D/Urbania validado en relevamiento |
| Cobro | 50% adelanto + 50% contra entrega (estándar Urbania) | |
| Pablo (design partner) | Gratis o descuento fuerte en su proyecto + 10-20% del primer año de cada referido | Según estrategia-interna.md. **Cobrar desde el día uno a todo lo que no sea Pablo** |

ROI para vender: una unidad en pozo vale 50-100x el costo anual del servicio; sus competidores (Proaco, Portland, Fernández Prieto) ya usan esto.

### 4.2 Métricas de validación

**Del producto (demo):** carga <3s en 4G en gama media; portada→cotización por WhatsApp en <2 min sin ayuda; carga completa de un proyecto nuevo en <1 semana de mi trabajo.

**Del negocio (primeros 6 meses post-lanzamiento):** 1 proyecto real publicado (el de Pablo o un colega de Ani); ≥1 cliente **pago**; leads reales generados por el showroom (el dato que vende el caso); ≥2 demos a terceros conseguidas vía Pablo/Ani.

**Señales de corte:** si tras la reunión Pablo no aporta material ni feedback en 4-6 semanas → activar plan B (Ani circula la propuesta como servicio) sin frenar la Rama A.

### 4.3 Roadmap de las dos ramas

```
Ahora ────────► Reunión Pablo ────────► Lanzamiento marketing de su proyecto
Rama A: fases 1-2 (núcleo+explorador) ── fases 3-6 ──► demo pública pulida
Rama B:            └─ feedback → cargar material real ─► showroom de Pablo live
```

- La reunión con Pablo conviene tenerla **al final de la fase 2-3** (~3-4 semanas): demo del explorador + cotizador con números inventados es mucho más fuerte que slides, y todavía hay margen para redirigir el alcance con su feedback.
- Post-MVP (solo con tracción): multi-proyecto en UI, terminaciones, reserva con seña, integración CRM, self-service para resellers.

## 5. Riesgos del MVP

| Riesgo | Mitigación |
|---|---|
| Construir de más antes de validar (violación del principio propio) | Regla `[A]`/`[B]`: solo table stakes + cotizador ahora; todo lo específico espera a Pablo |
| El material del cliente no alcanza (sin renders por piso ni plantas) | Pregunta 3 de la reunión. Plan: partner de contenido tercerizado y ajustar el setup fee |
| Performance móvil arruina la primera demo | Presupuesto de peso por página (<1,5 MB inicial), probar en gama media real desde la fase 2 |
| Cotizador con errores de cálculo (es el diferencial — un error mata la confianza) | Tests unitarios del motor de cotización + validación de casos con Pablo; leyenda legal "cotización no vinculante" en el PDF |
| Urbania3D llega antes a los contactos de Pablo | La velocidad es la ventaja: demo lista en semanas y entrar antes de su etapa de marketing |
| Optimismo del plan AI-first (5-6 semanas puede ser 8-10 si el QA/integración pesa más de lo previsto) | Regla de control en fase 0; cortes verticales — cada fase termina desplegada y demostrable. Si el tiempo aprieta, se recorta alcance (P5/P6, editor de hotspots), nunca calidad de lo construido |
| Se acaba la ventana de Fable a mitad del desarrollo | Orden alternativo 0→1→3→4→2→5→6: front-loadear lo denso en código; lo que queda (pulido, QA, contenido) depende menos del modelo |
| Dependencia del VPS personal compartido | Solo staging; primer cliente pago → VPS dedicado (USD 10-20/mes) |

## 6. Decisiones pendientes (para la reunión con Pablo)

Formato del material de su proyecto (¿renders por piso? ¿plantas?), formas de pago reales que ofrece su desarrollo (define los presets del cotizador), quién carga precios en la práctica (¿él, la inmobiliaria?), y fecha de inicio de su etapa de marketing (deadline real de la Rama B).

