/**
 * Ghost Replay data builder (Issue #15, section C).
 *
 * Splits the RECORDED kernel observation log for one robot into the path
 * BEFORE the optical fault and the path AFTER it. Both branches are real
 * recorded kernel observations — there is no second robot, no simulated
 * recovery run, and nothing here is generated motion. The UI must present
 * them as "recorded observations before/after the fault", never as a
 * failed attempt vs a recovery mission.
 *
 * Gap provenance (review P2-C): fresh observations separated by stale or
 * missing frames are NOT joined into a single polyline — the intervening
 * motion was never measured, so drawing it would fabricate trajectory.
 * Each branch therefore contains one or more SEGMENTS; bridges between
 * segments are suppressed (counted in `suppressedBridges`) and the UI
 * renders segments as disconnected strokes.
 */
import type { DemoSnapshot } from "./demo-sim/contract";
import { demoPoseToScene } from "./demo-sim/contract";
import type { SceneVec3 } from "./enu";

export interface GhostSegment {
  points: SceneVec3[];
  fromSimMs: number;
  toSimMs: number;
  fromSequence: number;
  toSequence: number;
}

export interface GhostPath {
  segments: GhostSegment[];
  fromSimMs: number;
  toSimMs: number;
  fromSequence: number;
  toSequence: number;
  /** Unsupported bridges suppressed between segments (never drawn). */
  suppressedBridges: number;
}

export interface GhostPaths {
  pre: GhostPath | null;
  post: GhostPath | null;
}

/** Maximum simulator-time step between joined fresh observations (ms). */
const MAX_JOIN_GAP_MS = 2500; // 5 kernel steps at the 500 ms fixture step

export interface BuildGhostPathsOptions {
  maxJoinGapMs?: number;
}

/**
 * @param snapshots full recorded observation log
 * @param robotId kernel robot identifier
 * @param faultIndex snapshot index where the fault first appears
 */
export function buildGhostPaths(
  snapshots: DemoSnapshot[],
  robotId: string,
  faultIndex: number | null,
  options: BuildGhostPathsOptions = {},
): GhostPaths {
  const maxJoinGapMs = options.maxJoinGapMs ?? MAX_JOIN_GAP_MS;

  const collect = (range: DemoSnapshot[]): GhostPath | null => {
    const usable = range.filter((snap) => {
      const robot = snap.robots.find((r) => r.robotId === robotId);
      return Boolean(robot && robot.fresh);
    });
    if (usable.length === 0) return null;

    // Walk fresh samples and split a segment whenever the recorded evidence
    // does not support continuity: a simulator-time jump beyond maxJoinGapMs
    // or a missing observation (sequence gap).
    const segments: GhostSegment[] = [];
    let current: { points: SceneVec3[]; fromSimMs: number; toSimMs: number; fromSequence: number; toSequence: number } | null = null;
    let previous: { simMs: number; sequence: number } | null = null;
    let suppressedBridges = 0;

    for (const snap of usable) {
      const robot = snap.robots.find((r) => r.robotId === robotId)!;
      const point = demoPoseToScene(robot.pose);
      const breakHere =
        current !== null &&
        previous !== null &&
        (snap.simulatorTimeMs - previous.simMs > maxJoinGapMs ||
          snap.sequence - previous.sequence !== 1);
      if (current === null || breakHere) {
        if (current !== null) suppressedBridges += 1;
        current = {
          points: [point],
          fromSimMs: snap.simulatorTimeMs,
          toSimMs: snap.simulatorTimeMs,
          fromSequence: snap.sequence,
          toSequence: snap.sequence,
        };
        segments.push(current);
      } else {
        current.points.push(point);
        current.toSimMs = snap.simulatorTimeMs;
        current.toSequence = snap.sequence;
      }
      previous = { simMs: snap.simulatorTimeMs, sequence: snap.sequence };
    }

    if (segments.length === 0) return null;
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    return {
      segments,
      fromSimMs: first.fromSimMs,
      toSimMs: last.toSimMs,
      fromSequence: first.fromSequence,
      toSequence: last.toSequence,
      suppressedBridges,
    };
  };

  if (faultIndex === null) return { pre: null, post: null };
  const pre = collect(snapshots.slice(0, faultIndex));
  const post = collect(snapshots.slice(faultIndex));
  return { pre, post };
}
