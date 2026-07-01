// seedBuilding — floors + units generators (SEED-01, RESEARCH Pattern 6, PATTERNS §70-83).
//
// Produces 13 floors (PB + 12) and ~38 units with a realistic pozo sale curve: low floors skew
// `vendido`, mid floors mix `reservado`/`disponible`, high premium floors skew `disponible` — all
// via a DETERMINISTIC seeded PRNG (never Math.random), so re-runs are identical. m² is passed as a
// STRING (postgres-js maps numeric→string); `ambientes`/`orden` are integers. Every id is
// seedId(name) and every insert ends `.onConflictDoNothing()` → re-runnable.
//
// Insertion order (composite FKs, Phase 1 D-02): floors before units. floors are committed by their
// own withTenant transaction before the units transaction runs, so the (floor_id, organization_id)
// FK is satisfied. Both share the same denormalized organization_id.
import { withTenant } from "../with-tenant";
import * as schema from "../schema";
import { seedId, makePrng } from "./ids";
import {
  FLOORS,
  TIPOLOGIAS,
  TIPOLOGIA_BY_BAND,
  ORIENTACIONES,
  UNIT_LETTERS,
  POZO_CURVE,
  floorBand,
  type Tipologia,
  type Orientacion,
} from "./content";

// Fixed PRNG seed (bytes of "Brig") — makes every jittered choice reproducible across runs.
const BUILDING_SEED = 0x42_72_69_67;

export type Estado = "disponible" | "reservado" | "vendido";

// The generated unit surface pricing needs to attach prices (id + the price inputs).
export interface SeededUnit {
  readonly id: string;
  readonly floorNumero: number;
  readonly m2: string;
  readonly orientacion: Orientacion;
  readonly tipologia: Tipologia;
}

// Deterministic pick from a non-empty readonly array using a [0,1) draw (noUncheckedIndexedAccess).
function pick<T>(arr: readonly T[], draw: number): T {
  const idx = Math.min(arr.length - 1, Math.floor(draw * arr.length));
  const value = arr[idx];
  if (value === undefined) throw new Error("pick() from an empty array");
  return value;
}

// Deterministic weighted estado for a floor band (pozo curve). `draw` in [0,1).
function weightedEstado(band: "low" | "mid" | "high", draw: number): Estado {
  const weights = POZO_CURVE[band];
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (draw < acc) return w.estado;
  }
  // Floating-point guard: return the last bucket if draw rounded to the total.
  return weights[weights.length - 1]!.estado;
}

// Units per floor stays within [2,4] (D-02): PB 4, typical floors 3, semipiso/penthouse 2.
// Totals PB(4) + floors 1-10 (10×3=30) + floors 11-12 (2×2=4) = 38 units (within 30-40).
function unitsOnFloor(numero: number): number {
  if (numero === 0) return 4;
  if (numero >= 11) return 2;
  return 3;
}

export async function seedBuilding(orgId: string, projectId: string): Promise<SeededUnit[]> {
  const prng = makePrng(BUILDING_SEED);

  // Floors.
  const floorRows = FLOORS.map((f) => ({
    id: seedId(`brigos:floor:${f.numero}`),
    organizationId: orgId,
    projectId,
    numero: f.numero,
    nombre: f.nombre,
  }));
  await withTenant(orgId, (tx) =>
    tx.insert(schema.floors).values(floorRows).onConflictDoNothing(),
  );

  // Units.
  const unitRows: (typeof schema.units.$inferInsert)[] = [];
  const seeded: SeededUnit[] = [];
  for (const f of FLOORS) {
    const band = floorBand(f.numero);
    const typologyOptions = TIPOLOGIA_BY_BAND[band];
    const floorId = seedId(`brigos:floor:${f.numero}`);
    const count = Math.min(unitsOnFloor(f.numero), UNIT_LETTERS.length);

    for (let i = 0; i < count; i += 1) {
      const letter = UNIT_LETTERS[i];
      if (letter === undefined) break;

      const tipologia = pick(typologyOptions, prng());
      const def = TIPOLOGIAS[tipologia];
      const m2Value = def.m2Min + prng() * (def.m2Max - def.m2Min);
      const m2 = m2Value.toFixed(2); // numeric → STRING
      const orientacion = pick(ORIENTACIONES, prng());
      const estado = weightedEstado(band, prng());
      const identificador = f.numero === 0 ? `PB-${letter}` : `${f.numero}${letter}`;
      const id = seedId(`brigos:unit:${identificador}`);

      unitRows.push({
        id,
        organizationId: orgId,
        projectId,
        floorId,
        identificador,
        tipologia,
        m2,
        orientacion,
        ambientes: def.ambientes,
        estado,
        orden: i + 1,
      });
      seeded.push({ id, floorNumero: f.numero, m2, orientacion, tipologia });
    }
  }
  await withTenant(orgId, (tx) =>
    tx.insert(schema.units).values(unitRows).onConflictDoNothing(),
  );

  return seeded;
}
