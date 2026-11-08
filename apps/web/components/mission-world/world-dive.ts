/**
 * World Dive — choreographed camera journey (Issue #15, section A).
 *
 * The dive is a timed playthrough of EXISTING camera stations derived from
 * world.json (via poseForMode) — no new camera mathematics, no invented
 * geometry. Each leg reuses a station pose so clipping bounds, near/far and
 * scale stay exactly as calibrated. Any operator input cancels; reduced
 * motion skips the journey entirely (handled by the caller).
 */
import type { ViewMode } from "./camera-presets";

export interface DiveLeg {
  station: Exclude<ViewMode, "RESET">;
  durationMs: number;
  label: string;
}

export const DIVE_LEG_MS = 2400;

/** Ordered legs: aerial overview -> rover access route -> below the waterline -> obstruction close-up. */
export function buildDiveLegs(): DiveLeg[] {
  return [
    { station: "AIR", durationMs: DIVE_LEG_MS, label: "Aerial survey overview" },
    { station: "LAND", durationMs: DIVE_LEG_MS, label: "Rover access route" },
    { station: "UNDERWATER", durationMs: DIVE_LEG_MS, label: "Below the waterline — ROV inspection" },
    { station: "INSPECT", durationMs: DIVE_LEG_MS, label: "Obstruction close inspection" },
  ];
}

/** Next leg index, or null when the dive has finished. */
export function nextLegIndex(index: number): number | null {
  const legs = buildDiveLegs();
  return index + 1 < legs.length ? index + 1 : null;
}
