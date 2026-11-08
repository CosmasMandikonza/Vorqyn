/**
 * Shared harness for the evidence-adapter tests (issue #9 slice).
 *
 * Every value in these tests originates from a REAL deterministic kernel
 * run (never hand-invented telemetry) or from the contracts' documented
 * fixture constants. The one deliberate synthetic value is the TEST-ONLY
 * visibility calibration, clearly labelled as such — no calibration ships
 * in the adapter (see services/mission/evidence-adapter/README.md §1).
 */

import { FIXTURE_EPOCH_BASE_MS } from "@vorqyn/contracts";
import {
  appendKernelSnapshot,
  createGuestObservationJournal,
  type ObservationJournal,
} from "../../../../services/mission/simulation/observation-journal";
import { makeEvidenceClockMapping, type EvidenceClockMapping } from "../../../../services/mission/evidence-adapter";
import {
  createScenarioKernel,
  type DemoKernel,
} from "../../../../services/simulation/demo/kernel-adapter.mjs";
import type { DemoSnapshot } from "../../../../services/simulation/demo/kernel-adapter.d.mts";

/** The canonical deterministic demo seed (same as the committed sample run). */
export const DEMO_SEED = 20261107;

/** Flagship fixture mission identity (contracts fixtures, PORT-001 sea task). */
export const MISSION_ID = "port-001";
export const SEA_TASK_ID = "task-sea-survey";
export const OPERATOR_ROV_A = "operator-rov-a"; // optical operator (flagship loop)
export const OPERATOR_ROV_B = "operator-rov-b"; // sonar operator (flagship loop)

/** Capture-domain anchor: the contracts' documented fixture epoch base. */
export const CAPTURE_BASE_MS = FIXTURE_EPOCH_BASE_MS;

/** Demo stream clock mapping, bound to the demo seed + scenario. */
export const DEMO_MAPPING: EvidenceClockMapping = (() => {
  const mapping = makeEvidenceClockMapping({
    captureEpochBaseMs: CAPTURE_BASE_MS,
    seed: DEMO_SEED,
    scenarioId: "PORT-001",
  });
  if (!mapping.ok) throw new Error(`harness mapping must be valid: ${mapping.error.message}`);
  return mapping.value;
})();

/**
 * TEST-ONLY visibility calibration fixture (never shipped as a default):
 * documented linear anchor scale quality01 → metres. Clean ROV optical
 * baseline 0.71 ≙ 2.414 m (clears the policy's 1.5 m bar); the kernel's
 * severe fault factor 0.12 maps to ≈ 0.29 m (far below it).
 */
export const TEST_CALIBRATION = {
  schema: "vorqyn.visibility-calibration/1",
  calibrationId: "cal-test-fixture-1",
  version: 1,
  sourceRef:
    "TEST-ONLY fixture for apps/web/tests/evidence-adapter — the repository contains no physical visibility calibration (services/mission/evidence-adapter/README.md §1)",
  derivation:
    "TEST-ONLY: linear scale visibility_m = 3.4 x quality01, anchored so the kernel rov-01-optical clean baseline 0.71 corresponds to 2.414 m and the severe fault factor 0.12 maps to about 0.29 m. Not a physical calibration; demonstrates the calibrated path only.",
  inputKind: "unitless_quality01",
  points: [
    { quality01: 0, visibilityM: 0 },
    { quality01: 1, visibilityM: 3.4 },
  ],
} as const;

export interface KernelRun {
  readonly kernel: DemoKernel;
  readonly snapshots: readonly DemoSnapshot[];
}

/** Run a real deterministic kernel script and collect its observation log. */
export function runKernel(script: (kernel: DemoKernel) => void, seed: number = DEMO_SEED): KernelRun {
  const kernel = createScenarioKernel({ seed });
  script(kernel);
  return { kernel, snapshots: [...kernel.getObservationLog()] };
}

/** Append every snapshot to a fresh guest journal (harness asserts acceptance). */
export function journalFromSnapshots(missionId: string, snapshots: readonly DemoSnapshot[], seed: number = DEMO_SEED): ObservationJournal {
  const created = createGuestObservationJournal({ missionId, seed });
  if (!created.ok) throw new Error(`harness journal must be valid: ${created.error.message}`);
  let journal = created.value;
  for (const snapshot of snapshots) {
    const appended = appendKernelSnapshot(journal, snapshot);
    if (!appended.ok) throw new Error(`harness append must succeed: ${appended.error.message} (seq ${String(snapshot.sequence)})`);
    journal = appended.journal;
  }
  return journal;
}

/** Standard verifier decision clock: capture time + 1 s, on the capture domain. */
export const DECISION_OFFSET_MS = 1000;
