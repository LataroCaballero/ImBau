import { describe, expect, it } from "vitest";

import { calcQuote } from "./engine";
import { formatArs, formatUsd } from "./format";
import { toPdfModel, toWhatsAppText } from "./serialize";
import type { QuoteInput } from "./types";

// Pattern 3 (RESEARCH): ONE QuoteResult, many serializers — no drift. Each result is built by
// calling calcQuote ONCE here in the test; the serializers consume that result and must never
// re-run the engine. Assertions check that the on-screen figures (via formatUsd/formatArs) appear
// identically across WhatsApp text and PDF model — the three surfaces cannot differ (ENGINE-03).

const contadoResult = calcQuote({
  modalidad: "contado",
  precioContadoUsd: 100000,
  precioFinanciadoUsd: 120000,
});

const cacInput: QuoteInput = {
  modalidad: "financiado",
  precioContadoUsd: 100000,
  precioFinanciadoUsd: 120000,
  plan: { anticipoPct: "30", cuotas: 12, ajuste: "CAC", refuerzos: [] },
  cac: { periodo: "2026-07", valor: "1000" },
};
const financiadoCac = calcQuote(cacInput);

const fijoInput: QuoteInput = {
  modalidad: "financiado",
  precioContadoUsd: 100000,
  precioFinanciadoUsd: 120000,
  plan: { anticipoPct: "30", cuotas: 12, ajuste: "fijo", refuerzos: [] },
};
const financiadoFijo = calcQuote(fijoInput);

// Derived figures the surfaces should show — precio 120000, anticipo 36000, saldo 84000,
// 12 cuotas of 7000 USD; first CAC cuota ARS = 7000 × 1000 = "7000000.00".
const PRECIO = formatUsd(120000); // "US$ 120.000"
const ANTICIPO = formatUsd(36000); // "US$ 36.000"
const PRIMERA_CAC = formatArs("7000000.00"); // "$ 7.000.000,00"
const PRIMERA_FIJO = formatUsd(7000); // "US$ 7.000"

describe("toWhatsAppText — short es-AR resumen (WA-01)", () => {
  it("summarizes a contado quote with the formatted precio and no cuotas", () => {
    const text = toWhatsAppText(contadoResult);
    expect(text).toContain(formatUsd(100000)); // "US$ 100.000"
    expect(text.toLowerCase()).not.toContain("cuota");
    expect(text.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("summarizes a financiado CAC quote: precio, anticipo, N cuotas, primera cuota ARS", () => {
    const text = toWhatsAppText(financiadoCac);
    expect(text).toContain(PRECIO);
    expect(text).toContain(ANTICIPO);
    expect(text).toContain("12 cuotas");
    expect(text).toContain(PRIMERA_CAC);
    // A resumen, not the full amortization table.
    expect(text.split("\n").length).toBeLessThanOrEqual(4);
  });

  it("shows the primera cuota in USD when the plan is fijo (ars null)", () => {
    const text = toWhatsAppText(financiadoFijo);
    expect(text).toContain(PRIMERA_FIJO);
    expect(text).not.toContain("$ 7.000.000,00");
  });
});

describe("toPdfModel — pure data model for fase 7 (D-12)", () => {
  it("returns the contado data model with both leyendas", () => {
    const model = toPdfModel(contadoResult);
    expect(model).toEqual({
      modalidad: "contado",
      lineas: [{ label: "Precio contado", valor: formatUsd(100000) }],
      leyendas: [
        "Cotización no vinculante.",
        "Las cuotas se ajustan por el índice CAC vigente al mes de pago.",
      ],
    });
  });

  it("returns the financiado CAC data model with formatted values and both leyendas", () => {
    const model = toPdfModel(financiadoCac);
    expect(model).toEqual({
      modalidad: "financiado",
      lineas: [
        { label: "Precio financiado", valor: PRECIO },
        { label: "Anticipo", valor: ANTICIPO },
        { label: "Cuotas", valor: "12" },
        { label: "Primera cuota", valor: PRIMERA_CAC },
      ],
      leyendas: [
        "Cotización no vinculante.",
        "Las cuotas se ajustan por el índice CAC vigente al mes de pago.",
      ],
    });
  });

  it("renders the fijo primera cuota in USD", () => {
    const model = toPdfModel(financiadoFijo);
    expect(model.lineas).toContainEqual({ label: "Primera cuota", valor: PRIMERA_FIJO });
  });
});

describe("no drift — both serializers derive from the same QuoteResult", () => {
  it("shows the identical formatted precio in WhatsApp text and PDF model", () => {
    const text = toWhatsAppText(financiadoCac);
    const model = toPdfModel(financiadoCac);
    const pdfPrecio = model.lineas.find((l) => l.label === "Precio financiado")?.valor;
    expect(pdfPrecio).toBe(PRECIO);
    expect(text).toContain(pdfPrecio!);
  });
});
