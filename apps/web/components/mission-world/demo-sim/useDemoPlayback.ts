"use client";

/**
 * Playback controller for the synthetic survey (VQ-DEMO-SIM/1 client side).
 *
 * Truthfulness rules implemented here:
 * - The server is stateless: every request replays the FULL operation trace,
 *   so `trace` is the canonical history and responses are cumulative.
 * - "Run/Pause playback" only drives UI auto-advance; the kernel only steps
 *   when an operation is actually sent. The UI must say so.
 * - The fault button appends a REAL validated kernel command to the trace;
 *   it never merely flips a badge.
 * - Out-of-order HTTP responses are dropped via a monotonic request counter;
 *   repeated clicks are guarded by a pending flag; the 400-step budget is
 *   enforced client-side to mirror the server contract.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEMO_SEED,
  MAX_TOTAL_STEPS,
  MAX_STEP_COUNT_PER_OP,
  totalSimulatedSteps,
  type DemoSimOperation,
  type DemoSimResponse,
  type DemoSnapshot,
} from "./contract";
import { buildDemoSimRequest, type DemoTransport } from "./client";

export type PlaybackPhase = "idle" | "starting" | "ready" | "unavailable";
export type PlaybackPending = "start" | "advance" | "fault" | "replay" | null;

const AUTO_ADVANCE_INTERVAL_MS = 900;
const AUTO_ADVANCE_STEP_COUNT = 2;
const AUTO_ADVANCE_MAX_STEPS_PER_TICK = MAX_STEP_COUNT_PER_OP - 1; // stay inside per-op limit

export interface DemoPlaybackState {
  phase: PlaybackPhase;
  transportKind: "http" | "fixture";
  trace: DemoSimOperation[];
  response: DemoSimResponse | null;
  /** Visual head index into response.snapshots; -1 = no observation yet. */
  viewIndex: number;
  playing: boolean;
  pending: PlaybackPending;
  error: { code: string; message: string } | null;
  /** Transient operator notice (kernel rejections, budget, replay result). */
  notice: string | null;
  replayIdentical: boolean | null;
}

export interface DemoPlaybackApi extends DemoPlaybackState {
  latestSnapshot: DemoSnapshot | null;
  budgetUsed: number;
  budgetMax: number;
  start: () => void;
  run: () => void;
  pause: () => void;
  advance: (count?: number) => void;
  injectFault: () => void;
  reset: () => void;
  replay: () => void;
  setViewIndex: (index: number) => void;
}

