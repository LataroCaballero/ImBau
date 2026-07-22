// Pure, I/O-free bulk-preview calculator (GRID-06, D-12/D-13). Applies a `percent` or `fixed` price
// change to a selection of units on ONE chosen list (the caller supplies each unit's current price on
// that list via `BulkSelectionUnit.current`), rounding to integer USD with `Math.round` (D-12), and
// REJECTS any result `< 0` with an es-AR reason (Open Q #2 resolution — never produce a negative
// price). The returned `rows` are exactly what Plan 03's `units.bulkUpdatePrice` mutation will write,
// so the mandatory preview modal (D-13) shows the true old→new before the single all-or-nothing tx.
import type { BulkMode, BulkPreview, BulkPreviewRow, BulkError, BulkSelectionUnit } from "./types";

/**
 * Compute the previewed price change for every selected unit.
 *
 * - `mode: "percent"` → `Math.round(current * (1 + value / 100))` (e.g. +10 → +10%).
 * - `mode: "fixed"`   → `Math.round(current + value)` (a signed integer USD amount).
 * - An unpriced unit (`current === null`) cannot be scaled/adjusted → es-AR error.
 * - A result `< 0` is rejected (never write a negative price) → es-AR error.
 */
export function computeBulkPreview(
  selection: BulkSelectionUnit[],
  mode: BulkMode,
  value: number,
): BulkPreview {
  const rows: BulkPreviewRow[] = [];
  const errors: BulkError[] = [];

  for (const unit of selection) {
    if (unit.current === null) {
      errors.push({
        identificador: unit.identificador,
        reason: "la unidad no tiene precio en la lista elegida",
      });
      continue;
    }

    const next =
      mode === "percent"
        ? Math.round(unit.current * (1 + value / 100))
        : Math.round(unit.current + value);

    if (next < 0) {
      errors.push({ identificador: unit.identificador, reason: "el precio no puede ser negativo" });
      continue;
    }

    rows.push({ unitId: unit.unitId, identificador: unit.identificador, old: unit.current, new: next });
  }

  return { rows, errors };
}
