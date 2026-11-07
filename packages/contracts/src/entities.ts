/**
 * VORQYN shared contracts — entity schemas (VQ-01 / issue #2).
 *
 * Field sets follow docs/ARCHITECTURE.md §3. Every constructor validates
 * and returns a Result; there are no silent casts. These are the shapes
 * services serialize — adding a field is schema-breaking (see
 * CONTRACTS_SCHEMA_VERSION).
 */

import {
  asCommandId,
  asEpochMs,
  asEvidenceId,
  asLamports,
  asMissionId,
  asOfferId,
  asOperatorId,
  asOrganizationId,
  asRobotId,
  asSolanaPublicKey,
  asTaskId,
  err,
  ok,
  type CommandId,
  type EpochMs,
  type EvidenceId,
  type Lamports,
  type MissionId,
  type OfferId,
  type OperatorId,
  type OrganizationId,
  type Result,
  type RobotId,
  type SolanaPublicKey,
  type TaskId,
} from "./core";
import type {
  AuthorizationActor,
  ChainEventKind,
  ChainTxStatus,
  Cluster,
  RobotClass,
  SourceKind,
  TaskKind,
} from "./enums";

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly ownerUserId: string;
  readonly createdAtMs: EpochMs;
}

export const makeOrganization = (input: {
  id: string;
  name: string;
  ownerUserId: string;
  createdAtMs: number;
}): Result<Organization> => {
  const id = asOrganizationId(input.id);
  if (!id.ok) return id;
  if (input.name.trim().length === 0) return err("validation_error", "organization name must be non-empty");
  if (input.ownerUserId.trim().length === 0) return err("validation_error", "ownerUserId must be non-empty");
  const createdAtMs = asEpochMs(input.createdAtMs);
  if (!createdAtMs.ok) return createdAtMs;
  return ok({ id: id.value, name: input.name, ownerUserId: input.ownerUserId, createdAtMs: createdAtMs.value });
};

// ---------------------------------------------------------------------------
// Mission + task configuration (created by the mission.created event)
// ---------------------------------------------------------------------------

export interface TaskConfig {
  readonly taskId: TaskId;
  readonly kind: TaskKind;
  /** Minimum sensor capabilities required, e.g. ["sonar"]. Non-empty. */
  readonly requiredCapabilities: readonly string[];
  readonly maxRewardLamports: Lamports;
  /** Human-readable acceptance policy reference (rule set frozen per mission). */
  readonly acceptancePolicyId: string;
}

export interface MissionConfig {
  readonly missionId: MissionId;
  readonly organizationId: OrganizationId;
  readonly templateId: string;
  readonly siteLabel: string;
  readonly budgetLamports: Lamports;
  readonly expiresAtMs?: EpochMs;
  readonly tasks: readonly TaskConfig[];
}

export const makeMissionConfig = (input: {
  missionId: string;
  organizationId: string;
  templateId: string;
  siteLabel: string;
  budgetLamports: number;
  expiresAtMs?: number;
  tasks: readonly {
    taskId: string;
    kind: TaskKind;
    requiredCapabilities: readonly string[];
    maxRewardLamports: number;
    acceptancePolicyId: string;
  }[];
}): Result<MissionConfig> => {
  const missionId = asMissionId(input.missionId);
  if (!missionId.ok) return missionId;
  const organizationId = asOrganizationId(input.organizationId);
  if (!organizationId.ok) return organizationId;
  if (input.templateId.trim().length === 0) return err("validation_error", "templateId must be non-empty");
  if (input.siteLabel.trim().length === 0) return err("validation_error", "siteLabel must be non-empty");
  const budget = asLamports(input.budgetLamports);
  if (!budget.ok) return budget;

  const seen = new Set<string>();
  const tasks: TaskConfig[] = [];
  let committed = 0;
  for (const task of input.tasks) {
    const taskId = asTaskId(task.taskId);
    if (!taskId.ok) return taskId;
    if (seen.has(taskId.value)) return err("validation_error", `duplicate task id ${taskId.value}`);
    seen.add(taskId.value);
    if (task.requiredCapabilities.length === 0)
      return err("validation_error", `task ${taskId.value} must require at least one capability`);
    const maxReward = asLamports(task.maxRewardLamports);
    if (!maxReward.ok) return maxReward;
    if (task.acceptancePolicyId.trim().length === 0)
      return err("validation_error", `task ${taskId.value} must reference an acceptance policy`);
    committed += maxReward.value;
    tasks.push({
      taskId: taskId.value,
      kind: task.kind,
      requiredCapabilities: [...task.requiredCapabilities],
      maxRewardLamports: maxReward.value,
      acceptancePolicyId: task.acceptancePolicyId,
    });
  }
  // Funding invariant (SOLANA_PROTOCOL.md §5): committed rewards may not
  // exceed the mission budget, even before anything reaches the chain.
  if (committed > budget.value)
    return err("budget_exceeded", `task budgets (${committed}) exceed mission budget (${budget.value})`);

  if (input.expiresAtMs !== undefined) {
    const expires = asEpochMs(input.expiresAtMs);
    if (!expires.ok) return expires;
    return ok({
      missionId: missionId.value,
      organizationId: organizationId.value,
      templateId: input.templateId,
      siteLabel: input.siteLabel,
      budgetLamports: budget.value,
      expiresAtMs: expires.value,
      tasks,
    });
  }
  return ok({
    missionId: missionId.value,
    organizationId: organizationId.value,
    templateId: input.templateId,
    siteLabel: input.siteLabel,
    budgetLamports: budget.value,
    tasks,
  });
};

