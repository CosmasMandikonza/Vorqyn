/**
 * Machine registry for the world preview. Anchors and files refer to
 * world.json entries and the hash-verified public copies of the true-scale
 * reference models. yawDeg orients each machine toward its first declared
 * route heading (derived in the PR evidence notes), not toward any live pose.
 */
export interface MachineSpec {
  id: "drone" | "rover" | "rov";
  label: string;
  role: "aerial" | "ground" | "underwater";
  anchorId: string;
  file: string;
  yawDeg: number;
}

export const MACHINES: MachineSpec[] = [
  {
    id: "drone",
    label: "Survey drone",
    role: "aerial",
    anchorId: "drone_home",
    file: "/port-world/drone-ref.glb",
    yawDeg: -45,
  },
  {
    id: "rover",
    label: "Access rover",
    role: "ground",
    anchorId: "rover_home",
    file: "/port-world/rover-ref.glb",
    yawDeg: 90,
  },
  {
    id: "rov",
    label: "Inspection ROV",
    role: "underwater",
    anchorId: "rov_home",
    file: "/port-world/rov-ref.glb",
    yawDeg: 56,
  },
];
