---
phase: 10
slug: d1-grilla-de-unidades-editable-import-export-excel
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from 10-RESEARCH.md `## Validation Architecture`. Task IDs resolve at plan time — the map below is requirement-anchored until plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (+ fast-check 4.8.0 for property tests — net-new devDep on `@imbau/api`) |
| **Config file** | `packages/api/vitest.config.ts` (integration suites use real `_test` Postgres via `tests/setup.ts` globalSetup; pure excel-module tests need no DB) |
| **Quick run command** | `pnpm --filter @imbau/api test -- excel` (pure module, sub-second) |
| **Full suite command** | `pnpm --filter @imbau/api test` (includes role-gate + import-apply integration vs real Postgres) |
| **Estimated runtime** | ~30–45 seconds full (real PG integration); <2s pure excel |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @imbau/api test -- excel` (pure module — fast feedback)
- **After every plan wave:** Run `pnpm --filter @imbau/api test` (full, includes Postgres integration)
- **Before `/gsd-verify-work`:** Full `@imbau/api` + `@imbau/db` suites green; TS strict + lint clean
- **Max feedback latency:** ~45 seconds

---

## Per-Task Verification Map

*Requirement-anchored until plan task IDs exist. `wave_0_complete` gates the ❌ W0 rows.*

| Requirement | Wave | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| GRID-01 | 1 | Inline price UPSERT persists + sets vigencia; owner/dev ✓, viewer 403, cross-org NOT_FOUND | T-10-CROSSTENANT | RLS `unit_prices_tenant` + `requireRole` deny viewer/other-org | integration (createCaller vs PG) | `pnpm --filter @imbau/api test -- units-role-gate` | ❌ W0 | ⬜ pending |
| GRID-02 | 1 | Estado change persists; enum validated; role gate | T-10-VIEWER-WRITE | `requireRole` FORBIDDEN pre-mutation | integration | `pnpm --filter @imbau/api test -- units-role-gate` | ❌ W0 | ⬜ pending |
| GRID-03 | 0/1 | Export sanitizes `= + - @ \t \r`; template column order | T-10-CSV-INJECT | `sanitizeCell` prefixes with `'` (D-11) | unit (pure) | `pnpm --filter @imbau/api test -- build` | ❌ W0 | ⬜ pending |
| GRID-04 | 0/1 | Money parse never yields non-integer; formula/date/richText/negative rejected; es-AR `185.000`→185000 | T-10-FLOAT-MONEY | integer-only parse + `Number.isInteger` gate | unit + **property (fast-check)** | `pnpm --filter @imbau/api test -- money` | ❌ W0 | ⬜ pending |
| GRID-04 | 0/1 | Dry-run classifies nueva/cambio/igual/inválida + per-row es-AR reason | — | friendly parse-error, no path/filename trust | unit | `pnpm --filter @imbau/api test -- dry-run` | ❌ W0 | ⬜ pending |
| GRID-05 | 1 | All-or-nothing: one bad row → zero writes; idempotent re-import = no-op | T-10-PARTIAL-WRITE | single `withTenant` tx, throw-to-rollback (D-08) | integration (vs PG) | `pnpm --filter @imbau/api test -- import-apply` | ❌ W0 | ⬜ pending |
| GRID-05 | 1 | `UNIQUE(unit_id, price_list_id)` migration present + enforced | — | dup insert rejected at DB | integration | `pnpm --filter @imbau/api test -- import-apply` | ❌ W0 | ⬜ pending |
| GRID-06 | 1 | Bulk % / fixed → `Math.round` int USD; negative result rejected; preview matches apply | T-10-FLOAT-MONEY | integer rounding + reject negative | unit + integration | `pnpm --filter @imbau/api test -- bulk` | ❌ W0 | ⬜ pending |
| GRID-07 | 1 | Price/estado mutation visible through anon picker caller (Path A) | — | anon RLS `*_anon_published` read path | integration (cross-surface) | `pnpm --filter @imbau/api test -- public-reflection` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/api/src/excel/*.test.ts` — money (property), parse, build/sanitize, dry-run, bulk
- [ ] `packages/api/tests/units-role-gate.test.ts` — clone `projects-role-gate.test.ts` for the 4 mutations (owner✓/developer✓/viewer 403/other-org NOT_FOUND)
- [ ] `packages/api/tests/import-apply.test.ts` — all-or-nothing + idempotency vs real Postgres
- [ ] `packages/api/tests/public-reflection.test.ts` — cross-surface anon visibility (GRID-07 Path A)
- [ ] Migration test: duplicate `(unit_id, price_list_id)` insert rejected
- [ ] Add `fast-check` to `@imbau/api` devDependencies

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grid inline edit / dropdown / bulk wizard UX (visual) | GRID-01/02/06 | Browser interaction + es-AR copy rendering not fully assertable in unit tests | Boot `apps/panel` into a seeded org owning a project, open `proyectos/[id]/unidades`, exercise inline price edit, estado dropdown, and a bulk-edit preview; confirm es-AR copy per 10-UI-SPEC Copywriting Contract |
| Import wizard round-trip (export → edit in Excel → re-import → preview → apply) | GRID-03/04/05 | End-to-end file round-trip through a real spreadsheet editor | Export the grid, edit prices in Excel, re-upload; confirm dry-run diff (viejo→nuevo por campo), invalid-row report with es-AR reasons, Aplicar disabled until 100% valid, then apply |

*Pure logic (parse, sanitize, dry-run classification, transactional apply, role gate, public reflection) is all automated above — manual items are visual/UX confirmation only.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
