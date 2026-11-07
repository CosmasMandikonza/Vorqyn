/**
 * Telemetry bridge tests (issue #9 slice) — normalize REAL kernel snapshots
 * into contract-valid TelemetrySamples.
 *
 * Every normalized value in these tests comes from an actual
 * `createScenarioKernel` run (never hand-invented telemetry). The contract
 * validator `makeTelemetrySample` from packages/contracts is the acceptance
 * gate, exactly as the future mission orchestrator will consume it.
 */

import { describe, expect, it } from "vitest";
import { createScenarioKernel } from "../../../../services/simulation/demo/kernel-adapter.mjs";
import type { DemoSnapshot } from "../../../../services/simulation/demo/kernel-adapter.d.mts";
import { normalizeSnapshotToTelemetry } from "../../../../services/mission/simulation/telemetry-bridge";
import { FIXTURE_EPOCH_BASE_MS, applyTelemetrySample, type TelemetrySample } from "@vorqyn/contracts";

const RECEIPT_MS = FIXTURE_EPOCH_BASE_MS + 7; // deterministic fixture receipt, distinct domain from sim time
const MISSION = "guest-port-001";

function runKernelSnapshots(seed: number, script: (kernel: ReturnType<typeof createScenarioKernel>) => void): DemoSnapshot[] {
  const kernel = createScenarioKernel({ seed });
  script(kernel);
  return [...kernel.getObservationLog()];
}

