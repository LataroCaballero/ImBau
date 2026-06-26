---
status: passed
phase: 02-data-layer-rls
source: [02-VERIFICATION.md]
started: "2026-06-17T12:30:00Z"
updated: "2026-06-17T13:15:00Z"
---

## Current Test

number: 3
name: all complete
expected: |
  All three live-DB items passed against Compose Postgres 16 (imbau_test).
awaiting: none — UAT complete

## Tests

### 1. Compose stack healthchecks (DATA-01)
expected: `docker compose up -d` brings up postgres:16-alpine + redis:7-alpine; `pg_isready -U imbau -d imbau` accepts connections; `redis-cli ping` returns PONG; Redis on host port 6380.
result: passed — both containers Healthy; `pg_isready` → "accepting connections"; `redis-cli ping` → PONG; Redis published on host 6380.

### 2. Migration apply + role/RLS state (DATA-02 / DATA-03)
expected: migrations apply; `app_authenticated`/`anon` have `rolsuper=f`/`rolbypassrls=f`; `projects`/`member`/`organization` have `relforcerowsecurity=t`.
result: passed — fresh `imbau_test` applies `0000_init` + `0001_rls` cleanly (2 rows in `drizzle.__drizzle_migrations`); `pg_roles` shows both roles `rolsuper=f rolbypassrls=f`; `pg_class` shows all three tenant tables `relrowsecurity=t relforcerowsecurity=t`. (Required the migration-ordering fix `1b6a13f` — roles now created in 0000 before the policies reference them.)

### 3. Cross-tenant absence suite — milestone exit gate (DATA-04)
expected: full `@imbau/db` suite passes against Compose Postgres 16 with a dedicated `imbau_test` DB — guard, read isolation A↔B over projects+member, organization self-isolation, cross-tenant INSERT rejected by RLS (42501), cross-tenant UPDATE affects 0 rows, anon published-only.
result: passed — `pnpm --filter @imbau/db test` → **Tests 7 passed (7)** against fresh `imbau_test`, run as the unprivileged app/anon roles. (Also required fix `1b6a13f`: the member-INSERT assertion now walks the DrizzleQueryError cause chain to assert the 42501 RLS violation rather than the generic wrapper message.)

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None. Live verification complete on Postgres 16 via Docker Compose. The same env-parametrized suite re-runs unchanged in CI (decision CI-02, Phase 4) against the GitHub Actions Postgres 16 service.
