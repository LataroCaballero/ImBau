---
phase: 3
slug: auth-api-app-surfaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (unit/integration) + Playwright 1.60 (e2e auth/tenancy flows) |
| **Config file** | per-package `vitest.config.ts` (root `turbo run test`); Playwright config added this phase |
| **Quick run command** | `pnpm test` (turbo, affected) |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm lint` |
| **Estimated runtime** | ~TBD (planner/executor to measure) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` (quick)
- **After every plan wave:** Run the full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** TBD seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-02-T1/T3 | 03-02 | 2 | AUTH-02 | T-03-05 | tenant derived server-side from session.activeOrganizationId; org A caller sees ZERO org B project rows via the tRPC caller | integration (Vitest, tRPC caller + Postgres) | `pnpm --filter @imbau/api test -t "tenant"` | ✅ `packages/api/tests/trpc-tenant.test.ts` | ✅ green |
| 03-02-T3 | 03-02 | 2 | APP-01 | T-03-05 | `projects.listForOrg` returns only the active org's projects (RLS via withTenant), absence-proven both directions | integration | `pnpm --filter @imbau/api test -t "tenant isolation"` | ✅ `packages/api/tests/trpc-tenant.test.ts` | ✅ green |
| 03-02-T3 | 03-02 | 2 | APP-02 | — | `projects.listPublished` (withAnon) returns only `publicado`, ZERO `borrador` | integration | `pnpm --filter @imbau/api test -t "anon published-only"` | ✅ `packages/api/tests/trpc-tenant.test.ts` | ✅ green |
| 03-02-T1/T3 | 03-02 | 2 | AUTH-03 | T-03-06 | `member.invite` is owner-only: FORBIDDEN for a viewer caller, allowed for an owner | integration | `pnpm --filter @imbau/api test -t "requireRole"` | ✅ `packages/api/tests/trpc-tenant.test.ts` | ✅ green |
| TBD | — | — | AUTH-01 / APP-03 / APP-04 | — | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner fills this map from PLAN.md tasks; key behaviors to cover: signup→login→session persistence (AUTH-01), active-org tenant scoping + role enforcement (AUTH-02), invite→accept→role (AUTH-03), panel tenant read (APP-01), web anon published-only read incl. cross-tenant/non-publicado absence (APP-02), worker boot/Redis connect (APP-03). Dockerfile build (APP-04) is verified in CI Phase 4 — manual-only here.*

---

## Wave 0 Requirements

- [ ] Playwright config + e2e harness for auth/tenancy flows
- [ ] tRPC/auth integration-test fixtures (test org A/B, seeded members/projects) reusing the Phase 2 Postgres-backed harness
- [ ] Any missing test stubs for AUTH-/APP- requirement IDs

*Resolved during planning.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker image builds (turbo prune + Next standalone) | APP-04 | No local Docker daemon; image build runs in CI (Phase 4) | Phase 4 CI builds/pushes the three images; Phase 3 only authors + statically validates the Dockerfiles |
| Real invitation email delivery via Resend | AUTH-03 | Requires Resend key + verified domain (staging only); dev logs the link | Verify on staging; locally assert the dev fallback logs the accept link |

*Planner may add automated coverage where feasible (e.g., assert `sendInvitationEmail` is invoked / dev-fallback logs the link).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency target set
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
