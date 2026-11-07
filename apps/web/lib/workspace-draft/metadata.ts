import world from "../../../../assets/port-world/world.json";

export const TEMPLATE_ID = world.world_id;
export const TEMPLATE_NAME = "Kerameion Basin · Post-storm port inspection";
export type Modality = "air" | "land" | "water";
export const ZONES = world.zones.map((zone) => ({
  id: zone.id,
  label: zone.label,
  modality: (zone.kind === "airspace"
    ? "air"
    : zone.kind === "land"
      ? "land"
      : "water") as Modality,
  damaged: "flags" in zone && zone.flags?.damaged === true,
  description: `${zone.box_enu_m.min[2]} to ${zone.box_enu_m.max[2]} m relative to the waterline${"flags" in zone && zone.flags?.damaged ? " · Damaged area; planning selection is not access approval" : ""}`,
}));
export const MODALITIES: Modality[] = ["air", "land", "water"];
export const MACHINE_LABELS = {
  air: "Air · Drone",
  land: "Land · Ground rover",
  water: "Underwater · ROV",
};
// Product-derived planning options. world.json contains no sensor catalogue.
export const SENSORS: Record<Modality, { id: string; label: string }[]> = {
  air: [{ id: "camera", label: "Survey camera" }],
  land: [
    { id: "route-mapping", label: "Route mapping" },
    { id: "camera", label: "Inspection camera" },
  ],
  water: [
    { id: "optical", label: "Optical inspection" },
    { id: "sonar", label: "Sonar obstruction mapping" },
  ],
};
export const OBJECTIVES = [
  { id: "combined", label: "Coordinate a multi-domain inspection" },
  { id: "aerial", label: "Survey aerial structures and obstructions" },
  { id: "ground", label: "Inspect ground access routes" },
  { id: "submerged", label: "Map submerged obstructions with sonar" },
];
export function requiredModalities(zoneIds: string[]) {
  return MODALITIES.filter((m) =>
    ZONES.some((z) => zoneIds.includes(z.id) && z.modality === m),
  );
}
