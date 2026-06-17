---
status: testing
phase: 02-data-layer-rls
source: [02-VERIFICATION.md]
started: "2026-06-17T12:30:00Z"
updated: "2026-06-17T12:30:00Z"
---

## Current Test

number: 1
name: Compose stack healthchecks (DATA-01)
expected: |
  `docker compose up -d` from repo root brings up postgres:16-alpine and
  redis:7-alpine; `pg_isready -U imbau -d imbau` accepts connections; `redis-cli
  ping` returns PONG; Redis is on host port 6380 (not 6379).
awaiting: user response

## Tests

### 1. Compose stack healthchecks (DATA-01)
expected: `docker compose up -d` brings up postgres:16-alpine + redis:7-alpine; `pg_isready -U imbau -d imbau` accepts connections; `redis-cli ping` returns PONG; Redis on host port 6380.
result: [pending]

### 2. Migration apply + role/RLS state (DATA-02 / DATA-03)
expected: `pnpm --filter @imbau/db db:migrate` against the Compose Postgres applies both migrations — `drizzle.__drizzle_migrations` has 2 entries with non-null hash; `pg_roles` shows `app_authenticated` and `anon` with `rolsuper=f` and `rolbypassrls=f`; `pg_class.relforcerowsecurity=t` for `projects`, `member`, and `organization`.
result: [pending]

### 3. Cross-tenant absence suite — milestone exit gate (DATA-04)
expected: `pnpm --filter @imbau/db test` against Compose Postgres with a dedicated `imbau_test` DB (and app/anon role passwords set per 02-03-SUMMARY.md "User Setup Required") passes all cases — globalSetup migrate + role guard; (a) read isolation A→B over projects AND member (zero sibling rows); (b) mirror B→A; (c) cross-tenant INSERT rejected by RLS (`42501`) on both tables and cross-tenant UPDATE affects 0 rows; (d) anon sees `publicado` and zero `borrador`; plus the organization self-isolation case (a tenant reads exactly its own organization row, zero siblings — CR-01). This is decision CI-02: the authoritative run is in CI (Phase 4) against a real Postgres 16 service.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
