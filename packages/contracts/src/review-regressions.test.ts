/**
 * Regression suite for the independent review of PR #37 (VQ-01).
 *
 * Each describe block corresponds to a review finding (A–F). These tests
 * were written BEFORE the fixes: findings A, B, C, D and E were reproduced
 * as failures against the pre-fix code; they must all pass after the fix.
 * Finding F is documentation consistency (no executable assertion beyond
 * the doc location checks noted in the PR).
 */

import { describe, expect, it } from "vitest";

import type { MissionEvent } from "./events";
import { validateChainSubmittedPayload, validateMissionCreatedPayload } from "./events";
import { applyEvent, initMissionProjection, type MissionProjection } from "./reducer";
import { FIXTURE_SIG_FUNDING, stampScript } from "./fixtures";
import { makeEvidence, makeMissionConfig, makeVerdict } from "./entities";
import { makeTelemetrySample } from "./telemetry";

const T = 1_762_000_000_000;
const BUDGET = 2_000_000_000;
const SIG_FUND = FIXTURE_SIG_FUNDING;
const SIG_PAYOUT = "VQsigPayoutSeaTx" + "1".repeat(72);

interface Base {
  state: MissionProjection;
  events: MissionEvent[];
}

function freshMission(): Base {
  const events = stampScript("port-001", [
    {
      kind: "mission.created", occurredAtMs: T, commandId: "cmd-c", payload: {
        config: {
          missionId: "port-001", organizationId: "org-x", templateId: "tpl", siteLabel: "site", budgetLamports: BUDGET,
          tasks: [{ taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: 1_500_000_000, acceptancePolicyId: "p1" }],
        },
      },
    },
  ]);
  const init = initMissionProjection(events[0] as never);
  if (!init.ok) throw new Error(init.error.message);
  return { state: init.value, events };
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

// ---------------------------------------------------------------------------
// Finding A — funding credited exactly once per transaction
// ---------------------------------------------------------------------------

describe("Finding A: funding is credited exactly once", () => {
  it("confirmed -> finalized must not credit the amount twice", () => {
    const base = freshMission();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 200, payload: { transactionSignature: SIG_FUND, status: "finalized", slot: 1 }, chainTimeMs: T + 200 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.fundedLamports).toBe(BUDGET);
  });

  it("confirmed -> unknown -> confirmed must not credit the amount twice", () => {
    const base = freshMission();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 180, payload: { transactionSignature: SIG_FUND, status: "unknown" } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 200, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 2 }, chainTimeMs: T + 200 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.fundedLamports).toBe(BUDGET);
  });

  it("two DISTINCT funding transactions still sum (positive control)", () => {
    const base = freshMission();
    const result = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f1", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: 1_000_000_000 } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 200, commandId: "cmd-f2", payload: { kind: "funding", transactionSignature: "VQsigSecondFundTx" + "1".repeat(72), cluster: "devnet", amountLamports: 500_000_000 } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 250, payload: { transactionSignature: "VQsigSecondFundTx" + "1".repeat(72), status: "confirmed", slot: 2 }, chainTimeMs: T + 250 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.fundedLamports).toBe(1_500_000_000);
  });
});

// ---------------------------------------------------------------------------
// Finding B — exact replay idempotent, conflicting content rejected
// ---------------------------------------------------------------------------

