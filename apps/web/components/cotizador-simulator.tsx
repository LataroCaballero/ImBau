"use client";

// The cotizador simulator island (UI-01..UI-06 / WA-01 / D-05/D-06/D-09) — the demo-critical client
// surface. It composes the tested leaves from Plan 04 (QuoteCards, PlanSlider, buildWhatsappUrl,
// plan-snap) and the anon reads from Plan 03 through the dual-splitLink client from Plan 02.
//
// LOAD-BEARING behaviours:
//  - Live recompute (D-05, RESEARCH Pattern 3): any change of {unitId, planId, modalidad} fires a
//    DEBOUNCED `quotes.compute` (~200ms). Two computes run per change (contado + financiado) to feed
//    QuoteCards + compareQuotes. A monotonic `seqRef` guards onSuccess so a late response from a stale
//    selection can never overwrite a newer one (Pitfall 2 / T-06-05-RACE). `compute` is read through a
//    ref so the effect deps stay the reactive inputs only (the mutation object churns every render).
//  - 429 tolerance (Pitfall 4 / T-06-05-DOS): a TRPCClientError with data.httpStatus === 429 maps to a
//    soft es-AR message + an automatic backoff-retry — never a raw stack. Engine-domain failures read
//    data.quoteErrorCode and surface a friendly message.
//  - Persist ONLY on the CTA (D-06 / T-06-05-WRITEAMP): `quotes.create` is called EXACTLY ONCE, inside
//    the WhatsApp CTA handler — navigation, picker selection and recompute call `compute` only. On
//    success it builds the wa.me link via buildWhatsappUrl (Plan 04) whose deepLinkUrl is this exact
//    `?u&plan` URL (D-03) and navigates. The CTA is NOT rendered when the project has no number (D-02).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@imbau/api";
import type { ContadoResult, FinanciadoResult } from "@imbau/quoting";
import { useTRPC } from "../lib/trpc-client";
import { buildWhatsappUrl } from "../lib/whatsapp";
import { sortPlans } from "../lib/plan-snap";
import { Picker } from "./picker";
import { PlanSlider } from "./plan-slider";
import { QuoteCards } from "./quote-cards";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Project = RouterOutputs["picker"]["getPublishedProject"][number];
type Floor = RouterOutputs["picker"]["listFloors"][number];
type Plan = RouterOutputs["picker"]["listPlans"][number];

export type CotizadorSimulatorProps = {
  /** The published project (id, nombre, whatsapp) resolved server-side via the anon picker caller. */
  project: Project;
  /** The project's floors (passed to the Picker). */
  floors: Floor[];
  /** The project's payment plans (drive the PlanSlider + default plan). */
  plans: Plan[];
};

// Debounce window for the live recompute. 200ms sits inside the RESEARCH 150-250ms band: long enough
// that a fast slider drag collapses into a single compute pair, short enough to feel live.
const DEBOUNCE_MS = 200;
// Backoff before auto-retrying after a soft 429 from the edge rate limiter.
const RETRY_MS = 1500;

type Modalidad = "contado" | "financiado";
type ComputePair = { contado: ContadoResult; financiado: FinanciadoResult };

/** Extract the tRPC error envelope fields we branch on (httpStatus for the 429 soft-path). */
function readTrpcError(err: unknown): {
  httpStatus?: number;
  quoteErrorCode?: string;
} {
  if (err instanceof TRPCClientError) {
    const data = err.data as
      | { httpStatus?: number; quoteErrorCode?: string }
      | null
      | undefined;
    return { httpStatus: data?.httpStatus, quoteErrorCode: data?.quoteErrorCode };
  }
  return {};
}

