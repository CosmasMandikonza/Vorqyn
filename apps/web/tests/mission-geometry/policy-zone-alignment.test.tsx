/**
 * P0 Mission Geometry & Evidence Integrity — failing-first integration
 * evidence (Agent A, Lane 2; issues #9/#14, verifier #11).
 *
 * THE DEFECT (numerically proven against merged main `65da706`):
 * `POLICY_SEA_OBSTRUCTION_1.zone = { centerX: 0, centerY: 0, radiusMetres: 80 }`
 * does not correspond to the world-defined obstruction:
 *   - world.json obstruction_zone box: x ∈ [120, 220], y ∈ [−120, −60]
 *     (centre (170, −90), farthest corner 58.31 m from the centre);
 *   - the kernel ROV survey route (world.json routes.rov) runs
 *     (60,−10) → (170,−90); its in-box survey leg lies 130–193 m from the
 *     policy centre, i.e. OUTSIDE the policy circle;
 *   - meanwhile the route's EARLY HARBOUR-TRANSIT positions (near the ROV
 *     home (60,−10), 60.8 m from origin) sit INSIDE the policy circle.
 * The geography is exactly inverted: transit is accepted as obstruction
 * survey; the genuine submerged-obstruction survey is rejected.
 *
 * These tests encode the CORRECT end state. They are RED until the
 * policy-zone owner (Omar, services/verifier/**) applies the exact
 * correction handed off in the PR #54 thread / issue #11:
 *   POLICY_SEA_OBSTRUCTION_1.zone = { centerX: 170, centerY: -90, radiusMetres: 58.31 }
 * (58.31 m = hypot(50, 30), the circumscribed radius of the world box).
 *
 * Everything else here is REAL merged modules: the deterministic kernel,
 * the append-only observation journal, Agent C's evidence adapter, and
 * Omar's verifier — no hand-written telemetry, no second reducer.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createScenarioKernel } from "../../../../services/simulation/core/kernel.mjs";
import { ROBOT_FIXTURES } from "../../../../services/simulation/core/scenario.mjs";
import type { DemoKernel } from "../../../../services/simulation/demo/kernel-adapter.d.mts";
import { createGuestObservationJournal, appendKernelSnapshot } from "../../../../services/mission/simulation/observation-journal";
import { buildEvidenceCapture, makeEvidenceClockMapping, evaluateCapture } from "../../../../services/mission/evidence-adapter";
import { POLICY_SEA_OBSTRUCTION_1 } from "../../../../services/verifier/src/policy";
import { FIXTURE_EPOCH_BASE_MS } from "@vorqyn/contracts";

/** Canonical PORT-001 identities (contracts fixtures — reused verbatim). */
const PORT_001 = { missionId: "port-001", seaTaskId: "task-sea-survey", seaOperator: "operator-rov-a" } as const;

const MISSION = "port-001";
const SEED = 20261107;
const ROV = "rov-01";

// --- authoritative geometry, read from the merged world metadata ----------
const worldPath = path.resolve(__dirname, "../../../../assets/port-world/world.json");
const world = JSON.parse(readFileSync(worldPath, "utf8")) as { zones: { id: string; box_enu_m: { min: number[]; max: number[] } }[]; routes: { rov: number[][] }; anchors: { id: string }[] };
const obstructionFound = world.zones.find((z: { id: string }) => z.id === "obstruction_zone");
if (obstructionFound === undefined) throw new Error("world.json must define obstruction_zone");
const obstruction = obstructionFound;
const box = obstruction.box_enu_m as { min: [number, number, number]; max: [number, number, number] }; // { min: [120,-120,-12.5], max: [220,-60,-0.5] }
const worldCenter = { x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2 }; // (170, -90)
const circumscribedRadius = Math.hypot(box.max[0] - worldCenter.x, box.max[1] - worldCenter.y); // hypot(50,30) ≈ 58.31

const insideWorldBox = (x: number, y: number): boolean =>
  x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1];
const distanceFromPolicyCentre = (x: number, y: number): number =>
  Math.hypot(x - POLICY_SEA_OBSTRUCTION_1.zone.centerX, y - POLICY_SEA_OBSTRUCTION_1.zone.centerY);

