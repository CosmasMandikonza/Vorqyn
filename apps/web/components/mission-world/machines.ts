/**
 * Machine registry for the world preview. Anchors and files refer to
 * world.json entries and the hash-verified public copies of the true-scale
 * reference models. yawDeg orients each machine toward its first declared
 * route heading (derived in the PR evidence notes), not toward any live pose.
 *
 * `robotId` is the deterministic kernel's robot identifier
 * (services/simulation/core/scenario.mjs): the kernel routes start at these
 * same world anchors, so a live pose for a robotId replaces the static
 * anchor position of the machine with the matching id.
 */
export interface MachineSpec {
  id: "drone" | "rover" | "rov";
  robotId: "drone-01" | "rover-01" | "rov-01";
  label: string;
  role: "aerial" | "ground" | "underwater";
  anchorId: string;
  file: string;
  yawDeg: number;
}

export const MACHINES: MachineSpec[] = [
  {
    id: "drone",
    robotId: "drone-01",
    label: "Survey drone",
    role: "aerial",
    anchorId: "drone_home",
    file: "/port-world/drone-ref.glb",
    yawDeg: -45,
  },
  {
    id: "rover",
    robotId: "rover-01",
    label: "Access rover",
    role: "ground",
    anchorId: "rover_home",
    file: "/port-world/rover-ref.glb",
    yawDeg: 90,
  },
  {
    id: "rov",
    robotId: "rov-01",
    label: "Inspection ROV",
    role: "underwater",
    anchorId: "rov_home",
    file: "/port-world/rov-ref.glb",
    yawDeg: 56,
  },
];
