"use client";

// Lead card (LEADS-01) — a single draggable card in a kanban column. Shows nombre (primary line,
// emphasis via Grafito color + size, NOT weight), contacto (muted Gris-500), the origen chip
// resolved by join, and an 8px stage/desenlace dot. Draggable (mouse enhancement — the a11y-complete
// transition path is the drawer estado select); the drag handle carries an accessible name. Clicking
// the card opens the drawer (D-09). Long nombre/contacto truncate + carry a `title` tooltip and must
// not break the 88px min-height (UI-SPEC backstop). Copy verbatim from the Copywriting Contract.
import type { ReactElement } from "react";
import {
  origenChipLabel,
  stageDot,
  type Lead,
} from "./leads-board";

export function LeadCard({
  lead,
  canDrag,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  canDrag: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}): ReactElement {
  const dot = stageDot(lead.estado, lead.desenlace);
  const isCerrado = lead.estado === "cerrado";
  const desenlaceLabel =
    lead.desenlace === "ganado"
      ? "Ganado"
      : lead.desenlace === "perdido"
        ? "Perdido"
        : null;

  return (
    <article
      draggable={canDrag}
      aria-roledescription="tarjeta arrastrable"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      className={`flex min-h-[88px] flex-col gap-1 rounded-md border border-gris-100 bg-blanco p-4 text-left hover:bg-gris-100/60 ${
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base text-grafito" title={lead.nombre}>
            {lead.nombre}
          </p>
          <p className="truncate text-sm text-gris-500" title={lead.contacto}>
            {lead.contacto}
          </p>
        </div>
        {canDrag ? (
          <span
            aria-label="Arrastrar para mover"
            className="shrink-0 text-gris-300"
            aria-hidden={false}
          >
            {/* grip glyph */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="3" r="1.3" />
              <circle cx="11" cy="3" r="1.3" />
              <circle cx="5" cy="8" r="1.3" />
              <circle cx="11" cy="8" r="1.3" />
              <circle cx="5" cy="13" r="1.3" />
              <circle cx="11" cy="13" r="1.3" />
            </svg>
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="truncate rounded-full bg-gris-100 px-2 py-0.5 text-sm text-gris-500">
          {origenChipLabel(lead.origenResuelto)}
        </span>
        {isCerrado && desenlaceLabel ? (
          <span
            className={`rounded-full px-2 py-0.5 text-sm ${
              lead.desenlace === "ganado"
                ? "bg-disponible/15 text-disponible"
                : "bg-vendido/15 text-vendido"
            }`}
          >
            {desenlaceLabel}
          </span>
        ) : null}
      </div>
    </article>
  );
}
