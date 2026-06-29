import { describe, it, expect } from "vitest";
import { nextMonthPartitionSpec, renderCreatePartitionSql } from "./partitions";

// Unit tests for the PURE partition helpers (SCHEMA-06, D-06). These assert the
// date math + idempotent DDL generation WITHOUT any DB/Redis — the helpers are
// side-effect-free so the partition logic is provable independent of running infra.
// The naming/bounds convention mirrors the hand-written DDL in migration
// 0003_rls_domain.sql: `events_YYYY_MM` PARTITION OF "events" FOR VALUES FROM
// ('YYYY-MM-01') TO (<next month's first day>), upper bound EXCLUSIVE.

describe("nextMonthPartitionSpec", () => {
  it("rolls the year over: Dec reference → next-Jan partition", () => {
    // 2026-12-15 UTC → next month is January 2027 (year rollover correct, UTC).
    const spec = nextMonthPartitionSpec(new Date("2026-12-15T00:00:00Z"));
    expect(spec.name).toBe("events_2027_01");
    expect(spec.from).toBe("2027-01-01");
    expect(spec.to).toBe("2027-02-01");
  });

  it("zero-pads single-digit months", () => {
    // 2026-06-26 UTC → next month is July 2026; month must be padded to `07`.
    const spec = nextMonthPartitionSpec(new Date("2026-06-26T00:00:00Z"));
    expect(spec.name).toBe("events_2026_07");
    expect(spec.from).toBe("2026-07-01");
    expect(spec.to).toBe("2026-08-01");
  });

  it("uses an exclusive upper bound (next month's first day)", () => {
    // For January 2027 the [from, to) window is 2027-01-01 .. 2027-02-01 — `to`
    // is the FIRST day of the FOLLOWING month, i.e. exclusive of January's data.
    const spec = nextMonthPartitionSpec(new Date("2026-12-31T23:59:59Z"));
    expect(spec.from).toBe("2027-01-01");
    expect(spec.to).toBe("2027-02-01");
  });

  it("computes bounds in UTC regardless of the reference instant within a day", () => {
    // Late-UTC instant on the last day of a month still maps to NEXT month.
    const spec = nextMonthPartitionSpec(new Date("2026-01-31T23:30:00Z"));
    expect(spec.name).toBe("events_2026_02");
    expect(spec.from).toBe("2026-02-01");
    expect(spec.to).toBe("2026-03-01");
  });
});

describe("renderCreatePartitionSql", () => {
  it("renders idempotent CREATE TABLE IF NOT EXISTS ... PARTITION OF \"events\"", () => {
    const spec = nextMonthPartitionSpec(new Date("2026-12-15T00:00:00Z"));
    const sql = renderCreatePartitionSql(spec);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain('PARTITION OF "events"');
    expect(sql).toContain('"events_2027_01"');
    expect(sql).toContain("FOR VALUES FROM ('2027-01-01') TO ('2027-02-01')");
  });
});
