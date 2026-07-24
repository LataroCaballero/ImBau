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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Plan 03-02 content: media catalog, brokers, leads (+timeline), progress posts, events (D-03/D-07)
// ═══════════════════════════════════════════════════════════════════════════════════════════

// ── Media asset catalog (D-03) ──────────────────────────────────────────────────────────────
// Each logical media name maps to a committed file under assets/ (see assets/LICENSES.md for
// provenance/license) and a usage: gallery images carry a `seccion` (amenities/exteriores/
// interiores); progress images feed progress_posts. seedMedia (media.ts) uploads each file to R2
// under a deterministic key and returns a logical-name → mediaId map that content-rows.ts wires
// into galleries.imagenes[] and progress_posts.mediaId.
export type GallerySeccion = "amenities" | "exteriores" | "interiores";

export interface MediaAssetDef {
  /** Logical name; also the deterministic-id seed key (`brigos:media:<key>`). */
  readonly key: string;
  /** Filename under packages/db/src/seed/assets/. */
  readonly file: string;
  /** image/jpeg for all current assets (worker re-encodes to AVIF/WebP regardless). */
  readonly contentType: string;
  /** File extension used in the R2 originalKey. */
  readonly ext: string;
  readonly usage: "gallery" | "progress";
  /** Present only for gallery images (which section groups this image). */
  readonly seccion?: GallerySeccion;
}

const jpg = (
  key: string,
  usage: "gallery" | "progress",
  seccion?: GallerySeccion,
): MediaAssetDef => ({
  key,
  file: `${key}.jpg`,
  contentType: "image/jpeg",
  ext: "jpg",
  usage,
  ...(seccion ? { seccion } : {}),
});

export const MEDIA_ASSETS: readonly MediaAssetDef[] = [
  jpg("amenities-pileta", "gallery", "amenities"),
  jpg("amenities-gym", "gallery", "amenities"),
  jpg("amenities-sum", "gallery", "amenities"),
  jpg("amenities-rooftop", "gallery", "amenities"),
  jpg("exteriores-fachada", "gallery", "exteriores"),
  jpg("exteriores-entrada", "gallery", "exteriores"),
  jpg("exteriores-balcon", "gallery", "exteriores"),
  jpg("interiores-living", "gallery", "interiores"),
  jpg("interiores-cocina", "gallery", "interiores"),
  jpg("interiores-dormitorio", "gallery", "interiores"),
  jpg("interiores-bano", "gallery", "interiores"),
  jpg("obra-avance-01", "progress"),
  jpg("obra-avance-02", "progress"),
];

// The three gallery sections, in display order. content-rows.ts builds one gallery per seccion
// whose imagenes[] holds the seeded mediaIds of the gallery assets in that seccion.
export const GALLERY_SECCIONES: readonly GallerySeccion[] = [
  "amenities",
  "exteriores",
  "interiores",
];

// ── Brokers (D-07) ──────────────────────────────────────────────────────────────────────────
// Realistic AR broker identities with a link slug, WhatsApp and email. Some leads arrive through
// a broker (lead.brokerKey), most come in directo/WhatsApp.
export interface BrokerDef {
  /** Deterministic-id seed key (`brigos:broker:<key>`). */
  readonly key: string;
  readonly nombre: string;
  readonly slug: string;
  readonly whatsapp: string;
  readonly email: string;
}

export const BROKERS: readonly BrokerDef[] = [
  {
    key: "martina-gomez",
    nombre: "Martina Gómez",
    slug: "martina-gomez",
    whatsapp: "+5491155551234",
    email: "martina.gomez@recoletapropiedades.com.ar",
  },
  {
    key: "lucas-fernandez",
    nombre: "Lucas Fernández",
    slug: "lucas-fernandez",
    whatsapp: "+5491144448899",
    email: "lucas.fernandez@brokerhaus.com.ar",
  },
  {
    key: "valentina-paz",
    nombre: "Valentina Paz",
    slug: "valentina-paz",
    whatsapp: "+5491133337766",
    email: "valentina.paz@pazpropiedades.com.ar",
  },
];

