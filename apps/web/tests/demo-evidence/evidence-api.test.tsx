/**
 * VQ-DEMO-EVIDENCE/1 tests (issue #9 guest slice) — run through the REAL
 * Next.js route handler (`app/api/demo/evidence/route.ts`) executing the
 * REAL kernel → journal → evidence-adapter → verifier pipeline. No mocks.
 *
 * Mandatory proofs:
 *   1. Full Observation → Evidence → Policy → Verdict → Provenance journey
 *      for the canonical guest seed, with SYNTHETIC_SIM and
 *      DEMO EVIDENCE — NOT PAYMENT AUTHORIZATION labels.
 *   2. Determinism: identical body → byte-identical response (digest too).
 *   3. Authority scan: no lifecycle/payout/chain/signature keys anywhere.
 *   4. Calibration inputs are structurally rejected (unknown_field) — the
 *      optical modality stays UNAVAILABLE by default.
 *   5. The shipped policy zone geographic check is shown honestly: an
 *      out-of-zone window rejects with outside_zone; an in-zone window may
 *      accept, but only alongside kernel coverage counters proving the
 *      obstruction survey is NOT complete (no false success).
 *   6. Tampered records are rejected at this layer via the adapter's
 *      accepted-record integrity (record_content_mismatch).
 *   7. Bounded window and bounded response size regardless of trace length.
 *   8. Malformed/oversized/wrong-method/forged inputs are typed 4xx/422s.
 */

import { describe, expect, it } from "vitest";
import { POST, GET } from "@/app/api/demo/evidence/route";
import { deriveDemoEvidenceFromJournal } from "@/lib/demo-evidence/derive";
import {
  DEMO_EVIDENCE_NOTICE,
  EVIDENCE_DECISION_OFFSET_MS,
  EVIDENCE_ERROR_SCHEMA,
  EVIDENCE_RESPONSE_SCHEMA,
  EVIDENCE_WINDOW_SNAPSHOTS,
} from "@/lib/demo-evidence/contract";
import { REQUEST_SCHEMA } from "@/lib/demo-simulation/contract";
import {
  appendKernelSnapshot,
  createGuestObservationJournal,
} from "../../../../services/mission/simulation/observation-journal";
import { createScenarioKernel } from "../../../../services/simulation/demo/kernel-adapter.mjs";

const ROUTE = "http://localhost/api/demo/evidence";
const SEED = 20261107;
const MISSION = "guest-port-20261107";