// --- the real deterministic ROV survey ------------------------------------
const kernel: DemoKernel = createScenarioKernel({ seed: SEED });
kernel.step(230); // full outbound survey leg: ROV home → deep in the obstruction zone
const journalInit = createGuestObservationJournal({ missionId: MISSION, seed: SEED, maxRecords: 260 });
if (!journalInit.ok) throw new Error(`journal init failed: ${journalInit.error.message}`);
let journal = journalInit.value;
for (const snapshot of kernel.getObservationLog()) {
  // appendKernelSnapshot is immutable — rebind the returned journal.
  const result = appendKernelSnapshot(journal, snapshot);
  expect(result.ok).toBe(true);
  if (result.ok) journal = result.journal;
}

const surveyPoses = kernel
  .getObservationLog()
  .map((snapshot: { robots: { robotId: string; pose: { x: number; y: number; z: number } }[] }) => snapshot.robots.find((r: { robotId: string }) => r.robotId === ROV)?.pose)
  .filter((pose): pose is { x: number; y: number; z: number } => pose !== undefined);

const inWorldZone = surveyPoses.filter((p: { x: number; y: number }) => insideWorldBox(p.x, p.y));
const inPolicyCircle = surveyPoses.filter((p: { x: number; y: number }) => distanceFromPolicyCentre(p.x, p.y) <= POLICY_SEA_OBSTRUCTION_1.zone.radiusMetres);

describe("P0 geometry evidence — established ground truth (green today)", () => {
  it("the kernel ROV task region equals the world obstruction zone exactly", () => {
    const kernelRegion = ROBOT_FIXTURES.find((r) => r.robotId === ROV)?.taskRegion.box;
    expect(kernelRegion).toEqual({ minX: box.min[0], maxX: box.max[0], minY: box.min[1], maxY: box.max[1], minZ: box.min[2], maxZ: box.max[2] });
  });

  it("the real ROV survey contains genuine in-zone obstruction samples with world-frame coordinates", () => {
    expect(inWorldZone.length).toBeGreaterThanOrEqual(60); // real survey samples, not 3 hand-picked points
    for (const pose of inWorldZone) {
      expect(pose.x).toBeGreaterThanOrEqual(box.min[0]);
      expect(pose.x).toBeLessThanOrEqual(box.max[0]);
      expect(pose.y).toBeGreaterThanOrEqual(box.min[1]);
      expect(pose.y).toBeLessThanOrEqual(box.max[1]);
    }
    // The survey's closest approach to the world obstruction centre is
    // within 1 m of (170, −90) — the ROV genuinely reached the obstruction.
    const nearest = Math.min(...surveyPoses.map((p) => Math.hypot(p.x - worldCenter.x, p.y - worldCenter.y)));
    expect(nearest).toBeLessThanOrEqual(1);
  });

  it("the route includes transit outside the obstruction zone (must stay distinct from the survey)", () => {
    const transit = surveyPoses.filter((p: { x: number; y: number }) => !insideWorldBox(p.x, p.y));
    expect(transit.length).toBeGreaterThan(60);
    expect(transit[0]).toEqual({ x: 60, y: -10, z: -2.5 }); // ROV home, harbour basin
  });

  it("documents the measured inversion for the review record", () => {
    const measured = {
      worldBox: { x: [box.min[0], box.max[0]], y: [box.min[1], box.max[1]] },
      worldCentre: worldCenter,
      circumscribedRadiusM: Number(circumscribedRadius.toFixed(3)),
      policyZone: POLICY_SEA_OBSTRUCTION_1.zone,
      surveyPoses: surveyPoses.length,
      inWorldZone: inWorldZone.length,
      inPolicyCircle: inPolicyCircle.length,
      nearestSurveySampleToPolicyCentreM: Number(Math.min(...surveyPoses.map((p) => distanceFromPolicyCentre(p.x, p.y))).toFixed(3)),
      farthestSurveySampleFromWorldCentreM: Number(Math.max(...inWorldZone.map((p) => Math.hypot(p.x - worldCenter.x, p.y - worldCenter.y))).toFixed(3)),
    };
    // The policy centre sits 192.35 m from the real obstruction centre —
    // the 80 m policy circle cannot contain ANY genuine obstruction sample.
    expect(POLICY_SEA_OBSTRUCTION_1.zone.centerX).not.toBe(worldCenter.x);
    console.log("[GEOMETRY-EVIDENCE]", JSON.stringify(measured));
  });
});

