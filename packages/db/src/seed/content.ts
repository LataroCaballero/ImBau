// Curated es-AR demo-grade content for the fictional building "Brigos Recoleta" (D-01/D-02/D-06).
//
// These are CONSTANTS (the credibility lever — D-01 "demo-grade, sin retoque"): building identity,
// floor plan, typology mix + m² bands, orientations, the two price lists, the CAC payment plans
// with a semestral Refuerzo schedule, and a synthetic monthly CAC series. The row GENERATORS
// (building.ts / pricing.ts) consume these and apply deterministic numeric jitter via makePrng.
//
// Copy is es-AR (voseo where it addresses the buyer); identifiers stay English (Phase 1 D-15).
// Money rule (CLAUDE.md / D-14): integer USD for prices (Refuerzo.montoUsd), numeric-as-string for
// measures/rates (m2, anticipoPct, cac_index.valor). Never floats for money.
import type { Refuerzo } from "../schema/json-schemas";

// ── Building + tenant identity (SEED-01, D-01) ──────────────────────────────────────────────
export const BUILDING = {
  org: { name: "Desarrollos Brigos", slug: "brigos" },
  project: { nombre: "Brigos Recoleta", slug: "brigos-recoleta" },
} as const;

// ── Floor plan: PB (numero 0) + 12 upper floors → 13 floors (SEED-01, D-02) ────────────────
export interface FloorDef {
  readonly numero: number;
  readonly nombre: string;
}
export const FLOORS: readonly FloorDef[] = [
  { numero: 0, nombre: "Planta Baja" },
  { numero: 1, nombre: "Piso 1º" },
  { numero: 2, nombre: "Piso 2º" },
  { numero: 3, nombre: "Piso 3º" },
  { numero: 4, nombre: "Piso 4º" },
  { numero: 5, nombre: "Piso 5º" },
  { numero: 6, nombre: "Piso 6º" },
  { numero: 7, nombre: "Piso 7º" },
  { numero: 8, nombre: "Piso 8º" },
  { numero: 9, nombre: "Piso 9º" },
  { numero: 10, nombre: "Piso 10º" },
  { numero: 11, nombre: "Piso 11º (Semipiso)" },
  { numero: 12, nombre: "Piso 12º (Penthouse)" },
];

// ── Typology mix + coherent m² bands + ambientes (D-02, RESEARCH Pattern 6) ─────────────────
// In AR real estate: "monoambiente" = studio (1 amb), "2 ambientes" = 1 bedroom, "3 ambientes" =
// 2 bedrooms, etc. Bands widen toward the premium top typologies (semipiso/penthouse).
export type Tipologia =
  | "monoambiente"
  | "2 ambientes"
  | "3 ambientes"
  | "4 ambientes"
  | "semipiso"
  | "penthouse";

export interface TipologiaDef {
  readonly tipologia: Tipologia;
  readonly ambientes: number;
  readonly m2Min: number;
  readonly m2Max: number;
}

export const TIPOLOGIAS: Readonly<Record<Tipologia, TipologiaDef>> = {
  monoambiente: { tipologia: "monoambiente", ambientes: 1, m2Min: 30, m2Max: 38 },
  "2 ambientes": { tipologia: "2 ambientes", ambientes: 2, m2Min: 42, m2Max: 52 },
  "3 ambientes": { tipologia: "3 ambientes", ambientes: 3, m2Min: 58, m2Max: 72 },
  "4 ambientes": { tipologia: "4 ambientes", ambientes: 4, m2Min: 88, m2Max: 112 },
  semipiso: { tipologia: "semipiso", ambientes: 4, m2Min: 120, m2Max: 160 },
  penthouse: { tipologia: "penthouse", ambientes: 5, m2Min: 180, m2Max: 240 },
} as const;

// Which typologies appear on which floor band (low / mid / high). building.ts picks per unit.
export const TIPOLOGIA_BY_BAND: Readonly<Record<"low" | "mid" | "high", readonly Tipologia[]>> = {
  low: ["monoambiente", "2 ambientes", "3 ambientes"],
  mid: ["2 ambientes", "3 ambientes", "4 ambientes"],
  high: ["3 ambientes", "4 ambientes", "semipiso", "penthouse"],
} as const;

// ── Orientations (es-AR) ────────────────────────────────────────────────────────────────────
export const ORIENTACIONES = ["frente", "contrafrente", "lateral", "interno"] as const;
export type Orientacion = (typeof ORIENTACIONES)[number];

// Unit letters within a floor (identificador = `${numero}${letter}`, PB uses `PB-${letter}`).
export const UNIT_LETTERS = ["A", "B", "C", "D"] as const;

// Units-per-floor stays in [2,4] (D-02). With 13 floors this lands ~30-40 units total.
export const MIN_UNITS_PER_FLOOR = 2;
export const MAX_UNITS_PER_FLOOR = 4;

// ── Pozo sale curve (D-02): estado weighting by floor band, not random ──────────────────────
// Low floors skew vendido, mid mixed reservado/disponible, high premium mostly disponible.
export const POZO_CURVE: Readonly<
  Record<"low" | "mid" | "high", ReadonlyArray<{ estado: "disponible" | "reservado" | "vendido"; weight: number }>>
> = {
  low: [
    { estado: "vendido", weight: 0.6 },
    { estado: "reservado", weight: 0.25 },
    { estado: "disponible", weight: 0.15 },
  ],
  mid: [
    { estado: "vendido", weight: 0.25 },
    { estado: "reservado", weight: 0.35 },
    { estado: "disponible", weight: 0.4 },
  ],
  high: [
    { estado: "vendido", weight: 0.05 },
    { estado: "reservado", weight: 0.2 },
    { estado: "disponible", weight: 0.75 },
  ],
} as const;

