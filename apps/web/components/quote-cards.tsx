// The presentational result surface of the cotizador (UI-02/UI-03/UI-05/UI-06, mockup §s-cotizador).
//
// This component RENDERS ONLY — it never computes or formats money itself. Every amount goes through
// `formatUsd`/`formatArs` and the savings figures through `compareQuotes`, all from @imbau/quoting
// (T-06-04-DRIFT): the number on screen is byte-for-byte the server-computed value, and the
// deterministic es-AR formatter owns the `US$`/`$` labels (UI-06) — the browser's own locale/number
// APIs are deliberately NOT used here (they drift the label + invisible spaces across runtimes).
//
// Values are React children (auto-escaped); no dangerouslySetInnerHTML (T-06-04-XSS).
import {
  formatUsd,
  formatArs,
  compareQuotes,
} from "@imbau/quoting";
import type { ContadoResult, FinanciadoResult } from "@imbau/quoting";

export type QuoteCardsProps = {
  /** The contado quote (single resolved USD price). */
  contado: ContadoResult;
  /** The financiado quote (anticipo + cuotas + refuerzos + totals). */
  financiado: FinanciadoResult;
  /** The selected plan's anticipo percentage (string, e.g. "30"). */
  anticipoPct: string;
  /** The selected plan's legal notes, or null when the plan carries none. */
  notasLegales: string | null;
};

/** A right-aligned mono figure — the JetBrains Mono face carries every money value (UI-06). */
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-hormigon">{children}</span>;
}

/** One label/value row inside a card. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-hormigon/70">{label}</span>
      <Figure>{children}</Figure>
    </div>
  );
}

/**
 * Render the contado + financiado comparison side by side (stacked on mobile, two columns on
 * desktop), the compareQuotes savings band, and the leyendas. The financiado card is the highlighted
 * one (cobre accent) mirroring the mockup's `hl` total.
 */
export function QuoteCards({
  contado,
  financiado,
  anticipoPct,
  notasLegales,
}: QuoteCardsProps) {
  const primera = financiado.cuotas[0];
  const { ahorroUsd, ahorroPct } = compareQuotes(contado, financiado);

  return (
    <section className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Contado */}
        <article className="rounded-xl border border-hormigon/10 bg-carbon p-5">
          <h3 className="font-display text-lg text-hormigon">Contado</h3>
          <Row label="Precio">{formatUsd(contado.precioUsd)}</Row>
        </article>

        {/* Financiado — highlighted (cobre accent) */}
        <article className="rounded-xl border border-cobre/40 bg-carbon p-5 ring-1 ring-cobre/30">
          <h3 className="font-display text-lg text-cobre">Financiado</h3>
          <Row label="Precio">{formatUsd(financiado.precioUsd)}</Row>
          <Row label={`Anticipo (${anticipoPct}%)`}>
            {formatUsd(financiado.anticipoUsd)}
          </Row>
          <Row label="Cuotas">{financiado.cuotas.length}</Row>
          {primera ? (
            <Row label="Primera cuota (al valor del mes)">
              {primera.ars !== null ? formatArs(primera.ars) : formatUsd(primera.usd)}
            </Row>
          ) : null}
          {financiado.refuerzos.length > 0 ? (
            <div className="mt-2 border-t border-hormigon/10 pt-2">
              <p className="text-sm text-hormigon/70">Refuerzos</p>
              {financiado.refuerzos.map((r) => (
                <Row key={r.indice} label={`Cuota ${r.indice}`}>
                  {formatUsd(r.montoUsd)}
                </Row>
              ))}
            </div>
          ) : null}
          <div className="mt-2 border-t border-cobre/30 pt-2">
            <Row label="Total">{formatUsd(financiado.totals.totalUsd)}</Row>
          </div>
        </article>
      </div>

      {/* Savings band (UI-03) */}
      <div className="rounded-lg bg-disponible/10 px-4 py-3 text-sm text-hormigon">
        Pagando al contado ahorrás <Figure>{formatUsd(ahorroUsd)}</Figure>{" "}
        (<span className="font-mono tabular-nums">{ahorroPct}%</span>).
      </div>

      {/* Leyendas (UI-05) */}
      <div className="space-y-1 text-xs text-hormigon/60">
        {notasLegales ? <p>{notasLegales}</p> : null}
        <p>Cotización no vinculante.</p>
      </div>
    </section>
  );
}
