"use client";

// Units grid island (GRID-01/02/03/06) — the panel's highest-value money surface and its first
// styled screen. It consumes the Plan 03 units router: listForProject (read), updatePrice +
// updateEstado (inline edits), exportExcel (download). Selection + Importar Excel / Editar precios
// en lote open the Task-2 islands (import-wizard / bulk-edit). Every write is independently gated
// server-side by requireRole (Plan 03); `canWrite` here is COSMETIC defense-in-depth only (D-08).
//
// Design contract: 10-UI-SPEC. Money is whole-USD, JetBrains Mono `tabular-nums`, via the canonical
// formatUsd (packages/quoting — the UI==PDF==WhatsApp single source; empty price → "—", never 0).
// The price columns are the primary visual anchor; cobre is reserved for primary actions + the
// editing price-cell ring. es-AR voseo copy lifted verbatim from the Copywriting Contract.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUsd } from "@imbau/quoting";
// The SAME pure es-AR money parser the Excel import path uses (money.ts). Routing the inline editor
// through it closes CR-01: raw Number("185.000") === 185 would silently write $185 for the natural
// es-AR grouped input "185.000". money-core is dependency-free, so this drags no server deps into the
// client bundle.
import { parseMoneyStringEsAr } from "@imbau/api/money";
import { useTRPC } from "../../../../lib/trpc-client";
import { ImportWizard } from "./import-wizard";
import { BulkEdit } from "./bulk-edit";

type UnitEstado = "disponible" | "reservado" | "vendido";

const ESTADO_OPTIONS: { value: UnitEstado; label: string }[] = [
  { value: "disponible", label: "Disponible" },
  { value: "reservado", label: "Reservado" },
  { value: "vendido", label: "Vendido" },
];

const ESTADO_DOT: Record<string, string> = {
  disponible: "bg-disponible",
  reservado: "bg-reservado",
  vendido: "bg-vendido",
};

