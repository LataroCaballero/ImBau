// Pure, dependency-free es-AR whole-USD money core — the SINGLE SOURCE OF TRUTH for how a typed
// price string becomes a non-negative INTEGER USD. Deliberately imports NOTHING (no exceljs, no db):
// it is safe to bundle into the panel client (units-grid inline editor) AND is reused by the Excel
// import parser (money.ts) so the two paths can never drift. Float contamination of USD is a
// product-killing bug (D-08), so the grouping rules + integer/overflow gate live in exactly one place.
//
// Domain rule (CLAUDE.md): USD prices are whole integers — "centavos no aplican al rubro". That
// DISSOLVES the es-AR `.`-thousands vs `,`-decimal ambiguity: a `.` is only ever a THOUSANDS grouper
// (in groups of 3), so "185.000" → 185000, but "185.5"/"185,50" are rejected.

// `precio` is a PostgreSQL int4 column (packages/db unit-prices.ts, max 2,147,483,647). A value above
// this overflows the DB with `integer out of range (22003)` — an unhandled 500 that aborts the whole
// all-or-nothing import (WR-01). We cap at the int4 max so oversized values are rejected cleanly at
// every boundary (parser, inline editor, router input) with an es-AR reason instead of a DB fault.
export const MAX_PRECIO_USD = 2_147_483_647;

// es-AR grouped integer: 1–3 leading digits then one-or-more `.`-separated 3-digit groups. Matches
// "185.000", "1.234.567"; rejects "185.5", "1.23", "12.3456".
export const ES_AR_GROUPED = /^\d{1,3}(\.\d{3})+$/;
// Plain unseparated integer: "185000".
export const PLAIN_INTEGER = /^\d+$/;

/** Is `n` a writable whole-USD price (non-negative integer within the int4 cap)? */
export function isValidPrecio(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_PRECIO_USD;
}

/**
 * Parse an es-AR money STRING → a non-negative integer USD within the int4 cap, or `null` if it is
 * not a valid whole-USD price (blank, negative, fractional, non-numeric, or too large). Pure and
 * reason-free: callers that need an es-AR reason (money.ts, the inline editor) map `null` themselves.
 *
 * "185.000" → 185000 · "1.234.567" → 1234567 · "185000" → 185000
 * "185,50" / "1.5" / "-1" / "" / "abc" / ">int4 max" → null
 */
export function parseMoneyStringEsAr(raw: string): number | null {
  const noSpace = raw.trim().replace(/\s/g, "");
  if (noSpace === "" || noSpace.startsWith("-")) return null;
  if (!PLAIN_INTEGER.test(noSpace) && !ES_AR_GROUPED.test(noSpace)) return null;
  const n = Number(noSpace.replace(/\./g, ""));
  // Defensive re-gate: a very long digit string can overflow to a non-safe integer / above the cap.
  if (!isValidPrecio(n) || !Number.isSafeInteger(n)) return null;
  return n;
}
