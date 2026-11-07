#!/usr/bin/env node
/** Actual offline kernel observations for recording; not the web API, verifier, AI or chain. */
import { createScenarioKernel } from "../../services/simulation/core/kernel.mjs";
const kernel = createScenarioKernel({ seed: 20261107 });
kernel.step(2);
const before = kernel.getObservationLog().at(-1);
const result = kernel.issueCommand({
  type: "injectOpticalVisibilityFault",
  robotId: "rov-01",
  severity: "severe",
  durationMs: 9000,
  idempotencyKey: "release-recording-optical-1",
});
if (!result.ok) throw new Error("Kernel rejected the recording fault command");
kernel.step(2);
const after = kernel.getObservationLog().at(-1);
const rows = [before, after].map((frame) => {
  const rov = frame.robots.find((r) => r.robotId === "rov-01");
  return {
    sequence: frame.sequence,
    simulatorTimeMs: frame.simulatorTimeMs,
    sourceKind: frame.provenance.sourceKind,
    frameId: frame.provenance.frameId,
    rovPoseENU: rov.pose,
    opticalQuality01: rov.sensors.find((s) => s.kind === "optical").measured
      .quality01,
    sonarQuality01: rov.sensors.find((s) => s.kind === "sonar").measured
      .quality01,
  };
});
console.log(
  "OFFLINE KERNEL DEMONSTRATION · SYNTHETIC_SIM · not web playback, physical telemetry, evidence verification or payment",
);
console.log(JSON.stringify(rows, null, 2));
if (!(rows[1].opticalQuality01 < rows[0].opticalQuality01 * 0.3))
  throw new Error("Expected measured optical degradation did not occur");
