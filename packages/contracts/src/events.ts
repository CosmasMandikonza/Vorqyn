/**
 * VORQYN shared contracts — mission event catalogue (VQ-01 / issue #2).
 *
 * The MissionEvent envelope is the single unit of persisted truth. The
 * reducer (reducer.ts) accepts ONLY events that pass validateMissionEvent,
 * so malformed/future-versioned data is rejected at the boundary instead
 * of corrupting projections.
 *
 * Clock-domain rules (ARCHITECTURE.md §4, enforced by the reducer):
 * - simulatorTimeMs may appear only on simulation-originated task events;
 * - chainTimeMs may appear only on chain confirmation events;
 * - the two are never interchangeable and never derived from each other.
 */

import {
  asEpochMs,
  asEventId,
  asLamports,
  asMissionId,
  asSimulatorTimeMs,
  asTaskId,
  asTransactionSignature,
  CONTRACTS_SCHEMA_VERSION,
  err,
  ok,
  type EpochMs,
  type EventId,
  type Lamports,
  type MissionId,
  type Result,
  type SimulatorTimeMs,
  type TaskId,
  type TransactionSignature,
} from "./core";
import {
  makeEvidence,
  makeMissionConfig,
  makeOperatorOffer,
  makeVerdict,
  type Evidence,
  type MissionConfig,
  type OperatorOffer,
  type Verdict,
} from "./entities";
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
// Payload types (discriminated by envelope.kind)
// ---------------------------------------------------------------------------

export interface MissionCreatedPayload {
  readonly config: MissionConfig;
}

export interface MissionLaunchedPayload {
  readonly reason?: string;
}

export interface MissionClosedPayload {
  readonly reason: string;
}

export interface MissionFailedPayload {
  readonly reason: string;
}

export interface TaskAssignedPayload {
  readonly taskId: TaskId;
  readonly operatorId: string;
  readonly robotId: string;
  readonly offerId?: string;
  readonly quoteLamports: Lamports;
}

export interface TaskExecutionStartedPayload {
  readonly taskId: TaskId;
  readonly robotId: string;
}

export interface TaskEvidenceSubmittedPayload {
  readonly taskId: TaskId;
  readonly evidence: Evidence;
}

export interface TaskEvidenceRejectedPayload {
  readonly taskId: TaskId;
  readonly verdict: Verdict;
}

export interface RecoveryProposal {
  readonly offerId: string;
  readonly rationale: string;
  /** Structured cost check the AI/policy layer performed (rule-based). */
  readonly checkedCosts: readonly string[];
  readonly limitations: readonly string[];
}

export interface RejectedAlternative {
  readonly offerId: string;
  readonly reasonCode: string;
  readonly reason: string;
}

export interface TaskRecoveryProposedPayload {
  readonly taskId: TaskId;
  readonly proposal: RecoveryProposal;
  readonly rejectedAlternatives: readonly RejectedAlternative[];
}

export interface TaskReassignmentAuthorizedPayload {
  readonly taskId: TaskId;
  /** Must equal the task's current assignment version (compare-and-set). */
  readonly expectedVersion: number;
  readonly newOperatorId: string;
  readonly newRobotId: string;
  readonly offerId: string;
  readonly quoteLamports: Lamports;
  readonly authorizedBy: AuthorizationActor;
  /** Chain transaction that enacted the reassignment (must be confirmed). */
  readonly transactionSignature: string;
}

export interface TaskEvidenceAcceptedPayload {
  readonly taskId: TaskId;
  readonly verdict: Verdict;
}

export interface TaskPaymentConfirmedPayload {
  readonly taskId: TaskId;
  readonly transactionSignature: string;
  readonly amountLamports: Lamports;
}

export interface TaskCancelledPayload {
  readonly taskId: TaskId;
  readonly reason: string;
}

export interface ChainTransactionSubmittedPayload {
  readonly kind: ChainEventKind;
  readonly taskId?: TaskId;
  readonly assignmentVersion?: number;
  readonly transactionSignature: string;
  readonly cluster: Cluster;
  /** Value moved by the transaction when known at submission (lamports);
   * used for funding accounting and payout cross-checks. */
  readonly amountLamports?: Lamports;
  readonly authorizedBy?: AuthorizationActor;
}

export interface ChainTransactionUpdatedPayload {
  readonly transactionSignature: string;
  readonly status: ChainTxStatus;
  readonly slot?: number;
}