describe("Finding B: replay with tampered content is rejected", () => {
  /** mission.created -> funding confirmed -> launched, ready for assignment. */
  function launchedMission(): Base {
    const base = freshMission();
    const launched = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
    ]);
    if (!launched.ok) throw new Error(launched.error.message);
    return { state: launched.state, events: [...base.events, ...launched.applied] };
  }

  it("same eventId + sequence but different payload is NOT a duplicate", () => {
    const base = launchedMission();
    const assigned = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } }]);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    const original = assigned.applied[0];
    if (original === undefined) throw new Error("regression staging broken: no assigned event");
    const tampered = { ...original, payload: { ...(original.payload as object), quoteLamports: 1 } } as never;
    const result = applyEvent(assigned.state, tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("duplicate_event");
  });

  it("byte-identical replay remains an idempotent no-op", () => {
    const base = launchedMission();
    const assigned = extend(base, [{ kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a1", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } }]);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    const again = applyEvent(assigned.state, assigned.applied[0]);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.duplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding C — untrusted JSON yields structured errors, never throws
// ---------------------------------------------------------------------------

describe("Finding C: malformed inputs produce structured validation errors", () => {
  it("mission.created without tasks is a structured error, not a throw", () => {
    expect(() => validateMissionCreatedPayload({ config: { missionId: "port-001", organizationId: "o", templateId: "t", siteLabel: "s", budgetLamports: 100 } })).not.toThrow();
    const result = validateMissionCreatedPayload({ config: { missionId: "port-001", organizationId: "o", templateId: "t", siteLabel: "s", budgetLamports: 100 } });
    expect(result.ok).toBe(false);
  });

  it("mission.created with an invalid task kind is rejected", () => {
    const result = makeMissionConfig({
      missionId: "port-001", organizationId: "org", templateId: "tpl", siteLabel: "s", budgetLamports: 100,
      tasks: [{ taskId: "task-x", kind: "submarine" as never, requiredCapabilities: ["x"], maxRewardLamports: 10, acceptancePolicyId: "p" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("missing required mission fields are structured errors, never throws", () => {
    expect(() => makeMissionConfig(undefined as never)).not.toThrow();
    expect(makeMissionConfig(undefined as never).ok).toBe(false);
    expect(() => makeMissionConfig({ missionId: "port-001" } as never)).not.toThrow();
    expect(makeMissionConfig({ missionId: "port-001" } as never).ok).toBe(false);
  });

  it("malformed evidence objects are structured errors", () => {
    expect(() => makeEvidence(undefined as never)).not.toThrow();
    expect(makeEvidence(undefined as never).ok).toBe(false);
    const noDigest = makeEvidence({ evidenceId: "e1", taskId: "task-x", assignmentVersion: 1, operatorId: "op-a", sampleRefs: ["s"], policyVersion: "p", simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T } as never);
    expect(noDigest.ok).toBe(false);
    const badSource = makeEvidence({ evidenceId: "e1", taskId: "task-x", assignmentVersion: 1, operatorId: "op-a", sampleRefs: ["s"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "MAGIC" as never, capturedAtMs: T });
    expect(badSource.ok).toBe(false);
  });

  it("malformed verdict objects are structured errors", () => {
    expect(() => makeVerdict(undefined as never)).not.toThrow();
    expect(makeVerdict(undefined as never).ok).toBe(false);
    const missing = makeVerdict({ evidenceId: "e1", accepted: true } as never);
    expect(missing.ok).toBe(false);
  });

  it("telemetry without a position is a structured error, not a throw", () => {
    expect(() => makeTelemetrySample(undefined as never)).not.toThrow();
    expect(makeTelemetrySample(undefined as never).ok).toBe(false);
    const noPosition = makeTelemetrySample({
      missionId: "port-001", robotId: "rov-a", sourceKind: "SYNTHETIC_SIM", sourceTimestampMs: 1, receivedAtMs: T,
      frameId: "ENU_PORT-001_LOCAL", sequence: 1, quality: { status: "ok" },
    } as never);
    expect(noPosition.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Finding D — payout records must carry version AND amount
// ---------------------------------------------------------------------------

describe("Finding D: payout/reassignment receipts must bind version and amount", () => {
  it("a payout submission without assignmentVersion is rejected", () => {
    const result = validateChainSubmittedPayload({ kind: "payout", taskId: "task-x", transactionSignature: SIG_PAYOUT, cluster: "devnet", amountLamports: 100 });
    expect(result.ok).toBe(false);
  });

  it("a payout submission without amountLamports is rejected", () => {
    const result = validateChainSubmittedPayload({ kind: "payout", taskId: "task-x", assignmentVersion: 1, transactionSignature: SIG_PAYOUT, cluster: "devnet" });
    expect(result.ok).toBe(false);
  });

  it("a reassignment submission without assignmentVersion or amount is rejected", () => {
    expect(validateChainSubmittedPayload({ kind: "reassignment", taskId: "task-x", transactionSignature: "VQsigReassignTx" + "1".repeat(73), cluster: "devnet", amountLamports: 5 }).ok).toBe(false);
    expect(validateChainSubmittedPayload({ kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: "VQsigReassignTx" + "1".repeat(73), cluster: "devnet" }).ok).toBe(false);
  });

  it("a funding submission without an amount is rejected", () => {
    expect(validateChainSubmittedPayload({ kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet" }).ok).toBe(false);
  });

  it("paymentConfirmed where the chain record amount disagrees is rejected", () => {
    const base = freshMission();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceAccepted", occurredAtMs: T + 600, commandId: "cmd-v", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: true, reasons: ["ok"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 590 } } },
      // Chain record claims a DIFFERENT amount than the agreed quote.
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-ptx", payload: { kind: "payout", taskId: "task-x", assignmentVersion: 1, transactionSignature: SIG_PAYOUT, cluster: "devnet", amountLamports: 999_000_000 } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_PAYOUT, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
    ]);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const paid = extend({ state: staged.state, events: [...base.events, ...staged.applied] }, [
      { kind: "task.paymentConfirmed", occurredAtMs: T + 800, commandId: "cmd-pay", payload: { taskId: "task-x", transactionSignature: SIG_PAYOUT, amountLamports: 1_000_000_000 } },
    ]);
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.error.code).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------
// Finding E — envelope missionId must match config missionId
// ---------------------------------------------------------------------------

describe("Finding E: mission identity consistency at creation", () => {
  it("mission.created with envelope/config id mismatch is rejected", () => {
    const events = stampScript("port-001", [
      {
        kind: "mission.created", occurredAtMs: T, commandId: "cmd-c", payload: {
          config: {
            missionId: "evil-999", organizationId: "org-x", templateId: "tpl", siteLabel: "site", budgetLamports: BUDGET,
            tasks: [{ taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: 1_500_000_000, acceptancePolicyId: "p1" }],
          },
        },
      },
    ]);
    const result = initMissionProjection(events[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("cross_mission_reference");
  });
});

// ---------------------------------------------------------------------------
// Final review, concern 1 — evidence/task identity consistency
// ---------------------------------------------------------------------------

describe("Concern 1: evidence claiming a different task cannot be attached or accepted", () => {
  /** Launched mission with task-x executing under operator-a (v1). */
  function executingMission(): Base {
    const events = stampScript("port-001", [
      {
        kind: "mission.created", occurredAtMs: T, commandId: "cmd-c", payload: {
          config: {
            missionId: "port-001", organizationId: "org-x", templateId: "tpl", siteLabel: "site", budgetLamports: BUDGET,
            tasks: [
              { taskId: "task-x", kind: "sea", requiredCapabilities: ["sonar"], maxRewardLamports: 1_500_000_000, acceptancePolicyId: "p1" },
              { taskId: "task-y", kind: "air", requiredCapabilities: ["optical"], maxRewardLamports: 400_000_000, acceptancePolicyId: "p2" },
            ],
          },
        },
      },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s", payload: { taskId: "task-x", robotId: "rov-a" } },
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

  it("task.evidenceSubmitted where evidence.taskId != payload.taskId is rejected", () => {
    const base = executingMission();
    const result = extend(base, [
      {
        kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e",
        // Payload targets task-x, but the evidence object claims task-y.
        payload: {
          taskId: "task-x",
          evidence: { evidenceId: "ev-mismatched", taskId: "task-y", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("the acceptance path never associates evidence with a different task", () => {
    const base = executingMission();
    // Force a mismatched evidence record through the boundary to prove the
    // verdict handlers also refuse cross-task association (defense in depth):
    // simulate it by submitting valid evidence for task-x, then attempting a
    // verdict whose payload taskId points at task-y.
    const staged = extend(base, [
      {
        kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e",
        payload: {
          taskId: "task-x",
          evidence: { evidenceId: "ev-good", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 },
        },
      },
    ]);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    const crossTaskVerdict = extend({ state: staged.state, events: [...base.events, ...staged.applied] }, [
      {
        kind: "task.evidenceAccepted", occurredAtMs: T + 600, commandId: "cmd-v",
        // Verdict payload claims task-y while the evidence belongs to task-x.
        payload: { taskId: "task-y", verdict: { evidenceId: "ev-good", accepted: true, reasons: ["ok"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 590 } },
      },
    ]);
    expect(crossTaskVerdict.ok).toBe(false);
    if (!crossTaskVerdict.ok) expect(crossTaskVerdict.error.code).toBe("unknown_entity");
  });
});

// ---------------------------------------------------------------------------
// Final review, concern 2 — reassignment/payout receipts must be able to
// bind the enacted operator wallet (optional today, proposed REQUIRED for #5)
// ---------------------------------------------------------------------------

describe("Concern 2: chain receipts can carry enacted wallet bindings", () => {
  const WALLET_B = "VorQynTestPayKeyB11111111111111111111111111B";
  const SIG_REASSIGN = "VQsigReassignTx" + "1".repeat(73);

  it("reassignment receipt accepts a valid newPayoutWallet and rejects invalid ones", () => {
    const good = validateChainSubmittedPayload({ kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, newPayoutWallet: WALLET_B });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.newPayoutWallet).toBe(WALLET_B);
    const bad = validateChainSubmittedPayload({ kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, newPayoutWallet: "not-base58!!" });
    expect(bad.ok).toBe(false);
  });

  it("payout receipt accepts a valid recipientWallet and rejects invalid ones", () => {
    const good = validateChainSubmittedPayload({ kind: "payout", taskId: "task-x", assignmentVersion: 1, transactionSignature: "VQsigPayoutSeaTx" + "1".repeat(72), cluster: "devnet", amountLamports: 100, recipientWallet: WALLET_B });
    expect(good.ok).toBe(true);
    const bad = validateChainSubmittedPayload({ kind: "payout", taskId: "task-x", assignmentVersion: 1, transactionSignature: "VQsigPayoutSeaTx" + "1".repeat(72), cluster: "devnet", amountLamports: 100, recipientWallet: 42 });
    expect(bad.ok).toBe(false);
  });

  it("reassignmentAuthorized whose claimed wallet contradicts the chain record is rejected", () => {
    const base = freshMission();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["vis"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 590 } } },
      // Chain enacted reassignment to wallet B.
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner", newPayoutWallet: WALLET_B } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      // Off-chain event claims a DIFFERENT wallet than the chain enacted.
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN, newPayoutWallet: "VorQynTestPayKeyC11111111111111111111111111C" } },
    ]);
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.error.code).toBe("validation_error");
  });

  it("reassignmentAuthorized passes when the claimed wallet matches the chain record", () => {
    const base = freshMission();
    const staged = extend(base, [
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 100, commandId: "cmd-f", payload: { kind: "funding", transactionSignature: SIG_FUND, cluster: "devnet", amountLamports: BUDGET } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 150, payload: { transactionSignature: SIG_FUND, status: "confirmed", slot: 1 }, chainTimeMs: T + 150 },
      { kind: "mission.launched", occurredAtMs: T + 200, commandId: "cmd-l", payload: {} },
      { kind: "task.assigned", occurredAtMs: T + 300, commandId: "cmd-a", payload: { taskId: "task-x", operatorId: "operator-a", robotId: "rov-a", quoteLamports: 1_000_000_000 } },
      { kind: "task.executionStarted", occurredAtMs: T + 400, simulatorTimeMs: 1_000, commandId: "cmd-s", payload: { taskId: "task-x", robotId: "rov-a" } },
      { kind: "task.evidenceSubmitted", occurredAtMs: T + 500, simulatorTimeMs: 2_000, commandId: "cmd-e", payload: { taskId: "task-x", evidence: { evidenceId: "ev-1", taskId: "task-x", assignmentVersion: 1, operatorId: "operator-a", sampleRefs: ["s1"], policyVersion: "p", digest: "ab".repeat(32), simulatorSource: "SYNTHETIC_SIM", capturedAtMs: T + 490 } } },
      { kind: "task.evidenceRejected", occurredAtMs: T + 600, commandId: "cmd-v", payload: { taskId: "task-x", verdict: { evidenceId: "ev-1", accepted: false, reasons: ["vis"], verifierId: "v", verdictVersion: "1", decidedAtMs: T + 590 } } },
      { kind: "chain.transactionSubmitted", occurredAtMs: T + 700, commandId: "cmd-rtx", payload: { kind: "reassignment", taskId: "task-x", assignmentVersion: 2, transactionSignature: SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner", newPayoutWallet: WALLET_B } },
      { kind: "chain.transactionUpdated", occurredAtMs: T + 750, payload: { transactionSignature: SIG_REASSIGN, status: "confirmed", slot: 2 }, chainTimeMs: T + 750 },
      { kind: "task.reassignmentAuthorized", occurredAtMs: T + 800, commandId: "cmd-r", payload: { taskId: "task-x", expectedVersion: 1, newOperatorId: "operator-b", newRobotId: "rov-b", offerId: "o", quoteLamports: 1_100_000_000, authorizedBy: "owner", transactionSignature: SIG_REASSIGN, newPayoutWallet: WALLET_B } },
    ]);
    expect(staged.ok).toBe(true);
    if (staged.ok) expect(staged.state.tasks["task-x"]?.currentAssignmentVersion).toBe(2);
  });
});