// Trigger a browser download of a base64 xlsx workbook (exportExcel returns base64 so Next never
// proxies binary bytes). Kept local — the only place the panel decodes a workbook.
function downloadBase64Xlsx(base64: string, filename: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function UnitsGrid({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}): ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const gridQuery = useQuery(trpc.units.listForProject.queryOptions({ projectId }));

  const gridKey = trpc.units.listForProject.queryKey({ projectId });
  const refetchGrid = (): void => {
    void queryClient.invalidateQueries({ queryKey: gridKey });
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const units = gridQuery.data?.units ?? [];
  const financiadoListId = gridQuery.data?.financiadoListId ?? null;
  const contadoListId = gridQuery.data?.contadoListId ?? null;
  const priceLists = gridQuery.data?.priceLists ?? [];
  const financiadoNombre =
    priceLists.find((l) => l.id === financiadoListId)?.nombre ?? "Financiado";
  const contadoNombre =
    priceLists.find((l) => l.id === contadoListId)?.nombre ?? "Contado";

  const allSelected = units.length > 0 && selected.size === units.length;
  const someSelected = selected.size > 0 && !allSelected;
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(units.map((u) => u.unitId)));
  }
  function toggleOne(unitId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }
  function clearSelection(): void {
    setSelected(new Set());
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const res = await queryClient.fetchQuery(
        trpc.units.exportExcel.queryOptions({ projectId }),
      );
      downloadBase64Xlsx(res.base64, res.filename);
    } finally {
      setExporting(false);
    }
  }

  // --- Loading (skeleton rows) ---
  if (gridQuery.isLoading) {
    return (
      <div className="mt-6" aria-busy="true" aria-label="Cargando unidades">
        <div className="h-12 w-full animate-pulse rounded-md bg-gris-100" />
        <div className="mt-2 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-sm bg-gris-100" />
          ))}
        </div>
      </div>
    );
  }

  // --- Grid-level load error (backstop — distinct from the per-cell save error) ---
  if (gridQuery.isError) {
    return (
      <div
        role="alert"
        className="mt-6 rounded-md border border-vendido/40 bg-blanco p-6 text-grafito"
      >
        <p className="text-base">No pudimos cargar las unidades.</p>
        <button
          type="button"
          onClick={() => void gridQuery.refetch()}
          className="mt-4 h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // --- Empty state ---
  if (units.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-gris-100 bg-blanco p-12 text-center">
        <h2 className="text-xl text-grafito">Todavía no hay unidades</h2>
        <p className="mx-auto mt-2 max-w-md text-base text-gris-500">
          Este proyecto no tiene unidades cargadas. Importá un Excel para cargarlas.
        </p>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="mt-6 h-10 rounded-md bg-cobre px-5 text-base text-grafito hover:bg-cobre-profundo"
          >
            Importar Excel
          </button>
        ) : null}
        {importOpen ? (
          <ImportWizard
            projectId={projectId}
            onClose={() => setImportOpen(false)}
            onApplied={refetchGrid}
          />
        ) : null}
      </div>
    );
  }

  // --- Populated grid ---
  return (
    <div className="mt-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
        >
          {exporting ? "Generando…" : "Exportar a Excel"}
        </button>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo"
          >
            Importar Excel
          </button>
        ) : null}
      </div>

      {/* Selection bar (hidden at 0) */}
      {selected.size > 0 ? (
        <div className="mt-4 flex h-12 items-center gap-4 rounded-md border border-cobre/50 bg-cobre/10 px-4">
          <span className="text-base text-grafito">
            {selected.size === 1
              ? "1 unidad seleccionada"
              : `${selected.size} unidades seleccionadas`}
          </span>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo"
            >
              Editar precios en lote
            </button>
          ) : null}
          <button
            type="button"
            onClick={clearSelection}
            className="text-base text-blueprint underline underline-offset-2"
          >
            Limpiar selección
          </button>
        </div>
      ) : null}

      {/* Grid */}
      <div className="mt-4 overflow-x-auto rounded-md border border-gris-100 bg-blanco">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-11 bg-gris-100 text-left text-gris-700">
              <th className="sticky left-0 z-20 w-10 bg-gris-100 px-2 text-center">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  aria-label="Seleccionar todas las unidades"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={!canWrite}
                />
              </th>
              <th className="sticky left-10 z-20 min-w-24 bg-gris-100 px-2 font-normal">
                Identificador
              </th>
              <th className="min-w-16 px-2 font-normal text-gris-500">Piso</th>
              <th className="min-w-32 px-2 font-normal text-gris-500">Tipología</th>
              <th className="min-w-16 px-2 text-right font-normal text-gris-500">m²</th>
              <th className="min-w-32 px-2 text-right font-normal">{financiadoNombre}</th>
              <th className="min-w-32 px-2 text-right font-normal">{contadoNombre}</th>
              <th className="min-w-36 px-2 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const isSelected = selected.has(u.unitId);
              return (
                <tr
                  key={u.unitId}
                  className="h-10 border-t border-gris-100 hover:bg-hormigon/60"
                >
                  <td
                    className={`sticky left-0 z-10 w-10 px-2 text-center ${
                      isSelected ? "bg-cobre/10" : "bg-blanco"
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${u.identificador}`}
                      checked={isSelected}
                      onChange={() => toggleOne(u.unitId)}
                      disabled={!canWrite}
                    />
                  </td>
                  <td
                    className={`sticky left-10 z-10 max-w-40 truncate px-2 text-grafito ${
                      isSelected ? "bg-cobre/10" : "bg-blanco"
                    }`}
                    title={u.identificador}
                  >
                    {u.identificador}
                  </td>
                  <td className="max-w-24 truncate px-2 text-gris-500" title={u.piso}>
                    {u.piso}
                  </td>
                  <td
                    className="max-w-40 truncate px-2 text-gris-500"
                    title={u.tipologia}
                  >
                    {u.tipologia || "—"}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums text-gris-500">
                    {u.m2 === null ? "—" : u.m2}
                  </td>
                  <td className="px-2 text-right">
                    <PriceCell
                      projectId={projectId}
                      unitId={u.unitId}
                      priceListId={financiadoListId}
                      value={u.financiado}
                      canWrite={canWrite}
                      onSaved={refetchGrid}
                    />
                  </td>
                  <td className="px-2 text-right">
                    <PriceCell
                      projectId={projectId}
                      unitId={u.unitId}
                      priceListId={contadoListId}
                      value={u.contado}
                      canWrite={canWrite}
                      onSaved={refetchGrid}
                    />
                  </td>
                  <td className="px-2">
                    <EstadoCell
                      projectId={projectId}
                      unitId={u.unitId}
                      estado={u.estado}
                      canWrite={canWrite}
                      onSaved={refetchGrid}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {importOpen ? (
        <ImportWizard
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onApplied={refetchGrid}
        />
      ) : null}

      {bulkOpen && selected.size > 0 ? (
        <BulkEdit
          projectId={projectId}
          unitIds={[...selected]}
          financiadoListId={financiadoListId}
          contadoListId={contadoListId}
          financiadoNombre={financiadoNombre}
          contadoNombre={contadoNombre}
          onClose={() => setBulkOpen(false)}
          onApplied={() => {
            refetchGrid();
            clearSelection();
            setBulkOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// --- Price cell (GRID-01) — the inline-edit state machine + focal cobre focus ring ---
type PriceCellState = "idle" | "editing" | "saving" | "saved" | "error";

function PriceCell({
  projectId,
  unitId,
  priceListId,
  value,
  canWrite,
  onSaved,
}: {
  projectId: string;
  unitId: string;
  priceListId: string | null;
  value: number | null;
  canWrite: boolean;
  onSaved: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const update = useMutation(trpc.units.updatePrice.mutationOptions());
  const [state, setState] = useState<PriceCellState>("idle");
  const [draft, setDraft] = useState("");

  const editable = canWrite && priceListId !== null;

  function beginEdit(): void {
    if (!editable) return;
    setDraft(value === null ? "" : String(value));
    setState("editing");
  }

  function commit(): void {
    if (priceListId === null) {
      setState("idle");
      return;
    }
    const trimmed = draft.trim();
    if (trimmed === "") {
      // Clearing a price is an import-only operation (updatePrice upserts) — cancel the inline edit.
      setState("idle");
      return;
    }
    // Single source of truth with the Excel import: "185.000" → 185000, and "185,50"/"1.5"/negatives/
    // above-int4-cap/garbage → null → red + revert (CR-01, IN-04).
    const parsed = parseMoneyStringEsAr(trimmed);
    if (parsed === null) {
      setState("error");
      return;
    }
    setState("saving");
    update.mutate(
      { projectId, unitId, priceListId, precio: parsed },
      {
        onSuccess: () => {
          setState("saved");
          onSaved();
          window.setTimeout(() => setState("idle"), 900);
        },
        onError: () => setState("error"),
      },
    );
  }

  if (state === "editing" || state === "saving") {
    return (
      <input
        type="text"
        inputMode="numeric"
        autoFocus
        disabled={state === "saving"}
        value={draft}
        aria-label="Editar precio (USD entero)"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setState("idle");
        }}
        className="w-28 rounded-sm border-2 border-cobre bg-blanco px-1 text-right font-mono text-sm tabular-nums outline-none disabled:opacity-60"
      />
    );
  }

  if (state === "error") {
    return (
      <button
        type="button"
        onClick={beginEdit}
        title="No se pudo guardar. Reintentá."
        className="w-full rounded-sm border-2 border-vendido px-1 text-right font-mono text-sm tabular-nums text-vendido"
      >
        {value === null ? "—" : formatUsd(value)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      disabled={!editable}
      className={`w-full rounded-sm px-1 text-right font-mono text-sm tabular-nums ${
        state === "saved" ? "bg-disponible/15" : ""
      } ${editable ? "cursor-text hover:bg-gris-100" : "cursor-default"} ${
        value === null ? "text-gris-500" : "text-grafito"
      }`}
    >
      {value === null ? "—" : formatUsd(value)}
    </button>
  );
}

// --- Estado cell (GRID-02) — inline dropdown, dot + label, individual only (no bulk estado) ---
function EstadoCell({
  projectId,
  unitId,
  estado,
  canWrite,
  onSaved,
}: {
  projectId: string;
  unitId: string;
  estado: string;
  canWrite: boolean;
  onSaved: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const update = useMutation(trpc.units.updateEstado.mutationOptions());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const dot = ESTADO_DOT[estado] ?? "bg-gris-300";
  const label =
    ESTADO_OPTIONS.find((o) => o.value === estado)?.label ?? estado;

  function onChange(next: UnitEstado): void {
    setError(false);
    setSaving(true);
    update.mutate(
      { projectId, unitId, estado: next },
      {
        onSuccess: () => {
          setSaving(false);
          onSaved();
        },
        onError: () => {
          setSaving(false);
          setError(true);
        },
      },
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {canWrite ? (
        <select
          value={estado}
          disabled={saving}
          aria-label="Cambiar estado de la unidad"
          onChange={(e) => onChange(e.target.value as UnitEstado)}
          className="h-8 rounded-sm border border-gris-300 bg-blanco px-1 text-sm text-grafito disabled:opacity-60"
        >
          {ESTADO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm text-grafito">{label}</span>
      )}
      {saving ? <span className="text-xs text-gris-500">Guardando…</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-vendido">
          No se pudo guardar. Reintentá.
        </span>
      ) : null}
    </span>
  );
}
