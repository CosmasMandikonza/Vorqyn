/**
 * Economic Handoff boundary (Issue #15, VQ-14 economic section).
 *
 * A READ-ONLY validated event-projection boundary over Lane 1's canonical
 * mission contracts. This module owns NO reducer and NO authority:
 * - raw canonical MissionEvents are validated and projected through the
 *   contracts' own reducer (packages/contracts/src/reducer.ts) via
 *   `rehydrate` — the single authoritative projection;
 * - per-event rejections (stale assignment versions, cross-mission events,
 *   clock-domain violations, malformed payloads) surface as audit entries,
 *   never as displayed state;
 * - the handoff stages are DERIVED from the resulting projection plus
 *   confirmed chain receipts. Missing authority renders as explicit
 *   pending/unavailable — never as a synthesized event.
 *
 * What this boundary is NOT: a chain client, a verifier, an AI planner or
 * a transaction source. Stages that require those authorities stay in their
 * honest waiting state until the owning issues (#49/#50/#51, #14) deliver
 * real events through this same boundary shape.
 */
import {
  applyEvent,
  initMissionProjection,
  validateMissionEvent,
  type MissionEvent,
  type MissionProjection,
} from "@vorqyn/contracts";

export interface HandoffContext {
  /** Mission whose events are displayed; others are excluded and audited. */
  readonly missionId: string;
  /** Underwater task whose recovery/handoff stages are displayed. */
  readonly taskId: string;
}

function rowFromEvent(event: MissionEvent): HandoffEventRow {
  const payload = event.payload as { transactionSignature?: string };
  return {
    sequence: event.sequence,
    kind: event.kind,
    occurredAtMs: event.occurredAtMs,
    ...(event.simulatorTimeMs !== undefined ? { simulatorTimeMs: event.simulatorTimeMs } : {}),
    ...(event.chainTimeMs !== undefined ? { chainTimeMs: event.chainTimeMs } : {}),
    ...(payload.transactionSignature !== undefined
      ? { transactionSignature: payload.transactionSignature }
      : {}),
  };
}

export interface HandoffAuditEntry {
  readonly code: string;
  readonly message: string;
  /** 0-based index into the ingested raw event list, when applicable. */
  readonly index?: number;
}

export type HandoffStageState =
  | "measured"
  | "awaiting-authority"
  | "awaiting-verifier"
  | "awaiting-proposals"
  | "proposed"
  | "authorized-awaiting-chain"
  | "submitted-awaiting-confirmation"
  | "confirmed"
  | "rejected"
  | "unavailable";

export interface HandoffConfirmation {
  readonly transactionSignature: string;
  readonly cluster?: string;
  readonly slot?: number;
  readonly chainTimeMs?: number;
  readonly amountLamports?: number;
  readonly recipientWallet?: string;
}

export interface HandoffStage {
  readonly id: string;
  readonly title: string;
  readonly state: HandoffStageState;
  /** Human-readable derivation: which recorded facts set this state. */
  readonly detail: string;
  /** Confirmed-chain specifics — only present in `confirmed` state. */
  readonly confirmation?: HandoffConfirmation;
}

export interface HandoffEventRow {
  readonly sequence: number;
  readonly kind: string;
  readonly occurredAtMs: number;
  readonly simulatorTimeMs?: number;
  readonly chainTimeMs?: number;
  readonly transactionSignature?: string;
}

export interface EconomicHandoffProjection {
  readonly missionId: string;
  readonly taskId: string;
  readonly stages: readonly HandoffStage[];
  /** Canonical event rows for the bound mission, in applied order. */
  readonly eventRows: readonly HandoffEventRow[];
  /** Rejections and exclusions surfaced for audit — never hidden. */
  readonly audit: readonly HandoffAuditEntry[];
  readonly derivedFromEventCount: number;
}

export interface ProjectHandoffOptions {
  /** Max simulator/sequence gap tolerated inside one ghost segment (ms). */
  readonly maxJoinGapMs?: number;
}

/**
 * Canonical confirmation test — mirrors the contracts reducer's
 * `confirmedChainRecord` exactly: a chain receipt authorizes state display
 * ONLY when its LATEST statusHistory entry is "confirmed" or "finalized"
 * AND its recorded kind matches the expected stage. A receipt whose latest
 * status is submitted/processed/unknown/expired/rejected — or an absent
 * receipt — NEVER counts as confirmed.
 */
function confirmedReceipt(
  projection: MissionProjection,
  signature: string,
  expectKind: "reassignment" | "payout",
): MissionProjection["chain"][string] | null {
  const record = projection.chain[signature];
  if (record === undefined || record.kind !== expectKind) return null;
  const last = record.statusHistory[record.statusHistory.length - 1];
  return last === "confirmed" || last === "finalized" ? record : null;
}