// ---------------------------------------------------------------------------
// Robot + operator
// ---------------------------------------------------------------------------

export interface Robot {
  readonly robotId: RobotId;
  readonly operatorId: OperatorId;
  readonly robotClass: RobotClass;
  readonly sourceKind: SourceKind;
  readonly capabilities: readonly string[];
}

export const makeRobot = (input: {
  robotId: string;
  operatorId: string;
  robotClass: RobotClass;
  sourceKind: SourceKind;
  capabilities: readonly string[];
}): Result<Robot> => {
  const robotId = asRobotId(input.robotId);
  if (!robotId.ok) return robotId;
  const operatorId = asOperatorId(input.operatorId);
  if (!operatorId.ok) return operatorId;
  if (input.capabilities.length === 0) return err("validation_error", "robot must declare at least one capability");
  return ok({
    robotId: robotId.value,
    operatorId: operatorId.value,
    robotClass: input.robotClass,
    sourceKind: input.sourceKind,
    capabilities: [...input.capabilities],
  });
};

// ---------------------------------------------------------------------------
// Operator offer (structured candidates for AI/policy — ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export interface OperatorOffer {
  readonly offerId: OfferId;
  readonly taskId: TaskId;
  readonly operatorId: OperatorId;
  readonly robotId: RobotId;
  readonly capabilities: readonly string[];
  readonly quoteLamports: Lamports;
  /** Epoch ms after which the quote may no longer be accepted. */
  readonly expiryMs: EpochMs;
  readonly available: boolean;
}

export const makeOperatorOffer = (input: {
  offerId: string;
  taskId: string;
  operatorId: string;
  robotId: string;
  capabilities: readonly string[];
  quoteLamports: number;
  expiryMs: number;
  available: boolean;
}): Result<OperatorOffer> => {
  const offerId = asOfferId(input.offerId);
  if (!offerId.ok) return offerId;
  const taskId = asTaskId(input.taskId);
  if (!taskId.ok) return taskId;
  const operatorId = asOperatorId(input.operatorId);
  if (!operatorId.ok) return operatorId;
  const robotId = asRobotId(input.robotId);
  if (!robotId.ok) return robotId;
  const quote = asLamports(input.quoteLamports);
  if (!quote.ok) return quote;
  const expiry = asEpochMs(input.expiryMs);
  if (!expiry.ok) return expiry;
  return ok({
    offerId: offerId.value,
    taskId: taskId.value,
    operatorId: operatorId.value,
    robotId: robotId.value,
    capabilities: [...input.capabilities],
    quoteLamports: quote.value,
    expiryMs: expiry.value,
    available: input.available,
  });
};

// ---------------------------------------------------------------------------
// Assignment versions (the anti-stale-proof core)
// ---------------------------------------------------------------------------

export interface Assignment {
  readonly taskId: TaskId;
  /** Starts at 1; incremented by every authorized reassignment. */
  readonly version: number;
  readonly operatorId: OperatorId;
  readonly robotId: RobotId;
  readonly agreedLamports: Lamports;
  readonly offerId?: OfferId;
  readonly activatedAtMs: EpochMs;
  /** Signature of the chain transaction that enacted this assignment, when
   * the assignment was created or changed on-chain (CHAIN_SEAM.md §5). */
  readonly chainSignature?: string;
}

// ---------------------------------------------------------------------------
// Evidence + verdict
// ---------------------------------------------------------------------------

/** Byte digest over the evidence payload, hex-encoded; produced by the
 * verifier service, bound to (taskId, assignmentVersion, operatorId). */
export type EvidenceDigest = string & { readonly __brand: "EvidenceDigest" };
const HEX_64 = /^[0-9a-f]{64}$/;

export interface Evidence {
  readonly evidenceId: EvidenceId;
  readonly taskId: TaskId;
  readonly assignmentVersion: number;
  readonly operatorId: OperatorId;
  readonly sampleRefs: readonly string[];
  readonly policyVersion: string;
  readonly digest: EvidenceDigest;
  readonly simulatorSource: SourceKind;
  readonly capturedAtMs: EpochMs;
}

export interface Verdict {
  readonly evidenceId: EvidenceId;
  readonly accepted: boolean;
  /** Machine-readable rule IDs that decided the verdict. */
  readonly reasons: readonly string[];
  readonly verifierId: string;
  readonly verdictVersion: string;
  readonly decidedAtMs: EpochMs;
}

