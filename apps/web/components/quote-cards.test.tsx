import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import {
  formatUsd,
  formatArs,
  compareQuotes,
} from "@imbau/quoting";
import type { ContadoResult, FinanciadoResult } from "@imbau/quoting";
import { QuoteCards } from "./quote-cards";

const contado: ContadoResult = {
  modalidad: "contado",
  precioUsd: 100000,
  version: 1,
};

// CAC plan: cuotas carry an ARS value ("al valor del mes").
const financiado: FinanciadoResult = {
  modalidad: "financiado",
  precioUsd: 120000,
  anticipoUsd: 36000,
  saldoUsd: 84000,
  cuotas: [
    { indice: 1, usd: 700, ars: "875000.00" },
    { indice: 2, usd: 700, ars: "880000.00" },
  ],
  refuerzos: [{ indice: 12, montoUsd: 10000 }],
  cac: { periodo: "2026-06", valor: "1250.0000" },
  totals: { cuotasUsd: 84000, refuerzosUsd: 10000, totalUsd: 120000 },
  version: 1,
};

// Fijo plan: cuotas carry no ARS value → primera cuota shows USD.
const financiadoFijo: FinanciadoResult = {
  ...financiado,
  cuotas: [
    { indice: 1, usd: 900, ars: null },
    { indice: 2, usd: 900, ars: null },
  ],
  cac: null,
};

describe("QuoteCards", () => {
  it("renders the financiado breakdown with formatUsd/formatArs strings", () => {
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiado}
        anticipoPct="30"
        notasLegales="Plan sujeto a aprobación."
      />,
    );
    const text = container.textContent ?? "";
    // precio + anticipo (USD) + anticipoPct
    expect(text).toContain(formatUsd(120000)); // precio financiado
    expect(text).toContain(formatUsd(36000)); // anticipo
    expect(text).toContain("30%");
    // cuotas count + primera cuota ARS
    expect(text).toContain("2");
    expect(text).toContain(formatArs("875000.00"));
    // refuerzos + totals
    expect(text).toContain(formatUsd(10000));
  });

  it("renders the contado precio", () => {
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiado}
        anticipoPct="30"
        notasLegales={null}
      />,
    );
    expect(container.textContent ?? "").toContain(formatUsd(100000));
  });

  it("renders the compareQuotes savings band (ahorroUsd + ahorroPct)", () => {
    const { ahorroUsd, ahorroPct } = compareQuotes(contado, financiado);
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiado}
        anticipoPct="30"
        notasLegales={null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(formatUsd(ahorroUsd));
    expect(text).toContain(`${ahorroPct}%`);
  });

  it("renders the notasLegales and a 'no vinculante' leyenda (UI-05)", () => {
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiado}
        anticipoPct="30"
        notasLegales="Plan sujeto a aprobación."
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Plan sujeto a aprobación.");
    expect(text.toLowerCase()).toContain("no vinculante");
  });

  it("applies the mono figures utility (font-mono) to amounts", () => {
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiado}
        anticipoPct="30"
        notasLegales={null}
      />,
    );
    expect(container.querySelector(".font-mono")).not.toBeNull();
  });

  it("shows the primera cuota as USD for a fijo plan (cuotas[0].ars === null)", () => {
    const { container } = render(
      <QuoteCards
        contado={contado}
        financiado={financiadoFijo}
        anticipoPct="30"
        notasLegales={null}
      />,
    );
    expect(container.textContent ?? "").toContain(formatUsd(900));
  });
});
