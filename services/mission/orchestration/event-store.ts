/**
 * VORQYN mission event store — canonical orchestration seam (issue #14).
 *
 * A per-mission, append-only, CAS-guarded repository over the AUTHORITATIVE
 * shared contracts. This module owns NO state machine of its own: every
 * transition decision comes from `packages/contracts` primitives —
 * `validateMissionEvent`, `initMissionProjection`, `applyEvent` — and the
 * only "state" it exposes is the reducer's own `MissionProjection`.
 *
 * Guarantees:
 * - mission isolation: events are bucketed by `event.missionId`; an event
 *   whose missionId differs from the requested stream is rejected
 *   (`cross_mission_reference`) and can never touch another bucket;
 * - append-only history: accepted events are persisted through the storage
 *   adapter BEFORE the acknowledgement and are never edited or reordered;
 * - CAS: the caller declares `expectedLastSequence`; a mismatch rejects
 *   with `stale_cas` before any reducer work, so two racing writers cannot
 *   both claim the same version (per-mission queues serialize appends and
 *   the loser observes the winner's sequence);
 * - sequence integrity: `event.sequence` must be exactly
 *   `lastSequence + 1` — gaps (`sequence_gap`) and regressions
 *   (`stale_cas`) are rejected, never healed;
 * - idempotency: the reducer's own rules apply — an exact duplicate event
 *   acknowledges `duplicate: true` WITHOUT changing history, a tampered
 *   duplicate and a reused `commandId` with different content are
 *   rejected;
 * - bounded storage: missions per store, events per mission and canonical
 *   bytes per event are all capped;
 * - deterministic replay: `replay` rebuilds the projection from the stored
 *   history through the same contracts primitives and reports whether it
 *   matches the live projection byte-for-byte (canonicalJson).
 *
 * Authority boundary: a synthetic observation is observational data, never
 * proof of mission state. This store does not fabricate events, verdicts,
 * chain confirmations or payouts; `task.paymentConfirmed` remains gated by
 * the reducer's confirmed-chain prerequisites (see reducer.ts). Clock
 * domains stay distinct because events are stored verbatim — the store
 * never invents or rewrites occurredAt/observedAt/simulatorTimeMs/
 * chainTimeMs.
 *
 * Storage honesty: the default adapter keeps history in memory. The file
 * adapter (`file-event-log.ts`) provides real LOCAL durable files with
 * restart/replay proof. Neither is cloud/serverless persistence; neither
 * claims to be.
 */

import {
  applyEvent,
  canonicalJson,
  initMissionProjection,
  rehydrate,
  validateMissionEvent,
  type MissionEvent,
  type MissionProjection,
  type Result,
} from "../../../packages/contracts/src/index";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Reload-only bucket seeding, registered per store instance by the factory
 * for the durable adapters (see seedMissionBucket below). Replay-only.
 */
const seeders = new WeakMap<
  MissionEventStore,
  (seed: { missionId: string; projection: MissionProjection; lastSequence: number; eventCount: number }) => void
>();

export interface MissionEventStoreLimits {
  /** Distinct missions allowed in one store. */
  readonly maxMissions: number;
  /** Maximum accepted events per mission. */
  readonly maxEventsPerMission: number;
  /** Maximum canonical-JSON byte size per event. */
  readonly maxEventCanonicalBytes: number;
}

export const DEFAULT_MISSION_EVENT_STORE_LIMITS: Readonly<MissionEventStoreLimits> = Object.freeze({
  maxMissions: 64,
  maxEventsPerMission: 10000,
  maxEventCanonicalBytes: 65536,
});

const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

// ---------------------------------------------------------------------------
// Storage seam
// ---------------------------------------------------------------------------

/**
 * Durable-storage seam. The in-memory adapter is the default (test/replay);
 * the file adapter in file-event-log.ts provides real local durability.
 * Implementations must append atomically per batch and return events in
 * stored order — the store relies on both for restart replay.
 */
export interface MissionEventLogStorage {
  /** Durably append the events, in order, to the mission's history. */
  appendEvents(missionId: string, events: readonly MissionEvent[]): Promise<void>;
  /** Read the full stored history, in stored order. */
  readAll(missionId: string): Promise<readonly MissionEvent[]>;
}

