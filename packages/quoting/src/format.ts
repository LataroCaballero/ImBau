// The deterministic es-AR money formatter (D-12, RESEARCH Pattern 4).
//
// WHY THIS OWNS THE LABEL: Intl currency-style formatting inserts a narrow no-break space (U+202F)
// and a symbol whose exact form drifts across ICU versions — so the string rendered in the browser
// (fase 6) could differ from Node/worker (fase 7) by an INVISIBLE character, and a `$` on a USD value
// reads as pesos (1000x misread, Pitfall 5 / threat T-04-04). Instead we own the label (`US$ ` / `$ `)
// as a literal with a NORMAL ASCII space and group the DIGITS with the es-AR DECIMAL number format
// (grouping separator `.`, never a space in es-AR). Same input → same output in both runtimes. This
// is the contract UI == PDF == WhatsApp.

// Digits-only grouper: es-AR groups thousands with `.`. No fraction — the caller owns decimals.
// Decimal style only, never currency style (see header). Reused across calls; the only ICU touch.
const groupEsAr = new Intl.NumberFormat("es-AR", {
  style: "decimal",
  useGrouping: true,
  maximumFractionDigits: 0,
});

/**
 * Render a whole-USD amount as `US$ 1.234` — dot thousands separator, hand-owned `US$ ` label with
 * a normal ASCII space. USD carries no decimals (money rule: whole USD, D-14).
 */
export function formatUsd(amount: number): string {
  return `US$ ${groupEsAr.format(amount)}`;
}

/**
 * Render a 2-decimal ARS STRING (as produced by `decimal2`) as `$ 1.234.560,00` — dot thousands,
 * comma decimals, hand-owned `$ ` label. The integer part is grouped via `groupEsAr` on a BigInt
 * (no float coercion, so arbitrarily large ARS values stay exact); the 2 decimals are taken VERBATIM
 * from the input string so no rounding drift is introduced at the display boundary.
 */
export function formatArs(amount: string): string {
  const dot = amount.indexOf(".");
  const intPart = amount.slice(0, dot);
  const decPart = amount.slice(dot + 1);
  return `$ ${groupEsAr.format(BigInt(intPart))},${decPart}`;
}
