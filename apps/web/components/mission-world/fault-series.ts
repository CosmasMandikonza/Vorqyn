/**
 * Mission Fracture data builder (Issue #15, section B).
 *
 * Derives the measured optical/sonar time series and fault markers from
 * ACTUAL kernel snapshots — the same observations the 3D world renders.
 * Sonar is kept as a separate series by construction (the kernel models it
 * independently); this module must never merge or reconcile the two.
 *
 * This is measurement display only. The kernel never accepts or rejects
 * evidence, and no verifier exists in this demo path — the UI must not
 * describe this as "verification rejected".
 */
import type { DemoSnapshot } from "./demo-sim/contract";

export interface FaultMarker {
  /** Snapshot index where the fault first appears in the observations. */
  index: number;
  simulatorTimeMs: number;
  severity: string;
  faultId: string;
}

export interface FaultSeries {
  simTimes: number[];
  /** rov-01-optical measured quality per snapshot (null when no measurement). */
  optical: Array<number | null>;
  /** rov-01-sonar measured quality per snapshot (null when no measurement). */
  sonar: Array<number | null>;
  markers: FaultMarker[];
}

export function buildFaultSeries(
  snapshots: DemoSnapshot[],
  robotId = "rov-01",
): FaultSeries {
  const simTimes: number[] = [];
  const optical: Array<number | null> = [];
  const sonar: Array<number | null> = [];
  const markers: FaultMarker[] = [];
  const seenFaults = new Set<string>();

  for (const [index, snap] of snapshots.entries()) {
    simTimes.push(snap.simulatorTimeMs);
    const robot = snap.robots.find((r) => r.robotId === robotId);
    const opticalSensor = robot?.sensors.find((s) => s.kind === "optical");
    const sonarSensor = robot?.sensors.find((s) => s.kind === "sonar");
    optical.push(opticalSensor ? (opticalSensor.measured?.quality01 ?? null) : null);
    sonar.push(sonarSensor ? (sonarSensor.measured?.quality01 ?? null) : null);
    const fault = robot?.activeOpticalFault;
    if (fault && !seenFaults.has(fault.faultId)) {
      seenFaults.add(fault.faultId);
      markers.push({
        index,
        simulatorTimeMs: snap.simulatorTimeMs,
        severity: fault.severity,
        faultId: fault.faultId,
      });
    }
  }
  return { simTimes, optical, sonar, markers };
}

/** Snapshot index where the first fault appears, or null. */
export function faultStartIndex(series: FaultSeries): number | null {
  return series.markers.length > 0 ? series.markers[0]!.index : null;
}