// ── Leads + append-only timeline (D-07) ─────────────────────────────────────────────────────
// 14 leads spanning all four estados (nuevo/contactado/negociacion/cerrado) with varied origen
// and a realistic LeadNote[] timeline. Notes carry a `dayOffset` (days BEFORE SEED_REFERENCE_DATE)
// that content-rows.ts turns into a fixed ISO `ts` — never a wall-clock read (determinism). Leads
// flagged `attachUnit` get a deterministic seeded unit pinned (interés en una unidad puntual).
export type LeadEstado = "nuevo" | "contactado" | "negociacion" | "cerrado";

export interface LeadNoteDef {
  /** Days before SEED_REFERENCE_DATE for this note's ts (append-only, oldest → newest). */
  readonly dayOffset: number;
  readonly autor?: string;
  readonly nota: string;
  readonly estadoPrev?: LeadEstado;
  readonly estadoNuevo?: LeadEstado;
}

export interface LeadDef {
  /** Deterministic-id seed key (`brigos:lead:<key>`). */
  readonly key: string;
  readonly nombre: string;
  readonly contacto: string;
  readonly origen: string;
  readonly estado: LeadEstado;
  /**
   * Closed-outcome flag (D-03). Set ONLY on `cerrado` leads — the sidecar `leads.desenlace`
   * column, never the `lead_estado` enum. Left undefined for non-cerrado leads (→ null column),
   * so the bandeja renders Ganado/Perdido badges from real seed data.
   */
  readonly desenlace?: "ganado" | "perdido";
  /** When present, the lead came through this broker (BrokerDef.key). */
  readonly brokerKey?: string;
  /** When true, content-rows pins a deterministic seeded unit (interés puntual). */
  readonly attachUnit?: boolean;
  readonly timeline: readonly LeadNoteDef[];
}

const EQUIPO = "Equipo Brigos";

