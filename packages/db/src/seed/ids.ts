// Seed idempotency + determinism core (SEED-04, RESEARCH Pattern 1 §190-207).
//
// Every seeded row derives its id BY NAME (uuidv5), never randomly, so a re-run computes the
// SAME ids → the PK conflict makes each `.onConflictDoNothing()` insert a no-op → per-table row
// counts stay invariant. This is the single mechanism that makes `pnpm db:seed` re-runnable.
//
// HARD RULE for the whole seed: never `randomUUID`, `Math.random`, `Date.now`, or the zero-arg
// `new Date()` (current time). Use `seedId(name)` for ids, `makePrng(seed)` for numeric jitter,
// and `SEED_REFERENCE_DATE` (a fixed instant) for every seeded timestamp. Non-determinism
// anywhere here breaks idempotency and reproducible demos (RESEARCH Pitfall 2 §334-337).
import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for the seed. Any valid, stable UUID works — it only has to never change,
// or previously-seeded ids would drift and re-runs would duplicate rows.
export const SEED_NS = "b1a7c0de-0000-4000-8000-000000000000";

// Deterministic id from a stable name, e.g. seedId("brigos:unit:04-B"). Pure function of its
// argument: identical input → identical UUID across process runs.
export const seedId = (name: string): string => uuidv5(name, SEED_NS);

// Fixed reference instant that anchors ALL seeded timestamps + event months. Authored as an
// explicit ISO string (a constant, deterministic value) — this is NOT the prohibited zero-arg
// `new Date()`; it never reads the wall clock.
export const SEED_REFERENCE_DATE = new Date("2026-06-01T00:00:00.000Z");

// mulberry32 — a tiny deterministic PRNG for controlled numeric jitter ONLY (m2 within a band,
// price adjustment by floor/orientation, `orden`). Same seed → identical stream across
// constructions. Never use this (or Math.random) to mint ids; ids come from seedId(name).
export function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
