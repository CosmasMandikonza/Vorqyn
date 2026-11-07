/**
 * ENU <-> scene coordinate conversion for the PORT-001 world pack.
 *
 * `world.json` is authoritative (local ENU meters: x east, y north, z up,
 * waterline z = 0). The GLB files are glTF-native Y-up with the ENU
 * conversion ALREADY baked in by the asset generator, so scene space is
 * glTF space. This module performs the conversion EXACTLY ONCE at the
 * application boundary; never rotate the loaded GLB a second time.
 *
 *   scene_x = enu_east
 *   scene_y = enu_up          (waterline at scene y = 0)
 *   scene_z = -enu_north
 */
export type EnuMeters = readonly [east: number, north: number, up: number];
export type SceneVec3 = readonly [x: number, y: number, z: number];

export function enuToScene(p: EnuMeters): SceneVec3 {
  return [p[0], p[2], -p[1]];
}

export function sceneToEnu(v: SceneVec3): EnuMeters {
  return [v[0], -v[2], v[1]];
}

/** True when a scene-space height is below the canonical waterline (y < 0). */
export function isBelowWaterline(sceneY: number): boolean {
  return sceneY < 0;
}

/**
 * Camera offset from a target in scene coordinates, given an azimuth in
 * degrees measured clockwise from ENU north (0 = looking from the south
 * toward the north... i.e. camera sits due south of the target), an
 * elevation in degrees above the horizon, and a distance in meters.
 *
 * Derived from: ENU offset = D * (sin(az)cos(el), cos(az)cos(el), sin(el))
 * then converted with enuToScene. Pure and fixture-tested; changing this
 * function changes every named camera view.
 */
export function cameraOffset(
  azimuthDeg: number,
  elevationDeg: number,
  distance: number,
): SceneVec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [
    distance * cosEl * Math.sin(az),
    distance * Math.sin(el),
    -distance * cosEl * Math.cos(az),
  ];
}

export function addVec(a: SceneVec3, b: SceneVec3): SceneVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
