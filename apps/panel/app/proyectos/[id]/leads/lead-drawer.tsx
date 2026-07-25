"use client";

// Lead drawer (LEADS-02/03, D-04/D-09) — the right-side 480px panel that opens over the board (no
// navigation away). Header: nombre + the estado `<select>` (the keyboard-complete transition path —
// a11y parity with drag) + close (`aria-label="Cerrar"`). Body: the `Actividad` timeline (the JSONB
// `leads.timeline` rendered chronologically by `ts`, autor visible) and the `Agregar nota` form.
//
// Estado changes route UP to the board via onRequestEstado (so the desenlace gate + optimistic move
// live in one place); the select never depends on drag. Add-note calls leads.addNote directly and
// invalidates the board on success so the timeline refreshes. Feedback is inline role="status" /
// role="alert" (no global toast). Copy verbatim from the Copywriting Contract; `Negociación` always
// rendered accented (never the raw `negociacion`).
import { useMemo, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "../../../../lib/trpc-client";
import {
  ESTADO_LABEL,
  STAGE_ORDER,
  stageDot,
  type Lead,
  type LeadEstado,
  type TimelineEntry,
} from "./leads-board";

// Timestamps render in America/Argentina/Buenos_Aires: relative for the last 24h, absolute date
// otherwise (UI-SPEC §Copywriting timestamps rule).
function formatTs(ts: string): string {
  const then = new Date(ts);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return then.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// The creation entries are full system phrases; transitions carry estadoPrev/estadoNuevo. Free notes
// render with the `{autor} · {nota}` separator (UI-SPEC timeline rows).
function entryText(entry: TimelineEntry): string {
  const autor = entry.autor;
  if (entry.estadoPrev && entry.estadoNuevo) {
    return autor ? `${autor} ${entry.nota}` : entry.nota;
  }
  if (entry.nota === "Lead recibido desde el showroom") return entry.nota;
  if (entry.nota === "registró el lead") {
    return autor ? `${autor} ${entry.nota}` : entry.nota;
  }
  return autor ? `${autor} · ${entry.nota}` : entry.nota;
}

export function LeadDrawer({
  projectId,
  lead,
  canWrite,
  saving,
  onClose,
  onRequestEstado,
  onNoteAdded,
}: {
  projectId: string;
  lead: Lead;
  canWrite: boolean;
  saving: boolean;
  onClose: () => void;
  onRequestEstado: (estado: LeadEstado) => void;
  onNoteAdded: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const addNote = useMutation(trpc.leads.addNote.mutationOptions());
  const [nota, setNota] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [noteStatus, setNoteStatus] = useState(false);

  const timeline = useMemo<TimelineEntry[]>(
    () =>
      [...lead.timeline].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      ),
    [lead.timeline],
  );

  function submitNote(): void {
    const trimmed = nota.trim();
    if (trimmed === "") return;
    setNoteError(false);
    setNoteStatus(false);
    addNote.mutate(
      { projectId, leadId: lead.id, nota: trimmed },
      {
        onSuccess: () => {
          setNota("");
          setNoteStatus(true);
          onNoteAdded();
        },
        onError: () => setNoteError(true),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-grafito/40">
      <aside
        role="dialog"
        aria-label={`Lead ${lead.nombre}`}
        className="flex h-full w-full max-w-[480px] flex-col bg-blanco shadow-card"
      >
        {/* Header */}
        <header className="flex h-14 items-center gap-3 border-b border-gris-100 px-6">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${stageDot(
              lead.estado,
              lead.desenlace,
            )}`}
            aria-hidden
          />
          <h2 className="min-w-0 flex-1 truncate text-xl text-grafito" title={lead.nombre}>
            {lead.nombre}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded-md p-1 text-gris-500 hover:bg-gris-100"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* Estado control */}
        <div className="flex items-center gap-3 border-b border-gris-100 px-6 py-4">
          <label htmlFor="lead-estado" className="text-base text-grafito">
            Estado
          </label>
          {canWrite ? (
            <select
              id="lead-estado"
              value={lead.estado}
              disabled={saving}
              onChange={(e) => onRequestEstado(e.target.value as LeadEstado)}
              className="h-10 rounded-md border border-gris-300 bg-blanco px-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre disabled:opacity-60"
            >
              {STAGE_ORDER.map((estado) => (
                <option key={estado} value={estado}>
                  {ESTADO_LABEL[estado]}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-base text-grafito">{ESTADO_LABEL[lead.estado]}</span>
          )}
          {saving ? <span className="text-sm text-gris-500">Guardando…</span> : null}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h3 className="text-xl text-grafito">Actividad</h3>
          {timeline.length === 0 ? (
            <p className="mt-4 text-base text-gris-500">Sin actividad todavía</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {timeline.map((entry, i) => (
                <li key={`${entry.ts}-${i}`} className="flex flex-col gap-0.5">
                  <p className="whitespace-pre-wrap break-words text-base text-grafito">
                    {entryText(entry)}
                  </p>
                  <span className="text-sm text-gris-500">{formatTs(entry.ts)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Add note */}
        {canWrite ? (
          <div className="border-t border-gris-100 px-6 py-4">
            <label htmlFor="lead-nota" className="text-base text-grafito">
              Agregar nota
            </label>
            <textarea
              id="lead-nota"
              value={nota}
              onChange={(e) => {
                setNota(e.target.value);
                setNoteStatus(false);
              }}
              placeholder="Escribí una nota…"
              rows={3}
              className="mt-1 block w-full resize-y rounded-md border border-gris-300 bg-blanco px-2 py-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre"
            />
            {noteError ? (
              <p role="alert" className="mt-1 text-sm text-vendido">
                No se pudo guardar. Reintentá.
              </p>
            ) : null}
            {noteStatus ? (
              <p role="status" className="mt-1 text-sm text-gris-500">
                Nota agregada.
              </p>
            ) : null}
            <button
              type="button"
              onClick={submitNote}
              disabled={nota.trim() === "" || addNote.isPending}
              className="mt-2 h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
            >
              {addNote.isPending ? "Guardando…" : "Agregar nota"}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