export type MissionEventKind =
  | "mission.created"
  | "mission.launched"
  | "mission.closed"
  | "mission.failed"
  | "task.assigned"
  | "task.executionStarted"
  | "task.evidenceSubmitted"
  | "task.evidenceRejected"
  | "task.recoveryProposed"
  | "task.reassignmentAuthorized"
  | "task.evidenceAccepted"
  | "task.paymentConfirmed"
  | "task.cancelled"
  | "chain.transactionSubmitted"
  | "chain.transactionUpdated";

export const MISSION_EVENT_KINDS: readonly MissionEventKind[] = [
  "mission.created",
  "mission.launched",
  "mission.closed",
  "mission.failed",
  "task.assigned",
  "task.executionStarted",
  "task.evidenceSubmitted",
  "task.evidenceRejected",
  "task.recoveryProposed",
  "task.reassignmentAuthorized",
  "task.evidenceAccepted",
  "task.paymentConfirmed",
  "task.cancelled",
  "chain.transactionSubmitted",
  "chain.transactionUpdated",
];

export type MissionEventPayload =
  | MissionCreatedPayload
  | MissionLaunchedPayload
  | MissionClosedPayload
  | MissionFailedPayload
  | TaskAssignedPayload
  | TaskExecutionStartedPayload
  | TaskEvidenceSubmittedPayload
  | TaskEvidenceRejectedPayload
  | TaskRecoveryProposedPayload
  | TaskReassignmentAuthorizedPayload
  | TaskEvidenceAcceptedPayload
  | TaskPaymentConfirmedPayload
  | TaskCancelledPayload
  | ChainTransactionSubmittedPayload
  | ChainTransactionUpdatedPayload;

export interface MissionEventPayloadMap {
  "mission.created": MissionCreatedPayload;
  "mission.launched": MissionLaunchedPayload;
  "mission.closed": MissionClosedPayload;
  "mission.failed": MissionFailedPayload;
  "task.assigned": TaskAssignedPayload;
  "task.executionStarted": TaskExecutionStartedPayload;
  "task.evidenceSubmitted": TaskEvidenceSubmittedPayload;
  "task.evidenceRejected": TaskEvidenceRejectedPayload;
  "task.recoveryProposed": TaskRecoveryProposedPayload;
  "task.reassignmentAuthorized": TaskReassignmentAuthorizedPayload;
  "task.evidenceAccepted": TaskEvidenceAcceptedPayload;
  "task.paymentConfirmed": TaskPaymentConfirmedPayload;
  "task.cancelled": TaskCancelledPayload;
  "chain.transactionSubmitted": ChainTransactionSubmittedPayload;
  "chain.transactionUpdated": ChainTransactionUpdatedPayload;
}

export interface MissionEvent<K extends MissionEventKind = MissionEventKind> {
  readonly eventId: EventId;
  readonly missionId: MissionId;
  /** Per-mission, strictly increasing, no gaps allowed by the reducer. */
  readonly sequence: number;
  readonly kind: K;
  readonly payload: K extends MissionEventKind ? MissionEventPayloadMap[K] : never;
  /** Domain clock 1: service wall-clock when the fact was recorded. */
  readonly occurredAtMs: EpochMs;
  /** Domain clock 2: when the event log observed/stored the event. */
  readonly observedAtMs: EpochMs;
  /** Domain clock 3a: simulator step time (sim-originated task events only). */
  readonly simulatorTimeMs?: SimulatorTimeMs;
  /** Domain clock 3b: chain confirmation time (confirmed chain events only). */
  readonly chainTimeMs?: EpochMs;
  readonly schemaVersion: number;
  /** Idempotency key of the command that produced this event (mutations only). */
  readonly commandId?: string;
}

/** Kinds that carry a simulator timestamp. */
export const SIM_CLOCK_EVENT_KINDS: readonly MissionEventKind[] = [
  "task.executionStarted",
  "task.evidenceSubmitted",
];

/** Kinds that carry a chain confirmation timestamp (confirmation only). */
export const CHAIN_CLOCK_EVENT_KINDS: readonly MissionEventKind[] = [
  "chain.transactionUpdated",
];

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

const expectObject = (raw: unknown, what: string): Result<Record<string, unknown>> =>
  typeof raw === "object" && raw !== null
    ? ok(raw as Record<string, unknown>)
    : err("validation_error", `${what} must be an object`);

const expectString = (raw: unknown, what: string): Result<string> =>
  typeof raw === "string" && raw.length > 0 ? ok(raw) : err("validation_error", `${what} must be a non-empty string`);

const expectPositiveInt = (raw: unknown, what: string): Result<number> =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? ok(raw)
    : err("validation_error", `${what} must be a positive integer`);