describe("telemetry bridge — real kernel normalization", () => {
  it("checkpoint: one real kernel observation is normalized and applied through the contracts", () => {
    const snapshots = runKernelSnapshots(20261107, (kernel) => {
      kernel.step(1);
    });
    expect(snapshots).toHaveLength(1);
    const outcome = normalizeSnapshotToTelemetry(snapshots[0] as DemoSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const fresh = outcome.value.samples.filter((s) => s.emission === "fresh-sample");
    expect(fresh).toHaveLength(3); // all three roles fresh after the first step
    const rover = fresh.find((s) => s.sample.robotId === "rover-01");
    expect(rover).toBeDefined();
    if (!rover) return;
    const sample: TelemetrySample = rover.sample;
    // Contract envelope fields, sourced from the real kernel snapshot.
    expect(sample.missionId).toBe(MISSION);
    expect(sample.robotId).toBe("rover-01");
    expect(sample.sourceKind).toBe("SYNTHETIC_SIM");
    expect(sample.sourceTimestampMs).toBe(500); // kernel simulator clock, not a UTC epoch
    expect(sample.receivedAtMs).toBe(RECEIPT_MS);
    expect(sample.frameId).toBe("ENU_PORT-001_LOCAL");
    expect(sample.units).toBe("metres");
    expect(sample.sequence).toBe(1);
    expect(sample.quality.status).toBe("ok");
    // Real world-ENU coordinates from the kernel (trunk road, deck height).
    expect(sample.position).toEqual({ x: -160, y: 160, z: 4.05 });
    // Measured metric from the real sensor model.
    expect(sample.qualityMetric?.kind).toBe("rover-01-optical");
    expect(sample.qualityMetric?.value).toBeGreaterThan(0.85);

    // The contracts' own application rule accepts the sample.
    const applied = applyTelemetrySample({}, sample);
    expect(applied.ok).toBe(true);
  });

  it("robot coordinates match the world ENU frame across all roles", () => {
    const snapshots = runKernelSnapshots(4242, (kernel) => {
      kernel.step(4);
    });
    const outcome = normalizeSnapshotToTelemetry(snapshots[3] as DemoSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const normalized of outcome.value.samples) {
      const source = (snapshots[3] as DemoSnapshot).robots.find((r) => r.robotId === normalized.sample.robotId);
      expect(source).toBeDefined();
      expect(normalized.sample.position).toEqual(source?.pose);
    }
    const rover = outcome.value.samples.find((s) => s.sample.robotId === "rover-01");
    const rov = outcome.value.samples.find((s) => s.sample.robotId === "rov-01");
    const drone = outcome.value.samples.find((s) => s.sample.robotId === "drone-01");
    expect(rover?.sample.position.z).toBe(4.05); // deck surface
    expect((rov?.sample.position.z ?? 0) < 0).toBe(true); // submerged
    expect((drone?.sample.position.z ?? 0)).toBeGreaterThanOrEqual(15); // aerial band
  });

  it("a severe ROV optical fault marks samples degraded with the real measured drop; sonar stays independent", () => {
    const snapshots = runKernelSnapshots(20261107, (kernel) => {
      kernel.step(10);
      kernel.issueCommand({
        type: "injectOpticalVisibilityFault",
        robotId: "rov-01",
        severity: "severe",
        durationMs: 60000,
        idempotencyKey: "bridge-fault-1",
      });
      kernel.step(3);
    });
    const cleanOutcome = normalizeSnapshotToTelemetry(snapshots[4] as DemoSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    const faultedOutcome = normalizeSnapshotToTelemetry(snapshots[11] as DemoSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(cleanOutcome.ok).toBe(true);
    expect(faultedOutcome.ok).toBe(true);
    if (!cleanOutcome.ok || !faultedOutcome.ok) return;

    const cleanRov = cleanOutcome.value.samples.find((s) => s.sample.robotId === "rov-01");
    const faultedRov = faultedOutcome.value.samples.find((s) => s.sample.robotId === "rov-01");
    expect(cleanRov?.sample.quality.status).toBe("ok");
    expect(faultedRov?.sample.quality.status).toBe("degraded");
    expect(faultedRov?.sample.quality.detail).toBe("optical-visibility-fault-active");
    // Measured values actually changed (factor 0.12 applied by the kernel).
    const cleanValue = cleanRov?.sample.qualityMetric?.value ?? 0;
    const faultedValue = faultedRov?.sample.qualityMetric?.value ?? 1;
    expect(cleanValue).toBeGreaterThan(0.69);
    expect(faultedValue).toBeLessThan(0.09);
    // Sonar is preserved independently in the underlying kernel observation.
    const rovSource = (snapshots[11] as DemoSnapshot).robots.find((r) => r.robotId === "rov-01");
    const sonar = rovSource?.sensors.find((s) => s.sensorId === "rov-01-sonar");
    expect(sonar?.measured?.quality01).toBeGreaterThan(0.6);
    expect(sonar?.measured?.quality01).toBeLessThan(0.66);
    // Drone/rover are unaffected by the underwater fault.
    const faultedDrone = faultedOutcome.value.samples.find((s) => s.sample.robotId === "drone-01");
    expect(faultedDrone?.sample.quality.status).toBe("ok");
  });

  it("paused snapshots produce no telemetry (nothing fabricated)", () => {
    const snapshots = runKernelSnapshots(20261107, (kernel) => {
      kernel.step(1);
      kernel.issueCommand({ type: "pause", idempotencyKey: "bridge-pause" });
      kernel.step(1);
    });
    const pausedSnapshot = snapshots[1] as DemoSnapshot;
    expect(pausedSnapshot.kernelState).toBe("paused");
    const outcome = normalizeSnapshotToTelemetry(pausedSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.samples).toHaveLength(0);
    expect(outcome.value.skipped).toHaveLength(3);
    expect(outcome.value.skipped.every((s) => s.emission === "skipped-paused")).toBe(true);
  });

  it("disconnected robots produce link_disconnected markers on the frozen last-authoritative pose", () => {
    const snapshots = runKernelSnapshots(20261107, (kernel) => {
      kernel.step(2);
      kernel.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "bridge-disc" });
      kernel.step(2);
    });
    const outcome = normalizeSnapshotToTelemetry(snapshots[3] as DemoSnapshot, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const marker = outcome.value.samples.find((s) => s.sample.robotId === "rov-01");
    expect(marker?.emission).toBe("link-down-marker");
    expect(marker?.sample.quality.status).toBe("link_disconnected");
    expect(marker?.sample.qualityMetric).toBeUndefined(); // no fresh measurement claimed
    const rovSource = (snapshots[3] as DemoSnapshot).robots.find((r) => r.robotId === "rov-01");
    expect(marker?.sample.position).toEqual(rovSource?.pose); // frozen pose
    expect(rovSource?.fresh).toBe(false);
    // The other roles remain fresh samples.
    const rover = outcome.value.samples.find((s) => s.sample.robotId === "rover-01");
    expect(rover?.emission).toBe("fresh-sample");
    expect(rover?.sample.quality.status).toBe("ok");
  });
});

describe("telemetry bridge — tampered input rejection", () => {
  function tamper(snapshot: DemoSnapshot, mutate: (clone: Record<string, unknown>) => void): DemoSnapshot {
    const clone = structuredClone(snapshot) as unknown as Record<string, unknown>;
    mutate(clone);
    return clone as unknown as DemoSnapshot;
  }

  it("a forged source kind is rejected (kernel provenance is authoritative)", () => {
    const snapshots = runKernelSnapshots(1, (kernel) => kernel.step(1));
    const tampered = tamper(snapshots[0] as DemoSnapshot, (clone) => {
      (clone.provenance as Record<string, unknown>).sourceKind = "LIVE_SITL";
    });
    const outcome = normalizeSnapshotToTelemetry(tampered, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("SYNTHETIC_SIM");
  });

  it("an invalid frame id is rejected by the contract frame pattern", () => {
    const snapshots = runKernelSnapshots(1, (kernel) => kernel.step(1));
    const tampered = tamper(snapshots[0] as DemoSnapshot, (clone) => {
      (clone.provenance as Record<string, unknown>).frameId = "ENU_bad frame";
    });
    const outcome = normalizeSnapshotToTelemetry(tampered, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("frame");
  });

  it("unsupported units are rejected", () => {
    const snapshots = runKernelSnapshots(1, (kernel) => kernel.step(1));
    const tampered = tamper(snapshots[0] as DemoSnapshot, (clone) => {
      (clone.provenance as Record<string, unknown>).positionUnits = "ft";
    });
    const outcome = normalizeSnapshotToTelemetry(tampered, { missionId: MISSION, receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("positionUnits");
  });

  it("an invalid service receipt timestamp is rejected (EpochMs domain)", () => {
    const snapshots = runKernelSnapshots(1, (kernel) => kernel.step(1));
    const outcome = normalizeSnapshotToTelemetry(snapshots[0] as DemoSnapshot, { missionId: MISSION, receivedAtMs: -5 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("epoch");
  });

  it("an invalid mission id is rejected by the contracts ID rule", () => {
    const snapshots = runKernelSnapshots(1, (kernel) => kernel.step(1));
    const outcome = normalizeSnapshotToTelemetry(snapshots[0] as DemoSnapshot, { missionId: "Guest Mission!", receivedAtMs: RECEIPT_MS });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("must match");
  });
});
