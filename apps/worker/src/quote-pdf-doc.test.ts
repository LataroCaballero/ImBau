import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { QuoteDoc, type QuoteHeader } from "./quote-pdf-doc";
import type { PdfModel } from "@imbau/quoting";

// De-risking the phase's #1 failure mode: react-pdf's embedded-font resolution in the Chromium-free
// Alpine worker (PDF-02). We do a REAL renderToBuffer (no mock) and assert the bytes are a valid PDF.
// If Font.register's absolute path did not resolve, react-pdf either throws or ships a glyph-less
// fallback — either way a broken es-AR document. A green render here proves the font loads and the
// document lays out the PdfModel lines + both leyendas (PDF-03) + the footer QR (D-08).

// A tiny valid 1×1 transparent PNG data-URL — stands in for the QR that plan 02 will generate.
const QR_PNG_FIXTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// The two REAL leyendas emitted by @imbau/quoting's toPdfModel (serialize.ts) — the doc must carry both.
const LEYENDAS = [
  "Cotización no vinculante.",
  "Las cuotas se ajustan por el índice CAC vigente al mes de pago.",
];

function financiadoModel(): PdfModel {
  return {
    modalidad: "financiado",
    lineas: [
      { label: "Precio financiado", valor: "US$ 120.000" },
      { label: "Anticipo", valor: "US$ 36.000" },
      { label: "Cuotas", valor: "24" },
      { label: "Primera cuota", valor: "$ 1.250.000,00" },
    ],
    leyendas: LEYENDAS,
  };
}

function header(overrides: Partial<QuoteHeader> = {}): QuoteHeader {
  return {
    proyecto: "Brigos Recoleta",
    unidad: "3B",
    piso: "3",
    tipologia: "2 ambientes",
    m2: "58",
    fecha: "05/07/2026",
    cacPeriodo: "2026-06",
    ref: "Q-000123",
    deepLink: "https://web.test/p/brigos-recoleta/cotizador?u=3B&plan=cac",
    ...overrides,
  };
}

describe("QuoteDoc", () => {
  it("renders a financiado model to a valid %PDF buffer with both leyendas + QR footer", async () => {
    const buffer = await renderToBuffer(
      QuoteDoc({ model: financiadoModel(), header: header(), qrPng: QR_PNG_FIXTURE }),
    );
    expect(buffer.length).toBeGreaterThan(0);
    // Bytes must begin with the PDF magic — proves fontkit embedded + serialized successfully.
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders es-AR accents (embedded font, PDF-02) without throwing", async () => {
    const model: PdfModel = {
      modalidad: "financiado",
      lineas: [{ label: "Precio", valor: "US$ 99.999" }],
      leyendas: LEYENDAS,
    };
    const buffer = await renderToBuffer(
      QuoteDoc({
        model,
        header: header({ proyecto: "Ñandú á é í ó ú ¿Cuánto?", tipologia: "Monoambiente ¡único!" }),
        qrPng: QR_PNG_FIXTURE,
      }),
    );
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
