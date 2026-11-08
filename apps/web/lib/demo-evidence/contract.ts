/**
 * VQ-DEMO-EVIDENCE/1 — guest evidence-inspection contract (issue #9 slice).
 *
 * A read-only, stateless, bounded view over the MERGED evidence pipeline:
 * real kernel transport → accepted observation journal → evidence adapter
 * → existing verifier (services/verifier, unchanged). A judge submits the
 * SAME bounded `vorqyn.demo-sim/request/1` body as the other guest
 * endpoints and receives the full
 * Observation → Evidence → Policy → Verdict → Provenance chain for both
 * underwater modalities.
 *
 * TRUTH RULES (issue #9):
 * - every measurement is the kernel's own SYNTHETIC_SIM fixture output;
 * - NO visibility calibration ships, so optical `visibility_m` evidence is
 *   UNAVAILABLE by default (structured `optical_visibility_unsupported`);
 * - a windowed sonar verdict covers EXACTLY the captured window — the
 *   response always carries the kernel's own coverage counters and never
 *   labels a windowed acceptance as a completed obstruction survey
 *   (the flagship policy zone / route alignment is owned elsewhere);
 * - no mission lifecycle event, wallet authorization, verifier signature,
 *   chain transaction or payout exists in any response.
 */

import type { DemoOperation } from "@/lib/demo-simulation/contract";

export const EVIDENCE_RESPONSE_SCHEMA = "vorqyn.demo-evidence/response/1" as const;
export const EVIDENCE_ERROR_SCHEMA = "vorqyn.demo-evidence/error/1" as const;

/**
 * Bounded capture window: the most recent N accepted journal snapshots are
 * the evidence capture. Keeps responses bounded regardless of the 400-step
 * kernel budget; judges exploring a denser trace use
 * POST /api/demo/observations paging.
 */
export const EVIDENCE_WINDOW_SNAPSHOTS = 8 as const;

/** Deterministic guest decision offset on the capture clock domain (ms). */
export const EVIDENCE_DECISION_OFFSET_MS = 1000 as const;

/** Fixed fixture identity binding for the guest demo (documented, not authenticated). */
export const DEMO_IDENTITY_BINDING = Object.freeze({
  taskId: "task-sea-survey",
  assignmentVersion: 1,
  sonarOperatorId: "operator-rov-b",
  opticalOperatorId: "operator-rov-a",
  note: "fixture demo binding for the guest journey — no authenticated operator exists in this endpoint",
} as const);

export const DEMO_EVIDENCE_NOTICE = "DEMO EVIDENCE — NOT PAYMENT AUTHORIZATION" as const;

export interface DemoEvidenceLabels {
  readonly sourceKind: "SYNTHETIC_SIM";
  readonly evidenceNotice: typeof DEMO_EVIDENCE_NOTICE;
  readonly measurementSemantics: {
    readonly simulatorMeasurements: string;
    readonly testCalibration: string;
    readonly genuinePhysicalMeasurements: string;
  };
}

export interface DemoEvidenceAuthorityBoundary {
  readonly missionLifecycleEvent: false;
  readonly walletAuthorization: false;
  readonly verifierAttestationSignature: false;
  readonly chainTransaction: false;
  readonly payoutAuthorization: false;
  readonly note: string;
}

export interface DemoEvidenceClockDomains {
  readonly simulator: string;
  readonly receipt: string;
  readonly capture: string;
  readonly decision: string;
  readonly chain: null;
}

/** Compact raw kernel readings for the returned window (both modalities). */
export interface ObservedSensorMeasurement {
  readonly sequence: number;
  readonly robotId: string;
  readonly sensorId: string;
  readonly kind: string;
  readonly quality01: number | null;
  readonly qualityUnits: string | null;
  readonly opticalVisibilityFactorApplied: number | null;
  readonly coverage01: number;
}

export interface EvidencePolicyView {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly zone: { readonly centerX: number; readonly centerY: number; readonly radiusMetres: number };
  readonly minSamples: number;
  readonly maxSourceAgeMs: number;
  readonly maxCaptureAgeMs: number;
  readonly maxMissingSamples: number;
  readonly sonarBackingMetricKind: string;
  readonly opticalRequiresMetric: { readonly kind: string; readonly minMetres: number };
}

export interface EvidenceZoneCheck {
  readonly sequence: number;
  readonly distanceM: number;
  readonly radiusM: number;
  readonly inside: boolean;
}

export interface EvidenceCoverageView {
  readonly modelCellsVisited: number;
  readonly modelCellsTotal: number;
  readonly coverage01: number;
}

export interface EvaluatedModalityEvidence {
  readonly status: "evaluated";
  readonly modality: "sonar" | "optical";
  readonly captureId: string;
  readonly evidenceId: string;
  readonly digest: string;
  readonly sampleRefs: readonly string[];
  readonly window: {
    readonly fromSequence: number;
    readonly toSequence: number;
    readonly capturedAtMs: number;
    readonly sourceClockRaw: { readonly firstSourceSimulatorTimeMs: number; readonly lastSourceSimulatorTimeMs: number };
  };
  readonly identity: { readonly missionId: string; readonly taskId: string; readonly operatorId: string; readonly assignmentVersion: number; readonly note: string };
  readonly policy: EvidencePolicyView;
  readonly zoneChecks: readonly EvidenceZoneCheck[];
  readonly coverage: EvidenceCoverageView;
  readonly verdict: { readonly accepted: boolean; readonly reasons: readonly string[]; readonly verifierId: string; readonly decidedAtMs: number };
}

export interface UnavailableModalityEvidence {
  readonly status: "unavailable";
  readonly modality: "optical";
  readonly code: "optical_visibility_unsupported";
  readonly message: string;
}

export interface CaptureFailedModalityEvidence {
  readonly status: "capture_failed";
  readonly modality: "sonar" | "optical";
  readonly code: string;
  readonly message: string;
}

export type ModalityEvidence = EvaluatedModalityEvidence | UnavailableModalityEvidence | CaptureFailedModalityEvidence;

export interface DemoEvidenceInterpretation {
  readonly obstructionSurveyComplete: boolean;
  readonly note: string;
}

export interface DemoEvidenceResponse {
  readonly schema: typeof EVIDENCE_RESPONSE_SCHEMA;
  readonly scenarioId: string;
  readonly seed: number;
  readonly missionId: string;
  readonly sourceKind: "SYNTHETIC_SIM";
  readonly frameId: string;
  readonly positionUnits: string;
  readonly stepMs: number;
  readonly labels: DemoEvidenceLabels;
  readonly clockDomains: DemoEvidenceClockDomains;
  readonly observation: {
    readonly recordsAccepted: number;
    readonly windowReturned: { readonly fromSequence: number; readonly toSequence: number; readonly snapshots: number };
    readonly exclusionsByCode: Readonly<Record<string, number>>;
    readonly sensorsObserved: readonly ObservedSensorMeasurement[];
  };
  readonly evidence: {
    readonly sonar: ModalityEvidence;
    readonly optical: ModalityEvidence;
  };
  readonly interpretation: DemoEvidenceInterpretation;
  readonly authorityBoundary: DemoEvidenceAuthorityBoundary;
}

export interface DemoEvidenceError {
  readonly schema: typeof EVIDENCE_ERROR_SCHEMA;
  readonly error: { readonly code: string; readonly message: string };
}

/** Validated input for the journey (parsed by the shared DEMO-SIM parser). */
export interface DemoEvidenceInput {
  readonly seed: number;
  readonly operations: readonly DemoOperation[];
}