export const makeEvidence = (input: {
  evidenceId: string;
  taskId: string;
  assignmentVersion: number;
  operatorId: string;
  sampleRefs: readonly string[];
  policyVersion: string;
  digest: string;
  simulatorSource: SourceKind;
  capturedAtMs: number;
}): Result<Evidence> => {
  const evidenceId = asEvidenceId(input.evidenceId);
  if (!evidenceId.ok) return evidenceId;
  const taskId = asTaskId(input.taskId);
  if (!taskId.ok) return taskId;
  if (!Number.isSafeInteger(input.assignmentVersion) || input.assignmentVersion < 1)
    return err("validation_error", "assignmentVersion must be an integer >= 1");
  const operatorId = asOperatorId(input.operatorId);
  if (!operatorId.ok) return operatorId;
  if (!HEX_64.test(input.digest)) return err("validation_error", "digest must be 64 lowercase hex chars");
  if (input.sampleRefs.length === 0) return err("validation_error", "evidence must reference at least one telemetry sample");
  if (input.policyVersion.trim().length === 0) return err("validation_error", "policyVersion must be non-empty");
  const capturedAtMs = asEpochMs(input.capturedAtMs);
  if (!capturedAtMs.ok) return capturedAtMs;
  return ok({
    evidenceId: evidenceId.value,
    taskId: taskId.value,
    assignmentVersion: input.assignmentVersion,
    operatorId: operatorId.value,
    sampleRefs: [...input.sampleRefs],
    policyVersion: input.policyVersion,
    digest: input.digest as EvidenceDigest,
    simulatorSource: input.simulatorSource,
    capturedAtMs: capturedAtMs.value,
  });
};

export const makeVerdict = (input: {
  evidenceId: string;
  accepted: boolean;
  reasons: readonly string[];
  verifierId: string;
  verdictVersion: string;
  decidedAtMs: number;
}): Result<Verdict> => {
  const evidenceId = asEvidenceId(input.evidenceId);
  if (!evidenceId.ok) return evidenceId;
  if (input.reasons.length === 0) return err("validation_error", "verdict must state at least one reason");
  if (input.verifierId.trim().length === 0) return err("validation_error", "verifierId must be non-empty");
  if (input.verdictVersion.trim().length === 0) return err("validation_error", "verdictVersion must be non-empty");
  const decidedAtMs = asEpochMs(input.decidedAtMs);
  if (!decidedAtMs.ok) return decidedAtMs;
  return ok({
    evidenceId: evidenceId.value,
    accepted: input.accepted,
    reasons: [...input.reasons],
    verifierId: input.verifierId,
    verdictVersion: input.verdictVersion,
    decidedAtMs: decidedAtMs.value,
  });
};

// ---------------------------------------------------------------------------
// Chain event record (receipt shape proposed to #5 — see CHAIN_SEAM.md §6;
// marked DRAFT until the escrow owner agrees)
// ---------------------------------------------------------------------------

export interface ChainEventRecord {
  readonly kind: ChainEventKind;
  readonly missionId: MissionId;
  readonly taskId?: TaskId;
  /** Assignment version this transaction targets, when applicable. */
  readonly assignmentVersion?: number;
  readonly transactionSignature: string;
  readonly cluster: Cluster;
  /** Monotone status history; last entry is current (enums.ts rule). */
  readonly statusHistory: readonly ChainTxStatus[];
  readonly submittedAtMs: EpochMs;
  readonly confirmedAtMs?: EpochMs;
  readonly slot?: number;
  /** Value moved by the transaction when known at submission (lamports). */
  readonly amountLamports?: Lamports;
  /** Authorization provenance for reassignment transactions. */
  readonly authorizedBy?: AuthorizationActor;
}

/** Idempotency-key carrier shared by mutating events (ARCHITECTURE.md §4). */
export interface CommandProvenance {
  readonly commandId: CommandId;
}

export const asCommandProvenance = (raw: unknown): Result<CommandProvenance> => {
  if (typeof raw !== "object" || raw === null) return err("validation_error", "command provenance must be an object");
  const record = raw as Record<string, unknown>;
  const commandId = asCommandId(String(record.commandId ?? ""));
  if (!commandId.ok) return commandId;
  return ok({ commandId: commandId.value });
};

/** Registered payout wallet of an operator (CHAIN_SEAM.md §3). */
export interface OperatorRegistration {
  readonly operatorId: OperatorId;
  readonly payoutWallet: SolanaPublicKey;
}

export const makeOperatorRegistration = (input: {
  operatorId: string;
  payoutWallet: string;
}): Result<OperatorRegistration> => {
  const operatorId = asOperatorId(input.operatorId);
  if (!operatorId.ok) return operatorId;
  const payoutWallet = asSolanaPublicKey(input.payoutWallet);
  if (!payoutWallet.ok) return payoutWallet;
  return ok({ operatorId: operatorId.value, payoutWallet: payoutWallet.value });
};
