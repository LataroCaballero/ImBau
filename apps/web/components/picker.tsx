"use client";

// The piso → unidad picker (D-08 / UI-01) — the two-step selector the cotizador shows when there is
// no `?u` deep-link yet. Step 1 lists the project's floors (descending); step 2 fetches that floor's
// units via the anon `picker.listUnits` seam and lets the buyer pick ONE — but ONLY a `disponible`
// unit is selectable (reservado/vendido render with their semantic badge, disabled). The component
// reports the selection UP through `onPickUnit`; it NEVER writes query params (the simulator owns the
// URL state). `listUnits` returns every unit regardless of estado (RLS only gates published projects),
// so the disponible-only rule lives here, client-side, exactly as the router comment states.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@imbau/api";
import { useTRPC } from "../lib/trpc-client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Floor = RouterOutputs["picker"]["listFloors"][number];

export type PickerProps = {
  /** The project's floors (any order — the picker sorts them by `numero` descending). */
  floors: Floor[];
  /**
   * Called when the buyer selects an AVAILABLE unit. Carries the unit id (for compute/create), the
   * floor id, and the public identificador (for the WhatsApp message header). Never fired for a
   * reservado/vendido unit.
   */
  onPickUnit: (unitId: string, floorId: string, identificador: string) => void;
};

const ESTADO_LABEL: Record<string, string> = {
  disponible: "Disponible",
  reservado: "Reservado",
  vendido: "Vendido",
};

/** A small status pill using the semantic tokens (disponible/reservado/vendido). */
function EstadoBadge({ estado }: { estado: string }): React.JSX.Element {
  const cls =
    estado === "disponible"
      ? "text-disponible border-disponible/40"
      : estado === "reservado"
        ? "text-reservado border-reservado/40"
        : "text-vendido border-vendido/40";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {ESTADO_LABEL[estado] ?? estado}
    </span>
  );
}

export function Picker({ floors, onPickUnit }: PickerProps): React.JSX.Element {
  const trpc = useTRPC();
  const [floorId, setFloorId] = useState<string | null>(null);

  // Units of the chosen floor — only fetched once a floor is picked (enabled guard). The empty-string
  // placeholder is never sent because `enabled` is false while no floor is selected.
  const unitsQuery = useQuery(
    trpc.picker.listUnits.queryOptions(
      { floorId: floorId ?? "" },
      { enabled: floorId !== null },
    ),
  );

  // Step 1 — floors, descending by numero.
  if (floorId === null) {
    const sortedFloors = [...floors].sort((a, b) => b.numero - a.numero);
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-hormigon">Elegí un piso</h2>
        {sortedFloors.length === 0 ? (
          <p className="text-sm text-hormigon/70">
            Este proyecto todavía no tiene pisos cargados.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sortedFloors.map((floor) => (
              <button
                key={floor.id}
                type="button"
                onClick={() => setFloorId(floor.id)}
                className="rounded-xl border border-hormigon/10 bg-carbon p-4 text-left text-hormigon hover:border-cobre/40"
              >
                <span className="font-mono text-lg">Piso {floor.numero}</span>
                {floor.nombre ? (
                  <span className="block text-sm text-hormigon/70">{floor.nombre}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  // Step 2 — units of the chosen floor; only `disponible` is selectable.
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setFloorId(null)}
        className="self-start text-sm text-cobre hover:underline"
      >
        ← Cambiar piso
      </button>
      <h2 className="font-display text-lg text-hormigon">Elegí una unidad</h2>
      {unitsQuery.isPending ? (
        <p className="text-sm text-hormigon/70">Cargando unidades…</p>
      ) : unitsQuery.isError ? (
        <p className="text-sm text-vendido">
          No pudimos cargar las unidades. Reintentá en unos segundos.
        </p>
      ) : unitsQuery.data && unitsQuery.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {unitsQuery.data.map((unit) => {
            const selectable = unit.estado === "disponible";
            const detalle = [
              unit.tipologia,
              unit.m2 !== null ? `${unit.m2} m²` : null,
              unit.ambientes !== null ? `${unit.ambientes} amb.` : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(" · ");
            return (
              <li key={unit.id}>
                <button
                  type="button"
                  disabled={!selectable}
                  onClick={
                    selectable
                      ? () => onPickUnit(unit.id, unit.floorId, unit.identificador)
                      : undefined
                  }
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-hormigon/10 bg-carbon p-4 text-left text-hormigon enabled:hover:border-cobre/40 disabled:opacity-50"
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-base">{unit.identificador}</span>
                    {detalle ? (
                      <span className="text-sm text-hormigon/70">{detalle}</span>
                    ) : null}
                  </span>
                  <EstadoBadge estado={unit.estado} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-hormigon/70">
          Este piso no tiene unidades cargadas.
        </p>
      )}
    </section>
  );
}
