// events — analytics table, partitioned BY RANGE (ts) per month (SCHEMA-06).
//
// ┌─ FLAG-B ──────────────────────────────────────────────────────────────────────────────────┐
// │ This pgTable is declared for TYPES ($inferInsert/$inferSelect) + the co-located Zod schema  │
// │ ONLY. It is INTENTIONALLY ABSENT from `drizzle.config.ts`'s `schema:` array. Drizzle has no  │
// │ `PARTITION BY` support, so if drizzle-kit saw this file it would emit a PLAIN                 │
// │ `CREATE TABLE "events"` that collides with the hand-written partitioned DDL. ALL events DDL   │
// │ — the `CREATE TABLE ... PARTITION BY RANGE (ts)`, the composite PRIMARY KEY (id, ts), the     │
// │ monthly + DEFAULT partitions, the composite FK → projects, the GRANTs, FORCE ROW LEVEL        │
// │ SECURITY, and BOTH policies (tenant clone of projects_tenant + anon INSERT-only) — is         │
// │ hand-written in the migration authored by plan 01-04 (D-04). Mirrors the `.existing()` role   │
// │ pattern: declare in TS for identity/types, hand-write the real DDL.                           │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// FLAG-A: `id` is NOT a single-column primary key. PostgreSQL requires a partitioned table's PK
// to include the partition key, so the real PK is `(id, ts)` — declared in the hand migration,
// NOT here. We therefore declare `id` as notNull().defaultRandom() WITHOUT `.primaryKey()`.
//
// Tenancy: events carries a denormalized organization_id (TEXT) and project_id; tenancy is pinned
// by the hand-written composite FK → projects (id, organization_id). unit_id/broker_id are plain
// nullable ANALYTICS pointers with NO FK — keeping the high-volume table write-light (D-03 note).
// This module declares NO `foreignKey`, NO `pgPolicy`, and does NOT call `.enableRLS()`.
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

export const events = pgTable("events", {
  // FLAG-A: explicitly NOT .primaryKey() — the partitioned PK (id, ts) is hand-written in 01-04.
  id: uuid("id").notNull().defaultRandom(),
  // Denormalized tenant key (D-01). TEXT to match organization.id; FK is hand-written (FLAG-B).
  organizationId: text("organization_id").notNull(),
  // Natural tenancy parent (composite-FK'd to projects in the hand migration).
  projectId: uuid("project_id").notNull(),
  tipo: text("tipo").notNull(),
  // Plain nullable analytics pointers — NO FK (keeps the high-volume table write-light, D-03).
  unitId: uuid("unit_id"),
  brokerId: uuid("broker_id"),
  sessionId: text("session_id"),
  // RANGE partition key. defaultNow() so an INSERT without ts lands in the current month.
  ts: timestamp("ts", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Boundary validator for the anon analytics payload (D-10). drizzle-zod derives the insert shape
// from the table; the future public ingestion endpoint validates against this before the DB
// policy enforces publicado-gating. Endpoint + rate-limit are Fase-2 (D-11) — only this schema lands.
export const eventInsertSchema = createInsertSchema(events);
