/**
 * VQ-10 digest tests (issue #11 mandatory cases): determinism and tamper
 * sensitivity of the source-bound evidence digest.
 */

import { describe, expect, it } from "vitest";
import { computeEvidenceDigest, digestPayload, SUBMISSION_ROV_A_V1, SUBMISSION_ROV_B_V2 } from "./index";

describe("evidence digest", () => {
  it("hashes the same evidence deterministically", () => {
    const a = computeEvidenceDigest(SUBMISSION_ROV_A_V1);
    const b = computeEvidenceDigest(SUBMISSION_ROV_A_V1);
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different evidence", () => {
    expect(computeEvidenceDigest(SUBMISSION_ROV_A_V1)).not.toEqual(
      computeEvidenceDigest(SUBMISSION_ROV_B_V2),
    );
  });

  it("any tampered sample byte changes the digest", () => {
    const tampered = {
      ...SUBMISSION_ROV_A_V1,
      samples: SUBMISSION_ROV_A_V1.samples.map((s, i) =>
        i === 1 ? { ...s, position: { ...s.position, x: s.position.x + 0.001 } } : s,
      ),
    };
    expect(computeEvidenceDigest(tampered)).not.toEqual(computeEvidenceDigest(SUBMISSION_ROV_A_V1));
  });

  it("binds the assignment version into the digest (replay differs)", () => {
    const replay = { ...SUBMISSION_ROV_B_V2, assignmentVersion: 1 };
    expect(computeEvidenceDigest(replay)).not.toEqual(computeEvidenceDigest(SUBMISSION_ROV_B_V2));
  });

  it("binds the evidence identity into the digest (PR #49 finding 5)", () => {
    // Two otherwise-identical submissions with different evidence IDs are
    // DIFFERENT evidence records and must never share a digest.
    const renamed = { ...SUBMISSION_ROV_B_V2, evidenceId: "evid-rovb-v2-reissued" };
    expect(computeEvidenceDigest(renamed)).not.toEqual(computeEvidenceDigest(SUBMISSION_ROV_B_V2));
    expect(digestPayload(SUBMISSION_ROV_B_V2)).toContain('"evidenceId":"evid-rovb-v2"');
  });

  it("payload is canonical (key order stable, no wall clock)", () => {
    expect(digestPayload(SUBMISSION_ROV_B_V2)).toEqual(digestPayload(SUBMISSION_ROV_B_V2));
    expect(digestPayload(SUBMISSION_ROV_B_V2)).not.toContain("receivedAtMs"); // receipt clock excluded — source-bound only
  });
});
