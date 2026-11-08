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
  /** Measured failure reasons from the VQ-10 verdict (source-bound). */
  readonly evidenceFailureReasons: readonly string[];
  readonly offers: readonly OperatorOffer[];
  /** Spendable ceiling: min(task budget, mission unreserved lamports). */
  readonly budgetLamports: Lamports;
  readonly missionRemainingLamports: Lamports;
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
    budgetLamports: request.budgetLamports,
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