export function CotizadorSimulator({
  project,
  floors,
  plans,
}: CotizadorSimulatorProps): React.JSX.Element {
  const trpc = useTRPC();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaultPlanId = sortPlans(plans)[0]?.id ?? null;

  // Selection state. `?u`/`?plan` seed the initial deep-link state (Pitfall 6 — read under Suspense).
  const [unitId, setUnitId] = useState<string | null>(() => searchParams.get("u"));
  const [unitIdentificador, setUnitIdentificador] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(
    () => searchParams.get("plan") ?? defaultPlanId,
  );
  const [modalidad, setModalidad] = useState<Modalidad>("financiado");

  const [result, setResult] = useState<ComputePair | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [softError, setSoftError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const compute = useMutation(trpc.quotes.compute.mutationOptions());
  const create = useMutation(trpc.quotes.create.mutationOptions());

  // The mutation object identity churns every render, so we reach it through a ref to keep the
  // recompute effect's deps limited to the reactive selection inputs (avoids an infinite re-fire).
  const computeRef = useRef(compute);
  computeRef.current = compute;

  // Monotonic sequence guard: only the most recent compute pair may write `result` (Pattern 3).
  const seqRef = useRef(0);

  // Live, race-safe, debounced recompute. Runs TWO computes (contado + financiado) so QuoteCards and
  // compareQuotes always have both arms. `create` is deliberately NOT called here (D-06).
  useEffect(() => {
    if (!unitId || !planId) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      const seq = ++seqRef.current;
      setIsComputing(true);
      setSoftError(null);
      Promise.all([
        computeRef.current.mutateAsync({
          projectId: project.id,
          unitId,
          paymentPlanId: planId,
          modalidad: "contado",
        }),
        computeRef.current.mutateAsync({
          projectId: project.id,
          unitId,
          paymentPlanId: planId,
          modalidad: "financiado",
        }),
      ])
        .then(([contado, financiado]) => {
          // Drop a stale response: a newer selection already bumped the sequence.
          if (cancelled || seq !== seqRef.current) return;
          setResult({
            contado: contado as ContadoResult,
            financiado: financiado as FinanciadoResult,
          });
          setIsComputing(false);
        })
        .catch((err: unknown) => {
          if (cancelled || seq !== seqRef.current) return;
          setIsComputing(false);
          const { httpStatus, quoteErrorCode } = readTrpcError(err);
          if (httpStatus === 429) {
            // Soft-throttle: tell the buyer we are busy and auto-retry after a short backoff.
            setSoftError("Estamos procesando muchas consultas. Reintentando…");
            window.setTimeout(() => {
              if (!cancelled) setRetryTick((t) => t + 1);
            }, RETRY_MS);
          } else if (quoteErrorCode) {
            setSoftError(
              "No pudimos calcular esta cotización. Probá con otra unidad o plan.",
            );
          } else {
            setSoftError("Ocurrió un problema al cotizar. Reintentá en unos segundos.");
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [unitId, planId, modalidad, project.id, retryTick]);

  // Keep the URL a shareable deep-link (?u&plan) in sync with the selection (D-03 — the same URL is
  // embedded in the WhatsApp message). Replace (not push) so the back button is not spammed.
  useEffect(() => {
    if (!unitId || !planId) return;
    const qs = new URLSearchParams({ u: unitId, plan: planId });
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
  }, [unitId, planId, pathname, router]);

  const handlePickUnit = useCallback(
    (pickedUnitId: string, _floorId: string, identificador: string) => {
      setUnitId(pickedUnitId);
      setUnitIdentificador(identificador);
      setPlanId((current) => current ?? defaultPlanId);
    },
    [defaultPlanId],
  );

  // The ONLY place `quotes.create` is ever called (D-06). Persists once, then opens wa.me.
  const onWhatsapp = useCallback(async () => {
    if (!unitId || !planId) return;
    try {
      const created = await create.mutateAsync({
        projectId: project.id,
        unitId,
        paymentPlanId: planId,
        modalidad,
      });
      const deepLinkUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}${pathname}?u=${unitId}&plan=${planId}`
          : "";
      const url = buildWhatsappUrl({
        whatsapp: project.whatsapp,
        unitIdentificador: unitIdentificador ?? "seleccionada",
        projectNombre: project.nombre,
        result: created.result,
        deepLinkUrl,
      });
      // buildWhatsappUrl returns null when the number is absent/empty (D-02) — the CTA is not even
      // rendered in that case, but this guard keeps the navigation total.
      if (url) window.location.href = url;
    } catch (err: unknown) {
      const { httpStatus } = readTrpcError(err);
      setSoftError(
        httpStatus === 429
          ? "Estamos procesando muchas consultas. Probá de nuevo en unos segundos."
          : "No pudimos abrir WhatsApp. Reintentá en unos segundos.",
      );
    }
  }, [unitId, planId, modalidad, project, unitIdentificador, pathname, create]);

  // No unit yet → show the piso→unidad picker (D-08).
  if (!unitId) {
    return <Picker floors={floors} onPickUnit={handlePickUnit} />;
  }

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  // The CTA is only shown when the project has a usable WhatsApp number (D-02 — no dead button).
  const whatsappDigits = (project.whatsapp ?? "").replace(/\D/g, "");
  const showCta = whatsappDigits !== "";

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => {
          setUnitId(null);
          setUnitIdentificador(null);
          setResult(null);
        }}
        className="self-start text-sm text-cobre hover:underline"
      >
        ← Cambiar unidad
      </button>

      {unitIdentificador ? (
        <p className="text-sm text-hormigon/70">
          Unidad <span className="font-mono text-hormigon">{unitIdentificador}</span> ·{" "}
          {project.nombre}
        </p>
      ) : null}

      <PlanSlider plans={plans} planId={planId ?? ""} onSelect={setPlanId} />

      {/* Modalidad toggle — changing it re-fires the debounced compute (both arms recomputed). */}
      <div className="inline-flex self-start rounded-lg border border-hormigon/10 p-1">
        {(["financiado", "contado"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModalidad(m)}
            aria-pressed={modalidad === m}
            className={`rounded-md px-3 py-1 text-sm ${
              modalidad === m
                ? "bg-cobre text-grafito"
                : "text-hormigon/70 hover:text-hormigon"
            }`}
          >
            {m === "financiado" ? "Financiado" : "Contado"}
          </button>
        ))}
      </div>

      {softError ? (
        <p
          role="status"
          className="rounded-lg bg-reservado/10 px-4 py-3 text-sm text-reservado"
        >
          {softError}
        </p>
      ) : null}

      {result && selectedPlan ? (
        <QuoteCards
          contado={result.contado}
          financiado={result.financiado}
          anticipoPct={selectedPlan.anticipoPct}
          notasLegales={selectedPlan.notasLegales}
        />
      ) : isComputing ? (
        <p className="text-sm text-hormigon/70">Calculando cotización…</p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        {showCta ? (
          <button
            type="button"
            onClick={() => void onWhatsapp()}
            disabled={!result || create.isPending}
            className="rounded-lg bg-disponible px-5 py-3 font-medium text-grafito disabled:opacity-50"
          >
            {create.isPending ? "Abriendo WhatsApp…" : "Consultar por WhatsApp"}
          </button>
        ) : null}
        {/* PDF wiring is fase 7 (D-12): render the placeholder, disabled, no handler. */}
        <button
          type="button"
          disabled
          className="rounded-lg border border-hormigon/20 px-5 py-3 font-medium text-hormigon/50"
        >
          Descargar PDF · Próximamente
        </button>
      </div>
    </div>
  );
}
