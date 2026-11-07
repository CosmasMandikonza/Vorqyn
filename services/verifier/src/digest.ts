/**
 * Source-bound evidence digests (VQ-10 / #11).
 *
 * The digest is sha256 over the canonical JSON of the FULL evidence
 * binding: identity tuple (mission/task/version/operator), the sensor and
 * origin, the capture clock, and every normalized source sample that was
 * judged. Same input → same digest (deterministic hashing is tested);
 * any tampered byte in any sample → different digest (tested). The hex
 * string is the contracts `EvidenceDigest` and maps 1:1 to the chain's
 * `evidence_digest: [u8; 32]` claim argument in verify_and_claim.
 */

import { createHash } from "node:crypto";
import { canonicalJson, type EvidenceDigest } from "@vorqyn/contracts";
import type { EvidenceSubmission } from "./verifier";

/** The exact byte payload that gets hashed — exported for tests and audit. */
export function digestPayload(submission: EvidenceSubmission): string {
  return canonicalJson({
    missionId: submission.missionId,
    taskId: submission.taskId,
    assignmentVersion: submission.assignmentVersion,
    operatorId: submission.operatorId,
    sensor: submission.sensor,
    simulatorSource: submission.simulatorSource,
    capturedAtMs: submission.capturedAtMs,
    samples: submission.samples.map((s) => ({
      missionId: s.missionId,
      robotId: s.robotId,
      sourceKind: s.sourceKind,
      sourceTimestampMs: s.sourceTimestampMs,
      frameId: s.frameId,
      sequence: s.sequence,
      position: { x: s.position.x, y: s.position.y, z: s.position.z },
      units: s.units,
      quality: s.quality,
      ...(s.qualityMetric !== undefined ? { qualityMetric: s.qualityMetric } : {}),
    })),
  });
}

export function computeEvidenceDigest(submission: EvidenceSubmission): EvidenceDigest {
  return createHash("sha256").update(digestPayload(submission), "utf8").digest("hex") as EvidenceDigest;
}
