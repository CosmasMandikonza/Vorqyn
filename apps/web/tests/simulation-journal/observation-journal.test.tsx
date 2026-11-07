/**
 * Guest observation journal tests (issue #9 slice) — determinism, replay,
 * isolation and defenses, all driven by REAL kernel observation snapshots.
 *
 * Acceptance behaviors covered:
 *  1. same seed + operations  -> equivalent normalized records (canonical JSON)
 *  2. robot coordinates in the real world ENU frame        (bridge tests)
 *  3. replaying the journal reproduces the same observations
 *  4. two distinct mission/session streams remain isolated
 *  5. duplicate/out-of-order samples never change the accepted pose
 *  6. disconnected/paused sensors are not labeled fresh
 *  7. severe ROV optical fault changes measured values; sonar independent
 *  8. invalid source kind/frame/units/timestamp rejected   (bridge tests)
 *  9. no guest record claims funded/verified/paid without authority
 *     (structural scan + the authoritative reducer's own rejection)
 */

import { describe, expect, it } from "vitest";
import { createScenarioKernel } from "../../../../services/simulation/demo/kernel-adapter.mjs";
import type { DemoSnapshot, DemoKernel } from "../../../../services/simulation/demo/kernel-adapter.d.mts";
import {
  appendKernelSnapshot,
  canonicalJournal,
  createGuestObservationJournal,
  lastAcceptedSequence,
  replayJournal,
} from "../../../../services/mission/simulation/observation-journal";
import { initMissionProjection } from "@vorqyn/contracts";

const MISSION_A = "guest-port-001";
const MISSION_B = "guest-port-002";

function runFaultScenario(seed: number): { snapshots: DemoSnapshot[]; kernel: DemoKernel } {
  const kernel = createScenarioKernel({ seed });
  kernel.step(10);
  kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 9000,
    idempotencyKey: "journal-fault",
  });
  kernel.step(20); // spans the fault window and expiry (fault ends at t=19000)
  return { snapshots: [...kernel.getObservationLog()], kernel };
}

function journalFromSnapshots(missionId: string, seed: number, snapshots: DemoSnapshot[]) {
  const created = createGuestObservationJournal({ missionId, seed });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("journal creation failed");
  let journal = created.value;
  for (const snapshot of snapshots) {
    const result = appendKernelSnapshot(journal, snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) journal = result.journal;
  }
  return journal;
}

describe("journal determinism and replay", () => {
  it("acceptance 1: same seed + operations produce an equivalent normalized journal", () => {
    const { snapshots } = runFaultScenario(20261107);
    const a = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const b = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    expect(canonicalJournal(b)).toBe(canonicalJournal(a));
    expect(a.records).toHaveLength(snapshots.length);
    // Every record keeps the full source identity.
    for (const record of a.records) {
      expect(record.journalSchema).toBe("vorqyn.guest-observation-journal/1");
      expect(record.missionId).toBe(MISSION_A);
      expect(record.seed).toBe(20261107);
      expect(record.snapshot.provenance.sourceKind).toBe("SYNTHETIC_SIM");
      expect(record.snapshot.provenance.frameId).toBe("ENU_PORT-001_LOCAL");
    }
  });

  it("acceptance 3: replaying the journal reproduces identical observations and sequence tracks", () => {
    const { snapshots } = runFaultScenario(20261107);
    const journal = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const replayA = replayJournal(journal);
    const replayB = replayJournal(journal);
    expect(replayA.ok).toBe(true);
    expect(replayB.ok).toBe(true);
    if (!replayA.ok || !replayB.ok) return;
    expect(JSON.stringify(replayB.value)).toBe(JSON.stringify(replayA.value));

    // Same conversion as at append time.
    for (const [index, record] of journal.records.entries()) {
      const storedSamples = record.telemetry.map((t) => t.sample);
      const snapshotCount = record.snapshot.kernelState === "paused" ? 0 : 3;
      expect(storedSamples).toHaveLength(snapshotCount);
      void index;
    }
    // Poses recovered at the end of the run match the last real snapshot.
    const lastSnapshot = snapshots[snapshots.length - 1] as DemoSnapshot;
    for (const robot of lastSnapshot.robots) {
      expect(replayA.value.lastPoseByRobot[robot.robotId]).toEqual(robot.pose);
      expect(replayA.value.lastFreshnessByRobot[robot.robotId]).toEqual({
        fresh: robot.fresh,
        staleness: robot.staleness,
        linkState: robot.linkState,
      });
    }
    // Per-robot sequences strictly increased to the kernel's final snapshot sequence.
    for (const [robotId, track] of Object.entries(replayA.value.telemetryStore)) {
      expect(track.lastSequence).toBeLessThanOrEqual(lastSnapshot.sequence);
      expect(track.lastSample.robotId).toBe(robotId);
    }
  });

  it("fault timeline is recovered: starts with the injection, ends at expiry", () => {
    const { snapshots } = runFaultScenario(20261107);
    const journal = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const replay = replayJournal(journal);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const rovTransitions = replay.value.faultTimeline.filter((t) => t.robotId === "rov-01");
    expect(rovTransitions).toHaveLength(2);
    expect(rovTransitions[0]).toEqual({ robotId: "rov-01", simulatorTimeMs: 5500, phase: "fault-started", severity: "severe" });
    // Injected at t=5000 with duration 9000: the step starting at 14000 is
    // the first clean one, so the fault-ended marker lands at t=14500.
    expect(rovTransitions[1]?.phase).toBe("fault-ended");
    expect(rovTransitions[1]?.severity).toBeNull();
    expect(rovTransitions[1]?.simulatorTimeMs).toBe(14500);
  });
});

