import { describe, expect, it } from "vitest";

import type { MissionEvent } from "./events";
import { applyEvent, initMissionProjection, type MissionProjection } from "./reducer";
import { FIXTURE_SIG_FUNDING, stampScript } from "./fixtures";
import { chainTxTransitionAllowed } from "./enums";

const T = 1_762_000_000_000;
const BUDGET = 2_000_000_000;
const SIG_REASSIGN = "VQsigReassignTx" + "1".repeat(73);
const SIG_PAYOUT = "VQsigPayoutSeaTx" + "1".repeat(72);

interface Base {
  state: MissionProjection;
  events: MissionEvent[];
}

/** Launched mission with task-x at evidence_insufficient (recovery path open). */
function recoveryBase(): Base {
  const events = stampScript("port-001", [
    {
      kind: "mission.created", occurredAtMs: T, commandId: "cmd-c", payload: {
        config: {
          missionId: "port-001", organizationId: "org-x", templateId: "tpl", siteLabel: "site", budgetLamports: BUDGET,
          tasks: [{ taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: 1_500_000_000, acceptancePolicyId: "p1" }],
        },
      },
    },
    { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: FIXTURE_SIG_FUNDING, cluster: "devnet", amountLamports: BUDGET } },
    { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: FIXTURE_SIG_FUNDING, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
    { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
    { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } },
    { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s", payload: { taskId: "task-x", robotId: "rov-a" } },
    { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
    { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["vis"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 590 } } },
  ]);
  const init = initMissionProjection(events[0] as never);
  if (!init.ok) throw new Error(init.error.message);
  let state = init.value;
  for (const event of events.slice(1)) {
    const result = applyEvent(state, event);
    if (!result.ok) throw new Error(`${event.kind}: ${result.error.message}`);
    state = result.state;
  }
  return { state, events };
}

function extend(base: Base, seeds: readonly { kind: MissionEvent["kind"]; payload: unknown; occurredAtMs: number; simulatorTimeMs?: number; chainTimeMs?: number; commandId?: string }[]) {
  const stamped = stampScript("port-001", seeds).map((event, index) => ({ ...event, sequence: base.events.length + index + 1, eventId: `evt-ext-${base.events.length + index + 1}` })) as MissionEvent[];
  let state = base.state;
  const applied: MissionEvent[] = [];
  for (const event of stamped) {
    const result = applyEvent(state, event);
    if (!result.ok) return { ok: false as const, error: result.error, event };
    state = result.state;
    applied.push(event);
  }
  return { ok: true as const, state, applied };
}

describe("chain status machine", () => {
  it("follows the monotone progression", () => {
    expect(chainTxTransitionAllowed("submitted", "processed")).toBe(true);
    expect(chainTxTransitionAllowed("processed", "confirmed")).toBe(true);
    expect(chainTxTransitionAllowed("confirmed", "finalized")).toBe(true);
    expect(chainTxTransitionAllowed("submitted", "confirmed")).toBe(true);
    expect(chainTxTransitionAllowed("unknown", "confirmed")).toBe(true);
    expect(chainTxTransitionAllowed("confirmed", "unknown")).toBe(true);
  });

  it("refuses backwards, repeated and post-terminal moves", () => {
    expect(chainTxTransitionAllowed("confirmed", "processed")).toBe(false);
    expect(chainTxTransitionAllowed("confirmed", "confirmed")).toBe(false);
    expect(chainTxTransitionAllowed("finalized", "unknown")).toBe(false);
    expect(chainTxTransitionAllowed("rejected", "confirmed")).toBe(false);
    expect(chainTxTransitionAllowed("expired", "confirmed")).toBe(false);
  });

  it("rejects status updates for unknown signatures", () => {
    const base = recoveryBase();
    const result = extend(base, [{ kind: "chain.transactionUpdated", occurredAtMs: T + 700, payload: { transactionSignature: "VQunknownSig" + "1".repeat(75), status: "confirmed" }, chainTimeMs: T + 700 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_entity");
  });

  it("rejects a confirmed update that lacks the chain clock", () => {
    const base = recoveryBase();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 } }, // no chainTimeMs
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("clock_domain_violation");
  });
});

describe("payment cannot precede confirmed chain truth", () => {
  it("rejects payment referencing a payout tx that is only submitted", () => {
    const base = recoveryBase();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN } },
      { kind: "task.executionStarted", occurredAtMs: T + 900, simulatorTimeMs: 3_000, commandId: "cmd-s2", payload: { taskId: "task-x", robotId: "rov-b" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 950, simulatorTimeMs: 4_000, commandId: "cmd-e2", payload: { taskId: "task-x", evidence: { evidenceId: "ev-2", taskId: "task-x", assignmentVersion: 2, operatorId: "operator-b", sampleRefs: ["s2"], policyVersion: "p", digest: "cd".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 940 } } },
      { kind: "task.evidenceAccepted", occurredAtMs: T + 990, commandId: "cmd-v2", payload: { taskId: "task-x", verdict: { evidenceId: "ev-2", accepted: true, reasons: ["ok"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 985 } } },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 1_000, commandId: "cmd-ptx", payload: { kind: "payout", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_PAYOUT, cluster: "devnet", amountLamports: 1_100_000_000 } },
    ]);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const premature = extend({ state: staged.state, events: [...base.events, ...staged.applied] }, [
      { kind: "task.paymentConfirmed", occurredAtMs: T + 1_050, commandId: "cmd-pay-early", payload: { taskId: "task-x", transactionSignature: SIG_PAYOUT, amountLamports: 1_100_000_000 } },
    ]);
    expect(premature.ok).toBe(false);
    if (!premature.ok) expect(premature.error.code).toBe("chain_not_confirmed");
  });

  it("rejects a payout amount that disagrees with the agreed assignment", () => {
    const base = recoveryBase();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN } },
      { kind: "task.executionStarted", occurredAtMs: T + 900, simulatorTimeMs: 3_000, commandId: "cmd-s2", payload: { taskId: "task-x", robotId: "rov-b" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 950, simulatorTimeMs: 4_000, commandId: "cmd-e2", payload: { taskId: "task-x", evidence: { evidenceId: "ev-2", taskId: "task-x", assignmentVersion: 2, operatorId: "operator-b", sampleRefs: ["s2"], policyVersion: "p", digest: "cd".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 940 } } },
      { kind: "task.evidenceAccepted", occurredAtMs: T + 990, commandId: "cmd-v2", payload: { taskId: "task-x", verdict: { evidenceId: "ev-2", accepted: true, reasons: ["ok"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 985 } } },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 1_000, commandId: "cmd-ptx", payload: { kind: "payout", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_PAYOUT, cluster: "devnet", amountLamports: 1_100_000_000 } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 1_050, payload: { transactionSignature: SIG_PAYOUT, status: "confirmed", slot: 3 }, chainTimeMs: T + 1_050 },
    ]);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const wrongAmount = extend({ state: staged.state, events: [...base.events, ...staged.applied] }, [
      { kind: "task.paymentConfirmed", occurredAtMs: T + 1_100, commandId: "cmd-pay-wrong", payload: { taskId: "task-x", transactionSignature: SIG_PAYOUT, amountLamports: 999_999_999 } },
    ]);
    expect(wrongAmount.ok).toBe(false);
    if (!wrongAmount.ok) expect(wrongAmount.error.code).toBe("validation_error");
  });

  it("a second payment attempt on a paid task is terminal-blocked", () => {
    const base = recoveryBase();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN } },
      { kind: "task.executionStarted", occurredAtMs: T + 900, simulatorTimeMs: 3_000, commandId: "cmd-s2", payload: { taskId: "task-x", robotId: "rov-b" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 950, simulatorTimeMs: 4_000, commandId: "cmd-e2", payload: { taskId: "task-x", evidence: { evidenceId: "ev-2", taskId: "task-x", assignmentVersion: 2, operatorId: "operator-b", sampleRefs: ["s2"], policyVersion: "p", digest: "cd".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 940 } } },
      { kind: "task.evidenceAccepted", occurredAtMs: T + 990, commandId: "cmd-v2", payload: { taskId: "task-x", verdict: { evidenceId: "ev-2", accepted: true, reasons: ["ok"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 985 } } },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 1_000, commandId: "cmd-ptx", payload: { kind: "payout", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_PAYOUT, cluster: "devnet", amountLamports: 1_100_000_000 } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 1_050, payload: { transactionSignature: SIG_PAYOUT, status: "confirmed", slot: 3 }, chainTimeMs: T + 1_050 },
      { kind: "task.paymentConfirmed", occurredAtMs: T + 1_100, commandId: "cmd-pay", payload: { taskId: "task-x", transactionSignature: SIG_PAYOUT, amountLamports: 1_100_000_000 } },
    ]);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const again = extend({ state: staged.state, events: [...base.events, ...staged.applied] }, [
      { kind: "task.paymentConfirmed", occurredAtMs: T + 1_150, commandId: "cmd-pay-2", payload: { taskId: "task-x", transactionSignature: SIG_PAYOUT, amountLamports: 1_100_000_000 } },
    ]);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("illegal_transition");
  });
});

