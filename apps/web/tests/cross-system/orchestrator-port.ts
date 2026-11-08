/** QA adapter contract only. Agent A binds these calls to the real implementation; no in-memory substitute supplied here. */
import type { MissionEvent, Result } from "@vorqyn/contracts";
export interface IntegrationStore {
  append(
    events: readonly unknown[],
    expectedLastSequence: number,
  ): Promise<Result<unknown>>;
  read(missionId: string): Promise<readonly MissionEvent[]>;
  restart(): Promise<void>;
  /** Must enter the actual untrusted observation ingestion path, not a privileged event append. */
  ingestObservation(
    missionId: string,
    record: unknown,
  ): Promise<Result<unknown>>;
  close(): Promise<void>;
}
export interface OrchestratorDriver {
  /** Fresh isolated durable backing per call, retained through restart; dispose only this test's data on close. */
  createIntegrationStore(): Promise<IntegrationStore>;
}
