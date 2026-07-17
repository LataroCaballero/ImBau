# Phase 8: Deuda v1.2 — merge a main + re-verificación en staging - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Fase mecánica/ops, sin research nuevo: mergear el PR #5 (`fase-0/foundation` → `main`, 397 commits, MERGEABLE, CI verde) para que el pipeline `deploy-staging.yml` construya y deploye las 4 imágenes de v1.2 a `staging.tours.andescode.com.ar`, y re-verificar EN VIVO contra el VPS los pendientes de v1.2: rate-limit 429 en `quotes.*` sin 503, flujo PDF completo de punta a punta con acentos es-AR, y QR/deep-link del PDF apuntando a la URL de staging. Requirements: DEBT-01, DEBT-02. No se construye ningún feature del panel acá.

</domain>

<decisions>
## Implementation Decisions

**El usuario delegó todas las decisiones a Claude ("dale con todo automático y verificalo vos"). Decisiones auto-seleccionadas:**

### Estrategia de merge
- **D-01:** Merge del PR #5 con **merge commit** (`gh pr merge 5 --merge`), NO squash: 397 commits con historia Conventional Commits y el tag `v1.2` apuntando dentro de la rama — squash huérfana el tag y pierde trazabilidad.
- **D-02:** Antes del merge: pushear los 4 commits locales de planning pendientes y commitear los cambios de tooling GSD sin commitear (`.claude/agents/*` modificados, `.claude/commands/gsd/*` borrados) como `chore:` — `main` debe reflejar el estado real del repo. El gate `quality` de branch protection debe estar verde antes de mergear.
- **D-03:** No borrar la rama `fase-0/foundation` en el merge. El trabajo de v1.3 (Phase 9+) arranca en una rama nueva `fase-4/panel` desde `main` post-merge (convención `fase-N/descripcion`; v1.3 = fase 4 del plan maestro). Los docs de Phase 8 (UAT/SUMMARY) se commitean donde esté el trabajo activo en ese momento.

### Alcance de la re-verificación
- **D-04:** Verificar los 4 success criteria del ROADMAP tal cual + un smoke liviano de superficies (home web, `/p/brigos-recoleta/cotizador`, login del panel, worker vivo vía logs, Sentry/Loki recibiendo). NO se re-corre la UAT completa de v1.2 — el código ya está verificado; lo único que cambió es la infra.
- **D-05:** Verificar que migrate-before-swap aplicó las migraciones nuevas (0004+, staging venía de imagen pre-fase-5) y que el seed "Brigos Recoleta" existe publicado en staging — prerrequisito del cotizador. Si falta seed, correrlo contra staging como parte de la fase.
- **D-06:** La pasada visual humana de fase 6 (`/gsd-verify-work 6`) sigue **diferida** — requiere ojos humanos en viewport real, no entra en esta fase.

### Contingencia deploy/verificación
- **D-07:** Ante fallo: **fix-forward** con PRs chicos a `main` (branch protection exige el check `quality`; no hay push directo). Sin rollback salvo staging caído duro — migrate-before-swap ya gatea migraciones rotas (si migrate falla, no hay swap y staging queda en la imagen vieja: estado seguro).
- **D-08:** VPS compartido con prod (`andescode.com.ar`): nunca tocar el nginx/host de prod; ante procesos, inspeccionar identidad antes de cualquier kill. RAM/puertos ajustados — no levantar servicios extra.

### Evidencia y ejecución
- **D-09:** **Claude ejecuta todo el ciclo**: merge vía `gh`, monitoreo del run de Actions, verificación en vivo vía curl contra staging y SSH al VPS (key `id_vps_andescode`, `root@`) para inspección de contenedores/logs. El operador solo interviene ante bloqueos de infra (secrets/DNS/disco).
- **D-10:** Checks scripteados y repetibles donde sea trivial (ráfaga de POSTs para el 429, poll de `quotes.pdfStatus`), con salida capturada como evidencia. Resultado documentado en `08-UAT.md` en el directorio de fase, con comandos + output real (patrón de las UAT de v1.2).
- **D-11:** Verificación del QR/deep-link: descargar el PDF generado en staging y verificar que QR y deep-link apuntan a `https://staging.tours.andescode.com.ar/...` (decodificar QR con tooling local si está disponible, o extraer el link del contenido del PDF — el planner decide el tooling).

