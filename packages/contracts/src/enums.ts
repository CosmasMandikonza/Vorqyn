/**
 * VORQYN shared contracts — state enums (VQ-01 / issue #2).
 *
 * Typed sum states per docs/ARCHITECTURE.md §3. Values are lowercase
 * snake_case strings so they serialize stably to JSON and map 1:1 onto
 * Rust enum variants for the Anchor lane (#5) without renaming.
 */

/** How a robot's data was produced. Vocabulary matches the Lane-2 simulation
 * kernel (services/simulation), which labels its own output SYNTHETIC_SIM
 * and refuses to claim LIVE_SITL. REPLAY covers recorded truth (QUALITY_GATES
 * "Playback"). These categories are not interchangeable in the UI. */
export const SOURCE_KINDS = ["SYNTHETIC_SIM", "LIVE_SITL", "REPLAY"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const TASK_KINDS = ["air", "land", "sea"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const ROBOT_CLASSES = ["drone", "rover", "rov"] as const;
export type RobotClass = (typeof ROBOT_CLASSES)[number];

/**
 * Mission lifecycle states. `recovery_needed`, `verifying` and `completed`
 * are DERIVED from task states by the reducer (single source of truth);
 * the rest are recorded by explicit lifecycle events. Unknown is not a
 * mission state — unknown data is rejected at the event boundary.
 */
export const MISSION_STATES = [
  "draft",
  "funding",
  "ready",
  "running",
  "recovery_needed",
  "verifying",
  "completed",
  "closed",
  "failed",
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Explicitly recorded lifecycle (input to deriveMissionState). */
export const MISSION_LIFECYCLES = ["draft", "funding", "ready", "running", "closed", "failed"] as const;
export type MissionLifecycle = (typeof MISSION_LIFECYCLES)[number];

/** Task assignment/state machine per docs/ARCHITECTURE.md §3. */
export const TASK_STATUSES = [
  "unassigned",
  "assigned",
  "executing",
  "evidence_insufficient",
  "recovery_pending",
  "reassigned",
  "verified",
  "paid",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Chain transaction states per docs/SOLANA_PROTOCOL.md §7. `unknown` is a
 * first-class state (RPC timeout / blockhash expiry), never silently
 * coerced to success or failure. Rank defines the monotone progression a
 * given signature may follow; `unknown` may appear at any point.
 */
export const CHAIN_TX_STATUSES = [
  "unsigned",
  "awaiting_wallet",
  "submitted",
  "processed",
  "confirmed",
  "finalized",
  "expired",
  "rejected",
  "unknown",
] as const;
export type ChainTxStatus = (typeof CHAIN_TX_STATUSES)[number];

/** Terminal states of a chain transaction (no further transitions). */
export const CHAIN_TX_TERMINAL: readonly ChainTxStatus[] = ["finalized", "expired", "rejected"];

const CHAIN_TX_RANK: Record<ChainTxStatus, number> = {
  unsigned: 0,
  awaiting_wallet: 1,
  submitted: 2,
  processed: 3,
  confirmed: 4,
  finalized: 5,
  expired: 5,
  rejected: 5,
  unknown: -1,
};

/**
 * Monotonicity rule for one signature's status history. Allowed:
 * strictly increasing ranks, and `unknown` anywhere (it is an observation
 * gap, not a state). Once terminal (finalized/expired/rejected) the status
 * is frozen.
 */
export function chainTxTransitionAllowed(
  from: ChainTxStatus,
  to: ChainTxStatus,
): boolean {
  if (from === to) return false;
  // Terminal states freeze the history — even a later `unknown` observation
  // gap must not resurrect an expired/rejected/finalized transaction.
  if (CHAIN_TX_TERMINAL.includes(from)) return false;
  if (from === "unknown") return true;
  if (to === "unknown") return true;
  return CHAIN_TX_RANK[to] > CHAIN_TX_RANK[from];
}

/** What a chain transaction does, for program-side reconciliation. */
export const CHAIN_EVENT_KINDS = ["funding", "reassignment", "payout", "refund"] as const;
export type ChainEventKind = (typeof CHAIN_EVENT_KINDS)[number];

/** Truthful cluster labels (SOLANA_PROTOCOL.md §8: no fake explorer URLs). */
export const CLUSTERS = ["localnet", "devnet", "mainnet-beta"] as const;
export type Cluster = (typeof CLUSTERS)[number];

/** Who authorized an on-chain reassignment (SOLANA_PROTOCOL.md §3). */
export const AUTHORIZATION_ACTORS = ["owner", "delegate"] as const;
export type AuthorizationActor = (typeof AUTHORIZATION_ACTORS)[number];