export function useDemoPlayback(options: {
  transportKind: "http" | "fixture";
  transport: DemoTransport;
}): DemoPlaybackApi {
  const { transportKind, transport } = options;
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [trace, setTrace] = useState<DemoSimOperation[]>([]);
  const [response, setResponse] = useState<DemoSimResponse | null>(null);
  const [viewIndex, setViewIndexState] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState<PlaybackPending>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replayIdentical, setReplayIdentical] = useState<boolean | null>(null);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const traceRef = useRef<DemoSimOperation[]>([]);
  const playingRef = useRef(false);
  const mountedRef = useRef(true);

  const budgetUsed = useMemo(() => totalSimulatedSteps(trace), [trace]);

  const setSafe = (setter: () => void) => {
    if (mountedRef.current) setter();
  };

  const runRequest = useCallback(
    async (kind: Exclude<PlaybackPending, null>, nextTrace: DemoSimOperation[], onDone?: (r: DemoSimResponse) => void) => {
      const requestSeq = ++seqRef.current;
      busyRef.current = true;
      setPending(kind);
      setError(null);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const result = await transport(buildDemoSimRequest(DEMO_SEED, nextTrace), controller.signal);
        if (!mountedRef.current || requestSeq !== seqRef.current) return; // stale/out-of-order
        traceRef.current = nextTrace;
        setTrace(nextTrace);
        setResponse(result);
        setViewIndexState(result.snapshots.length - 1);
        setError(null);
        setPhase("ready");
        onDone?.(result);
      } catch (cause) {
        if (!mountedRef.current || requestSeq !== seqRef.current) return;
        if (controller.signal.aborted && kind !== "start") {
          setNotice("Previous request cancelled.");
        }
        const isUnavailable =
          cause instanceof Error && (cause.name === "DemoSimNetworkError" || /HTTP 404/.test(cause.message));
        if (kind === "start" && isUnavailable) {
          setPhase("unavailable");
          setError({
            code: cause instanceof Error ? cause.name : "unknown",
            message:
              cause instanceof Error
                ? cause.message +
                  " — the synthetic survey API is not available on this deployment; the static world preview remains available."
                : "simulation API unavailable",
          });
        } else if (cause instanceof Error) {
          const code = (cause as { code?: string }).code ?? cause.name;
          setError({ code, message: cause.message });
          setNotice(`Kernel/API rejected the last operation (${code}): ${cause.message}`);
          if (kind === "advance") setPlaying(false);
        }
      } finally {
        if (requestSeq === seqRef.current) {
          busyRef.current = false;
          setSafe(() => setPending(null));
        }
      }
    },
    [transport],
  );

  const start = useCallback(() => {
    if (busyRef.current || phase === "starting" || phase === "ready") return;
    setNotice(null);
    setReplayIdentical(null);
    setPlaying(false);
    void runRequest("start", []);
  }, [phase, runRequest]);

  const advanceInternal = useCallback(
    (count: number, kind: Exclude<PlaybackPending, null> = "advance") => {
      if (busyRef.current || phase !== "ready") return;
      const used = totalSimulatedSteps(traceRef.current);
      if (used >= MAX_TOTAL_STEPS) {
        setPlaying(false);
        setNotice(`Step budget reached (${MAX_TOTAL_STEPS} simulated steps). Reset to start a fresh survey.`);
        return;
      }
      const capped = Math.min(count, MAX_STEP_COUNT_PER_OP, MAX_TOTAL_STEPS - used);
      void runRequest(kind, [...traceRef.current, { op: "step", count: capped }]);
    },
    [phase, runRequest],
  );

  const advance = useCallback((count = 1) => advanceInternal(count, "advance"), [advanceInternal]);

  const run = useCallback(() => {
    if (phase !== "ready") return;
    setPlaying(true);
  }, [phase]);

  const pause = useCallback(() => {
    setPlaying(false);
    setNotice("Visual playback paused — the kernel only steps when you Advance, Resume playback, or Run.");
  }, []);

  const injectFault = useCallback(() => {
    if (busyRef.current || phase !== "ready" || pending !== null) return;
    if (response?.state.kernelState !== "running") {
      setNotice(`Kernel rejected fault injection: state is "${response?.state.kernelState ?? "unknown"}", not "running".`);
      return;
    }
    // Unique idempotency key per operator injection attempt. The key is UI
    // bookkeeping only — it never affects snapshot content, so traces remain
    // deterministic in their observations.
    const key = `guest-optical-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${viewIndex}-${response?.state.sequence ?? 0}`
    }`;
    const command = {
      type: "injectOpticalVisibilityFault" as const,
      robotId: "rov-01" as const,
      severity: "severe" as const,
      durationMs: 9000,
      idempotencyKey: key,
    };
    void runRequest("fault", [...traceRef.current, { op: "command", command }], () => {
      setNotice("Fault command accepted by the kernel — optical quality degrades on the next simulated step. Sonar is unaffected.");
    });
  }, [phase, pending, response, viewIndex, runRequest]);

  const replay = useCallback(() => {
    if (busyRef.current || phase !== "ready" || traceRef.current.length === 0) return;
    const previous = JSON.stringify(response?.snapshots ?? []);
    void runRequest("replay", [...traceRef.current], (result) => {
      const identical = JSON.stringify(result.snapshots) === previous;
      setReplayIdentical(identical);
      setNotice(
        identical
          ? "Replay verified: the re-executed trace produced identical snapshots (deterministic kernel)."
          : "Replay produced DIFFERENT snapshots than the original run — this should not happen for the same seed and trace.",
      );
    });
  }, [phase, response, runRequest]);

  const setViewIndex = useCallback((index: number) => {
    setPlaying(false);
    setViewIndexState(index);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    seqRef.current += 1; // invalidate in-flight responses
    traceRef.current = [];
    setTrace([]);
    setResponse(null);
    setViewIndex(-1);
    setPlaying(false);
    setPending(null);
    setError(null);
    setNotice(null);
    setReplayIdentical(null);
    setPhase("idle");
  }, [setViewIndex]);

  // Auto-advance loop: fixed-cadence tick that skips while a request is in
  // flight. This is UI playback — kernel steps happen only when the resulting
  // request is actually sent.
  useEffect(() => {
    if (!playing || phase !== "ready") return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || !playingRef.current) return;
      if (busyRef.current) return; // previous request still in flight — skip tick
      const used = totalSimulatedSteps(traceRef.current);
      if (used >= MAX_TOTAL_STEPS) {
        setPlaying(false);
        setNotice(`Step budget reached (${MAX_TOTAL_STEPS} simulated steps). Reset to start a fresh survey.`);
        return;
      }
      const capped = Math.min(
        AUTO_ADVANCE_STEP_COUNT,
        AUTO_ADVANCE_MAX_STEPS_PER_TICK,
        MAX_TOTAL_STEPS - used,
      );
      advanceInternal(capped);
    }, AUTO_ADVANCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [playing, phase, advanceInternal]);

  // keep playingRef in sync for the interval closure
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const latestSnapshot =
    response !== null && viewIndex >= 0 && viewIndex < response.snapshots.length
      ? (response.snapshots[viewIndex] ?? null)
      : null;

  return {
    phase,
    transportKind,
    trace,
    response,
    viewIndex,
    playing,
    pending,
    error,
    notice,
    replayIdentical,
    latestSnapshot,
    budgetUsed,
    budgetMax: MAX_TOTAL_STEPS,
    start,
    run,
    pause,
    advance,
    injectFault,
    reset,
    replay,
    setViewIndex,
  };
}
