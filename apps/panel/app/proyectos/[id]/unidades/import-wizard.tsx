"use client";

// Import wizard island (GRID-04/05, D-06/D-07/D-08) — the 4-step Excel import modal. The critical
// surface: all money mutations are irreversible + all-or-nothing. Step 1 uploads a workbook (read to
// base64) and calls units.dryRunImport (server re-parses + classifies against LIVE rows — the client
// NEVER trusts its own validation). Step 2 shows the validation report; if errores > 0, "Aplicar
// cambios" stays DISABLED with the blocked-hint copy. Step 3 shows the field-by-field viejo → nuevo
// diff (only when 100% valid). Step 4 applies via units.importExcel (one all-or-nothing withTenant
// tx: one bad row → zero writes). Feedback is inline per surface (planner assumption — no global
// toast). es-AR voseo copy verbatim from the Copywriting Contract.
import { useRef, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@imbau/api";
import { formatUsd } from "@imbau/quoting";
import { useTRPC } from "../../../../lib/trpc-client";

type DryRunResult = inferRouterOutputs<AppRouter>["units"]["dryRunImport"];
type ClassifiedRow = DryRunResult["rows"][number];
type FieldDiff = ClassifiedRow["changes"][number];

// Read an uploaded file to base64 (strip the `data:...;base64,` prefix) — the shape dryRunImport /
// importExcel expect. The server bounds + re-parses the payload defensively.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read error"));
    reader.readAsDataURL(file);
  });
}

function fmtDiffValue(field: FieldDiff["field"], v: number | string | null): string {
  if (v === null) return "—";
  if (field === "estado") return String(v);
  return typeof v === "number" ? formatUsd(v) : String(v);
}

export function ImportWizard({
  projectId,
  onClose,
  onApplied,
}: {
  projectId: string;
  onClose: () => void;
  onApplied: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const dryRunMut = useMutation(trpc.units.dryRunImport.mutationOptions());
  const applyMut = useMutation(trpc.units.importExcel.mutationOptions());

  const [report, setReport] = useState<DryRunResult | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [dragover, setDragover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File): Promise<void> {
    setReport(null);
    const base64 = await fileToBase64(file);
    dryRunMut.mutate(
      { projectId, file: base64 },
      { onSuccess: (data) => setReport(data) },
    );
  }

  function confirmApply(): void {
    const input = fileInputRef.current?.files?.[0];
    if (!input) return;
    void fileToBase64(input).then((base64) => {
      applyMut.mutate(
        { projectId, file: base64 },
        {
          onSuccess: (data) => {
            setApplied(data.applied);
            onApplied();
          },
        },
      );
    });
  }

  const nuevas = report ? report.rows.filter((r) => r.rowClass === "nueva") : [];
  const conCambios = report
    ? report.rows.filter((r) => r.rowClass === "con cambios")
    : [];
  const hasErrors = report ? report.errors.length > 0 : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafito/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-blanco shadow-card">
        {/* Header */}
        <div className="border-b border-gris-100 px-6 py-4">
          <h2 className="text-xl text-grafito">Importar Excel</h2>
          {report ? (
            <p className="mt-1 font-mono text-sm tabular-nums text-gris-700">
              {report.summary.nuevas} nuevas · {report.summary.conCambios} con
              cambios · {report.summary.sinCambios} sin cambios ·{" "}
              {report.summary.conErrores} con errores
            </p>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {applied !== null ? (
            <p role="status" className="text-base text-grafito">
              Listo. Se aplicaron los cambios a {applied}{" "}
              {applied === 1 ? "unidad" : "unidades"}. La web pública ya está
              actualizada.
            </p>
          ) : report === null ? (
            // --- Step 1: Upload ---
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragover(true);
                }}
                onDragLeave={() => setDragover(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragover(false);
                  const f = e.dataTransfer.files[0];
                  if (f) void handleFile(f);
                }}
                className={`flex h-40 flex-col items-center justify-center rounded-md border-2 border-dashed text-center ${
                  dragover ? "border-cobre bg-cobre/5" : "border-gris-300"
                }`}
              >
                {dryRunMut.isPending ? (
                  <p className="text-base text-gris-500">Analizando archivo…</p>
                ) : (
                  <>
                    <p className="text-base text-gris-500">
                      Arrastrá el Excel acá o
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2 h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
                    >
                      Elegí un archivo
                    </button>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </div>
              {dryRunMut.isError ? (
                <p role="alert" className="mt-3 text-sm text-vendido">
                  No pudimos leer el archivo. Subí el Excel exportado desde acá,
                  sin cambiar las columnas.
                </p>
              ) : null}
            </div>
          ) : hasErrors ? (
            // --- Step 2: Validation report (errors) ---
            <div className="space-y-3">
              <div role="alert">
                <p className="text-sm text-vendido">
                  El archivo tiene filas con errores:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-vendido">
                  {report.errors.map((e) => (
                    <li key={e.rowNumber}>
                      Fila {e.rowNumber}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm text-gris-500">
                Corregí las {report.errors.length}{" "}
                {report.errors.length === 1 ? "fila con errores" : "filas con errores"}{" "}
                en el Excel y volvé a subirlo. No se puede aplicar un archivo con
                errores.
              </p>
            </div>
          ) : (
            // --- Step 3: Diff preview (100% valid) ---
            <div className="space-y-5">
              {nuevas.length > 0 ? (
                <section>
                  <h3 className="text-base text-grafito">Nuevas ({nuevas.length})</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {nuevas.map((r) => (
                      <li key={r.rowNumber} className="flex flex-wrap gap-x-3">
                        <span
                          className="max-w-40 truncate text-grafito"
                          title={r.identificador}
                        >
                          {r.identificador}
                        </span>
                        {r.changes.map((c, i) => (
                          <span key={i} className="font-mono tabular-nums text-gris-700">
                            {c.field}: {fmtDiffValue(c.field, c.new)}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {conCambios.length > 0 ? (
                <section>
                  <h3 className="text-base text-grafito">
                    Con cambios ({conCambios.length})
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {conCambios.map((r) => (
                      <li key={r.rowNumber}>
                        <span
                          className="max-w-40 truncate text-grafito"
                          title={r.identificador}
                        >
                          {r.identificador}
                        </span>
                        <ul className="ml-4 mt-1 space-y-0.5">
                          {r.changes.map((c, i) => (
                            <li key={i} className="flex flex-wrap items-center gap-2">
                              <span className="text-gris-500">{c.field}:</span>
                              <span className="font-mono tabular-nums text-gris-500 line-through">
                                {fmtDiffValue(c.field, c.old)}
                              </span>
                              <span className="text-gris-500">→</span>
                              <span className="font-mono tabular-nums text-grafito">
                                {fmtDiffValue(c.field, c.new)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <p className="text-sm text-gris-500">
                Sin cambios: {report.summary.sinCambios}
              </p>

              <p className="text-base text-grafito">
                Se van a aplicar los cambios a{" "}
                {nuevas.length + conCambios.length}{" "}
                {nuevas.length + conCambios.length === 1 ? "unidad" : "unidades"} en
                una sola operación. Si una fila falla, no se aplica nada.
              </p>

              {applyMut.isError ? (
                <p role="alert" className="text-sm text-vendido">
                  No se aplicó ningún cambio. Si una fila falla, no se aplica nada.
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
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={applyMut.isPending}
                className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              {report !== null ? (
                <button
                  type="button"
                  onClick={confirmApply}
                  disabled={hasErrors || applyMut.isPending}
                  className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
                >
                  {applyMut.isPending ? "Aplicando…" : "Aplicar cambios"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
