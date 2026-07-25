"use client";

// Alta-manual lead form (LEADS-04/D-01/D-06) — the `Registrar lead` modal. The developer registers a
// lead that arrived off-channel (WhatsApp/teléfono) and picks its origen. On submit it calls
// leads.create, which inserts the lead + enqueues the idempotent notification email as a post-commit
// side-effect (the UI NEVER blocks on the send). The success copy asserts the queued email; on
// success the board query is invalidated so the new card appears in `Nuevo`. Empty-required
// validation + inline role="status"/role="alert" feedback (no global toast). The focused inputs use
// the cobre focus ring (UI-SPEC accent reservation). Copy verbatim from the Copywriting Contract.
import { useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "../../../../lib/trpc-client";

// Origen options (UI-SPEC alta-manual fields). The stored value is the tipo string; a manual lead
// has no broker/unidad/cotización pointer to join, so its board chip resolves to `Directo`.
const ORIGEN_OPTIONS = [
  { value: "directo", label: "Directo" },
  { value: "broker", label: "Broker" },
  { value: "unidad", label: "Unidad" },
  { value: "cotizacion", label: "Cotización" },
] as const;

export function AltaLeadForm({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const trpc = useTRPC();
  const create = useMutation(trpc.leads.create.mutationOptions());

  const [nombre, setNombre] = useState("");
  const [contacto, setContacto] = useState("");
  const [origen, setOrigen] = useState<string>("directo");
  const [nombreError, setNombreError] = useState(false);
  const [contactoError, setContactoError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [done, setDone] = useState(false);

  function submit(): void {
    const nombreOk = nombre.trim() !== "";
    const contactoOk = contacto.trim() !== "";
    setNombreError(!nombreOk);
    setContactoError(!contactoOk);
    if (!nombreOk || !contactoOk) return;

    setSubmitError(false);
    create.mutate(
      {
        projectId,
        nombre: nombre.trim(),
        contacto: contacto.trim(),
        origen,
      },
      {
        onSuccess: () => {
          setDone(true);
          onCreated();
        },
        onError: () => setSubmitError(true),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafito/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-blanco shadow-card">
        <div className="border-b border-gris-100 px-6 py-4">
          <h2 className="text-xl text-grafito">Registrar lead</h2>
        </div>

        <div className="px-6 py-5">
          {done ? (
            <p role="status" className="text-base text-grafito">
              Listo. El lead quedó en Nuevo y avisamos por email.
            </p>
          ) : (
            <div className="space-y-4">
              <label className="block text-base text-grafito">
                Nombre
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value);
                    setNombreError(false);
                  }}
                  className="mt-1 block h-10 w-full rounded-md border border-gris-300 bg-blanco px-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre"
                />
                {nombreError ? (
                  <span role="alert" className="mt-1 block text-sm text-vendido">
                    Ingresá el nombre
                  </span>
                ) : null}
              </label>

              <label className="block text-base text-grafito">
                Contacto
                <input
                  type="text"
                  value={contacto}
                  placeholder="Teléfono o email"
                  onChange={(e) => {
                    setContacto(e.target.value);
                    setContactoError(false);
                  }}
                  className="mt-1 block h-10 w-full rounded-md border border-gris-300 bg-blanco px-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre"
                />
                {contactoError ? (
                  <span role="alert" className="mt-1 block text-sm text-vendido">
                    Ingresá un contacto (teléfono o email)
                  </span>
                ) : null}
              </label>

              <label className="block text-base text-grafito">
                Origen
                <select
                  value={origen}
                  onChange={(e) => setOrigen(e.target.value)}
                  className="mt-1 block h-10 w-full rounded-md border border-gris-300 bg-blanco px-2 text-base text-grafito focus:border-cobre focus:outline-none focus:ring-2 focus:ring-cobre"
                >
                  {ORIGEN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {submitError ? (
                <p role="alert" className="text-sm text-vendido">
                  No se pudo guardar. Reintentá.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gris-100 px-6 py-4">
          {done ? (
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
                disabled={create.isPending}
                className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={create.isPending}
                className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-60"
              >
                {create.isPending ? "Guardando…" : "Registrar lead"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
