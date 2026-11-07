/**
 * VORQYN shared contracts — deterministic mission reducer (VQ-01 / #2).
 *
 * Pure event-sourced projection: the ONLY way mission/task state changes is
 * by applying a validated MissionEvent. No clocks, randomness or I/O. The
 * same event list always yields a structurally identical projection, so
 * reload/replay/rehydration are the same operation.
 *
 * Enforced invariants (docs/ARCHITECTURE.md §4, docs/SOLANA_PROTOCOL.md §5):
 * - gapless per-mission sequences; same eventId replay is an idempotent
 *   no-op; same commandId never produces two different events;
 * - exactly one current assignment version per task; evidence/verdict/
 *   payment bound to that version; stale versions rejected;
 * - "paid" requires a CONFIRMED chain payout for the current version with
 *   the exact agreed amount — payment can never precede chain truth;
 * - committed rewards never exceed confirmed funding;
 * - mission events cannot mutate another mission's entities.
 */

import {
  CONTRACTS_SCHEMA_VERSION,
  err,
  ok,
  subLamports,
  addLamports,
  type ContractError,
  type EventId,
  type Lamports,
  type MissionId,
  type Result,
  type TaskId,
} from "./core";
import type { Assignment, ChainEventRecord, Evidence, MissionConfig, TaskConfig, Verdict } from "./entities";
import { chainTxTransitionAllowed, type MissionLifecycle, type MissionState, type TaskStatus } from "./enums";
import {
  validateChainSubmittedPayload,
  validateChainUpdatedPayload,
  validateMissionCreatedPayload,
  validateMissionEvent,
  validatePaymentPayload,
  validateReassignmentPayload,
  validateRecoveryProposedPayload,
  validateTaskAssignedPayload,
  validateEvidencePayload,
  validateVerdictPayload,
  type MissionEvent,
  type RecoveryProposal,
  type RejectedAlternative,
} from "./events";

// ---------------------------------------------------------------------------
// Projection shapes
// ---------------------------------------------------------------------------

export interface TaskProjection {
  readonly config: TaskConfig;
  status: TaskStatus;
  /** 0 until first assignment; 1,2,3… thereafter. */
  currentAssignmentVersion: number;
  /** Full assignment history keyed by version (audit trail). */
  assignments: Record<number, Assignment>;
  evidenceIds: Evidence["evidenceId"][];
  /** Submitted evidence not yet judged by a verdict event. */
  pendingEvidenceIds: Evidence["evidenceId"][];
  /** Evidence accepted for the current assignment version, if any. */
  acceptedEvidenceId?: Evidence["evidenceId"];
  recoveryProposal?: RecoveryProposal;
  rejectedAlternatives: RejectedAlternative[];
  payoutSignature?: string;
}

export interface MissionProjection {
  readonly schemaVersion: number;
  readonly missionId: MissionId;
  readonly config: MissionConfig;
  lifecycle: MissionLifecycle;
  /** Keys are validated TaskIds; plain strings for JSON-friendly indexing. */
  tasks: Record<string, TaskProjection>;
  evidence: Record<string, Evidence>;
  verdicts: Record<string, Verdict>;
  chain: Record<string, ChainEventRecord>;
  /** Sum of confirmed funding transactions. */
  fundedLamports: Lamports;
  /** Sum of quotes of still-active assignments (unpaid, uncancelled). */
  committedRewardLamports: Lamports;
  paidLamports: Lamports;
  lastSequence: number;
  /** Applied event ids in order (the timeline UI renders this). */
  timeline: EventId[];
  eventIdIndex: Record<string, number>;
  /** Idempotency: commandId -> the eventId it produced. */
  commandIndex: Record<string, EventId>;
}

export type ApplyResult =
  | { ok: true; state: MissionProjection; duplicate: boolean }
  | { ok: false; error: ContractError };

// ---------------------------------------------------------------------------
// Legal task status transitions (single source for docs and tests)
// ---------------------------------------------------------------------------

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  unassigned: ["assigned", "cancelled"],
  assigned: ["executing", "cancelled"],
  executing: ["evidence_insufficient", "verified", "cancelled"],
  evidence_insufficient: ["recovery_pending", "reassigned", "cancelled"],
  recovery_pending: ["reassigned", "cancelled"],
  reassigned: ["executing", "cancelled"],
  verified: ["paid"],
  paid: [],
  cancelled: [],
};

