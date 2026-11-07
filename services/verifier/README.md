# @vorqyn/verifier — deterministic task-evidence verifier (VQ-10 / #11)

Off-chain underwriting for mission settlement: **versioned evidence
policies** judged over **normalized source telemetry**
(`@vorqyn/contracts` `TelemetrySample`), producing deterministic verdicts
with measured rejection reasons, **source-bound sha256 digests**, and
**signable accepted attestations** that map 1:1 onto the VQ-06 Anchor
claim path.

## What it does

| Piece | File | Notes |
| --- | --- | --- |
| Versioned policies | `src/policy.ts` | typed sensor/origin/zone/freshness/sequence/volume rules; `policyVersion` must equal the on-chain verifier registry's authoritative version |
| Deterministic verdicts | `src/verifier.ts` | fixed evaluation order; every rejection carries measured values (`visibility_m_below_min:worst=0.400:min=1.5`); missing data NEVER defaults to pass |
| Source-bound digest | `src/digest.ts` | sha256 over canonical JSON of the full binding (identity tuple + sensor + origin + capture clock + every sample); tamper-sensitive, replay-sensitive |
| Signable attestation | `src/attestation.ts` | ed25519 over canonical bytes; runtime-generated throwaway keys in tests, never committed; `toChainAttestationExpirySeconds()` is THE ms→s conversion for the chain boundary |
| Fixtures | `src/fixtures.ts` | **explicitly synthetic** PORT-001 evidence sets (ROV A optical low-visibility, ROV B sonar) |

## The flagship split (issue #11, tested)

- ROV A optical survey under the injected low-visibility fault
  (0.4 m < 1.5 m) → **rejected with measured values**.
- ROV B sonar after reassignment → **accepted** for
  `policy-sea-obstruction-sonar-1`.
- The same sonar evidence under `policy-structural-certification-1` →
  **rejected** (`sensor_not_permitted:sonar`): sonar qualifies for
  obstruction mapping ONLY, never structural certification.

## Review-hardened bindings (PR #49 review)

- The verification context is **authoritative for mission AND task** — a
  wholly foreign submission is rejected (`mission_mismatch` /
  `task_mismatch`), not just internally inconsistent samples.
- Freshness is two-layered: samples within the capture window AND the
  **capture itself within `maxCaptureAgeMs` of the decision clock**
  (`capture_stale`) — an internally consistent ancient capture is dead.
- **Sensor modality is source-backed**: the declared `sensor` label
  requires at least one sample carrying the policy's
  `backingMetricKind` (`sonar_ping` / `visibility_m`); relabeled
  evidence is rejected (`sensor_backing_missing`).
- The digest binds **evidenceId** too — reissued records never alias.
- Attestation↔chain conversion: `expiresAtMs` (unix **ms**) →
  `attestation_expiry` (unix **s**) via `toChainAttestationExpirySeconds`
  (floor; keep ≥1s headroom — the chain requires strictly-future).

## Trust boundary (read this before integrating)

1. **This module validates POLICY over SOURCE RECORDS.** It does not
   attest physical or sensor truth. The independent verifier authority —
   a key separate from AI, operators and mission owners, registered in
   the on-chain `VerifierRegistry` (VQ-06) — signs accepted attestations
   and owns the physical-truth responsibility.
2. **No LLM output qualifies as a verdict.** AI proposals (VQ-11) select
   operators; evidence acceptance is exclusively this deterministic
   policy engine + the verifier authority's signature.
3. **Synthetic ≠ real.** All current fixtures are `SYNTHETIC_SIM`
   evidence from the deterministic simulation kernel; `SourceKind` stays
   bound end-to-end and policies restrict allowed origins. Nothing here
   claims real-world sensor measurement.
4. **Chain mapping (VQ-06 `verify_and_claim`):**
   `digest → evidence_digest`, `policyVersion → policy_version` (must
   equal the registry's), `expiresAtMs → attestation_expiry` (strictly
   future), `assignmentVersion → expected_assignment_version` (CAS). The
   chain additionally requires the verifier to co-sign the claim
   transaction live and re-checks registry membership.

## Run

```bash
pnpm --filter @vorqyn/verifier typecheck
pnpm --filter @vorqyn/verifier test    # 23 tests
```

No runtime dependencies beyond `node:crypto` and the shared contracts.
