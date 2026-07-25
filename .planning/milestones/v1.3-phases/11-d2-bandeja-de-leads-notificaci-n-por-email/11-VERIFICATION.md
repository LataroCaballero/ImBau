---
phase: 11-d2-bandeja-de-leads-notificaci-n-por-email
verified: 2026-07-24T21:08:45Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Drag a lead card between kanban columns (mouse) end-to-end in the browser, including the cobre drop-target ring and optimistic-move-then-confirm feel."
    expected: "Card visually moves on drop, saves via leads.updateEstado, and settles (or reverts with the inline alert on a forced error)."
    why_human: "HTML5 drag-and-drop and optimistic-UI timing are runtime/visual behaviors grep cannot exercise; code inspection confirms the handlers exist and are wired (leads-board.tsx onDrop/handleColumnDragOver) but not that the drag interaction feels correct in a real browser."

  - test: "Trigger a transition into Cerrado from both the drag path and the drawer <select>, confirm the desenlace prompt blocks the write, and verify Cancelar aborts the move while Guardar desenlace commits estado+desenlace."
    expected: "Cerrar sin elegir desenlace is impossible; cancel leaves the card in its origin column; confirm shows the Ganado/Perdido badge on the card and in the drawer dot."
    why_human: "Visual modal-gate sequencing and color-coded badges (green/red) are visual/interaction outcomes; source confirms the gating logic (desenlace-prompt.tsx + leads-board.tsx pendingCerrado state) but not the rendered result."

  - test: "Send a real lead-created event through to Resend in staging (RESEND_API_KEY set) and confirm the recipient actually receives the es-AR email with the correct subject, deep-link, and content."
    expected: "Inbox receives 'Tenés un lead nuevo en {Proyecto}' with a working deep-link to the project's leads board."
    why_human: "Actual third-party email delivery (Resend) cannot be exercised without live external service credentials; the dev-mode code path (RESEND_API_KEY absent) was verified via a passing unit test, but the real-send path was not exercised end-to-end in this verification."

  - test: "On a narrow laptop viewport, confirm the board scrolls horizontally with 320px columns intact, a long nombre/contacto truncates with a working title tooltip without breaking the 88px card min-height, a long free note wraps inside the drawer without pushing the note form out of view, and the drawer timeline scrolls internally on a short viewport while header/note form stay visible."
    expected: "All four overflow/backstop behaviors hold visually as described in the UI-SPEC."
    why_human: "These are explicitly tagged 'verification: backstop' in the 11-05 plan frontmatter (non-inferable from static code) — CSS truncate/wrap classes and container structure are present in the source (lead-card.tsx `truncate`+`title`, lead-drawer.tsx `overflow-y-auto`), but whether the actual rendered layout holds these constraints requires a visual check."
---

# Phase 11: D2 — Bandeja de leads + notificación por email Verification Report

