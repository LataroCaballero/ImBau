"use client";

// Desenlace prompt (D-03) — the required-choice gate shown BEFORE any transition into `cerrado`
// commits. `Ganado` / `Perdido` must be chosen; confirm writes estado=`cerrado`+`desenlace`, cancel
// aborts the move (the card returns to origin, estado unchanged — handled by the board). This is a
// NEUTRAL required choice (reversible by reopening the lead), NOT a destructive confirmation: the
// confirm button is cobre, never red/danger. Copy verbatim from the Copywriting Contract.
import { useState, type ReactElement } from "react";
import type { Desenlace } from "./leads-board";

export function DesenlacePrompt({
  saving,
  error,
  onConfirm,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  onConfirm: (desenlace: Desenlace) => void;
  onCancel: () => void;
}): ReactElement {
  const [choice, setChoice] = useState<Desenlace | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafito/40 p-4">
      <div
        role="dialog"
        aria-label="¿Cómo cerró este lead?"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-blanco p-6 shadow-card"
      >
        <h2 className="text-xl text-grafito">¿Cómo cerró este lead?</h2>
        <p className="mt-2 text-base text-gris-500">
          Elegí el desenlace para cerrar el lead. Lo vas a poder cambiar
          reabriéndolo.
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">Desenlace</legend>
          <div className="flex gap-3">
            {(["ganado", "perdido"] as const).map((value) => (
              <label
                key={value}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-3 text-base ${
                  choice === value
                    ? "border-cobre ring-2 ring-cobre"
                    : "border-gris-300 hover:bg-gris-100"
                }`}
              >
                <input
                  type="radio"
                  name="desenlace"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                  className="sr-only"
                />
                {value === "ganado" ? "Ganado" : "Perdido"}
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-vendido">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100 disabled:opacity-60"
          >
            Cancelar cierre
          </button>
          <button
            type="button"
            onClick={() => choice && onConfirm(choice)}
            disabled={choice === null || saving}
            className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Guardar desenlace"}
          </button>
        </div>
      </div>
    </div>
  );
}
