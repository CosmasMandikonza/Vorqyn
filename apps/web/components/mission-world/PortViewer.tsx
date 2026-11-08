"use client";

/**
 * PORT-001 interactive world preview with synthetic survey playback
 * (VQ-07-VIEW #27 + DEMO-02 #33).
 *
 * Renders the merged, hash-verified GLB asset pack with named camera stations
 * from world.json, and — when a VQ-DEMO-SIM/1 session is running — moves the
 * machines along their actual kernel-observed poses. Static anchor fixtures
 * only when no session exists; see labels.ts for the honest scope statements.
 */
import { useProgress } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fallback2D } from "./Fallback2D";
import { InspectorPanel } from "./InspectorPanel";
import { PlaybackBar } from "./PlaybackBar";
import {
  cameraOffset,
  addVec,
  type SceneVec3,
} from "./enu";
import { HONESTY_BADGE, PLAYBACK_BADGE, LIMITATIONS_TEXT, PLAYBACK_LIMITATIONS_TEXT } from "./labels";
import { poseForMode, type CameraPose, type ViewMode } from "./camera-presets";
import { fetchWorld, type PortWorld } from "./world-data";
import { MACHINES } from "./machines";
import { demoPoseToScene, type DemoRobotView } from "./demo-sim/contract";
import {
  httpDemoTransport,
  type DemoTransport,
} from "./demo-sim/client";
import { fixtureDemoTransport, FIXTURE_TRANSPORT_QUERY_PARAM } from "./demo-sim/fixture";
import { useDemoPlayback } from "./demo-sim/useDemoPlayback";
import { buildFaultSeries, faultStartIndex } from "./fault-series";
import { buildGhostPaths, type GhostPaths } from "./ghost-paths";
import { buildDiveLegs, nextLegIndex } from "./world-dive";
import { projectEconomicHandoff } from "./economic-handoff/boundary";
import { RecoveryHandoffPanel } from "./economic-handoff/RecoveryHandoffPanel";
import { buildPort001Script } from "@vorqyn/contracts";

/** R3F Canvas itself must never render during SSR. */
const PortSceneDynamic = dynamic(() => import("./PortScene").then((m) => m.PortScene), { ssr: false });

type ViewerState =
  | { phase: "loading-world" }
  | { phase: "world-error"; message: string }
  | { phase: "ready"; world: PortWorld };