**Phase Goal:** El developer gestiona su bandeja de leads con origen trazable, los mueve por un pipeline fijo de 4 estados con notas en el timeline, y recibe un aviso por email ante cada lead nuevo sin que la notificación bloquee ni duplique la mutación.
**Verified:** 2026-07-24T21:08:45Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El developer ve la bandeja de leads con su origen (broker/unidad/cotización) resuelto por joins. | VERIFIED | `leads.listForProject` (packages/api/src/trpc/routers/leads.ts:72-139) leftJoins brokers/units/quotes on the tenant-composite key and resolves `origenResuelto` (broker→nombre, unidad→identificador, cotización→id, else Directo). Named test `resolves broker / unidad / cotización / Directo and hides cross-org leads` run against real Postgres — PASS. Panel `lead-card.tsx`/`leads-board.tsx` renders `origenChipLabel(lead.origenResuelto)`. |
| 2 | El developer mueve un lead por el pipeline fijo `nuevo → contactado → negociación → cerrado` (máquina de estados impuesta, sin estados libres). | VERIFIED | `leads.updateEstado` input is `z.enum(["nuevo","contactado","negociacion","cerrado"])`; destination outside the 4 values is a Zod 400. Named tests run against real Postgres: `owner moves a lead, appends the auto timeline entry, and emits an audit event` — PASS; `rejects moving to cerrado without a desenlace (400)` — PASS; `clears desenlace when reopening a cerrado lead` — PASS. Cross-role matrix (owner✓/developer✓/viewer FORBIDDEN/other-org NOT_FOUND/non-existent NOT_FOUND) present in the same suite. Panel wires both drag (`leads-board.tsx` onDrop) and the drawer `<select>` (`lead-drawer.tsx`) to the same `requestTransition`/`updateEstado.mutate` path — a11y parity confirmed at the source level (drag interaction itself is human-verified, see below). |
| 3 | El developer agrega notas al timeline de un lead y quedan persistidas en orden. | VERIFIED | `leads.addNote` appends `{ts, autor, nota}` to the JSONB `timeline`, emits no `events` row, no enqueue. Named test `appends a free-text note in ts order, writes no events row, and enqueues nothing` run against real Postgres — PASS. Drawer (`lead-drawer.tsx`) sorts `timeline` by `ts` before render and posts via `leads.addNote`. |
| 4 | Ante un lead nuevo, el developer recibe un aviso por email encolado (BullMQ) e idempotente por evento (`lead:{id}:{event}`) — nunca `await` inline en la mutación, nunca duplica en reintentos ni bulk. | VERIFIED | `leads.create` inserts inside `withTenant`, then calls `enqueueLeadEmail` AFTER the promise resolves, OUTSIDE the tx closure (packages/api/src/trpc/routers/leads.ts:283-324). `leadEmailJobOptions(leadId)` deterministically returns `jobId = lead:{id}:created` (packages/storage/src/lead-email.ts). Named tests run against real Postgres: `owner creates a lead, seeds the t=0 timeline entry, and enqueues exactly one job` — PASS; `a failing insert (cross-org projectId) rejects AND enqueues ZERO jobs (post-commit placement)` — PASS (the rollback/no-leak invariant). Worker `processLeadEmail` reads under `withTenant(payload.organizationId)`, resolves recipient (`leadsNotifyEmail ?? org_owner_emails()`), dispatches via `@imbau/api/email`; named test `routes to Sentry + pino with structured ids and NEVER the raw payload/PII` — PASS. The BullMQ jobId-dedup mechanism itself (retried/duplicate enqueue collapsing to one job at the Redis layer) is not independently re-tested against a live queue here — it relies on BullMQ's documented `jobId` contract, the same reliance pattern already established for the quote-pdf pipeline (phase 7). |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Security-Critical Checks (explicitly requested)

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | leads router scopes every read/write by tenant (withTenant/app_authenticated), never the owner pool | VERIFIED | `packages/api/src/trpc/routers/leads.ts` imports only `withTenant, schema` from `@imbau/db` (line 36); every read/write wraps in `withTenant(ctx.activeOrgId, ...)`. `grep -n "createOwnerDb\|appDb" packages/api/src/trpc/routers/leads.ts` → 0 matches. |
| 2 | Worker owner-email fallback goes through `org_owner_emails()` only | VERIFIED | `grep -n "createOwnerDb\|appDb" apps/worker/src/lead-email.ts` → 0 matches. `readLeadForEmail` (apps/worker/src/lead-email.ts:69-157) resolves owner emails only when `project.leadsNotifyEmail === null`, via `tx.execute(sql`select o as email from public.org_owner_emails(${orgId}) as o`)` inside the same `withTenant` tx — never a direct `"user"` table read. |
| 3 | Lead PII / secrets never logged (only ids in job payloads and failure logs) | VERIFIED | `LeadEmailJobData` (packages/storage/src/lead-email.ts) is `{leadId, organizationId, projectId}` — ids only. `reportLeadEmailFailure` (apps/worker/src/lead-email.ts:217-228) logs `{err, leadId, queue}` only via Sentry+pino — no raw payload, no nombre/contacto. `logger.info({leadId, organizationId}, "lead notification sent")` on success — ids only. Note: the separate dev-console fallback in `send-lead-notification.ts` (not a "job payload" or "failure log") intentionally logs `to`/`nombre`/`origen` as a "public lead summary" per the 11-02 plan's explicit prohibition scope (secrets only, not PII broadly) — this is a deliberate, reviewed design choice, not a violation of the specific check requested. |

