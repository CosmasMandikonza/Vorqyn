/**
 * VORQYN mission event store — LOCAL durable file adapter (issue #14).
 *
 * Real, locally durable storage: one append-only JSONL file per mission
 * under the given directory. Every accepted event is fs.appendFile'd BEFORE
 * its acknowledgement, and `openMissionEventStoreFromFile` replays the
 * files through the contracts reducer on startup, so a restarted process
 * resumes exactly where the previous one stopped (tested).
 *
 * HONESTY BOUNDARY: this is local filesystem durability for tests, a demo
 * host or a single-node deployment. It is NOT cloud/serverless persistence,
 * has no replication, locking across machines, or retention guarantees, and
 * must never be described as production cloud storage. The `MissionEventLog
 * Storage` seam exists precisely so a real database adapter (Omar's Lane 1
 * persistence work) can replace this file without touching the reducer or
 * the store logic.
 *
 * File layout: <dir>/<missionId>.jsonl — one canonical-JSON event per line
 * (missionId is pattern-validated lowercase/digits/hyphens, so it is a safe
 * file name). The append-only format keeps restart replay trivially
 * verifiable: concatenating the lines and re-running the reducer must
 * reproduce the live projection exactly.
 */

import { mkdir, appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { rehydrate, type MissionEvent } from "../../../packages/contracts/src/index";
import {
  createMissionEventStore,
  seedMissionBucket,
  type MissionEventLogStorage,
  type MissionEventStore,
  type MissionEventStoreLimitsInput,
} from "./event-store";

const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** Append-only JSONL log: one canonical-JSON event per line, in order. */
class FileEventLogStorage implements MissionEventLogStorage {
  constructor(private readonly dir: string) {}

  private filePathFor(missionId: string): string {
    if (!MISSION_ID_PATTERN.test(missionId)) {
      // Path-safety guard: the mission id doubles as the file name.
      throw new Error(`missionId ${JSON.stringify(missionId)} does not satisfy the contracts ID rule`);
    }
    return path.join(this.dir, `${missionId}.jsonl`);
  }

  async appendEvents(missionId: string, events: readonly MissionEvent[]): Promise<void> {
    if (events.length === 0) return;
    const filePath = this.filePathFor(missionId);
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await appendFile(filePath, lines, "utf8");
  }

  async readAll(missionId: string): Promise<readonly MissionEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePathFor(missionId), "utf8");
    } catch {
      return []; // no history yet for this mission
    }
    const events: MissionEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      events.push(JSON.parse(line) as MissionEvent);
    }
    return events;
  }
}

/**
 * Open a store whose histories live in `dir`. Existing per-mission files are
 * replayed through the contracts reducer (deterministic restart recovery):
 * a store opened this way continues every mission exactly where the files
 * left off, with CAS expectations derived from the replayed sequences.
 */
export async function openMissionEventStoreFromFile(
  dir: string,
  options: { readonly limits?: MissionEventStoreLimitsInput } = {},
): Promise<MissionEventStore> {
  await mkdir(dir, { recursive: true });
  const storage = new FileEventLogStorage(dir);
  const store = createMissionEventStore({ storage, limits: options.limits });

  // Restart replay: rehydrate every persisted mission from its file.
  const fileNames = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  for (const fileName of fileNames) {
    const missionId = fileName.replace(/\.jsonl$/, "");
    const events = await storage.readAll(missionId);
    if (events.length === 0) continue;
    // Replay through the same contracts primitives the live path uses; the
    // first event must be mission.created (rehydrate enforces this).
    const rehydrated = rehydrate(events);
    if (!rehydrated.ok) {
      throw new Error(
        `durable history for mission ${missionId} failed replay: ${rehydrated.error.code}: ${rehydrated.error.message}`,
      );
    }
    seedMissionBucket(store, {
      missionId,
      projection: rehydrated.value.projection,
      lastSequence: rehydrated.value.projection.lastSequence,
      eventCount: events.length,
    });
  }
  return store;
}

/** Storage adapter constructor for callers that want the seam directly. */
export function createFileEventLogStorage(dir: string): MissionEventLogStorage {
  return new FileEventLogStorage(dir);
}
