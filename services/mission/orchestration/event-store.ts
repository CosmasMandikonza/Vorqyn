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
 * - append-only immutable history: accepted events are deep-frozen,
 *   persisted through the storage adapter BEFORE the acknowledgement, and
 *   never edited or reordered; readers receive the same frozen objects, so
 *   a caller cannot mutate accepted history (P1-C);
 * - CAS: the caller declares `expectedLastSequence`; a mismatch rejects
 *   with `stale_cas` before the computed next state is committed, so two
 *   racing writers cannot both claim the same version (per-mission queues
 *   serialize appends and the loser observes the winner's sequence);
 * - sequence integrity: `event.sequence` must be exactly
 *   `lastSequence + 1` — gaps (`validation_error` from the reducer) and
 *   regressions (`stale_cas`) are rejected, never healed;
 * - idempotency: the reducer's own rules apply — an exact duplicate event
 *   acknowledges `duplicate: true` WITHOUT changing history, a tampered
 *   duplicate and a reused `commandId` with different content are
 *   rejected;
 * - bounded storage: missions per store, events per mission and canonical
 *   bytes per event are all capped. EVERY allocated mission bucket counts
 *   against the missions cap — including buckets whose only appends were
 *   rejected or invalid (P1-B);
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

/**
 * Structural deep freeze: accepted events (and everything reachable from
 * them) become immutable at the storage boundary, so aliases handed out by
 * read interfaces cannot mutate committed history (P1-C).
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Storage seam
// ---------------------------------------------------------------------------

/**
 * Durable-storage seam. The in-memory adapter is the default (test/replay);
 * the file adapter in file-event-log.ts provides real local durability.
 * Implementations must append atomically per batch, return events in stored
 * order, and treat absent history as an empty list — every other read
 * failure must be thrown as a hard error (P1-D), never swallowed.
 */
export interface MissionEventLogStorage {
  /** Distinct mission keys that have a stored history. */
  listMissions(): Promise<readonly string[]>;
  /** Durably append the events, in order, to the mission's history. */
  appendEvents(missionId: string, events: readonly MissionEvent[]): Promise<void>;
  /** Read the full stored history, in stored order. */
  readAll(missionId: string): Promise<readonly MissionEvent[]>;
}

export class InMemoryMissionEventLogStorage implements MissionEventLogStorage {
  private readonly logs = new Map<string, MissionEvent[]>();

  async listMissions(): Promise<readonly string[]> {
    return [...this.logs.keys()];
  }

  async appendEvents(missionId: string, events: readonly MissionEvent[]): Promise<void> {
    // Freeze at the storage boundary: committed history is immutable (P1-C).
    const existing = this.logs.get(missionId);
    this.logs.set(missionId, [...(existing ?? []), ...events.map((event) => deepFreeze(event))]);
  }

  async readAll(missionId: string): Promise<readonly MissionEvent[]> {
    return [...(this.logs.get(missionId) ?? [])];
  }
}

// ---------------------------------------------------------------------------
// Append results
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
   * codes: stale_cas, cross_mission_reference, mission_full, event_too_large,
   * too_many_missions, storage_write_failed. */
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

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface MissionEventStore {
  readonly limits: MissionEventStoreLimits;
  /**
   * Append one contract-validated event to a mission's history.
   * `expectedLastSequence` is the caller's declared view of the last applied
   * sequence (0 for an empty mission); a mismatch rejects with `stale_cas`.
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
  /** Stored events, oldest first (paged). Events are frozen (P1-C). */
  readEvents(
    missionId: string,
    page?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<readonly MissionEvent[]>;
  /** Number of stored events for the mission. */
  eventCount(missionId: string): number;
  /**
   * Number of allocated mission buckets — every allocation counts against
   * `maxMissions`, including missions whose only appends were rejected or
   * invalid (P1-B).
   */
  allocatedMissionCount(): number;
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

// ---------------------------------------------------------------------------
// Storage-derived hydration (issue #14 CTO review P1-A)
// ---------------------------------------------------------------------------

/**
 * Per-store hydration callback. Registered by the factory; derives buckets
 * ONLY from persisted events read through the storage adapter and
 * re-validated by the contracts reducer (`rehydrate`). No caller-supplied
 * projection is ever trusted — that is the P1-A fix: the previous public
 * `seedMissionBucket(projection)` hook was removed entirely.
 */
const hydrators = new WeakMap<MissionEventStore, () => Promise<void>>();

async function hydrateStoreFromStorageImpl(
  storage: MissionEventLogStorage,
  buckets: Map<string, MissionBucket>,
): Promise<void> {
  const missionIds = await storage.listMissions();
  for (const missionId of missionIds) {
    const events = await storage.readAll(missionId);
    if (events.length === 0) continue;
    const rehydrated = rehydrate(events);
    if (!rehydrated.ok) {
      throw new Error(
        `durable history for mission ${missionId} failed replay: ${rehydrated.error.code}: ${rehydrated.error.message}`,
      );
    }
    // Cross-mission misbinding guard: the persisted projection's identity
    // must match the storage key it was found under.
    if (rehydrated.value.projection.missionId !== missionId) {
      throw new Error(
        `durable history under key ${missionId} contains mission ${rehydrated.value.projection.missionId} (cross-mission misbinding)`,
      );
    }
    // Persisted truth bypasses the new-growth bounds (every event was
    // validated at append time and is re-validated by rehydrate above).
    buckets.set(missionId, {
      projection: rehydrated.value.projection,
      lastSequence: rehydrated.value.projection.lastSequence,
      eventCount: events.length,
      queue: Promise.resolve(),
    });
  }
}

/**
 * Rebuild all mission buckets from the storage adapter's persisted history.
 * Derives state ONLY from validated persisted events (`rehydrate`) — there
 * is no parameter accepting caller-supplied projections (P1-A). Failures
 * are hard errors: a store never resumes from corrupted or misbound
 * history.
 */
export async function hydrateStoreFromStorage(store: MissionEventStore): Promise<void> {
  const hydrate = hydrators.get(store);
  if (hydrate === undefined) {
    throw new Error("hydrateStoreFromStorage is only supported on stores created by createMissionEventStore");
  }
  await hydrate();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

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

  function reject(code: string, message: string): AppendRejected {
    return { ok: false, error: { code, message } };
  }

  /** Run one append serialized behind the mission's queue. */
  function performAppend(missionId: string, event: MissionEvent, expectedLastSequence: number): Promise<AppendResult> {
    const existing = buckets.get(missionId);
    if (existing !== undefined) {
      const turn = existing.queue.then(() => appendTurn(missionId, event, expectedLastSequence));
      existing.queue = turn.catch(() => undefined);
      return turn;
    }

    // P1-B: allocation itself is bounded. A bucket is allocated for EVERY
    // new mission key — including missions whose first append turns out to
    // be rejected or invalid — so rejected attempts cannot be used to
    // allocate unbounded buckets later.
    if (buckets.size >= limits.maxMissions) {
      return Promise.resolve(
        reject("too_many_missions", `store is bounded at ${limits.maxMissions} mission buckets`),
      );
    }
    const bucket: MissionBucket = {
      projection: null,
      lastSequence: 0,
      eventCount: 0,
      queue: Promise.resolve(),
    };
    buckets.set(missionId, bucket);
    const turn = bucket.queue.then(() => appendTurn(missionId, event, expectedLastSequence));
    bucket.queue = turn.catch(() => undefined);
    return turn;
  }

  async function appendTurn(
    missionId: string,
    event: MissionEvent,
    expectedLastSequence: number,
  ): Promise<AppendResult> {
    const bucket = buckets.get(missionId);
    if (bucket === undefined) {
      return reject("validation_error", `mission bucket for ${missionId} disappeared (internal invariant)`);
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
          return reject("stale_cas", `caller expectation is stale: ${applied.error.message}`);
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

    // Freeze at the storage boundary: committed history is immutable (P1-C).
    const frozenEvent = deepFreeze(validated.value);
    try {
      await storage.appendEvents(missionId, [frozenEvent]);
    } catch (storageError: unknown) {
      return {
        ok: false,
        error: {
          code: "storage_write_failed",
          message: `event ${validated.value.eventId} passed validation but the storage adapter rejected the write: ${
            storageError instanceof Error ? storageError.message : String(storageError)
          }`,
        },
      };
    }
    bucket.projection = nextState;
    bucket.lastSequence = validated.value.sequence;
    bucket.eventCount += 1;
    return { ok: true, duplicate: false, lastSequence: bucket.lastSequence };
  }

  const store: MissionEventStore = {
    limits,
    append(missionId, event, expectedLastSequence) {
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
    async readEvents(missionId, page = {}) {
      const afterSequence = page.afterSequence ?? 0;
      const limit = page.limit ?? limits.maxEventsPerMission;
      const events = await storage.readAll(missionId);
      return events.filter((event) => event.sequence > afterSequence).slice(0, limit);
    },
    allocatedMissionCount() {
      return buckets.size;
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

  hydrators.set(store, () => hydrateStoreFromStorageImpl(storage, buckets));

  return store;
}