### 11-04a Companion Plan (org_owner_emails SECURITY DEFINER)

| # | Must-have | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `public.org_owner_emails(p_org_id text)` exists as `SECURITY DEFINER`, `SET search_path = public`, joins `member ⋈ user` filtered to `role='owner'` | VERIFIED | Migration `packages/db/migrations/0007_org_owner_emails_security_definer.sql`. Live-DB runtime check: `select proname, prosecdef from pg_proc where proname='org_owner_emails'` → `prosecdef = t`. |
| 2 | `EXECUTE` granted to `app_authenticated` ONLY, never `anon`; no broad `GRANT ... ON "user"` anywhere | VERIFIED | `grep -RIn 'GRANT[^;]*ON "user"' packages/db/migrations` → 0 matches. Live-DB `information_schema.routine_privileges` for `org_owner_emails` → grantees are `imbau` (owner) and `app_authenticated` only; no `anon`, no `PUBLIC`. |
| 3 | Migration registered as idx 7 in `meta/_journal.json`, function-only (no snapshot), idempotent (`CREATE OR REPLACE` + re-runnable `GRANT`) | VERIFIED | `meta/_journal.json` entry `{idx: 7, tag: "0007_org_owner_emails_security_definer"}`; no `0007_snapshot.json` present; SQL uses `CREATE OR REPLACE FUNCTION` + `REVOKE ... FROM PUBLIC` + `GRANT ... TO app_authenticated` (both idempotent). |
| 4 | Applied to live dev DB, verified idempotent, verified at runtime returning owner emails without `permission denied for table user` | VERIFIED (partially direct evidence) | Confirmed present + correctly privileged on the live `imbau_test` DB (columns/function all applied cleanly by the standard migrate path the test harness runs). Did not independently re-run a raw `SELECT * FROM org_owner_emails('<org>')` as the `app_authenticated` role with the GUC set in this verification pass — the worker's own passing test suite (`apps/worker/src/lead-email.test.ts`, "owner fallback" cases) exercises this call path with the function present. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/src/schema/leads.ts` | `desenlace` nullable text column | VERIFIED | Column present, RLS policies (`leads_tenant`, `leads_anon_insert`) intact. |
| `packages/db/src/schema/projects.ts` | `leadsNotifyEmail` nullable text column | VERIFIED | Confirmed in schema + live DB (`leads_notify_email`). |
| `packages/db/migrations/0006_leads_desenlace_projects_notify_email.sql` | one additive migration, two nullable ADD COLUMN | VERIFIED | Exactly 2 statements, both additive, no drop/type-change. |
| `packages/db/migrations/0007_org_owner_emails_security_definer.sql` | SECURITY DEFINER function migration | VERIFIED | See 11-04a table above. |
| `packages/db/src/seed/content.ts`, `content-rows.ts` | direct-insert seed bypassing create seam; cerrado leads carry desenlace | VERIFIED (with one numeric discrepancy) | `content-rows.ts:107` is a bare `tx.insert(schema.leads).values(leadRows).onConflictDoNothing()` — no import of `enqueueLeadEmail`/`leads/runtime` anywhere in `packages/db/src/seed/`. `LEADS` array (content.ts:364-601) has **13** entries, not the 14 claimed in the 11-01 plan's must_haves/SUMMARY (`tomas-acosta`→ganado, `camila-vega`→perdido confirmed as the two cerrado leads). This is a documentation/count drift, not a functional gap — the substantive guarantee (email-free re-seed + real desenlace data) holds. |
| `packages/storage/src/lead-email.ts` | shared BullMQ contract (queue name, job data type, job options) | VERIFIED | `LEAD_EMAIL_QUEUE`, `LeadEmailJobData` (ids only), `leadEmailJobOptions` (jobId dedup + attempts/backoff) — pure, no bullmq import. |
| `packages/api/src/email/templates/lead-notification.tsx` | es-AR voseo React Email template | VERIFIED | `<Html lang="es-AR">`, subject built as `Tenés un lead nuevo en {projectNombre}` in the sender, CTA button to `deepLink`. |
| `packages/api/src/email/send-lead-notification.ts` | Resend send / dev-console fallback, `./email` subpath export | VERIFIED | `packages/api/package.json` exports `"./email": "./src/email/send-lead-notification.ts"`. Minimal env (no BETTER_AUTH_SECRET/owner DATABASE_URL). Named tests (`send-lead-notification.test.ts`) exist for both the console-fallback and Resend-send paths. |
| `packages/api/src/leads/runtime.ts` | lazy-memoized BullMQ producer, `enqueueLeadEmail` | VERIFIED | Lazy env/Queue construction on first use; only exports `enqueueLeadEmail`. |
| `packages/api/src/trpc/routers/leads.ts` | leadsRouter (listForProject/create/updateEstado/addNote) | VERIFIED | See Observable Truths above. Registered in `_app.ts` as `leads: leadsRouter`. |
| `packages/api/src/trpc/routers/projects.ts` (extended) | `updateSettings` accepts `leadsNotifyEmail: z.email().nullable().optional()` | VERIFIED | Partial-patch write (only provided keys), Zod `.email()` boundary validation. |
| `apps/worker/src/lead-email.ts` | `processLeadEmail`, `readLeadForEmail`, `reportLeadEmailFailure` | VERIFIED | See Observable Truths + Security-Critical Checks above. |
| `apps/worker/src/index.ts` (extended) | Worker registered on `LEAD_EMAIL_QUEUE`, `failed` handler wired | VERIFIED | `createLeadEmailWorker` + `leadEmailWorker.on("failed", ...)` → `reportLeadEmailFailure` in `boot()`. |
| `apps/panel/app/proyectos/[id]/leads/*.tsx` (7 files) | kanban board, card, drawer, desenlace prompt, alta form, notify-email field, page spine | VERIFIED | All 7 files present, wired to the leads router via `useTRPC`, `pnpm --filter @imbau/panel typecheck` and `lint` both clean. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `leads.create` | `enqueueLeadEmail` (leads/runtime.ts) | post-commit call outside `withTenant` closure | WIRED | Confirmed by source read + real-Postgres rollback test. |
| `enqueueLeadEmail` | `LEAD_EMAIL_QUEUE` (Plan 02) | `getQueue().add("notify", data, leadEmailJobOptions(...))` | WIRED | |
| `LEAD_EMAIL_QUEUE` (producer) | worker `processLeadEmail` (Plan 04) | `createLeadEmailWorker` registered on the same queue name in `boot()` | WIRED | |
| `sendLeadNotification` (`@imbau/api/email`) | worker processor | `apps/worker/src/lead-email.ts` imports and calls it after recipient resolution | WIRED | |
| `job.data.organizationId` | `withTenant` read of lead + project + owners | `readLeadForEmail(orgId, leadId, projectId)` | WIRED | RLS app_authenticated only — confirmed no owner-pool import. |
| `leadsRouter` | `_app.ts` | `leads: leadsRouter` | WIRED | |
| `projects.updateSettings.leadsNotifyEmail` | `projects.leadsNotifyEmail` column | `.set(values)` with `leadsNotifyEmail` conditionally included | WIRED | |
| `leads.listForProject / create / updateEstado / addNote` | panel islands | `useTRPC()` query/mutation calls in `leads-board.tsx`, `lead-drawer.tsx`, `alta-lead-form.tsx` | WIRED | |
| `projects.updateSettings` (extended) | `notify-email-field.tsx` | `update.mutate({id, leadsNotifyEmail})` | WIRED | |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real-Postgres cross-role/transition/timeline/idempotency matrix | `npx vitest run tests/leads-role-gate.test.ts -t "owner creates a lead, seeds the t=0 timeline entry, and enqueues exactly one job"` | 1 passed | PASS |
| Real-Postgres origen resolution | `npx vitest run tests/leads-role-gate.test.ts -t "resolves broker / unidad / cotización / Directo and hides cross-org leads"` | 1 passed | PASS |
| Real-Postgres cerrado desenlace refine | `npx vitest run tests/leads-role-gate.test.ts -t "rejects moving to cerrado without a desenlace"` | 1 passed | PASS |
| Worker failure-reporting PII/secret safety | `npx vitest run -t "routes to Sentry + pino with structured ids and NEVER the raw payload/PII"` (apps/worker) | 1 passed | PASS |
| `org_owner_emails` SECURITY DEFINER + grants, live DB | `psql ... "select proname, prosecdef from pg_proc where proname='org_owner_emails'"` + `information_schema.routine_privileges` | `prosecdef=t`; grantees = `imbau`, `app_authenticated` only | PASS |
| `leads.desenlace` / `projects.leads_notify_email` columns exist, live DB | `psql \d leads`, `psql \d projects` | both columns present | PASS |
| Panel typecheck | `pnpm --filter @imbau/panel typecheck` | clean | PASS |
| Panel lint | `pnpm --filter @imbau/panel lint` | clean | PASS |
| Full workspace suite (api 166 / db 47 / worker 42) | pre-existing green run (per task context, not re-run in full here) | green | PASS (relied upon, not re-executed) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LEADS-01 | 11-03, 11-05 | Developer ve la bandeja de leads con origen (broker/unidad/cotización) | SATISFIED | `leads.listForProject` join resolution + `lead-card.tsx` origen chip. |
| LEADS-02 | 11-01, 11-03, 11-05 | Developer mueve un lead por el pipeline fijo nuevo→contactado→negociación→cerrado | SATISFIED | `updateEstado` enum-gated mutation + drag/select dual-path UI. |
| LEADS-03 | 11-03, 11-05 | Developer agrega notas al timeline del lead | SATISFIED | `addNote` append-only + drawer timeline render. |
| LEADS-04 | 11-01, 11-02, 11-03, 11-04, 11-04a, 11-05 | Developer recibe aviso por email ante lead nuevo (queued e idempotente, nunca bloquea la mutación) | SATISFIED | Post-commit enqueue seam + worker consumer + org_owner_emails fallback + panel alta form success copy. |

