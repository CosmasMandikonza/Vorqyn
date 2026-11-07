/**
 * Ghost Replay data builder (Issue #15, section C).
 *
 * Splits the RECORDED kernel observation log for one robot into the path
 * BEFORE the optical fault and the path AFTER it. Both branches are real
 * recorded kernel observations — there is no second robot, no simulated
 * recovery run, and nothing here is generated motion. The UI must present
 * them as "recorded observations before/after the fault", never as a
 * failed attempt vs a recovery mission.
 */
import type { DemoSnapshot } from "./demo-sim/contract";
import { demoPoseToScene } from "./demo-sim/contract";
import type { SceneVec3 } from "./enu";

export interface GhostPath {
  points: SceneVec3[];
  fromSimMs: number;
  toSimMs: number;
  fromSequence: number;
  toSequence: number;
}

export interface GhostPaths {
  pre: GhostPath | null;
  post: GhostPath | null;
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
): GhostPaths {
  const collect = (range: DemoSnapshot[]): GhostPath | null => {
    const usable = range.filter((snap) => {
      const robot = snap.robots.find((r) => r.robotId === robotId);
      return Boolean(robot && robot.fresh);
    });
    if (usable.length < 2) return null;
    const first = usable[0]!;
    const last = usable[usable.length - 1]!;
    return {
      points: usable.map((snap) => demoPoseToScene(snap.robots.find((r) => r.robotId === robotId)!.pose)),
      fromSimMs: first.simulatorTimeMs,
      toSimMs: last.simulatorTimeMs,
      fromSequence: first.sequence,
      toSequence: last.sequence,
    };
  };

  if (faultIndex === null) return { pre: null, post: null };
  const pre = collect(snapshots.slice(0, faultIndex));
  const post = collect(snapshots.slice(faultIndex));
  return { pre, post };
}
