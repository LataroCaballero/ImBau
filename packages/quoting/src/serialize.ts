// The two PURE serializers that turn ONE QuoteResult into surface-ready output (ENGINE-03, D-12,
// RESEARCH Pattern 3). Both take an ALREADY-COMPUTED `QuoteResult` and NEVER re-run the engine:
// recomputing per surface is exactly how the number on screen, in the PDF and in the WhatsApp
// message would drift apart (threat T-04-06). One result → three identical surfaces.
//
// Every amount is rendered through `formatUsd` / `formatArs` — the ONE es-AR formatter — so the
// `US$` / `$` labels and digit grouping match the on-screen values byte-for-byte (threat T-04-04).
// No currency string is ever built inline here.
//
// Copy is a reasonable draft (D-12/D-13): the wording is validated against the live surfaces in
// fases 6/7 and does NOT bump `ENGINE_VERSION` (copy is not calc semantics).

import { formatArs, formatUsd } from "./format";
import type { CuotaLine, PdfModel, QuoteResult } from "./types";

// The legal + adjustment leyendas the PDF (fase 7) always carries. "Cotización no vinculante" is a
// hard product requirement (modelo-mvp.md); the CAC note explains the cuota-adjustment basis.
const LEYENDA_NO_VINCULANTE = "Cotización no vinculante.";
const LEYENDA_CAC = "Las cuotas se ajustan por el índice CAC vigente al mes de pago.";

/**
 * The primera-cuota amount as an es-AR string: ARS "al valor del mes" for a CAC plan (`ars` set),
 * or the whole-USD cuota for a fijo plan (`ars === null`). Rendered via the shared formatter.
 * `cuotas` is non-empty for every financiado result (the engine rejects `cuotas < 1`).
 */
function primeraCuotaText(cuotas: CuotaLine[]): string {
  const primera = cuotas[0]!;
  return primera.ars !== null ? formatArs(primera.ars) : formatUsd(primera.usd);
}

/**
 * A short es-AR resumen for the WhatsApp CTA (WA-01): the precio, and for financiado the anticipo,
 * cuota count and primera cuota — NOT the full amortization table. The surface (fase 6) appends the
 * wa.me link. Amounts go through `formatUsd` / `formatArs`; never re-runs the engine.
 */
export function toWhatsAppText(result: QuoteResult): string {
  if (result.modalidad === "contado") {
    return `Te paso tu cotización al contado: ${formatUsd(result.precioUsd)}.`;
  }
  return [
    `Te paso tu cotización financiada: ${formatUsd(result.precioUsd)}.`,
    `Anticipo: ${formatUsd(result.anticipoUsd)}.`,
    `${result.cuotas.length} cuotas — primera cuota: ${primeraCuotaText(result.cuotas)}.`,
  ].join("\n");
}

/**
 * A pure `PdfModel` data object (label/value string pairs already formatted es-AR + the two
 * leyendas) for the fase-7 worker to render into a PDF. No JSX, no rendering, no I/O — derived
 * from the SAME result the WhatsApp text uses, so the PDF cannot drift from the message.
 */
export function toPdfModel(result: QuoteResult): PdfModel {
  const leyendas = [LEYENDA_NO_VINCULANTE, LEYENDA_CAC];
  if (result.modalidad === "contado") {
    return {
      modalidad: "contado",
      lineas: [{ label: "Precio contado", valor: formatUsd(result.precioUsd) }],
      leyendas,
    };
  }
  return {
    modalidad: "financiado",
    lineas: [
      { label: "Precio financiado", valor: formatUsd(result.precioUsd) },
      { label: "Anticipo", valor: formatUsd(result.anticipoUsd) },
      { label: "Cuotas", valor: `${result.cuotas.length}` },
      { label: "Primera cuota", valor: primeraCuotaText(result.cuotas) },
    ],
    leyendas,
  };
}
