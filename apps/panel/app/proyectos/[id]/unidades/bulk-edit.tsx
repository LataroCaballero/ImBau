"use client";

// Bulk-edit island (GRID-06, D-12/D-13) — the selection-triggered % / monto-fijo price editor and
// its MANDATORY preview modal. Money is irreversible, so a bulk edit NEVER applies blind: the panel
// computes units.bulkPreview (server-side, Math.round integer USD, rejects negatives), shows the
// true viejo → nuevo per unit with the all-or-nothing destructive-confirmation copy, and only then
// calls units.bulkUpdatePrice (one all-or-nothing withTenant tx). Server-side requireRole is the
// real authority; this UI is defense-in-depth. Feedback is inline per surface (planner assumption —
// no global toast). es-AR voseo copy verbatim from the Copywriting Contract.
import { useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatUsd } from "@imbau/quoting";
import { useTRPC } from "../../../../lib/trpc-client";
import { describeApplyError } from "./apply-error";

type BulkMode = "percent" | "fixed";

interface PreviewRow {
  unitId: string;
  identificador: string;
  old: number | null;
  new: number;
}
interface PreviewError {
  identificador: string;
  reason: string;
}
interface Preview {
  rows: PreviewRow[];
  errors: PreviewError[];
}

export function BulkEdit({
  projectId,
  unitIds,
  financiadoListId,
  contadoListId,
  financiadoNombre,
  contadoNombre,
  onClose,
  onApplied,
}: {
  projectId: string;
  unitIds: string[];
  financiadoListId: string | null;
  contadoListId: string | null;
  financiadoNombre: string;
  contadoNombre: string;
  onClose: () => void;
  onApplied: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const previewMut = useMutation(trpc.units.bulkPreview.mutationOptions());
  const applyMut = useMutation(trpc.units.bulkUpdatePrice.mutationOptions());

  const lists = [
    financiadoListId ? { id: financiadoListId, nombre: financiadoNombre } : null,
    contadoListId ? { id: contadoListId, nombre: contadoNombre } : null,
  ].filter((l): l is { id: string; nombre: string } => l !== null);

  const [priceListId, setPriceListId] = useState<string>(lists[0]?.id ?? "");
  const [mode, setMode] = useState<BulkMode>("percent");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  // WR-03: the real, es-AR apply-error cause (falls back to the generic message when absent).
  const [applyError, setApplyError] = useState<string | null>(null);

  const parsedValue = Number(value.trim());
  const valueValid = value.trim() !== "" && Number.isFinite(parsedValue);
  const canPreview = priceListId !== "" && valueValid;

  function runPreview(): void {
    if (!canPreview) return;
    previewMut.mutate(
      { projectId, unitIds, priceListId, mode, value: parsedValue },
      { onSuccess: (data) => setPreview(data) },
    );
  }

  function confirmApply(): void {
    setApplyError(null);
    applyMut.mutate(
      { projectId, unitIds, priceListId, mode, value: parsedValue },
      {
        onSuccess: (data) => {
          setApplied(data.applied);
          onApplied();
        },
        onError: (err) => setApplyError(describeApplyError(err)),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafito/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-blanco shadow-card">
        {/* Header */}
        <div className="border-b border-gris-100 px-6 py-4">
          <h2 className="text-xl text-grafito">Editar precios en lote</h2>
          <p className="mt-1 text-sm text-gris-500">
            {unitIds.length === 1
              ? "1 unidad seleccionada"
              : `${unitIds.length} unidades seleccionadas`}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {applied !== null ? (
            <p role="status" className="text-base text-grafito">
              Listo. Se aplicaron los cambios a {applied}{" "}
              {applied === 1 ? "unidad" : "unidades"}. La web pública ya está
              actualizada.
            </p>
          ) : preview === null ? (
            <div className="space-y-4">
              {lists.length === 0 ? (
                <p className="text-base text-vendido">
                  El proyecto no tiene listas de precios en USD.
                </p>
              ) : (
                <>
                  <label className="block text-base text-grafito">
                    Lista
                    <select
                      value={priceListId}
                      onChange={(e) => setPriceListId(e.target.value)}
                      className="mt-1 block h-10 w-full rounded-md border border-gris-300 bg-blanco px-2 text-base"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nombre}
                        </option>
                      ))}
                    </select>
                  </label>

                  <fieldset>
                    <legend className="text-base text-grafito">Tipo de ajuste</legend>
                    <div className="mt-1 flex gap-4">
                      <label className="flex items-center gap-2 text-base">
                        <input
                          type="radio"
                          name="bulk-mode"
                          checked={mode === "percent"}
                          onChange={() => setMode("percent")}
                        />
                        Porcentaje (%)
                      </label>
                      <label className="flex items-center gap-2 text-base">
                        <input
                          type="radio"
                          name="bulk-mode"
                          checked={mode === "fixed"}
                          onChange={() => setMode("fixed")}
                        />
                        Monto fijo (USD)
                      </label>
                    </div>
                  </fieldset>

                  <label className="block text-base text-grafito">
                    {mode === "percent" ? "Porcentaje" : "Monto (USD)"}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={mode === "percent" ? "10 = +10% · -5 = -5%" : "5000 · -3000"}
                      className="mt-1 block h-10 w-full rounded-md border border-gris-300 bg-blanco px-2 text-right font-mono text-base tabular-nums"
                    />
                  </label>

                  {previewMut.isError ? (
                    <p role="alert" className="text-sm text-vendido">
                      No pudimos calcular la previsualización. Reintentá.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-base text-grafito">
                Vas a cambiar el precio de{" "}
                {preview.rows.length === 1
                  ? "1 unidad"
                  : `${preview.rows.length} unidades`}
                . Revisá el detalle (viejo → nuevo) antes de confirmar. Es una
                operación de dinero: no se puede deshacer.
              </p>

              {preview.errors.length > 0 ? (
                <div role="alert" className="rounded-md border border-vendido/40 p-3">
                  <p className="text-sm text-vendido">
                    {preview.errors.length}{" "}
                    {preview.errors.length === 1 ? "unidad" : "unidades"} no se
                    pueden actualizar:
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-vendido">
                    {preview.errors.map((e) => (
                      <li key={e.identificador}>
                        {e.identificador}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gris-500">
                    <th className="py-1 font-normal">Unidad</th>
                    <th className="py-1 text-right font-normal">Viejo</th>
                    <th className="py-1 text-right font-normal">Nuevo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.unitId} className="border-t border-gris-100">
                      <td className="py-1 text-grafito">{r.identificador}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-gris-500 line-through">
                        {r.old === null ? "—" : formatUsd(r.old)}
                      </td>
                      <td className="py-1 text-right font-mono tabular-nums text-grafito">
                        {formatUsd(r.new)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {applyMut.isError ? (
                <p role="alert" className="text-sm text-vendido">
                  {applyError ??
                    "No se aplicó ningún cambio. Si una fila falla, no se aplica nada."}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer (pinned) */}
        <div className="flex justify-end gap-3 border-t border-gris-100 px-6 py-4">
          {applied !== null ? (
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo"
            >
              Cerrar
            </button>
          ) : preview === null ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={runPreview}
                disabled={!canPreview || previewMut.isPending}
                className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
              >
                {previewMut.isPending ? "Calculando…" : "Previsualizar cambios"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={applyMut.isPending}
                className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmApply}
                disabled={
                  applyMut.isPending ||
                  preview.rows.length === 0 ||
                  preview.errors.length > 0
                }
                className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
              >
                {applyMut.isPending ? "Aplicando…" : "Confirmar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