/**
 * Structural validation of a persisted/transported event. Unknown kinds and
 * mismatched schemaVersion are explicit errors — a future event version is
 * never partially interpreted (docs/ARCHITECTURE.md integration protocol).
 */
export function validateMissionEvent(raw: unknown): Result<MissionEvent> {
  const envelope = expectObject(raw, "event");
  if (!envelope.ok) return envelope;

  const eventId = asEventId(String(envelope.value.eventId ?? ""));
  if (!eventId.ok) return err("validation_error", `eventId invalid: ${eventId.error.message}`);
  const missionId = asMissionId(String(envelope.value.missionId ?? ""));
  if (!missionId.ok) return err("validation_error", `missionId invalid: ${missionId.error.message}`);
  const sequence = expectPositiveInt(envelope.value.sequence, "sequence");
  if (!sequence.ok) return sequence;

  const kind = envelope.value.kind;
  if (typeof kind !== "string" || !MISSION_EVENT_KINDS.includes(kind as MissionEventKind))
    return err("unknown_event_kind", `unknown event kind ${String(kind)}`);

  const schemaVersion = envelope.value.schemaVersion;
  if (schemaVersion !== CONTRACTS_SCHEMA_VERSION)
    return err(
      "unsupported_schema_version",
      `event schemaVersion ${String(schemaVersion)} != supported ${CONTRACTS_SCHEMA_VERSION}`,
    );

  const occurredAtMs = asEpochMs(Number(envelope.value.occurredAtMs));
  if (!occurredAtMs.ok) return occurredAtMs;
  const observedAtMs = asEpochMs(Number(envelope.value.observedAtMs));
  if (!observedAtMs.ok) return observedAtMs;

  const payload = expectObject(envelope.value.payload, "payload");
  if (!payload.ok) return payload;

  let simulatorTimeMs: SimulatorTimeMs | undefined;
  if (envelope.value.simulatorTimeMs !== undefined) {
    const sim = asSimulatorTimeMs(Number(envelope.value.simulatorTimeMs));
    if (!sim.ok) return sim;
    if (!SIM_CLOCK_EVENT_KINDS.includes(kind as MissionEventKind))
      return err("clock_domain_violation", `simulatorTimeMs not allowed on ${String(kind)}`);
    simulatorTimeMs = sim.value;
  }
  let chainTimeMs: EpochMs | undefined;
  if (envelope.value.chainTimeMs !== undefined) {
    const chain = asEpochMs(Number(envelope.value.chainTimeMs));
    if (!chain.ok) return chain;
    if (!CHAIN_CLOCK_EVENT_KINDS.includes(kind as MissionEventKind))
      return err("clock_domain_violation", `chainTimeMs not allowed on ${String(kind)}`);
    chainTimeMs = chain.value;
  }
  let commandId: string | undefined;
  if (envelope.value.commandId !== undefined) {
    const command = expectString(envelope.value.commandId, "commandId");
    if (!command.ok) return command;
    commandId = command.value;
  }

  const event: MissionEvent = {
    eventId: eventId.value,
    missionId: missionId.value,
    sequence: sequence.value,
    kind: kind as MissionEventKind,
    payload: payload.value as MissionEventPayload,
    occurredAtMs: occurredAtMs.value,
    observedAtMs: observedAtMs.value,
    schemaVersion,
    ...(simulatorTimeMs !== undefined ? { simulatorTimeMs } : {}),
    ...(chainTimeMs !== undefined ? { chainTimeMs } : {}),
    ...(commandId !== undefined ? { commandId } : {}),
  };
  return ok(event);
}

// ---------------------------------------------------------------------------
// Payload validators (used by the reducer before applying)
// ---------------------------------------------------------------------------

export function validateMissionCreatedPayload(raw: unknown): Result<MissionCreatedPayload> {
  const obj = expectObject(raw, "mission.created payload");
  if (!obj.ok) return obj;
  const configObj = expectObject(obj.value.config, "config");
  if (!configObj.ok) return configObj;
  const config = makeMissionConfig(configObj.value as Parameters<typeof makeMissionConfig>[0]);
  if (!config.ok) return config;
  return ok({ config: config.value });
}

