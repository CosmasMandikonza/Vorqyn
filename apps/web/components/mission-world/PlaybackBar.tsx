"use client";

/**
 * Operator controls for the synthetic survey session (DEMO-02).
 *
 * Labels are deliberately explicit about what each control does: Run/Pause
 * drives VISUAL playback (kernel steps only happen when an operation is
 * sent); the fault button appends a real kernel command; Replay re-executes
 * the recorded trace through the stateless API and compares snapshots to
 * demonstrate determinism.
 */
import type { DemoPlaybackApi } from "./demo-sim/useDemoPlayback";
import { FaultTimeline } from "./FaultTimeline";
import type { FaultSeries } from "./fault-series";
import type { GhostPath } from "./ghost-paths";

export function PlaybackBar({
  playback,
  faultSeries,
  viewIndex,
  onSelectIndex,
  ghost = null,
  dive = null,
}: {
  playback: DemoPlaybackApi;
  /** Recorded-measurement series for the fracture timeline (rov-01). */
  faultSeries?: FaultSeries;
  viewIndex?: number;
  onSelectIndex?: (index: number) => void;
  /** Ghost-replay offer, present once the kernel fault exists in the log. */
  ghost?: {
    visible: boolean;
    onToggle: () => void;
    pre: GhostPath | null;
    post: GhostPath | null;
  } | null;
  /** World Dive camera-journey offer (camera-only; no simulated events). */
  dive?: {
    available: boolean;
    active: boolean;
    legLabel: string;
    onStart: () => void;
    onSkip: () => void;
  } | null;
}) {
  const { phase, playing, error, notice, replayIdentical, transportKind } = playback;
  const snapshot = playback.latestSnapshot;
  const simClock = snapshot?.simulatorTimeMs ?? playback.response?.state.simulatorTimeMs ?? null;
  const seq = snapshot?.sequence ?? playback.response?.state.sequence ?? null;
  const kernelState = snapshot?.kernelState ?? playback.response?.state.kernelState ?? null;
  const snapshotCount = playback.response?.snapshots.length ?? 0;

  return (
    <section
      aria-label="Synthetic survey playback controls"
      className="rounded-md border border-border bg-surface-muted/60 p-4"
      data-testid="playback-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-muted-foreground">Synthetic survey · VQ-DEMO-SIM/1</p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`badge font-mono ${
              transportKind === "fixture"
                ? "border-warning text-warning"
                : "border-success text-success"
            }`}
            data-testid="transport-badge"
          >
            {transportKind === "fixture" ? "FIXTURE PLAYBACK (recorded kernel response)" : "LIVE API · SYNTHETIC_SIM"}
          </span>
          {replayIdentical !== null && (
            <span
              className={`badge font-mono ${replayIdentical ? "border-success text-success" : "border-danger text-danger"}`}
              data-testid="replay-badge"
            >
              {replayIdentical ? "Replay identical ✓ deterministic" : "Replay DIFFERS — investigate"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* World Dive is a camera journey over the static world — it needs no
            kernel session, so it is offered in idle phase too (unless the
            visitor prefers reduced motion, in which case it is hidden). */}
        {dive?.available && (
          dive.active ? (
            <button
              type="button"
              className="button button-primary !min-h-11"
              onClick={dive.onSkip}
            >
              World Dive · {dive.legLabel} — skip
            </button>
          ) : (
            <button
              type="button"
              className="button button-secondary !min-h-11"
              onClick={dive.onStart}
              title="Optional choreographed camera journey: aerial overview → rover route → underwater inspection. Any interaction cancels it."
            >
              World Dive
            </button>
          )
        )}
        {phase === "idle" && (
          <button
            type="button"
            className="button button-primary !min-h-11"
            onClick={playback.start}
            disabled={playback.pending !== null}
          >
            {playback.pending === "start" ? "Starting…" : "Start synthetic survey"}
          </button>
        )}
        {phase === "starting" && (
          <p className="font-mono text-xs text-muted-foreground" aria-live="polite">
            Creating session (seed 20261107, empty trace)…
          </p>
        )}
        {phase === "unavailable" && (
          <p className="font-mono text-xs text-danger" aria-live="polite">
            Simulation API unreachable — playback disabled. Retry above.
          </p>
        )}
        {phase === "ready" && (
          <>
            {playing ? (
              <button type="button" className="button button-secondary !min-h-11" onClick={playback.pause}>
                Pause playback
              </button>
            ) : (
              <button type="button" className="button button-primary !min-h-11" onClick={playback.run}>
                Run playback
              </button>
            )}
            <button
              type="button"
              className="button button-secondary !min-h-11"
              onClick={() => playback.advance(1)}
              disabled={playback.pending !== null}
            >
              {playback.pending === "advance" ? "Stepping…" : "Advance +1 step"}
            </button>
            <button
              type="button"
              className="button button-secondary !min-h-11"
              onClick={playback.injectFault}
              disabled={playback.pending !== null || kernelState !== "running"}
              title={
                kernelState !== "running"
                  ? `Kernel state is "${kernelState}" — the fault command is only valid while running`
                  : "Appends a real injectOpticalVisibilityFault kernel command (rov-01, severe, 9000 ms)"
              }
            >
              {playback.pending === "fault" ? "Injecting…" : "Inject underwater optical fault"}
            </button>
            <button
              type="button"
              className="button button-secondary !min-h-11"
              onClick={playback.replay}
              disabled={playback.pending !== null || playback.trace.length === 0}
            >
              {playback.pending === "replay" ? "Replaying…" : "Replay history"}
            </button>
            <button type="button" className="button button-quiet !min-h-11" onClick={playback.reset}>
              Reset
            </button>
          </>
        )}
      </div>

      {phase === "ready" && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>
              SIM CLOCK: <span className="text-foreground">{simClock !== null ? `${simClock} ms` : "—"}</span>
            </span>
            <span>
              SEQUENCE:{" "}
              <span className="text-foreground">
                {seq !== null ? `${(playback.viewIndex >= 0 ? playback.viewIndex + 1 : 0)}/${snapshotCount}` : "—"}
              </span>
            </span>
            <span>
              KERNEL: <span className="text-foreground">{kernelState ?? "—"}</span>
            </span>
            <span>
              STEPS: <span className="text-foreground">{playback.budgetUsed}/{playback.budgetMax}</span>
            </span>
            <span>
              OPERATIONS: <span className="text-foreground">{playback.trace.length}</span>
            </span>
          </div>
          {snapshotCount > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <label htmlFor="timeline-scrub" className="font-mono text-[10px] uppercase text-muted-foreground">
                Timeline
              </label>
              <input
                id="timeline-scrub"
                type="range"
                min={0}
                max={snapshotCount - 1}
                step={1}
                value={Math.max(0, playback.viewIndex)}
                onChange={(event) => playback.setViewIndex(Number(event.target.value))}
                className="h-2 w-full min-w-40 max-w-md accent-[var(--action)]"
                aria-valuetext={`observation ${playback.viewIndex + 1} of ${snapshotCount}, simulator time ${snapshot?.simulatorTimeMs ?? 0} ms`}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {playback.viewIndex >= 0 ? `#${snapshot?.sequence}` : "initial state"}
              </span>
            </div>
          )}
          {faultSeries && snapshotCount > 1 && (
            <FaultTimeline
              series={faultSeries}
              viewIndex={viewIndex ?? -1}
              onSelectIndex={(index) => onSelectIndex?.(index)}
            />
          )}
          {ghost && ghost.pre && ghost.post && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="ghost-legend">
              <button
                type="button"
                aria-pressed={ghost.visible}
                onClick={ghost.onToggle}
                className={`rounded-sm border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                  ghost.visible
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-transparent text-foreground hover:bg-muted"
                }`}
              >
                Ghost replay: recorded paths {ghost.visible ? "shown" : "hidden"}
              </button>
              <span className="badge border-success bg-card font-mono text-[10px] text-muted-foreground">
                ┄ pre-fault · sim t {ghost.pre.fromSimMs}–{ghost.pre.toSimMs} ms · seq {ghost.pre.fromSequence}–
                {ghost.pre.toSequence}
              </span>
              <span className="badge border-primary bg-card font-mono text-[10px] text-muted-foreground">
                — post-fault · sim t {ghost.post.fromSimMs}–{ghost.post.toSimMs} ms · seq {ghost.post.fromSequence}–
                {ghost.post.toSequence}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Both branches are recorded kernel observations — no replacement robot; recovery
                reassignment is not simulated in this demo.
              </span>
            </div>
          )}
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Run/Pause controls visual playback only — the kernel advances solely when
            step operations are sent. Simulator time ({playback.response?.stepMs ?? 500} ms/step) is
            independent of wall time. No evidence verdicts, AI decisions or
            blockchain actions exist in this demo path.
          </p>
        </>
      )}
      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-3 border-l-2 pl-3 font-mono text-[11px] leading-relaxed ${
            error ? "border-danger text-danger" : "border-success text-foreground"
          }`}
          data-testid="playback-notice"
        >
          {error ? `${error.code}: ${error.message}` : notice}
        </p>
      )}
    </section>
  );
}
