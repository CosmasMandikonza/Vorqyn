/**
 * Structured recovery input (VQ-11 / #12) — everything the model AND the
 * deterministic gate see, derived from ACTUAL mission/task/evidence state.
 * No free-form fields become instructions; untrusted text (operator
 * descriptions) is DATA only and is never interpolated into prompts as
 * instructions (prompt-injection defense, tested).
 */

import type { EpochMs, Lamports, TaskId } from "@vorqyn/contracts";

export interface OperatorOffer {
  readonly offerId: string;
  readonly operatorId: string;
  readonly robotId: string;
  /** Untrusted, human-written — never executed or obeyed. */
  readonly description: string;
  /** e.g. ["sonar"] or ["optical"] — authoritative capability manifest. */
  readonly capabilities: readonly string[];
  readonly quoteLamports: Lamports;
  readonly payoutWallet: string;
  /** Offer validity window (epoch ms). */
  readonly validFromMs: EpochMs;
  readonly expiresAtMs: EpochMs;
}

export interface RecoveryRequest {
  readonly missionId: string;
  readonly taskId: TaskId;
  readonly taskKind: "air" | "land" | "sea";
  /** Capabilities the task requires AFTER the evidence failure (policy). */
  readonly requiredCapabilities: readonly string[];
  /** The task's CURRENT assignment version (stale proposals die here). */
  readonly currentAssignmentVersion: number;
  /** Authority-derived CURRENT assignment facts (CTO review P1-A/P1-B):
   * the reserved reward being replaced (top-up math) and the identities a
   * GENUINE recovery must replace. Lamports accept bigint to avoid lossy
   * Number conversions near 2^53. */
  readonly currentRewardLamports: Lamports | bigint;
  readonly currentOperatorId: string;
  readonly currentRobotId: string;
  /** Measured failure reasons from the VQ-10 verdict (source-bound). */
  readonly evidenceFailureReasons: readonly string[];
  readonly offers: readonly OperatorOffer[];
  /** Spendable ceiling: min(task budget, mission unreserved lamports).
   * Lamports | bigint everywhere — no lossy Number coercion (CTO P1-A). */
  readonly budgetLamports: Lamports | bigint;
  readonly missionRemainingLamports: Lamports | bigint;
  /** Decision clock — explicit for determinism in tests and replay. */
  readonly nowMs: EpochMs;
}

export interface ModelPromptInput {
  /** Only structured, non-instructional fields reach the model. */
  readonly missionId: string;
  readonly taskId: string;
  readonly taskKind: string;
  readonly requiredCapabilities: readonly string[];
  readonly currentAssignmentVersion: number;
  readonly evidenceFailureReasons: readonly string[];
  readonly budgetLamports: number;
  readonly offers: readonly {
    offerId: string;
    operatorId: string;
    robotId: string;
    capabilities: readonly string[];
    quoteLamports: number;
    expiresAtMs: number;
  }[];
}

/** Untrusted description text is deliberately NOT part of the prompt. */
export function buildPromptInput(request: RecoveryRequest): ModelPromptInput {
  return {
    missionId: request.missionId,
    taskId: request.taskId,
    taskKind: request.taskKind,
    requiredCapabilities: request.requiredCapabilities,
    currentAssignmentVersion: request.currentAssignmentVersion,
    evidenceFailureReasons: request.evidenceFailureReasons,
    // The prompt carries the budget as a NUMBER for JSON serialization;
    // unsafe values (>2^53-1) are serialized as strings to stay exact.
    budgetLamports:
      typeof request.budgetLamports === "bigint" || typeof request.budgetLamports === "number"
        ? Number(request.budgetLamports)
        : Number(request.budgetLamports),
    offers: request.offers.map((o) => ({
      offerId: o.offerId,
      operatorId: o.operatorId,
      robotId: o.robotId,
      capabilities: o.capabilities,
      quoteLamports: o.quoteLamports,
      expiresAtMs: o.expiresAtMs,
    })),
  };
}
