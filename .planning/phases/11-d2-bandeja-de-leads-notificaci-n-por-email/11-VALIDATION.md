---
phase: 11
slug: d2-bandeja-de-leads-notificaci-n-por-email
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
---

# Phase 11 — Validation Strategy

> Per-phase validation contract. Retroactive audit (State B) — reconstructed from
> the executed SUMMARYs and verified against the live test suites on 2026-07-24.
> Every requirement (LEADS-01..04) has green automated coverage; the UI-visual
> behaviors are manual-only and were confirmed by 11-UAT.md (4/4 pass).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.8 |
| **Config file** | per-package `vitest.config.ts` (api, worker, db, panel) |
| **Quick run command** | `pnpm --filter @imbau/api test` |
| **Full suite command** | `pnpm --filter @imbau/api test && pnpm --filter @imbau/worker test` |
| **Estimated runtime** | ~6s (api ~4s, worker ~1.7s) |
| **Env** | `_test` DB env preamble (see local-test-env-recipe): TEST_DATABASE_*/DATABASE_* → `imbau_test`, REDIS_URL :6380, BETTER_AUTH_* |

---

## Sampling Rate

- **After every task commit:** Run the package quick command for the touched package
- **After every plan wave:** Run both api + worker suites
- **Before `/gsd-verify-work`:** Full suite green (verified 2026-07-24: api 166/166, worker 42/42)
- **Max feedback latency:** ~6 seconds

---

## Per-Task Verification Map

| Requirement | Plan / Wave | Secure Behavior | Test Type | Automated Command | File | Status |
|-------------|-------------|-----------------|-----------|-------------------|------|--------|
| LEADS-01 (bandeja + origen resuelto por joins) | 11-03 / W2 | tenant-scoped read (RLS); origen resolved broker/unidad/cotización/Directo | integration | `pnpm --filter @imbau/api test` | `packages/api/tests/leads-role-gate.test.ts` | ✅ green |
| LEADS-02 (pipeline fijo nuevo→contactado→negociación→cerrado) | 11-03 / W2 | requireRole write gate; state-machine transitions (no free states) | integration | `pnpm --filter @imbau/api test` | `packages/api/tests/leads-role-gate.test.ts` | ✅ green |
| LEADS-03 (notas en timeline, orden persistido) | 11-03 / W2 | withTenant append; ordered timeline | integration | `pnpm --filter @imbau/api test` | `packages/api/tests/leads-role-gate.test.ts` | ✅ green |
| LEADS-04 (email encolado + idempotente + no-bloqueante) — dispatch | 11-02 / W1 | dev-console fallback (no key); verified INVITE_FROM sender; throw on Resend error | unit (mocked Resend) | `pnpm --filter @imbau/api test` | `packages/api/tests/send-lead-notification.test.ts` | ✅ green |
| LEADS-04 — worker consumer + recipient resolution | 11-04 / W2 | recipient = leadsNotifyEmail ?? owners under withTenant; ids-only payload/logs | unit (mocked db/resend) | `pnpm --filter @imbau/worker test` | `apps/worker/src/lead-email.test.ts` | ✅ green |
| LEADS-04 — enqueue seam (only on create, jobId idempotency) | 11-02/03 | `jobId=lead:{id}:created` dedups; enqueue never on transitions/notes | integration | `pnpm --filter @imbau/api test` | `packages/api/tests/leads-role-gate.test.ts` | ✅ green |
| Schema/seed (migration 0006/0007, fictitious seed) | 11-01 / 11-04a | additive nullable DDL; SECURITY DEFINER org_owner_emails | integration | `pnpm --filter @imbau/db test` | `packages/db/tests/{seed.*,cross-tenant}.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new framework or Wave 0
scaffolding was needed — the phase reused the established vitest + `_test` DB harness.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Result |
|----------|-------------|------------|-------------------|--------|
| Kanban drag & drop feel + drop-target ring + optimistic-move-then-confirm | LEADS-02 | Pointer-drag interaction & visual affordance — not unit-testable | 11-UAT.md test 1 | ✅ pass (2026-07-24) |
| Desenlace prompt visual gating (no-close-without-choice) + Ganado/Perdido badges | LEADS-02 | Required-choice modal + colored badge rendering | 11-UAT.md test 2 | ✅ pass |
| Real Resend email delivery E2E (render → send → inbox) | LEADS-04 | Third-party delivery beyond the mocked dispatch unit | 11-UAT.md test 3 (fixed G-11-3, verified) | ✅ pass |
| Narrow-viewport overflow/backstops (320px columns, truncation+title, drawer wrap, timeline scroll) | LEADS-01 | UI-SPEC visual state across viewport sizes | 11-UAT.md test 4 | ✅ pass |

---

## Validation Sign-Off

- [x] All requirements have automated verification (unit/integration) or documented manual-only rationale
- [x] Sampling continuity: no 3 consecutive requirements without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra sufficient)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-24 (api 166/166, worker 42/42 green; UAT 4/4 pass)
