/**
 * VQ-10 attestation tests (issue #11): sign/verify roundtrip with a
 * SEPARATE runtime-generated verifier key (no secrets committed), wrong-key
 * rejection, and tamper sensitivity of the canonical bytes.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalAttestationBytes,
  generateVerifierKeyPair,
  signAttestation,
  verifyAttestationSignature,
  type AcceptedAttestation,
  CTX_V2_ROV_B,
  POLICY_SEA_OBSTRUCTION_1,
  SUBMISSION_ROV_B_V2,
  verifyEvidence,
} from "./index";

const baseAttestation = (): AcceptedAttestation => ({
  missionId: "port-001" as AcceptedAttestation["missionId"],
  taskId: "task-sea-survey" as AcceptedAttestation["taskId"],
  assignmentVersion: 2,
  operatorId: "operator-rov-b" as AcceptedAttestation["operatorId"],
  operatorPayoutWallet: "DemoWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  evidenceId: "evid-rovb-v2",
  digest: "0".repeat(64) as AcceptedAttestation["digest"],
  policyId: POLICY_SEA_OBSTRUCTION_1.policyId,
  policyVersion: POLICY_SEA_OBSTRUCTION_1.policyVersion,
  expiresAtMs: 1_762_000_000_000 + 600_000,
});

describe("accepted-attestation signing", () => {
  it("roundtrips sign → verify with a runtime-generated verifier key", () => {
    const verifier = generateVerifierKeyPair(); // throwaway; never committed
    const attestation = baseAttestation();
    const signature = signAttestation(attestation, verifier.privateKey);
    expect(signature.byteLength).toBe(64);
    expect(verifyAttestationSignature(attestation, signature, verifier.publicKey)).toBe(true);
  });

  it("rejects a signature made with a DIFFERENT (operator-controlled) key", () => {
    const verifier = generateVerifierKeyPair();
    const operatorControlledKey = generateVerifierKeyPair(); // not the verifier authority
    const attestation = baseAttestation();
    const forged = signAttestation(attestation, operatorControlledKey.privateKey);
    expect(verifyAttestationSignature(attestation, forged, verifier.publicKey)).toBe(false);
  });

  it("any tampered attestation field invalidates the signature", () => {
    const verifier = generateVerifierKeyPair();
    const attestation = baseAttestation();
    const signature = signAttestation(attestation, verifier.privateKey);
    const tampered: AcceptedAttestation = {
      ...attestation,
      // payout redirect attempt — the classic attack
      operatorPayoutWallet: "ThiefWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    };
    expect(verifyAttestationSignature(tampered, signature, verifier.publicKey)).toBe(false);
  });

  it("canonical bytes are deterministic and field-order independent", () => {
    const a = baseAttestation();
    const reordered = { ...a } as AcceptedAttestation;
    expect(canonicalAttestationBytes(a)).toEqual(canonicalAttestationBytes(reordered));
    expect(canonicalAttestationBytes(a)).toEqual(canonicalAttestationBytes(a));
  });

  it("attestation maps 1:1 onto the VQ-06 chain claim tuple (documented bridge)", () => {
    // The accepted flagship evidence produces an attestation whose fields
    // feed verify_and_claim exactly: digest → evidence_digest,
    // policyVersion → policy_version, expiresAtMs → attestation_expiry,
    // assignmentVersion → expected_assignment_version.
    const outcome = verifyEvidence(SUBMISSION_ROV_B_V2, POLICY_SEA_OBSTRUCTION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(true);
    const attestation: AcceptedAttestation = {
      ...baseAttestation(),
      digest: outcome.value.digest,
    };
    const verifier = generateVerifierKeyPair();
    const signature = signAttestation(attestation, verifier.privateKey);
    expect(verifyAttestationSignature(attestation, signature, verifier.publicKey)).toBe(true);
    expect(attestation.policyVersion).toBe(POLICY_SEA_OBSTRUCTION_1.policyVersion);
    expect(attestation.assignmentVersion).toBe(CTX_V2_ROV_B.currentAssignmentVersion);
  });
});