export class InMemoryMissionEventLogStorage implements MissionEventLogStorage {
  private readonly logs = new Map<string, MissionEvent[]>();

  async appendEvents(missionId: string, events: readonly MissionEvent[]): Promise<void> {
    const existing = this.logs.get(missionId);
    this.logs.set(missionId, [...(existing ?? []), ...events]);
  }

  async readAll(missionId: string): Promise<readonly MissionEvent[]> {
    return [...(this.logs.get(missionId) ?? [])];
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface AppendAccepted {
  readonly ok: true;
  /** True when the exact event was already applied (idempotent replay). */
  readonly duplicate: boolean;
  /** The store's last applied sequence after this operation. */
  readonly lastSequence: number;
}

export interface AppendRejected {
  readonly ok: false;
  /** Contracts-style typed error. Reducer codes pass through; store-level
   * codes: stale_cas, sequence_gap, cross_mission_reference, mission_full,
   * event_too_large, too_many_missions, storage_write_failed. */
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type AppendResult = AppendAccepted | AppendRejected;

export interface MissionEventStoreLimitsInput {
  readonly maxMissions?: number;
  readonly maxEventsPerMission?: number;
  readonly maxEventCanonicalBytes?: number;
}

export interface MissionEventStore {
  readonly limits: MissionEventStoreLimits;
  /**
   * Append one contract-validated event to a mission's history.
   * `expectedLastSequence` is the caller's declared view of the last applied
   * sequence (0 for an empty mission); a mismatch is a `stale_cas` rejection.
   * Concurrent appends to the same mission are serialized; exactly one
   * writer wins a given expected sequence.
   */
  append(
    missionId: string,
    event: MissionEvent,
    expectedLastSequence: number,
  ): Promise<AppendResult>;
  /** Deep-copied reducer projection, or null for an unknown mission. */
  projection(missionId: string): MissionProjection | null;
  /** Canonical serialization of the live projection (deterministic). */
  projectionCanonical(missionId: string): string | null;
  /** Last applied sequence, or null when the mission has no events. */
  lastSequence(missionId: string): number | null;
  /** Stored events, oldest first (paged). */
  readEvents(
    missionId: string,
    page?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<readonly MissionEvent[]>;
  /** Number of stored events for the mission. */
  eventCount(missionId: string): number;
  /**
   * Rebuild the projection from STORAGE through the same contracts
   * primitives (`rehydrate`) and report whether it matches the live
   * projection byte-for-byte.
   */
  replay(missionId: string): Promise<Result<{ readonly rehydratedEvents: number; readonly matchesLiveProjection: boolean }>>;
}

interface MissionBucket {
  projection: MissionProjection | null;
  lastSequence: number;
  eventCount: number;
  /** Serializes concurrent appends for this mission. */
  queue: Promise<unknown>;
}

export function createMissionEventStore(options: {
  storage?: MissionEventLogStorage;
  limits?: MissionEventStoreLimitsInput;
} = {}): MissionEventStore {
  const storage: MissionEventLogStorage = options.storage ?? new InMemoryMissionEventLogStorage();
  const limits: MissionEventStoreLimits = {
    maxMissions: options.limits?.maxMissions ?? DEFAULT_MISSION_EVENT_STORE_LIMITS.maxMissions,
    maxEventsPerMission: options.limits?.maxEventsPerMission ?? DEFAULT_MISSION_EVENT_STORE_LIMITS.maxEventsPerMission,
    maxEventCanonicalBytes:
      options.limits?.maxEventCanonicalBytes ?? DEFAULT_MISSION_EVENT_STORE_LIMITS.maxEventCanonicalBytes,
  };

  const buckets = new Map<string, MissionBucket>();

  /**
   * Reload-only bucket seeding, registered per store instance for the
   * durable adapters (see seedMissionBucket below). Replay-only: re-derives
   * nothing from storage writes and never accepts new events.
   */
  function reject(code: string, message: string): AppendRejected {
    return { ok: false, error: { code, message } };
  }

  /** Run one append serialized behind the mission's queue. */
  function performAppend(missionId: string, event: MissionEvent, expectedLastSequence: number): Promise<AppendResult> {
    const bucket = buckets.get(missionId);
    const previousTurn = bucket?.queue ?? Promise.resolve();
    const turn = previousTurn.then(() => appendTurn(missionId, event, expectedLastSequence));
    if (bucket !== undefined) {
      // Keep the queue alive even when a turn rejects.
      bucket.queue = turn.catch(() => undefined);
    } else {
      // First turn for a brand-new bucket (created inside appendTurn).
      buckets.set(missionId, {
        projection: null,
        lastSequence: 0,
        eventCount: 0,
        queue: turn.catch(() => undefined),
      });
    }
    return turn;
  }

  async function appendTurn(missionId: string, event: MissionEvent, expectedLastSequence: number): Promise<AppendResult> {
    let bucket = buckets.get(missionId);
    if (bucket === undefined) {
      bucket = { projection: null, lastSequence: 0, eventCount: 0, queue: Promise.resolve() };
      buckets.set(missionId, bucket);
    }

    if (!MISSION_ID_PATTERN.test(missionId)) {
      return reject("validation_error", `missionId ${JSON.stringify(missionId)} does not satisfy the contracts ID rule`);
    }
    if (typeof expectedLastSequence !== "number" || !Number.isSafeInteger(expectedLastSequence) || expectedLastSequence < 0) {
      return reject("validation_error", "expectedLastSequence must be a non-negative safe integer");
    }
    // Structural validation first: unknown kinds/versions/schemas never touch
    // the projection (validateMissionEvent is the contracts boundary).
    const validated = validateMissionEvent(event);
    if (!validated.ok) {
      return reject(validated.error.code, validated.error.message);
    }
    // Mission isolation: the event must belong to the requested stream.
    if (validated.value.missionId !== missionId) {
      return reject(
        "cross_mission_reference",
        `event ${validated.value.eventId} targets mission ${validated.value.missionId}, not ${missionId}`,
      );
    }

    // Authoritative transition work happens FIRST, in the contracts reducer:
    // duplicate detection (idempotent vs tampered), sequence integrity and
    // transition legality are all reducer decisions, evaluated on a CLONE.
    let nextState: MissionProjection;
    if (bucket.projection === null) {
      const initialized = initMissionProjection(validated.value);
      if (!initialized.ok) {
        return reject(initialized.error.code, initialized.error.message);
      }
      nextState = initialized.value;
    } else {
      const applied = applyEvent(bucket.projection, validated.value);
      if (!applied.ok) {
        // A brand-new eventId whose sequence is not head+1 is precisely a
        // racing writer whose expectation went stale: report stale_cas (its
        // clone is discarded). Genuine gaps (sequence beyond head+1) keep
        // the reducer's validation_error; tampered duplicates keep
        // duplicate_event; everything else passes through verbatim.
        if (applied.error.code === "duplicate_sequence") {
          return reject(
            "stale_cas",
            `caller expectation is stale: ${applied.error.message}`,
          );
        }
        return reject(applied.error.code, applied.error.message);
      }
      if (applied.duplicate === true) {
        // Idempotent replay of an identical event: acknowledge WITHOUT
        // touching the append-only history. Safe regardless of the caller's
        // CAS view — an already-applied event cannot overwrite anything.
        return { ok: true, duplicate: true, lastSequence: bucket.lastSequence };
      }
      nextState = applied.state;
    }

    // Bounds apply only to NEW growth; duplicates add nothing.
    if (bucket.eventCount >= limits.maxEventsPerMission) {
      return reject("mission_full", `mission ${missionId} is bounded at ${limits.maxEventsPerMission} events`);
    }
    if (canonicalJson(validated.value).length > limits.maxEventCanonicalBytes) {
      return reject("event_too_large", `event ${validated.value.eventId} exceeds the ${limits.maxEventCanonicalBytes}-byte canonical limit`);
    }
    if (bucket.eventCount === 0) {
      const activeMissions = [...buckets.values()].filter((candidate) => candidate.eventCount > 0).length;
      if (activeMissions >= limits.maxMissions) {
        return reject("too_many_missions", "store is bounded at " + limits.maxMissions + " missions");
      }
    }

    // CAS commit gate: the caller's view of history must match the store's.
    // The computed next state is committed only when the expectation holds,
    // so of two racing writers claiming the same expected sequence exactly
    // one is committed and the other observes stale_cas (its clone is
    // discarded — no silent lost writes).
    if (expectedLastSequence !== bucket.lastSequence) {
      return reject(
        "stale_cas",
        `expectedLastSequence ${expectedLastSequence} does not match the store's last applied ${bucket.lastSequence}`,
      );
    }

    const persisted = storage.appendEvents(missionId, [validated.value]);
    return persisted
      .then(() => {
        bucket.projection = nextState;
        bucket.lastSequence = validated.value.sequence;
        bucket.eventCount += 1;
        return { ok: true, duplicate: false, lastSequence: bucket.lastSequence } as AppendResult;
      })
      .catch((storageError: unknown): AppendResult => {
        return {
          ok: false,
          error: {
            code: "storage_write_failed",
            message: `event ${validated.value.eventId} passed validation but the storage adapter rejected the write: ${
              storageError instanceof Error ? storageError.message : String(storageError)
            }`,
          },
        };
      });
  }

  const store: MissionEventStore = {
    limits,
    append(missionId, event, expectedLastSequence) {
      // Create the bucket shell synchronously so concurrent callers serialize
      // behind the same queue, then await the serialized turn.
      if (!buckets.has(missionId)) {
        buckets.set(missionId, { projection: null, lastSequence: 0, eventCount: 0, queue: Promise.resolve() });
      }
      return performAppend(missionId, event, expectedLastSequence);
    },
    projection(missionId) {
      const bucket = buckets.get(missionId);
      if (bucket === undefined || bucket.projection === null) return null;
      return structuredClone(bucket.projection);
    },
    projectionCanonical(missionId) {
      const bucket = buckets.get(missionId);
      if (bucket === undefined || bucket.projection === null) return null;
      return canonicalJson(bucket.projection);
    },
    lastSequence(missionId) {
      const bucket = buckets.get(missionId);
      return bucket === undefined || bucket.eventCount === 0 ? null : bucket.lastSequence;
    },
    readEvents(missionId, page = {}) {
      const afterSequence = page.afterSequence ?? 0;
      const limit = page.limit ?? limits.maxEventsPerMission;
      return storage
        .readAll(missionId)
        .then((events) => events.filter((event) => event.sequence > afterSequence).slice(0, limit));
    },
    eventCount(missionId) {
      return buckets.get(missionId)?.eventCount ?? 0;
    },
    async replay(missionId) {
      const stored = await storage.readAll(missionId);
      if (stored.length === 0) {
        return { ok: false, error: { code: "unknown_entity", message: `mission ${missionId} has no stored events` } };
      }
      const rehydratedResult = rehydrate(stored);
      if (!rehydratedResult.ok) return rehydratedResult;
      const live = buckets.get(missionId)?.projection ?? null;
      const matchesLiveProjection =
        live !== null && canonicalJson(rehydratedResult.value.projection) === canonicalJson(live);
      return {
        ok: true,
        value: { rehydratedEvents: stored.length, matchesLiveProjection },
      };
    },
  };

  seeders.set(store, (seed) => {
    buckets.set(seed.missionId, {
      projection: seed.projection,
      lastSequence: seed.lastSequence,
      eventCount: seed.eventCount,
      queue: Promise.resolve(),
    });
  });

  return store;
}

/**
 * Reload-only bucket seeding for durable adapters: replay an already
 * persisted history through the reducer (never writing storage again) so a
 * restarted process resumes exactly where the files left off. Not an API
 * for new events — new events go through `append`.
 */
export function seedMissionBucket(
  store: MissionEventStore,
  seed: { readonly missionId: string; readonly projection: MissionProjection; readonly lastSequence: number; readonly eventCount: number },
): void {
  const seedBucket = seeders.get(store);
  if (seedBucket === undefined) {
    throw new Error("seedMissionBucket is only supported on stores created by createMissionEventStore");
  }
  seedBucket(seed);
}
