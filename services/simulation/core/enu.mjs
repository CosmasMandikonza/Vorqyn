/**
 * VORQYN lane-2 simulation kernel — local ENU frame primitives.
 *
 * Scope: VQ-08-PREP (#20) + #24 world/simulator alignment. Pure, dependency-free.
 *
 * Frame convention (authoritative source: assets/port-world/world.json,
 * `vorqyn.port-world/1`; documented in
 * services/simulation/integration/FRAME_CONTRACT.md and tested in
 * geometry.test.mjs and integration/world-alignment.test.mjs):
 * - frameId: "ENU_PORT-001_LOCAL" — the world PORT-001 local frame
 * - origin: harbor-basin center at waterline (world.json frame.origin)
 * - +x = EAST  (metres)
 * - +y = NORTH (metres; land lies north of the basin)
 * - +z = UP    (metres, 0 at the waterline datum, underwater negative;
 *   quay deck surface at z = 4)
 * - Units: metres for position and distance, seconds for durations of motion,
 *   milliseconds for the integer simulator clock.
 *
 * The kernel emits ENU poses only. The glTF (Y-up) conversion for 3D
 * rendering is defined here as a pure helper so the viewer boundary applies
 * exactly one, tested conversion — never two, never inside the kernel.
 *
 * Only engine-independent IEEE-754 operations are used (+, -, *, /, sqrt,
 * abs, min, max) so pose integration is bit-reproducible for a fixed command
 * sequence on any conformant engine.
 */

export const FRAME_ID = "ENU_PORT-001_LOCAL";
export const POSITION_UNITS = "m";

/**
 * The single canonical ENU -> glTF (Y-up) conversion, matching
 * world.json.gltf_conversion.rule verbatim. Apply ONCE, at the 3D viewer
 * boundary only. The scene root quaternion is identity (world.json), so no
 * additional rotation may be stacked on top of this mapping.
 */
export const GLTF_CONVERSION_RULE = "gltf_x = enu_x; gltf_y = enu_z; gltf_z = -enu_y";

/**
 * Convert one ENU point to glTF-native Y-up coordinates.
 * Pure mapping; the kernel itself never applies it (its observations stay
 * ENU), and applying it twice is a viewer bug caught by
 * integration/world-alignment.test.mjs.
 */
export function enuToGltfYUp(p) {
  return { x: p.x, y: p.z, z: -p.y };
}

/** Euclidean length of a 3-vector. Math.sqrt is correctly rounded per IEEE-754. */
export function norm3(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Straight-line distance between two ENU points. */
export function distance3(a, b) {
  return norm3({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

/**
 * Step `from` toward `target` by at most `maxStepM` metres.
 * Returns the new position and whether the target was reached exactly.
 * The returned displacement is never larger than maxStepM, which is the
 * kernel-level "no teleport" invariant.
 */
export function stepToward(from, target, maxStepM) {
  if (!Number.isFinite(maxStepM) || maxStepM < 0) {
    throw new RangeError(`maxStepM must be a non-negative finite number, got ${maxStepM}`);
  }
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const remaining = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (remaining <= maxStepM) {
    // Clamp onto the waypoint itself: displacement equals `remaining`,
    // which is <= maxStepM, so this is a bounded arrival, not a jump.
    return { position: { x: target.x, y: target.y, z: target.z }, arrived: true, movedM: remaining };
  }
  const scale = maxStepM / remaining;
  return {
    position: { x: from.x + dx * scale, y: from.y + dy * scale, z: from.z + dz * scale },
    arrived: false,
    movedM: maxStepM,
  };
}

/** True when `p` is inside the axis-aligned box (inclusive bounds). */
export function insideBox(p, box) {
  return (
    p.x >= box.minX && p.x <= box.maxX &&
    p.y >= box.minY && p.y <= box.maxY &&
    p.z >= box.minZ && p.z <= box.maxZ
  );
}

/** Clamp an ENU point into the axis-aligned box. */
export function clampToBox(p, box) {
  return {
    x: Math.min(Math.max(p.x, box.minX), box.maxX),
    y: Math.min(Math.max(p.y, box.minY), box.maxY),
    z: Math.min(Math.max(p.z, box.minZ), box.maxZ),
  };
}

/**
 * Index of the plan-view (x, y) grid cell containing `p`, or -1 when outside.
 * Grids are defined by the scenario's task region boxes and cell counts; they
 * exist purely to make coverage a measurable occupancy count.
 */
export function planGridIndexOf(p, box, cellsX, cellsY) {
  // Plan-view containment ignores z entirely.
  if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) {
    return -1;
  }
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  let ix = Math.floor(((p.x - box.minX) / spanX) * cellsX);
  let iy = Math.floor(((p.y - box.minY) / spanY) * cellsY);
  if (ix === cellsX) ix = cellsX - 1; // exact right-edge points
  if (iy === cellsY) iy = cellsY - 1;
  return iy * cellsX + ix;
}