const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["paid", "cancelled"];

function transition(
  task: TaskProjection,
  to: TaskStatus,
  via: string,
): { ok: true } | { ok: false; error: ContractError } {
  const allowed = TASK_TRANSITIONS[task.status];
  if (!allowed.includes(to))
    return err(
      "illegal_transition",
      `${via}: task ${task.config.taskId} cannot move ${task.status} -> ${to}`,
    );
  task.status = to;
  return ok({});
}

// ---------------------------------------------------------------------------
// Initialization from mission.created
// ---------------------------------------------------------------------------

export function initMissionProjection(rawEvent: unknown): Result<MissionProjection> {
  const event = validateMissionEvent(rawEvent);
  if (!event.ok) return event;
  if (event.value.kind !== "mission.created")
    return err("illegal_transition", "first event must be mission.created");
  const payload = validateMissionCreatedPayload(event.value.payload);
  if (!payload.ok) return payload;
  const config = payload.value.config;

  const tasks: Record<string, TaskProjection> = {};
  for (const taskConfig of config.tasks) {
    tasks[taskConfig.taskId] = {
      config: taskConfig,
      status: "unassigned",
      currentAssignmentVersion: 0,
      assignments: {},
      evidenceIds: [],
      pendingEvidenceIds: [],
      rejectedAlternatives: [],
    };
  }
  return ok({
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    missionId: event.value.missionId,
    config,
    lifecycle: "draft",
    tasks,
    evidence: {},
    verdicts: {},
    chain: {},
    fundedLamports: 0 as Lamports,
    committedRewardLamports: 0 as Lamports,
    paidLamports: 0 as Lamports,
    lastSequence: event.value.sequence,
    timeline: [event.value.eventId],
    eventIdIndex: { [event.value.eventId]: event.value.sequence },
    commandIndex: event.value.commandId !== undefined ? { [event.value.commandId]: event.value.eventId } : {},
  });
}

// ---------------------------------------------------------------------------
// Envelope-level application rules
// ---------------------------------------------------------------------------

function cloneProjection(state: MissionProjection): MissionProjection {
  return {
    ...state,
    tasks: Object.fromEntries(
      Object.entries(state.tasks).map(([id, task]) => [id, { ...task, assignments: { ...task.assignments }, evidenceIds: [...task.evidenceIds], pendingEvidenceIds: [...task.pendingEvidenceIds], rejectedAlternatives: [...task.rejectedAlternatives] }]),
    ),
    evidence: { ...state.evidence },
    verdicts: { ...state.verdicts },
    chain: { ...state.chain },
    timeline: [...state.timeline],
    eventIdIndex: { ...state.eventIdIndex },
    commandIndex: { ...state.commandIndex },
  };
}

export function applyEvent(state: MissionProjection, rawEvent: unknown): ApplyResult {
  const event = validateMissionEvent(rawEvent);
  if (!event.ok) return { ok: false, error: event.error };
  const e = event.value;

  if (e.missionId !== state.missionId)
    return { ok: false, error: { code: "cross_mission_reference", message: `event ${e.eventId} targets mission ${e.missionId} but projection is ${state.missionId}` } };

  // Idempotent replay of the exact same event.
  const seenAt = state.eventIdIndex[e.eventId];
  if (seenAt !== undefined) {
    if (seenAt === e.sequence) return { ok: true, state, duplicate: true };
    return { ok: false, error: { code: "duplicate_event", message: `eventId ${e.eventId} already applied at a different sequence` } };
  }
  if (e.sequence !== state.lastSequence + 1)
    return { ok: false, error: { code: e.sequence <= state.lastSequence ? "duplicate_sequence" : "validation_error", message: `expected sequence ${state.lastSequence + 1}, got ${e.sequence}` } };
  if (e.commandId !== undefined && state.commandIndex[e.commandId] !== undefined)
    return { ok: false, error: { code: "duplicate_idempotency_key", message: `commandId ${e.commandId} already produced event ${state.commandIndex[e.commandId]}` } };

  const next = cloneProjection(state);
  const outcome = applyToState(next, e);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  next.lastSequence = e.sequence;
  next.timeline.push(e.eventId);
  next.eventIdIndex[e.eventId] = e.sequence;
  if (e.commandId !== undefined) next.commandIndex[e.commandId] = e.eventId;
  return { ok: true, state: next, duplicate: false };
}

