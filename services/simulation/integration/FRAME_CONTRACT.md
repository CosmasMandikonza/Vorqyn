# VORQYN physical frame contract — world ↔ simulator (issue #24)

> Status: implemented and regression-tested on
> `feat/lane2-world-sim-alignment`. This document is the coordinate-systems
> decision record for the future 3D viewer (VQ-07 / #8), the shared
> mission-event adapter (VQ-08 / #9, contracts in VQ-01 / #2) and any
> telemetry adapter (VQ-09 / #10).

## 1. Decision

**The versioned world metadata `assets/port-world/world.json` (schema
`vorqyn.port-world/1`, world `PORT-001`) is the single authoritative
physical frame.** The simulator kernel (`services/simulation/core`) now
expresses its scenario **directly in that frame** — there is no runtime
coordinate transform, no mapping layer, and no frontend offset hiding the
difference.

| Property | Value (from world.json) |
| --- | --- |
| Frame type | `ENU_local` (frameId in kernel output: `ENU_PORT-001_LOCAL`) |
| Axes | x = east, y = north, z = up |
| Units | metres |
| Origin | harbor-basin center at waterline; land lies north (+y) |
| Waterline datum | z = 0 |
| Quay deck surface | z = 4 |
| World bounds (ENU m) | x ∈ [-300, 300], y ∈ [-200, 240], z ∈ [-16, 100] |

Kernel-observed poses therefore need **no transformation** to be placed in
the world: a pose emitted by the kernel is already a world-frame ENU point.

## 2. Vehicle pose semantics (model origins)

Pose = position of the vehicle reference-model origin, per
`world.json.vehicle_reference_models`:

| Role | Origin convention | Pose z semantics |
| --- | --- | --- |
| rover | ground contact | deck surface + 0.05 m clearance → route z = **4.05** (wheels on the deck, never below or floating) |
| rov | geometric center (neutrally buoyant) | submerged vehicle centre height → route z ∈ [-12.5, -0.5] |
| drone | (hovers; reference quadcopter) | altitude inside the `aerial_survey` zone z ∈ [15, 90] |

## 3. Routes and regions

The kernel scenario consumes the world-defined routes verbatim:

- rover: `world.json.routes.rover` (starts at anchor `rover_home`)
- rov: `world.json.routes.rov` (starts at anchor `rov_home`, final survey
  waypoint inside the `obstruction_zone` task-target zone, near the
  `obstruction_primary` sunken workboat)
- drone: anchor `drone_home` **prepended** to `world.json.routes.drone_survey`
  (one documented staging transit leg so every vehicle starts at its world
  anchor; the leg runs through open `aerial_survey` airspace)

Because these are out-and-back survey paths (not closed loops), the kernel
traverses them **ping-pong** (forward, then reversed). A loop wrap-around
would teleport the vehicle across the map and violate the no-teleport
invariant. Traversal mode is a validated fixture field (`routeMode`).

Task-coverage grids are bound to world zones:

- drone → `aerial_survey` zone box (id `aerial_survey`)
- rov → `obstruction_zone` box (id `obstruction_zone`, the world's
  `task_target` zone inside `underwater_inspection`)
- rover → plan bounding box of its access route (id `rover-access-network`;
  cells over water are unreachable and are never counted as visited)

`scenario.createScenarioConfig` validates every route coordinate at
construction: finite, inside world plan bounds, and within the role's
vertical band (rover z = 4.05 exactly; ROV inside the world depth band;
drone inside the aerial band). A route edit that leaves the physical world
fails every kernel test loudly instead of producing off-world telemetry.

## 4. ENU → glTF (viewer boundary only)

world.json declares the scene as glTF-native Y-up with identity root
rotation. The single canonical conversion is:

```
gltf_x = enu_x;  gltf_y = enu_z;  gltf_z = -enu_y
```

Implemented as the pure helper `enuToGltfYUp()` in
`services/simulation/core/enu.mjs` (constant `GLTF_CONVERSION_RULE`).

Rules for consumers:

1. The **kernel never applies this conversion** — its observation snapshots
   are ENU (tested: rover z = +4.05, ROV z negative, poses equal the ENU
   route fixtures).
2. The **3D viewer applies it exactly once** when placing world-frame poses
   into the Y-up scene. Applying it twice flips y/z again (regression-tested
   in `services/simulation/integration/world-alignment.test.mjs`).
3. No additional rotation may be stacked on the identity root quaternion
   declared in world.json.

## 5. Supersession of the pre-alignment scenario (migration note)

The pre-alignment kernel (PR #21, scenario v1) used a different *fictional*
arrangement: origin "south-west quay corner at waterline", rover z = 0,
ROV route at x ∈ [-80, 80], y ∈ [-20, 60]. That layout shares **no anchor**
with the world — there is **no valid rigid transform** from v1 coordinates
to world coordinates (the two layouts place quads/piers differently, not
merely offset). Therefore:

- The scenario fixture was **superseded, not transformed**: v2 fixes
  `scenarioId = "PORT-001"` and adds `worldRef` to the config.
- Recorded **v1 traces and the v1 golden fixture are not spatially
  portable** to v2 and must be replayed only against the v1 scenario
  definition (git history: pre-#24 `scenario.mjs`). Kernel replay
  (`replayScenario`) remains bit-exact within a scenario version.
- The committed `fixtures/sample-run.json` was regenerated; the change is
  intentional and documented in PR #21's successor (this PR).

Pre-alignment defects this fixes (now guarded by negative detector tests in
`world-alignment.test.mjs`): rover 4 m below the deck (z = 0), ROV surveying
a region outside the designated underwater inspection zone, ROV/drone route
coordinates unbound to any world geometry.

## 6. Adapter guidance (VQ-08 / #9; contracts VQ-01 / #2)

When mapping kernel observations onto the shared mission contracts:

1. **Frame + units must travel with every sample**: `frameId
   = "ENU_PORT-001_LOCAL"`, `positionUnits = "m"`, altitude datum =
   world.json waterline (z = 0). Do not drop or rename them.
2. **Three clocks stay separate**: the kernel's `simulatorTimeMs` is the
   simulation clock; the service adds event receipt times; the chain adds
   confirmation times. Never merge or relabel them.
3. **Provenance is not remappable**: observations carry
   `sourceKind: "SYNTHETIC_SIM"`. A coordinate conversion (the §4 glTF
   helper, or any future geo-referencing) must **never** relabel synthetic
   simulation output as SITL/physical telemetry.
4. Stale/disconnected/paused states (`fresh: false`, `staleness`,
   `measured: null`) must map to truthful UI states, not live-looking data.
5. The kernel emits **measurements only** — acceptance thresholds and
   verdicts belong to the external evaluator (VQ-10).

## 7. Where this is enforced

| Guard | Location |
| --- | --- |
| World metadata sanity (schema, bounds contain zones, anchors finite/in-bounds) | `services/simulation/integration/world-alignment.test.mjs` |
| Routes/anchors/task regions pinned to world.json values | same file |
| Whole-route land/water/airspace containment (waypoints + 5–10 m segment samples) | same file |
| Negative detectors (below-deck, floating, axis swap, old ROV route, drone bounds) | same file |
| glTF rule, anchors mapping, double-application detection | same file |
| Kernel-side route validation at construction | `scenario.createScenarioConfig` |
| Frame/units/band invariants on every emitted snapshot | `services/simulation/core/geometry.test.mjs`, `provenance.test.mjs` |
| Asset-side consistency (manifest, GLB determinism, road corridors) | `assets/port-world/tools/validate.mjs --selfcheck` (CI) |
