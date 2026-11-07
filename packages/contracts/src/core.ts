/**
 * VORQYN shared contracts — core primitives (VQ-01 / issue #2).
 *
 * Branding strategy: entity IDs are opaque strings at the type level so
 * they cannot be silently interchanged, with runtime guards that enforce
 * the exact lexical rules promised to the chain lane in CHAIN_SEAM.md.
 * Money is integer lamports only (never floating SOL); timestamps are
 * integer epoch milliseconds or integer simulator milliseconds so the
 * same values survive a JS -> JSON -> Rust round trip unchanged.
 */

/**
 * Version of the contracts schema emitted by this package. Bump on any
 * breaking change to an event kind, payload shape or enum value; the
 * reducer rejects events whose schemaVersion is not exactly this value
 * (no speculative forward-compatibility — a mismatch is a hard error so
 * mixed-version services fail loudly instead of mis-serializing money).
 */
export const CONTRACTS_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Result type used across the package
// ---------------------------------------------------------------------------

export type ContractErrorCode =
  | "validation_error"
  | "unknown_event_kind"
  | "unsupported_schema_version"
  | "duplicate_event"
  | "duplicate_sequence"
  | "duplicate_idempotency_key"
  | "illegal_transition"
  | "unknown_entity"
  | "cross_mission_reference"
  | "stale_assignment_version"
  | "stale_mission_version"
  | "chain_not_confirmed"
  | "clock_domain_violation"
  | "budget_exceeded"
  | "already_terminal";

export interface ContractError {
  code: ContractErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ContractError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (
  code: ContractErrorCode,
  message: string,
): Result<never> => ({ ok: false, error: { code, message } });

// ---------------------------------------------------------------------------
// Branded IDs
// ---------------------------------------------------------------------------

/**
 * Opaque entity ID. Lexical rule (see CHAIN_SEAM.md §2): lowercase ASCII
 * letters, digits and hyphens, 3..32 chars, must start with a letter or
 * digit. The chain lane relies on UTF-8(ascii) == the byte seed, so this
 * regex is contractual, not cosmetic.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

export type OrganizationId = string & { readonly __brand: "OrganizationId" };
export type MissionId = string & { readonly __brand: "MissionId" };
export type TaskId = string & { readonly __brand: "TaskId" };
export type OperatorId = string & { readonly __brand: "OperatorId" };
export type RobotId = string & { readonly __brand: "RobotId" };
export type OfferId = string & { readonly __brand: "OfferId" };
export type EvidenceId = string & { readonly __brand: "EvidenceId" };
export type EventId = string & { readonly __brand: "EventId" };
/** Idempotency key of the command that produced an event. */
export type CommandId = string & { readonly __brand: "CommandId" };

export type EntityId =
  | OrganizationId
  | MissionId
  | TaskId
  | OperatorId
  | RobotId
  | OfferId
  | EvidenceId
  | EventId
  | CommandId;

const asId = <B extends EntityId>(raw: string): Result<B> =>
  typeof raw === "string" && ID_PATTERN.test(raw)
    ? ok(raw as B)
    : err(
        "validation_error",
        `id "${String(raw)}" must match ${ID_PATTERN} (3-32 lowercase ASCII letters/digits/hyphens)`,
      );

export const asOrganizationId = (raw: string): Result<OrganizationId> =>
  asId<OrganizationId>(raw);
export const asMissionId = (raw: string): Result<MissionId> =>
  asId<MissionId>(raw);
export const asOperatorId = (raw: string): Result<OperatorId> =>
  asId<OperatorId>(raw);
export const asTaskId = (raw: string): Result<TaskId> => asId<TaskId>(raw);
export const asRobotId = (raw: string): Result<RobotId> => asId<RobotId>(raw);
export const asOfferId = (raw: string): Result<OfferId> => asId<OfferId>(raw);
export const asEvidenceId = (raw: string): Result<EvidenceId> =>
  asId<EvidenceId>(raw);
export const asEventId = (raw: string): Result<EventId> => asId<EventId>(raw);
export const asCommandId = (raw: string): Result<CommandId> =>
  asId<CommandId>(raw);

/**
 * Operator identity stays opaque (lowercase ID). Per CHAIN_SEAM.md §3 the
 * mapping to money is `OperatorRegistration { operatorId, payoutWallet }`:
 * the on-chain authority is the payout wallet key, never the display ID.
 * Lexical base58 check here; full ed25519 validation belongs to the chain
 * client (VQ-12).
 */
export type SolanaPublicKey = string & { readonly __brand: "SolanaPublicKey" };
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const asSolanaPublicKey = (raw: string): Result<SolanaPublicKey> =>
  typeof raw === "string" && BASE58_PATTERN.test(raw)
    ? ok(raw as SolanaPublicKey)
    : err("validation_error", `"${String(raw)}" is not a base58 public key`);

/** Transaction signature: base58, typically 87-88 chars. */
export type TransactionSignature = string & { readonly __brand: "TransactionSignature" };
const BASE58_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,96}$/;