// ---------------------------------------------------------------------------
// Kind-specific handlers (mutate a cloned projection)
// ---------------------------------------------------------------------------

type HandlerResult = { ok: true } | { ok: false; error: ContractError };

function applyToState(state: MissionProjection, e: MissionEvent): HandlerResult {
  switch (e.kind) {
    case "mission.created":
      return err("illegal_transition", "mission.created is only valid as the first event (use initMissionProjection)");
    case "mission.launched":
      return applyLaunched(state);
    case "mission.closed":
      return applyClosed(state);
    case "mission.failed":
      return applyFailed(state);
    case "task.assigned":
      return applyTaskAssigned(state, e);
    case "task.executionStarted":
      return applyExecutionStarted(state, e);
    case "task.evidenceSubmitted":
      return applyEvidenceSubmitted(state, e);
    case "task.evidenceRejected":
      return applyEvidenceRejected(state, e);
    case "task.recoveryProposed":
      return applyRecoveryProposed(state, e);
    case "task.reassignmentAuthorized":
      return applyReassignmentAuthorized(state, e);
    case "task.evidenceAccepted":
      return applyEvidenceAccepted(state, e);
    case "task.paymentConfirmed":
      return applyPaymentConfirmed(state, e);
    case "task.cancelled":
      return applyTaskCancelled(state, e);
    case "chain.transactionSubmitted":
      return applyChainSubmitted(state, e);
    case "chain.transactionUpdated":
      return applyChainUpdated(state, e);
  }
}

function requireTask(state: MissionProjection, taskId: TaskId): Result<TaskProjection> {
  const task = state.tasks[taskId];
  return task !== undefined
    ? ok(task)
    : err("unknown_entity", `task ${taskId} is not part of mission ${state.missionId}`);
}

function requireRunning(state: MissionProjection): HandlerResult {
  if (state.lifecycle !== "running")
    return err("illegal_transition", `mission lifecycle is ${state.lifecycle}, expected running`);
  return ok({});
}

function confirmedChainRecord(
  state: MissionProjection,
  signature: string,
  expectKind: ChainEventRecord["kind"],
): Result<ChainEventRecord> {
  const record = state.chain[signature];
  if (record === undefined) return err("unknown_entity", `chain transaction ${signature} was never submitted`);
  if (record.kind !== expectKind)
    return err("illegal_transition", `chain transaction ${signature} is ${record.kind}, expected ${expectKind}`);
  const current = record.statusHistory[record.statusHistory.length - 1] ?? "unknown";
  if (current !== "confirmed" && current !== "finalized")
    return err("chain_not_confirmed", `chain transaction ${signature} status is ${current}; only confirmed/finalized authorizes state changes`);
  return ok(record);
}

// --- lifecycle -------------------------------------------------------------

function applyLaunched(state: MissionProjection): HandlerResult {
  if (state.lifecycle !== "ready")
    return err("illegal_transition", `launch requires funding to be confirmed (lifecycle ready), got ${state.lifecycle}`);
  if (state.fundedLamports < state.config.budgetLamports)
    return err("budget_exceeded", `mission funded ${state.fundedLamports} < budget ${state.config.budgetLamports}`);
  state.lifecycle = "running";
  return ok({});
}

function applyClosed(state: MissionProjection): HandlerResult {
  if (state.lifecycle === "closed" || state.lifecycle === "failed")
    return err("illegal_transition", `mission already ${state.lifecycle}`);
  for (const task of Object.values(state.tasks)) {
    if (!TERMINAL_TASK_STATUSES.includes(task.status))
      return err("illegal_transition", `cannot close: task ${task.config.taskId} is ${task.status} (unsettled obligations)`);
  }
  state.lifecycle = "closed";
  return ok({});
}

function applyFailed(state: MissionProjection): HandlerResult {
  if (state.lifecycle === "closed" || state.lifecycle === "failed")
    return err("illegal_transition", `mission already ${state.lifecycle}`);
  state.lifecycle = "failed";
  return ok({});
}

// --- chain ------------------------------------------------------------------