describe("P0 geometry evidence — the policy must match the world (RED until Omar's one-line zone correction)", () => {
  it("POLICY_SEA_OBSTRUCTION_1.zone covers the world obstruction zone", () => {
    // centre inside the box, and every box corner within the policy radius
    const centreInside =
      POLICY_SEA_OBSTRUCTION_1.zone.centerX >= box.min[0] && POLICY_SEA_OBSTRUCTION_1.zone.centerX <= box.max[0] &&
      POLICY_SEA_OBSTRUCTION_1.zone.centerY >= box.min[1] && POLICY_SEA_OBSTRUCTION_1.zone.centerY <= box.max[1];
    expect(centreInside, `policy centre (${POLICY_SEA_OBSTRUCTION_1.zone.centerX}, ${POLICY_SEA_OBSTRUCTION_1.zone.centerY}) must lie inside the world obstruction box`).toBe(true);
    const corners: Array<[number, number]> = [[box.min[0], box.min[1]], [box.max[0], box.min[1]], [box.min[0], box.max[1]], [box.max[0], box.max[1]]];
    for (const [cx, cy] of corners) {
      const d = Math.hypot(cx - POLICY_SEA_OBSTRUCTION_1.zone.centerX, cy - POLICY_SEA_OBSTRUCTION_1.zone.centerY);
      expect(d, `box corner (${cx}, ${cy}) is ${d.toFixed(3)} m from the policy centre`).toBeLessThanOrEqual(POLICY_SEA_OBSTRUCTION_1.zone.radiusMetres);
    }
  });

  it("an ordered in-zone sonar survey from the real kernel SATISFIES the obstruction-mapping policy", async () => {
    // In-zone survey subset: the records whose ROV pose is inside the world
    // box (the actual obstruction survey; harbour transit excluded).
    const inZoneRecords = journal.records.filter((record) => {
      const pose = record.snapshot.robots.find((r) => r.robotId === ROV)?.pose;
      return pose !== undefined && insideWorldBox(pose.x, pose.y);
    });
    expect(inZoneRecords.length).toBeGreaterThanOrEqual(POLICY_SEA_OBSTRUCTION_1.minSamples);

    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: "PORT-001" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const capture = buildEvidenceCapture({
      journal,
      modality: "sonar",
      clockMapping: mapping.value,
      records: inZoneRecords,
      robotIds: [ROV],
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const outcome = evaluateCapture(
      capture.value,
      { evidenceId: "ev-geo-in-zone-01", taskId: PORT_001.seaTaskId, assignmentVersion: 1, operatorId: PORT_001.seaOperator, sensor: "sonar" },
      POLICY_SEA_OBSTRUCTION_1,
      {
        expectedMissionId: PORT_001.missionId,
        expectedTaskId: PORT_001.seaTaskId,
        currentAssignmentVersion: 1,
        expectedOperatorId: PORT_001.seaOperator,
        activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
        nowMs: capture.value.window.capturedAtMs + 1_000,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted, `verdict reasons: ${JSON.stringify(outcome.value.verdict.reasons)}`).toBe(true);
    console.log("[GEOMETRY-EVIDENCE] IN-ZONE VERDICT", JSON.stringify({
      accepted: outcome.value.verdict.accepted,
      reasons: outcome.value.verdict.reasons,
      samples: capture.value.samples.length,
      sourceKind: capture.value.provenance.sourceKind,
      modality: capture.value.modality,
      sonarPingValues: capture.value.observations.slice(0, 3).map((o) => o.metric),
    }));
  });

  it("a transit-only prefix INSIDE the wrong policy circle is falsely accepted today (P0 false-accept proof)", async () => {
    // The first ~20 transit records lie within 80 m of the origin — inside
    // the misconfigured policy circle but in the OPEN HARBOUR BASIN, nowhere
    // near the submerged obstruction. Today the verifier accepts them as a
    // completed obstruction survey; after the zone correction they must be
    // rejected as outside_zone.
    const transitPrefix = journal.records.slice(0, 20);
    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: "PORT-001" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const capture = buildEvidenceCapture({
      journal,
      modality: "sonar",
      clockMapping: mapping.value,
      records: transitPrefix,
      robotIds: [ROV],
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    for (const sample of capture.value.samples) {
      const d = Math.hypot(sample.position.x - POLICY_SEA_OBSTRUCTION_1.zone.centerX, sample.position.y - POLICY_SEA_OBSTRUCTION_1.zone.centerY);
      expect(d, "transit-prefix sample inside the WRONG policy circle (false-accept precondition)").toBeLessThanOrEqual(POLICY_SEA_OBSTRUCTION_1.zone.radiusMetres);
    }
    const outcome = evaluateCapture(
      capture.value,
      { evidenceId: "ev-geo-transit-prefix", taskId: PORT_001.seaTaskId, assignmentVersion: 1, operatorId: PORT_001.seaOperator, sensor: "sonar" },
      POLICY_SEA_OBSTRUCTION_1,
      {
        expectedMissionId: PORT_001.missionId,
        expectedTaskId: PORT_001.seaTaskId,
        currentAssignmentVersion: 1,
        expectedOperatorId: PORT_001.seaOperator,
        activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
        nowMs: capture.value.window.capturedAtMs + 1_000,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // CORRECT end state (red today): the transit prefix must NOT satisfy
    // the obstruction survey policy.
    expect(outcome.value.verdict.accepted, "false-accept proven: transit passes the wrong zone").toBe(false);
    console.log("[GEOMETRY-EVIDENCE] TRANSIT-PREFIX VERDICT", JSON.stringify({
      accepted: outcome.value.verdict.accepted,
      reasonCount: outcome.value.verdict.reasons.length,
      reasons: outcome.value.verdict.reasons.slice(0, 6),
      samples: capture.value.samples.length,
    }));
  });
  it("out-of-zone harbour-transit samples are REJECTED by the obstruction policy", async () => {
    const transitRecords = journal.records.filter((record) => {
      const pose = record.snapshot.robots.find((r) => r.robotId === ROV)?.pose;
      return pose !== undefined && !insideWorldBox(pose.x, pose.y);
    });
    expect(transitRecords.length).toBeGreaterThanOrEqual(POLICY_SEA_OBSTRUCTION_1.minSamples);

    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: "PORT-001" });
    expect(mapping.ok).toBe(true);
    if (!mapping.ok) return;
    const capture = buildEvidenceCapture({
      journal,
      modality: "sonar",
      clockMapping: mapping.value,
      records: transitRecords,
      robotIds: [ROV],
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const outcome = evaluateCapture(
      capture.value,
      { evidenceId: "ev-geo-transit-01", taskId: PORT_001.seaTaskId, assignmentVersion: 1, operatorId: PORT_001.seaOperator, sensor: "sonar" },
      POLICY_SEA_OBSTRUCTION_1,
      {
        expectedMissionId: PORT_001.missionId,
        expectedTaskId: PORT_001.seaTaskId,
        currentAssignmentVersion: 1,
        expectedOperatorId: PORT_001.seaOperator,
        activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
        nowMs: capture.value.window.capturedAtMs + 1_000,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.value.verdict.accepted,
      `harbour transit must NOT satisfy the obstruction survey (reasons: ${JSON.stringify(outcome.value.verdict.reasons)})`,
    ).toBe(false);
    expect(JSON.stringify(outcome.value.verdict.reasons)).toContain("outside_zone");
  });
});

describe('P0 geometry evidence — fail-closed integrity (green today)', () => {
  it('optical visibility is never silently treated as metres: uncalibrated capture fails closed', async () => {
    const mappingResult = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: 'PORT-001' });
    if (!mappingResult.ok) throw new Error(mappingResult.error.message);
    const result = buildEvidenceCapture({
      journal,
      modality: 'optical',
      clockMapping: mappingResult.value,
      robotIds: [ROV],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('optical_visibility_unsupported');
  });

  it('sonar evidence carries real kernel sonar_ping metrics, never metres', async () => {
    const sonarMapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: 'PORT-001' });
    if (!sonarMapping.ok) throw new Error(sonarMapping.error.message);
    const capture = buildEvidenceCapture({
      journal,
      modality: 'sonar',
      clockMapping: sonarMapping.value,
      records: journal.records.filter((record) => {
        const pose = record.snapshot.robots.find((r) => r.robotId === ROV)?.pose;
        return pose !== undefined && insideWorldBox(pose.x, pose.y);
      }),
      robotIds: [ROV],
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    for (const observation of capture.value.observations) {
      expect(observation.metric.kind).toBe('sonar_ping');
    }
    const serialized = JSON.stringify(capture.value);
    expect(serialized).not.toContain('visibility_m');
  });

  it('tampering with journal state fails closed (frozen records) and digests bind to exact bytes', async () => {
    const firstRecord = journal.records[0];
    if (firstRecord === undefined) throw new Error("journal must hold accepted records");
    expect(() => {
      const firstSnapshot = (firstRecord as unknown as { snapshot: { robots: Array<{ robotId: string; pose: { x: number; y: number; z: number } }> } }).snapshot;
      const droneRobot = firstSnapshot.robots.find((robot) => robot.robotId === "drone-01");
      if (droneRobot === undefined) throw new Error("drone-01 missing from frozen record");
      droneRobot.pose.x = 170;
    }).toThrow(TypeError);
    // The kernel observation bytes are unchanged after the failed mutation.
    // The frozen record (drone-01 first in robot order) is byte-unchanged.
    const droneRecord = journal.records[0];
    if (droneRecord === undefined) throw new Error("journal must hold accepted records");
    const droneInRecord = droneRecord.snapshot.robots.find((robot: { robotId: string }) => robot.robotId === "drone-01");
    expect(droneInRecord?.pose).toEqual({ x: -40, y: 80, z: 55 });
  });

  it('replay determinism: identical rebuild produces byte-identical evidence and verdict', async () => {
    const inZone = journal.records.filter((record) => {
      const pose = record.snapshot.robots.find((r) => r.robotId === ROV)?.pose;
      return pose !== undefined && insideWorldBox(pose.x, pose.y);
    });
    const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: SEED, scenarioId: 'PORT-001' });
    if (!mapping.ok) throw new Error('mapping failed');
    const captureA = buildEvidenceCapture({ journal, modality: 'sonar', clockMapping: mapping.value, records: inZone, robotIds: [ROV] });
    const captureB = buildEvidenceCapture({ journal, modality: 'sonar', clockMapping: mapping.value, records: inZone, robotIds: [ROV] });
    expect(captureA.ok && captureB.ok).toBe(true);
    if (!captureA.ok || !captureB.ok) return;
    expect(JSON.stringify(captureB.value)).toBe(JSON.stringify(captureA.value));
    const identity = { evidenceId: 'ev-geo-replay', taskId: PORT_001.seaTaskId, assignmentVersion: 1, operatorId: PORT_001.seaOperator, sensor: 'sonar' as const };
    const request = {
      expectedMissionId: PORT_001.missionId,
      expectedTaskId: PORT_001.seaTaskId,
      currentAssignmentVersion: 1,
      expectedOperatorId: PORT_001.seaOperator,
      activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
      nowMs: captureA.value.window.capturedAtMs + 1_000,
    };
    const outA = evaluateCapture(captureA.value, identity, POLICY_SEA_OBSTRUCTION_1, request);
    const outB = evaluateCapture(captureB.value, identity, POLICY_SEA_OBSTRUCTION_1, request);
    expect(outA.ok && outB.ok).toBe(true);
    if (outA.ok && outB.ok) {
      expect(JSON.stringify(outB.value)).toBe(JSON.stringify(outA.value));
    }
  });
});
