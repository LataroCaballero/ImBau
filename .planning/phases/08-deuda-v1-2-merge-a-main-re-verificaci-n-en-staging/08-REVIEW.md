---
phase: 08-deuda-v1-2-merge-a-main-re-verificaci-n-en-staging
reviewed: 2026-07-17T21:46:47Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/db/vitest.config.ts
  - apps/worker/vitest.config.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-17T21:46:47Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Two test-config files received fix-forward changes to stabilize pre-existing CI flakes before merging PR #5:

- `packages/db/vitest.config.ts` — added `fileParallelism: false`.
- `apps/worker/vitest.config.ts` — added `testTimeout: 30_000` and `hookTimeout: 60_000`.

Both changes are **correct in intent and diagnosis**. I verified the root causes against source:

- The db serialization fix is justified: `runSeed` (`packages/db/seed.ts:68`) issues `CREATE TABLE IF NOT EXISTS "<name>" PARTITION OF "events"`, which is genuinely not atomic against a concurrent creator in Postgres (42P07). Four seed test files (`seed.building-pricing`, `seed.content`, `seed.idempotency`, `seed.media`) call `runSeed` against the single shared `_test` DB, so cross-file parallelism does race. `fileParallelism: false` removes the race without touching the shipping seed path. Correct.
- The worker timeout bump is justified: the media suites run real sharp AVIF/WebP encode/decode and `tests/media-integration.test.ts` hits real PG16, which legitimately exceeds Vitest's 5000ms default under CI CPU contention.

`mergeConfig` deep-merges these keys cleanly (the root config declares neither `testTimeout`, `hookTimeout`, nor `fileParallelism`, so there is no override conflict). No security issues, no data-loss risk, no correctness bugs in the changed lines. The two findings below concern the **breadth** of each change (scope creep beyond the flaky tests) and the fact that each masks — rather than fixes — an underlying property that could still bite outside the harness.

No Critical issues found.

## Warnings

### WR-01: `fileParallelism: false` serializes the entire db suite to fix a race isolated to 4 seed files, and masks a non-idempotent-under-concurrency seed DDL

**File:** `packages/db/vitest.config.ts:30`
**Issue:**
The flake originates only in the 4 files that call `runSeed`. Disabling `fileParallelism` globally also serializes the other 4 files in the suite (`cross-tenant.test.ts`, `db.test.ts`, `resolve-media.test.ts`, `seed.prerequisites.test.ts` / helpers) that do not race, paying a full-suite runtime cost to fix a subset of files. More importantly, the fix works around the harness rather than the underlying property: `renderCreatePartitionSql` (`packages/db/seed.ts:66-71`) relies on `CREATE TABLE IF NOT EXISTS ... PARTITION OF`, which is not concurrency-safe. The config comment argues "prod/staging seed once," which is true today — but if two seed processes ever run concurrently in prod (e.g. two deploy runners, a retried CI deploy job, or a future parallel-tenant seeder), the same 42P07 will surface where there is no `fileParallelism` knob to hide it. The test change is acceptable as a stabilization tactic, but it converts a latent seed bug into an invisible one.
**Fix:**
Keep `fileParallelism: false` for now (lowest-risk stabilizer before the merge), but track hardening the seed so the DDL is genuinely idempotent under concurrency and the race cannot resurface off-harness. Wrap the partition pre-create in a transaction-scoped advisory lock so concurrent creators serialize at the DB level:
```sql
-- in runSeed, before the CREATE TABLE IF NOT EXISTS ... PARTITION OF loop:
SELECT pg_advisory_xact_lock(hashtext('imbau:events_partition_seed'));
```
Alternatively, catch and swallow SQLSTATE 42P07 (`duplicate_table`) around the partition create, treating it as the intended no-op. Either makes the seed safe regardless of how the test harness schedules files, and lets `fileParallelism` be re-enabled later if suite runtime matters.

### WR-02: Worker `testTimeout: 30_000` is applied suite-wide, weakening the failure signal for the many pure/mocked worker tests

**File:** `apps/worker/vitest.config.ts:39`
**Issue:**
The justification (`env` comment, lines 34-38) is specifically about the media suites and the MEDIA-04 integration suite — the genuinely slow, contended work. But the worker package is mostly fast pure/mocked units: `env.test.ts`, `partitions.test.ts`, `quote-pdf-doc.test.ts`, `media-variants.test.ts`, `media-failure.test.ts`, etc. Raising the global `testTimeout` from 5s to 30s means a future regression that makes any of these pure tests hang or spin (e.g. an accidental unawaited/looping path) now takes 30s to fail instead of 5s, and — combined with the lazy dummy DB fallback (`dummyDbUrl`, lines 50-53) — a genuinely unreachable Postgres in `media-integration.test.ts` will burn up to 30s per case before failing rather than surfacing quickly. The change trades fast, loud failure for tolerance across the whole suite when only a couple of suites need the slack.
**Fix:**
Scope the generous timeout to the tests that need it instead of the whole package. Either set the timeout per-test/per-suite on the media + integration cases:
```ts
it("encodes AVIF + WebP variants", { timeout: 30_000 }, async () => { /* ... */ });
// or, per file:
describe("media integration", () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
  // ...
});
```
or split the slow suites into a separate Vitest project so the default 5s guard still protects the pure units. Keep `hookTimeout: 60_000` at the config level (that one legitimately covers the shared globalSetup migrate).

## Info

### IN-01: Both configs correctly mirror the sibling packages and are well-documented

**File:** `packages/db/vitest.config.ts:23-34`, `apps/worker/vitest.config.ts:34-40`
**Issue:** Not a defect — noted for the record. The `hookTimeout: 60_000` / `testTimeout: 30_000` pairing now matches between `packages/db` and `apps/worker`, and the inline comments accurately and specifically document the root cause (the 42P07 partition race; sharp/PG16 contention) rather than a vague "flaky, bumped timeout." This is the right level of rigor for a fix-forward stabilization and makes the WR-01/WR-02 follow-ups easy to action later. The only reason these rate a mention is that the comments assert "No production code path is affected" (worker) and "purely a shared-DB test-harness concern" (db) — accurate for the test run itself, but see WR-01: the underlying seed DDL non-idempotency is a production property the test change now hides.
**Fix:** No action required. Consider adding a one-line pointer in the db comment to the seed hardening tracked in WR-01 so the "harness-only" claim doesn't read as "nothing to fix."

---

_Reviewed: 2026-07-17T21:46:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
