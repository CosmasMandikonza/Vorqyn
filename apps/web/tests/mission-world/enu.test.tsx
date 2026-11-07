import { describe, expect, it } from "vitest";
import {
  addVec,
  cameraOffset,
  enuToScene,
  isBelowWaterline,
  sceneToEnu,
} from "@/components/mission-world/enu";

/**
 * Numeric fixtures against the authoritative PORT-001 world.json anchor
 * values. Any frame/axis mistake (x/y inversion, double conversion, degrees
 * vs radians) breaks these exact numbers.
 */
describe("ENU -> scene conversion (single, exact mapping)", () => {
  it("maps world.json drone_home (-40, 80, 55) to scene (-40, 55, -80)", () => {
    expect(enuToScene([-40, 80, 55])).toEqual([-40, 55, -80]);
  });

  it("maps obstruction_primary (205, -95, -9.2) to scene (205, -9.2, 95)", () => {
    const got = enuToScene([205, -95, -9.2]);
    expect(got[0]).toBeCloseTo(205, 10);
    expect(got[1]).toBeCloseTo(-9.2, 10);
    expect(got[2]).toBeCloseTo(95, 10);
  });

  it("maps port_datum (0, 44, 4.0) to scene (0, 4.0, -44) on the quay deck", () => {
    expect(enuToScene([0, 44, 4])).toEqual([0, 4, -44]);
  });

  it("keeps the waterline at scene y = 0 for every shore point", () => {
    for (const east of [-300, 0, 300]) {
      const scene = enuToScene([east, -100, 0]);
      expect(scene[1]).toBe(0);
    }
  });

  it("is exactly invertible", () => {
    const p = [-217.5, 133.25, -8.125] as const;
    expect(sceneToEnu(enuToScene(p))).toEqual([...p]);
  });

  it("does NOT swap east/up (guards against x/y or y/z inversion)", () => {
    // east must stay on scene x even when up is negative (underwater)
    const scene = enuToScene([42, 10, -6]);
    expect(scene[0]).toBe(42);
    expect(scene[1]).toBe(-6);
    expect(scene[2]).toBe(-10);
  });

  it("classifies waterline heights", () => {
    expect(isBelowWaterline(0)).toBe(false);
    expect(isBelowWaterline(-0.001)).toBe(true);
    expect(isBelowWaterline(4)).toBe(false);
  });
});

describe("camera offset math (scene space)", () => {
  it("places the camera due north of the target at azimuth 0", () => {
    // The offset points from target TOWARD the camera. az=0 has north
    // component +D in ENU, which is scene z = -D (north is negative z).
    const off = cameraOffset(0, 0, 100);
    expect(off[0]).toBeCloseTo(0, 10);
    expect(off[1]).toBeCloseTo(0, 10);
    expect(off[2]).toBeCloseTo(-100, 10);
  });

  it("points east at azimuth 90", () => {
    const off = cameraOffset(90, 0, 100);
    expect(off[0]).toBeCloseTo(100, 10);
    expect(off[2]).toBeCloseTo(0, 10);
  });

  it("raises the camera by D*sin(el) and keeps horizontal radius D*cos(el)", () => {
    const off = cameraOffset(215, 32, 330);
    const horizontal = Math.hypot(off[0], off[2]);
    expect(off[1]).toBeCloseTo(330 * Math.sin((32 * Math.PI) / 180), 6);
    expect(horizontal).toBeCloseTo(330 * Math.cos((32 * Math.PI) / 180), 6);
  });

  it("RESET 3/4 framing offset matches the hand-computed fixture", () => {
    // az 215deg el 32deg d 330:
    // sin215=-0.573576, cos215=-0.819152, sin32=0.529919, cos32=0.848048
    const off = cameraOffset(215, 32, 330);
    expect(off[0]).toBeCloseTo(330 * 0.8480480961564260 * -0.5735764363510460, 4);
    expect(off[1]).toBeCloseTo(330 * 0.5299192642332045, 4);
    expect(off[2]).toBeCloseTo(-330 * 0.8480480961564260 * -0.8191520442889918, 4);
  });

  it("composes position = target + offset", () => {
    const target = enuToScene([170, -90, -9]);
    const pos = addVec(target, cameraOffset(340, 8, 30));
    expect(pos[1]).toBeCloseTo(-9 + 30 * Math.sin((8 * Math.PI) / 180), 6);
  });
});
