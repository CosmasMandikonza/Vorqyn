/**
 * Recovery orchestrator (VQ-11 / #12): model → strict schema →
 * deterministic gate → OWNER-APPROVED proposal. Nothing here signs,
 * holds keys, or touches a wallet: the output is a typed proposal plus a
 * prepared-but-unsigned chain intent. The mission authority (owner)
 * approves explicitly; only then may Lane 2 / the chain client build the
 * reassignment transaction (whose on-chain CAS independently rejects any
 * stale version — belt and suspenders with our pre-chain check).
 */

import { err, ok, type Result } from "@vorqyn/contracts";
import { buildPromptInput, type OperatorOffer, type RecoveryRequest } from "./input";
import type { ModelClient } from "./model";
import { evaluateAllOffers, gateModelChoice, type PolicyRejection } from "./policy";

export interface DecisionTrace {
  readonly modelId: string;
  readonly modelLatencyMs: number;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
  readonly policyChecks: number;
  readonly decidedAtMs: number;
}

export interface RecoveryProposalOutcome {
  readonly status: "proposed" | "fallback_proposed" | "no_safe_proposal";
  readonly taskId: string;
  readonly expectedAssignmentVersion: number;
  readonly offer?: OperatorOffer;
  readonly rationale: string;
  readonly checkedCosts: readonly string[];
  readonly limitations: readonly string[];
  readonly rejectedAlternatives: readonly PolicyRejection[];
  readonly trace: DecisionTrace;
}

/** Typed chain intent — data ONLY; no keys, no signature, no submission. */
export interface OwnerApprovedIntent {
  readonly taskId: string;
  readonly expectedAssignmentVersion: number;
  readonly newOperatorId: string;
  readonly newRobotId: string;
  readonly offerId: string;
  readonly quoteLamports: number;
  readonly payoutWallet: string;
}

/**
 * OWNER-APPROVAL METADATA — NOT wallet authentication (CTO review).
 * `approvedBy: "owner"` is caller-supplied data recording that an owner
 * approval REQUEST was accepted upstream. What leaves this module is an
 * UNSIGNED chain intent pending AUTHENTICATED owner-wallet approval: the
 * real signature happens in the wallet/chain-client layer (#13), where
 * signer identity is actually verified. Nothing here proves ownership.
 */
export interface OwnerApproval {
  readonly approvedBy: "owner";
  readonly approvalId: string;
  readonly approvedAtMs: number;
}

export interface RecoveryHistoryEntry {
  readonly atMs: number;
  readonly stage: "model_call" | "model_result" | "policy_gate" | "fallback" | "decision" | "owner_approval";
  readonly detail: string;
}

export interface AttemptStore {
  get(key: string): number;
  set(key: string, value: number): void;
}

/**
 * In-memory attempt ledger. NOTE (CTO review): duplicate suppression only
 * works when callers INJECT ONE SHARED STORE per mission session; a fresh
 * default store per call suppresses nothing across calls/processes.
 * Cross-process idempotency is NOT provided here — the on-chain CAS
 * remains the authoritative stale-version guard (#14 scope).
 */
export class InMemoryAttemptStore implements AttemptStore {
  private readonly counts = new Map<string, number>();
  get(key: string): number { return this.counts.get(key) ?? 0; }
  set(key: string, value: number): void { this.counts.set(key, value); }
}

export interface RecoveryOptions {
  readonly model: ModelClient;
  readonly timeoutMs?: number;
  /** Upper bound on model attempts (duplicate reassignment defence). */
  readonly maxAttempts?: number;
  /** Attempt ledger — inject per mission session; two calls sharing a
   * store are duplicate-suppressed per task+version. */
  readonly attemptStore?: AttemptStore;
}

