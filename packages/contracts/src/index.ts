/**
 * @vorqyn/contracts — shared mission/task/telemetry contracts (VQ-01, #2).
 *
 * Public API. This package is the single typed source of truth for mission
 * state; every consumer (web UI, mission service, verifier, chain client)
 * derives its views from MissionEvent lists applied through the pure
 * reducer — never from its own animation- or UI-local state.
 *
 * Schema ownership: any change to an event kind, payload field, enum value
 * or ID rule bumps CONTRACTS_SCHEMA_VERSION and requires a reviewed PR that
 * notifies both lanes (docs/ARCHITECTURE.md §9). Blockchain-specific shapes
 * (ChainEventRecord, chain payloads) are a DRAFT cross-lane proposal — see
 * CHAIN_SEAM.md; do not treat them as frozen until #5 agrees.
 */

export * from "./core";
export * from "./enums";
export * from "./entities";
export * from "./telemetry";
export * from "./events";
export * from "./reducer";
export * from "./fixtures";
