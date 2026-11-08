/**
 * VORQYN evidence adapter — explicit clock-domain mapping (issue #9 slice).
 *
 * Three separate clock domains meet at the evidence boundary, and the
 * verifier's freshness rules (services/verifier/src/verifier.ts) compare
 * capture time against sample source time arithmetically. This module
 * defines the ONLY supported way to put those domains on one comparable
 * axis, so a simulator-relative millisecond is never silently compared
 * against — or silently overwritten with — a Unix-epoch-shaped value
 * (the false `sample_stale` rejection class reported in PR #55):
 *
 * 1. SOURCE clock — the kernel's `simulatorTimeMs` (relative mission
 *    milliseconds, fixed 500 ms steps). Never a UTC claim; the raw value is
 *    preserved verbatim in every evidence capture observation.
 * 2. CAPTURE clock — epoch-shaped milliseconds on an explicitly anchored,
 *    versioned domain: `captureEpochBaseMs + sourceSimulatorTimeMs`. For
 *    SYNTHETIC_SIM sources the base is the contracts' documented
 *    FIXTURE_EPOCH_BASE_MS fixture domain (the same base the guest
 *    observation journal uses) — a deterministic fixture axis, NOT a claim
 *    of real UTC. A future real orchestrator re-bases the SAME algorithm on
 *    real receipt epochs without changing this contract.
 * 3. RECEIPT clock — the journal's per-record `receivedAtMs` (fixture epoch
 *    + append ordinal), deliberately NOT derived from simulator time; it is
 *    preserved verbatim on every evidence sample and never compared against
 *    the source or capture clocks by this adapter.
 *
 * The verifier's decision clock (`nowMs`) must be supplied by the caller on
 * the CAPTURE domain; `evaluateCapture` (submission.ts) refuses a decision
 * clock that precedes the capture instead of letting the verifier emit a
 * misleading `capture_stale:age_ms=<negative>` reason.
 *
 * The mapping is versioned and stream-bound: a mapping built for one seed/
 * scenario cannot map another stream's observations (cross-stream guard).
 * Mapping is strictly reversible (subtract the recorded base) and the raw
 * source time always travels alongside in the capture's observation audit.
 */

import { asEpochMs, asSimulatorTimeMs, type EpochMs } from "../../../packages/contracts/src/index";
import { adapterErr, adapterOk, type EvidenceAdapterResult } from "./errors";

/** Schema tag for the clock-mapping descriptor embedded in evidence captures. */
export const EVIDENCE_CLOCK_MAPPING_SCHEMA = "vorqyn.evidence-clock-mapping/1" as const;

/** The only mapping algorithm v1 supports (explicit, reviewed, reversible). */
export const CLOCK_MAPPING_ALGORITHM = "fixture_epoch_base_plus_source_ms" as const;

/** Source-stream identity a clock mapping is valid for. */
export interface EvidenceClockMappingSourceBinding {
  /** Kernel seed the mapping is bound to (uint32). */
  readonly seed: number;
  /** Kernel scenario the mapping is bound to (e.g. "PORT-001"). */
  readonly scenarioId: string;
}

/**
 * Explicit, versioned mapping from the kernel's relative source clock onto
 * the anchored capture-clock domain. Produced only by
 * `makeEvidenceClockMapping`; validated again at capture build time.
 */
export interface EvidenceClockMapping {
  readonly schema: typeof EVIDENCE_CLOCK_MAPPING_SCHEMA;
  readonly algorithm: typeof CLOCK_MAPPING_ALGORITHM;
  /** Capture-domain epoch anchor. FIXTURE_EPOCH_BASE_MS for synthetic guest evidence. */
  readonly captureEpochBaseMs: number;
  readonly sourceBinding: EvidenceClockMappingSourceBinding;
}

export interface MakeEvidenceClockMappingInput {
  /** Capture-domain epoch anchor (e.g. contracts FIXTURE_EPOCH_BASE_MS). */
  readonly captureEpochBaseMs: number;
  /** Kernel seed this mapping is valid for. */
  readonly seed: number;
  /** Kernel scenario this mapping is valid for (e.g. "PORT-001"). */
  readonly scenarioId: string;
}

/**
 * Construct and validate an explicit clock mapping. Rejects non-epoch bases
 * and non-uint32 seeds so a caller cannot anchor evidence to an undefined
 * clock domain.
 */
export function makeEvidenceClockMapping(input: MakeEvidenceClockMappingInput): EvidenceAdapterResult<EvidenceClockMapping> {
  const base = asEpochMs(input.captureEpochBaseMs);
  if (!base.ok) {
    return adapterErr("validation_error", `captureEpochBaseMs must be a non-negative safe integer epoch, got ${String(input.captureEpochBaseMs)}`);
  }
  const { seed, scenarioId } = input;
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) {
    return adapterErr("validation_error", "clock mapping seed must be an unsigned 32-bit integer");
  }
  if (typeof scenarioId !== "string" || scenarioId.trim().length === 0) {
    return adapterErr("validation_error", "clock mapping scenarioId must be a non-empty string");
  }
  return adapterOk({
    schema: EVIDENCE_CLOCK_MAPPING_SCHEMA,
    algorithm: CLOCK_MAPPING_ALGORITHM,
    captureEpochBaseMs: base.value,
    sourceBinding: { seed, scenarioId },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation for a mapping that arrived from outside this
 * module (e.g. rehydrated from stored capture bytes). Checks schema,
 * algorithm, epoch base and stream binding shape — the same rules
 * `makeEvidenceClockMapping` enforces at construction.
 */
export function validateEvidenceClockMapping(input: unknown): EvidenceAdapterResult<EvidenceClockMapping> {
  if (!isRecord(input)) return adapterErr("validation_error", "clock mapping must be an object");
  if (input.schema !== EVIDENCE_CLOCK_MAPPING_SCHEMA) {
    return adapterErr("validation_error", `clock mapping schema must be ${EVIDENCE_CLOCK_MAPPING_SCHEMA}, got ${String(input.schema)}`);
  }
  if (input.algorithm !== CLOCK_MAPPING_ALGORITHM) {
    return adapterErr("validation_error", `unsupported clock mapping algorithm ${String(input.algorithm)} — refusing to guess a conversion`);
  }
  const binding = input.sourceBinding;
  if (!isRecord(binding)) return adapterErr("validation_error", "clock mapping sourceBinding must be an object");
  return makeEvidenceClockMapping({
    captureEpochBaseMs: input.captureEpochBaseMs as number,
    seed: binding.seed as number,
    scenarioId: binding.scenarioId as string,
  });
}

/**
 * Map one kernel-relative source time onto the anchored capture domain.
 * The raw relative value remains the source of truth in capture
 * observations; this is the explicit, documented conversion the verifier's
 * freshness arithmetic requires. Refuses out-of-domain inputs (fail closed)
 * instead of clamping or extrapolating.
 */
export function mapSourceTimeToCaptureDomain(
  mapping: EvidenceClockMapping,
  sourceSimulatorTimeMs: number,
): EvidenceAdapterResult<EpochMs> {
  const source = asSimulatorTimeMs(sourceSimulatorTimeMs);
  if (!source.ok) {
    return adapterErr("validation_error", `sourceSimulatorTimeMs must be a non-negative safe integer, got ${String(sourceSimulatorTimeMs)}`);
  }
  const mapped = mapping.captureEpochBaseMs + source.value;
  if (!Number.isSafeInteger(mapped)) {
    return adapterErr("validation_error", `mapped capture time overflows the safe integer range (base ${mapping.captureEpochBaseMs} + source ${source.value})`);
  }
  return adapterOk(mapped as EpochMs);
}
