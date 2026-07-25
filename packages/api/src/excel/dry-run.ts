// Pure, I/O-free dry-run classifier/diff (GRID-04, D-06/D-07). Given the parsed import rows
// (`RawRow[]`) and the current DB snapshot (`CurrentUnit[]`, supplied by Plan 03 — NO I/O here), it
// classifies every row as `nueva` / `con cambios` / `sin cambios`, or collects it as an `inválida`
// error with a 1-based row number + an es-AR reason (10-UI-SPEC §Copywriting Contract). Plan 03's
// import-apply mutation RE-RUNS this inside the tenant transaction before writing (never trust the
// client) — the pure engine is the single source of validation truth.
//
// WHY blank price ≠ error: an unpriced unit exports as a BLANK cell (build.ts writes null), so a
// faithful re-import must read that blank back as "no price" (null), not as a validation error — that
// is what makes an unchanged re-import classify every row `sin cambios` (the idempotency signal
// GRID-05 relies on). Only a MALFORMED price (formula/date/richText/fractional/negative/garbage) is an
// error; a genuinely empty cell means "leave this list unpriced".
import ExcelJS from "exceljs";

import { parseMoneyEsAr } from "./money";
import type {
  ClassifiedRow,
  CurrentUnit,
  DryRunResult,
  FieldDiff,
  RawRow,
  RowClass,
  ValidationError,
} from "./types";

// The valid `estado` set — a local mirror of packages/db unidadEstadoEnum (disponible/reservado/
// vendido). Kept local so this module imports NO DB code and stays provably pure (Task 2 acceptance).
const VALID_ESTADOS = ["disponible", "reservado", "vendido"] as const;
const ESTADOS_HINT = VALID_ESTADOS.join(", ");

// parseMoneyEsAr's blank sentinel — a blank price cell is "no price" (null), not an error (see header).
const BLANK_PRICE_REASON = "falta el precio";

/** Read a price cell as an integer USD, a null (blank = unpriced), or an es-AR error reason. */
function readPrice(cell: ExcelJS.Cell): { ok: true; value: number | null } | { ok: false; reason: string } {
  const r = parseMoneyEsAr(cell);
  if (r.ok) return { ok: true, value: r.value };
  if (r.reason === BLANK_PRICE_REASON) return { ok: true, value: null };
  return { ok: false, reason: r.reason };
}

/** Append a field diff when the imported value differs from the current one. */
function pushDiff(
  changes: FieldDiff[],
  field: FieldDiff["field"],
  oldValue: number | string | null,
  newValue: number | string | null,
): void {
  if (oldValue !== newValue) changes.push({ field, old: oldValue, new: newValue });
}

/**
 * Classify each import row against the current project snapshot.
 *
 * - identificador absent → `{ rowNumber, reason: "falta el identificador" }`.
 * - identificador not in `current` → `"...no existe en el proyecto"` (units are NOT created via Excel).
 * - estado outside the enum → `"...no es válido (usá disponible, reservado o vendido)"`.
 * - a malformed price cell → the parseMoneyEsAr es-AR reason.
 * - otherwise: `sin cambios` (identical), `nueva` (a previously-unpriced unit gains a price), or
 *   `con cambios` (an existing unit whose price/estado changed, carrying field-by-field old→new).
 */
export function buildDryRun(raw: RawRow[], current: CurrentUnit[]): DryRunResult {
  const byId = new Map<string, CurrentUnit>();
  for (const u of current) byId.set(u.identificador, u);

  const rows: ClassifiedRow[] = [];
  const errors: ValidationError[] = [];

  for (const row of raw) {
    const identificador = row.identificador.trim();

    if (identificador === "") {
      errors.push({ rowNumber: row.rowNumber, reason: "falta el identificador" });
      continue;
    }

    const unit = byId.get(identificador);
    if (!unit) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: `el identificador '${identificador}' no existe en el proyecto`,
      });
      continue;
    }

    const estado = row.estado.trim();
    if (!(VALID_ESTADOS as readonly string[]).includes(estado)) {
      errors.push({
        rowNumber: row.rowNumber,
        reason: `el estado '${estado}' no es válido (usá ${ESTADOS_HINT})`,
      });
      continue;
    }

    const fin = readPrice(row.financiadoCell);
    if (!fin.ok) {
      errors.push({ rowNumber: row.rowNumber, reason: fin.reason });
      continue;
    }
    const con = readPrice(row.contadoCell);
    if (!con.ok) {
      errors.push({ rowNumber: row.rowNumber, reason: con.reason });
      continue;
    }

    const changes: FieldDiff[] = [];
    pushDiff(changes, "financiado", unit.financiado, fin.value);
    pushDiff(changes, "contado", unit.contado, con.value);
    pushDiff(changes, "estado", unit.estado, estado);

    let rowClass: RowClass;
    if (changes.length === 0) {
      rowClass = "sin cambios";
    } else {
      // A unit that was entirely unpriced (both lists null) and now gains a price is "nueva" (a
      // first-time price entry); any other modification of an already-tracked unit is "con cambios".
      const wasPriced = unit.financiado !== null || unit.contado !== null;
      const nowPriced = fin.value !== null || con.value !== null;
      rowClass = !wasPriced && nowPriced ? "nueva" : "con cambios";
    }

    rows.push({ rowNumber: row.rowNumber, identificador, unitId: unit.unitId, rowClass, changes });
  }

  const summary = {
    nuevas: rows.filter((r) => r.rowClass === "nueva").length,
    conCambios: rows.filter((r) => r.rowClass === "con cambios").length,
    sinCambios: rows.filter((r) => r.rowClass === "sin cambios").length,
    conErrores: errors.length,
  };

  return { summary, rows, errors };
}