function applyChainSubmitted(state: MissionProjection, e: MissionEvent): HandlerResult {
  const payload = validateChainSubmittedPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  if (state.chain[p.transactionSignature] !== undefined)
    return err("duplicate_event", `chain transaction ${p.transactionSignature} already recorded`);
  if (state.lifecycle === "closed" || state.lifecycle === "failed")
    return err("illegal_transition", `mission is ${state.lifecycle}; no further chain activity`);
  if ((p.kind === "funding" || p.kind === "refund") && p.taskId !== undefined)
    return err("validation_error", `${p.kind} transactions must not reference a task`);
  if ((p.kind === "reassignment" || p.kind === "payout") && p.taskId === undefined)
    return err("validation_error", `${p.kind} transactions must reference a task`);

  state.chain[p.transactionSignature] = {
    kind: p.kind,
    missionId: state.missionId,
    ...(p.taskId !== undefined ? { taskId: p.taskId } : {}),
    ...(p.assignmentVersion !== undefined ? { assignmentVersion: p.assignmentVersion } : {}),
    transactionSignature: p.transactionSignature,
    cluster: p.cluster,
    statusHistory: ["submitted"],
    submittedAtMs: e.occurredAtMs,
    ...(p.amountLamports !== undefined ? { amountLamports: p.amountLamports } : {}),
    ...(p.authorizedBy !== undefined ? { authorizedBy: p.authorizedBy } : {}),
  };
  return ok({});
}

function applyChainUpdated(state: MissionProjection, e: MissionEvent): HandlerResult {
  const payload = validateChainUpdatedPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  const record = state.chain[p.transactionSignature];
  if (record === undefined)
    return err("unknown_entity", `chain transaction ${p.transactionSignature} was never submitted`);
  const current = record.statusHistory[record.statusHistory.length - 1] ?? "unknown";
  if (!chainTxTransitionAllowed(current, p.status))
    return err("illegal_transition", `chain transaction ${p.transactionSignature} cannot move ${current} -> ${p.status}`);

  if (p.status === "confirmed" || p.status === "finalized") {
    // A confirmation MUST carry the chain clock — without it the replay
    // timeline cannot order chain truth against simulation time.
    if (e.chainTimeMs === undefined)
      return err("clock_domain_violation", "confirmed/finalized chain updates must carry chainTimeMs");
    const updated: ChainEventRecord = {
      ...record,
      statusHistory: [...record.statusHistory, p.status],
      ...(p.slot !== undefined ? { slot: p.slot } : {}),
      ...(record.confirmedAtMs === undefined ? { confirmedAtMs: e.chainTimeMs } : {}),
    };
    state.chain[p.transactionSignature] = updated;

    if (record.kind === "funding") {
      const amount = updated.amountLamports ?? (0 as Lamports);
      const funded = addLamports(state.fundedLamports, amount);
      if (!funded.ok) return funded;
      state.fundedLamports = funded.value;
      if (state.lifecycle === "draft" || state.lifecycle === "funding") state.lifecycle = "ready";
    }
    return ok({});
  }

  state.chain[p.transactionSignature] = {
    ...record,
    statusHistory: [...record.statusHistory, p.status],
    ...(p.slot !== undefined ? { slot: p.slot } : {}),
  };
  return ok({});
}

// --- tasks ------------------------------------------------------------------

function applyTaskAssigned(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = validateTaskAssignedPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  const taskResult = requireTask(state, p.taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "unassigned")
    return err("illegal_transition", `task ${p.taskId} is ${task.status}; only unassigned tasks can be assigned`);
  if (p.quoteLamports > task.config.maxRewardLamports)
    return err("budget_exceeded", `quote ${p.quoteLamports} exceeds task budget ${task.config.maxRewardLamports}`);
  const committed = addLamports(state.committedRewardLamports, p.quoteLamports);
  if (!committed.ok) return committed;
  if (committed.value > state.fundedLamports)
    return err("budget_exceeded", `committed rewards ${committed.value} would exceed funded ${state.fundedLamports}`);

  task.currentAssignmentVersion = 1;
  task.assignments[1] = {
    taskId: p.taskId,
    version: 1,
    operatorId: p.operatorId as never,
    robotId: p.robotId as never,
    agreedLamports: p.quoteLamports,
    ...(p.offerId !== undefined ? { offerId: p.offerId as never } : {}),
    activatedAtMs: e.occurredAtMs,
  };
  state.committedRewardLamports = committed.value;
  return transition(task, "assigned", "task.assigned");
}

