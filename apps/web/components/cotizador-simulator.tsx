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
import { useMutation, useQuery } from "@tanstack/react-query";
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
// PDF polling cadence (D-03): ~2s per poll keeps the buyer inside the nginx zone=quotes
// throttle (10r/s burst 20) with room to spare, since pdfStatus rides the dedicated
// quotes.* link (isQuotesOp) → path /api/trpc/quotes.pdfStatus.
const PDF_POLL_MS = 2000;
// Soft-fail deadline (D-10): stop polling after ~40s (inside the 30-45s band) and show the
// es-AR retry message. The PDF is NEVER the critical path — WhatsApp stays live throughout.
const PDF_TIMEOUT_MS = 40000;

type Modalidad = "contado" | "financiado";
type ComputePair = { contado: ContadoResult; financiado: FinanciadoResult };
// The emitted-quote envelope shared (D-01) by the WhatsApp CTA and the PDF button: one
// `quotes.create` emission is retained and reused by whichever trigger fires second.
type CreatedQuote = RouterOutputs["quotes"]["create"];

// Force a browser download of the presigned R2 URL (D-03). The presigned GET already carries
// `Content-Disposition: attachment` (07-03), so the file downloads even when a cross-origin
// `download` attribute is ignored; the visible fallback link covers mobile that blocks the
// programmatic click entirely.
function triggerDownload(url: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = "cotizacion.pdf";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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

  // PDF flow state (D-03/D-10). `pdfQuoteId` enables the pdfStatus poll; `pdfGenerating`
  // drives the "Generando PDF…" button + soft-fail deadline; `pdfUrl` is the ready presigned
  // GET, kept for the visible fallback download link (mobile that blocks the auto-click).
  const [pdfQuoteId, setPdfQuoteId] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // The single emitted quote retained across the WhatsApp + PDF triggers (D-01). Held in a ref
  // (not state) so both async handlers read the freshest value with no stale-closure race; the
  // selection-change effect clears it so the next trigger emits a fresh quote (its own PDF).
  const retainedQuoteRef = useRef<CreatedQuote | null>(null);
  // Soft-fail timer + a one-shot download guard so a ready poll downloads exactly once.
  const pdfTimeoutRef = useRef<number | null>(null);
  const didDownloadRef = useRef(false);

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

  // Clear the pending soft-fail deadline (on ready, on a new trigger, on selection change, unmount).
  const clearPdfTimeout = useCallback(() => {
    if (pdfTimeoutRef.current !== null) {
      window.clearTimeout(pdfTimeoutRef.current);
      pdfTimeoutRef.current = null;
    }
  }, []);

  // Emit-or-reuse the shared quote (D-01). Returns the retained emission if one exists for the
  // current selection, otherwise calls `quotes.create` ONCE and retains it. Both the WhatsApp CTA
  // and the PDF button funnel through here so they never double-emit. Returns null on a missing
  // selection (the callers already guard, this keeps types honest).
  const ensureQuote = useCallback(async (): Promise<CreatedQuote | null> => {
    if (!unitId || !planId) return null;
    const retained = retainedQuoteRef.current;
    if (retained) return retained;
    const created = await create.mutateAsync({
      projectId: project.id,
      unitId,
      paymentPlanId: planId,
      modalidad,
    });
    retainedQuoteRef.current = created;
    return created;
  }, [unitId, planId, modalidad, project.id, create]);

  // Poll pdfStatus (D-03) while generating. Rides the dedicated quotes.* link (isQuotesOp) → path
  // /api/trpc/quotes.pdfStatus, so it stays inside the nginx zone=quotes throttle (T-07-04). We stop
  // polling on {ready:true} (refetchInterval → false) or when the deadline effect flips pdfGenerating
  // off. `retry:false` means a transient error (e.g. a 429) just waits for the next interval tick —
  // never a raw error to the buyer; the deadline is the only failure surface (D-10).
  const pdfStatusQuery = useQuery(
    trpc.quotes.pdfStatus.queryOptions(
      { projectId: project.id, quoteId: pdfQuoteId ?? "" },
      {
        enabled: pdfGenerating && pdfQuoteId !== null,
        refetchInterval: (query) =>
          query.state.data?.ready ? false : PDF_POLL_MS,
        retry: false,
        gcTime: 0,
      },
    ),
  );

  // When the poll reports ready, auto-download once and reveal the fallback link (D-03).
  useEffect(() => {
    if (!pdfGenerating) return;
    const data = pdfStatusQuery.data;
    if (!data || !data.ready) return;
    clearPdfTimeout();
    setPdfUrl(data.url);
    setPdfGenerating(false);
    if (!didDownloadRef.current) {
      didDownloadRef.current = true;
      triggerDownload(data.url);
    }
  }, [pdfStatusQuery.data, pdfGenerating, clearPdfTimeout]);

  // Drop the soft-fail timer if the island unmounts mid-generation.
  useEffect(() => clearPdfTimeout, [clearPdfTimeout]);

  // A selection change ({unitId, planId, modalidad}) invalidates the retained quote (D-01) and
  // cancels any in-flight PDF generation so the next trigger emits a fresh quote with its own PDF.
  useEffect(() => {
    retainedQuoteRef.current = null;
    didDownloadRef.current = false;
    clearPdfTimeout();
    setPdfGenerating(false);
    setPdfQuoteId(null);
    setPdfUrl(null);
  }, [unitId, planId, modalidad, clearPdfTimeout]);

  // Begin polling for a freshly-ensured quoteId and arm the soft-fail deadline (D-10).
  const startPolling = useCallback(
    (quoteId: string) => {
      didDownloadRef.current = false;
      setSoftError(null);
      setPdfUrl(null);
      setPdfQuoteId(quoteId);
      setPdfGenerating(true);
      clearPdfTimeout();
      pdfTimeoutRef.current = window.setTimeout(() => {
        pdfTimeoutRef.current = null;
        setPdfGenerating(false);
        setSoftError("No pudimos generar el PDF, probá de nuevo en un rato.");
      }, PDF_TIMEOUT_MS);
    },
    [clearPdfTimeout],
  );

  // PDF button (D-03): ensure the shared quote, then poll → auto-download. Degrades softly (D-10);
  // the WhatsApp CTA stays live no matter what happens here — the PDF is never the critical path.
  const onDownloadPdf = useCallback(async () => {
    if (!unitId || !planId) return;
    setSoftError(null);
    try {
      const created = await ensureQuote();
      if (!created) return;
      startPolling(created.quoteId);
    } catch (err: unknown) {
      const { httpStatus } = readTrpcError(err);
      setSoftError(
        httpStatus === 429
          ? "Estamos procesando muchas consultas. Probá de nuevo en unos segundos."
          : "No pudimos generar el PDF, probá de nuevo en un rato.",
      );
    }
  }, [unitId, planId, ensureQuote, startPolling]);

  // The WhatsApp CTA reuses the shared emission (D-01/D-06): ensureQuote persists at most once, then
  // opens wa.me with the same quote the PDF button would download.
  const onWhatsapp = useCallback(async () => {
    if (!unitId || !planId) return;
    try {
      const created = await ensureQuote();
      if (!created) return;
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
  }, [unitId, planId, ensureQuote, project, unitIdentificador, pathname]);

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
        {/* PDF flow (fase 7, PDF-01): emit/reuse the quote → poll pdfStatus → auto-download (D-03).
            Degrades softly (D-10); the fallback link appears once the presigned URL is ready. */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void onDownloadPdf()}
            disabled={!result || pdfGenerating || create.isPending}
            className="rounded-lg border border-hormigon/20 px-5 py-3 font-medium text-hormigon disabled:opacity-50"
          >
            {pdfGenerating ? "Generando PDF…" : "Descargar PDF"}
          </button>
          {pdfUrl ? (
            <a
              href={pdfUrl}
              download="cotizacion.pdf"
              className="text-sm text-cobre hover:underline"
            >
              ¿No se descargó? Tocá acá
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
