"use client";

// Hotspot editor island (HSPOT-01/02/03, D-01..D-10) — the panel's hand-rolled SVG polygon editor.
//
// NO canvas / Konva / Fabric / PixiJS (CLAUDE.md product decision): the drawing surface is a plain
// `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">` overlaid exactly on a read-only render
// `<img>` (D-05), so screen↔viewBox maps square-normalized onto each axis (the LOCKED 12-01
// convention, D-09). Every pointer event is transformed via `getScreenCTM().inverse()` and the result
// is clamped+rounded to an INTEGER in [0,1000] — nothing is ever stored in pixels. No net-new runtime
// dependency: the ~few glyphs are inline SVG (T-12-SC).
//
// It consumes the Plan-02 `hotspots` router via useTRPC: getForProject (live polygon state, re-read so
// each save/clear can invalidate), setFloorPolygon/clearFloorPolygon/setUnitPolygon/clearUnitPolygon.
// Client-side pre-validation runs through the SAME pure `@imbau/api/geometry` module the server
// re-validates with (never trust a client isValid flag — the server requireRole + re-validate is the
// authority, D-08). `canWrite` gates draw affordances COSMETICALLY only (a viewer sees a read-only
// editor). Types are derived from inferRouterOutputs so the island never drifts from the router.
//
// Design contract: 12-UI-SPEC. es-AR voseo copy lifted verbatim. Saved polygons are Blueprint; the
// selected polygon + its active vertices are cobre (with a contrasting halo for the warm-adjacency
// mitigation over photographic renders); invalid geometry is Vendido red. Figures (coords, counts) are
// JetBrains Mono tabular-nums. Inline role=status/alert feedback — no global toast (Phase 10 mold).
import {
  useState,
  useRef,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@imbau/api";
import {
  parsePolygon,
  serializePolygon,
  validatePolygon,
  polygonErrorMessage,
  type Point,
} from "@imbau/api/geometry";
import { useTRPC } from "../../../../lib/trpc-client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type HotspotsData = RouterOutputs["hotspots"]["getForProject"];
type FloorRow = HotspotsData["floors"][number];
type UnitRow = HotspotsData["units"][number];

// exterior = drawing floor polygons over the building render; planta = drawing unit polygons over a
// drilled-in floor's plan (D-03). The active editing "phase": drawing (open polyline, still placing
// vertices) → closed (a full polygon, editable + validatable + saveable).
type Mode = "exterior" | "planta";
type Phase = "drawing" | "closed";
type Feedback = { kind: "status" | "alert"; msg: string };

// --- pure helpers (no state) ---------------------------------------------------------------------

// Map a screen (client) coordinate to intrinsic viewBox space via the SVG's own CTM, then clamp+round
// to an integer in [0,1000] (D-09). Read the CTM inside the handler, never from getBoundingClientRect.
function screenToViewBox(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  const clamp = (n: number): number => Math.max(0, Math.min(1000, Math.round(n)));
  return { x: clamp(local.x), y: clamp(local.y) };
}

// Parse a stored polygon string for RENDERING only — a malformed stored string (should never happen
// after the Plan-02 server re-serialize, but defense-in-depth) is treated as "no polygon" rather than
// crashing the editor.
function safeParse(svg: string | null): Point[] | null {
  if (svg === null || svg.trim() === "") return null;
  try {
    return parsePolygon(svg);
  } catch {
    return null;
  }
}

function floorLabel(floor: FloorRow): string {
  const nombre = floor.nombre?.trim();
  return nombre ? nombre : `Piso ${floor.numero}`;
}

function unitLabel(unit: UnitRow): string {
  return `Unidad ${unit.identificador}`;
}

function pointsToAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

// --- island --------------------------------------------------------------------------------------

export function HotspotsEditor({
  projectId,
  canWrite,
  exteriorRenderUrl,
  floorRenderUrls,
}: {
  projectId: string;
  canWrite: boolean;
  exteriorRenderUrl: string | null;
  floorRenderUrls: Record<string, string | null>;
}): ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const dataQuery = useQuery(trpc.hotspots.getForProject.queryOptions({ projectId }));

  const invalidate = (): void => {
    void queryClient.invalidateQueries({
      queryKey: trpc.hotspots.getForProject.queryKey({ projectId }),
    });
  };

  const setFloor = useMutation(trpc.hotspots.setFloorPolygon.mutationOptions());
  const clearFloor = useMutation(trpc.hotspots.clearFloorPolygon.mutationOptions());
  const setUnit = useMutation(trpc.hotspots.setUnitPolygon.mutationOptions());
  const clearUnit = useMutation(trpc.hotspots.clearUnitPolygon.mutationOptions());

  const [mode, setMode] = useState<Mode>("exterior");
  const [drilledFloorId, setDrilledFloorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [phase, setPhase] = useState<Phase>("drawing");
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);

  // --- derived data (from the live query) ---
  const floors = [...(dataQuery.data?.floors ?? [])].sort((a, b) => a.numero - b.numero);
  const allUnits = dataQuery.data?.units ?? [];
  const drilledFloor = drilledFloorId
    ? floors.find((f) => f.id === drilledFloorId) ?? null
    : null;
  const unitsOfFloor = drilledFloorId
    ? [...allUnits.filter((u) => u.floorId === drilledFloorId)].sort((a, b) =>
        a.identificador.localeCompare(b.identificador, "es"),
      )
    : [];

  // The current selected target's saved polygon string + label, resolved per mode.
  const selectedFloor =
    mode === "exterior" && selectedId ? floors.find((f) => f.id === selectedId) ?? null : null;
  const selectedUnit =
    mode === "planta" && selectedId ? unitsOfFloor.find((u) => u.id === selectedId) ?? null : null;
  const selectedSavedSvg = selectedFloor?.poligonoSvg ?? selectedUnit?.poligonoSvg ?? null;
  const targetLabel = selectedFloor
    ? floorLabel(selectedFloor)
    : selectedUnit
      ? unitLabel(selectedUnit)
      : "";

  // The background render for the active mode. null → the D-06 empty-state (never draw over void).
  const activeRenderUrl =
    mode === "exterior" ? exteriorRenderUrl : drilledFloorId ? floorRenderUrls[drilledFloorId] ?? null : null;

  // Client-side pre-validation (D-08) — only meaningful for a closed polygon. The button + banner
  // derive from this; the server re-validates regardless.
  const validation = phase === "closed" ? validatePolygon(points) : null;
  const canSave = canWrite && phase === "closed" && validation?.ok === true && selectedId !== null;
  const saving = setFloor.isPending || setUnit.isPending;
  const deleting = clearFloor.isPending || clearUnit.isPending;

  // --- target selection / navigation ---

  function loadTarget(id: string, savedSvg: string | null): void {
    setSelectedId(id);
    setFeedback(null);
    setDraggingIndex(null);
    const parsed = safeParse(savedSvg);
    if (parsed) {
      setPoints(parsed);
      setPhase("closed");
    } else {
      setPoints([]);
      setPhase("drawing");
    }
  }

  function selectFloor(floor: FloorRow): void {
    loadTarget(floor.id, floor.poligonoSvg);
  }

  function selectUnit(unit: UnitRow): void {
    loadTarget(unit.id, unit.poligonoSvg);
  }

  function drillIntoFloor(floorId: string): void {
    setMode("planta");
    setDrilledFloorId(floorId);
    setSelectedId(null);
    setPoints([]);
    setPhase("drawing");
    setDraggingIndex(null);
    setFeedback(null);
  }

  function backToExterior(): void {
    setMode("exterior");
    setDrilledFloorId(null);
    setSelectedId(null);
    setPoints([]);
    setPhase("drawing");
    setDraggingIndex(null);
    setFeedback(null);
  }

  // --- drawing / editing pointer handlers ---

  function addVertex(e: ReactMouseEvent): void {
    if (!canWrite || phase !== "drawing" || selectedId === null) return;
    const svg = svgRef.current;
    if (!svg) return;
    const p = screenToViewBox(svg, e.clientX, e.clientY);
    setPoints((prev) => [...prev, p]);
  }

  function closeOnFirstVertex(e: ReactMouseEvent): void {
    e.stopPropagation();
    if (!canWrite || phase !== "drawing") return;
    if (points.length >= 3) setPhase("closed");
  }

  function closeOnDoubleClick(e: ReactMouseEvent): void {
    if (!canWrite || phase !== "drawing") return;
    e.preventDefault();
    // The two clicks of the double-click already appended two near-identical points; drop the last
    // so the closed polygon has no degenerate duplicate edge, then close if ≥3 remain.
    const trimmed = points.length >= 1 ? points.slice(0, -1) : points;
    if (trimmed.length >= 3) {
      setPoints(trimmed);
      setPhase("closed");
    }
  }

  function onVertexPointerDown(index: number) {
    return (e: ReactPointerEvent): void => {
      if (!canWrite || phase !== "closed") return;
      e.stopPropagation();
      svgRef.current?.setPointerCapture(e.pointerId);
      setDraggingIndex(index);
    };
  }

  function onSvgPointerMove(e: ReactPointerEvent): void {
    if (draggingIndex === null) return;
    const svg = svgRef.current;
    if (!svg) return;
    const p = screenToViewBox(svg, e.clientX, e.clientY);
    setPoints((prev) => prev.map((pt, i) => (i === draggingIndex ? p : pt)));
  }

  function onSvgPointerUp(e: ReactPointerEvent): void {
    if (draggingIndex === null) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    setDraggingIndex(null);
  }

  function deleteVertex(index: number) {
    return (e: ReactMouseEvent): void => {
      e.preventDefault();
      if (!canWrite || phase !== "closed") return;
      // Guarded: a polygon cannot drop below 3 vertices (D-01).
      setPoints((prev) => (prev.length > 3 ? prev.filter((_, i) => i !== index) : prev));
    };
  }

  // --- toolbar actions ---

  function discard(): void {
    // Abandon an in-progress drawing (D-01) OR revert an edit to the last saved geometry (Cancelar).
    const parsed = safeParse(selectedSavedSvg);
    if (parsed) {
      setPoints(parsed);
      setPhase("closed");
    } else {
      setPoints([]);
      setPhase("drawing");
    }
    setDraggingIndex(null);
    setFeedback(null);
  }

  function save(): void {
    if (!canSave || selectedId === null) return;
    const poligonoSvg = serializePolygon(points);
    const label = targetLabel;
    const onSuccess = (): void => {
      invalidate();
      setFeedback({ kind: "status", msg: `Listo. Guardaste el polígono de ${label}.` });
    };
    const onError = (): void => {
      // Geometry is preserved in state for retry (D-08).
      setFeedback({ kind: "alert", msg: "No se pudo guardar. Reintentá." });
    };
    if (mode === "exterior") {
      setFloor.mutate({ projectId, floorId: selectedId, poligonoSvg }, { onSuccess, onError });
    } else {
      setUnit.mutate({ projectId, unitId: selectedId, poligonoSvg }, { onSuccess, onError });
    }
  }

  function performDelete(): void {
    if (selectedId === null) return;
    const label = targetLabel;
    const onSuccess = (): void => {
      invalidate();
      setPoints([]);
      setPhase("drawing");
      setConfirmDelete(false);
      setFeedback({ kind: "status", msg: `Borraste el polígono de ${label}.` });
    };
    const onError = (): void => {
      setConfirmDelete(false);
      setFeedback({ kind: "alert", msg: "No se pudo guardar. Reintentá." });
    };
    if (mode === "exterior") {
      clearFloor.mutate({ projectId, floorId: selectedId }, { onSuccess, onError });
    } else {
      clearUnit.mutate({ projectId, unitId: selectedId }, { onSuccess, onError });
    }
  }

  // Saved polygons of OTHER items in the current mode (not the selected one) — Blueprint, clickable:
  // in exterior a click drills into the floor's planta (D-03); in planta a click selects the unit.
  const otherPolygons: { id: string; label: string; points: Point[] }[] = [];
  if (mode === "exterior") {
    for (const f of floors) {
      if (f.id === selectedId) continue;
      const pts = safeParse(f.poligonoSvg);
      if (pts) otherPolygons.push({ id: f.id, label: floorLabel(f), points: pts });
    }
  } else {
    for (const u of unitsOfFloor) {
      if (u.id === selectedId) continue;
      const pts = safeParse(u.poligonoSvg);
      if (pts) otherPolygons.push({ id: u.id, label: unitLabel(u), points: pts });
    }
  }

  const draggingPoint = draggingIndex !== null ? points[draggingIndex] : undefined;

  return (
    <div className="mt-6 flex gap-8">
      {/* ---- Selector rail (always visible safety net, D-04) ---- */}
      <SelectorRail
        mode={mode}
        loading={dataQuery.isLoading}
        floors={floors}
        units={unitsOfFloor}
        drilledFloor={drilledFloor}
        selectedId={selectedId}
        canWrite={canWrite}
        onSelectFloor={selectFloor}
        onSelectUnit={selectUnit}
        onDrillFloor={drillIntoFloor}
        onBack={backToExterior}
      />

      {/* ---- Canvas + toolbar ---- */}
      <div className="min-w-0 flex-1">
        {dataQuery.isLoading ? (
          <div
            className="aspect-video w-full animate-pulse rounded-md bg-gris-100"
            aria-busy="true"
            aria-label="Cargando el editor"
          />
        ) : dataQuery.isError ? (
          <div role="alert" className="rounded-md border border-vendido/40 bg-blanco p-6 text-grafito">
            <p className="text-base">No pudimos cargar el editor. Reintentá.</p>
            <button
              type="button"
              onClick={() => void dataQuery.refetch()}
              className="mt-4 h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
            >
              Reintentar
            </button>
          </div>
        ) : floors.length === 0 ? (
          <EmptyState
            heading="Este proyecto no tiene pisos cargados"
            body="Cargá los pisos del proyecto para empezar a dibujar hotspots."
          />
        ) : mode === "planta" && unitsOfFloor.length === 0 ? (
          <EmptyState
            heading="Este piso no tiene unidades cargadas"
            body={`Cargá las unidades de ${drilledFloor ? floorLabel(drilledFloor) : "este piso"} para dibujar sus hotspots.`}
          />
        ) : activeRenderUrl === null ? (
          mode === "exterior" ? (
            <EmptyState
              heading="Falta el render exterior de este proyecto"
              body="Cargá el render exterior del edificio para poder dibujar los polígonos de los pisos. La carga de renders se hace desde la administración de media."
            />
          ) : (
            <EmptyState
              heading="Falta la planta de este piso"
              body={`Cargá la planta de ${drilledFloor ? floorLabel(drilledFloor) : "este piso"} para poder dibujar los polígonos de sus unidades.`}
            />
          )
        ) : (
          <>
            {/* Target prompt (D-07) — before a target is chosen */}
            {selectedId === null ? (
              <p className="mb-3 text-base text-gris-500">
                {mode === "exterior"
                  ? "Elegí un piso de la lista para dibujar su polígono."
                  : "Elegí una unidad de la lista para dibujar su polígono."}
              </p>
            ) : (
              <p className="mb-3 text-base text-gris-500">
                {phase === "drawing"
                  ? "Hacé click para poner cada vértice. Cerrá el polígono clickeando el primer vértice o con doble click."
                  : "Arrastrá los vértices para ajustar. Clic derecho sobre un vértice para borrarlo."}
              </p>
            )}

            {/* The canvas: render <img> (read-only, D-05) + intrinsic viewBox SVG overlay.
                The wrapper shrink-wraps the img so the absolutely-positioned svg covers exactly the
                render's displayed box — a non-square render stays aligned (backstop). */}
            <div className="relative inline-block max-w-full rounded-md border border-gris-100 bg-blanco">
              {/* Plain <img>: the render is an external R2 asset shown read-only as a draw backdrop
                  (D-05); next/image's optimizer + layout math would fight the exact viewBox overlay. */}
              <img
                src={activeRenderUrl}
                alt={mode === "exterior" ? "Render exterior del edificio" : "Planta del piso"}
                className="block h-auto max-h-[70vh] w-auto max-w-full select-none"
                draggable={false}
              />
              <svg
                ref={svgRef}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                style={{ touchAction: "none", cursor: canWrite && phase === "drawing" && selectedId ? "crosshair" : "default" }}
                onDoubleClick={closeOnDoubleClick}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
              >
                {/* Drawing surface: transparent click-catcher, only active while placing vertices */}
                <rect
                  x={0}
                  y={0}
                  width={1000}
                  height={1000}
                  fill="transparent"
                  style={{
                    pointerEvents: canWrite && phase === "drawing" && selectedId ? "auto" : "none",
                  }}
                  onClick={addVertex}
                />

                {/* Other saved polygons (Blueprint) — drill (exterior) / select (planta) */}
                {otherPolygons.map((poly) => (
                  <polygon
                    key={poly.id}
                    points={pointsToAttr(poly.points)}
                    fill="rgba(76,125,240,0.12)"
                    stroke="#4C7DF0"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      mode === "exterior"
                        ? drillIntoFloor(poly.id)
                        : selectUnit(unitsOfFloor.find((u) => u.id === poly.id)!)
                    }
                  >
                    <title>{poly.label}</title>
                  </polygon>
                ))}

                {/* Active polygon — in-progress polyline (drawing) or editable polygon (closed) */}
                {selectedId !== null && phase === "drawing" && points.length > 0 ? (
                  <polyline
                    points={pointsToAttr(points)}
                    fill="none"
                    stroke="#D98A4F"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {selectedId !== null && phase === "closed" && points.length >= 3 ? (
                  <polygon
                    points={pointsToAttr(points)}
                    fill={validation?.ok ? "rgba(217,138,79,0.14)" : "rgba(214,84,84,0.14)"}
                    stroke={validation?.ok ? "#D98A4F" : "#D65454"}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}

                {/* Vertex handles (12px visual / 24px hit target). First vertex while drawing is the
                    green close-target. When closed + writable, handles are draggable + right-click
                    deletes. A viewer sees static dots. */}
                {selectedId !== null
                  ? points.map((p, i) => {
                      const isFirstDrawing = phase === "drawing" && i === 0;
                      const stroke = isFirstDrawing ? "#2FA26E" : "#D98A4F";
                      return (
                        <g key={`${i}-${p.x}-${p.y}`}>
                          {/* halo (contrast over photographic renders — warm-adjacency mitigation) */}
                          <circle cx={p.x} cy={p.y} r={7} fill="none" stroke="#FFFFFF" strokeWidth={4} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={6}
                            fill={isFirstDrawing ? "#2FA26E" : "#FFFFFF"}
                            stroke={stroke}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            style={{ pointerEvents: "none" }}
                          />
                          {/* invisible 24px hit target */}
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={12}
                            fill="transparent"
                            style={{
                              pointerEvents: canWrite ? "auto" : "none",
                              cursor: isFirstDrawing ? "pointer" : phase === "closed" ? "grab" : "default",
                            }}
                            onClick={isFirstDrawing ? closeOnFirstVertex : undefined}
                            onPointerDown={phase === "closed" ? onVertexPointerDown(i) : undefined}
                            onContextMenu={phase === "closed" ? deleteVertex(i) : undefined}
                          />
                        </g>
                      );
                    })
                  : null}
              </svg>
            </div>

            {/* Toolbar (D-08/D-10) */}
            {selectedId !== null ? (
              <div className="mt-4">
                <div className="flex h-12 flex-wrap items-center gap-3">
                  <span className="font-mono text-sm tabular-nums text-grafito">
                    {points.length} {points.length === 1 ? "vértice" : "vértices"}
                  </span>
                  {draggingPoint ? (
                    <span className="font-mono text-sm tabular-nums text-gris-500">
                      ({draggingPoint.x}, {draggingPoint.y})
                    </span>
                  ) : null}
                  {canWrite ? (
                    <>
                      <button
                        type="button"
                        onClick={save}
                        disabled={!canSave || saving}
                        className="h-10 rounded-md bg-cobre px-4 text-base text-grafito hover:bg-cobre-profundo disabled:opacity-50"
                      >
                        {saving ? "Guardando…" : "Guardar polígono"}
                      </button>
                      <button
                        type="button"
                        onClick={discard}
                        className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
                      >
                        {phase === "drawing" ? "Descartar" : "Cancelar"}
                      </button>
                      {safeParse(selectedSavedSvg) ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          disabled={deleting}
                          className="h-10 rounded-md border border-vendido px-4 text-base text-vendido hover:bg-vendido/10 disabled:opacity-50"
                        >
                          Borrar polígono
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-gris-500">Solo lectura</span>
                  )}
                </div>

                {/* Blocking validation banner (D-08) — no autocorrect */}
                {canWrite && phase === "closed" && validation && !validation.ok ? (
                  <div role="alert" className="mt-3 rounded-md border border-vendido bg-vendido/10 p-3 text-sm text-vendido">
                    <p>{polygonErrorMessage(validation.reason)}</p>
                    <p className="mt-1">Corregí el polígono antes de guardar.</p>
                  </div>
                ) : null}

                {/* Inline save/delete feedback (Phase 10 mold — no global toast) */}
                {feedback ? (
                  <p
                    role={feedback.kind === "status" ? "status" : "alert"}
                    className={`mt-3 text-sm ${feedback.kind === "status" ? "text-disponible" : "text-vendido"}`}
                  >
                    {feedback.msg}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Delete confirmation (D-02) — Vendido-red destructive gate */}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-grafito/40 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg border border-gris-100 bg-blanco p-6">
            <h2 className="text-xl text-grafito">¿Borrar el polígono de {targetLabel}?</h2>
            <p className="mt-2 text-base text-gris-500">
              El explorador va a dejar de mostrar este hotspot hasta que lo vuelvas a dibujar. No se puede
              deshacer.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-10 rounded-md border border-gris-300 px-4 text-base text-grafito hover:bg-gris-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={performDelete}
                disabled={deleting}
                className="h-10 rounded-md bg-vendido px-4 text-base text-blanco hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Borrando…" : "Borrar polígono"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Selector rail -------------------------------------------------------------------------------

function SelectorRail({
  mode,
  loading,
  floors,
  units,
  drilledFloor,
  selectedId,
  canWrite,
  onSelectFloor,
  onSelectUnit,
  onDrillFloor,
  onBack,
}: {
  mode: Mode;
  loading: boolean;
  floors: FloorRow[];
  units: UnitRow[];
  drilledFloor: FloorRow | null;
  selectedId: string | null;
  canWrite: boolean;
  onSelectFloor: (floor: FloorRow) => void;
  onSelectUnit: (unit: UnitRow) => void;
  onDrillFloor: (floorId: string) => void;
  onBack: () => void;
}): ReactElement {
  return (
    <aside className="w-[280px] shrink-0">
      {/* Breadcrumb / mode bar */}
      <div className="flex h-11 items-center text-base">
        {mode === "exterior" ? (
          <span className="text-grafito">Exterior del edificio</span>
        ) : (
          <span className="text-gris-500">
            <button type="button" onClick={onBack} className="text-blueprint underline underline-offset-2">
              Exterior
            </button>{" "}
            → Planta {drilledFloor ? floorLabel(drilledFloor) : ""}
          </span>
        )}
      </div>

      <h2 className="mt-2 text-xl text-grafito">
        {mode === "exterior" ? "Pisos" : `Unidades de ${drilledFloor ? floorLabel(drilledFloor) : ""}`}
      </h2>

      {loading ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-11 w-full animate-pulse rounded-sm bg-gris-100" />
          ))}
        </div>
      ) : mode === "exterior" ? (
        <>
          <ul className="mt-3 max-h-[70vh] overflow-y-auto">
            {floors.map((f) => (
              <li key={f.id} className="flex h-11 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectFloor(f)}
                  title={floorLabel(f)}
                  className={`flex h-11 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left ${
                    selectedId === f.id ? "bg-cobre/10" : "hover:bg-gris-100"
                  }`}
                >
                  <Dot on={f.poligonoSvg !== null} />
                  <span className="min-w-0 flex-1 truncate text-base text-grafito">{floorLabel(f)}</span>
                  <span className="shrink-0 text-sm text-gris-500">
                    {f.poligonoSvg !== null ? "con hotspot" : "sin hotspot"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDrillFloor(f.id)}
                  aria-label={`Abrir planta ${floorLabel(f)}`}
                  className="flex h-11 w-8 items-center justify-center rounded-sm text-gris-500 hover:bg-gris-100"
                >
                  <ChevronRight />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-gris-500">Abrí la planta para dibujar las unidades</p>
        </>
      ) : (
        <ul className="mt-3 max-h-[70vh] overflow-y-auto">
          {units.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onSelectUnit(u)}
                title={unitLabel(u)}
                className={`flex h-11 w-full items-center gap-2 rounded-sm px-2 text-left ${
                  selectedId === u.id ? "bg-cobre/10" : "hover:bg-gris-100"
                }`}
              >
                <Dot on={u.poligonoSvg !== null} />
                <span className="min-w-0 flex-1 truncate text-base text-grafito">{unitLabel(u)}</span>
                <span className="shrink-0 text-sm text-gris-500">
                  {u.poligonoSvg !== null ? "con hotspot" : "sin hotspot"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!canWrite ? <p className="mt-4 text-sm text-gris-500">Solo lectura</p> : null}
    </aside>
  );
}

// --- small presentational helpers ---------------------------------------------------------------

function Dot({ on }: { on: boolean }): ReactElement {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? "bg-disponible" : "bg-gris-300"}`}
      aria-hidden
    />
  );
}

function ChevronRight(): ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyState({ heading, body }: { heading: string; body: string }): ReactElement {
  return (
    <div className="rounded-lg border border-gris-100 bg-blanco p-12 text-center">
      <h2 className="text-xl text-grafito">{heading}</h2>
      <p className="mx-auto mt-2 max-w-md text-base text-gris-500">{body}</p>
    </div>
  );
}
