/**
 * VORQYN mission event store — LOCAL durable file adapter (issue #14).
 *
 * Real, locally durable storage: one append-only JSONL file per mission
 * under the given directory. Every accepted event is fs.appendFile'd BEFORE
 * its acknowledgement, and `openMissionEventStoreFromFile` replays the
 * files through the contracts reducer on startup, so a restarted process
 * resumes exactly where the previous one stopped (tested).
 *
 * READ-FAILURE SEMANTICS (P1-D): only ENOENT (no history yet) is treated as
 * an empty mission. Every other read failure — EACCES, EIO, EISDIR, data
 * corruption at the OS layer — is a HARD ERROR: it propagates to callers
 * and aborts restart hydration, so a real stored mission can never be
 * silently mistaken for absent history (which would let a later mission
 * append into an unreadable log).
 *
 * DURABILITY LIMITATIONS (truthful): appendFile without fsync means a
 * process crash or power loss may lose recently acknowledged appends
 * (OS-buffered writes); multiple processes appending to the same directory
 * are NOT supported (no cross-process locking); there is no replication,
 * retention or backup. This is local filesystem durability for tests, a
 * demo host or a single-node deployment — NOT cloud/serverless persistence.
 * The `MissionEventLogStorage` seam exists precisely so a real database
 * adapter (Lane 1 persistence work) can replace this file without touching
 * the reducer or the store logic.
 */

import { mkdir, appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { MissionEvent } from "../../../packages/contracts/src/index";
import {
  createMissionEventStore,
  hydrateStoreFromStorage,
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

  async listMissions(): Promise<readonly string[]> {
    const entries = await readdir(this.dir);
    return entries.filter((name) => name.endsWith(".jsonl")).map((name) => name.replace(/\.jsonl$/, ""));
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
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        return []; // genuinely no history yet for this mission
      }
      // P1-D: every other read failure (permissions, I/O error, a directory
      // at the log path, ...) is a HARD error — never silently treated as
      // absent history.
      throw error;
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
 * replayed through the contracts reducer on startup (storage-derived
 * hydration, P1-A: state derives only from persisted validated events). A
 * stored mission whose log cannot be read fails the open loudly (P1-D).
 */
export async function openMissionEventStoreFromFile(
  dir: string,
  options: { readonly limits?: MissionEventStoreLimitsInput } = {},
): Promise<MissionEventStore> {
  await mkdir(dir, { recursive: true });
  const storage = new FileEventLogStorage(dir);
  const store = createMissionEventStore({ storage, limits: options.limits });
  await hydrateStoreFromStorage(store);
  return store;
}

/** Storage adapter constructor for callers that want the seam directly. */
export function createFileEventLogStorage(dir: string): MissionEventLogStorage {
  return new FileEventLogStorage(dir);
}
