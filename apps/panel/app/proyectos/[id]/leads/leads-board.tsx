"use client";

// Leads bandeja island (LEADS-01..04 / D-08/D-09) — the panel's kanban board and the D2 sibling of
// the units grid. It consumes the Plan 03 leads router: listForProject (read), updateEstado (drag +
// drawer-select transitions, both writing the SAME mutation — a11y parity), addNote and create (via
// the drawer / alta form islands), plus projects.updateSettings (via the notify-email field). Every
// write is independently gated server-side by requireRole (Plan 03); `canWrite` here is COSMETIC
// defense-in-depth ONLY (D-08).
//
// Design contract: 11-UI-SPEC. The board is the visual anchor — four white-card columns on the
// Hormigón canvas, read left-to-right; cobre is reserved for actions + the active drop-target ring;
// stage/desenlace dots carry status. Transitions are FREE between the 4 enum values (D-02); any move
// INTO `cerrado` opens the desenlace prompt BEFORE the write (D-03). The estado enum is stored ASCII
// (`negociacion`) but ALWAYS rendered accented (`Negociación`) — the raw value never reaches the UI.
// Feedback is inline role="status"/role="alert" (no global toast, Phase 10 D-04). es-AR voseo copy
// lifted verbatim from the Copywriting Contract.
import { useMemo, useState, type DragEvent, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@imbau/api";
import { useTRPC } from "../../../../lib/trpc-client";
import { LeadCard } from "./lead-card";
import { LeadDrawer } from "./lead-drawer";
import { DesenlacePrompt } from "./desenlace-prompt";
import { AltaLeadForm } from "./alta-lead-form";
import { NotifyEmailField } from "./notify-email-field";

type RouterOutputs = inferRouterOutputs<AppRouter>;
// Derived from the router output so the board never drifts from the server contract.
export type Lead = RouterOutputs["leads"]["listForProject"][number];
export type LeadEstado = Lead["estado"];
export type Desenlace = "ganado" | "perdido";
export type TimelineEntry = Lead["timeline"][number];
export type OrigenResuelto = Lead["origenResuelto"];

// Accented display labels (UI-SPEC §Color / §Typography es-AR display rule). The raw ASCII enum
// value (`negociacion`) is NEVER surfaced — always mapped through this record first.
export const ESTADO_LABEL: Record<LeadEstado, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  negociacion: "Negociación",
  cerrado: "Cerrado",
};

// Fixed pipeline order (D-08): one column per stage, left-to-right.
export const STAGE_ORDER: LeadEstado[] = [
  "nuevo",
  "contactado",
  "negociacion",
  "cerrado",
];

// Stage dot colors (UI-SPEC §Color table). cerrado is split by desenlace (green ganado / red
// perdido); dots are status-only and NEVER the cobre action accent.
const STAGE_DOT: Record<LeadEstado, string> = {
  nuevo: "bg-blueprint",
  contactado: "bg-gris-500",
  negociacion: "bg-reservado",
  cerrado: "bg-gris-300",
};

// `desenlace` is the router's nullable `text` column (stored `ganado`/`perdido`), so it types as
// `string | null` here — compared against the literals rather than the narrow Desenlace union.
export function desenlaceDot(desenlace: string | null): string {
  if (desenlace === "ganado") return "bg-disponible";
  if (desenlace === "perdido") return "bg-vendido";
  return "bg-gris-300";
}

export function stageDot(estado: LeadEstado, desenlace: string | null): string {
  return estado === "cerrado" ? desenlaceDot(desenlace) : STAGE_DOT[estado];
}

// Origen chip copy (UI-SPEC §Copywriting — resolved by join, LEADS-01).
export function origenChipLabel(origen: OrigenResuelto): string {
  switch (origen.tipo) {
    case "broker":
      return `Broker · ${origen.label}`;
    case "unidad":
      return `Unidad ${origen.label}`;
    case "cotizacion":
      return "Cotización";
    default:
      return "Directo";
  }
}

