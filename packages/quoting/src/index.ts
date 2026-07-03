// Public barrel for the quoting engine — the finalized contract fases 5/6/7 import against.
// Pure package: no I/O, ever (CLAUDE.md). One output shape (`QuoteResult`) feeds every surface;
// the serializers + `compareQuotes` + the shared formatter derive from it so UI == PDF == WhatsApp
// can never differ (ENGINE-03). Money primitives (`roundHalfUpUsd`/`allocateCuotas`/`decimal2`)
// stay INTERNAL — they are implementation detail, deliberately not re-exported.
//
// Under verbatimModuleSyntax runtime symbols use `export { ... }` and type-only symbols use
// `export type { ... }` (mirrors the @imbau/db barrel convention). The barrel is re-export only
// and is excluded from the coverage gate.

// --- Runtime surface ---
export { calcQuote } from "./engine";
export { compareQuotes } from "./compare";
export { toWhatsAppText, toPdfModel } from "./serialize";
export { ENGINE_VERSION } from "./version";
export { QuoteError } from "./errors";
export { formatUsd, formatArs } from "./format";

// --- Type-only surface (verbatimModuleSyntax requires `export type`) ---
export type {
  QuoteInput,
  PlanInput,
  RefuerzoInput,
  CacInput,
  QuoteResult,
  ContadoResult,
  FinanciadoResult,
  CuotaLine,
  RefuerzoLine,
  QuoteTotals,
  QuoteComparison,
  PdfModel,
} from "./types";
export type { QuoteErrorCode } from "./errors";
