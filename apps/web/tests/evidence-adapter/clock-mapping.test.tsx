/**
 * Clock-mapping tests (issue #9 slice) — the explicit source↔capture clock
 * contract. These tests pin the rule that simulator-relative milliseconds
 * are NEVER silently compared against, or overwritten with, Unix-epoch
 * values: the only supported conversion is the versioned, stream-bound
 * `base + source` mapping, and every other attempt fails closed.
 */

import { describe, expect, it } from "vitest";
import { FIXTURE_EPOCH_BASE_MS } from "@vorqyn/contracts";
import {
  CLOCK_MAPPING_ALGORITHM,
  EVIDENCE_CLOCK_MAPPING_SCHEMA,
  makeEvidenceClockMapping,
  mapSourceTimeToCaptureDomain,
  validateEvidenceClockMapping,
} from "../../../../services/mission/evidence-adapter";
import { CAPTURE_BASE_MS, DEMO_SEED } from "./harness";

describe("evidence adapter clock mapping — construction", () => {
  it("builds a versioned, stream-bound mapping on the fixture capture domain", () => {
    const mapping = makeEvidenceClockMapping({
      captureEpochBaseMs: CAPTURE_BASE_MS,
      seed: DEMO_SEED,
      scenarioId: "PORT-001",
    });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    expect(mapping.value.schema).toBe(EVIDENCE_CLOCK_MAPPING_SCHEMA);
    expect(mapping.value.algorithm).toBe(CLOCK_MAPPING_ALGORITHM);
    expect(mapping.value.captureEpochBaseMs).toBe(FIXTURE_EPOCH_BASE_MS);
    expect(mapping.value.sourceBinding).toEqual({ seed: DEMO_SEED, scenarioId: "PORT-001" });
  });

  it("is deterministic: identical inputs produce identical mappings", () => {
    const a = makeEvidenceClockMapping({ captureEpochBaseMs: 1000, seed: 7, scenarioId: "PORT-001" });
    const b = makeEvidenceClockMapping({ captureEpochBaseMs: 1000, seed: 7, scenarioId: "PORT-001" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).toEqual(b.value);
  });

  it("rejects non-epoch bases, bad seeds and empty scenarios", () => {
    expect(makeEvidenceClockMapping({ captureEpochBaseMs: -1, seed: DEMO_SEED, scenarioId: "PORT-001" }).ok).toBe(false);
    expect(makeEvidenceClockMapping({ captureEpochBaseMs: 1.5, seed: DEMO_SEED, scenarioId: "PORT-001" }).ok).toBe(false);
    expect(makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: -1, scenarioId: "PORT-001" }).ok).toBe(false);
    expect(makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: 4294967296, scenarioId: "PORT-001" }).ok).toBe(false);
    expect(makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: DEMO_SEED, scenarioId: "" }).ok).toBe(false);
  });
});

describe("evidence adapter clock mapping — source time conversion", () => {
  it("maps kernel-relative mission time onto the anchored capture domain", () => {
    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: DEMO_SEED, scenarioId: "PORT-001" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    // Kernel first snapshot time (500 ms) and a later step, verbatim arithmetic.
    expect(mapSourceTimeToCaptureDomain(mapping.value, 500)).toEqual({ ok: true, value: CAPTURE_BASE_MS + 500 });
    expect(mapSourceTimeToCaptureDomain(mapping.value, 20000)).toEqual({ ok: true, value: CAPTURE_BASE_MS + 20000 });
  });

  it("fails closed on out-of-domain source times (no clamping, no guessing)", () => {
    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: DEMO_SEED, scenarioId: "PORT-001" });
    if (!mapping.ok) throw new Error("unreachable");
    expect(mapSourceTimeToCaptureDomain(mapping.value, -1).ok).toBe(false);
    expect(mapSourceTimeToCaptureDomain(mapping.value, 0.5).ok).toBe(false);
    expect(mapSourceTimeToCaptureDomain(mapping.value, Number.MAX_SAFE_INTEGER).ok).toBe(false);
  });
});

describe("evidence adapter clock mapping — rehydration validation", () => {
  it("accepts its own serialized mapping (JSON round-trip)", () => {
    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: CAPTURE_BASE_MS, seed: DEMO_SEED, scenarioId: "PORT-001" });
    if (!mapping.ok) throw new Error("unreachable");
    const roundtrip = validateEvidenceClockMapping(JSON.parse(JSON.stringify(mapping.value)));
    expect(roundtrip.ok).toBe(true);
    if (!roundtrip.ok) return;
    expect(roundtrip.value).toEqual(mapping.value);
  });

  it("rejects unknown schemas and unknown algorithms instead of guessing a conversion", () => {
    expect(validateEvidenceClockMapping({ schema: "someone-else/9", algorithm: CLOCK_MAPPING_ALGORITHM }).ok).toBe(false);
    const attempted = validateEvidenceClockMapping({
      schema: EVIDENCE_CLOCK_MAPPING_SCHEMA,
      algorithm: "quality01_times_1000_equals_metres",
      captureEpochBaseMs: CAPTURE_BASE_MS,
      sourceBinding: { seed: DEMO_SEED, scenarioId: "PORT-001" },
    });
    expect(attempted.ok).toBe(false);
    if (attempted.ok) return;
    expect(attempted.error.message).toMatch(/refusing to guess/);
  });
});