export function validateTaskAssignedPayload(raw: unknown): Result<TaskAssignedPayload> {
  const obj = expectObject(raw, "task.assigned payload");
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const operatorId = expectString(obj.value.operatorId, "operatorId");
  if (!operatorId.ok) return operatorId;
  const robotId = expectString(obj.value.robotId, "robotId");
  if (!robotId.ok) return robotId;
  const quote = asLamports(Number(obj.value.quoteLamports));
  if (!quote.ok) return quote;
  let offerId: string | undefined;
  if (obj.value.offerId !== undefined) {
    const offer = expectString(obj.value.offerId, "offerId");
    if (!offer.ok) return offer;
    offerId = offer.value;
  }
  return ok({
    taskId: taskId.value,
    operatorId: operatorId.value,
    robotId: robotId.value,
    quoteLamports: quote.value,
    ...(offerId !== undefined ? { offerId } : {}),
  });
}

export function validateEvidencePayload(
  raw: unknown,
  what: string,
): Result<{ taskId: TaskId; evidence: Evidence }> {
  const obj = expectObject(raw, `${what} payload`);
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const evidenceObj = expectObject(obj.value.evidence, "evidence");
  if (!evidenceObj.ok) return evidenceObj;
  const evidence = makeEvidence(evidenceObj.value as Parameters<typeof makeEvidence>[0]);
  if (!evidence.ok) return evidence;
  return ok({ taskId: taskId.value, evidence: evidence.value });
}

export function validateVerdictPayload(
  raw: unknown,
  what: string,
): Result<{ taskId: TaskId; verdict: Verdict }> {
  const obj = expectObject(raw, `${what} payload`);
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const verdictObj = expectObject(obj.value.verdict, "verdict");
  if (!verdictObj.ok) return verdictObj;
  const verdict = makeVerdict(verdictObj.value as Parameters<typeof makeVerdict>[0]);
  if (!verdict.ok) return verdict;
  return ok({ taskId: taskId.value, verdict: verdict.value });
}

export function validateRecoveryProposedPayload(raw: unknown): Result<TaskRecoveryProposedPayload> {
  const obj = expectObject(raw, "task.recoveryProposed payload");
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const proposalObj = expectObject(obj.value.proposal, "proposal");
  if (!proposalObj.ok) return proposalObj;
  const rationale = expectString(proposalObj.value.rationale, "proposal.rationale");
  if (!rationale.ok) return rationale;
  const checkedCosts = Array.isArray(proposalObj.value.checkedCosts) ? proposalObj.value.checkedCosts.map(String) : [];
  const limitations = Array.isArray(proposalObj.value.limitations) ? proposalObj.value.limitations.map(String) : [];
  const alts = Array.isArray(obj.value.rejectedAlternatives) ? obj.value.rejectedAlternatives : [];
  const rejectedAlternatives: RejectedAlternative[] = [];
  for (const alt of alts) {
    const altObj = expectObject(alt, "rejectedAlternative");
    if (!altObj.ok) return altObj;
    const offerId = expectString(altObj.value.offerId, "alternative.offerId");
    if (!offerId.ok) return offerId;
    const reasonCode = expectString(altObj.value.reasonCode, "alternative.reasonCode");
    if (!reasonCode.ok) return reasonCode;
    const reason = expectString(altObj.value.reason, "alternative.reason");
    if (!reason.ok) return reason;
    rejectedAlternatives.push({ offerId: offerId.value, reasonCode: reasonCode.value, reason: reason.value });
  }
  const offerId = expectString(proposalObj.value.offerId, "proposal.offerId");
  if (!offerId.ok) return offerId;
  return ok({
    taskId: taskId.value,
    proposal: { offerId: offerId.value, rationale: rationale.value, checkedCosts, limitations },
    rejectedAlternatives,
  });
}

export function validateReassignmentPayload(raw: unknown): Result<TaskReassignmentAuthorizedPayload> {
  const obj = expectObject(raw, "task.reassignmentAuthorized payload");
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const expectedVersion = expectPositiveInt(obj.value.expectedVersion, "expectedVersion");
  if (!expectedVersion.ok) return expectedVersion;
  const newOperatorId = expectString(obj.value.newOperatorId, "newOperatorId");
  if (!newOperatorId.ok) return newOperatorId;
  const newRobotId = expectString(obj.value.newRobotId, "newRobotId");
  if (!newRobotId.ok) return newRobotId;
  const offerId = expectString(obj.value.offerId, "offerId");
  if (!offerId.ok) return offerId;
  const quote = asLamports(Number(obj.value.quoteLamports));
  if (!quote.ok) return quote;
  const authorizedBy = obj.value.authorizedBy;
  if (authorizedBy !== "owner" && authorizedBy !== "delegate")
    return err("validation_error", "authorizedBy must be 'owner' or 'delegate'");
  const signature = asTransactionSignature(String(obj.value.transactionSignature ?? ""));
  if (!signature.ok) return signature;
  return ok({
    taskId: taskId.value,
    expectedVersion: expectedVersion.value,
    newOperatorId: newOperatorId.value,
    newRobotId: newRobotId.value,
    offerId: offerId.value,
    quoteLamports: quote.value,
    authorizedBy,
    transactionSignature: signature.value,
  });
}