export const LEADS: readonly LeadDef[] = [
  // ── nuevo (recién ingresados, sin contactar) ──
  {
    key: "sofia-ramirez",
    nombre: "Sofía Ramírez",
    contacto: "sofia.ramirez@gmail.com",
    origen: "web",
    estado: "nuevo",
    timeline: [
      { dayOffset: 3, nota: "Consulta desde la web por un 2 ambientes al frente. Dejó mail y teléfono." },
    ],
  },
  {
    key: "diego-alvarez",
    nombre: "Diego Álvarez",
    contacto: "+5491166660011",
    origen: "whatsapp",
    estado: "nuevo",
    timeline: [
      { dayOffset: 2, nota: "Escribió por WhatsApp preguntando si quedan monoambientes disponibles." },
    ],
  },
  {
    key: "carla-benitez",
    nombre: "Carla Benítez",
    contacto: "carla.benitez@outlook.com",
    origen: "instagram",
    estado: "nuevo",
    timeline: [
      { dayOffset: 5, nota: "Llegó desde la campaña de Instagram. Interesada en amenities y pileta." },
    ],
  },
  {
    key: "nicolas-suarez",
    nombre: "Nicolás Suárez",
    contacto: "+5491177770022",
    origen: "portal-inmobiliario",
    estado: "nuevo",
    timeline: [
      { dayOffset: 1, nota: "Contacto entrante desde el portal. Pidió lista de precios de unidades altas." },
    ],
  },
  // ── contactado (primer contacto hecho) ──
  {
    key: "julieta-moreno",
    nombre: "Julieta Moreno",
    contacto: "julieta.moreno@gmail.com",
    origen: "web",
    estado: "contactado",
    attachUnit: true,
    timeline: [
      { dayOffset: 20, nota: "Consulta web por un 3 ambientes contrafrente." },
      {
        dayOffset: 18,
        autor: EQUIPO,
        nota: "La llamé, le pasé el brochure y opciones de financiación en cuotas CAC.",
        estadoPrev: "nuevo",
        estadoNuevo: "contactado",
      },
    ],
  },
  {
    key: "matias-ferreyra",
    nombre: "Matías Ferreyra",
    contacto: "+5491188880033",
    origen: "broker",
    estado: "contactado",
    brokerKey: "martina-gomez",
    timeline: [
      { dayOffset: 22, autor: "Martina Gómez", nota: "Cliente propio, busca 2 ambientes para renta." },
      {
        dayOffset: 19,
        autor: "Martina Gómez",
        nota: "Le compartí el link de la unidad y la simulación de cuotas.",
        estadoPrev: "nuevo",
        estadoNuevo: "contactado",
      },
    ],
  },
  {
    key: "agustina-castro",
    nombre: "Agustina Castro",
    contacto: "agustina.castro@gmail.com",
    origen: "referido",
    estado: "contactado",
    timeline: [
      { dayOffset: 30, nota: "Referida por un cliente que ya reservó. Busca semipiso." },
      {
        dayOffset: 27,
        autor: EQUIPO,
        nota: "Coordinamos una visita a la oficina de ventas para la semana que viene.",
        estadoPrev: "nuevo",
        estadoNuevo: "contactado",
      },
    ],
  },
  {
    key: "federico-rios",
    nombre: "Federico Ríos",
    contacto: "+5491199990044",
    origen: "whatsapp",
    estado: "contactado",
    timeline: [
      { dayOffset: 15, nota: "Consulta por WhatsApp sobre entrega y avance de obra." },
      {
        dayOffset: 13,
        autor: EQUIPO,
        nota: "Le mandé fotos del avance y el cronograma estimado de entrega.",
        estadoPrev: "nuevo",
        estadoNuevo: "contactado",
      },
    ],
  },
  // ── negociacion (en tratativa por una unidad puntual) ──
  {
    key: "lucia-dominguez",
    nombre: "Lucía Domínguez",
    contacto: "lucia.dominguez@gmail.com",
    origen: "broker",
    estado: "negociacion",
    brokerKey: "lucas-fernandez",
    attachUnit: true,
    timeline: [
      { dayOffset: 42, autor: "Lucas Fernández", nota: "Interesada firme en un 3 ambientes al frente." },
      {
        dayOffset: 38,
        autor: "Lucas Fernández",
        nota: "Le pasé la cotización con anticipo del 30% y saldo en 36 cuotas CAC.",
        estadoPrev: "contactado",
        estadoNuevo: "negociacion",
      },
      { dayOffset: 30, autor: EQUIPO, nota: "Pidió mejorar el anticipo; la escalé a la desarrolladora." },
    ],
  },
  {
    key: "gonzalo-medina",
    nombre: "Gonzalo Medina",
    contacto: "+5491155550055",
    origen: "web",
    estado: "negociacion",
    attachUnit: true,
    timeline: [
      { dayOffset: 40, nota: "Consulta web por el penthouse." },
      {
        dayOffset: 35,
        autor: EQUIPO,
        nota: "Visita presencial hecha. Le gustó la terraza; pidió cotización formal.",
        estadoPrev: "contactado",
        estadoNuevo: "negociacion",
      },
      { dayOffset: 28, autor: EQUIPO, nota: "Enviamos la cotización del penthouse con plan financiado a 48 cuotas." },
    ],
  },
  {
    key: "florencia-ibarra",
    nombre: "Florencia Ibarra",
    contacto: "florencia.ibarra@outlook.com",
    origen: "instagram",
    estado: "negociacion",
    attachUnit: true,
    timeline: [
      { dayOffset: 48, nota: "Llegó por Instagram, busca 2 ambientes de inversión." },
      {
        dayOffset: 44,
        autor: EQUIPO,
        nota: "Le armé la simulación de renta y la cotización en cuotas.",
        estadoPrev: "contactado",
        estadoNuevo: "negociacion",
      },
      { dayOffset: 33, autor: EQUIPO, nota: "Está comparando con otra torre de la zona; seguimos en contacto." },
    ],
  },
  // ── cerrado (reserva/boleto concretado) ──
  {
    key: "tomas-acosta",
    nombre: "Tomás Acosta",
    contacto: "+5491166660066",
    origen: "broker",
    estado: "cerrado",
    desenlace: "ganado",
    brokerKey: "valentina-paz",
    attachUnit: true,
    timeline: [
      { dayOffset: 55, autor: "Valentina Paz", nota: "Cliente decidido por un monoambiente de pozo." },
      {
        dayOffset: 50,
        autor: "Valentina Paz",
        nota: "Aceptó la cotización; coordinamos la seña.",
        estadoPrev: "negociacion",
        estadoNuevo: "cerrado",
      },
      { dayOffset: 46, autor: EQUIPO, nota: "Reserva cobrada. Boleto firmado con anticipo del 30%." },
      { dayOffset: 44, autor: EQUIPO, nota: "Unidad marcada como vendida en el sistema." },
    ],
  },
  {
    key: "camila-vega",
    nombre: "Camila Vega",
    contacto: "camila.vega@gmail.com",
    origen: "referido",
    estado: "cerrado",
    desenlace: "perdido",
    attachUnit: true,
    timeline: [
      { dayOffset: 58, nota: "Referida por Tomás Acosta. Busca 2 ambientes para vivienda." },
      {
        dayOffset: 52,
        autor: EQUIPO,
        nota: "Visita + cotización. Quedó muy interesada en el contrafrente.",
        estadoPrev: "contactado",
        estadoNuevo: "negociacion",
      },
      {
        dayOffset: 47,
        autor: EQUIPO,
        nota: "Nos avisó que finalmente compró en otra torre de la zona; cerramos el lead como perdido.",
        estadoPrev: "negociacion",
        estadoNuevo: "cerrado",
      },
      { dayOffset: 45, autor: EQUIPO, nota: "Queda en la base para futuros lanzamientos." },
    ],
  },
];

