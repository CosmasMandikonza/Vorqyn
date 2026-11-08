/**
 * @vorqyn/chain-client — typed Solana client for the VORQYN mission escrow
 * program (VQ-12 / #13): PDA derivation, borsh account decoding, typed
 * instruction builders and a truthful transaction-lifecycle state machine.
 *
 * Trust posture: nothing here fabricates confirmation. Explorer links name
 * their cluster; unknown is first-class; reconciliation queries the chain
 * before any retry. The program id is the shared placeholder until the
 * devnet release gate (documented in config.ts).
 */
export * from "./config";
export * from "./pdas";
export * from "./codec";
export * from "./instructions";
export * from "./lifecycle";
