"use client";

// Notify-email settings field (D-05) — the minimal field that edits `projects.leadsNotifyEmail` via
// the extended projects.updateSettings mutation (Zod `.email()`, nullable). An empty value clears it
// back to null → the aviso falls back to the org owners (the helper explains this). A malformed
// non-empty value shows `Ingresá un email válido` inline before any write. Feedback is inline
// role="status"/role="alert" (no global toast); the input uses the cobre focus ring and the save
// button is the cobre primary. Copy verbatim from the Copywriting Contract.
import { useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "../../../../lib/trpc-client";

// Boundary-side email shape check (the server re-validates with Zod `.email()`). Empty is allowed
// (clears to the owners fallback); a non-empty value must look like an email.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function NotifyEmailField({
  projectId,
  initialEmail,
  canWrite,
}: {
  projectId: string;
  initialEmail: string | null;
  canWrite: boolean;
}): ReactElement {
  const trpc = useTRPC();
  const update = useMutation(trpc.projects.updateSettings.mutationOptions());
  const [email, setEmail] = useState(initialEmail ?? "");
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  function save(): void {
    const trimmed = email.trim();
    if (trimmed !== "" && !looksLikeEmail(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSaved(false);
    setSaveError(false);
    update.mutate(
      { id: projectId, leadsNotifyEmail: trimmed === "" ? null : trimmed },
      {
        onSuccess: () => setSaved(true),
        onError: () => setSaveError(true),
      },
    );
  }

  return (
    <div className="rounded-md border border-gris-100 bg-blanco p-4">
      <label htmlFor="notify-email" className="text-base text-grafito">
        Email para avisos de leads
      </label>
      <p className="mt-1 text-sm text-gris-500">
        Te avisamos acá cada vez que entra un lead nuevo. Si lo dejás vacío, el
        aviso va a los owners de la organización.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="notify-email"
          type="email"
          value={email}
          disabled={!canWrite}
          onChange={(e) => {
            setEmail(e.target.value);
            setInvalid(false);
            setSaved(false);
          }}
          placeholder="avisos@tu-inmobiliaria.com"
          className="h-10 flex-1 rounded-md border border-gris-300 bg-blanco px-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre disabled:opacity-60"
        />
        {canWrite ? (
          <button
            type="button"
            onClick={save}
            disabled={update.isPending}
            className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
          >
            {update.isPending ? "Guardando…" : "Guardar email"}
          </button>
        ) : null}
      </div>
      {invalid ? (
        <p role="alert" className="mt-1 text-sm text-vendido">
          Ingresá un email válido
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-1 text-sm text-vendido">
          No se pudo guardar. Reintentá.
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mt-1 text-sm text-gris-500">
          Guardado.
        </p>
      ) : null}
    </div>
  );
}
