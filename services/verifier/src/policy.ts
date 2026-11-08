/**
 * VORQYN evidence policies — versioned, typed acceptance rules (VQ-10 / #11).
 *
 * A policy is the frozen rule set a task's evidence is judged against. It
 * references TaskConfig.acceptancePolicyId (packages/contracts fixtures),
 * carries a NUMERIC policyVersion that must equal the on-chain verifier
 * registry's authoritative version (VQ-06 security correction), and every
 * requirement is typed and measured: sensor, origin, quality metric,
 * coverage zone, freshness, sequence continuity and minimum sample count.
 *
 * TRUST BOUNDARY: policies judge NORMALIZED SOURCE RECORDS
 * (contracts TelemetrySample). They never invent measurements, never
 * consult an LLM, and never treat synthetic simulation evidence as
 * real-world sensor truth — SourceKind stays bound end-to-end.
 */

import type { SourceKind } from "@vorqyn/contracts";

export const VERIFIER_ID = "verifier-vorqyn-lane1" as const;
export const VERDICT_VERSION = "v1" as const;

/** Circular coverage zone in the mission's local ENU frame (metres). */
export interface PolicyZone {
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusMetres: number;
}

/** Measured-threshold rule on a sample's qualityMetric. */
export interface MetricRule {
  readonly kind: string;
  readonly minMetres: number;
}

/**
 * One acceptable evidence sensor and its acceptance condition.
 * `satisfiesOnItsOwn` sensors (e.g. sonar for obstruction mapping) pass
 * without a visibility metric; others (optical) must clear their metric.
 */
export interface EvidenceSensorRule {
  readonly sensorId: string;
  readonly satisfiesOnItsOwn: boolean;
  readonly requiresMetric?: MetricRule;
  /**
   * Metric kind that AUTHORITATIVELY backs this sensor modality in the
   * source records — a caller-provided `sensor` label alone never
   * qualifies (PR #49 review: modality must be source-backed).
   */
  readonly backingMetricKind?: string;
}

export interface EvidencePolicy {
  readonly policyId: string;
  /** Numeric version — MUST equal the chain registry's policy_version. */
  readonly policyVersion: number;
  /** Allowed telemetry origins (SYNTHETIC_SIM evidence never becomes
   * real-sensor truth; REPLAY evidence is only accepted where a policy
   * explicitly allows it). */
  readonly allowedOrigins: readonly SourceKind[];
  readonly sensors: readonly EvidenceSensorRule[];
  readonly zone: PolicyZone;
  readonly minSamples: number;
  /** Max age of a sample's source clock relative to capture time (ms). */
  readonly maxSourceAgeMs: number;
  /**
   * Max tolerated MISSING samples between consecutive sequence numbers
   * (CTO review P1-A): a step of N means N-1 missing samples; consecutive
   * sequences are 0-missing. A strict continuity policy uses 0.
   */
  readonly maxMissingSamples: number;
  /** Max age of the CAPTURE relative to the decision clock (ms) — the
   * whole capture must be fresh, not just internally consistent. */
  readonly maxCaptureAgeMs: number;
}

/**
 * Flagship policy — PORT-001 sea obstruction mapping
 * (TaskConfig.acceptancePolicyId "policy-sea-obstruction-sonar-1").
 *
 * Sonar satisfies on its own; optical only with measured visibility
 * ≥ 1.5 m — this is exactly the ROV A (optical, low visibility) reject /
 * ROV B (sonar) accept split of the flagship recovery loop.
 */
export const POLICY_SEA_OBSTRUCTION_1: EvidencePolicy = {
  policyId: "policy-sea-obstruction-sonar-1",
  /**
   * v2 — P0 geometry correction (issues #9/#14/#11): v1's coverage zone was
   * centred on the harbour origin (0,0) instead of the actual Pier C
   * obstruction, inverting acceptance (harbour transit accepted; the real
   * submerged survey rejected). v2 corrects the zone to the world-defined
   * obstruction. ON-CHAIN COORDINATION: the verifier registry's
   * policy_version must be advanced to 2 (registry admin, via
   * setPolicyVersionIx) before v2 claims are accepted; v1 claims cease.
   */
  policyVersion: 2,
  allowedOrigins: ["SYNTHETIC_SIM", "LIVE_SITL"],
  sensors: [
    {
      sensorId: "sonar",
      satisfiesOnItsOwn: true,
      backingMetricKind: "sonar_ping",
    },
    {
      sensorId: "optical",
      satisfiesOnItsOwn: false,
      requiresMetric: { kind: "visibility_m", minMetres: 1.5 },
      backingMetricKind: "visibility_m",
    },
  ],
  /**
   * Coverage zone anchored to the authoritative world geometry:
   * assets/port-world/world.json zones[id=obstruction_zone] box
   * x ∈ [120, 220], y ∈ [−120, −60] — centre (170, −90).
   *
   * APPROXIMATION (documented, tested): PolicyZone is CIRCULAR while the
   * world target is a RECTANGLE. r = 58.31 m = hypot(50, 30) is the
   * circumscribed radius covering the entire box from its centre; the
   * circle therefore also admits a thin margin of open water just outside
   * the box edges (max ~4.5 m beyond an edge mid-point). Real kernel ROV
   * samples can only originate on the survey route inside the box, so the
   * approximation is inert for genuine captures — asserted in
   * apps/web/tests/mission-geometry/policy-zone-alignment.test.tsx. Do not
   * broaden the radius further and do not treat the circle as exact box
   * equivalence.
   */
  zone: { centerX: 170, centerY: -90, radiusMetres: 58.31 },
  minSamples: 3,
  maxSourceAgeMs: 120_000,
  maxMissingSamples: 1,
  maxCaptureAgeMs: 300_000,
};

/**
 * Counter-policy proving scope restriction: structural certification is
 * optical-only — a sonar survey must NOT certify structure even with
 * perfect coverage (issue #11: sonar permitted for obstruction mapping
 * ONLY, not structural certification).
 */
export const POLICY_STRUCTURAL_CERTIFICATION_1: EvidencePolicy = {
  policyId: "policy-structural-certification-1",
  policyVersion: 1,
  allowedOrigins: ["SYNTHETIC_SIM", "LIVE_SITL"],
  sensors: [
    {
      sensorId: "optical",
      satisfiesOnItsOwn: false,
      requiresMetric: { kind: "visibility_m", minMetres: 1.5 },
    },
  ],
  zone: { centerX: 0, centerY: 0, radiusMetres: 80 },
  minSamples: 3,
  maxSourceAgeMs: 120_000,
  maxMissingSamples: 1,
  maxCaptureAgeMs: 300_000,
};

/** Active policy catalogue keyed by TaskConfig.acceptancePolicyId. */
export const POLICIES: Readonly<Record<string, EvidencePolicy>> = {
  [POLICY_SEA_OBSTRUCTION_1.policyId]: POLICY_SEA_OBSTRUCTION_1,
  [POLICY_STRUCTURAL_CERTIFICATION_1.policyId]: POLICY_STRUCTURAL_CERTIFICATION_1,
};

export function getPolicy(policyId: string): EvidencePolicy | undefined {
  return POLICIES[policyId];
}