export const asTransactionSignature = (raw: string): Result<TransactionSignature> =>
  typeof raw === "string" && BASE58_SIGNATURE_PATTERN.test(raw)
    ? ok(raw as TransactionSignature)
    : err("validation_error", `"${String(raw)}" is not a base58 transaction signature`);

// ---------------------------------------------------------------------------
// Lamports — integer money only
// ---------------------------------------------------------------------------

export type Lamports = number & { readonly __brand: "Lamports" };

/** JS safe-integer ceiling; chain lane treats anything larger as invalid too. */
export const MAX_SAFE_LAMPORTS = Number.MAX_SAFE_INTEGER;

export const asLamports = (raw: number): Result<Lamports> =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? ok(raw as Lamports)
    : err(
        "validation_error",
        `lamports must be a non-negative safe integer, got ${String(raw)}`,
      );

/** Checked addition; rejects overflow beyond the JS safe-integer ceiling. */
export const addLamports = (a: Lamports, b: Lamports): Result<Lamports> => {
  const sum = a + b;
  return Number.isSafeInteger(sum) ? ok(sum as Lamports) : err("budget_exceeded", "lamport addition overflows safe integer range");
};

/** Checked subtraction; rejects negative balances (no silent debt). */
export const subLamports = (a: Lamports, b: Lamports): Result<Lamports> =>
  b <= a ? ok((a - b) as Lamports) : err("budget_exceeded", `lamport subtraction would go negative: ${a} - ${b}`);

// ---------------------------------------------------------------------------
// Clocks — three independent domains (ARCHITECTURE.md §4)
// ---------------------------------------------------------------------------

/** Wall-clock epoch time in integer milliseconds (service receipt / chain). */
export type EpochMs = number & { readonly __brand: "EpochMs" };

/** Simulator step time in integer milliseconds since scenario start. */
export type SimulatorTimeMs = number & { readonly __brand: "SimulatorTimeMs" };

export const asEpochMs = (raw: number): Result<EpochMs> =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? ok(raw as EpochMs)
    : err("validation_error", `epoch milliseconds must be a non-negative safe integer, got ${String(raw)}`);

export const asSimulatorTimeMs = (raw: number): Result<SimulatorTimeMs> =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? ok(raw as SimulatorTimeMs)
    : err("validation_error", `simulator milliseconds must be a non-negative safe integer, got ${String(raw)}`);

// ---------------------------------------------------------------------------
// Untrusted-input helpers and canonical serialization
// ---------------------------------------------------------------------------

/** Narrow unknown JSON to a plain object without throwing. */
export const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * Deterministic canonical JSON: object keys sorted recursively, arrays kept
 * in order. Two structurally equal values always produce the same string,
 * which lets the reducer detect replayed events whose CONTENT was tampered
 * with (same eventId/sequence, different payload).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value) ?? "null";
}
