---
phase: 02
slug: data-layer-rls
status: approved
nyquist_compliant: false
wave_0_complete: true
created: 2026-06-17
---

# Phase 02 — Validation Strategy

> Per-phase validation contract, reconstructed from artifacts (State B). The phase was
> executed and live-verified before this validation doc existed: `02-VERIFICATION.md`
> (8/8 must-haves) and `02-UAT.md` (3/3 live items) both passed on Postgres 16 via Docker
> Compose — the DATA-04 cross-tenant suite ran green (7 tests) as the unprivileged app/anon
> roles. This doc maps requirements to that automated coverage and records the two
> behaviors that remain manual-only.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `packages/db/vitest.config.ts` (`mergeConfig(rootConfig, …)`, `globalSetup: ['./tests/setup.ts']`) |
| **Quick run command** | `pnpm --filter @imbau/db test` |
| **Full suite command** | `pnpm test` (turbo, all packages) |
| **Estimated runtime** | ~5–15 s for `@imbau/db` (live Postgres 16 dependent) |

> **Live-DB precondition:** the `@imbau/db` suite is an integration suite — its `globalSetup`
> applies the real migration journal and role-guards before any assertion, so it requires a
> reachable Postgres 16 (Compose locally, or the CI Postgres 16 service in Phase 4). Without a
> daemon the suite fails fast at `ECONNREFUSED :5432` (env gate), which is why the live run is
> the milestone exit gate (decision CI-02).

---

## Sampling Rate

- **After every task commit:** `pnpm --filter @imbau/db typecheck && pnpm --filter @imbau/db lint` (offline gates; no daemon needed)
- **After every plan wave:** `pnpm --filter @imbau/db test` against Compose Postgres 16
- **Before `/gsd-verify-work`:** Full `@imbau/db` suite green against real Postgres 16
- **Max feedback latency:** ~15 s (live DB) / ~3 s (offline gates)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01 | 01 | 1 | DATA-01 | — | `docker compose up -d` → Postgres 16 + Redis 7 pass healthchecks | manual (infra) | n/a — see Manual-Only | ✅ compose.yml | ⬜ manual-only |
| 02-01 | 01 | 1 | DATA-02 | — | `packages/db` pins deps, has `db:generate`/`db:migrate`, no `db:push` | static + integration | `pnpm --filter @imbau/db test` (globalSetup `migrate()` applies real journal) | ✅ setup.ts | ✅ green |
| 02-02 | 02 | 1 | DATA-02 | — | Single migration journal (`0000_init` + `0001_rls`) applies cleanly | integration | `pnpm --filter @imbau/db test` (globalSetup migrate) | ✅ setup.ts | ✅ green |
| 02-02 | 02 | 1 | DATA-03 | T-02-13 / T-02-16 | `projects`/`member`/`organization` tenant policies + FORCE RLS; INSERT/UPDATE cross-tenant denied | integration | `pnpm --filter @imbau/db test` (cases c) | ✅ cross-tenant.test.ts | ✅ green |
| 02-03 | 03 | 1 | DATA-03 | T-02-11 / T-02-12 / T-02-14 | Dedicated NOSUPERUSER/NOBYPASSRLS roles; `withTenant` parameterized `set_config(...,true)`; role guard | integration | `pnpm --filter @imbau/db test` (setup.ts guard + suite guard test) | ✅ setup.ts, cross-tenant.test.ts | ✅ green |
| 02-03 | 03 | 1 | DATA-04 | T-02-10 / T-02-15 / T-02-16 | Cross-tenant ABSENCE over `projects` AND `member`; anon published-only | integration | `pnpm --filter @imbau/db test` (cases a, b, d + org self-isolation) | ✅ cross-tenant.test.ts | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · ⬜ manual-only*

---

## Wave 0 Requirements

Existing infrastructure covers all automatable phase requirements. The `@imbau/db` Vitest suite
(`vitest.config.ts` + `tests/setup.ts` globalSetup + `tests/cross-tenant.test.ts`) was authored
during execution and is the DATA-04 exit gate; no further test scaffolding is required for the
covered requirements (DATA-02/03/04).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker compose up -d` brings up Postgres 16 + Redis 7, both passing healthchecks (Redis on host 6380) | DATA-01 | Infra/operational healthcheck — requires a running Docker daemon; cannot be unit-tested without one. Belongs in CI (Phase 4, decision CI-02). UAT passed it live. | From repo root with Node 22 on PATH: `docker compose up -d && docker compose exec -T postgres pg_isready -U imbau -d imbau && docker compose exec -T redis redis-cli ping`. Expect `accepting connections` + `PONG`; Redis reachable on 6380. |
| Anon **deny boundary** on `member` and `organization`: anon reads ZERO `member` and ZERO `organization` rows (no anon GRANT) | DATA-04 (WR-05) | Test-completeness gap from `02-REVIEW.md` (WR-05), noted in `02-VERIFICATION.md` as untested-negatively. User elected to keep manual-only rather than generate the case. The deny path is *established* structurally (no GRANT to `anon` on these tables + RLS), just not asserted negatively. Not a goal blocker. | Add (or run ad hoc) an assertion: `await withAnon((tx) => tx.select().from(member))` → length 0, and `…from(organization)` → length 0. Run via `pnpm --filter @imbau/db test` against Compose Postgres 16 with seeded fixtures. |

---

## Validation Sign-Off

- [x] All covered tasks (DATA-02/03/04) have automated integration verification via the `@imbau/db` suite
- [x] Sampling continuity: no 3 consecutive covered tasks without automated verify
- [x] Wave 0 covers all MISSING references (none MISSING; covered suite pre-exists)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < 15 s (live DB)
- [ ] `nyquist_compliant: true` — **not set**: DATA-01 (infra) and the WR-05 anon-deny boundary (DATA-04) remain manual-only by user decision

**Approval:** approved 2026-06-17 (PARTIAL — 3/4 requirements automated; DATA-01 + WR-05 manual-only)
