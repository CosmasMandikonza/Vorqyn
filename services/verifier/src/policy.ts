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
  /** Max tolerated step between consecutive sample sequences. */
  readonly maxSequenceGap: number;
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
  policyVersion: 1,
  allowedOrigins: ["SYNTHETIC_SIM", "LIVE_SITL"],
  sensors: [
    { sensorId: "sonar", satisfiesOnItsOwn: true },
    {
      sensorId: "optical",
      satisfiesOnItsOwn: false,
      requiresMetric: { kind: "visibility_m", minMetres: 1.5 },
    },
  ],
  zone: { centerX: 0, centerY: 0, radiusMetres: 80 },
  minSamples: 3,
  maxSourceAgeMs: 120_000,
  maxSequenceGap: 1,
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
  maxSequenceGap: 1,
};

/** Active policy catalogue keyed by TaskConfig.acceptancePolicyId. */
export const POLICIES: Readonly<Record<string, EvidencePolicy>> = {
  [POLICY_SEA_OBSTRUCTION_1.policyId]: POLICY_SEA_OBSTRUCTION_1,
  [POLICY_STRUCTURAL_CERTIFICATION_1.policyId]: POLICY_STRUCTURAL_CERTIFICATION_1,
};

export function getPolicy(policyId: string): EvidencePolicy | undefined {
  return POLICIES[policyId];
}
