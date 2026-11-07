import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiveLegs, nextLegIndex } from "@/components/mission-world/world-dive";
import { buildFaultSeries, faultStartIndex } from "@/components/mission-world/fault-series";
import { buildGhostPaths } from "@/components/mission-world/ghost-paths";
import { poseForMode } from "@/components/mission-world/camera-presets";
import { validateWorld } from "@/components/mission-world/world-data";
import { validateDemoSimResponse } from "@/components/mission-world/demo-sim/contract";

const realWorld = validateWorld(
  JSON.parse(
    readFileSync(path.resolve(__dirname, "../../public/port-world/world.json"), "utf8"),
  ),
);
const RUN = validateDemoSimResponse(
  JSON.parse(
    readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107.json"), "utf8"),
  ),
);

describe("World Dive legs", () => {
  it("follows the judge story order: aerial -> rover route -> underwater -> obstruction", () => {
    const legs = buildDiveLegs();
    expect(legs.map((l) => l.station)).toEqual(["AIR", "LAND", "UNDERWATER", "INSPECT"]);
    expect(legs.every((l) => l.durationMs > 0 && l.label.length > 0)).toBe(true);
  });

  it("terminates cleanly (no infinite journey)", () => {
    let index: number | null = 0;
    let hops = 0;
    while (index !== null && hops < 10) {
      index = nextLegIndex(index);
      hops += 1;
    }
    expect(index).toBeNull();
    expect(hops).toBe(4); // one hop per leg; the 4th hop returns the terminal null
  });

  it("every dive leg resolves to a real calibrated station pose", () => {
    for (const leg of buildDiveLegs()) {
      const pose = poseForMode(leg.station, realWorld, 0);
      expect(pose.near_m).toBeGreaterThan(0);
      for (const axis of pose.position) expect(Number.isFinite(axis)).toBe(true);
    }
  });

  it("the underwater leg is genuinely submerged and the aerial leg is not", () => {
    expect(poseForMode("UNDERWATER", realWorld, 0).underwater).toBe(true);
    expect(poseForMode("AIR", realWorld, 0).underwater).toBe(false);
  });
});

describe("Mission Fracture series (measured, not verdicts)", () => {
  const series = buildFaultSeries(RUN.snapshots, "rov-01");

  it("covers every snapshot with simulator times", () => {
    expect(series.simTimes).toHaveLength(13);
    expect(series.simTimes[0]).toBe(500);
    expect(series.simTimes[12]).toBe(6500);
  });

  it("shows the measured optical drop exactly where the kernel fault starts", () => {
    expect(faultStartIndex(series)).toBe(10);
    const before = series.optical[9]!;
    const after = series.optical[11]!;
    expect(before).toBeGreaterThan(0.6);
    expect(after).toBeLessThan(0.12);
    expect(series.markers[0]).toMatchObject({ index: 10, severity: "severe" });
  });

  it("keeps sonar as an independent series (no optical fault effect)", () => {
    const sonarBefore = series.sonar[9]!;
    const sonarAfter = series.sonar[11]!;
    expect(sonarBefore).toBeGreaterThan(0.5);
    expect(sonarAfter).toBeGreaterThan(0.5);
    expect(Math.abs(sonarAfter - sonarBefore)).toBeLessThan(0.1);
  });

  it("renders null (not zero) for unmeasured states — paused/disconnected truth", () => {
    // The fixture contains only fresh running samples; synthesize a paused
    // snapshot to prove the builder maps missing measurements to null.
    const paused = JSON.parse(JSON.stringify(RUN.snapshots[0])) as typeof RUN.snapshots[0];
    paused.robots = paused.robots.map((r) => ({
      ...r,
      fresh: false,
      staleness: "kernel-paused" as const,
      sensors: r.sensors.map((s) => ({ ...s, measured: null })),
    }));
    const series2 = buildFaultSeries([paused], "rov-01");
    expect(series2.optical[0]).toBeNull();
    expect(series2.sonar[0]).toBeNull();
  });
});

