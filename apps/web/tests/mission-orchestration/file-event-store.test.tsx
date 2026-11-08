/**
 * Durable file-backed mission event store tests (issue #14 slice).
 *
 * Proves REAL local durability with actual files: append events, "restart"
 * by reopening the store from the same directory, and verify the replayed
 * projection is byte-identical and continues seamlessly. Also proves the
 * honesty boundary: this is LOCAL filesystem durability, not cloud.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openMissionEventStoreFromFile } from "../../../../services/mission/orchestration/file-event-log";
import { createMissionEventStore } from "../../../../services/mission/orchestration/event-store";
import { buildHarbor002Script, buildPort001Script, PORT_001 } from "@vorqyn/contracts";

const script = buildPort001Script();

describe("file-backed durable store", () => {
  it("restart replay: a reopened store continues the mission exactly where the files left off", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-orch-"));
    try {
      // --- session 1: append the first half of the canonical mission ---
      const session1 = await openMissionEventStoreFromFile(dir);
      for (const [index, event] of script.slice(0, 16).entries()) {
        const result = await session1.append(PORT_001.missionId, event, index);
        expect(result.ok, `session1 append ${index} failed`).toBe(true);
      }
      const projectionBeforeRestart = session1.projectionCanonical(PORT_001.missionId);
      expect(projectionBeforeRestart).not.toBeNull();
      const seaBefore = session1.projection(PORT_001.missionId)?.tasks[PORT_001.tasks.sea.taskId];
      expect(seaBefore?.status).toBe("verified"); // mid-mission: sonar evidence accepted, payout not yet confirmed

      // --- restart: reopen from the same directory (files, not memory) ---
      const session2 = await openMissionEventStoreFromFile(dir);
      const projectionAfterRestart = session2.projectionCanonical(PORT_001.missionId);
      expect(projectionAfterRestart).toBe(projectionBeforeRestart);
      expect(session2.lastSequence(PORT_001.missionId)).toBe(16);

      // --- continue the mission in the restarted store ---
      for (const [offset, event] of script.slice(16).entries()) {
        const expectedLast = 16 + offset;
        const result = await session2.append(PORT_001.missionId, event, expectedLast);
        expect(result.ok, `session2 append ${expectedLast} failed: ${result.ok ? "" : result.error.message}`).toBe(true);
      }
      expect(session2.projection(PORT_001.missionId)?.tasks[PORT_001.tasks.sea.taskId]?.status).toBe("paid");

      // --- the files themselves are the durable record (append-only JSONL) ---
      const fileRaw = await readFile(path.join(dir, `${PORT_001.missionId}.jsonl`), "utf8");
      const lines = fileRaw.split("\n").filter((line) => line.trim().length > 0);
      expect(lines).toHaveLength(script.length);
      // Line 17 of the file (index 16) is the post-restart continuation event.
      expect(JSON.parse(lines[16] as string)).toEqual(script[16]);

      // --- full replay from storage matches the live projection ---
      const replay = await session2.replay(PORT_001.missionId);
      expect(replay.ok).toBe(true);
      if (replay.ok) {
        expect(replay.value.rehydratedEvents).toBe(script.length);
        expect(replay.value.matchesLiveProjection).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("two missions persist as separate files and never contaminate each other", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-orch-iso-"));
    try {
      const store = await openMissionEventStoreFromFile(dir);
      const portScript = buildPort001Script();
      const harborScript = buildHarbor002Script();
      for (const [index, event] of portScript.slice(0, 4).entries()) {
        const result = await store.append(PORT_001.missionId, event, index);
        expect(result.ok).toBe(true);
      }
      for (const [index, event] of harborScript.slice(0, 3).entries()) {
        const result = await store.append("harbor-002", event, index);
        expect(result.ok).toBe(true);
      }
      // Isolated projections across a restart.
      const reopened = await openMissionEventStoreFromFile(dir);
      expect(reopened.lastSequence(PORT_001.missionId)).toBe(4);
      expect(reopened.lastSequence("harbor-002")).toBe(3);
      expect(reopened.projection(PORT_001.missionId)?.missionId).toBe(PORT_001.missionId);
      expect(reopened.projection("harbor-002")?.missionId).toBe("harbor-002");
      const portFile = await readFile(path.join(dir, `${PORT_001.missionId}.jsonl`), "utf8");
      expect(portFile).not.toContain("harbor-002");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a corrupted durable history fails replay loudly instead of continuing silently", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-orch-corrupt-"));
    try {
      const store = await openMissionEventStoreFromFile(dir);
      const firstTwo = script.slice(0, 2);
      for (const [index, event] of firstTwo.entries()) {
        const result = await store.append(PORT_001.missionId, event, index);
        expect(result.ok).toBe(true);
      }
      // Simulate on-disk tampering: swap the second event's payload in the file.
      const filePath = path.join(dir, `${PORT_001.missionId}.jsonl`);
      const raw = await readFile(filePath, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      const tampered = JSON.parse(lines[1] as string);
      (tampered as { payload: Record<string, unknown> }).payload = {
        transactionSignature: (tampered.payload as { transactionSignature: string }).transactionSignature,
        status: "finalized",
        slot: 999_999_999,
      };
      lines[1] = JSON.stringify(tampered);
      await import("node:fs/promises").then((fs) => fs.writeFile(filePath, lines.join("\n") + "\n", "utf8"));

      // Restart must refuse: the tampered chain confirmation is not a legal
      // history (status regression) — silent continuation is the failure mode
      // this guard exists to prevent.
      await expect(openMissionEventStoreFromFile(dir)).rejects.toThrow(/failed replay/);
      void store;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an in-memory store and a file store produce identical projections for the same history", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-orch-parity-"));
    try {
      const fileStore = await openMissionEventStoreFromFile(dir);
      for (const [index, event] of script.slice(0, 12).entries()) {
        const result = await fileStore.append(PORT_001.missionId, event, index);
        expect(result.ok).toBe(true);
      }
      const memoryStore = createMissionEventStore();
      for (const [index, event] of script.slice(0, 12).entries()) {
        const result = await memoryStore.append(PORT_001.missionId, event, index);
        expect(result.ok).toBe(true);
      }
      expect(fileStore.projectionCanonical(PORT_001.missionId)).toBe(
        memoryStore.projectionCanonical(PORT_001.missionId),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CTO review regression test (PR #54 re-review) — added BEFORE the fix.
// ---------------------------------------------------------------------------

import { mkdir as fsMkdir } from "node:fs/promises";

describe("review P1-D: read failures other than ENOENT are hard errors", () => {
  it("an unreadable mission log is never silently treated as absent history", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-orch-locked-"));
    try {
      const store = await openMissionEventStoreFromFile(dir);
      const first = await store.append(PORT_001.missionId, script[0] as never, 0);
      expect(first.ok).toBe(true);
      const second = await store.append(PORT_001.missionId, script[1] as never, 1);
      expect(second.ok).toBe(true);

      // Simulate a non-ENOENT read failure (EACCES/EIO class) portably:
      // replace the JSONL file with a DIRECTORY at the same path.
      await rm(path.join(dir, `${PORT_001.missionId}.jsonl`));
      await fsMkdir(path.join(dir, `${PORT_001.missionId}.jsonl`));

      // Readback must be a hard failure — not a silent empty history.
      await expect(store.readEvents(PORT_001.missionId)).rejects.toThrow();

      // An append against an unreadable log is never acknowledged.
      const attempted = await store.append(PORT_001.missionId, script[2] as never, 2);
      expect(attempted.ok).toBe(false);
      if (!attempted.ok) expect(attempted.error.code).toBe("storage_write_failed");

      // Restart hydration must fail loudly instead of treating the mission
      // as absent (which would allow a later mission to reuse its log path).
      await expect(openMissionEventStoreFromFile(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