function post(body: unknown): Promise<Response> {
  return POST(new Request(ROUTE, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
}

function stepBody(count: number): unknown {
  return { schema: REQUEST_SCHEMA, seed: SEED, operations: [{ op: "step", count }] };
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload.schema).toBe(EVIDENCE_ERROR_SCHEMA);
  const error = payload.error as Record<string, unknown>;
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  expect(JSON.stringify(payload)).not.toMatch(/at\s+\S+\(|node_modules|stack/i);
}

/** Recursively collect every object key in a parsed JSON value. */
function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
  return into;
}

describe("VQ-DEMO-EVIDENCE/1 — the judge journey", () => {
  it("returns Observation → Evidence → Policy → Verdict → Provenance with honest labels", async () => {
    const response = await post(stepBody(6));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.schema).toBe(EVIDENCE_RESPONSE_SCHEMA);
    expect(body.missionId).toBe(MISSION);
    expect(body.sourceKind).toBe("SYNTHETIC_SIM");
    expect(body.frameId).toBe("ENU_PORT-001_LOCAL");

    // Labels and measurement semantics.
    const labels = body.labels as Record<string, unknown>;
    expect(labels.sourceKind).toBe("SYNTHETIC_SIM");
    expect(labels.evidenceNotice).toBe(DEMO_EVIDENCE_NOTICE);
    const semantics = labels.measurementSemantics as Record<string, string>;
    expect(semantics.simulatorMeasurements).toMatch(/SYNTHETIC_SIM/);
    expect(semantics.testCalibration).toMatch(/unavailable|no test calibration/i);
    expect(semantics.genuinePhysicalMeasurements).toMatch(/none/i);

    // Clock domains: four separate domains, chain explicitly null.
    const clocks = body.clockDomains as Record<string, unknown>;
    expect(clocks.simulator).toMatch(/simulatorTimeMs/);
    expect(clocks.receipt).toMatch(/not UTC/);
    expect(clocks.capture).toMatch(/evidence-clock-mapping/);
    expect(clocks.decision).toBe(`capture domain: capture time + ${EVIDENCE_DECISION_OFFSET_MS} ms (deterministic)`);
    expect(clocks.chain).toBeNull();

    // Observation: real identities, bounded window, raw measurements.
    const observation = body.observation as Record<string, unknown>;
    expect(observation.recordsAccepted).toBe(6);
    const window = observation.windowReturned as Record<string, number>;
    expect(window).toEqual({ fromSequence: 1, toSequence: 6, snapshots: 6 });
    const sensors = observation.sensorsObserved as Array<Record<string, unknown>>;
    expect(sensors.length).toBe(6 * 4); // 3 robots + the ROV's second sensor, per snapshot
    const rovSonar = sensors.find((s) => s.sensorId === "rov-01-sonar");
    expect(rovSonar).toBeDefined();
    if (rovSonar) {
      expect(rovSonar.qualityUnits).toBe("unitless_0_to_1_fixture_model");
      expect(typeof rovSonar.quality01).toBe("number");
    }

    // Sonar evidence: evaluated by the shipped policy, in-zone here.
    const evidence = body.evidence as Record<string, unknown>;
    const sonar = evidence.sonar as Record<string, unknown>;
    expect(sonar.status).toBe("evaluated");
    expect(sonar.modality).toBe("sonar");
    expect(typeof sonar.captureId).toBe("string");
    expect(sonar.evidenceId).toBe("evg-guest-20261107-sonar-6");
    expect(sonar.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(sonar.sampleRefs)).toBe(true);
    const policy = sonar.policy as Record<string, unknown>;
    expect(policy.policyId).toBe("policy-sea-obstruction-sonar-1");
    expect(policy.policyVersion).toBe(1);
    const zone = policy.zone as Record<string, number>;
    expect(zone.radiusMetres).toBe(80);
    const zoneChecks = sonar.zoneChecks as Array<Record<string, unknown>>;
    expect(zoneChecks.length).toBe(6);
    expect(zoneChecks.every((check) => check.inside === true)).toBe(true);
    const verdict = sonar.verdict as Record<string, unknown>;
    expect(verdict.accepted).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.verifierId).toBe("verifier-vorqyn-lane1");
    const identity = sonar.identity as Record<string, unknown>;
    expect(identity.operatorId).toBe("operator-rov-b");
    expect(String(identity.note)).toMatch(/no authenticated operator/);

    // Optical evidence: UNAVAILABLE by default — no calibration exists.
    const optical = evidence.optical as Record<string, unknown>;
    expect(optical.status).toBe("unavailable");
    expect(optical.code).toBe("optical_visibility_unsupported");
    expect(String(optical.message)).toMatch(/unitless_0_to_1_fixture_model/);
    expect(optical).not.toHaveProperty("samples");
    expect(JSON.stringify(body)).not.toContain('"visibility_m":');

    // Truth labeling: a windowed acceptance is NEVER a completed survey.
    const interpretation = body.interpretation as Record<string, unknown>;
    expect(interpretation.obstructionSurveyComplete).toBe(false);
    const sonarCoverage = sonar.coverage as { modelCellsVisited: number; modelCellsTotal: number; coverage01: number };
    expect(sonarCoverage.modelCellsTotal).toBeGreaterThan(0);
    expect(sonarCoverage.modelCellsVisited).toBeLessThan(sonarCoverage.modelCellsTotal);
    expect(String(interpretation.note)).toMatch(/not the full obstruction survey/);
    expect(String(interpretation.note)).toMatch(/policy\/route alignment/);

    // Authority boundary: every authority bit explicitly false.
    const boundary = body.authorityBoundary as Record<string, unknown>;
    expect(boundary.missionLifecycleEvent).toBe(false);
    expect(boundary.walletAuthorization).toBe(false);
    expect(boundary.verifierAttestationSignature).toBe(false);
    expect(boundary.chainTransaction).toBe(false);
    expect(boundary.payoutAuthorization).toBe(false);
    expect(boundary.note).toBe(DEMO_EVIDENCE_NOTICE);
  });

  it("is deterministic: identical body → byte-identical response and digest", async () => {
    const first = await post(stepBody(6));
    const second = await post(stepBody(6));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = JSON.stringify(await first.json());
    const secondBody = JSON.stringify(await second.json());
    expect(firstBody).toBe(secondBody);
  });

  it("exposes no mission authority, payout, signature or chain concepts as keys", async () => {
    const response = await post(stepBody(4));
    const body = await response.json();
    const keys = collectKeys(body);
    for (const forbidden of ["evidenceAccepted", "payout", "attestation", "transactionSignature", "chainSignature", "verdictSignature", "wallet"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("rejects calibration inputs structurally (unknown_field) — no test calibration can masquerade as production evidence", async () => {
    await expectError(
      await post({
        schema: REQUEST_SCHEMA,
        seed: SEED,
        operations: [{ op: "step", count: 3 }],
        calibration: {
          schema: "vorqyn.visibility-calibration/1",
          calibrationId: "judge-smuggled",
          version: 1,
          sourceRef: "x",
          derivation: "y",
          inputKind: "unitless_quality01",
          points: [
            { quality01: 0, visibilityM: 0 },
            { quality01: 1, visibilityM: 100 },
          ],
        },
      }),
      400,
      "unknown_field",
    );
  });

  it("rejects a deep-trace sonar window honestly: outside_zone with measured distances", async () => {
    // 60 steps (5 legal ≤12-count step ops) put the ROV far along the
    // obstruction route, outside the shipped policy zone (centre (0,0),
    // r=80 m) — the geographic check must be shown, not hidden.
    const response = await post({
      schema: REQUEST_SCHEMA,
      seed: SEED,
      operations: [
        { op: "step", count: 12 },
        { op: "step", count: 12 },
        { op: "step", count: 12 },
        { op: "step", count: 12 },
        { op: "step", count: 12 },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const evidence = body.evidence as Record<string, unknown>;
    const sonar = evidence.sonar as Record<string, unknown>;
    expect(sonar.status).toBe("evaluated");
    const verdict = sonar.verdict as Record<string, unknown>;
    expect(verdict.accepted).toBe(false);
    expect((verdict.reasons as string[]).some((reason) => reason.startsWith("outside_zone:"))).toBe(true);
    const zoneChecks = sonar.zoneChecks as Array<Record<string, unknown>>;
    expect(zoneChecks.every((check) => check.inside === false)).toBe(true);
    const interpretation = body.interpretation as Record<string, unknown>;
    expect(interpretation.obstructionSurveyComplete).toBe(false);
  });

  it("bounds the capture window and response regardless of trace length", async () => {
    const response = await post({
      schema: REQUEST_SCHEMA,
      seed: SEED,
      operations: [
        { op: "step", count: 10 },
        { op: "step", count: 10 },
        { op: "step", count: 10 },
      ],
    });
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized.length).toBeLessThan(32 * 1024);
    const body = JSON.parse(serialized) as Record<string, unknown>;
    const observation = body.observation as Record<string, unknown>;
    expect(observation.recordsAccepted).toBe(30);
    expect(observation.windowReturned).toEqual({ fromSequence: 23, toSequence: 30, snapshots: EVIDENCE_WINDOW_SNAPSHOTS });
  });

  it("rejects a tampered record at this layer via the adapter's accepted-record integrity", () => {
    const kernel = createScenarioKernel({ seed: SEED });
    kernel.step(3);
    const created = createGuestObservationJournal({ missionId: MISSION, seed: SEED });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let journal = created.value;
    for (const snapshot of kernel.getObservationLog()) {
      const appended = appendKernelSnapshot(journal, snapshot);
      expect(appended.ok).toBe(true);
      if (!appended.ok) return;
      journal = appended.journal;
    }
    // A caller-supplied clone with altered sonar quality must never become
    // source evidence, even at this layer.
    const tampered = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = tampered[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const sonar = first.snapshot.robots.find((robot) => robot.robotId === "rov-01")?.sensors.find((sensor) => sensor.kind === "sonar");
    if (!sonar || sonar.measured === null) return;
    (sonar.measured as { quality01: number }).quality01 = 0.99;
    const response = deriveDemoEvidenceFromJournal(journal, SEED, tampered);
    const sonarOutcome = response.evidence.sonar;
    expect(sonarOutcome.status).toBe("capture_failed");
    if (sonarOutcome.status === "capture_failed") {
      expect(sonarOutcome.code).toBe("record_content_mismatch");
    }
    expect(response.evidence.optical.status).toBe("unavailable");
  });
});

describe("VQ-DEMO-EVIDENCE/1 — bounded, rate-safe, typed rejections", () => {
  it("rejects malformed JSON, wrong schema, oversized bodies and wrong methods with typed errors", async () => {
    await expectError(await post("{not json"), 400, "invalid_json");
    await expectError(await post({ schema: "someone-else/9", seed: SEED, operations: [] }), 400, "schema_unsupported");
    await expectError(await post({ schema: REQUEST_SCHEMA, seed: SEED, operations: [{ op: "step", count: 1 }, ...Array(120).fill({ op: "step", count: 1 })] }), 400, "too_many_operations");
    const oversized = JSON.stringify({ schema: REQUEST_SCHEMA, seed: SEED, operations: [{ op: "step", count: 1 }], padding: "x".repeat(20 * 1024) });
    await expectError(await post(oversized), 413, "payload_too_large");
    const getResponse = GET();
    await expectError(getResponse, 405, "method_not_allowed");
  });

  it("kernel-rejected forged commands stay typed 422s on this endpoint too", async () => {
    await expectError(
      await post({ schema: REQUEST_SCHEMA, seed: SEED, operations: [{ op: "command", command: { type: "pause", idempotencyKey: "forge", sourceKind: "LIVE_SITL" } }] }),
      422,
      "invalid_command_fields",
    );
  });
});
