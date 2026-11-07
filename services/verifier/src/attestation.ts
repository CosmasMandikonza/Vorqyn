/**
 * Signable accepted attestations (VQ-10 / #11) — the bridge to VQ-06's
 * on-chain authorization path.
 *
 * An accepted verdict alone pays nothing: the INDEPENDENT verifier
 * authority (a key separate from AI, operators and mission owners; on
 * chain it must be registered in the program's VerifierRegistry) signs
 * the canonical attestation bytes. The attestation carries exactly the
 * tuple the Anchor program binds in `verify_and_claim`:
 *
 *   attestation field      → chain argument
 *   ────────────────────────────────────────────────
 *   digest                 → evidence_digest ([u8;32], hex here)
 *   policyVersion          → policy_version (must equal registry's)
 *   expiresAtMs            → attestation_expiry (must be strictly future)
 *   assignmentVersion      → expected_assignment_version (CAS)
 *   taskId / missionId     → PDA-bound accounts
 *   operatorPayoutWallet   → program-controlled payout destination
 *
 * Keys are NEVER committed: tests generate throwaway ed25519 pairs at
 * runtime via node:crypto and production keys live only in the verifier
 * operator's wallet. The chain currently requires the verifier to
 * CO-SIGN the claim transaction live; this artifact is the portable,
 * auditable form for the registry-integrated flow and for receipts.
 */

import {
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson, type EvidenceDigest, type MissionId, type TaskId } from "@vorqyn/contracts";
import type { OperatorId } from "@vorqyn/contracts";

export interface AcceptedAttestation {
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly assignmentVersion: number;
  readonly operatorId: OperatorId;
  /** Base58 payout wallet of the ASSIGNED operator (program-enforced). */
  readonly operatorPayoutWallet: string;
  readonly evidenceId: string;
  readonly digest: EvidenceDigest;
  readonly policyId: string;
  readonly policyVersion: number;
  /** Strictly-future unix ms; maps to the chain's attestation_expiry. */
  readonly expiresAtMs: number;
}

/** Runtime-generated throwaway key pair (tests / local demos only). */
export function generateVerifierKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

/** The exact bytes a verifier key signs — canonical JSON, UTF-8. */
export function canonicalAttestationBytes(attestation: AcceptedAttestation): Uint8Array {
  return new TextEncoder().encode(canonicalJson(attestation));
}

export function signAttestation(
  attestation: AcceptedAttestation,
  privateKey: KeyObject,
): Uint8Array {
  return ed25519Sign(null, canonicalAttestationBytes(attestation), privateKey);
}

export function verifyAttestationSignature(
  attestation: AcceptedAttestation,
  signature: Uint8Array,
  publicKey: KeyObject,
): boolean {
  return ed25519Verify(null, canonicalAttestationBytes(attestation), publicKey, signature);
}