describe("journal defenses", () => {
  it("acceptance 5: duplicate and regressed snapshots never change the accepted pose", () => {
    const { snapshots } = runFaultScenario(20261107);
    const created = createGuestObservationJournal({ missionId: MISSION_A, seed: 20261107 });
    if (!created.ok) throw new Error("unreachable");
    let journal = created.value;
    for (const snapshot of snapshots.slice(0, 5)) {
      const result = appendKernelSnapshot(journal, snapshot);
      if (result.ok) journal = result.journal;
    }
    const before = replayJournal(journal);
    const recordsBefore = journal.records.length;

    // Duplicate delivery of the newest snapshot.
    const duplicate = appendKernelSnapshot(journal, snapshots[4] as DemoSnapshot);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("duplicate_or_regressed_sequence");
      journal = duplicate.journal;
    }
    // Regressed delivery of an older snapshot.
    const regressed = appendKernelSnapshot(journal, snapshots[1] as DemoSnapshot);
    expect(regressed.ok).toBe(false);
    if (!regressed.ok) {
      expect(regressed.error.code).toBe("duplicate_or_regressed_sequence");
      journal = regressed.journal;
    }

    expect(journal.records).toHaveLength(recordsBefore); // accepted history unchanged
    expect(journal.rejectedAppends).toHaveLength(2);
    expect(lastAcceptedSequence(journal)).toBe(5);
    const after = replayJournal(journal);
    expect(after.ok).toBe(true);
    expect(before.ok).toBe(true);
    if (after.ok && before.ok) {
      expect(after.value.lastPoseByRobot).toEqual(before.value.lastPoseByRobot);
    }
    // A newer snapshot still appends cleanly afterwards (audit did not corrupt the stream).
    const next = appendKernelSnapshot(journal, snapshots[5] as DemoSnapshot);
    expect(next.ok).toBe(true);
  });

  it("cross-stream contamination is rejected (seed/scenario mismatch)", () => {
    const { snapshots } = runFaultScenario(20261107);
    const created = createGuestObservationJournal({ missionId: MISSION_A, seed: 999 });
    if (!created.ok) throw new Error("unreachable");
    const result = appendKernelSnapshot(created.value, snapshots[0] as DemoSnapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("cross_stream_contamination");
      expect(result.journal.records).toHaveLength(0);
    }
  });

  it("tolerated sequence gaps are audited, not healed", () => {
    const { snapshots } = runFaultScenario(20261107);
    const created = createGuestObservationJournal({ missionId: MISSION_A, seed: 20261107 });
    if (!created.ok) throw new Error("unreachable");
    let journal = created.value;
    const first = appendKernelSnapshot(journal, snapshots[0] as DemoSnapshot);
    expect(first.ok).toBe(true);
    if (first.ok) journal = first.journal;
    // A later snapshot arrives with a gap in between (lost records).
    const crafted = { ...snapshots[2], sequence: (snapshots[2]?.sequence ?? 0) + 50 } as DemoSnapshot;
    const gapped = appendKernelSnapshot(journal, crafted);
    expect(gapped.ok).toBe(true);
    if (gapped.ok) journal = gapped.journal;
    expect(journal.sequenceGaps).toEqual([{ fromSequence: 1, toSequence: 53 }]);
  });

  it("the journal is bounded: appends beyond the cap are rejected with records intact", () => {
    const { snapshots } = runFaultScenario(20261107);
    const created = createGuestObservationJournal({ missionId: MISSION_A, seed: 20261107, maxRecords: 3 });
    if (!created.ok) throw new Error("unreachable");
    let journal = created.value;
    for (let i = 0; i < 4; i += 1) {
      const result = appendKernelSnapshot(journal, snapshots[i] as DemoSnapshot);
      if (i < 3) {
        expect(result.ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("journal_full");
      }
      journal = result.journal;
    }
    expect(journal.records).toHaveLength(3);
  });

  it("invalid creation input is rejected (mission id rule, seed domain)", () => {
    expect(createGuestObservationJournal({ missionId: "GUEST", seed: 1 }).ok).toBe(false);
    expect(createGuestObservationJournal({ missionId: MISSION_A, seed: -1 }).ok).toBe(false);
    expect(createGuestObservationJournal({ missionId: MISSION_A, seed: 1, maxRecords: 0 }).ok).toBe(false);
  });
});

