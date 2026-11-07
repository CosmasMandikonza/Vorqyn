/**
 * Named camera poses derived from world.json camera_targets.
 *
 * All poses go through the single ENU conversion in enu.ts. Distances stay
 * inside the declared world.json ranges so the camera cannot clip into the
 * pier decks or crane geometry on reset, and near/far come from the world
 * file rather than ad-hoc numbers.
 */
import { addVec, cameraOffset, enuToScene, type SceneVec3 } from "./enu";
import { anchorById, type PortWorld } from "./world-data";

export const VIEW_MODES = ["RESET", "AIR", "LAND", "UNDERWATER", "INSPECT"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Canonical overview vantage direction (south-west, above the basin). */
const OVERVIEW_AZIMUTH_DEG = 215;
const OVERVIEW_ELEVATION_DEG = 38;

export interface InspectTarget {
  anchorId: string;
  label: string;
  near_m: number;
  far_m: number;
  distance_m: number;
  distance_range_m: [number, number];
}

export interface CameraPose {
  position: SceneVec3;
  target: SceneVec3;
  near_m: number;
  far_m: number;
  /** Orbit zoom bounds, derived from the declared distance ranges. */
  min_distance_m: number;
  max_distance_m: number;
  /** The pose itself sits below the waterline (UNDERWATER / submerged INSPECT). */
  underwater: boolean;
  /** Human-readable derivation, surfaced in the inspector. */
  derivation: string;
}

const mid = ([a, b]: [number, number]) => (a + b) / 2;

export function inspectTargets(world: PortWorld): InspectTarget[] {
  const def = world.camera_targets.INSPECT?.targets ?? [];
  return def.flatMap((t) => {
    const anchor = anchorById(world, t.anchor);
    if (!anchor) return [];
    return [
      {
        anchorId: anchor.id,
        label: anchor.label,
        near_m: t.near_m,
        far_m: t.far_m,
        distance_m: mid(t.distance_range_m),
        distance_range_m: t.distance_range_m,
      },
    ];
  });
}

function azElFor(mode: ViewMode, world: PortWorld, inspectIndex: number): {
  azimuth: number;
  elevation: number;
  distance: number;
  target: SceneVec3;
  near: number;
  far: number;
  derivation: string;
} {
  const ct = world.camera_targets;
  if (mode === "RESET" && ct.RESET) {
    const r = ct.RESET;
    return {
      azimuth: r.azimuth_deg ?? OVERVIEW_AZIMUTH_DEG,
      elevation: r.elevation_deg ?? OVERVIEW_ELEVATION_DEG,
      distance: r.distance_m ?? 330,
      target: enuToScene(r.target_enu_m ?? [0, 20, 10]),
      near: r.near_m ?? 0.5,
      far: r.far_m ?? 1500,
      derivation: "world.json RESET (target, azimuth, elevation, distance)",
    };
  }
  const base = ct[mode];
  if (!base) throw new Error(`world.json has no camera target for ${mode}`);
  const distance = mid(base.distance_range_m ?? [50, 100]);
  const near = base.near_m ?? 0.5;
  const far = base.far_m ?? 1500;
  const targetEnu = base.target_enu_m ?? [0, 10, 15] as [number, number, number];

  if (mode === "AIR") {
    // Aim so the camera height lands mid-way in the declared height range.
    const heightMid = mid(base.height_range_m ?? [90, 240]);
    const elevation = (Math.asin(Math.min(0.95, heightMid / distance)) * 180) / Math.PI;
    return {
      azimuth: OVERVIEW_AZIMUTH_DEG,
      elevation,
      distance,
      target: enuToScene(targetEnu),
      near,
      far,
      derivation: "world.json AIR (mid distance/height ranges)",
    };
  }
  if (mode === "LAND") {
    const heightMid = mid(base.height_range_m ?? [18, 70]);
    const elevation = (Math.asin(Math.min(0.95, heightMid / distance)) * 180) / Math.PI;
    return {
      azimuth: 205,
      elevation,
      distance,
      target: enuToScene(targetEnu),
      near,
      far,
      derivation: "world.json LAND (mid distance/height ranges)",
    };
  }
  if (mode === "UNDERWATER") {
    return {
      azimuth: 340,
      elevation: 8,
      distance,
      target: enuToScene(targetEnu),
      near,
      far,
      derivation: "world.json UNDERWATER (mid distance range)",
    };
  }
  // INSPECT: follow the selected inspect target's anchor.
  const targets = inspectTargets(world);
  const t = targets[Math.min(inspectIndex, Math.max(0, targets.length - 1))];
  if (!t) throw new Error("world.json has no INSPECT targets");
  const anchor = anchorById(world, t.anchorId);
  if (!anchor) throw new Error(`INSPECT anchor ${t.anchorId} missing`);
  const submerged = anchor.position_enu_m[2] < 0;
  return {
    azimuth: submerged ? 20 : 150,
    elevation: submerged ? 6 : 18,
    distance: t.distance_m,
    target: enuToScene(anchor.position_enu_m),
    near: t.near_m,
    far: t.far_m,
    derivation: `world.json INSPECT -> anchor ${t.anchorId}`,
  };
}

export function poseForMode(
  mode: ViewMode,
  world: PortWorld,
  inspectIndex = 0,
): CameraPose {
  const { azimuth, elevation, distance, target, near, far, derivation } = azElFor(
    mode,
    world,
    inspectIndex,
  );
  const offset = cameraOffset(azimuth, elevation, distance);
  const position = addVec(target, offset);
  let range = world.camera_targets[mode]?.distance_range_m;
  if (!range && mode === "INSPECT") {
    const targets = inspectTargets(world);
    const t = targets[Math.min(inspectIndex, Math.max(0, targets.length - 1))];
    range = t?.distance_range_m;
  }
  if (!range && mode === "RESET") range = [60, 700];
  const underwater =
    isSubmergedPose(target) || position[1] < -0.5;
  return {
    position,
    target,
    near_m: near,
    far_m: far,
    min_distance_m: range?.[0] ?? 2,
    max_distance_m: range?.[1] ?? 600,
    underwater,
    derivation: `${derivation}; az ${azimuth}deg el ${elevation.toFixed(1)}deg d ${distance}m`,
  };
}

function isSubmergedPose(target: SceneVec3): boolean {
  return target[1] < 0;
}

/** Fixed sun direction from the world file — UI theme must never change it. */
export function sunDirection(world: PortWorld): SceneVec3 {
  const { azimuth_deg, elevation_deg } = world.environment.sun;
  return cameraOffset(azimuth_deg, elevation_deg, 1);
}
