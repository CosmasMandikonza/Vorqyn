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
/** On-chain u64 ceiling for lamport values. */
export const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Validate a lamport value BEFORE any BigInt conversion (CTO 6715808338):
 * non-finite, fractional, unsafe-integer numbers, negatives and values
 * beyond u64 are rejected as data — BigInt() never sees them, so this
 * policy API is TOTAL: it returns rejections, it never throws.
 */
export function parseLamports(field: string, value: Lamports | bigint): { ok: true; value: bigint } | { ok: false; reason: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      return { ok: false, reason: `${field} ${value} is not finite` };
    if (!Number.isInteger(value))
      return { ok: false, reason: `${field} ${value} must be an integer` };
    if (!Number.isSafeInteger(value))
      return { ok: false, reason: `unsafe ${field} ${value} — not a safe integer; pass a bigint` };
  }
  const n = BigInt(value);
  if (n < 0n) return { ok: false, reason: `${field} ${value} must be non-negative` };
  if (n > U64_MAX) return { ok: false, reason: `${field} ${value} exceeds the u64 ceiling` };
  return { ok: true, value: n };
}

export function checkOffer(offer: OperatorOffer, request: RecoveryRequest): PolicyCheck {
  const reject = (reasonCode: PolicyReasonCode, reason: string): PolicyCheck => ({
    offer,
    ok: false,
    rejection: { offerId: offer.offerId, reasonCode, reason },
  });
  if (offer.offerId !== offer.offerId.trim() || offer.offerId.length === 0)
    return reject("offer_not_found", "offer id invalid");
  // Validate BEFORE converting (P1-D): every malformed shape below is
  // REJECTED as data; BigInt() never receives a non-integer, and no
  // malformed catalogue record can throw or abort a ranking batch.
  const quote = parseLamports("quote", offer.quoteLamports);
  if (!quote.ok) return reject("quote_invalid", quote.reason);
  if (offer.expiresAtMs <= request.nowMs)
    return reject("offer_expired", `offer expired at ${offer.expiresAtMs}, now ${request.nowMs}`);
  if (offer.validFromMs > request.nowMs)
    return reject("offer_not_yet_valid", `offer not valid until ${offer.validFromMs}`);
  // Request-side monetary fields are validated at this same untrusted
  // boundary and fail CLOSED per offer (authority data should never be
  // malformed; if it is, no offer may pass on top of it).
  const budget = parseLamports("request.budgetLamports", request.budgetLamports);
  if (!budget.ok) return reject("quote_invalid", budget.reason);
  const currentReward = parseLamports("request.currentRewardLamports", request.currentRewardLamports);
  if (!currentReward.ok) return reject("quote_invalid", currentReward.reason);
  const remaining = parseLamports("request.missionRemainingLamports", request.missionRemainingLamports);
  if (!remaining.ok) return reject("quote_invalid", remaining.reason);
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
  if (quote.value > budget.value)
    return reject("quote_over_budget", `quote ${quote.value} > task budget ${budget.value}`);
  // On-chain reservation semantics (authorize_reassignment):
  const topUp = quote.value > currentReward.value ? quote.value - currentReward.value : 0n;
  if (topUp > remaining.value)
    return reject(
      "topup_over_remaining",
      `topUp=${topUp} (quote ${quote.value} - current ${currentReward.value}) > mission unreserved ${remaining.value}`,
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
    const qa = parseLamports("quote", a.quoteLamports);
    const qb = parseLamports("quote", b.quoteLamports);
    if (!qa.ok || !qb.ok) return 0; // unreachable: passing offers validated above
    if (qa.value !== qb.value) return qa.value < qb.value ? -1 : 1;
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