function currentAssignment(task: TaskProjection): Result<Assignment> {
  const assignment = task.assignments[task.currentAssignmentVersion];
  return assignment !== undefined
    ? ok(assignment)
    : err("illegal_transition", `task ${task.config.taskId} has no current assignment`);
}

function applyExecutionStarted(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = e.payload as { taskId?: string; robotId?: string };
  const taskId = String(payload.taskId ?? "");
  const taskResult = requireTask(state, taskId as TaskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "assigned" && task.status !== "reassigned")
    return err("illegal_transition", `task ${taskId} is ${task.status}; execution starts from assigned/reassigned`);
  const assignment = currentAssignment(task);
  if (!assignment.ok) return assignment;
  if (String(payload.robotId ?? "") !== assignment.value.robotId)
    return err("validation_error", `robot ${String(payload.robotId)} is not the assigned robot ${assignment.value.robotId}`);
  return transition(task, "executing", "task.executionStarted");
}

function applyEvidenceSubmitted(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = validateEvidencePayload(e.payload, "task.evidenceSubmitted");
  if (!payload.ok) return payload;
  const { taskId, evidence } = payload.value;
  const taskResult = requireTask(state, taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "executing")
    return err("illegal_transition", `task ${taskId} is ${task.status}; evidence arrives during executing`);
  if (evidence.assignmentVersion !== task.currentAssignmentVersion)
    return err("stale_assignment_version", `evidence for version ${evidence.assignmentVersion} but current is ${task.currentAssignmentVersion}`);
  const assignment = currentAssignment(task);
  if (!assignment.ok) return assignment;
  if (evidence.operatorId !== assignment.value.operatorId)
    return err("validation_error", `evidence operator ${evidence.operatorId} is not the assigned operator`);
  if (state.evidence[evidence.evidenceId] !== undefined)
    return err("duplicate_event", `evidence ${evidence.evidenceId} already exists`);

  state.evidence[evidence.evidenceId] = evidence;
  task.evidenceIds.push(evidence.evidenceId);
  task.pendingEvidenceIds.push(evidence.evidenceId);
  return ok({});
}

