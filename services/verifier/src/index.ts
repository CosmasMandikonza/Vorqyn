/**
 * @vorqyn/verifier — deterministic task-evidence verifier (VQ-10 / #11).
 *
 * Public surface:
 * - versioned evidence policies (typed sensor/origin/zone/freshness rules)
 * - deterministic, source-bound evidence digests (sha256 over canonical JSON)
 * - deterministic verdicts with measured rejection reasons (never
 *   default-accept on missing data; no LLM output qualifies)
 * - signable accepted attestations bound to the VQ-06 chain claim tuple
 *
 * Trust boundary: this package validates POLICY over NORMALIZED SOURCE
 * RECORDS. It does not attest physical/sensor truth; that responsibility
 * belongs to the independent registered verifier authority that signs.
 */

export * from "./policy";
export * from "./digest";
export * from "./verifier";
export * from "./attestation";
export * from "./fixtures";
