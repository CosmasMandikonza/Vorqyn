/**
 * VORQYN shared contracts — committed deterministic fixtures (VQ-01 / #2).
 *
 * Two independent missions demonstrate the product's core story and the
 * isolation requirement (docs/PRODUCT.md §7 "a second company mission with
 * a different budget/config persists distinctly"):
 *
 * - PORT-001: the flagship recovery loop — fund → assign ROV A (optical) →
 *   evidence rejected on visibility → AI/policy proposal (sonar operator
 *   chosen; cheaper optical-only alternative rejected) → on-chain
 *   reassignment v2 → sonar evidence accepted → chain-confirmed payout.
 * - HARBOR-002: a different organization, single air task, different
 *   budget, clean completion. No entity is shared with PORT-001.
 *
 * Every value is a fixed literal: replaying these scripts anywhere yields
 * byte-identical projections (see fixtures.test.ts).
 */

import type { MissionEvent, MissionEventKind } from "./events";
import { applyEvent, initMissionProjection, type ApplyResult, type MissionProjection } from "./reducer";

/** Fixed epoch base for fixture wall-clock times (2025-11-01T00:00:00Z era,
 * exact instant irrelevant — only determinism matters). */
export const FIXTURE_EPOCH_BASE_MS = 1_762_000_000_000;

export const LAMPORTS_PER_SOL = 1_000_000_000;

// Deterministic base58-shaped fixture identifiers (test values only — no
// real keys; charset deliberately inside base58).
export const FIXTURE_SIG_FUNDING =
  "VQsigFundingTx111111111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_REASSIGN =
  "VQsigReassignTx1111111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_PAYOUT_SEA =
  "VQsigPayoutSeaTx111111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_PAYOUT_AIR =
  "VQsigPayoutAirTx111111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_PAYOUT_LAND =
  "VQsigPayoutLandTx11111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_H2_FUNDING =
  "VQsigH2FundTx11111111111111111111111111111111111111111111111111111111111111111111111111";
export const FIXTURE_SIG_H2_PAYOUT =
  "VQsigH2PayoutTx1111111111111111111111111111111111111111111111111111111111111111111111111";

export const DIGEST_SEA_V1 = "ab".repeat(32);
export const DIGEST_SEA_V2 = "cd".repeat(32);
export const DIGEST_AIR_V1 = "ef".repeat(32);
export const DIGEST_LAND_V1 = "1212".repeat(16);
export const DIGEST_H2_V1 = "3434".repeat(16);

interface EventSeed {
  readonly kind: MissionEventKind;
  readonly payload: unknown;
  readonly occurredAtMs: number;
  readonly simulatorTimeMs?: number;
  readonly chainTimeMs?: number;
  readonly commandId?: string;
}

/**
 * Stamp a raw script into fully-formed events: sequence 1..n, deterministic
 * eventIds (`evt-<mission>-<seq>`), observedAt = occurredAt + 10ms.
 */
export function stampScript(missionId: string, seeds: readonly EventSeed[]): MissionEvent[] {
  return seeds.map((seed, index) => ({
    eventId: `evt-${missionId}-${index + 1}`,
    missionId,
    sequence: index + 1,
    kind: seed.kind,
    payload: seed.payload,
    occurredAtMs: seed.occurredAtMs,
    observedAtMs: seed.occurredAtMs + 10,
    ...(seed.simulatorTimeMs !== undefined ? { simulatorTimeMs: seed.simulatorTimeMs } : {}),
    ...(seed.chainTimeMs !== undefined ? { chainTimeMs: seed.chainTimeMs } : {}),
    ...(seed.commandId !== undefined ? { commandId: seed.commandId } : {}),
    schemaVersion: 1,
  })) as MissionEvent[];
}

/** Apply a stamped script deterministically; first failure aborts. */
export function runEventScript(events: readonly MissionEvent[]): ApplyResult & { scriptIndex?: number } {
  const init = initMissionProjection(events[0]);
  if (!init.ok) return { ok: false, error: init.error };
  let state: MissionProjection = init.value;
  for (let index = 1; index < events.length; index += 1) {
    const result = applyEvent(state, events[index]);
    if (!result.ok) return { ...result, scriptIndex: index };
    state = result.state;
  }
  return { ok: true, state, duplicate: false };
}

// ---------------------------------------------------------------------------
// PORT-001 — flagship recovery mission
// ---------------------------------------------------------------------------

