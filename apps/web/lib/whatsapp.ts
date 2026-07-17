// The wa.me deep-link builder for the cotizador CTA (WA-01, RESEARCH Pattern 5).
//
// SECURITY (T-06-04-REDIRECT): the URL host is the FIXED literal `https://wa.me/`; the ONLY thing
// interpolated from the project's `whatsapp` field is its digits — the field is stripped to `[0-9]`
// before it touches the string, so no value in that column can rewrite the host (open redirect).
//
// DRIFT (T-06-04-DRIFT): the message BODY is `toWhatsAppText(result)` from @imbau/quoting — never
// re-implemented here. One `QuoteResult` → the same amounts on screen, in the PDF and in this
// message. No amount is formatted in this module (the engine owns every currency string); only the
// header copy and the deep link (already a plain URL) are appended.
import { toWhatsAppText } from "@imbau/quoting";
import type { QuoteResult } from "@imbau/quoting";

export type BuildWhatsappUrlArgs = {
  /** The project's WhatsApp number (any human format) or null when unset (D-02). */
  whatsapp: string | null;
  /** The unit's public identifier, e.g. "4B" — shown in the message header. */
  unitIdentificador: string;
  /** The project name — shown in the message header. */
  projectNombre: string;
  /** The computed quote whose body text comes from `toWhatsAppText`. */
  result: QuoteResult;
  /** The shareable deep link back to this exact cotizador state (UI-01). */
  deepLinkUrl: string;
};

/**
 * Build a `https://wa.me/<digits>?text=<url-encoded>` click-to-chat URL from a `QuoteResult` and the
 * project's number, or `null` when the number is absent/empty so the caller hides the CTA (D-02 — no
 * dead button). The body is `toWhatsAppText(result)`; the header + deep link are appended and the
 * whole text is `encodeURIComponent`-ed. The host is always the fixed `https://wa.me/` literal.
 */
export function buildWhatsappUrl(args: BuildWhatsappUrlArgs): string | null {
  const { whatsapp, unitIdentificador, projectNombre, result, deepLinkUrl } = args;
  if (!whatsapp) return null;

  // wa.me wants digits only (country code, no `+`/spaces). Stripping to [0-9] is also the open-redirect
  // guard: whatever the column holds, only its digits reach the URL.
  const digits = whatsapp.replace(/[^\d]/g, "");
  if (digits === "") return null;

  const header = `Hola! Me interesa la unidad ${unitIdentificador} de ${projectNombre}.`;
  const body = toWhatsAppText(result);
  const text = encodeURIComponent(`${header}\n${body}\n${deepLinkUrl}`);

  return `https://wa.me/${digits}?text=${text}`;
}