// Floor-band classification for a floor numero (0..12). PB..3 low, 4..8 mid, 9..12 high.
export function floorBand(numero: number): "low" | "mid" | "high" {
  if (numero <= 3) return "low";
  if (numero <= 8) return "mid";
  return "high";
}

// ── Pricing (D-06): base USD/m² + deterministic adjustments applied in pricing.ts ────────────
export const PRICING = {
  // Order-of-magnitude for Recoleta pozo (~USD 2.500-3.500/m²).
  baseUsdPerM2: 2900,
  // +1.6% per floor level (view/altura premium); PB slightly discounted.
  floorPremiumPerLevel: 0.016,
  pbAdjustment: -0.05,
  // Orientation premium/discount.
  orientacionAdj: { frente: 0.05, contrafrente: -0.03, lateral: 0, interno: -0.06 } as Readonly<
    Record<Orientacion, number>
  >,
  // Contado gets a real discount off the Financiado (list) price.
  contadoDiscountPct: 0.12,
} as const;

// ── Price lists (D-06): two lists, both USD. Contado (con descuento) + Financiado (precio lista).
export interface PriceListDef {
  readonly key: string;
  readonly nombre: string;
  readonly moneda: "USD";
  readonly isContado: boolean;
}
export const PRICE_LISTS: readonly PriceListDef[] = [
  { key: "financiado", nombre: "Financiado (precio de lista)", moneda: "USD", isContado: false },
  { key: "contado", nombre: "Contado (con descuento)", moneda: "USD", isContado: true },
];

// ── Payment plans (D-06): anticipo ~30% + saldo en cuotas ajustado por CAC + refuerzos semestrales.
// refuerzos montoUsd are INTEGER USD (Refuerzo = { cuota:int, montoUsd:int }); anticipoPct is a
// numeric string (driver maps numeric→string).
export interface PaymentPlanDef {
  readonly key: string;
  readonly nombre: string;
  readonly anticipoPct: string;
  readonly cuotas: number;
  readonly ajuste: "CAC";
  readonly refuerzos: readonly Refuerzo[];
  readonly notasLegales: string;
}

// Semestral refuerzos: one balloon every 6 cuotas.
function semestralRefuerzos(cuotas: number, montoUsd: number): Refuerzo[] {
  const out: Refuerzo[] = [];
  for (let cuota = 6; cuota <= cuotas; cuota += 6) {
    out.push({ cuota, montoUsd });
  }
  return out;
}

export const PAYMENT_PLANS: readonly PaymentPlanDef[] = [
  {
    key: "financiado-30-70-cac-36",
    nombre: "Financiado 30/70 en pesos ajustado por CAC (36 cuotas)",
    anticipoPct: "30.00",
    cuotas: 36,
    ajuste: "CAC",
    refuerzos: semestralRefuerzos(36, 15000),
    notasLegales:
      "Anticipo del 30% en USD. Saldo en 36 cuotas mensuales en pesos ajustadas por el índice CAC " +
      "(Cámara Argentina de la Construcción), con refuerzos semestrales. Valores sujetos a la lista " +
      "de precios vigente al momento del boleto.",
  },
  {
    key: "financiado-20-80-cac-48",
    nombre: "Financiado 20/80 en pesos ajustado por CAC (48 cuotas)",
    anticipoPct: "20.00",
    cuotas: 48,
    ajuste: "CAC",
    refuerzos: semestralRefuerzos(48, 12000),
    notasLegales:
      "Anticipo del 20% en USD. Saldo en 48 cuotas mensuales en pesos ajustadas por el índice CAC, " +
      "con refuerzos semestrales. Plan sujeto a aprobación y a la lista de precios vigente.",
  },
];

// ── Synthetic CAC series (D-06): 18 monthly rows ending at the reference month ───────────────
// DOCUMENTED SYNTHETIC: these are NOT real INDEC/Cámara Argentina de la Construcción figures — they
// are a plausible monotonic-upward monthly index the future cotizador (next milestone) will consume.
// periodo "YYYY-MM"; valor numeric(12,4) as a STRING. Trivially swappable (pure constant).
export interface CacRow {
  readonly periodo: string;
  readonly valor: string;
}

const CAC_MONTHS = 18;
const CAC_REFERENCE_PERIODO = "2026-06"; // aligns with SEED_REFERENCE_DATE (2026-06-01)
const CAC_START_VALUE = 385_000; // index points at the OLDEST month
const CAC_MONTHLY_GROWTH = 0.032; // ~3.2%/month, monotonic upward

function buildCacSeries(): CacRow[] {
  // Parse the reference "YYYY-MM" into a 0-based month cursor.
  const [refYearStr, refMonthStr] = CAC_REFERENCE_PERIODO.split("-");
  const refYear = Number(refYearStr);
  const refMonth1 = Number(refMonthStr); // 1..12
  const rows: CacRow[] = [];
  // Emit oldest → newest so `valor` is monotonically increasing.
  for (let i = CAC_MONTHS - 1; i >= 0; i -= 1) {
    // Month index counting back i months from the reference month.
    const totalMonths = refYear * 12 + (refMonth1 - 1) - i;
    const year = Math.floor(totalMonths / 12);
    const month1 = (totalMonths % 12) + 1;
    const monthsFromStart = CAC_MONTHS - 1 - i;
    const value = CAC_START_VALUE * Math.pow(1 + CAC_MONTHLY_GROWTH, monthsFromStart);
    rows.push({
      periodo: `${year.toString().padStart(4, "0")}-${month1.toString().padStart(2, "0")}`,
      valor: value.toFixed(4),
    });
  }
  return rows;
}

export const CAC_SERIES: readonly CacRow[] = buildCacSeries();
