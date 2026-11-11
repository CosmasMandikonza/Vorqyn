/** Actual owner adapter negative acceptance. No calibrated metres or chain authority invented here. */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "node:path";
import { FIXTURE_EPOCH_BASE_MS, canonicalJson } from "@vorqyn/contracts";
import { scenario, SEED } from "./scenario";
const load = () =>
  import(
    resolve(
      process.env.INTEGRATION_TARGET_ROOT!,
      "services/mission/evidence-adapter/index.ts",
    )
  );
let adapter: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  adapter = await load();
});
function source() {
  const { journal } = scenario();
  const mapping = adapter.makeEvidenceClockMapping({
    captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS,
    seed: SEED,
    scenarioId: "PORT-001",
  });
  expect(mapping.ok).toBe(true);
  if (!mapping.ok) throw new Error(mapping.error.message);
  return { journal, modality: "sonar" as const, clockMapping: mapping.value };
}
it("preserves real sonar measurements, explicit source clock and deterministic capture without lifecycle events", () => {
  const input = source();
  const capture = adapter.buildEvidenceCapture(input);
  expect(capture.ok).toBe(true);
  if (!capture.ok) throw new Error(capture.error.message);
  expect(capture.value.provenance.sourceKind).toBe("SYNTHETIC_SIM");
  expect(capture.value.observations.length).toBeGreaterThan(0);
  for (const observation of capture.value.observations) {
    const record = input.journal.records.find(
      (r) => r.snapshot.sequence === observation.sequence,
    )!;
    const sensor = record.snapshot.robots
      .find((r) => r.robotId === observation.robotId)!
      .sensors.find((s) => s.sensorId === observation.sensorId)!;
    expect(observation.metric).toEqual({
      kind: "sonar_ping",
      value: sensor.measured!.quality01,
    });
    const sample = capture.value.samples.find(
      (s: { sequence: number; robotId: string }) =>
        s.sequence === observation.sequence &&
        s.robotId === observation.robotId,
    )!;
    expect(sample.sourceTimestampMs).toBe(
      FIXTURE_EPOCH_BASE_MS + record.snapshot.simulatorTimeMs,
    );
  }
  expect(canonicalJson(adapter.buildEvidenceCapture(input))).toBe(
    canonicalJson(capture),
  );
  expect(capture.value).not.toHaveProperty("events");
  expect(capture.value).not.toHaveProperty("verdict");
  expect(capture.value).not.toHaveProperty("chainReceipt");
});
it("refuses optical metres when no reviewed calibration exists", () => {
  expect(
    adapter.buildEvidenceCapture({ ...source(), modality: "optical" }),
  ).toMatchObject({
    ok: false,
    error: { code: "optical_visibility_unsupported" },
  });
});
it.each([0.1, 0.9])(
  "rejects quality %s outside documented partial calibration anchors",
  (quality) => {
    // Deliberately artificial partial-domain descriptor, NOT a physical calibration or demo measurement.
    const calibration = adapter.validateVisibilityCalibration({
      schema: "vorqyn.visibility-calibration/1",
      calibrationId: "qa-partial-fixture",
      version: 1,
      sourceRef: "QA FIXTURE ONLY; no physical calibration",
      derivation: "Partial-domain rejection test only",
      inputKind: "unitless_quality01",
      points: [
        { quality01: 0.3, visibilityM: 2 },
        { quality01: 0.7, visibilityM: 4 },
      ],
    });
    expect(calibration.ok).toBe(true);
    if (!calibration.ok) throw new Error(calibration.error.message);
    expect(
      adapter.interpolateVisibilityM(calibration.value, quality),
    ).toMatchObject({
      ok: false,
      error: { code: "calibration_domain_exceeded" },
    });
  },
);
it.each(["sonar", "pose", "missionId", "seed", "recordOrdinal"])(
  "rejects a %s mutation absent from accepted journal bytes",
  (field) => {
    const input = source();
    const records = structuredClone(input.journal.records.slice(0, 3));
    expect(adapter.buildEvidenceCapture({ ...input, records }).ok).toBe(true);
    const record = records[0]!;
    const rov = record.snapshot.robots.find((r) => r.robotId === "rov-01")!;
    if (field === "sonar")
      rov.sensors.find((s) => s.kind === "sonar")!.measured!.quality01 = 0.999;
    if (field === "pose") rov.pose.x += 100;
    const tampered = records.map((r, i) =>
      i
        ? r
        : {
            ...r,
            ...(field === "missionId"
              ? { missionId: "qa-foreign-mission" }
              : {}),
            ...(field === "seed" ? { seed: SEED + 1 } : {}),
            ...(field === "recordOrdinal" ? { recordOrdinal: 999 } : {}),
          },
    );
    expect(
      adapter.buildEvidenceCapture({ ...input, records: tampered }).ok,
    ).toBe(false);
  },
);
