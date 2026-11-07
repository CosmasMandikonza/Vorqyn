import { describe, expect, it } from "vitest";

import type { MissionEvent } from "./events";
import { applyEvent, deriveMissionState, initMissionProjection, TASK_TRANSITIONS, type MissionProjection } from "./reducer";
import { FIXTURE_SIG_FUNDING, stampScript } from "./fixtures";

const T = 1_762_000_000_000;
const BUDGET = 2_000_000_000;
const TASK_MAX = 1_500_000_000;

/** Minimal launched mission with one task, ready for assignment. */
function baseLaunchedEvents(): MissionEvent[] {
  return stampScript("port-001", [
    {
      kind: "mission.created",
      occurredAtMs: T,
      commandId: "cmd-create",
      payload: {
        config: {
          missionId: "port-001",
          organizationId: "port-authority",
          templateId: "tpl-test",
          siteLabel: "test site",
          budgetLamports: BUDGET,
          tasks: [{ taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: TASK_MAX, acceptancePolicyId: "policy-1" }],
        },
      },
    },
    { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-fund", payload: { kind: "funding", transactionSignature: FIXTURE_SIG_FUNDING, cluster: "devnet", amountLamports: BUDGET } },
    { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: FIXTURE_SIG_FUNDING, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
    { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-launch", payload: {} },
  ]);
}

interface Base {
  state: MissionProjection;
  events: MissionEvent[];
}

function launchedBase(): Base {
  const events = baseLaunchedEvents();
  const init = initMissionProjection(events[0] as never);
  if (!init.ok) throw new Error(`fixture broken: ${init.error.message}`);
  let state = init.value;
  for (const event of events.slice(1)) {
    const result = applyEvent(state, event);
    if (!result.ok) throw new Error(`fixture broken at ${event.kind}: ${result.error.message}`);
    state = result.state;
  }
  return { state, events };
}

const assignedSeed = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  taskId: "task-x",
  operatorId: "operator-a",
  robotId: "rov-a",
  quoteLamports: 1_000_000_000,
  ...overrides,
});

/** Apply extra seeds to a base, stamping sequences continuing from base. */
function extend(base: Base, seeds: readonly { kind: MissionEvent["kind"]; payload: unknown; occurredAtMs: number; simulatorTimeMs?: number; chainTimeMs?: number; commandId?: string }[]) {
  const stamped = stampScript("port-001", seeds).map((event, index) => ({ ...event, sequence: base.events.length + index + 1, eventId: `evt-ext-${base.events.length + index + 1}` })) as MissionEvent[];
  let state = base.state;
  const applied: MissionEvent[] = [];
  for (const event of stamped) {
    const result = applyEvent(state, event);
    if (!result.ok) return { ok: false as const, error: result.error, state, event };
    state = result.state;
    applied.push(event);
  }
  return { ok: true as const, state, applied };
}

describe("mission lifecycle gating", () => {
  it("launch is impossible before funding is confirmed", () => {
    const events = baseLaunchedEvents().slice(0, 2); // created + funding submitted only
    const init = initMissionProjection(events[0] as never);
    if (!init.ok) throw new Error(init.error.message);
    const afterFunding = applyEvent(init.value, events[1] as never);
    expect(afterFunding.ok).toBe(true);
    if (!afterFunding.ok) return;
    const launch = stampScript("port-001", [{ kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} }])[0];
    const result = applyEvent(afterFunding.state, { ...launch, sequence: 3, eventId: "evt-launch-early" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_transition");
  });

  it("lifecycle: draft -> ready (funding confirmed) -> running -> closed", () => {
    const base = launchedBase();
    expect(base.state.lifecycle).toBe("running");
    const closed = extend(base, [
      { kind: "task.cancelled", occurredAtMs: T + 300, commandId: "cmd-cancel", payload: { taskId: "task-x", reason: "test teardown" } },
      { kind: "mission.closed", occurredAtMs: T + 400, commandId: "cmd-close", payload: { reason: "all tasks terminal" } },
    ]);
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.state.lifecycle).toBe("closed");
      expect(deriveMissionState(closed.state)).toBe("closed");
    }
  });

  it("closing with an unsettled task is refused", () => {
    const base = launchedBase();
    const result = extend(base, [{ kind: "mission.closed", occurredAtMs: T + 300, commandId: "cmd-close", payload: { reason: "too early" } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_transition");
  });

  it("derived states: recovery_needed and verifying during the fault loop", () => {
    const base = launchedBase();
    const rejected = extend(base, [
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s1", payload: { taskId: "task-x", robotId: "rov-a" } },
      {
        kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e1",
        payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p1", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } },
      },
    ]);
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(deriveMissionState(rejected.state)).toBe("verifying");

    const failed = extend(rejected.ok ? { state: rejected.state, events: [...base.events, ...rejected.applied] } : base, [
      { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v1", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["rule-vis"], verifierId: "v1", verdictVersion: "v1", decidedAtMs: T + 590 } } },
    ]);
    expect(failed.ok).toBe(true);
    if (failed.ok) expect(deriveMissionState(failed.state)).toBe("recovery_needed");
  });
});

describe("task state machine (table-driven)", () => {
  it("TASK_TRANSITIONS has no outgoing edges from terminal states", () => {
    expect(TASK_TRANSITIONS.paid).toHaveLength(0);
    expect(TASK_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("illegal: execution cannot start before assignment", () => {
    const base = launchedBase();
    const result = extend(base, [{ kind: "task.executionStarted", occurredAtMs: T + 300, simulatorTimeMs: 1, commandId: "cmd-x", payload: { taskId: "task-x", robotId: "rov-a" } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_transition");
  });

  it("illegal: a verified task cannot be reassigned (already finished)", () => {
    const base = launchedBase();
    const verified = extend(base, [
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s1", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e1", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p1", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceAccepted", occurredAtMs: T + 600, commandId: "cmd-v1", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: true, reasons: ["ok"], verifierId: "v1", verdictVersion: "v1", decidedAtMs: T + 590 } } },
    ]);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const reassign = extend({ state: verified.state, events: [...base.events, ...verified.applied] }, [
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 700, commandId: "cmd-r1", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "offer-b", quoteLamports: 900_000_000, authorizedBy: "owner", transactionSignature: "VQsigReassignTx" + "1".repeat(73) } },
    ]);
    expect(reassign.ok).toBe(false);
    if (!reassign.ok) expect(reassign.error.code).toBe("illegal_transition");
  });

  it("illegal: evidence_insufficient task cannot silently resume executing", () => {
    const base = launchedBase();
    const start = extend(base, [
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s1", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e1", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p1", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v1", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["vis"], verifierId: "v1", verdictVersion: "v1", decidedAtMs: T + 590 } } },
    ]);
    expect(start.ok).toBe(true);
    const resume = extend(start.ok ? { state: start.state, events: [...base.events, ...start.applied] } : base, [
      { kind: "task.executionStarted", occurredAtMs: T + 700, simulatorTimeMs: 3_000, commandId: "cmd-s2", payload: { taskId: "task-x", robotId: "rov-a" } },
    ]);
    expect(resume.ok).toBe(false);
    if (!resume.ok) expect(resume.error.code).toBe("illegal_transition");
  });

  it("reassignment requires evidence_insufficient or recovery_pending", () => {
    const base = launchedBase();
    const assigned = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() }]);
    const result = extend(assigned.ok ? { state: assigned.state, events: [...base.events, ...assigned.applied] } : base, [
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 400, commandId: "cmd-r1", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1, authorizedBy: "owner", transactionSignature: "VQsigReassignTx" + "1".repeat(73) } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_transition");
  });
});

