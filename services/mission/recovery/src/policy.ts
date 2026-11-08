/**
 * The deterministic policy gate (VQ-11 / #12) — the SAFETY LAYER that
 * never trusts the model's explanation. Every check is rule-based over
 * the ACTUAL offer/capability/budget/version facts, with machine-readable
 * reason codes. A proposal only leaves this module if every gate passes;
 * otherwise it is rejected (or the whole decision falls back to a fully
 * rule-based ranking — still gated, still owner-approval-only).
 */

import type { Lamports, TaskId } from "@vorqyn/contracts";
import type { OperatorOffer, RecoveryRequest } from "./input";

export type PolicyReasonCode =
  | "offer_not_found"
  | "task_mismatch"
  | "stale_assignment_version"
  | "capability_mismatch"
  | "offer_expired"
  | "offer_not_yet_valid"
  | "quote_over_budget"
  | "topup_over_remaining"
  | "same_operator"
  | "same_robot"
  | "quote_invalid";

export interface PolicyRejection {
  readonly offerId: string;
  readonly reasonCode: PolicyReasonCode;
  readonly reason: string;
}

export interface PolicyCheck {
  readonly offer: OperatorOffer;
  readonly ok: boolean;
  readonly rejection?: PolicyRejection;
}

/**
 * Validate ONE offer against the request facts. Pure and total.
 *
 * Money math is BIGINT end-to-end (CTO review P1-A: no lossy Number
 * coercion near 2^53). The available-funds rule MATCHES the on-chain
 * authorize_reassignment exactly:
 *   topUp = max(0n, newReward - currentReward)
 *   reject iff topUp > missionRemainingLamports
 * (a reward cut or unchanged reward needs no top-up and is always fine
 * on the funds axis; the task-budget ceiling is enforced separately).
 */
export function checkOffer(offer: OperatorOffer, request: RecoveryRequest): PolicyCheck {
  const reject = (reasonCode: PolicyReasonCode, reason: string): PolicyCheck => ({
    offer,
    ok: false,
    rejection: { offerId: offer.offerId, reasonCode, reason },
  });
  if (offer.offerId !== offer.offerId.trim() || offer.offerId.length === 0)
    return reject("offer_not_found", "offer id invalid");
  const quote = BigInt(offer.quoteLamports);
  if (quote <= 0n) return reject("quote_invalid", `quote ${offer.quoteLamports} is not positive`);
  if (typeof offer.quoteLamports === "number" && !Number.isSafeInteger(offer.quoteLamports))
    return reject("quote_invalid", `quote ${offer.quoteLamports} is not a safe integer (pass bigint)`);
  if (offer.expiresAtMs <= request.nowMs)
    return reject("offer_expired", `offer expired at ${offer.expiresAtMs}, now ${request.nowMs}`);
  if (offer.validFromMs > request.nowMs)
    return reject("offer_not_yet_valid", `offer not valid until ${offer.validFromMs}`);
  // P1-B: a GENUINE recovery replaces the failing operator AND robot.
  // There is no automatic retry exception — an intentional same-operator
  // retry would be a separately named policy decision, not this gate.
  if (offer.operatorId === request.currentOperatorId)
    return reject("same_operator", `offer ${offer.offerId} re-selects the CURRENT operator ${request.currentOperatorId}; genuine recovery requires a replacement`);
  if (offer.robotId === request.currentRobotId)
    return reject("same_robot", `offer ${offer.offerId} re-uses the CURRENT robot ${request.currentRobotId}; genuine recovery requires a replacement machine`);
  const missing = request.requiredCapabilities.filter((c) => !offer.capabilities.includes(c));
  if (missing.length > 0)
    return reject(
      "capability_mismatch",
      `offer ${offer.offerId} lacks required capabilities [${missing.join(",")}] (has [${offer.capabilities.join(",")}])`,
    );
  if (quote > BigInt(request.budgetLamports))
    return reject("quote_over_budget", `quote ${offer.quoteLamports} > task budget ${request.budgetLamports}`);
  const currentReward = BigInt(request.currentRewardLamports);
  const topUp = quote > currentReward ? quote - currentReward : 0n;
  if (topUp > BigInt(request.missionRemainingLamports))
    return reject(
      "topup_over_remaining",
      `topUp=${topUp} (quote ${quote} - current ${currentReward}) > mission unreserved ${request.missionRemainingLamports}`,
    );
  return { offer, ok: true };
}

export function findOffer(offers: readonly OperatorOffer[], offerId: string): OperatorOffer | undefined {
  return offers.find((o) => o.offerId === offerId);
}

/** The model's chosen offer MUST pass the full gate on real facts. */
export function gateModelChoice(
  choice: { chosenOfferId: string; taskId: string; expectedAssignmentVersion: number },
  request: RecoveryRequest,
): PolicyCheck {
  const offer = findOffer(request.offers, choice.chosenOfferId);
  if (offer === undefined)
    return {
      offer: {
        offerId: choice.chosenOfferId,
        operatorId: "?",
        robotId: "?",
        description: "",
        capabilities: [],
        quoteLamports: 0 as Lamports,
        payoutWallet: "",
        validFromMs: 0 as never,
        expiresAtMs: 0 as never,
      },
      ok: false,
      rejection: {
        offerId: choice.chosenOfferId,
        reasonCode: "offer_not_found",
        reason: `model chose "${choice.chosenOfferId}" which does not exist (hallucination or stale catalogue)`,
      },
    };
  if (choice.taskId !== (request.taskId as string))
    return { offer, ok: false, rejection: { offerId: offer.offerId, reasonCode: "task_mismatch", reason: `model targeted ${choice.taskId}, task is ${request.taskId}` } };
  if (choice.expectedAssignmentVersion !== request.currentAssignmentVersion)
    return {
      offer,
      ok: false,
      rejection: {
        offerId: offer.offerId,
        reasonCode: "stale_assignment_version",
        reason: `model proposed version ${choice.expectedAssignmentVersion}, current is ${request.currentAssignmentVersion} — mission state changed during reasoning`,
      },
    };
  return checkOffer(offer, request);
}

/**
 * Fully rule-based ranking (the transparent fallback and tie-breaker):
 * capability-compatible, valid, in-budget offers sorted by lowest quote,
 * then earliest expiry (deterministic total order).
 */
export function rankOffers(request: RecoveryRequest): { ranked: OperatorOffer[]; rejected: PolicyRejection[] } {
  const rejected: PolicyRejection[] = [];
  const passing: OperatorOffer[] = [];
  for (const offer of request.offers) {
    const check = checkOffer(offer, request);
    if (check.ok) passing.push(offer);
    else rejected.push(check.rejection!);
  }
  passing.sort((a, b) => {
    const qa = BigInt(a.quoteLamports);
    const qb = BigInt(b.quoteLamports);
    if (qa !== qb) return qa < qb ? -1 : 1;
    return a.expiresAtMs - b.expiresAtMs;
  });
  return { ranked: passing, rejected };
}

/** Evaluate ALL offers (for rejectedAlternatives in the proposal event). */
export function evaluateAllOffers(request: RecoveryRequest): { checks: PolicyCheck[]; best?: OperatorOffer } {
  const { ranked } = rankOffers(request);
  const checks = request.offers.map((o) => checkOffer(o, request));
  return { checks, best: ranked[0] };
}

export type { TaskId };
