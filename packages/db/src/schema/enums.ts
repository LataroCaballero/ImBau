// Domain pgEnums (D-15). Values stay Spanish — they are DATA values, not identifiers;
// surrounding identifiers stay English (CONTEXT Specific Ideas). Declaration style is a
// faithful clone of `estadoEnum` in projects.ts. The existing `estado` enum is NOT
// redeclared here — it lives in projects.ts and is reused by every consumer.
import { pgEnum } from "drizzle-orm/pg-core";

// unidad_estado — units lifecycle (modelo §3.3, SCHEMA-01).
export const unidadEstadoEnum = pgEnum("unidad_estado", [
  "disponible",
  "reservado",
  "vendido",
]);

// lead_estado — leads pipeline (modelo §3.3, SCHEMA-04). ASCII `negociacion` (no accent)
// per the resolved decision (D-15 / A4): the enum DATA value is ASCII to match the existing
// enum style and avoid encoding pitfalls; the UI renders the accented label.
export const leadEstadoEnum = pgEnum("lead_estado", [
  "nuevo",
  "contactado",
  "negociacion",
  "cerrado",
]);

// galeria_seccion — gallery sections (modelo §3.3, SCHEMA-05).
export const galeriaSeccionEnum = pgEnum("galeria_seccion", [
  "amenities",
  "exteriores",
  "interiores",
]);

// ajuste_tipo — payment-plan adjustment basis (modelo §3.3, SCHEMA-02).
export const ajusteTipoEnum = pgEnum("ajuste_tipo", ["CAC", "fijo"]);

// moneda — currency for price lists (modelo §3.3, SCHEMA-02).
export const monedaEnum = pgEnum("moneda", ["USD", "ARS"]);