/** True when the receipt's LATEST status authorizes nothing (not confirmed). */
function unconfirmedStatus(
  projection: MissionProjection,
  signature: string,
  expectKind: "reassignment" | "payout",
): string | null {
  const record = projection.chain[signature];
  if (record === undefined || record.kind !== expectKind) return null;
  const last = record.statusHistory[record.statusHistory.length - 1];
  return last === "confirmed" || last === "finalized" ? null : (last ?? "unknown");
}

/**
 * The payout receipt bound to this task + assignment version, via the
 * reducer's own chain-record identity (kind "payout", taskId, version) —
 * independent of task.payoutSignature, which is only set once the payout
 * EVENT applies. Covers the honest in-flight window between a submitted
 * payout transaction and the recorded payment event.
 */
function payoutReceiptForTask(
  projection: MissionProjection,
  taskId: string,
  assignmentVersion: number,
): { signature: string; record: MissionProjection["chain"][string] } | null {
  for (const [signature, record] of Object.entries(projection.chain)) {
    if (record.kind !== "payout" || record.taskId !== taskId) continue;
    if (record.assignmentVersion !== undefined && record.assignmentVersion !== assignmentVersion) continue;
    return { signature, record };
  }
  return null;
}

/**
 * Project the six judge-story handoff stages from canonical MissionEvents.
 *
 * Ingestion is delegated to the contracts' own reducer (`rehydrate`): any
 * invalid event aborts ingestion at its index and the boundary reports the
 * rejection WITHOUT rendering stage state from untrusted input. Events bound
 * to a different mission are excluded up front and audited (cross-mission
 * isolation).
 */