function applyEvidenceRejected(state: MissionProjection, e: MissionEvent): HandlerResult {
  const payload = validateVerdictPayload(e.payload, "task.evidenceRejected");
  if (!payload.ok) return payload;
  const { taskId, verdict } = payload.value;
  const taskResult = requireTask(state, taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (verdict.accepted !== false)
    return err("validation_error", "task.evidenceRejected must carry an accepted=false verdict");
  const index = task.pendingEvidenceIds.indexOf(verdict.evidenceId);
  if (index === -1)
    return err("unknown_entity", `verdict references evidence ${verdict.evidenceId} that is not pending for ${taskId}`);
  const evidence = state.evidence[verdict.evidenceId];
  if (evidence === undefined) return err("unknown_entity", `evidence ${verdict.evidenceId} missing`);
  if (evidence.assignmentVersion !== task.currentAssignmentVersion)
    return err("stale_assignment_version", `cannot judge version ${evidence.assignmentVersion} evidence against current ${task.currentAssignmentVersion}`);

  state.verdicts[verdict.evidenceId] = verdict;
  task.pendingEvidenceIds.splice(index, 1);
  return transition(task, "evidence_insufficient", "task.evidenceRejected");
}

function applyRecoveryProposed(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = validateRecoveryProposedPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  const taskResult = requireTask(state, p.taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "evidence_insufficient")
    return err("illegal_transition", `recovery proposal requires evidence_insufficient, got ${task.status}`);
  task.recoveryProposal = p.proposal;
  task.rejectedAlternatives = [...p.rejectedAlternatives];
  return transition(task, "recovery_pending", "task.recoveryProposed");
}

function applyReassignmentAuthorized(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = validateReassignmentPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  const taskResult = requireTask(state, p.taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "evidence_insufficient" && task.status !== "recovery_pending")
    return err("illegal_transition", `reassignment requires evidence_insufficient/recovery_pending, got ${task.status}`);
  if (p.expectedVersion !== task.currentAssignmentVersion)
    return err("stale_assignment_version", `reassignment expectedVersion ${p.expectedVersion} != current ${task.currentAssignmentVersion} (compare-and-set failed)`);

  const record = confirmedChainRecord(state, p.transactionSignature, "reassignment");
  if (!record.ok) return record;
  if (record.value.taskId !== p.taskId)
    return err("validation_error", `chain transaction targets task ${String(record.value.taskId)}, not ${p.taskId}`);
  if (record.value.assignmentVersion !== task.currentAssignmentVersion + 1)
    return err("stale_assignment_version", `chain transaction authorized version ${String(record.value.assignmentVersion)}, expected ${task.currentAssignmentVersion + 1}`);
  if (record.value.authorizedBy !== undefined && record.value.authorizedBy !== p.authorizedBy)
    return err("validation_error", `payload authorizedBy ${p.authorizedBy} contradicts chain record ${record.value.authorizedBy}`);

  if (p.quoteLamports > task.config.maxRewardLamports)
    return err("budget_exceeded", `reassignment quote ${p.quoteLamports} exceeds task budget ${task.config.maxRewardLamports}`);
  const previous = currentAssignment(task);
  if (!previous.ok) return previous;
  const afterRelease = subLamports(state.committedRewardLamports, previous.value.agreedLamports);
  if (!afterRelease.ok) return afterRelease;
  const afterCommit = addLamports(afterRelease.value, p.quoteLamports);
  if (!afterCommit.ok) return afterCommit;
  if (afterCommit.value > state.fundedLamports)
    return err("budget_exceeded", `recommitted rewards ${afterCommit.value} would exceed funded ${state.fundedLamports}`);

  const nextVersion = task.currentAssignmentVersion + 1;
  task.currentAssignmentVersion = nextVersion;
  task.assignments[nextVersion] = {
    taskId: p.taskId,
    version: nextVersion,
    operatorId: p.newOperatorId as never,
    robotId: p.newRobotId as never,
    agreedLamports: p.quoteLamports,
    offerId: p.offerId as never,
    activatedAtMs: e.occurredAtMs,
    chainSignature: p.transactionSignature,
  };
  state.committedRewardLamports = afterCommit.value;
  // Evidence from the failed version stays audit-visible but is no longer
  // pending; it can never be accepted or paid against the new version.
  task.pendingEvidenceIds = [];
  return transition(task, "reassigned", "task.reassignmentAuthorized");
}

function applyEvidenceAccepted(state: MissionProjection, e: MissionEvent): HandlerResult {
  const running = requireRunning(state);
  if (!running.ok) return running;
  const payload = validateVerdictPayload(e.payload, "task.evidenceAccepted");
  if (!payload.ok) return payload;
  const { taskId, verdict } = payload.value;
  const taskResult = requireTask(state, taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (verdict.accepted !== true)
    return err("validation_error", "task.evidenceAccepted must carry an accepted=true verdict");
  const index = task.pendingEvidenceIds.indexOf(verdict.evidenceId);
  if (index === -1)
    return err("unknown_entity", `verdict references evidence ${verdict.evidenceId} that is not pending for ${taskId}`);
  const evidence = state.evidence[verdict.evidenceId];
  if (evidence === undefined) return err("unknown_entity", `evidence ${verdict.evidenceId} missing`);
  if (evidence.assignmentVersion !== task.currentAssignmentVersion)
    return err("stale_assignment_version", `cannot accept version ${evidence.assignmentVersion} evidence against current ${task.currentAssignmentVersion}`);

  state.verdicts[verdict.evidenceId] = verdict;
  task.pendingEvidenceIds.splice(index, 1);
  task.acceptedEvidenceId = verdict.evidenceId;
  return transition(task, "verified", "task.evidenceAccepted");
}

function applyPaymentConfirmed(state: MissionProjection, e: MissionEvent): HandlerResult {
  const payload = validatePaymentPayload(e.payload);
  if (!payload.ok) return payload;
  const p = payload.value;
  const taskResult = requireTask(state, p.taskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (task.status !== "verified")
    return err("illegal_transition", `payment requires verified task, got ${task.status} (payment cannot precede confirmed acceptance)`);

  const record = confirmedChainRecord(state, p.transactionSignature, "payout");
  if (!record.ok) return record;
  if (record.value.taskId !== p.taskId)
    return err("validation_error", `payout transaction targets task ${String(record.value.taskId)}, not ${p.taskId}`);
  if (record.value.assignmentVersion !== undefined && record.value.assignmentVersion !== task.currentAssignmentVersion)
    return err("stale_assignment_version", `payout transaction is for version ${String(record.value.assignmentVersion)}, current is ${task.currentAssignmentVersion}`);
  const assignment = currentAssignment(task);
  if (!assignment.ok) return assignment;
  if (p.amountLamports !== assignment.value.agreedLamports)
    return err("validation_error", `payout amount ${p.amountLamports} != agreed ${assignment.value.agreedLamports}`);
  if (record.value.amountLamports !== undefined && record.value.amountLamports !== p.amountLamports)
    return err("validation_error", `payout amount disagrees with chain record (${record.value.amountLamports})`);

  const committed = subLamports(state.committedRewardLamports, assignment.value.agreedLamports);
  if (!committed.ok) return committed;
  const paid = addLamports(state.paidLamports, p.amountLamports);
  if (!paid.ok) return paid;
  state.committedRewardLamports = committed.value;
  state.paidLamports = paid.value;
  task.payoutSignature = p.transactionSignature;
  return transition(task, "paid", "task.paymentConfirmed");
}

function applyTaskCancelled(state: MissionProjection, e: MissionEvent): HandlerResult {
  const payload = e.payload as { taskId?: string; reason?: string };
  if (typeof payload.reason !== "string" || payload.reason.length === 0)
    return err("validation_error", "task.cancelled requires a reason");
  const taskId = String(payload.taskId ?? "");
  const taskResult = requireTask(state, taskId as TaskId);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value;
  if (TERMINAL_TASK_STATUSES.includes(task.status))
    return err("already_terminal", `task ${taskId} is already ${task.status}`);
  if (task.currentAssignmentVersion > 0) {
    const assignment = currentAssignment(task);
    if (assignment.ok) {
      const committed = subLamports(state.committedRewardLamports, assignment.value.agreedLamports);
      if (!committed.ok) return committed;
      state.committedRewardLamports = committed.value;
    }
  }
  return transition(task, "cancelled", "task.cancelled");
}

// ---------------------------------------------------------------------------
// Derived mission state
// ---------------------------------------------------------------------------

/**
 * Operational mission state derived from lifecycle + task states. Priority:
 * failed/closed > recovery_needed > verifying > completed > running.
 * Deriving (not storing) keeps a single source of truth — the events.
 */
export function deriveMissionState(state: MissionProjection): MissionState {
  if (state.lifecycle === "failed") return "failed";
  if (state.lifecycle === "closed") return "closed";
  if (state.lifecycle === "draft" || state.lifecycle === "funding" || state.lifecycle === "ready")
    return state.lifecycle;

  const tasks = Object.values(state.tasks);
  if (tasks.some((t) => t.status === "evidence_insufficient" || t.status === "recovery_pending"))
    return "recovery_needed";
  if (tasks.some((t) => t.pendingEvidenceIds.length > 0)) return "verifying";
  if (tasks.length > 0 && tasks.every((t) => TERMINAL_TASK_STATUSES.includes(t.status)))
    return "completed";
  return "running";
}

// ---------------------------------------------------------------------------
// Rehydration from persisted JSON
// ---------------------------------------------------------------------------

export interface Rehydrated {
  projection: MissionProjection;
  applied: number;
  duplicates: number;
}

/**
 * Rebuild a projection from a persisted event list (JSON boundary). Any
 * invalid event aborts with its index — unknown versions/kinds are never
 * partially applied.
 */
export function rehydrate(rawEvents: readonly unknown[]): Result<Rehydrated> {
  if (rawEvents.length === 0) return err("validation_error", "event list is empty");
  let state = initMissionProjection(rawEvents[0]);
  if (!state.ok) return state;
  let applied = 1;
  let duplicates = 0;
  for (let index = 1; index < rawEvents.length; index += 1) {
    const result = applyEvent(state.value, rawEvents[index]);
    if (!result.ok)
      return err(result.error.code, `event[${index}] rejected: ${result.error.message}`);
    if (result.duplicate) duplicates += 1;
    else applied += 1;
    state = { ok: true, value: result.state };
  }
  return ok({ projection: state.value, applied, duplicates });
}
