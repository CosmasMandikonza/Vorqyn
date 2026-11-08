/**
 * Calibration boundary tests (issue #9 slice).
 *
 * The kernel's optical quality is UNITLESS fixture model output. These
 * tests pin the rule that `visibility_m` can only come from an explicit,
 * fully documented, monotone, domain-bounded calibration — and that
 * undocumented, unbounded or non-monotone conversions (the "quality01 is
 * metres" failure class) never produce evidence.
 */

import { describe, expect, it } from "vitest";
import {
  CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01,
  VISIBILITY_CALIBRATION_SCHEMA,
  interpolateVisibilityM,
  validateVisibilityCalibration,
  type VisibilityCalibration,
} from "../../../../services/mission/evidence-adapter";
import { TEST_CALIBRATION } from "./harness";

const validCalibration: VisibilityCalibration = {
  schema: VISIBILITY_CALIBRATION_SCHEMA,
  calibrationId: "cal-unit-test-1",
  version: 2,
  sourceRef: "unit-test documented source",
  derivation: "unit-test documented derivation",
  inputKind: CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01,
  points: [
    { quality01: 0, visibilityM: 0 },
    { quality01: 0.5, visibilityM: 1.7 },
    { quality01: 1, visibilityM: 3.4 },
  ],
};

describe("evidence adapter calibration — structural validation", () => {
  it("accepts a fully documented calibration", () => {
    const result = validateVisibilityCalibration(validCalibration);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputKind).toBe("unitless_quality01");
    expect(result.value.points).toHaveLength(3);
  });

  it("rejects undocumented calibrations (the identity 'quality01 = metres' attempt)", () => {
    // Same anchors as an identity map, but with the documentation stripped —
    // exactly what a caller must NOT be able to sneak through.
    const undocumented = {
      schema: VISIBILITY_CALIBRATION_SCHEMA,
      calibrationId: "cal-identity-attempt",
      version: 1,
      sourceRef: "",
      derivation: "",
      inputKind: CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01,
      points: [
        { quality01: 0, visibilityM: 0 },
        { quality01: 1, visibilityM: 1 },
      ],
    };
    const result = validateVisibilityCalibration(undocumented);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_error");
    expect(result.error.message).toMatch(/sourceRef|derivation/);
  });

  it("rejects a calibration claiming any input other than the kernel's unitless quality", () => {
    const wrongDomain = { ...validCalibration, inputKind: "quality01_is_metres" };
    const result = validateVisibilityCalibration(wrongDomain);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/unitless_quality01/);
  });

  it("rejects malformed anchors: too few, non-monotone, out of domain, non-finite", () => {
    const single = { ...validCalibration, points: [{ quality01: 0, visibilityM: 0 }] };
    expect(validateVisibilityCalibration(single).ok).toBe(false);

    const decreasingQuality = {
      ...validCalibration,
      points: [
        { quality01: 0.6, visibilityM: 1 },
        { quality01: 0.2, visibilityM: 2 },
      ],
    };
    expect(validateVisibilityCalibration(decreasingQuality).ok).toBe(false);

    const decreasingMetres = {
      ...validCalibration,
      points: [
        { quality01: 0, visibilityM: 2 },
        { quality01: 1, visibilityM: 1 },
      ],
    };
    const decreasing = validateVisibilityCalibration(decreasingMetres);
    expect(decreasing.ok).toBe(false);
    if (!decreasing.ok) expect(decreasing.error.message).toMatch(/non-decreasing/);

    const outOfDomain = {
      ...validCalibration,
      points: [
        { quality01: -0.1, visibilityM: 0 },
        { quality01: 1, visibilityM: 2 },
      ],
    };
    expect(validateVisibilityCalibration(outOfDomain).ok).toBe(false);

    const nonFinite = {
      ...validCalibration,
      points: [
        { quality01: 0, visibilityM: Number.NaN },
        { quality01: 1, visibilityM: 2 },
      ],
    };
    expect(validateVisibilityCalibration(nonFinite).ok).toBe(false);
  });

  it("rejects wrong schema, bad versions and missing documentation fields", () => {
    expect(validateVisibilityCalibration({ ...validCalibration, schema: "other/1" }).ok).toBe(false);
    expect(validateVisibilityCalibration({ ...validCalibration, version: 0 }).ok).toBe(false);
    expect(validateVisibilityCalibration({ ...validCalibration, calibrationId: "" }).ok).toBe(false);
    expect(validateVisibilityCalibration(null)).toMatchObject({ ok: false });
  });
});

describe("evidence adapter calibration — deterministic interpolation", () => {
  it("interpolates anchors and midpoints exactly", () => {
    expect(interpolateVisibilityM(validCalibration, 0)).toEqual({ ok: true, value: 0 });
    expect(interpolateVisibilityM(validCalibration, 1)).toEqual({ ok: true, value: 3.4 });
    expect(interpolateVisibilityM(validCalibration, 0.5)).toEqual({ ok: true, value: 1.7 });
    expect(interpolateVisibilityM(validCalibration, 0.71)).toEqual({ ok: true, value: 2.414 });
  });

  it("fails closed outside the documented domain (no extrapolation)", () => {
    const below = interpolateVisibilityM(validCalibration, -0.01);
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.error.code).toBe("calibration_domain_exceeded");
    const above = interpolateVisibilityM(validCalibration, 1.01);
    expect(above.ok).toBe(false);
  });

  it("is deterministic for repeated identical inputs", () => {
    const a = interpolateVisibilityM(validCalibration, 0.33);
    const b = interpolateVisibilityM(validCalibration, 0.33);
    expect(a).toEqual(b);
  });
});

describe("evidence adapter calibration — anchor-span domain (review P1-A)", () => {
  const narrow: VisibilityCalibration = {
    ...validCalibration,
    calibrationId: "cal-narrow-span-1",
    points: [
      { quality01: 0.3, visibilityM: 1.02 },
      { quality01: 0.7, visibilityM: 2.38 },
    ],
  };

  it("fails closed for readings BELOW the first anchor (no endpoint clamping)", () => {
    const below = interpolateVisibilityM(narrow, 0.1);
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.error.code).toBe("calibration_domain_exceeded");
  });

  it("fails closed for readings ABOVE the last anchor (no endpoint clamping)", () => {
    const above = interpolateVisibilityM(narrow, 0.9);
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.error.code).toBe("calibration_domain_exceeded");
  });

  it("preserves valid endpoint and interior interpolation (inclusive anchor span)", () => {
    expect(interpolateVisibilityM(narrow, 0.3)).toEqual({ ok: true, value: 1.02 });
    expect(interpolateVisibilityM(narrow, 0.5)).toEqual({ ok: true, value: 1.7 });
    expect(interpolateVisibilityM(narrow, 0.7)).toEqual({ ok: true, value: 2.38 });
  });
});

describe("evidence adapter calibration — harness fixture honesty", () => {
  it("the TEST-ONLY fixture calibration stays clearly labelled as such", () => {
    expect(TEST_CALIBRATION.sourceRef).toMatch(/TEST-ONLY/);
    expect(TEST_CALIBRATION.derivation).toMatch(/TEST-ONLY/);
    expect(TEST_CALIBRATION.points[0]).toEqual({ quality01: 0, visibilityM: 0 });
    expect(TEST_CALIBRATION.points[1]).toEqual({ quality01: 1, visibilityM: 3.4 });
  });
});