export function validatePaymentPayload(raw: unknown): Result<TaskPaymentConfirmedPayload> {
  const obj = expectObject(raw, "task.paymentConfirmed payload");
  if (!obj.ok) return obj;
  const taskId = asTaskId(String(obj.value.taskId ?? ""));
  if (!taskId.ok) return taskId;
  const signature = asTransactionSignature(String(obj.value.transactionSignature ?? ""));
  if (!signature.ok) return signature;
  const amount = asLamports(Number(obj.value.amountLamports));
  if (!amount.ok) return amount;
  return ok({ taskId: taskId.value, transactionSignature: signature.value, amountLamports: amount.value });
}

export function validateChainSubmittedPayload(raw: unknown): Result<ChainTransactionSubmittedPayload> {
  const obj = expectObject(raw, "chain.transactionSubmitted payload");
  if (!obj.ok) return obj;
  const kind = obj.value.kind;
  if (typeof kind !== "string" || !["funding", "reassignment", "payout", "refund"].includes(kind))
    return err("validation_error", `chain kind ${String(kind)} invalid`);
  const signature = asTransactionSignature(String(obj.value.transactionSignature ?? ""));
  if (!signature.ok) return signature;
  const cluster = obj.value.cluster;
  if (typeof cluster !== "string" || !["localnet", "devnet", "mainnet-beta"].includes(cluster))
    return err("validation_error", `cluster ${String(cluster)} invalid`);
  let taskId: TaskId | undefined;
  if (obj.value.taskId !== undefined) {
    const task = asTaskId(String(obj.value.taskId));
    if (!task.ok) return task;
    taskId = task.value;
  }
  let assignmentVersion: number | undefined;
  if (obj.value.assignmentVersion !== undefined) {
    const version = expectPositiveInt(obj.value.assignmentVersion, "assignmentVersion");
    if (!version.ok) return version;
    assignmentVersion = version.value;
  }
  let authorizedBy: AuthorizationActor | undefined;
  if (obj.value.authorizedBy !== undefined) {
    if (obj.value.authorizedBy !== "owner" && obj.value.authorizedBy !== "delegate")
      return err("validation_error", "authorizedBy must be 'owner' or 'delegate'");
    authorizedBy = obj.value.authorizedBy;
  }
  let amountLamports: Lamports | undefined;
  if (obj.value.amountLamports !== undefined) {
    const amount = asLamports(Number(obj.value.amountLamports));
    if (!amount.ok) return amount;
    amountLamports = amount.value;
  }
  return ok({
    kind: kind as ChainEventKind,
    transactionSignature: signature.value,
    cluster: cluster as Cluster,
    ...(taskId !== undefined ? { taskId } : {}),
    ...(assignmentVersion !== undefined ? { assignmentVersion } : {}),
    ...(authorizedBy !== undefined ? { authorizedBy } : {}),
    ...(amountLamports !== undefined ? { amountLamports } : {}),
  });
}

export function validateChainUpdatedPayload(raw: unknown): Result<ChainTransactionUpdatedPayload> {
  const obj = expectObject(raw, "chain.transactionUpdated payload");
  if (!obj.ok) return obj;
  const signature = asTransactionSignature(String(obj.value.transactionSignature ?? ""));
  if (!signature.ok) return signature;
  const status = obj.value.status;
  if (typeof status !== "string" || !["unsigned", "awaiting_wallet", "submitted", "processed", "confirmed", "finalized", "expired", "rejected", "unknown"].includes(status))
    return err("validation_error", `chain status ${String(status)} invalid`);
  let slot: number | undefined;
  if (obj.value.slot !== undefined) {
    if (typeof obj.value.slot !== "number" || !Number.isSafeInteger(obj.value.slot) || obj.value.slot < 0)
      return err("validation_error", "slot must be a non-negative integer");
    slot = obj.value.slot;
  }
  return ok({
    transactionSignature: signature.value,
    status: status as ChainTxStatus,
    ...(slot !== undefined ? { slot } : {}),
  });
}

/** Convenience re-exports for consumers building fixtures. */
export { makeOperatorOffer };
export type { OperatorOffer, RobotClass, SourceKind, TaskKind, TransactionSignature };
