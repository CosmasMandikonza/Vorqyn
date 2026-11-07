"use client";

/**
 * PORT-001 interactive world preview (VQ-07-VIEW / Issue #27).
 *
 * Renders the merged, hash-verified GLB asset pack with named camera stations
 * from world.json. Static anchor fixtures only — see labels.ts for the honest
 * scope statements rendered by this component.
 */
import { useProgress } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Fallback2D } from "./Fallback2D";
import { InspectorPanel } from "./InspectorPanel";
import { HONESTY_BADGE, LIMITATIONS_TEXT } from "./labels";
import { poseForMode, type CameraPose, type ViewMode } from "./camera-presets";
import { fetchWorld, type PortWorld } from "./world-data";

/** R3F Canvas itself must never render during SSR. */
const PortSceneDynamic = dynamic(() => import("./PortScene").then((m) => m.PortScene), { ssr: false });

type ViewerState =
  | { phase: "loading-world" }
  | { phase: "world-error"; message: string }
  | { phase: "ready"; world: PortWorld };

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Constrained-device detection drives DPR cap, LOD and shadows. */
function detectLowGPU(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  return cores <= 4 || memory <= 4;
}

export function PortViewer() {
  const [state, setState] = useState<ViewerState>({ phase: "loading-world" });
  const [mode, setMode] = useState<ViewMode>("RESET");
  const [inspectIndex, setInspectIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>("drone");
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [force2D, setForce2D] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const lowGpu = useRef(false);

  useEffect(() => {
    setWebglAvailable(hasWebGL());
    lowGpu.current = detectLowGPU();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWorld()
      .then((world) => {
        if (!cancelled) setState({ phase: "ready", world });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: "world-error",
            message: error instanceof Error ? error.message : "Unknown world metadata error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pose: CameraPose | null =
    state.phase === "ready" ? poseForMode(mode, state.world, inspectIndex) : null;

  const cycleInspect = useCallback(() => {
    setInspectIndex((index) => index + 1);
  }, []);

  const setModeAndResetInspect = useCallback((next: ViewMode) => {
    setMode(next);
    setInspectIndex(0);
  }, []);

  const inspectAnchor =
    state.phase === "ready" && mode === "INSPECT"
      ? (state.world.camera_targets.INSPECT?.targets ?? [])[
          inspectIndex % Math.max(1, (state.world.camera_targets.INSPECT?.targets ?? []).length)
        ]?.anchor
      : undefined;

  return (
    <div className="relative">
      {/* Honesty strip is always rendered, in every state. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="badge bg-card font-mono" data-testid="honesty-badge">
          {HONESTY_BADGE}
        </p>
        {state.phase === "ready" && (
          <button
            type="button"
            className="text-link font-mono text-xs"
            onClick={() => setForce2D((v) => !v)}
          >
            {force2D ? "Use 3D canvas" : "Use 2D map"}
          </button>
        )}
      </div>

      {state.phase === "world-error" && (
        <div className="empty-state" role="alert">
          <h2>World metadata unavailable</h2>
          <p>{state.message}</p>
        </div>
      )}

      {state.phase === "loading-world" && (
        <div className="empty-state" aria-live="polite">
          <h2>Loading world metadata…</h2>
          <p>Reading PORT-001 zones, anchors and camera stations from world.json.</p>
        </div>
      )}

      {state.phase === "ready" &&
        (webglAvailable && !force2D ? (
          <div className="relative">
            <WorldCanvasFrame>
              <PortSceneDynamic
                world={state.world}
                mode={mode}
                inspectIndex={inspectIndex}
                selectedId={selectedId}
                onSelect={setSelectedId}
                pose={pose}
                reducedMotion={reducedMotion}
                lowGpu={lowGpu.current}
                onContextLost={() => setContextLost(true)}
                onContextRestored={() => setContextLost(false)}
              />
            </WorldCanvasFrame>
            <ViewModeBar
              mode={mode}
              onChange={setModeAndResetInspect}
              inspectAnchor={mode === "INSPECT" ? inspectAnchor : undefined}
              onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
            />
            {contextLost && (
              <div className="notice" role="alert">
                The 3D context was interrupted by the browser or graphics driver.
                Controls may be degraded until it recovers — the 2D map remains
                accurate.
                <div className="mt-3">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setForce2D(true)}
                  >
                    Open 2D map
                  </button>
                </div>
              </div>
            )}
            <div className="mt-4 lg:hidden">
              <InspectorPanel
                world={state.world}
                pose={pose}
                mode={mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                inspectIndex={inspectIndex}
                onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
                limitations={LIMITATIONS_TEXT}
              />
            </div>
            <aside
              className="absolute top-3 right-3 bottom-24 hidden w-78 overflow-y-auto lg:block"
              data-testid="inspector-overlay"
            >
              <InspectorPanel
                world={state.world}
                pose={pose}
                mode={mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                inspectIndex={inspectIndex}
                onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
                limitations={LIMITATIONS_TEXT}
                compact
              />
            </aside>
          </div>
        ) : (
          <Fallback2D
            world={state.world}
            selectedId={selectedId}
            onSelect={setSelectedId}
            mode={mode}
            reason={force2D ? "2D map requested." : "A WebGL-capable browser is required for the 3D preview."}
          />
        ))}
    </div>
  );
}

function WorldCanvasFrame({ children }: { children: React.ReactNode }) {
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  return (
    <div
      className="relative h-[62vh] max-h-[720px] min-h-[380px] w-full overflow-hidden rounded-md border border-border bg-[#d7e2df]"
      data-testid="world-canvas-frame"
    >
      {loadFailed ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
          role="alert"
        >
          <p className="font-mono text-sm text-[#193b3b]">{loadFailed}</p>
          <p className="max-w-md font-mono text-xs text-[#506967]">
            The 2D map and plan view remain accurate for orientation.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setLoadFailed(null);
              setRetryKey((k) => k + 1);
            }}
          >
            Retry 3D view
          </button>
        </div>
      ) : (
        <SceneErrorBoundary key={retryKey} onFail={setLoadFailed}>{children}</SceneErrorBoundary>
      )}
      <LoadingVeil />
    </div>
  );
}

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode; onFail: (message: string) => void },
  { hasError: boolean }
> {
  override state = { hasError: false };
  // NOTE: @types/react@19 does not declare this static on Component, so
  // `override` must not be used here despite noImplicitOverride elsewhere.
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onFail(
      error instanceof Error
        ? `The 3D view stopped rendering: ${error.message}`
        : "The 3D view stopped rendering.",
    );
  }
  override render() {
    return this.state.hasError ? null : this.props.children;
  }
}

function LoadingVeil() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-background/85 px-4 py-3 font-mono text-xs text-foreground"
      data-testid="loading-veil"
      aria-live="polite"
    >
      <span>Loading port geometry…</span>
      <span>{Math.round(progress)}%</span>
    </div>
  );
}

function ViewModeBar({
  mode,
  onChange,
  inspectAnchor,
  onCycleInspect,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  inspectAnchor?: string;
  onCycleInspect?: () => void;
}) {
  const modes: ViewMode[] = ["RESET", "AIR", "LAND", "UNDERWATER", "INSPECT"];
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2">
      <div className="halo-segmented bg-card/90 backdrop-blur-sm" role="group" aria-label="Camera station">
        <div className="halo-options">
          {modes.map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}>
              {m === "UNDERWATER" ? "UW" : m}
            </button>
          ))}
        </div>
      </div>
      {mode === "INSPECT" && onCycleInspect && inspectAnchor && (
        <button
          type="button"
          className="button button-secondary !min-h-11 !px-3 !py-2 text-xs"
          onClick={onCycleInspect}
        >
          Target: {inspectAnchor} (cycle)
        </button>
      )}
    </div>
  );
}
