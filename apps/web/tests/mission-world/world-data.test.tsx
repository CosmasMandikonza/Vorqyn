import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  validateWorld,
  WorldValidationError,
  fetchWorld,
} from "@/components/mission-world/world-data";
import {
  inspectTargets,
  poseForMode,
  VIEW_MODES,
} from "@/components/mission-world/camera-presets";
import { enuToScene } from "@/components/mission-world/enu";

/** The real committed world metadata — the same file copied into public/. */
const world = validateWorld(
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../../public/port-world/world.json"),
      "utf8",
    ),
  ),
);

describe("world.json validation", () => {
  it("accepts the real committed PORT-001 metadata", () => {
    expect(world.world_id).toBe("PORT-001");
    expect(world.frame.type).toBe("ENU_local");
    expect(world.waterline_z_m).toBe(0);
  });

  it("rejects a wrong frame type (e.g. someone ships a Y-up-world file)", () => {
    const wrong = { ...world, frame: { ...world.frame, type: "gltf_yup" } };
    expect(() => validateWorld(wrong)).toThrow(WorldValidationError);
  });

  it("rejects non-meter units and non-zero waterlines", () => {
    expect(() =>
      validateWorld({ ...world, frame: { ...world.frame, units: "kilometer" } }),
    ).toThrow(WorldValidationError);
    expect(() => validateWorld({ ...world, waterline_z_m: 4 })).toThrow(
      WorldValidationError,
    );
  });

  it("rejects swapped axes (x/y inversion guard)", () => {
    const swapped = {
      ...world,
      frame: { ...world.frame, axes: { x: "north", y: "east", z: "up" } },
    };
    expect(() => validateWorld(swapped)).toThrow(WorldValidationError);
  });

  it("reports fetch/http failures as validation errors, not silent empties", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(fetchWorld()).rejects.toThrow(/HTTP 404/);
    vi.unstubAllGlobals();
  });
});

describe("camera presets derive from world.json ranges", () => {
  it("covers exactly the five named modes", () => {
    expect(VIEW_MODES).toEqual(["RESET", "AIR", "LAND", "UNDERWATER", "INSPECT"]);
  });

  it("RESET pose matches the declared azimuth/elevation/distance framing", () => {
    const pose = poseForMode("RESET", world);
    expect(pose.target).toEqual(enuToScene([0, 20, 10]));
    expect(pose.position[1]).toBeCloseTo(10 + 330 * Math.sin((32 * Math.PI) / 180), 3);
    expect(pose.min_distance_m).toBe(60);
    expect(pose.max_distance_m).toBe(700);
    expect(pose.underwater).toBe(false);
  });

  it("AIR pose height lands inside the declared height range", () => {
    const pose = poseForMode("AIR", world);
    expect(pose.position[1]).toBeGreaterThanOrEqual(90);
    expect(pose.position[1]).toBeLessThanOrEqual(240);
    expect(pose.near_m).toBe(1);
    expect(pose.far_m).toBe(1500);
  });

  it("LAND pose targets the yard and stays above ground", () => {
    const pose = poseForMode("LAND", world);
    expect(pose.target).toEqual(enuToScene([-140, 110, 10]));
    expect(pose.position[1]).toBeGreaterThan(4); // never below quay deck
    expect(pose.underwater).toBe(false);
  });

  it("UNDERWATER pose is genuinely submerged with murky-safe near plane", () => {
    const pose = poseForMode("UNDERWATER", world);
    expect(pose.underwater).toBe(true);
    expect(pose.target[1]).toBeLessThan(0);
    expect(pose.near_m).toBe(0.2);
    expect(pose.position[1]).toBeLessThan(0);
  });

  it("INSPECT resolves declared anchors with ranges and supports index switching", () => {
    const targets = inspectTargets(world);
    expect(targets.map((t) => t.anchorId)).toEqual([
      "obstruction_primary",
      "crane_boom_tip",
    ]);
    const a = poseForMode("INSPECT", world, 0);
    expect(a.target).toEqual(enuToScene([205, -95, -9.2]));
    expect(a.underwater).toBe(true);
    const b = poseForMode("INSPECT", world, 1);
    expect(b.target).toEqual(enuToScene([0, -126, 27.4]));
    expect(b.underwater).toBe(false);
  });

  it("never proposes a pose beyond the world bounds (+-330/260/120 m)", () => {
    for (const mode of VIEW_MODES) {
      const count = mode === "INSPECT" ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const pose = poseForMode(mode, world, i);
        expect(Math.abs(pose.position[0])).toBeLessThan(330);
        expect(Math.abs(pose.position[2])).toBeLessThan(260);
        expect(pose.position[1]).toBeLessThan(300);
        expect(pose.position[1]).toBeGreaterThan(-40);
      }
    }
  });
});