// ── Progress posts / avance de obra (D-01) ──────────────────────────────────────────────────
// A short obra timeline; each post carries a fecha (from SEED_REFERENCE_DATE minus dayOffset) and
// references a seeded media by logical name (mediaKey → mediaId, plain uuid ref, no FK).
export interface ProgressPostDef {
  /** Deterministic-id seed key (`brigos:progress:<key>`). */
  readonly key: string;
  /** Days before SEED_REFERENCE_DATE for the post's fecha. */
  readonly dayOffset: number;
  readonly titulo: string;
  readonly cuerpo: string;
  /** Logical media name (MediaAssetDef.key) whose mediaId this post shows. */
  readonly mediaKey: string;
}

export const PROGRESS_POSTS: readonly ProgressPostDef[] = [
  {
    key: "fundaciones",
    dayOffset: 120,
    titulo: "Fundaciones terminadas",
    cuerpo:
      "Completamos las fundaciones y el submuro. Arrancamos con la estructura de hormigón de la " +
      "planta baja. La obra avanza según el cronograma previsto.",
    mediaKey: "obra-avance-01",
  },
  {
    key: "estructura-piso-6",
    dayOffset: 70,
    titulo: "Estructura hasta el piso 6",
    cuerpo:
      "Ya levantamos la estructura hasta el sexto piso. Esta semana empezamos el encofrado de las " +
      "losas de los pisos altos. Los tiempos se mantienen firmes.",
    mediaKey: "obra-avance-02",
  },
  {
    key: "avance-fachada",
    dayOffset: 25,
    titulo: "Comienza la fachada",
    cuerpo:
      "Iniciamos el cerramiento y los trabajos de fachada. Se empiezan a ver las terminaciones " +
      "exteriores del edificio. Falta menos para la entrega.",
    mediaKey: "exteriores-fachada",
  },
];

// ── Events / analytics (D-07) ───────────────────────────────────────────────────────────────
// Event tipos the seed distributes across ≥2 monthly partitions. content-rows.ts assigns each
// event a FIXED ts (SEED_REFERENCE_DATE minus a per-event dayOffset) so events route to the
// pre-created events_YYYY_MM partitions — never a wall-clock read.
export const EVENT_TIPOS = [
  "view_project",
  "view_unit",
  "open_quote",
  "open_whatsapp",
] as const;
export type EventTipo = (typeof EVENT_TIPOS)[number];

// Fixed day-offsets (before SEED_REFERENCE_DATE = 2026-06-01) spanning June/May/April 2026 so the
// generated events populate ≥2 distinct monthly partitions (D-07). Kept ≤ 61 so none falls before
// the oldest pre-created partition (events_2026_04) into DEFAULT.
export const EVENT_DAY_OFFSETS: readonly number[] = [
  0, 1, 2, 4, 6, 9, // June 2026 (offset 0 = 2026-06-01)
  12, 15, 18, 22, 26, 29, // May 2026
  36, 40, 45, 50, 55, 60, // April 2026
];