export async function proposeRecovery(
  request: RecoveryRequest,
  options: RecoveryOptions,
  history: RecoveryHistoryEntry[] = [],
): Promise<Result<RecoveryProposalOutcome>> {
  const note = (stage: RecoveryHistoryEntry["stage"], detail: string) =>
    history.push({ atMs: request.nowMs, stage, detail });

  const attemptKey = `${request.taskId}#v${request.currentAssignmentVersion}`;
  const store = options.attemptStore ?? new InMemoryAttemptStore();
  const attempts = store.get(attemptKey);
  const maxAttempts = options.maxAttempts ?? 1;
  if (attempts >= maxAttempts) {
    note("decision", `duplicate proposal suppressed for ${attemptKey} (${attempts} prior attempts)`);
    return err("duplicate_idempotency_key", `a proposal for ${attemptKey} already exists — owner must approve or dismiss it before another model call`);
  }
  store.set(attemptKey, attempts + 1);
  note("model_call", options.model.modelId);

  const started = Date.now();
  const modelOutcome = await Promise.race([
    options.model.propose(buildPromptInput(request)),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("model_timeout")), options.timeoutMs ?? 8_000),
    ),
  ]).catch((e: Error) => err("validation_error", `model unusable: ${String(e.message)}`));
  const latency = Date.now() - started;

  const all = evaluateAllOffers(request);
  const rejectedAlternatives = all.checks.filter((c) => !c.ok).map((c) => c.rejection!);

  if (!modelOutcome.ok) {
    // SAFE FALLBACK: transparent rule-based ranking, still fully gated.
    note("fallback", modelOutcome.error.message);
    if (all.best !== undefined) {
      const best = all.best;
      note("decision", `fallback selected ${best.offerId}`);
      return ok({
        status: "fallback_proposed",
        taskId: request.taskId,
        expectedAssignmentVersion: request.currentAssignmentVersion,
        offer: best,
        rationale: `Rule-based fallback after model failure (${modelOutcome.error.message}). Selected the cheapest capability-compatible, unexpired, in-budget offer based on the measured evidence failure [${request.evidenceFailureReasons.join("; ")}].`,
        checkedCosts: [
          `capabilities⊇[${request.requiredCapabilities.join(",")}]`,
          `quote ${best.quoteLamports} ≤ budget ${request.budgetLamports}`,
          `expiry ${best.expiresAtMs} > now ${request.nowMs}`,
        ],
        limitations: ["model unavailable — deterministic fallback", "owner approval still required"],
        rejectedAlternatives,
        trace: {
          modelId: options.model.modelId,
          modelLatencyMs: latency,
          fallbackUsed: true,
          fallbackReason: modelOutcome.error.message,
          policyChecks: all.checks.length,
          decidedAtMs: request.nowMs,
        },
      });
    }
    note("decision", "no safe proposal (fallback found none either)");
    return ok({
      status: "no_safe_proposal",
      taskId: request.taskId,
      expectedAssignmentVersion: request.currentAssignmentVersion,
      rationale: `No capability-compatible, unexpired, in-budget offer exists. Model failure: ${modelOutcome.error.message}.`,
      checkedCosts: [],
      limitations: ["no viable operator offer"],
      rejectedAlternatives,
      trace: {
        modelId: options.model.modelId,
        modelLatencyMs: latency,
        fallbackUsed: true,
        fallbackReason: modelOutcome.error.message,
        policyChecks: all.checks.length,
        decidedAtMs: request.nowMs,
      },
    });
  }

  note("model_result", `chose ${modelOutcome.value.chosenOfferId}`);
  const gate = gateModelChoice(modelOutcome.value, request);
  note("policy_gate", `${gate.ok ? "PASSED" : "REJECTED"} for ${modelOutcome.value.chosenOfferId}${gate.rejection !== undefined ? ` (${gate.rejection.reasonCode})` : ""}`);

  if (!gate.ok) {
    // The model's pick failed the gate: fall back to the rule-based best
    // rather than propagating an unsafe choice. checkOffer is the same
    // deterministic function the gate used, so `best` here passed on
    // CURRENT facts — including when the model's only defect was a stale
    // version/task CLAIM (the offer itself remains valid; the proposal
    // binds to the request's current version below).
    if (all.best !== undefined) {
      return ok({
        status: "fallback_proposed",
        taskId: request.taskId,
        expectedAssignmentVersion: request.currentAssignmentVersion,
        offer: all.best,
        rationale: `Model choice ${modelOutcome.value.chosenOfferId} was rejected by the deterministic gate (${gate.rejection!.reasonCode}: ${gate.rejection!.reason}). Rule-based fallback selected ${all.best.offerId}.`,
        checkedCosts: [`gate rejected model choice: ${gate.rejection!.reasonCode}`],
        limitations: ["model choice overridden by policy"],
        rejectedAlternatives: [...rejectedAlternatives, gate.rejection!],
        trace: {
          modelId: options.model.modelId,
          modelLatencyMs: latency,
          fallbackUsed: true,
          fallbackReason: `gate_rejected:${gate.rejection!.reasonCode}`,
          policyChecks: all.checks.length,
          decidedAtMs: request.nowMs,
        },
      });
    }
    return ok({
      status: "no_safe_proposal",
      taskId: request.taskId,
      expectedAssignmentVersion: request.currentAssignmentVersion,
      rationale: `Model choice rejected (${gate.rejection!.reasonCode}) and no viable alternative exists.`,
      checkedCosts: [`gate rejected: ${gate.rejection!.reasonCode}`],
      limitations: ["no viable operator offer"],
      rejectedAlternatives: [...rejectedAlternatives, gate.rejection!],
      trace: {
        modelId: options.model.modelId,
        modelLatencyMs: latency,
        fallbackUsed: true,
        fallbackReason: `gate_rejected:${gate.rejection!.reasonCode}`,
        policyChecks: all.checks.length,
        decidedAtMs: request.nowMs,
      },
    });
  }

  const offer = gate.offer;
  return ok({
    status: "proposed",
    taskId: request.taskId,
    expectedAssignmentVersion: request.currentAssignmentVersion,
    offer,
    rationale: modelOutcome.value.explanation,
    checkedCosts: [
      `capabilities⊇[${request.requiredCapabilities.join(",")}]`,
      `quote ${offer.quoteLamports} ≤ budget ${request.budgetLamports}`,
      `expiry ${offer.expiresAtMs} > now ${request.nowMs}`,
      `version ${modelOutcome.value.expectedAssignmentVersion} == current ${request.currentAssignmentVersion}`,
    ],
    limitations: ["owner approval required before any chain action"],
    rejectedAlternatives,
    trace: {
      modelId: options.model.modelId,
      modelLatencyMs: latency,
      fallbackUsed: false,
      policyChecks: all.checks.length,
      decidedAtMs: request.nowMs,
    },
  });
}

