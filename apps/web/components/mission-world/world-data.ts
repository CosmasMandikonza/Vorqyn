/**
 * Loader + validation for the PORT-001 world metadata (world.json).
 *
 * The file is copied verbatim (sha256-verified, see
 * tests/mission-world/sync-port-world.mjs) from the authoritative asset pack
 * into /port-world/world.json. This module fetches it at runtime and refuses
 * anything that does not declare the expected frame — a wrong-frame world
 * must fail loudly here, not render rotated somewhere else.
 */
import type { EnuMeters } from "./enu";

export interface PortWorldBox {
  min: EnuMeters;
  max: EnuMeters;
}

export interface PortWorldZone {
  id: string;
  label: string;
  kind: "airspace" | "water" | "land";
  box_enu_m: PortWorldBox;
  flags?: { damaged?: boolean; task_target?: boolean };
}

export interface PortWorldAnchor {
  id: string;
  label: string;
  role: string;
  position_enu_m: EnuMeters;
}

export interface PortWorldCameraTarget {
  label: string;
  target_enu_m?: EnuMeters;
  distance_range_m?: [number, number];
  height_range_m?: [number, number];
  near_m?: number;
  far_m?: number;
  by_role?: Record<
    string,
    {
      distance_range_m: [number, number];
      height_offset_range_m?: [number, number];
      near_m: number;
      far_m: number;
    }
  >;
  targets?: Array<{
    anchor: string;
    distance_range_m: [number, number];
    near_m: number;
    far_m: number;
  }>;
  distance_m?: number;
  azimuth_deg?: number;
  elevation_deg?: number;
}

export interface PortWorld {
  schema: string;
  world_id: string;
  name: string;
  frame: {
    type: string;
    axes: { x: string; y: string; z: string };
    units: string;
    origin: string;
  };
  waterline_z_m: number;
  quay_deck_z_m: number;
  bounds_enu_m: PortWorldBox;
  zones: PortWorldZone[];
  anchors: PortWorldAnchor[];
  camera_targets: Record<string, PortWorldCameraTarget>;
  environment: { sun: { azimuth_deg: number; elevation_deg: number; note?: string } };
  vehicle_reference_models: Record<
    string,
    { file: string; nominal_dims_enu_m: Record<string, number>; origin_convention?: string; note?: string }
  >;
}

export class WorldValidationError extends Error {
  constructor(details: string[]) {
    super(`world.json failed validation: ${details.join("; ")}`);
    this.name = "WorldValidationError";
  }
}

function isFiniteTuple(v: unknown, n = 3): v is number[] {
  return (
    Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

export function validateWorld(data: unknown): PortWorld {
  const d = data as Partial<PortWorld>;
  const problems: string[] = [];

  if (typeof d.schema !== "string" || !d.schema.startsWith("vorqyn.port-world")) {
    problems.push(`unexpected schema "${String(d.schema)}"`);
  }
  if (d.frame?.type !== "ENU_local") problems.push(`frame.type must be ENU_local, got "${String(d.frame?.type)}"`);
  if (d.frame?.units !== "meter") problems.push(`frame.units must be meter, got "${String(d.frame?.units)}"`);
  if (d.frame?.axes?.x !== "east" || d.frame?.axes?.y !== "north" || d.frame?.axes?.z !== "up") {
    problems.push("frame.axes must be x=east, y=north, z=up");
  }
  if (d.waterline_z_m !== 0) problems.push(`waterline_z_m must be 0, got ${String(d.waterline_z_m)}`);
  if (!Array.isArray(d.zones) || d.zones.length === 0) problems.push("zones missing/empty");
  if (!Array.isArray(d.anchors) || d.anchors.length === 0) problems.push("anchors missing/empty");
  if (!d.camera_targets || typeof d.camera_targets !== "object") problems.push("camera_targets missing");
  if (!d.environment?.sun || typeof d.environment.sun.azimuth_deg !== "number") problems.push("environment.sun missing");
  for (const [label, group] of [
    ["zone", (d.zones ?? []) as PortWorldZone[]],
    ["anchor", (d.anchors ?? []) as PortWorldAnchor[]],
  ] as const) {
    for (const item of group) {
      const box = label === "zone" ? (item as PortWorldZone).box_enu_m : undefined;
      if (box && (!isFiniteTuple(box.min) || !isFiniteTuple(box.max))) {
        problems.push(`${label} ${item.id}: non-finite box`);
      }
      if (label === "anchor" && !isFiniteTuple((item as PortWorldAnchor).position_enu_m)) {
        problems.push(`${label} ${item.id}: non-finite position`);
      }
    }
  }
  if (problems.length > 0) throw new WorldValidationError(problems);
  return d as PortWorld;
}

export async function fetchWorld(url = "/port-world/world.json"): Promise<PortWorld> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new WorldValidationError([`fetch failed: ${String(cause)}`]);
  }
  if (!res.ok) {
    throw new WorldValidationError([`world metadata unavailable (HTTP ${res.status})`]);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (cause) {
    throw new WorldValidationError([`world metadata is not JSON: ${String(cause)}`]);
  }
  return validateWorld(data);
}

export function anchorById(world: PortWorld, id: string): PortWorldAnchor | undefined {
  return world.anchors.find((a) => a.id === id);
}

export function zoneById(world: PortWorld, id: string): PortWorldZone | undefined {
  return world.zones.find((z) => z.id === id);
}
