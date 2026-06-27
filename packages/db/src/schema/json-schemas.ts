// Typed-JSONB contracts (D-12/D-13): hand-authored Zod schemas + inferred types, co-located
// in packages/db and re-exported through the barrel so the API/panel validate JSONB payloads
// at the boundary against the SAME shape the columns are typed with (`jsonb().$type<T>()`).
// drizzle-zod infers `z.any()` for jsonb, so these hand-authored validators are the runtime
// gate plugged into `createInsertSchema(table, { col: schema })` in the table modules.
import { z } from "zod";

// Refuerzo — a single balloon payment inside payment_plans.refuerzos (D-12).
// Money rule (D-14, CLAUDE.md): never float — `cuota` (installment index) and `montoUsd`
// (USD whole units) are both integers.
export const refuerzoSchema = z.object({
  cuota: z.number().int(),
  montoUsd: z.number().int(),
});
export type Refuerzo = z.infer<typeof refuerzoSchema>;

// LeadNote — a single entry in leads.timeline (D-12). Captures a status transition or a free
// note; `autor`, `estadoPrev`, `estadoNuevo` are optional so plain notes and system events
// share one shape.
export const leadNoteSchema = z.object({
  ts: z.string(),
  autor: z.string().optional(),
  nota: z.string(),
  estadoPrev: z.string().optional(),
  estadoNuevo: z.string().optional(),
});
export type LeadNote = z.infer<typeof leadNoteSchema>;

// QuoteSnapshot — quotes.snapshot versioned envelope (D-13). The envelope is FIXED to
// `{ version: 1 }`; the interior calc shape is deliberately OPEN (`.passthrough()`) because
// it is owned by `packages/quoting` (Fase 3) and must be evolvable by bumping `version`
// without a DB migration. A payload missing `version` is rejected.
export const quoteSnapshotSchema = z.object({ version: z.literal(1) }).passthrough();
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;