/**
 * The ONLY bridge toward a chain action: owner-approval METADATA turns a
 * proposal into a typed UNSIGNED intent pending authenticated owner-wallet
 * approval. No signature, no transaction, no wallet — the on-chain CAS
 * remains the final authority.
 */
export function authorizeProposal(
  outcome: RecoveryProposalOutcome,
  request: RecoveryRequest,
  approval: OwnerApproval,
  history: RecoveryHistoryEntry[] = [],
): Result<OwnerApprovedIntent> {
  if (outcome.status === "no_safe_proposal" || outcome.offer === undefined)
    return err("unknown_entity", "nothing to authorize — no safe proposal exists");
  if (approval.approvedBy !== "owner")
    return err("illegal_transition", "P0 path requires explicit owner approval");
  if (outcome.expectedAssignmentVersion !== request.currentAssignmentVersion) {
    history.push({ atMs: request.nowMs, stage: "owner_approval", detail: `stale version ${outcome.expectedAssignmentVersion} != ${request.currentAssignmentVersion} — intent refused` });
    return err("stale_assignment_version", `proposal version ${outcome.expectedAssignmentVersion} no longer current (${request.currentAssignmentVersion})`);
  }
  const gate = gateModelChoice(
    { chosenOfferId: outcome.offer.offerId, taskId: outcome.taskId, expectedAssignmentVersion: outcome.expectedAssignmentVersion },
    request,
  );
  if (!gate.ok) return err("budget_exceeded", gate.rejection!.reason);
  history.push({ atMs: request.nowMs, stage: "owner_approval", detail: `${approval.approvalId} approved offer ${outcome.offer.offerId}` });
  return ok({
    taskId: outcome.taskId,
    expectedAssignmentVersion: outcome.expectedAssignmentVersion,
    newOperatorId: outcome.offer.operatorId,
    newRobotId: outcome.offer.robotId,
    offerId: outcome.offer.offerId,
    quoteLamports: outcome.offer.quoteLamports,
    payoutWallet: outcome.offer.payoutWallet,
  });
}
