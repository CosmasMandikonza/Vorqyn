/**
 * Truthful transaction lifecycle (VQ-12 / #13; SOLANA_PROTOCOL §7).
 *
 * States: awaiting_signature → submitted → processed →
 * confirmed → finalized | rejected | expired | unknown.
 *
 * Invariants (tested):
 * - NOTHING is ever marked confirmed/finalized without an RPC status that
 *   actually says so; "unknown" is first-class, never coerced (issue #13:
 *   no Paid state from an optimistic toast).
 * - A wallet popup opening is NOT submitted; a submit timeout is unknown,
 *   not failed — reconcile() queries the chain BEFORE any retry decision.
 * - Terminal states freeze the history; every transition records its
 *   source ("wallet" | "rpc" | "client") and timestamp.
 */

export type TxState =
  | "awaiting_signature"
  | "submitted"
  | "processed"
  | "confirmed"
  | "finalized"
  | "rejected"
  | "expired"
  | "unknown";

export type TxKind = "funding" | "reassignment" | "payout" | "refund" | "registry";

export type StatusSource = "wallet" | "rpc" | "client";

export interface TxHistoryEntry {
  readonly state: TxState;
  readonly atMs: number;
  readonly source: StatusSource;
  readonly detail?: string;
}

export interface TxRecord {
  readonly id: string;
  readonly kind: TxKind;
  readonly missionId: string;
  readonly taskId?: string;
  readonly assignmentVersion?: number;
  readonly amountLamports?: number;
  state: TxState;
  signature?: string;
  readonly history: TxHistoryEntry[];
  submittedAtMs?: number;
  confirmedAtMs?: number;
  slot?: number;
}

/**
 * Allowed transitions — anything else is a client bug and throws. Real
 * Solana RPC may report `finalized` as the FIRST readable status (CTO
 * review P1-A), so every non-terminal pre-confirmation state may move
 * directly to finalized; `unknown` may also repeat (retry loops).
 */
const ALLOWED: Readonly<Record<TxState, readonly TxState[]>> = {
  awaiting_signature: ["submitted", "rejected", "expired"],
  submitted: ["processed", "confirmed", "finalized", "rejected", "expired", "unknown"],
  processed: ["confirmed", "finalized", "rejected", "expired", "unknown"],
  unknown: ["processed", "confirmed", "finalized", "rejected", "expired", "unknown"],
  confirmed: ["finalized", "unknown"],
  finalized: [],
  rejected: [],
  expired: [],
};

/** Monotonic confirmation knowledge: reconcile never moves backwards. */
const CONFIRMATION_RANK: Readonly<Record<TxState, number>> = {
  awaiting_signature: 0,
  submitted: 1,
  unknown: 1,
  processed: 2,
  confirmed: 3,
  finalized: 4,
  rejected: 4,
  expired: 4,
};

export function isTerminal(state: TxState): boolean {
  return ALLOWED[state].length === 0 || state === "finalized";
}

export function newTxRecord(input: Omit<TxRecord, "state" | "history">): TxRecord {
  const now = input.submittedAtMs ?? Date.now();
  return {
    ...input,
    state: "awaiting_signature",
    history: [{ state: "awaiting_signature", atMs: now, source: "wallet" }],
  };
}

export function transition(record: TxRecord, to: TxState, source: StatusSource, detail?: string): TxRecord {
  if (record.state === to) return record; // idempotent no-op
  if (!ALLOWED[record.state].includes(to))
    throw new Error(`illegal tx transition ${record.state} -> ${to} (record ${record.id})`);
  record.state = to;
  record.history.push({ state: to, atMs: Date.now(), source, detail });
  if (to === "submitted") record.submittedAtMs = record.submittedAtMs ?? Date.now();
  if (to === "confirmed" || to === "finalized") record.confirmedAtMs = record.confirmedAtMs ?? Date.now();
  return record;
}

/** Persistence seam: the UI decides WHERE records live (localStorage, etc). */
export interface TxRecordStore {
  load(): readonly TxRecord[];
  save(record: TxRecord): void;
}

export class InMemoryTxStore implements TxRecordStore {
  private readonly records = new Map<string, TxRecord>();
  load(): readonly TxRecord[] { return Array.from(this.records.values()); }
  save(record: TxRecord): void { this.records.set(record.id, record); }
}

/** Minimal surface of Solana RPC the reconciler needs (test-mockable). */
export interface SignatureStatusSource {
  getSignatureStatus(
    signature: string,
  ): Promise<{ confirmationStatus?: "processed" | "confirmed" | "finalized"; slot?: number; err: unknown } | null>;
}

function rpcToState(
  status: { confirmationStatus?: "processed" | "confirmed" | "finalized"; err: unknown } | null,
): TxState {
  if (status === null) return "unknown"; // RPC could not see it (yet) — never "failed"
  if (status.err !== null && status.err !== undefined) return "rejected";
  switch (status.confirmationStatus) {
    case "finalized":
      return "finalized";
    case "confirmed":
      return "confirmed";
    case "processed":
      return "processed";
    default:
      return "unknown";
  }
}

/**
 * Reconcile a record after reload/RPC-interruption: query the CHAIN first,
 * then (and only then) decide. `blockhashExpired` maps to expired only via
 * an explicit rejected/expired RPC signal; an unreachable RPC keeps the
 * record in unknown.
 */
export async function reconcile(record: TxRecord, rpc: SignatureStatusSource): Promise<TxRecord> {
  if (record.signature === undefined)
    throw new Error(`record ${record.id} has no signature to reconcile`);
  if (isTerminal(record.state)) return record;
  let status;
  try {
    status = await rpc.getSignatureStatus(record.signature);
  } catch {
    // An RPC error is ABSENCE of knowledge, never evidence of
    // non-finality: only records not yet past the submitted/unknown tier
    // may become unknown. Already-observed processed/confirmed knowledge
    // (and its slot) is preserved untouched (final review, PR #50).
    if (CONFIRMATION_RANK[record.state] > CONFIRMATION_RANK.unknown) return record;
    return transition(record, "unknown", "client", "rpc unreachable — retry later");
  }
  const next = rpcToState(status);
  // Monotonic guard (CTO review P1-A): a stale/delayed RPC response must
  // never regress or throw away already-observed confirmation knowledge.
  if (
    CONFIRMATION_RANK[next] < CONFIRMATION_RANK[record.state] ||
    (CONFIRMATION_RANK[next] === CONFIRMATION_RANK[record.state] && next !== record.state)
  ) {
    return record; // keep the stronger observation; do not adopt stale slots
  }
  if (status !== null && status.slot !== undefined && CONFIRMATION_RANK[next] >= CONFIRMATION_RANK[record.state])
    record.slot = status.slot;
  return transition(record, next, "rpc", `confirmationStatus=${status?.confirmationStatus ?? "unseen"}`);
}

/**
 * THE ms→s boundary conversion (single source of truth, mirroring the
 * verifier service's toChainAttestationExpirySeconds): attestations carry
 * unix MILLISECONDS; the Anchor program's attestation_expiry is unix
 * SECONDS and must be strictly future at execution.
 */
export function toChainAttestationExpirySeconds(expiresAtMs: number): number {
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0)
    throw new Error("expiresAtMs must be a positive safe integer (unix ms)");
  return Math.floor(expiresAtMs / 1000);
}
