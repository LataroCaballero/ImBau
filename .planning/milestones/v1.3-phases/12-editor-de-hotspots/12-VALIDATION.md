---
phase: 12
slug: editor-de-hotspots
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `12-RESEARCH.md` §Validation Architecture. Per-task rows are filled by the planner/executor.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit + property + integration vs real Postgres); Playwright for panel e2e |
| **Config file** | per-package `vitest.config.ts` (existing; Wave 0 adds no framework) |
| **Quick run command** | `pnpm --filter @imbau/api test` (geometry module + hotspots router) |
| **Full suite command** | `pnpm test` (turbo — all packages) |
| **Estimated runtime** | ~quick <30s / full a few min (real sharp/PG suites) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @imbau/api test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (quick)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-XX-XX | XX | 1 | HSPOT-04 | — | degenerate/self-intersecting polygon rejected, never persisted | unit+property | `pnpm --filter @imbau/api test` | ❌ W0 | ⬜ pending |
| 12-XX-XX | XX | 1 | HSPOT-01/02/03 | T-12 authz | owner/developer write ✓; viewer FORBIDDEN; otra-org NOT_FOUND | integration (real PG) | `pnpm --filter @imbau/api test` | ❌ W0 | ⬜ pending |
| 12-XX-XX | XX | 2 | HSPOT-01/02 | — | draw→validate→save persists intrinsic 0–1000 polygon | e2e/UAT | Playwright / manual visual | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — planner replaces XX with real plan/task ids and expands rows.*

---

## Wave 0 Requirements

- [ ] `packages/api/src/hotspots/geometry.test.ts` + `geometry.property.test.ts` — degenerate/self-intersection/bounds/round-trip stubs for HSPOT-04
- [ ] `packages/api/tests/hotspots-role-gate.test.ts` — cross-role matrix vs real Postgres (clone of `projects-role-gate.test.ts`)

*Existing Vitest/Playwright infrastructure covers the rest; no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual draw-over-render pass (vertices land where clicked; drag/close feel right) | HSPOT-01/02/03 | Canvas interaction + visual correctness needs a human; needs a background render fixture (RESEARCH §7) | Set `projects.renderExteriorKey` + a floor `renderKey` to a resolvable placeholder (seed extension or documented SQL), then `/gsd-verify-work 12`: draw a floor polygon, save, reload, confirm persistence + phase-2-shaped anon read |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