export function LeadsBoard({
  projectId,
  canWrite,
  notifyEmail,
}: {
  projectId: string;
  canWrite: boolean;
  notifyEmail: string | null;
}): ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const boardQuery = useQuery(
    trpc.leads.listForProject.queryOptions({ projectId }),
  );
  const boardKey = trpc.leads.listForProject.queryKey({ projectId });
  const updateEstado = useMutation(trpc.leads.updateEstado.mutationOptions());

  const refetchBoard = (): void => {
    void queryClient.invalidateQueries({ queryKey: boardKey });
  };

  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [altaOpen, setAltaOpen] = useState(false);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverEstado, setDragOverEstado] = useState<LeadEstado | null>(null);
  // Lead awaiting the desenlace choice before a transition into `cerrado` is committed (D-03).
  const [pendingCerrado, setPendingCerrado] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const leads = useMemo(() => boardQuery.data ?? [], [boardQuery.data]);
  const openLead = useMemo(
    () => leads.find((l) => l.id === openLeadId) ?? null,
    [leads, openLeadId],
  );

  // Optimistic transition (LEADS-02, D-02). Snapshot → optimistic move → mutate; on error revert to
  // the snapshot and surface the inline alert (Interaction Contracts). The desenlace-gated path into
  // `cerrado` routes through confirmCerrado instead.
  function commitTransition(
    leadId: string,
    estado: LeadEstado,
    desenlace: Desenlace | null,
  ): void {
    setTransitionError(null);
    const snapshot = queryClient.getQueryData<Lead[]>(boardKey);
    queryClient.setQueryData<Lead[]>(boardKey, (old) =>
      (old ?? []).map((l) =>
        l.id === leadId
          ? { ...l, estado, desenlace: estado === "cerrado" ? desenlace : null }
          : l,
      ),
    );
    updateEstado.mutate(
      {
        projectId,
        leadId,
        estado,
        ...(desenlace ? { desenlace } : {}),
      },
      {
        onSuccess: () => {
          setPendingCerrado(null);
          refetchBoard();
        },
        onError: () => {
          if (snapshot) queryClient.setQueryData(boardKey, snapshot);
          setTransitionError("No se pudo guardar. Reintentá.");
        },
      },
    );
  }

  // Entry point for any transition request (drag drop OR drawer select). Entering `cerrado` opens
  // the desenlace prompt first; every other destination commits immediately.
  function requestTransition(leadId: string, estado: LeadEstado): void {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.estado === estado) return;
    if (estado === "cerrado") {
      setTransitionError(null);
      setPendingCerrado(leadId);
      return;
    }
    commitTransition(leadId, estado, null);
  }

  function onDrop(estado: LeadEstado): void {
    const leadId = dragLeadId;
    setDragLeadId(null);
    setDragOverEstado(null);
    if (!leadId || !canWrite) return;
    requestTransition(leadId, estado);
  }

  function handleColumnDragOver(e: DragEvent, estado: LeadEstado): void {
    if (!canWrite || !dragLeadId) return;
    e.preventDefault();
    setDragOverEstado(estado);
  }

  // --- Loading (skeleton cards per column) ---
  if (boardQuery.isLoading) {
    return (
      <div
        className="mt-6 flex gap-6 overflow-x-auto pb-4"
        aria-busy="true"
        aria-label="Cargando leads"
      >
        {STAGE_ORDER.map((estado) => (
          <div key={estado} className="w-80 shrink-0">
            <div className="h-12 w-full animate-pulse rounded-md bg-gris-100" />
            <div className="mt-2 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[88px] w-full animate-pulse rounded-md bg-gris-100"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --- Board-level load error ---
  if (boardQuery.isError) {
    return (
      <div
        role="alert"
        className="mt-6 rounded-md border border-vendido/40 bg-blanco p-6 text-grafito"
      >
        <p className="text-base">No pudimos cargar los leads. Reintentá.</p>
        <button
          type="button"
          onClick={() => void boardQuery.refetch()}
          className="mt-4 h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // --- Empty board (0 leads) ---
  if (leads.length === 0) {
    return (
      <div className="mt-6">
        <div className="rounded-lg border border-gris-100 bg-blanco p-12 text-center">
          <h2 className="text-xl text-grafito">Todavía no hay leads</h2>
          <p className="mx-auto mt-2 max-w-xl text-base text-gris-500">
            Cuando entre un lead por el showroom vas a verlo acá. Mientras tanto,
            podés registrar a mano los que te lleguen por WhatsApp o teléfono.
          </p>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setAltaOpen(true)}
              className="mt-6 h-10 rounded-md bg-cobre px-5 text-base text-grafito hover:bg-cobre-profundo"
            >
              Registrar lead
            </button>
          ) : null}
        </div>
        <div className="mt-8 max-w-md">
          <NotifyEmailField
            projectId={projectId}
            initialEmail={notifyEmail}
            canWrite={canWrite}
          />
        </div>
        {altaOpen ? (
          <AltaLeadForm
            projectId={projectId}
            onClose={() => setAltaOpen(false)}
            onCreated={refetchBoard}
          />
        ) : null}
      </div>
    );
  }

  // --- Populated board ---
  return (
    <div className="mt-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {canWrite ? (
          <button
            type="button"
            onClick={() => setAltaOpen(true)}
            className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo"
          >
            Registrar lead
          </button>
        ) : (
          <span />
        )}
        <div className="w-full max-w-md md:w-auto">
          <NotifyEmailField
            projectId={projectId}
            initialEmail={notifyEmail}
            canWrite={canWrite}
          />
        </div>
      </div>

      {transitionError ? (
        <p role="alert" className="mt-3 text-sm text-vendido">
          {transitionError}
        </p>
      ) : null}

      {/* Kanban board — horizontal scroll on narrow width (desktop-first) */}
      <div className="mt-4 flex gap-6 overflow-x-auto pb-4">
        {STAGE_ORDER.map((estado) => {
          const columnLeads = leads.filter((l) => l.estado === estado);
          const isDragOver = dragOverEstado === estado;
          return (
            <section
              key={estado}
              aria-label={ESTADO_LABEL[estado]}
              onDragOver={(e) => handleColumnDragOver(e, estado)}
              onDragLeave={() => setDragOverEstado((c) => (c === estado ? null : c))}
              onDrop={() => onDrop(estado)}
              className={`flex w-80 shrink-0 flex-col rounded-lg bg-hormigon ${
                isDragOver ? "ring-2 ring-cobre" : ""
              }`}
            >
              {/* Column header */}
              <header className="flex h-12 items-center gap-2 px-4">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${STAGE_DOT[estado]}`}
                  aria-hidden
                />
                <h2 className="text-xl text-grafito">{ESTADO_LABEL[estado]}</h2>
                <span className="ml-auto rounded-full bg-gris-100 px-2 py-0.5 text-sm text-gris-500">
                  {columnLeads.length === 0 ? "Sin leads" : columnLeads.length}
                </span>
              </header>

              {/* Column body */}
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-3 pb-4">
                {columnLeads.length === 0 ? (
                  <p className="px-1 py-8 text-center text-sm text-gris-500">
                    Sin leads en esta etapa
                  </p>
                ) : (
                  columnLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      canDrag={canWrite}
                      onOpen={() => setOpenLeadId(lead.id)}
                      onDragStart={() => setDragLeadId(lead.id)}
                      onDragEnd={() => {
                        setDragLeadId(null);
                        setDragOverEstado(null);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {openLead ? (
        <LeadDrawer
          projectId={projectId}
          lead={openLead}
          canWrite={canWrite}
          saving={updateEstado.isPending}
          onClose={() => setOpenLeadId(null)}
          onRequestEstado={(estado) => requestTransition(openLead.id, estado)}
          onNoteAdded={refetchBoard}
        />
      ) : null}

      {pendingCerrado ? (
        <DesenlacePrompt
          saving={updateEstado.isPending}
          error={transitionError}
          onCancel={() => setPendingCerrado(null)}
          onConfirm={(desenlace) =>
            commitTransition(pendingCerrado, "cerrado", desenlace)
          }
        />
      ) : null}

      {altaOpen ? (
        <AltaLeadForm
          projectId={projectId}
          onClose={() => setAltaOpen(false)}
          onCreated={refetchBoard}
        />
      ) : null}
    </div>
  );
}
