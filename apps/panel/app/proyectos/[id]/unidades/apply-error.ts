// Shared es-AR apply-error describer for the two irreversible money wizards (import + bulk). WR-03:
// both wizards previously collapsed every apply failure into ONE fixed string ("No se aplicó ningún
// cambio. Si una fila falla, no se aplica nada."), which hid the real cause — e.g. the stale-DB 500
// seen in UAT, or a WR-01/WR-02 overflow — behind copy that wrongly blames a row. This maps the
// known tRPC error codes to a clear es-AR reason and otherwise surfaces the server's own (es-AR)
// message, so the operator gets actionable detail on a money operation that cannot be undone.

// The subset of a TRPCClientError we read on the client. Kept structural (no @trpc/client import) so
// this stays a tiny pure util both wizards can share.
interface ApplyErrorLike {
  message?: string;
  data?: { code?: string | null } | null;
}

const GENERIC =
  "No se pudo aplicar el cambio y no se escribió nada. Reintentá; si el problema persiste, avisá al equipo.";

export function describeApplyError(err: unknown): string {
  const e = (err ?? {}) as ApplyErrorLike;
  const code = e.data?.code ?? undefined;
  const message = typeof e.message === "string" ? e.message.trim() : "";

  // A server 500 masks its real message to "Internal Server Error" — never show that raw; give the
  // operator a clear "nothing was written" statement instead of a row-blaming sentence.
  if (code === "INTERNAL_SERVER_ERROR" || message === "" || message === "Internal Server Error") {
    return GENERIC;
  }
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return "No tenés permiso para aplicar estos cambios.";
  }
  // BAD_REQUEST (and the rest): the server message is already es-AR and specific — surface it.
  return message;
}
