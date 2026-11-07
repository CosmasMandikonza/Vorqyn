import { describe, expect, it } from "vitest";

import {
  buildHarbor002Script,
  buildPort001Script,
  HARBOR_002,
  PORT_001,
  runEventScript,
} from "./fixtures";
import { deriveMissionState, rehydrate, type MissionProjection } from "./reducer";
import { validateMissionEvent } from "./events";

function projectOrThrow(events: readonly unknown[]): MissionProjection {
  const result = runEventScript(events as never);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

describe("fixture scripts are structurally valid", () => {
  it("every PORT-001 event passes envelope validation", () => {
    for (const event of buildPort001Script()) {
      expect(validateMissionEvent(event).ok).toBe(true);
    }
  });

  it("every HARBOR-002 event passes envelope validation", () => {
    for (const event of buildHarbor002Script()) {
      expect(validateMissionEvent(event).ok).toBe(true);
    }
  });
});

describe("PORT-001 flagship recovery loop", () => {
  it("replays the full observe -> fail -> recover -> verify -> settle story", () => {
    const state = projectOrThrow(buildPort001Script());

    // Sea task: rejected once, reassigned to v2, verified, paid exactly once.
    const sea = state.tasks[PORT_001.tasks.sea.taskId];
    expect(sea).toBeDefined();
    if (!sea) return;
    expect(sea.status).toBe("paid");
    expect(sea.currentAssignmentVersion).toBe(2);
    expect(Object.keys(sea.assignments)).toEqual(["1", "2"]);
    expect(sea.assignments[2]?.operatorId).toBe("operator-rov-b");
    expect(sea.assignments[2]?.chainSignature).toBeDefined();
    expect(sea.assignments[1]?.operatorId).toBe("operator-rov-a");
    expect(sea.acceptedEvidenceId).toBe("ev-sea-v2");
    expect(sea.recoveryProposal?.offerId).toBe("offer-rov-b-sonar");
    expect(sea.rejectedAlternatives[0]?.reasonCode).toBe("capability-mismatch");
    expect(sea.payoutSignature).toBeDefined();

    // Failed evidence stays audit-visible with its rejection reasons.
    expect(state.verdicts["ev-sea-v1"]?.accepted).toBe(false);
    expect(state.evidence["ev-sea-v1"]?.assignmentVersion).toBe(1);

    // Air + land completed cleanly at version 1.
    expect(state.tasks[PORT_001.tasks.air.taskId]?.status).toBe("paid");
    expect(state.tasks[PORT_001.tasks.air.taskId]?.currentAssignmentVersion).toBe(1);
    expect(state.tasks[PORT_001.tasks.land.taskId]?.status).toBe("paid");

    // Money: funded 3 SOL, paid 1.1 + 0.75 + 0.5 = 2.35 SOL, nothing committed.
    expect(state.fundedLamports).toBe(PORT_001.budgetLamports);
    expect(state.paidLamports).toBe(1_100_000_000 + 750_000_000 + 500_000_000);
    expect(state.committedRewardLamports).toBe(0);

    // Chain ledger: five transactions, all confirmed on devnet.
    expect(Object.keys(state.chain)).toHaveLength(5);
    for (const record of Object.values(state.chain)) {
      expect(record.cluster).toBe("devnet");
      expect(record.statusHistory[record.statusHistory.length - 1]).toBe("confirmed");
      expect(record.confirmedAtMs).toBeDefined();
    }

    // Derived mission state: everything terminal => completed.
    expect(deriveMissionState(state)).toBe("completed");
    expect(state.lifecycle).toBe("running"); // closed only via explicit event
    expect(state.timeline).toHaveLength(buildPort001Script().length);
  });

  it("mid-story states are inspectable (recovery_needed after rejection)", () => {
    const events = buildPort001Script();
    // Event 8 is task.evidenceRejected for the sea task.
    const cut = projectOrThrow(events.slice(0, 8));
    const sea = cut.tasks[PORT_001.tasks.sea.taskId];
    expect(sea?.status).toBe("evidence_insufficient");
    expect(deriveMissionState(cut)).toBe("recovery_needed");
  });
});

describe("HARBOR-002 isolation and distinct configuration", () => {
  it("is a genuinely different mission, not a replay of PORT-001", () => {
    const state = projectOrThrow(buildHarbor002Script());
    expect(state.missionId).toBe(HARBOR_002.missionId);
    expect(state.config.organizationId).toBe(HARBOR_002.organizationId);
    expect(state.config.organizationId).not.toBe(PORT_001.organizationId);
    expect(state.config.budgetLamports).not.toBe(PORT_001.budgetLamports);
    expect(state.config.templateId).not.toBe(PORT_001.templateId);
    expect(Object.keys(state.tasks)).not.toContain(PORT_001.tasks.sea.taskId);

    const air = state.tasks[HARBOR_002.tasks.air.taskId];
    expect(air?.status).toBe("paid");
    expect(air?.currentAssignmentVersion).toBe(1);
    expect(state.paidLamports).toBe(420_000_000);
    expect(deriveMissionState(state)).toBe("completed");
  });

  it("PORT-001 entities do not leak into HARBOR-002 and vice versa", () => {
    const p1 = projectOrThrow(buildPort001Script());
    const h2 = projectOrThrow(buildHarbor002Script());
    const p1Evidence = new Set(Object.keys(p1.evidence));
    for (const id of Object.keys(h2.evidence)) expect(p1Evidence.has(id)).toBe(false);
    const p1Chain = new Set(Object.keys(p1.chain));
    for (const sig of Object.keys(h2.chain)) expect(p1Chain.has(sig)).toBe(false);
  });
});

describe("rehydration from persisted JSON", () => {
  it("reproduces the exact projection byte-for-byte", () => {
    const events = buildPort001Script();
    const direct = projectOrThrow(events);
    const persisted = JSON.parse(JSON.stringify(events)) as unknown[];
    const restored = rehydrate(persisted);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.applied).toBe(events.length);
    expect(restored.value.duplicates).toBe(0);
    expect(JSON.stringify(restored.value.projection)).toBe(JSON.stringify(direct));
  });

  it("is idempotent when the log contains a duplicated event", () => {
    const events = buildHarbor002Script();
    const withDuplicate = JSON.parse(JSON.stringify(events)) as unknown[];
    withDuplicate.splice(3, 0, withDuplicate[2]); // insert an exact copy
    const restored = rehydrate(withDuplicate);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.duplicates).toBe(1);
    const clean = projectOrThrow(events);
    expect(JSON.stringify(restored.value.projection)).toBe(JSON.stringify(clean));
  });

  it("aborts safely on an unknown future event version, with its index", () => {
    const events = JSON.parse(JSON.stringify(buildPort001Script())) as Record<string, unknown>[];
    events[4] = { ...events[4], schemaVersion: 99 };
    const restored = rehydrate(events);
    expect(restored.ok).toBe(false);
    if (!restored.ok) {
      expect(restored.error.code).toBe("unsupported_schema_version");
      expect(restored.error.message).toContain("event[4]");
    }
  });

  it("aborts safely on a malformed payload deep in the log", () => {
    const events = JSON.parse(JSON.stringify(buildPort001Script())) as Record<string, unknown>[];
    const broken = events[6] as { payload: Record<string, unknown> };
    broken.payload = { taskId: 1234 }; // not an object-shaped evidence payload
    const restored = rehydrate(events);
    expect(restored.ok).toBe(false);
  });
});

describe("determinism", () => {
  it("identical scripts yield identical projections across runs", () => {
    const first = projectOrThrow(buildPort001Script());
    const second = projectOrThrow(buildPort001Script());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
