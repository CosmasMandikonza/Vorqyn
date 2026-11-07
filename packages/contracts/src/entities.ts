/**
 * VORQYN shared contracts — entity schemas (VQ-01 / issue #2).
 *
 * Field sets follow docs/ARCHITECTURE.md §3. Every constructor accepts
 * UNTRUSTED input (typed `unknown`) and returns a Result; malformed data —
 * missing fields, wrong types, invalid enum values — always produces a
 * structured validation error, never a thrown exception and never a
 * silently-cast invalid object (review Finding C). There are no silent
 * casts. These are the shapes services serialize — adding a field is
 * schema-breaking (see CONTRACTS_SCHEMA_VERSION).
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
  isRecord,
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
import {
  AUTHORIZATION_ACTORS,
  CLUSTERS,
  ROBOT_CLASSES,
  SOURCE_KINDS,
  TASK_KINDS,
  type AuthorizationActor,
  type ChainEventKind,
  type ChainTxStatus,
  type Cluster,
  type RobotClass,
  type SourceKind,
  type TaskKind,
} from "./enums";

// Small untrusted-field helpers: never throw, always produce Result.

const reqString = (container: Record<string, unknown>, field: string): Result<string> =>
  typeof container[field] === "string" && (container[field] as string).length > 0
    ? ok(container[field] as string)
    : err("validation_error", `${field} must be a non-empty string`);

const reqEpoch = (container: Record<string, unknown>, field: string): Result<EpochMs> => {
  const raw = container[field];
  if (typeof raw !== "number") return err("validation_error", `${field} must be a number`);
  return asEpochMs(raw);
};

const reqLamports = (container: Record<string, unknown>, field: string): Result<Lamports> => {
  const raw = container[field];
  if (typeof raw !== "number") return err("validation_error", `${field} must be a number`);
  return asLamports(raw);
};

function reqEnum<T extends string>(container: Record<string, unknown>, field: string, allowed: readonly T[], label: string): Result<T> {
  const raw = container[field];
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) return ok(raw as T);
  return err("validation_error", `${field} must be one of ${label} [${allowed.join("|")}]`);
}

const reqStringArray = (container: Record<string, unknown>, field: string): Result<string[]> => {
  const raw = container[field];
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((item) => typeof item === "string" && item.length > 0))
    return err("validation_error", `${field} must be a non-empty array of non-empty strings`);
  return ok([...(raw as string[])]);
};

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  readonly id: OrganizationId;
  readonly name: string;
  readonly ownerUserId: string;
  readonly createdAtMs: EpochMs;
}

export function makeOrganization(input: unknown): Result<Organization> {
  if (!isRecord(input)) return err("validation_error", "organization input must be an object");
  const id = asOrganizationId(String(input.id ?? ""));
  if (!id.ok) return id;
  const name = reqString(input, "name");
  if (!name.ok) return name;
  const ownerUserId = reqString(input, "ownerUserId");
  if (!ownerUserId.ok) return ownerUserId;
  const createdAtMs = reqEpoch(input, "createdAtMs");
  if (!createdAtMs.ok) return createdAtMs;
  return ok({ id: id.value, name: name.value, ownerUserId: ownerUserId.value, createdAtMs: createdAtMs.value });
}

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

export function makeMissionConfig(input: unknown): Result<MissionConfig> {
  if (!isRecord(input)) return err("validation_error", "mission config must be an object");
  const missionId = asMissionId(String(input.missionId ?? ""));
  if (!missionId.ok) return missionId;
  const organizationId = asOrganizationId(String(input.organizationId ?? ""));
  if (!organizationId.ok) return organizationId;
  const templateId = reqString(input, "templateId");
  if (!templateId.ok) return templateId;
  const siteLabel = reqString(input, "siteLabel");
  if (!siteLabel.ok) return siteLabel;
  const budget = reqLamports(input, "budgetLamports");
  if (!budget.ok) return budget;
  if (!Array.isArray(input.tasks) || input.tasks.length === 0)
    return err("validation_error", "tasks must be a non-empty array");

  const seen = new Set<string>();
  const tasks: TaskConfig[] = [];
  let committed = 0;
  for (const rawTask of input.tasks) {
    if (!isRecord(rawTask)) return err("validation_error", "each task must be an object");
    const taskId = asTaskId(String(rawTask.taskId ?? ""));
    if (!taskId.ok) return taskId;
    if (seen.has(taskId.value)) return err("validation_error", `duplicate task id ${taskId.value}`);
    seen.add(taskId.value);
    const kind = reqEnum(rawTask, "kind", TASK_KINDS, "TaskKind");
    if (!kind.ok) return kind;
    const capabilities = reqStringArray(rawTask, "requiredCapabilities");
    if (!capabilities.ok) return capabilities;
    const maxReward = reqLamports(rawTask, "maxRewardLamports");
    if (!maxReward.ok) return maxReward;
    const acceptancePolicyId = reqString(rawTask, "acceptancePolicyId");
    if (!acceptancePolicyId.ok) return acceptancePolicyId;
    committed += maxReward.value;
    tasks.push({
      taskId: taskId.value,
      kind: kind.value,
      requiredCapabilities: capabilities.value,
      maxRewardLamports: maxReward.value,
      acceptancePolicyId: acceptancePolicyId.value,
    });
  }
  // Funding invariant (SOLANA_PROTOCOL.md §5): committed rewards may not
  // exceed the mission budget, even before anything reaches the chain.
  if (committed > budget.value)
    return err("budget_exceeded", `task budgets (${committed}) exceed mission budget (${budget.value})`);

  if (input.expiresAtMs !== undefined) {
    const expires = reqEpoch(input, "expiresAtMs");
    if (!expires.ok) return expires;
    return ok({
      missionId: missionId.value,
      organizationId: organizationId.value,
      templateId: templateId.value,
      siteLabel: siteLabel.value,
      budgetLamports: budget.value,
      expiresAtMs: expires.value,
      tasks,
    });
  }
  return ok({
    missionId: missionId.value,
    organizationId: organizationId.value,
    templateId: templateId.value,
    siteLabel: siteLabel.value,
    budgetLamports: budget.value,
    tasks,
  });
}

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

export function makeRobot(input: unknown): Result<Robot> {
  if (!isRecord(input)) return err("validation_error", "robot input must be an object");
  const robotId = asRobotId(String(input.robotId ?? ""));
  if (!robotId.ok) return robotId;
  const operatorId = asOperatorId(String(input.operatorId ?? ""));
  if (!operatorId.ok) return operatorId;
  const robotClass = reqEnum(input, "robotClass", ROBOT_CLASSES, "RobotClass");
  if (!robotClass.ok) return robotClass;
  const sourceKind = reqEnum(input, "sourceKind", SOURCE_KINDS, "SourceKind");
  if (!sourceKind.ok) return sourceKind;
  const capabilities = reqStringArray(input, "capabilities");
  if (!capabilities.ok) return capabilities;
  return ok({
    robotId: robotId.value,
    operatorId: operatorId.value,
    robotClass: robotClass.value,
    sourceKind: sourceKind.value,
    capabilities: capabilities.value,
  });
}

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

export function makeOperatorOffer(input: unknown): Result<OperatorOffer> {
  if (!isRecord(input)) return err("validation_error", "offer input must be an object");
  const offerId = asOfferId(String(input.offerId ?? ""));
  if (!offerId.ok) return offerId;
  const taskId = asTaskId(String(input.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const operatorId = asOperatorId(String(input.operatorId ?? ""));
  if (!operatorId.ok) return operatorId;
  const robotId = asRobotId(String(input.robotId ?? ""));
  if (!robotId.ok) return robotId;
  const capabilities = reqStringArray(input, "capabilities");
  if (!capabilities.ok) return capabilities;
  const quote = reqLamports(input, "quoteLamports");
  if (!quote.ok) return quote;
  const expiryMs = reqEpoch(input, "expiryMs");
  if (!expiryMs.ok) return expiryMs;
  if (typeof input.available !== "boolean")
    return err("validation_error", "available must be a boolean");
  return ok({
    offerId: offerId.value,
    taskId: taskId.value,
    operatorId: operatorId.value,
    robotId: robotId.value,
    capabilities: capabilities.value,
    quoteLamports: quote.value,
    expiryMs: expiryMs.value,
    available: input.available,
  });
}

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

export function makeEvidence(input: unknown): Result<Evidence> {
  if (!isRecord(input)) return err("validation_error", "evidence must be an object");
  const evidenceId = asEvidenceId(String(input.evidenceId ?? ""));
  if (!evidenceId.ok) return evidenceId;
  const taskId = asTaskId(String(input.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const versionRaw = input.assignmentVersion;
  if (typeof versionRaw !== "number" || !Number.isSafeInteger(versionRaw) || versionRaw < 1)
    return err("validation_error", "assignmentVersion must be an integer >= 1");
  const operatorId = asOperatorId(String(input.operatorId ?? ""));
  if (!operatorId.ok) return operatorId;
  if (typeof input.digest !== "string" || !HEX_64.test(input.digest))
    return err("validation_error", "digest must be 64 lowercase hex chars");
  const sampleRefs = reqStringArray(input, "sampleRefs");
  if (!sampleRefs.ok) return sampleRefs;
  const policyVersion = reqString(input, "policyVersion");
  if (!policyVersion.ok) return policyVersion;
  const simulatorSource = reqEnum(input, "simulatorSource", SOURCE_KINDS, "SourceKind");
  if (!simulatorSource.ok) return simulatorSource;
  const capturedAtMs = reqEpoch(input, "capturedAtMs");
  if (!capturedAtMs.ok) return capturedAtMs;
  return ok({
    evidenceId: evidenceId.value,
    taskId: taskId.value,
    assignmentVersion: versionRaw,
    operatorId: operatorId.value,
    sampleRefs: sampleRefs.value,
    policyVersion: policyVersion.value,
    digest: input.digest as EvidenceDigest,
    simulatorSource: simulatorSource.value,
    capturedAtMs: capturedAtMs.value,
  });
}

export function makeVerdict(input: unknown): Result<Verdict> {
  if (!isRecord(input)) return err("validation_error", "verdict must be an object");
  const evidenceId = asEvidenceId(String(input.evidenceId ?? ""));
  if (!evidenceId.ok) return evidenceId;
  if (typeof input.accepted !== "boolean")
    return err("validation_error", "accepted must be a boolean");
  const reasons = reqStringArray(input, "reasons");
  if (!reasons.ok) return reasons;
  const verifierId = reqString(input, "verifierId");
  if (!verifierId.ok) return verifierId;
  const verdictVersion = reqString(input, "verdictVersion");
  if (!verdictVersion.ok) return verdictVersion;
  const decidedAtMs = reqEpoch(input, "decidedAtMs");
  if (!decidedAtMs.ok) return decidedAtMs;
  return ok({
    evidenceId: evidenceId.value,
    accepted: input.accepted,
    reasons: reasons.value,
    verifierId: verifierId.value,
    verdictVersion: verdictVersion.value,
    decidedAtMs: decidedAtMs.value,
  });
}

// ---------------------------------------------------------------------------
// Chain event record (receipt shape proposed to #5 — see CHAIN_SEAM.md §6;
// marked DRAFT until the escrow owner agrees)
// ---------------------------------------------------------------------------

export interface ChainEventRecord {
  readonly kind: ChainEventKind;
  readonly missionId: MissionId;
  readonly taskId?: TaskId;
  /** Assignment version this transaction targets. REQUIRED for
   * reassignment/payout receipts (review Finding D). */
  readonly assignmentVersion?: number;
  readonly transactionSignature: string;
  readonly cluster: Cluster;
  /** Monotone status history; last entry is current (enums.ts rule). */
  readonly statusHistory: readonly ChainTxStatus[];
  readonly submittedAtMs: EpochMs;
  readonly confirmedAtMs?: EpochMs;
  readonly slot?: number;
  /** Value moved by the transaction when known at submission (lamports).
   * REQUIRED for funding/reassignment/payout receipts. */
  readonly amountLamports?: Lamports;
  /** Authorization provenance for reassignment transactions. */
  readonly authorizedBy?: AuthorizationActor;
}

