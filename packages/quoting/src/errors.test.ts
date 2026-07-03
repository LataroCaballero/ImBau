import { describe, expect, it } from "vitest";

import { QuoteError, type QuoteErrorCode } from "./errors";

// Every QuoteErrorCode must be constructible and correctly branded — this guarantees each code
// and the single constructor branch are covered before the engine (plan 03) throws them (D-07).
const ALL_CODES: QuoteErrorCode[] = [
  "PLAN_REQUERIDO",
  "CAC_REQUERIDO",
  "ANTICIPO_PCT_FUERA_DE_RANGO",
  "CUOTAS_INVALIDAS",
  "REFUERZO_FUERA_DE_PLAZO",
  "REFUERZO_DUPLICADO",
  "SALDO_NO_POSITIVO",
];

describe("QuoteError (D-07 — typed domain rejection)", () => {
  it.each(ALL_CODES)("constructs a QuoteError for code %s", (code) => {
    const err = new QuoteError(code);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QuoteError);
    expect(err.code).toBe(code);
    expect(err.name).toBe("QuoteError");
  });

  it("preserves an optional developer message", () => {
    const err = new QuoteError("SALDO_NO_POSITIVO", "saldo <= 0 after anticipo + refuerzos");
    expect(err.message).toBe("saldo <= 0 after anticipo + refuerzos");
    expect(err.code).toBe("SALDO_NO_POSITIVO");
  });

  it("defaults to an empty message when none is given", () => {
    const err = new QuoteError("PLAN_REQUERIDO");
    expect(err.message).toBe("");
  });
});