export const PORT_001 = {
  missionId: "port-001",
  organizationId: "port-authority",
  templateId: "tpl-port-storm-clearance",
  siteLabel: "PORT-001 harbor basin",
  budgetLamports: 3 * LAMPORTS_PER_SOL,
  tasks: {
    air: { taskId: "task-air-visual", kind: "air" as const, requiredCapabilities: ["optical"], maxRewardLamports: 800_000_000, acceptancePolicyId: "policy-air-coverage-1" },
    land: { taskId: "task-land-route", kind: "land" as const, requiredCapabilities: ["optical"], maxRewardLamports: 600_000_000, acceptancePolicyId: "policy-land-route-1" },
    sea: { taskId: "task-sea-survey", kind: "sea" as const, requiredCapabilities: ["sonar"], maxRewardLamports: 1_200_000_000, acceptancePolicyId: "policy-sea-obstruction-sonar-1" },
  },
} as const;

const T = FIXTURE_EPOCH_BASE_MS;

export function buildPort001Script(): MissionEvent[] {
  return stampScript(PORT_001.missionId, [
    // 1. Mission configuration
    {
      kind: "mission.created",
      occurredAtMs: T,
      commandId: "cmd-p1-create",
      payload: {
        config: {
          missionId: PORT_001.missionId,
          organizationId: PORT_001.organizationId,
          templateId: PORT_001.templateId,
          siteLabel: PORT_001.siteLabel,
          budgetLamports: PORT_001.budgetLamports,
          tasks: [PORT_001.tasks.air, PORT_001.tasks.land, PORT_001.tasks.sea],
        },
      },
    },
    // 2-3. Escrow funding confirmed on devnet
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 1_000,
      commandId: "cmd-p1-fund",
      payload: { kind: "funding", transactionSignature: FIXTURE_SIG_FUNDING, cluster: "devnet", amountLamports: PORT_001.budgetLamports },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 1_500,
      payload: { transactionSignature: FIXTURE_SIG_FUNDING, status: "confirmed", slot: 251_000_001 },
      chainTimeMs: T + 1_500,
    },
    // 4. Launch
    { kind: "mission.launched", occurredAtMs: T + 2_000, commandId: "cmd-p1-launch", payload: {} },
    // 5-8. Sea task: ROV A assigned, executes, optical evidence REJECTED
    {
      kind: "task.assigned",
      occurredAtMs: T + 3_000,
      commandId: "cmd-p1-sea-assign",
      payload: { taskId: PORT_001.tasks.sea.taskId, operatorId: "operator-rov-a", robotId: "rov-a-01", offerId: "offer-rov-a-optical", quoteLamports: 1_000_000_000 },
    },
    {
      kind: "task.executionStarted",
      occurredAtMs: T + 4_000,
      simulatorTimeMs: 5_000,
      commandId: "cmd-p1-sea-start",
      payload: { taskId: PORT_001.tasks.sea.taskId, robotId: "rov-a-01" },
    },
    {
      kind: "task.evidenceSubmitted",
      occurredAtMs: T + 5_000,
      simulatorTimeMs: 8_000,
      commandId: "cmd-p1-sea-evidence",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        evidence: {
          evidenceId: "ev-sea-v1",
          taskId: PORT_001.tasks.sea.taskId,
          assignmentVersion: 1,
          operatorId: "operator-rov-a",
          sampleRefs: ["sample-rov-a-0001", "sample-rov-a-0002"],
          policyVersion: "policy-sea-v1",
          digest: DIGEST_SEA_V1,
          simulatorSource: "SYNTHETIC_SIM",
          capturedAtMs: T + 4_900,
        },
      },
    },
    {
      kind: "task.evidenceRejected",
      occurredAtMs: T + 6_000,
      commandId: "cmd-p1-sea-verdict",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        verdict: {
          evidenceId: "ev-sea-v1",
          accepted: false,
          reasons: ["rule-visibility-below-1m:measured=0.4m", "rule-coverage-incomplete:42%"],
          verifierId: "verifier-primary",
          verdictVersion: "verdict-v1",
          decidedAtMs: T + 5_900,
        },
      },
    },
    // 9. Constrained recovery proposal: sonar operator over cheaper optical
    {
      kind: "task.recoveryProposed",
      occurredAtMs: T + 7_000,
      commandId: "cmd-p1-sea-propose",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        proposal: {
          offerId: "offer-rov-b-sonar",
          rationale: "Only offer meeting requiredCapabilities=[sonar] within remaining budget",
          checkedCosts: ["quote<=maxReward", "committed<=funded"],
          limitations: ["proposal is rule-validated; deterministic policy gates chain action"],
        },
        rejectedAlternatives: [
          { offerId: "offer-cheap-optical", reasonCode: "capability-mismatch", reason: "optical-only; task requires sonar after visibility failure" },
        ],
      },
    },
    // 10-12. Owner-authorized on-chain reassignment to v2
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 8_000,
      commandId: "cmd-p1-sea-reassign-tx",
      payload: { kind: "reassignment", taskId: PORT_001.tasks.sea.taskId, assignmentVersion: 2, transactionSignature: FIXTURE_SIG_REASSIGN, cluster: "devnet", amountLamports: 1_100_000_000, authorizedBy: "owner" },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 8_500,
      payload: { transactionSignature: FIXTURE_SIG_REASSIGN, status: "confirmed", slot: 251_000_002 },
      chainTimeMs: T + 8_500,
    },
    {
      kind: "task.reassignmentAuthorized",
      occurredAtMs: T + 9_000,
      commandId: "cmd-p1-sea-reassign",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        expectedVersion: 1,
        newOperatorId: "operator-rov-b",
        newRobotId: "rov-b-01",
        offerId: "offer-rov-b-sonar",
        quoteLamports: 1_100_000_000,
        authorizedBy: "owner",
        transactionSignature: FIXTURE_SIG_REASSIGN,
      },
    },
    // 13-15. Replacement executes, sonar evidence ACCEPTED
    {
      kind: "task.executionStarted",
      occurredAtMs: T + 10_000,
      simulatorTimeMs: 12_000,
      commandId: "cmd-p1-sea-start2",
      payload: { taskId: PORT_001.tasks.sea.taskId, robotId: "rov-b-01" },
    },
    {
      kind: "task.evidenceSubmitted",
      occurredAtMs: T + 11_000,
      simulatorTimeMs: 16_000,
      commandId: "cmd-p1-sea-evidence2",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        evidence: {
          evidenceId: "ev-sea-v2",
          taskId: PORT_001.tasks.sea.taskId,
          assignmentVersion: 2,
          operatorId: "operator-rov-b",
          sampleRefs: ["sample-rov-b-0101", "sample-rov-b-0102"],
          policyVersion: "policy-sea-v1",
          digest: DIGEST_SEA_V2,
          simulatorSource: "SYNTHETIC_SIM",
          capturedAtMs: T + 10_900,
        },
      },
    },
    {
      kind: "task.evidenceAccepted",
      occurredAtMs: T + 12_000,
      commandId: "cmd-p1-sea-verdict2",
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        verdict: {
          evidenceId: "ev-sea-v2",
          accepted: true,
          reasons: ["rule-sonar-coverage-ok:97%", "rule-quality-score:0.91"],
          verifierId: "verifier-primary",
          verdictVersion: "verdict-v1",
          decidedAtMs: T + 11_900,
        },
      },
    },
    // 16-18. Chain-confirmed single payout to the current operator
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 13_000,
      commandId: "cmd-p1-sea-payout-tx",
      payload: { kind: "payout", taskId: PORT_001.tasks.sea.taskId, assignmentVersion: 2, transactionSignature: FIXTURE_SIG_PAYOUT_SEA, cluster: "devnet", amountLamports: 1_100_000_000 },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 13_500,
      payload: { transactionSignature: FIXTURE_SIG_PAYOUT_SEA, status: "confirmed", slot: 251_000_003 },
      chainTimeMs: T + 13_500,
    },
    {
      kind: "task.paymentConfirmed",
      occurredAtMs: T + 14_000,
      commandId: "cmd-p1-sea-paid",
      payload: { taskId: PORT_001.tasks.sea.taskId, transactionSignature: FIXTURE_SIG_PAYOUT_SEA, amountLamports: 1_100_000_000 },
    },
    // 19-26. Air + land tasks complete cleanly (same gates, no fault)
    {
      kind: "task.assigned",
      occurredAtMs: T + 15_000,
      commandId: "cmd-p1-air-assign",
      payload: { taskId: PORT_001.tasks.air.taskId, operatorId: "operator-drone-c", robotId: "drone-c-01", offerId: "offer-drone-c", quoteLamports: 750_000_000 },
    },
    {
      kind: "task.executionStarted",
      occurredAtMs: T + 16_000,
      simulatorTimeMs: 18_000,
      commandId: "cmd-p1-air-start",
      payload: { taskId: PORT_001.tasks.air.taskId, robotId: "drone-c-01" },
    },
    {
      kind: "task.evidenceSubmitted",
      occurredAtMs: T + 17_000,
      simulatorTimeMs: 20_000,
      commandId: "cmd-p1-air-evidence",
      payload: {
        taskId: PORT_001.tasks.air.taskId,
        evidence: {
          evidenceId: "ev-air-v1",
          taskId: PORT_001.tasks.air.taskId,
          assignmentVersion: 1,
          operatorId: "operator-drone-c",
          sampleRefs: ["sample-drone-c-0201"],
          policyVersion: "policy-air-v1",
          digest: DIGEST_AIR_V1,
          simulatorSource: "SYNTHETIC_SIM",
          capturedAtMs: T + 16_900,
        },
      },
    },
    {
      kind: "task.evidenceAccepted",
      occurredAtMs: T + 18_000,
      commandId: "cmd-p1-air-verdict",
      payload: {
        taskId: PORT_001.tasks.air.taskId,
        verdict: { evidenceId: "ev-air-v1", accepted: true, reasons: ["rule-coverage-ok:100%"], verifierId: "verifier-primary", verdictVersion: "verdict-v1", decidedAtMs: T + 17_900 },
      },
    },
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 19_000,
      commandId: "cmd-p1-air-payout-tx",
      payload: { kind: "payout", taskId: PORT_001.tasks.air.taskId, assignmentVersion: 1, transactionSignature: FIXTURE_SIG_PAYOUT_AIR, cluster: "devnet", amountLamports: 750_000_000 },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 19_500,
      payload: { transactionSignature: FIXTURE_SIG_PAYOUT_AIR, status: "confirmed", slot: 251_000_004 },
      chainTimeMs: T + 19_500,
    },
    {
      kind: "task.paymentConfirmed",
      occurredAtMs: T + 20_000,
      commandId: "cmd-p1-air-paid",
      payload: { taskId: PORT_001.tasks.air.taskId, transactionSignature: FIXTURE_SIG_PAYOUT_AIR, amountLamports: 750_000_000 },
    },
    {
      kind: "task.assigned",
      occurredAtMs: T + 21_000,
      commandId: "cmd-p1-land-assign",
      payload: { taskId: PORT_001.tasks.land.taskId, operatorId: "operator-rover-d", robotId: "rover-d-01", offerId: "offer-rover-d", quoteLamports: 500_000_000 },
    },
    {
      kind: "task.executionStarted",
      occurredAtMs: T + 22_000,
      simulatorTimeMs: 24_000,
      commandId: "cmd-p1-land-start",
      payload: { taskId: PORT_001.tasks.land.taskId, robotId: "rover-d-01" },
    },
    {
      kind: "task.evidenceSubmitted",
      occurredAtMs: T + 23_000,
      simulatorTimeMs: 26_000,
      commandId: "cmd-p1-land-evidence",
      payload: {
        taskId: PORT_001.tasks.land.taskId,
        evidence: {
          evidenceId: "ev-land-v1",
          taskId: PORT_001.tasks.land.taskId,
          assignmentVersion: 1,
          operatorId: "operator-rover-d",
          sampleRefs: ["sample-rover-d-0301"],
          policyVersion: "policy-land-v1",
          digest: DIGEST_LAND_V1,
          simulatorSource: "SYNTHETIC_SIM",
          capturedAtMs: T + 22_900,
        },
      },
    },
    {
      kind: "task.evidenceAccepted",
      occurredAtMs: T + 24_000,
      commandId: "cmd-p1-land-verdict",
      payload: {
        taskId: PORT_001.tasks.land.taskId,
        verdict: { evidenceId: "ev-land-v1", accepted: true, reasons: ["rule-route-complete:100%"], verifierId: "verifier-primary", verdictVersion: "verdict-v1", decidedAtMs: T + 23_900 },
      },
    },
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 25_000,
      commandId: "cmd-p1-land-payout-tx",
      payload: { kind: "payout", taskId: PORT_001.tasks.land.taskId, assignmentVersion: 1, transactionSignature: FIXTURE_SIG_PAYOUT_LAND, cluster: "devnet", amountLamports: 500_000_000 },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 25_500,
      payload: { transactionSignature: FIXTURE_SIG_PAYOUT_LAND, status: "confirmed", slot: 251_000_005 },
      chainTimeMs: T + 25_500,
    },
    {
      kind: "task.paymentConfirmed",
      occurredAtMs: T + 26_000,
      commandId: "cmd-p1-land-paid",
      payload: { taskId: PORT_001.tasks.land.taskId, transactionSignature: FIXTURE_SIG_PAYOUT_LAND, amountLamports: 500_000_000 },
    },
  ]);
}