describe("Ghost Replay paths (recorded observations only)", () => {
  it("splits the recorded ROV path at the fault into pre and post branches", () => {
    const { pre, post } = buildGhostPaths(RUN.snapshots, "rov-01", 10);
    expect(pre).not.toBeNull();
    expect(post).not.toBeNull();
    expect(pre!.fromSimMs).toBeLessThan(5000);
    expect(pre!.toSimMs).toBeLessThanOrEqual(5000);
    expect(post!.fromSimMs).toBeGreaterThanOrEqual(5000);
    expect(post!.toSimMs).toBe(6500);
    expect(pre!.fromSequence).toBe(1);
    expect(post!.toSequence).toBe(13);
  });

  it("both branches are finite scene-space points under the waterline", () => {
    const { pre, post } = buildGhostPaths(RUN.snapshots, "rov-01", 10);
    const allSegments = [...pre!.segments, ...post!.segments];
    for (const segment of allSegments) {
      for (const point of segment.points) {
        for (const axis of point) expect(Number.isFinite(axis)).toBe(true);
        expect(point[1]).toBeLessThan(0); // underwater
      }
    }
  });

  it("returns null branches when there is no fault or too few fresh samples", () => {
    expect(buildGhostPaths(RUN.snapshots, "rov-01", null).pre).toBeNull();
    const empty = validateDemoSimResponse(
      JSON.parse(
        readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107-empty.json"), "utf8"),
      ),
    );
    const ghost = buildGhostPaths(empty.snapshots, "rov-01", 0);
    expect(ghost.pre).toBeNull();
    expect(ghost.post).toBeNull();
  });

  it("does not invent a replacement robot: branches exist only for the requested robot", () => {
    const ghost = buildGhostPaths(RUN.snapshots, "replacement-rov-99", 10);
    expect(ghost.pre).toBeNull();
    expect(ghost.post).toBeNull();
  });

  it("splits segments where recorded observations are separated by a stale gap (no fabricated bridge)", () => {
    // Synthesize the recorded run with a stale/disconnected hole: snapshots
    // 5 and 6 become stale (kernel loses the link mid-run), then reconnect.
    // The builder must NOT draw a straight bridge across the unsupported
    // interval — the path splits into two segments at the hole.
    const withHole = JSON.parse(JSON.stringify(RUN.snapshots)) as typeof RUN.snapshots;
    for (const index of [5, 6]) {
      const snap = withHole[index]!;
      snap.robots = snap.robots.map((r) =>
        r.robotId === "rov-01"
          ? { ...r, fresh: false, staleness: "link-disconnected" as const, measuredNull: true }
          : r,
      );
    }
    // Widen the recorded time span so the reconnect is beyond the join gap.
    withHole[7]!.simulatorTimeMs += 12000;
    for (let i = 8; i < withHole.length; i += 1) withHole[i]!.simulatorTimeMs += 12000;

    const ghost = buildGhostPaths(withHole, "rov-01", 10);
    expect(ghost.pre).not.toBeNull();
    // Pre-fault branch: fresh samples 1..4 then 7..9 → two segments with a
    // suppressed bridge across the stale hole.
    expect(ghost.pre!.segments).toHaveLength(2);
    expect(ghost.pre!.suppressedBridges).toBeGreaterThanOrEqual(1);
    // Each segment is internally time-contiguous (no invented motion inside).
    for (const segment of ghost.pre!.segments) {
      expect(segment.toSimMs - segment.fromSimMs).toBeLessThanOrEqual(2500);
    }
  });

  it("keeps a single continuous segment when all fresh samples are contiguous", () => {
    const ghost = buildGhostPaths(RUN.snapshots, "rov-01", 10);
    // Pre-fault fresh samples (seq 1..10) are contiguous → exactly one segment.
    expect(ghost.pre!.segments).toHaveLength(1);
    expect(ghost.post!.segments).toHaveLength(1);
  });
});