/** Idempotency-key carrier shared by mutating events (ARCHITECTURE.md §4). */
export interface CommandProvenance {
  readonly commandId: CommandId;
}

export function asCommandProvenance(raw: unknown): Result<CommandProvenance> {
  if (!isRecord(raw)) return err("validation_error", "command provenance must be an object");
  const commandId = asCommandId(String(raw.commandId ?? ""));
  if (!commandId.ok) return commandId;
  return ok({ commandId: commandId.value });
}

/** Registered payout wallet of an operator (CHAIN_SEAM.md §3). */
export interface OperatorRegistration {
  readonly operatorId: OperatorId;
  readonly payoutWallet: SolanaPublicKey;
}

export function makeOperatorRegistration(input: unknown): Result<OperatorRegistration> {
  if (!isRecord(input)) return err("validation_error", "operator registration must be an object");
  const operatorId = asOperatorId(String(input.operatorId ?? ""));
  if (!operatorId.ok) return operatorId;
  if (typeof input.payoutWallet !== "string")
    return err("validation_error", "payoutWallet must be a string");
  const payoutWallet = asSolanaPublicKey(input.payoutWallet);
  if (!payoutWallet.ok) return payoutWallet;
  return ok({ operatorId: operatorId.value, payoutWallet: payoutWallet.value });
}

/** Re-exported so consumers can range-check serialized enum values. */
export { AUTHORIZATION_ACTORS, CLUSTERS };