// ---------------------------------------------------------------------------
// HARBOR-002 — second organization, distinct config (isolation fixture)
// ---------------------------------------------------------------------------

export const HARBOR_002 = {
  missionId: "harbor-002",
  organizationId: "inland-logistics",
  templateId: "tpl-air-corridor",
  siteLabel: "HARBOR-002 north corridor",
  budgetLamports: 500_000_000,
  tasks: {
    air: { taskId: "task-h2-air-scan", kind: "air" as const, requiredCapabilities: ["optical"], maxRewardLamports: 450_000_000, acceptancePolicyId: "policy-h2-corridor-1" },
  },
} as const;

export function buildHarbor002Script(): MissionEvent[] {
  return stampScript(HARBOR_002.missionId, [
    {
      kind: "mission.created",
      occurredAtMs: T + 100,
      commandId: "cmd-h2-create",
      payload: {
        config: {
          missionId: HARBOR_002.missionId,
          organizationId: HARBOR_002.organizationId,
          templateId: HARBOR_002.templateId,
          siteLabel: HARBOR_002.siteLabel,
          budgetLamports: HARBOR_002.budgetLamports,
          tasks: [HARBOR_002.tasks.air],
        },
      },
    },
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 1_100,
      commandId: "cmd-h2-fund",
      payload: { kind: "funding", transactionSignature: FIXTURE_SIG_H2_FUNDING, cluster: "devnet", amountLamports: HARBOR_002.budgetLamports },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 1_200,
      payload: { transactionSignature: FIXTURE_SIG_H2_FUNDING, status: "confirmed", slot: 251_000_101 },
      chainTimeMs: T + 1_200,
    },
    { kind: "mission.launched", occurredAtMs: T + 1_300, commandId: "cmd-h2-launch", payload: {} },
    {
      kind: "task.assigned",
      occurredAtMs: T + 1_400,
      commandId: "cmd-h2-air-assign",
      payload: { taskId: HARBOR_002.tasks.air.taskId, operatorId: "operator-drone-e", robotId: "drone-e-01", offerId: "offer-drone-e", quoteLamports: 420_000_000 },
    },
    {
      kind: "task.executionStarted",
      occurredAtMs: T + 1_500,
      simulatorTimeMs: 2_000,
      commandId: "cmd-h2-air-start",
      payload: { taskId: HARBOR_002.tasks.air.taskId, robotId: "drone-e-01" },
    },
    {
      kind: "task.evidenceSubmitted",
      occurredAtMs: T + 1_600,
      simulatorTimeMs: 3_000,
      commandId: "cmd-h2-air-evidence",
      payload: {
        taskId: HARBOR_002.tasks.air.taskId,
        evidence: {
          evidenceId: "ev-h2-air-v1",
          taskId: HARBOR_002.tasks.air.taskId,
          assignmentVersion: 1,
          operatorId: "operator-drone-e",
          sampleRefs: ["sample-drone-e-0001"],
          policyVersion: "policy-h2-v1",
          digest: DIGEST_H2_V1,
          simulatorSource: "SYNTHETIC_SIM",
          capturedAtMs: T + 1_590,
        },
      },
    },
    {
      kind: "task.evidenceAccepted",
      occurredAtMs: T + 1_700,
      commandId: "cmd-h2-air-verdict",
      payload: {
        taskId: HARBOR_002.tasks.air.taskId,
        verdict: { evidenceId: "ev-h2-air-v1", accepted: true, reasons: ["rule-corridor-coverage-ok:100%"], verifierId: "verifier-secondary", verdictVersion: "verdict-v1", decidedAtMs: T + 1_690 },
      },
    },
    {
      kind: "chain.transactionSubmitted",
      occurredAtMs: T + 1_800,
      commandId: "cmd-h2-air-payout-tx",
      payload: { kind: "payout", taskId: HARBOR_002.tasks.air.taskId, assignmentVersion: 1, transactionSignature: FIXTURE_SIG_H2_PAYOUT, cluster: "devnet", amountLamports: 420_000_000 },
    },
    {
      kind: "chain.transactionUpdated",
      occurredAtMs: T + 1_900,
      payload: { transactionSignature: FIXTURE_SIG_H2_PAYOUT, status: "confirmed", slot: 251_000_102 },
      chainTimeMs: T + 1_900,
    },
    {
      kind: "task.paymentConfirmed",
      occurredAtMs: T + 2_000,
      commandId: "cmd-h2-air-paid",
      payload: { taskId: HARBOR_002.tasks.air.taskId, transactionSignature: FIXTURE_SIG_H2_PAYOUT, amountLamports: 420_000_000 },
    },
  ]);
}