### Claude's Discretion
Todo lo anterior es discreción de Claude por pedido explícito del usuario. Cualquier micro-decisión operativa restante (orden exacto de checks, tooling de decodificación de QR, formato del script de ráfaga) queda a criterio del executor dentro de estos límites.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y fase
- `.planning/ROADMAP.md` — Phase 8: goal, success criteria (4), nota "mecánico, sin research"
- `.planning/REQUIREMENTS.md` — DEBT-01, DEBT-02

### UAT de v1.2 a re-correr (recetas existentes)
- `.planning/milestones/v1.2-phases/05-emisi-n-y-persistencia-server-side-api-rls-rate-limit/05-UAT.md` — receta de la ráfaga 429 (40 POSTs → 29 pasan / 11×429, cero 503) ya corrida una vez contra staging
- `.planning/milestones/v1.2-phases/07-pdf-as-ncrono-en-el-worker/07-UAT.md` — receta del e2e PDF (descarga, header/leyendas/QR/deep-link, acentos, soft-fail)
- `.planning/milestones/v1.2-phases/06-ui-p-blica-del-cotizador-cta-whatsapp/06-UAT.md` — item visual pendiente (queda diferido, NO entra acá)

### Pipeline de deploy e infra
- `.github/workflows/deploy-staging.yml` — push a `main` → build 4 imágenes (web/panel/worker/migrate) → GHCR → SSH VPS → `deploy/deploy.sh` con IMAGE_TAG=sha
- `deploy/deploy.sh` — sops decrypt → migrate-before-swap → role bootstrap → staged bring-up
- `secrets/staging.enc.yaml` — secrets SOPS/age del VPS (R2 creds incluidas desde 16ddb84; decrypt local requiere `SOPS_AGE_KEY_FILE` explícito)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- PR #5 abierto y MERGEABLE (`gh pr view 5`); CI `quality` verde en la rama.
- UATs archivadas de v1.2 con comandos exactos reutilizables (ráfaga curl, poll pdfStatus).
- Key SSH `id_vps_andescode` (`root@` al VPS de staging) — Claude puede inspeccionar contenedores/logs directo.

### Established Patterns
- Deploy: merge a `main` = deploy automático; `workflow_dispatch` disponible como re-trigger manual.
- Migrate-before-swap: las migraciones corren gateadas antes del swap de contenedores — un fallo deja staging en la imagen anterior.
- Rate-limit: el archivo nginx del repo es la fuente de verdad (D-12 de v1.2) — no se reconfigura a mano en el VPS.

### Integration Points
- `staging.tours.andescode.com.ar` (web) y `panel.staging.tours.andescode.com.ar` (panel) detrás de nginx-host + certbot del VPS compartido.
- GHCR como registry; secrets del workflow: `VPS_SSH_KEY`, `SOPS_AGE_KEY`, `SENTRY_AUTH_TOKEN` (ya configurados — el pipeline ya deployó v1.0).

</code_context>

<specifics>
## Specific Ideas

El usuario pidió explícitamente modo automático de punta a punta: "dale con todo automático y verificalo vos" — Claude decide, ejecuta el merge, monitorea el deploy y corre la verificación en vivo él mismo. Sin gates humanos salvo bloqueo real de infra.

</specifics>

<deferred>
## Deferred Ideas

- Pasada visual humana del cotizador en viewport real (06-UAT.md) — sigue diferida a `/gsd-verify-work 6`; no bloqueante.
- Limpieza/borrado de la rama `fase-0/foundation` remota — opcional, post-milestone.

</deferred>

---

*Phase: 8-Deuda v1.2 — merge a main + re-verificación en staging*
*Context gathered: 2026-07-17*
