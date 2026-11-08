/**
 * VORQYN evidence adapter — structured result type (issue #9 slice).
 *
 * The adapter is a boundary layer: its rejection codes describe ADAPTER
 * facts (no calibration, stream mismatch, paused snapshot, ...) that are
 * outside the shared contracts' ContractErrorCode vocabulary. It follows
 * the guest observation journal's precedent (services/mission/simulation/
 * observation-journal.ts `AppendResult`): a local, plain-string-code error
 * shape, structurally compatible with the contracts' `Result` reading
 * pattern (`ok` / `error.code` / `error.message`) without touching or
 * widening the shared contract.
 */

/** Structured rejection codes this adapter can return. */
export type EvidenceAdapterErrorCode =
  | "validation_error"
  | "no_records"
  | "optical_visibility_unsupported"
  | "calibration_not_applicable"
  | "calibration_domain_exceeded"
  | "mapping_stream_mismatch"
  | "cross_stream_contamination"
  | "provenance_mismatch"
  | "duplicate_or_regressed_sequence"
  | "non_monotonic_source_time"
  | "unsupported_kernel_state"
  | "ambiguous_sensor_modality"
  | "no_fresh_observations"
  | "sensor_modality_mismatch"
  | "sensor_metric_unavailable"
  | "decision_clock_domain_mismatch";

export interface EvidenceAdapterError {
  readonly code: EvidenceAdapterErrorCode;
  readonly message: string;
}

/** The adapter's own result shape (mirrors the contracts' Result reading pattern). */
export type EvidenceAdapterResult<T> = { ok: true; value: T } | { ok: false; error: EvidenceAdapterError };

export function adapterOk<T>(value: T): EvidenceAdapterResult<T> {
  return { ok: true, value };
}

export function adapterErr(code: EvidenceAdapterErrorCode, message: string): { ok: false; error: EvidenceAdapterError } {
  return { ok: false, error: { code, message } };
}
