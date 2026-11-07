/**
 * Typed entry point for the guest simulation journal bridge (issue #9
 * focused slice). Re-exports the source-aware telemetry bridge and the
 * bounded observation journal implemented in
 * `services/mission/simulation/**` so in-app consumers (and the future
 * mission orchestrator) have a single stable import surface.
 *
 * SERVER-SIDE ONLY in this app: never import from a client component.
 * This module synthesizes no MissionEvents and holds no authority over
 * mission lifecycle state.
 */

export * from "../../../../services/mission/simulation/telemetry-bridge";
export * from "../../../../services/mission/simulation/observation-journal";
