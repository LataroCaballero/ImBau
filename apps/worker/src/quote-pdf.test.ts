import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Job } from "bullmq";
import { quotePdfKey, type QuotePdfJobData } from "@imbau/storage";

// Orchestration tests for the quote-PDF processor (PDF-01/PDF-02). Mirrors media.test.ts: every
// I/O seam is vi.mocked so this proves short-circuit (D-11) + deterministic-key + deep-link (D-08)
// WITHOUT touching R2, Postgres, Redis, or the real react-pdf renderer.
//
// Mocked seams: quote-pdf-store (withTenant read/write), quote-pdf-runtime (R2 put + base URL),
// quote-pdf-doc (QuoteDoc → stub), @react-pdf/renderer (renderToBuffer → a fake %PDF buffer),
// and qrcode (toDataURL → a fake data-URL). toPdfModel from @imbau/quoting runs FOR REAL over a
// real contado QuoteResult — it is pure (no infra), and running it proves the snapshot path.
vi.mock("./quote-pdf-store", () => ({
  readQuoteForPdf: vi.fn(),
  writePdfKey: vi.fn(),
}));
vi.mock("./quote-pdf-runtime", () => ({
  putPdf: vi.fn(),
  WEB_PUBLIC_BASE_URL: "https://web.test",
  R2_BUCKET: "test-bucket",
}));
vi.mock("./quote-pdf-doc", () => ({
  QuoteDoc: vi.fn(() => ({ type: "Document" })),
}));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7")),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,MOCKQR") },
}));

import { processQuotePdf } from "./quote-pdf";
import { readQuoteForPdf, writePdfKey } from "./quote-pdf-store";
import { putPdf } from "./quote-pdf-runtime";
import QRCode from "qrcode";
import type { QuoteForPdf } from "./quote-pdf-store";

// A complete QuoteForPdf row with a real contado snapshot.result (toPdfModel runs for real).
function makeRow(overrides: Partial<QuoteForPdf> = {}): QuoteForPdf {
  return {
    snapshot: {
      result: { modalidad: "contado", precioUsd: 150_000, version: 1 },
      cacPeriodo: null,
    },
    pdfKey: null,
    proyecto: "Brigos Recoleta",
    projectSlug: "brigos-recoleta",
    unidadIdentificador: "4B",
    tipologia: "2 ambientes",
    m2: "48.5",
    piso: 4,
    unitId: "unit-1",
    paymentPlanId: "plan-1",
    ...overrides,
  };
}

function makeJob(data: QuotePdfJobData): Job<QuotePdfJobData> {
  // Only `data` is read by processQuotePdf; cast the minimal shape to the BullMQ Job type.
  return { data } as Job<QuotePdfJobData>;
}

describe("processQuotePdf (orchestration, store/runtime/doc/renderer/qr mocked)", () => {
  beforeEach(() => {
    vi.mocked(readQuoteForPdf).mockReset();
    vi.mocked(writePdfKey).mockReset();
    vi.mocked(putPdf).mockReset();
    vi.mocked(QRCode.toDataURL).mockClear();
  });

  it("short-circuits (D-11): a quote that already has pdfKey is never re-rendered or re-uploaded", async () => {
    vi.mocked(readQuoteForPdf).mockResolvedValue(
      makeRow({ pdfKey: "quotes/org-1/proj-1/quote-1.pdf" }),
    );

    await processQuotePdf(
      makeJob({ quoteId: "quote-1", organizationId: "org-1", projectId: "proj-1" }),
    );

    expect(readQuoteForPdf).toHaveBeenCalledTimes(1);
    expect(putPdf).not.toHaveBeenCalled();
    expect(writePdfKey).not.toHaveBeenCalled();
  });

  it("happy path: puts to the deterministic key ONCE then writes that same key back ONCE (put before write)", async () => {
    vi.mocked(readQuoteForPdf).mockResolvedValue(makeRow({ pdfKey: null }));

    const order: string[] = [];
    vi.mocked(putPdf).mockImplementation((key: string) => {
      order.push(`put:${key}`);
      return Promise.resolve();
    });
    vi.mocked(writePdfKey).mockImplementation((_org: string, _q: string, key: string) => {
      order.push(`write:${key}`);
      return Promise.resolve();
    });

    await processQuotePdf(
      makeJob({ quoteId: "quote-9", organizationId: "org-7", projectId: "proj-3" }),
    );

    const expectedKey = quotePdfKey("org-7", "proj-3", "quote-9");

    expect(putPdf).toHaveBeenCalledTimes(1);
    expect(putPdf).toHaveBeenCalledWith(expectedKey, expect.any(Buffer));

    expect(writePdfKey).toHaveBeenCalledTimes(1);
    expect(writePdfKey).toHaveBeenCalledWith("org-7", "quote-9", expectedKey);

    // put strictly before write (never a pdfKey pointing at an object that was never uploaded).
    expect(order).toEqual([`put:${expectedKey}`, `write:${expectedKey}`]);
  });

  it("builds the cotizador deep-link (D-08) and feeds it to QRCode.toDataURL", async () => {
    vi.mocked(readQuoteForPdf).mockResolvedValue(
      makeRow({
        pdfKey: null,
        projectSlug: "brigos-recoleta",
        unitId: "unit-42",
        paymentPlanId: "plan-7",
      }),
    );
    vi.mocked(putPdf).mockResolvedValue();
    vi.mocked(writePdfKey).mockResolvedValue();

    await processQuotePdf(
      makeJob({ quoteId: "quote-2", organizationId: "org-1", projectId: "proj-1" }),
    );

    expect(QRCode.toDataURL).toHaveBeenCalledTimes(1);
    const deepLink = vi.mocked(QRCode.toDataURL).mock.calls[0]?.[0];
    expect(deepLink).toBe(
      "https://web.test/p/brigos-recoleta/cotizador?u=unit-42&plan=plan-7",
    );
  });
});