type UiViewMode = ViewMode | "FOLLOW";

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
  const [mode, setMode] = useState<UiViewMode>("RESET");
  const [inspectIndex, setInspectIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>("drone");
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [force2D, setForce2D] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const lowGpu = useRef(false);

  // Opt-in recorded-fixture transport (labelled in the UI); the default is
  // always the real VQ-DEMO-SIM/1 HTTP endpoint owned by Issue #32.
  const [fixtureMode] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has(FIXTURE_TRANSPORT_QUERY_PARAM),
  );
  const transport: DemoTransport = useMemo(
    () => (fixtureMode ? fixtureDemoTransport : httpDemoTransport),
    [fixtureMode],
  );
  const playback = useDemoPlayback({ transportKind: fixtureMode ? "fixture" : "http", transport });

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

  const sessionActive = playback.response !== null;
  const liveRobots: DemoRobotView[] | null = playback.latestSnapshot?.robots ?? null;
  const selectedMachine = MACHINES.find((m) => m.id === selectedId) ?? null;
  const selectedLive =
    liveRobots?.find((r) => r.robotId === selectedMachine?.robotId) ?? null;

  // Economic Handoff (Issue #15): read-only event projection. Default source
  // is NONE — the authority stages honestly show pending/unavailable. The
  // opt-in canonical fixture walkthrough (fixture mode only) loads Lane 1's
  // committed deterministic fixture script through the SAME validated
  // boundary, clearly labelled; no chain events are ever synthesized here.
  const [handoffWalkthroughLoaded, setHandoffWalkthroughLoaded] = useState(false);

  // Mission Fracture + Ghost Replay data: derived strictly from the recorded
  // kernel observation log (Issue #15, sections B and C).
  const snapshots = useMemo(() => playback.response?.snapshots ?? [], [playback.response]);
  const faultSeries = useMemo(() => buildFaultSeries(snapshots, "rov-01"), [snapshots]);
  const faultIndex = faultStartIndex(faultSeries);
  const ghostPaths: GhostPaths = useMemo(
    () => buildGhostPaths(snapshots, "rov-01", faultIndex),
    [snapshots, faultIndex],
  );
  const hasFault = faultIndex !== null;
  const [ghostVisible, setGhostVisible] = useState(true);

  const economicEvents = useMemo(
    () => (handoffWalkthroughLoaded ? buildPort001Script().map((event) => event as unknown) : []),
    [handoffWalkthroughLoaded],
  );
  const handoffProjection = useMemo(
    () => projectEconomicHandoff(economicEvents, { missionId: "port-001", taskId: "task-sea-survey" }),
    [economicEvents],
  );

  // World Dive (Issue #15, section A): timed playthrough of calibrated
  // stations. Any operator input cancels; reduced motion disables it.
  const [diveActive, setDiveActive] = useState(false);
  const [diveLegIndex, setDiveLegIndex] = useState(0);
  const diveTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelDive = useCallback(() => {
    diveTimersRef.current.forEach(clearTimeout);
    diveTimersRef.current = [];
    setDiveActive(false);
  }, []);
  const startDive = useCallback(() => {
    if (reducedMotion || diveActive) return;
    cancelDive();
    setDiveActive(true);
    const legs = buildDiveLegs();
    setDiveLegIndex(0);
    setMode(legs[0]!.station);
    diveTimersRef.current = legs.map((leg, index) =>
      setTimeout(() => {
        const next = nextLegIndex(index);
        if (next === null) {
          setDiveActive(false);
          setMode("INSPECT");
          return;
        }
        setDiveLegIndex(next);
        setMode(legs[next]!.station);
      }, (index + 1) * leg.durationMs),
    );
  }, [reducedMotion, diveActive, cancelDive]);
  useEffect(() => () => cancelDive(), [cancelDive]);
  const setModeAndResetInspect = useCallback(
    (next: UiViewMode) => {
      cancelDive();
      setMode(next);
      setInspectIndex(0);
    },
    [cancelDive],
  );

  const pose: CameraPose | null = useMemo(() => {
    if (state.phase !== "ready") return null;
    if (mode === "FOLLOW") {
      if (!selectedMachine || !selectedLive) return null;
      const target = demoPoseToScene(selectedLive.pose);
      const byRole = state.world.camera_targets.FOLLOW?.by_role?.[selectedMachine.id];
      const distance = byRole ? (byRole.distance_range_m[0] + byRole.distance_range_m[1]) / 2 : 12;
      const offset = cameraOffset(215, 22, distance);
      return {
        position: addVec(target, offset) as SceneVec3,
        target,
        near_m: byRole?.near_m ?? 0.2,
        far_m: byRole?.far_m ?? 400,
        min_distance_m: byRole?.distance_range_m[0] ?? 2,
        max_distance_m: byRole?.distance_range_m[1] ?? 30,
        underwater: target[1] < 0,
        derivation: `FOLLOW station (world.json FOLLOW.${selectedMachine.id} ranges) — camera tracks the selected machine's kernel-observed pose`,
      };
    }
    return poseForMode(mode, state.world, inspectIndex);
  }, [state, mode, inspectIndex, selectedMachine, selectedLive]);

  // FOLLOW target: the rig continuously tracks the machine's live pose.
  const followTarget: SceneVec3 | null =
    mode === "FOLLOW" && selectedLive ? demoPoseToScene(selectedLive.pose) : null;

  const cycleInspect = useCallback(() => {
    setInspectIndex((index) => index + 1);
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
        <div className="flex flex-wrap items-center gap-2">
          <p className="badge bg-card font-mono" data-testid="honesty-badge">
            {sessionActive ? PLAYBACK_BADGE : HONESTY_BADGE}
          </p>
          {fixtureMode && (
            <p className="badge border-warning bg-card font-mono text-warning" data-testid="fixture-badge">
              FIXTURE PLAYBACK · recorded kernel response
            </p>
          )}
        </div>
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

      {state.phase === "ready" && playback.phase === "unavailable" && (
        <div className="notice" role="alert">
          <strong>Synthetic survey API unavailable.</strong> {playback.error?.message} The
          static world preview below remains fully usable; playback controls are
          disabled until the simulation API responds.
          <div className="mt-3">
            <button type="button" className="button button-secondary" onClick={playback.start}>
              Retry simulation API
            </button>
          </div>
        </div>
      )}

      {state.phase === "ready" &&
        (webglAvailable && !force2D ? (
          <div className="relative">
            {/* The desktop inspector overlay lives INSIDE WorldCanvasFrame
                (overflow-hidden, 62vh) so its absolute insets physically clip
                to the canvas bounds — it can never reach the PlaybackBar
                below (the 1024px Replay-interception defect from PR #43 QA).
                The camera station bar is likewise bounded to the canvas
                region, not the mobile inspector below it. */}
            <div className="relative">
              <div onPointerDownCapture={cancelDive} className={diveActive ? "contents" : undefined}>
                <WorldCanvasFrame>
                  <PortSceneDynamic
                    world={state.world}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    pose={pose}
                    reducedMotion={reducedMotion}
                    lowGpu={lowGpu.current}
                    onContextLost={() => setContextLost(true)}
                    onContextRestored={() => setContextLost(false)}
                    liveRobots={liveRobots}
                    sessionKernelState={
                      playback.latestSnapshot?.kernelState ?? playback.response?.state.kernelState ?? null
                    }
                    followTarget={followTarget}
                    ghostPaths={ghostVisible ? ghostPaths : null}
                  />
                  {/* Desktop inspector — clipped by the frame's own
                      overflow-hidden; scrollable within the canvas bounds. */}
                  <aside
                    className="absolute top-3 right-3 bottom-16 hidden w-78 overflow-y-auto lg:block"
                    data-testid="inspector-overlay"
                  >
                    <InspectorPanel
                      world={state.world}
                      pose={pose}
                      mode={mode === "FOLLOW" ? "RESET" : mode}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      inspectIndex={inspectIndex}
                      onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
                      limitations={sessionActive ? PLAYBACK_LIMITATIONS_TEXT : LIMITATIONS_TEXT}
                      sensorRobot={selectedLive}
                      compact
                    />
                  </aside>
                </WorldCanvasFrame>
                {diveActive && (
                  <DiveChip
                    dive={{ label: buildDiveLegs()[diveLegIndex]?.label ?? "" }}
                    onSkip={() => {
                      cancelDive();
                      setMode("INSPECT");
                    }}
                  />
                )}
                <ViewModeBar
                  mode={mode}
                  onChange={setModeAndResetInspect}
                  inspectAnchor={mode === "INSPECT" ? inspectAnchor : undefined}
                  onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
                  followEnabled={sessionActive && Boolean(selectedLive)}
                />
              </div>
              </div>
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
            <div className="mt-4">
              <PlaybackBar
                playback={playback}
                faultSeries={faultSeries}
                viewIndex={playback.viewIndex}
                onSelectIndex={playback.setViewIndex}
                ghost={hasFault ? { visible: ghostVisible, onToggle: () => setGhostVisible((v) => !v), pre: ghostPaths.pre, post: ghostPaths.post } : null}
                dive={{ available: !reducedMotion, active: diveActive, legLabel: buildDiveLegs()[diveLegIndex]?.label ?? "", onStart: startDive, onSkip: () => { cancelDive(); setMode("INSPECT"); } }}
              />
            </div>
            <RecoveryHandoffPanel
              projection={handoffProjection}
              sourceLabel={
                fixtureMode
                  ? "FIXTURE WALKTHROUGH · canonical contracts fixture script (deterministic — no chain transactions submitted)"
                  : "PENDING — awaiting an authoritative mission event source"
              }
              measuredAvailable={hasFault}
              onLoadWalkthrough={fixtureMode ? () => setHandoffWalkthroughLoaded(true) : undefined}
              walkthroughLoaded={handoffWalkthroughLoaded}
            />
            <div className="mt-4 lg:hidden">
              <InspectorPanel
                world={state.world}
                pose={pose}
                mode={mode === "FOLLOW" ? "RESET" : mode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                inspectIndex={inspectIndex}
                onCycleInspect={mode === "INSPECT" ? cycleInspect : undefined}
                limitations={sessionActive ? PLAYBACK_LIMITATIONS_TEXT : LIMITATIONS_TEXT}
                sensorRobot={selectedLive}
              />
            </div>
          </div>
        ) : (
          <div>
            <Fallback2D
              world={state.world}
              selectedId={selectedId}
              onSelect={setSelectedId}
              mode={mode === "FOLLOW" ? "RESET" : mode}
              reason={force2D ? "2D map requested." : "A WebGL-capable browser is required for the 3D preview."}
              liveRobots={liveRobots}
              kernelState={playback.latestSnapshot?.kernelState ?? playback.response?.state.kernelState ?? null}
              simulatorTimeMs={playback.latestSnapshot?.simulatorTimeMs ?? playback.response?.state.simulatorTimeMs ?? null}
              sequence={playback.latestSnapshot?.sequence ?? null}
            />
            <div className="mt-4">
              <PlaybackBar
                playback={playback}
                faultSeries={faultSeries}
                viewIndex={playback.viewIndex}
                onSelectIndex={playback.setViewIndex}
                ghost={hasFault ? { visible: ghostVisible, onToggle: () => setGhostVisible((v) => !v), pre: ghostPaths.pre, post: ghostPaths.post } : null}
                dive={{ available: !reducedMotion, active: diveActive, legLabel: buildDiveLegs()[diveLegIndex]?.label ?? "", onStart: startDive, onSkip: () => { cancelDive(); setMode("INSPECT"); } }}
              />
            </div>
            <RecoveryHandoffPanel
              projection={handoffProjection}
              sourceLabel={
                fixtureMode
                  ? "FIXTURE WALKTHROUGH · canonical contracts fixture script (deterministic — no chain transactions submitted)"
                  : "PENDING — awaiting an authoritative mission event source"
              }
              measuredAvailable={hasFault}
              onLoadWalkthrough={fixtureMode ? () => setHandoffWalkthroughLoaded(true) : undefined}
              walkthroughLoaded={handoffWalkthroughLoaded}
            />
          </div>
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

function DiveChip({ dive, onSkip }: { dive: { label: string }; onSkip: () => void }) {
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2" data-testid="dive-chip">
      <span className="badge border-primary bg-primary font-mono text-primary-foreground">
        World Dive · {dive.label}
      </span>
      <button type="button" className="button button-secondary !min-h-9 !px-2.5 text-xs" onClick={onSkip}>
        Skip dive
      </button>
    </div>
  );
}

function ViewModeBar({
  mode,
  onChange,
  inspectAnchor,
  onCycleInspect,
  followEnabled,
}: {
  mode: UiViewMode;
  onChange: (mode: UiViewMode) => void;
  inspectAnchor?: string;
  onCycleInspect?: () => void;
  followEnabled: boolean;
}) {
  const modes: UiViewMode[] = ["RESET", "AIR", "LAND", "UNDERWATER", "INSPECT", "FOLLOW"];
  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-start gap-2">
      {/* At 320px the six stations exceed one row (~340px of controls in a
          256px frame): a single row either overflows the frame or hides
          stations in an internal scroll region (Codex audit: FOLLOW
          right=353.75, RESET left=-34). The responsive grid keeps ALL six
          stations fully visible at every width — no internal scroll, no
          clipped controls. Hit targets stay >= 44px tall. */}
      <div
        className="grid w-full grid-cols-3 gap-1 rounded-full border border-border bg-card/90 p-1 backdrop-blur-sm sm:inline-flex sm:w-auto sm:gap-1"
        role="group"
        aria-label="Camera station"
      >
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={m === "FOLLOW" && !followEnabled}
            title={
              m === "FOLLOW" && !followEnabled
                ? "Available while a synthetic survey session is producing observations"
                : undefined
            }
            className="min-h-11 rounded-full px-2 font-mono text-[11px] transition-colors sm:px-3"
            onClick={() => onChange(m)}
          >
            {m === "UNDERWATER" ? "UW" : m}
          </button>
        ))}
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
