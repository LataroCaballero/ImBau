// Versioned-output contract (ENGINE-06 / D-13). ENGINE_VERSION stamps every quote snapshot
// so a persisted quote is self-describing and never needs a DB migration to be re-read.
//
// INVARIANT: this integer MUST equal the `quoteSnapshotSchema` envelope literal in
// packages/db/src/schema/json-schemas.ts (`z.object({ version: z.literal(1) })`). A snapshot
// written with this version validates against that envelope with no migration. Bump this
// constant ONLY when the calc semantics change in a way that alters a stored snapshot's meaning —
// and bump the Zod literal in lock-step at the same time.
export const ENGINE_VERSION = 1 as const;
