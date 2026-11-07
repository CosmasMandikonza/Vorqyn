import { describe, expect, it } from "vitest";

import { applyTelemetrySample, makeTelemetrySample, noteRejectedTelemetry, type TelemetrySample, type TelemetryStore } from "./telemetry";

const T = 1_762_000_000_000;

function sample(overrides: Record<string, unknown> = {}): TelemetrySample {
  const result = makeTelemetrySample({
    missionId: "port-001",
    robotId: "rov-a",
    sourceKind: "SYNTHETIC_SIM",
    sourceTimestampMs: 1_000,
    receivedAtMs: T,
    frameId: "ENU_PORT-001_LOCAL",
    sequence: 1,
    position: { x: 10, y: -5, z: -6.5 },
    orientationDeg: { heading: 45 },
    quality: { status: "ok" },
    ...overrides,
  } as Parameters<typeof makeTelemetrySample>[0]);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("telemetry sample validation", () => {
  it("accepts a world-frame-conformant sample and normalizes units", () => {
    const s = sample();
    expect(s.units).toBe("metres");
    expect(s.frameId).toBe("ENU_PORT-001_LOCAL");
  });

  it("rejects frames outside the ENU world contract", () => {
    const bad = makeTelemetrySample({
      missionId: "port-001", robotId: "rov-a", sourceKind: "SYNTHETIC_SIM", sourceTimestampMs: 1, receivedAtMs: T,
      frameId: "wgs-84", sequence: 1, position: { x: 0, y: 0, z: 0 }, quality: { status: "ok" },
    } as never);
    expect(bad.ok).toBe(false);
  });

  it("rejects fractional sequences and timestamps", () => {
    const badTimestamp = makeTelemetrySample({
      missionId: "port-001", robotId: "rov-a", sourceKind: "SYNTHETIC_SIM", sourceTimestampMs: 1.5, receivedAtMs: T,
      frameId: "ENU_PORT-001_LOCAL", sequence: 1, position: { x: 0, y: 0, z: 0 }, quality: { status: "ok" },
    } as never);
    expect(badTimestamp.ok).toBe(false);
    const badSequence = makeTelemetrySample({
      missionId: "port-001", robotId: "rov-a", sourceKind: "SYNTHETIC_SIM", sourceTimestampMs: 1, receivedAtMs: T,
      frameId: "ENU_PORT-001_LOCAL", sequence: 1.5, position: { x: 0, y: 0, z: 0 }, quality: { status: "ok" },
    } as never);
    expect(badSequence.ok).toBe(false);
  });
});

describe("deterministic sample application", () => {
  it("applies strictly increasing sequences per robot", () => {
    let store: TelemetryStore = {};
    const first = applyTelemetrySample(store, sample({ sequence: 1 }));
    expect(first.ok).toBe(true);
    if (first.ok) store = first.value;
    const second = applyTelemetrySample(store, sample({ sequence: 2, sourceTimestampMs: 1_500 }));
    expect(second.ok).toBe(true);
    if (second.ok) {
      store = second.value;
      expect(store["rov-a"]?.lastSequence).toBe(2);
      expect(store["rov-a"]?.rejectedCount).toBe(0);
    }
  });

  it("rejects duplicates and out-of-order deliveries without reordering", () => {
    let store: TelemetryStore = {};
    for (const seq of [1, 2, 3]) {
      const applied = applyTelemetrySample(store, sample({ sequence: seq }));
      expect(applied.ok).toBe(true);
      if (applied.ok) store = applied.value;
    }
    const duplicate = applyTelemetrySample(store, sample({ sequence: 3 }));
    expect(duplicate.ok).toBe(false);
    const reorder = applyTelemetrySample(store, sample({ sequence: 2, sourceTimestampMs: 900 }));
    expect(reorder.ok).toBe(false);
    expect(store["rov-a"]?.lastSequence).toBe(3); // authoritative pose untouched
  });

  it("keeps robots independent and counts rejections for audit", () => {
    let store: TelemetryStore = {};
    const rovA = applyTelemetrySample(store, sample({ sequence: 5 }));
    expect(rovA.ok).toBe(true);
    if (rovA.ok) store = rovA.value;
    const drone = applyTelemetrySample(store, sample({ robotId: "drone-c", sequence: 1, position: { x: 0, y: 0, z: 40 } }));
    expect(drone.ok).toBe(true);
    if (drone.ok) store = drone.value;
    const rejected = applyTelemetrySample(store, sample({ sequence: 1 }));
    expect(rejected.ok).toBe(false);
    store = noteRejectedTelemetry(store, "rov-a");
    expect(store["rov-a"]?.rejectedCount).toBe(1);
    expect(store["drone-c"]?.rejectedCount).toBe(0);
  });

  it("a link_disconnected sample freezes the last known pose as authoritative", () => {
    let store: TelemetryStore = {};
    const good = applyTelemetrySample(store, sample({ sequence: 7, position: { x: 3, y: 3, z: -2 } }));
    expect(good.ok).toBe(true);
    if (good.ok) store = good.value;
    const stale = applyTelemetrySample(store, sample({ sequence: 8, quality: { status: "link_disconnected", detail: "telemetry link loss" } }));
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      store = stale.value;
      // Caller renders lastSample while link is down; later fresh sample wins.
      expect(store["rov-a"]?.lastSample.quality.status).toBe("link_disconnected");
      const resumed = applyTelemetrySample(store, sample({ sequence: 9, quality: { status: "ok" } }));
      expect(resumed.ok).toBe(true);
    }
  });
});