describe("stale assignment versions (compare-and-set)", () => {
  it("rejects reassignment with a stale expectedVersion", () => {
    const base = launchedBase();
    const staged = extend(base, [
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s1", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e1", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p1", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v1", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["vis"], verifierId: "v1", verdictVersion: "v1", decidedAtMs: T + 590 } } },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: "VQsigReassignTx" + "1".repeat(73), cluster: "devnet", amountLamports: 900_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: "VQsigReassignTx" + "1".repeat(73), status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
    ]);
    expect(staged.ok).toBe(true);
    // Second actor still believes version is 0 (stale).
    const stale = extend(staged.ok ? { state: staged.state, events: [...base.events, ...staged.applied] } : base, [
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r-stale", payload: { taskId: "task-x", expectedVersion: 2, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "offer-b", quoteLamports: 900_000_000, authorizedBy: "owner", transactionSignature: "VQsigReassignTx" + "1".repeat(73) } },
    ]);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("stale_assignment_version");
  });

  it("rejects evidence submitted for a previous assignment version", () => {
    const base = launchedBase();
    const executing = extend(base, [
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s1", payload: { taskId: "task-x", robotId: "rov-a" } },
    ]);
    const result = extend(executing.ok ? { state: executing.state, events: [...base.events, ...executing.applied] } : base, [
      // Evidence claims version 2 while the current assignment is 1.
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e-stale", payload: { taskId: "task-x", evidence: { evidenceId: "ev-stale", taskId: "task-x", assignmentVersion: 2, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p1", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("stale_assignment_version");
  });
});

describe("idempotency and ordering", () => {
  it("replaying the identical event is a no-op duplicate", () => {
    const base = launchedBase();
    const assigned = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed() }]);
    if (!assigned.ok) throw new Error(assigned.error.message);
    const again = applyEvent(assigned.state, assigned.applied[0]);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.duplicate).toBe(true);
      expect(again.state).toBe(assigned.state); // untouched, same reference
    }
  });

  it("a commandId can never produce two different events", () => {
    const base = launchedBase();
    const first = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-dup", payload: assignedSeed() }]);
    expect(first.ok).toBe(true);
    const retry = extend(first.ok ? { state: first.state, events: [...base.events, ...first.applied] } : base, [
      { kind: "task.cancelled", occurredAtMs: T + 400, commandId: "cmd-dup", payload: { taskId: "task-x", reason: "retried command" } },
    ]);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error.code).toBe("duplicate_idempotency_key");
  });

  it("sequences must be gapless and strictly increasing", () => {
    const base = launchedBase();
    const skipped = stampScript("port-001", [{ kind: "mission.failed", occurredAtMs: T + 300, payload: { reason: "x" } }])[0];
    const result = applyEvent(base.state, { ...skipped, sequence: base.state.lastSequence + 2, eventId: "evt-skip" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");

    const repeated = applyEvent(base.state, { ...skipped, sequence: base.state.lastSequence, eventId: "evt-repeat" } as never);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.error.code).toBe("duplicate_sequence");
  });
});

describe("mission isolation", () => {
  it("events from another mission are refused", () => {
    const base = launchedBase();
    const foreign = stampScript("harbor-002", [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-foreign", payload: assignedSeed() }])[0];
    const result = applyEvent(base.state, { ...foreign, sequence: base.state.lastSequence + 1, eventId: "evt-foreign-1" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("cross_mission_reference");
  });

  it("a task belonging to another mission is unknown here", () => {
    const base = launchedBase();
    const result = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: assignedSeed({ taskId: "task-h2-air-scan" }) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_entity");
  });
});
