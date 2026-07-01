---
phase: 1
slug: schema-completo-rls
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (against real Postgres 16, roles without BYPASSRLS) |
| **Config file** | `packages/db/vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @imbau/db test` |
| **Full suite command** | `pnpm test` (turbo) |
| **Estimated runtime** | ~{N} seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @imbau/db test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green (CI `quality` gate, Postgres 16)
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

> Populated by the planner/nyquist-auditor once tasks exist. Source: RESEARCH.md `## Validation Architecture`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | SCHEMA-01 | — | Cross-tenant absence: org A cannot read/write floors/units of org B | integration | `pnpm --filter @imbau/db test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/db/tests/cross-tenant.test.ts` — extend existing absence suite to every new table (do NOT rewrite)
- [ ] `packages/db/tests/helpers.ts` — add fixtures (`makeFloor`, `makeUnit`, `makeLead`, …) in the existing style

*Existing infrastructure (Vitest + real Postgres 16 + non-privileged role guard) covers all phase requirements; only fixtures/assertions are added.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification (RLS isolation, anon published-only, anon insert publicado-vs-borrador, `pnpm db:migrate` from zero).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