export function projectEconomicHandoff(
  rawEvents: readonly unknown[],
  ctx: HandoffContext,
): EconomicHandoffProjection {
  const audit: HandoffAuditEntry[] = [];

  // Cross-mission isolation: display filter + audit (the reducer enforces
  // the same invariant during application).
  const bound: unknown[] = [];
  for (const [index, raw] of rawEvents.entries()) {
    const missionId = (raw as { missionId?: string } | null)?.missionId;
    if (typeof missionId === "string" && missionId !== ctx.missionId) {
      audit.push({
        code: "cross_mission_event_excluded",
        message: `event ${index} belongs to mission "${missionId}", not "${ctx.missionId}" — excluded`,
        index,
      });
      continue;
    }
    bound.push(raw);
  }

  // Authoritative projection via Lane 1's reducer. Each event is validated
  // through the contracts' own validateMissionEvent FIRST (clock domains,
  // schema, ids), then applied one by one — a hostile/invalid event is
  // audited individually and the VALID PREFIX is kept. Everything from the
  // first rejected event onward is NOT applied (sequence and version
  // dependencies are broken past that point).
  let projection: MissionProjection | null = null;
  let derivedFromEventCount = 0;
  const eventRows: HandoffEventRow[] = [];
  if (bound.length > 0) {
    const first = validateMissionEvent(bound[0]!);
    if (!first.ok) {
      audit.push({
        code: first.error.code,
        message: `event 0 rejected: ${first.error.message}`,
        index: 0,
      });
    } else {
      const init = initMissionProjection(first.value);
      if (!init.ok) {
        audit.push({
          code: init.error.code,
          message: `first event rejected: ${init.error.message}`,
          index: 0,
        });
      } else {
        let state = init.value;
        let applied = 1;
        const validatedRows: HandoffEventRow[] = [rowFromEvent(first.value)];
        for (let index = 1; index < bound.length; index += 1) {
          const checked = validateMissionEvent(bound[index]!);
          if (!checked.ok) {
            audit.push({
              code: checked.error.code,
              message: `event ${index} rejected: ${checked.error.message}`,
              index,
            });
            break;
          }
          const result = applyEvent(state, checked.value);
          if (!result.ok) {
            audit.push({
              code: result.error.code,
              message: `event ${index} rejected: ${result.error.message}`,
              index,
            });
            break;
          }
          state = result.state;
          applied = index + 1;
          validatedRows.push(rowFromEvent(checked.value));
        }
        projection = state;
        derivedFromEventCount = applied;
        eventRows.push(...validatedRows);
      }
    }
  }

  // ---- Stage derivation (only from a successfully rehydrated projection) ----
  const stages: HandoffStage[] = [];
  const task = projection?.tasks[ctx.taskId] ?? null;
  const verdictsForTask = projection
    ? Object.values(projection.verdicts).filter((verdict) => {
        const evidence = projection.evidence[verdict.evidenceId];
        return evidence?.taskId === ctx.taskId;
      })
    : [];

  if (projection && task) {
    // --- Independent verifier decision (canonical recorded verdicts only) ---
    // The LATEST recorded decision for the task is the operative one; earlier
    // verdicts remain in history and are surfaced in the detail line.
    const ordered = [...verdictsForTask].sort((a, b) => a.decidedAtMs - b.decidedAtMs);
    const latest = ordered[ordered.length - 1] ?? null;
    const earlierRejections = ordered.filter((v) => !v.accepted);
    if (latest?.accepted) {
      stages.push({
        id: "verifier-decision",
        title: "Independent verifier decision",
        state: "confirmed",
        detail: `Recorded verdict: ACCEPTED — ${latest.reasons.join("; ")} (verifier ${latest.verifierId}).${
          earlierRejections.length > 0
            ? ` Earlier recorded rejection(s): ${earlierRejections.map((v) => v.reasons.join("; ")).join(" | ")}.`
            : ""
        }`,
      });
    } else if (latest && !latest.accepted) {
      stages.push({
        id: "verifier-decision",
        title: "Independent verifier decision",
        state: "rejected",
        detail: `Recorded verdict: REJECTED — ${latest.reasons.join("; ")} (verifier ${latest.verifierId}). Recorded contract decision, not a measurement.`,
      });
    } else {
      stages.push({
        id: "verifier-decision",
        title: "Independent verifier decision",
        state: "awaiting-verifier",
        detail:
          "No source-bound verifier decision exists in the recorded events — awaiting independent verifier (#49/#14). Sonar or optical quality numbers alone are measurements, not a verdict.",
      });
    }

    // --- Constrained recovery proposal ---
    const proposal = task.recoveryProposal ?? null;
    stages.push({
      id: "recovery-proposal",
      title: "Recovery proposal (constrained operator match)",
      state: proposal ? "proposed" : "awaiting-proposals",
      detail: proposal
        ? `Recorded proposal ${proposal.offerId}: ${proposal.rationale}${
            task.rejectedAlternatives.length > 0
              ? `; ${task.rejectedAlternatives.length} rejected alternative(s)`
              : ""
          }.`
        : "No recovery proposal in the recorded events — awaiting constrained operator matching (#51).",
    });

    // --- Owner-authorized reassignment with confirmed chain receipt ---
    // Mirrors the reducer's confirmedChainRecord: only a receipt whose
    // LATEST status is confirmed/finalized (and whose kind is "reassignment")
    // shows as enacted. Every other receipt state renders its honest wait.
    const version = task.currentAssignmentVersion;
    const latestAssignment = task.assignments[version];
    const reassignSig = latestAssignment?.chainSignature ?? null;
    const confirmedReassign = reassignSig !== null ? confirmedReceipt(projection, reassignSig, "reassignment") : null;
    const unconfirmedReassign = reassignSig !== null ? unconfirmedStatus(projection, reassignSig, "reassignment") : null;
    if (version >= 2 && reassignSig !== null && confirmedReassign !== null) {
      stages.push({
        id: "reassignment-confirmation",
        title: "Owner-authorized reassignment",
        state: "confirmed",
        detail: `Assignment v${version} → ${latestAssignment?.operatorId ?? "?"} enacted by confirmed chain transaction ${reassignSig}.`,
        confirmation: {
          transactionSignature: reassignSig,
          cluster: confirmedReassign.cluster,
          slot: confirmedReassign.slot,
          chainTimeMs: confirmedReassign.confirmedAtMs,
          amountLamports: confirmedReassign.amountLamports,
        },
      });
    } else if (reassignSig !== null && unconfirmedReassign !== null && (unconfirmedReassign === "rejected" || unconfirmedReassign === "expired")) {
      stages.push({
        id: "reassignment-confirmation",
        title: "Owner-authorized reassignment",
        state: "rejected",
        detail: `Reassignment transaction ${reassignSig} ended "${unconfirmedReassign}" on-chain — no authority change; the original assignment still holds.`,
      });
    } else if (reassignSig !== null && unconfirmedReassign !== null) {
      stages.push({
        id: "reassignment-confirmation",
        title: "Owner-authorized reassignment",
        state: "submitted-awaiting-confirmation",
        detail: `Reassignment transaction ${reassignSig} exists on-chain with status "${unconfirmedReassign}" — the new operator holds the task only after the chain reports confirmed/finalized.`,
      });
    } else {
      stages.push({
        id: "reassignment-confirmation",
        title: "Owner-authorized reassignment",
        state: version >= 2 ? "awaiting-authority" : "awaiting-proposals",
        detail: "No confirmed reassignment in the recorded events — the original assignment still holds.",
      });
    }

    // --- Replacement operator observations: explicitly unavailable ---
    stages.push({
      id: "replacement-observations",
      title: "Replacement operator execution observations",
      state: "unavailable",
      detail:
        "Requires a separately recorded telemetry stream from the replacement operator's machine. No such source exists in this demo path — the same ROV's pre/post-fault paths are shown under Ghost Replay, never here.",
    });

    // --- Single-use payout: confirmed chain receipt or honest waiting ---
    // Canonical rule (reducer confirmedChainRecord): task.status "paid"
    // exists only through a payout event authorized by a receipt whose
    // LATEST status is confirmed/finalized. A submitted/processed receipt is
    // IN FLIGHT, never paid; task.status "verified" without an enacted
    // payout is payout-ELIGIBLE only — nothing is initiated, nothing has
    // moved, and no recipient is enacted. Recipient wallets are named only
    // when the receipt itself recorded one.
    const payoutSig = task.payoutSignature ?? null;
    const confirmedPayout = payoutSig !== null ? confirmedReceipt(projection, payoutSig, "payout") : null;
    const boundPayout = payoutReceiptForTask(projection, ctx.taskId, version);
    const boundSig = boundPayout?.signature ?? null;
    const boundUnconfirmed = boundSig !== null ? unconfirmedStatus(projection, boundSig, "payout") : null;
    const boundUnconfirmedSig = payoutSig !== null ? unconfirmedStatus(projection, payoutSig, "payout") : null;
    if (task.status === "paid" && payoutSig !== null && confirmedPayout !== null) {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "confirmed",
        detail: `Payout confirmed for assignment v${version}: ${confirmedPayout.amountLamports ?? "?"} lamports enacted by confirmed chain transaction ${payoutSig}${confirmedPayout.slot ? `, slot ${confirmedPayout.slot}` : ""}.`,
        confirmation: {
          transactionSignature: payoutSig,
          cluster: confirmedPayout.cluster,
          slot: confirmedPayout.slot,
          chainTimeMs: confirmedPayout.confirmedAtMs,
          amountLamports: confirmedPayout.amountLamports,
          ...(confirmedPayout.recipientWallet !== undefined
            ? { recipientWallet: confirmedPayout.recipientWallet }
            : {}),
        },
      });
    } else if (boundUnconfirmed !== null && (boundUnconfirmed === "rejected" || boundUnconfirmed === "expired")) {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "rejected",
        detail: `Payout transaction ${boundSig} ended "${boundUnconfirmed}" on-chain — no funds moved; the task is not paid.`,
      });
    } else if (boundUnconfirmed !== null) {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "submitted-awaiting-confirmation",
        detail: `Payout transaction ${boundSig} for assignment v${version} exists on-chain with latest status "${boundUnconfirmed}" — NOT treated as paid until the chain reports confirmed/finalized and the payout event is recorded.`,
      });
    } else if (task.status === "paid") {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "awaiting-authority",
        detail: `Task state "paid" is recorded, but its payout receipt's latest on-chain status is "${boundUnconfirmedSig ?? "absent"}" — not displayed as confirmed.`,
      });
    } else if (task.status === "verified") {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "awaiting-authority",
        detail:
          "Task verified by recorded verdict — payout ELIGIBLE. No recorded payout event has enacted payment for this task: the task is not paid, and no recipient is enacted in this projection.",
      });
    } else {
      stages.push({
        id: "payout-confirmation",
        title: "Single-use payout",
        state: "awaiting-authority",
        detail: "Awaiting verified evidence and an enacted chain payout — no payment state can exist before that.",
      });
    }
  } else if (projection) {
    // Projection exists but the bound task has not been assigned yet.
    for (const id of ["verifier-decision", "recovery-proposal", "reassignment-confirmation", "replacement-observations", "payout-confirmation"]) {
      stages.push({
        id,
        title: id,
        state: "awaiting-authority",
        detail: `Task "${ctx.taskId}" has no recorded events yet — awaiting the mission authority's task lifecycle events.`,
      });
    }
  } else {
    // No trusted projection: every authority stage renders its honest wait.
    for (const id of ["verifier-decision", "recovery-proposal", "reassignment-confirmation", "replacement-observations", "payout-confirmation"]) {
      stages.push({
        id,
        title: id,
        state: "awaiting-authority",
        detail: "No validated mission events ingested — awaiting an authoritative event source through this boundary.",
      });
    }
  }

  return {
    missionId: ctx.missionId,
    taskId: ctx.taskId,
    stages,
    eventRows,
    audit,
    derivedFromEventCount,
  };
}
