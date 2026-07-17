# ImBau — Showroom 3D para preventa en pozo

SaaS multi-tenant para que desarrolladores inmobiliarios argentinos vendan unidades en pozo:
un showroom web mobile-first (explorador del edificio por pisos con hotspots SVG sobre renders
estáticos, ficha de unidad, cotizador con financiación argentina USD + cuotas CAC, avance de obra,
leads por WhatsApp) más un panel de autogestión (precios, disponibilidad, leads, métricas, brokers).

El documento maestro de producto es `docs/modelo-mvp.md`. Para trabajar en el repo, leé primero
`CLAUDE.md` (estándar de calidad, stack decidido y convenciones).

## Comandos

Monorepo pnpm + Turborepo. Todos los comandos corren con Node 22 LTS y pnpm `11.6.0` (pineado vía
Corepack). Los principales:

- `pnpm dev` — levanta todo (turbo dev de las apps).
- `pnpm test` / `pnpm lint` / `pnpm typecheck` — gates de calidad; CI roja no se mergea.
- `docker compose up -d` — Postgres 16, Redis y servicios locales.
- `pnpm db:migrate` — aplica las migraciones versionadas de Drizzle (nunca cambios manuales al schema).
- `pnpm db:seed` — siembra determinista e idempotente del edificio ficticio (ver abajo).

### `pnpm db:seed` — siembra del edificio "Brigos Recoleta"

Genera datos demo-grade reproducibles: una organización con un proyecto **publicado**, ~13 pisos y
~38 unidades con curva de venta de pozo, 2 listas de precios en USD, planes de pago CAC con
refuerzos, serie CAC, medios (imágenes stock procesadas por el worker), brokers, leads con
timeline, galerías, avances de obra y eventos.

Es **idempotente**: podés re-correrlo cuantas veces quieras y **no duplica filas** (cada insert usa
un id determinista UUIDv5 + `onConflictDoNothing`; un segundo run es un no-op y deja todos los
`count(*)` idénticos). Esto está probado por el gate automático
`packages/db/tests/seed.idempotency.test.ts`.

**Prerrequisitos** (el seed hace *fail-fast*: aborta con un error explicativo — nombrando la
variable o el servicio faltante, nunca su valor — antes de escribir nada si algo no está):

1. **La base debe estar migrada primero**: `pnpm db:migrate`.
2. **El pipeline de media tiene que estar arriba** (el seed sube los originales a R2 y espera a que
   el worker los procese): `docker compose up -d postgres redis worker`.
3. **Las variables de entorno requeridas tienen que estar presentes** (se listan por NOMBRE; nunca
   pongas valores de ejemplo/secretos en la doc ni en el repo):
   - `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_ANON_URL` — conexiones owner/app/anon.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
     — bucket Cloudflare R2 para los medios.
   - `REDIS_URL` — cola BullMQ que consume el worker.

El seed corre contra la base que apunten esas variables; el arnés de tests además exige que el
nombre de la base termine en `_test` para nunca tocar datos reales.

La procedencia y licencia de cada imagen stock sembrada está documentada en
`packages/db/src/seed/assets/LICENSES.md`.