No orphaned requirements — REQUIREMENTS.md maps exactly LEADS-01..04 to Phase 11 and all four appear in plan `requirements` frontmatter.

### Anti-Patterns Found

None. Scanned all 16 phase-11 key files (schema, storage, api email module, leads runtime/router, projects router, worker lead-email + index, all 7 panel components) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|coming soon|not yet implemented` — zero matches.

### Human Verification Required

See frontmatter `human_verification` — 4 items: (1) drag-and-drop interaction feel, (2) desenlace-prompt visual gating + badge colors, (3) real Resend email delivery in staging, (4) overflow/backstop visual constraints (truncation, wrap, internal scroll) explicitly tagged `verification: backstop` in the 11-05 plan.

### Gaps Summary

No blocking gaps. All four ROADMAP success criteria (LEADS-01..04) are implemented, wired end-to-end, and behaviorally proven against a real Postgres instance for every code-inspectable invariant (tenant isolation, role gate, no-enumeration, state-machine gating, append-only timeline, post-commit enqueue/rollback safety, PII-safe logging, and the 11-04a SECURITY DEFINER door). One minor documentation drift was found (seed claims "14 fictitious leads"; the codebase has 13) — this does not affect any success criterion and is noted for cleanup only, not treated as a gap. The remaining open items are inherently human/UAT-verifiable (drag-and-drop feel, visual desenlace gating, live Resend delivery, and four explicitly-tagged `backstop` overflow/truncation behaviors) and are routed to human verification rather than failed.

---

_Verified: 2026-07-24T21:08:45Z_
_Verifier: Claude (gsd-verifier)_
