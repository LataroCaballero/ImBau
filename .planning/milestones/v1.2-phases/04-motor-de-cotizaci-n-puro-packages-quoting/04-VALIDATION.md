---
phase: 4
slug: motor-de-cotizaci-n-puro-packages-quoting
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (workspace) + @fast-check/vitest 0.4.x (property-based) |
| **Config file** | `packages/quoting/vitest.config.ts` — Wave 0 installs (package-scoped 100% coverage gate, never root) |
| **Quick run command** | `pnpm --filter @imbau/quoting test` |
| **Full suite command** | `pnpm --filter @imbau/quoting test -- --coverage` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @imbau/quoting test`
- **After every plan wave:** Run `pnpm --filter @imbau/quoting test -- --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green with 100% coverage
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (planner fills) | — | — | ENGINE-01..06 | — | Typed rejection of degenerate plans (D-07) | unit + property | `pnpm --filter @imbau/quoting test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/quoting/vitest.config.ts` — package-scoped coverage config with 100% thresholds (lines, branches, functions, statements)
- [ ] `packages/quoting/package.json` — deps: `decimal.js` (runtime), `fast-check` + `@fast-check/vitest` + `@vitest/coverage-v8` (dev)
- [ ] Test stubs for ENGINE-01..06: contado/financiado calc, QuoteResult shape, invariants (reconciliation, sum-of-cuotas, CAC monotonicity, determinism), rounding/remainder rule, ENGINE_VERSION export

---

## Manual-Only Verifications

*All phase behaviors have automated verification — pure functions with no I/O.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
