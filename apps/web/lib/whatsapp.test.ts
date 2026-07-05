import { describe, it, expect } from "vitest";
import { toWhatsAppText } from "@imbau/quoting";
import type { ContadoResult, FinanciadoResult } from "@imbau/quoting";
import { buildWhatsappUrl } from "./whatsapp";

// A financiado result fixture (CAC plan: cuotas carry an ARS value).
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
  totals: { cuotasUsd: 84000, refuerzosUsd: 0, totalUsd: 120000 },
  version: 1,
};

const contado: ContadoResult = {
  modalidad: "contado",
  precioUsd: 100000,
  version: 1,
};

const deepLinkUrl = "https://tours.andescode.com.ar/p/brigos/cotizador?u=U1&plan=P1";
const baseArgs = {
  unitIdentificador: "4B",
  projectNombre: "Brigos Recoleta",
  deepLinkUrl,
};

describe("buildWhatsappUrl", () => {
  it("builds a wa.me URL with digits-only number and the engine's toWhatsAppText body (financiado)", () => {
    const url = buildWhatsappUrl({
      whatsapp: "+54 9 11 2233-4455",
      result: financiado,
      ...baseArgs,
    });
    const header = "Hola! Me interesa la unidad 4B de Brigos Recoleta.";
    const expectedText = encodeURIComponent(
      `${header}\n${toWhatsAppText(financiado)}\n${deepLinkUrl}`,
    );
    // Exact-string equality locks the full URL shape.
    expect(url).toBe(`https://wa.me/5491122334455?text=${expectedText}`);
  });

  it("always begins with the fixed https://wa.me/ host (no open redirect)", () => {
    const url = buildWhatsappUrl({
      whatsapp: "http://evil.com/54911",
      result: financiado,
      ...baseArgs,
    });
    // Only digits are interpolated → the host cannot be hijacked by the number field.
    expect(url).not.toBeNull();
    expect(url!.startsWith("https://wa.me/")).toBe(true);
    expect(url!.startsWith("https://wa.me/54911?text=")).toBe(true);
  });

  it("uses toWhatsAppText(result) verbatim as the message body (never re-implemented)", () => {
    const url = buildWhatsappUrl({
      whatsapp: "5491122334455",
      result: contado,
      ...baseArgs,
    });
    const decoded = decodeURIComponent(url!.split("?text=")[1]!);
    expect(decoded).toContain(toWhatsAppText(contado));
    expect(decoded).toContain("Hola! Me interesa la unidad 4B de Brigos Recoleta.");
    expect(decoded).toContain(deepLinkUrl);
  });

  it("returns null when whatsapp is null (D-02 — no dead button)", () => {
    expect(
      buildWhatsappUrl({ whatsapp: null, result: financiado, ...baseArgs }),
    ).toBeNull();
  });

  it("returns null when whatsapp is an empty string", () => {
    expect(
      buildWhatsappUrl({ whatsapp: "", result: financiado, ...baseArgs }),
    ).toBeNull();
  });

  it("returns null when the number strips to zero digits", () => {
    expect(
      buildWhatsappUrl({ whatsapp: "+++ ()", result: financiado, ...baseArgs }),
    ).toBeNull();
  });
});