describe("isolation and honesty", () => {
  it("acceptance 4: two distinct mission streams remain isolated", () => {
    const runA = runFaultScenario(111);
    const kernelB = createScenarioKernel({ seed: 222 });
    kernelB.step(5);
    const runB = { snapshots: [...kernelB.getObservationLog()] };

    const createdA = createGuestObservationJournal({ missionId: MISSION_A, seed: 111 });
    const createdB = createGuestObservationJournal({ missionId: MISSION_B, seed: 222 });
    if (!createdA.ok || !createdB.ok) throw new Error("unreachable");
    let journalA = createdA.value;
    let journalB = createdB.value;

    // Interleave appends across the two streams.
    const maxLen = Math.max(runA.snapshots.length, runB.snapshots.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (i < runA.snapshots.length) {
        const r = appendKernelSnapshot(journalA, runA.snapshots[i] as DemoSnapshot);
        if (r.ok) journalA = r.journal;
      }
      if (i < runB.snapshots.length) {
        const r = appendKernelSnapshot(journalB, runB.snapshots[i] as DemoSnapshot);
        if (r.ok) journalB = r.journal;
      }
    }

    expect(journalA.missionId).toBe(MISSION_A);
    expect(journalB.missionId).toBe(MISSION_B);
    for (const record of journalA.records) {
      expect(record.missionId).toBe(MISSION_A);
      expect(record.seed).toBe(111);
      expect(record.telemetry.every((t) => t.sample.missionId === MISSION_A)).toBe(true);
    }
    for (const record of journalB.records) {
      expect(record.missionId).toBe(MISSION_B);
      expect(record.seed).toBe(222);
    }
    // A runs through an optical fault (degraded ROV samples inside the
    // window, ending at t=14500); B is clean throughout — no cross-stream
    // bleed in either direction. Note the LAST sample of A is post-expiry
    // and therefore "ok": degradation must be asserted within the window.
    const replayA = replayJournal(journalA);
    const replayB = replayJournal(journalB);
    expect(replayA.ok).toBe(true);
    expect(replayB.ok).toBe(true);
    if (replayA.ok && replayB.ok) {
      const degradedA = journalA.records.some((r) =>
        r.telemetry.some((t) => t.sample.robotId === "rov-01" && t.sample.quality.status === "degraded"),
      );
      const degradedB = journalB.records.some((r) =>
        r.telemetry.some((t) => t.sample.robotId === "rov-01" && t.sample.quality.status === "degraded"),
      );
      expect(degradedA).toBe(true);
      expect(degradedB).toBe(false);
      expect(replayA.value.faultTimeline.some((t) => t.phase === "fault-started")).toBe(true);
      expect(replayB.value.faultTimeline.some((t) => t.phase === "fault-started")).toBe(false);
    }
  });

  it("acceptance 6: disconnected and paused sensors are never labeled fresh in the journal", () => {
    const kernel = createScenarioKernel({ seed: 20261107 });
    kernel.step(2);
    kernel.issueCommand({ type: "pause", idempotencyKey: "j-pause" });
    kernel.step(1);
    kernel.issueCommand({ type: "resume", idempotencyKey: "j-resume" });
    kernel.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "j-disc" });
    kernel.step(2);
    const snapshots = [...kernel.getObservationLog()];

    const journal = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const replay = replayJournal(journal);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const rov = replay.value.lastFreshnessByRobot["rov-01"];
    expect(rov?.fresh).toBe(false);
    expect(rov?.staleness).toBe("link-disconnected");
    // The paused snapshot is stored verbatim but produced no telemetry.
    const pausedRecord = journal.records.find((r) => r.snapshot.kernelState === "paused");
    expect(pausedRecord).toBeDefined();
    expect(pausedRecord?.telemetry).toHaveLength(0);
    // The rov link-down marker sample is explicit.
    const discRecord = journal.records[journal.records.length - 1];
    const marker = discRecord?.telemetry.find((t) => t.sample.robotId === "rov-01");
    expect(marker?.emission).toBe("link-down-marker");
    expect(marker?.sample.quality.status).toBe("link_disconnected");
  });

  it("acceptance 9: no guest record claims funded/verified/paid or any chain authority", () => {
    const { snapshots } = runFaultScenario(20261107);
    const journal = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const serialized = canonicalJournal(journal);
    expect(serialized).not.toMatch(/funded|funding|verified|paid|escrow|payout|chainTime|transactionSignature|verdict|mission\.|launched|recovery/i);
    // Lifecycle structurally absent: the only schema tag is the guest journal.
    expect(serialized).toContain('"journalSchema":"vorqyn.guest-observation-journal/1"');

    // And the authoritative reducer would reject a fabricated launch for this
    // guest stream: without a real mission.created transition from the mission
    // authority, guest telemetry can never become a mission event.
    const fabricated = {
      eventId: "evt-fake-launch-0001",
      missionId: MISSION_A,
      sequence: 1,
      kind: "mission.launched",
      payload: { reason: "guest demo wants to look launched" },
      occurredAtMs: 1762000000000,
      observedAtMs: 1762000000000,
      schemaVersion: 1,
    };
    const projection = initMissionProjection(fabricated);
    expect(projection.ok).toBe(false);
    if (!projection.ok) expect(projection.error.code).toBe("illegal_transition");
    // Note: the reducer validates TRANSITION LEGALITY, not real-world truth —
    // a hand-built draft projection would legally accept a mission.launched
    // event. That is exactly why the authority boundary sits ABOVE the
    // reducer: only the real mission orchestrator (with funding/launch
    // authority) may append lifecycle events. This journal produces none.
  });

  it("receivedAtMs stays a distinct service-receipt domain (fixture base, caller-overridable)", () => {
    const { snapshots } = runFaultScenario(20261107);
    const journal = journalFromSnapshots(MISSION_A, 20261107, snapshots);
    const first = journal.records[0];
    // Fixture receipt clock: contracts FIXTURE_EPOCH_BASE_MS + ordinal — a
    // different domain from the kernel's small simulator milliseconds.
    expect(first?.receivedAtMs).toBe(1762000000000);
    expect(first?.receivedAtMs).not.toBe(first?.snapshot.simulatorTimeMs);
    for (const [index, record] of journal.records.entries()) {
      expect(record.receivedAtMs).toBe(1762000000000 + index);
    }
    // A real orchestrator would pass actual receipt epochs; they are honored.
    const created = createGuestObservationJournal({ missionId: MISSION_A, seed: 20261107 });
    if (!created.ok) throw new Error("unreachable");
    const result = appendKernelSnapshot(created.value, snapshots[0] as DemoSnapshot, { receivedAtMs: 1762999999999 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.journal.records[0]?.receivedAtMs).toBe(1762999999999);
    }
    // No chain timestamp exists anywhere in the journal.
    expect(canonicalJournal(journal)).not.toContain("chainTimeMs");
  });
});