describe("reassignment chain binding", () => {
  it("rejects reassignment when the chain tx is still only submitted", () => {
    const base = recoveryBase();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("chain_not_confirmed");
  });

  it("rejects reassignment whose chain tx authorized a different version", () => {
    const base = recoveryBase();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 5, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("stale_assignment_version");
  });

  it("funding transactions must not reference tasks and vice versa", () => {
    const base = recoveryBase();
    const badFunding = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-bf", payload: { kind: "funding", taskId: "task-x", transactionSignature: "VQsigBadFundTx" + "1".repeat(73), cluster: "devnet" } },
    ]);
    expect(badFunding.ok).toBe(false);

    const baseCreated = (() => {
      // rebuild a fresh mission to submit a payout without task reference
      const events = stampScript("port-001", [
        {
          kind: "mission.created", occurredAtMs: T, commandId: "cmd-c", payload: {
            config: {
              missionId: "port-001", organizationId: "org-x", templateId: "tpl", siteLabel: "site", budgetLamports: BUDGET,
              tasks: [{ taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: 1_500_000_000, acceptancePolicyId: "p1" }],
            },
          },
        },
        { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: FIXTURE_SIG_FUNDING, cluster: "devnet", amountLamports: BUDGET } },
        { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: FIXTURE_SIG_FUNDING, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
        { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
      ]);
      const init = initMissionProjection(events[0] as never);
      if (!init.ok) throw new Error(init.error.message);
      let state = init.value;
      for (const event of events.slice(1)) {
        const applied = applyEvent(state, event);
        if (!applied.ok) throw new Error(applied.error.message);
        state = applied.state;
      }
      return { state, events };
    })();
    const badPayout = extend(baseCreated, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 300, commandId: "cmd-bp", payload: { kind: "payout", transactionSignature: "VQsigPayoutNoTask" + "1".repeat(70), cluster: "devnet" } },
    ]);
    expect(badPayout.ok).toBe(false);
  });
});
