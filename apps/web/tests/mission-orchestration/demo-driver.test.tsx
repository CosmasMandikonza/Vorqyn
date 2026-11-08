/**
 * Owner-reviewed demo driver for the canonical mission event store
 * (issue #14 slice — handed to the deployment lane as the concrete way to
 * exercise the REAL store end-to-end from one command).
 *
 * Run from apps/web:
 *   pnpm --filter @vorqyn/web test -- tests/mission-orchestration/demo-driver.test.tsx
 *
 * Every `EVENT` line is machine-readable JSON evidence: the operation, the
 * actual typed outcome from the store, and the authoritative reducer state
 * after it. This driver REUSES the shared contracts fixtures and the real
 * store — it contains no second reducer, no invented event ingestion and no
 * financial/verifier/chain authority. Synthetic observations (the guest
 * simulation journal) are NOT inputs here; only canonical MissionEvents are.
 *
 * AUTHENTICATED INGRESS (HTTP surface, auth, rate limits) IS OUT OF SCOPE
 * for this lane and remains BLOCKED — see services/mission/orchestration/
 * README.md.
 */

import { expect, it } from "vitest";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openMissionEventStoreFromFile } from "../../../../services/mission/orchestration/file-event-log";
import { buildPort001Script, PORT_001 } from "@vorqyn/contracts";

function driverLog(step: string, payload: unknown): void {
  console.log(`[DRIVER] ${step} ${JSON.stringify(payload)}`);
}

it("demo driver: canonical mission through the real store (evidence run)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vorqyn-driver-"));
  const store = await openMissionEventStoreFromFile(dir);
  const script = buildPort001Script();

  driverLog("store-opened", { dir, scenario: PORT_001.missionId, events: script.length });

  // --- pass 1: append the full canonical mission with CAS ---------------
  let lastSequence = 0;
  const outcomes: Array<{ eventId: string; kind: string; accepted: boolean; duplicate: boolean; code: string | null }> = [];
  for (const event of script) {
    const result = await store.append(PORT_001.missionId, event, lastSequence);
    if (result.ok) {
      lastSequence = result.lastSequence;
      outcomes.push({ eventId: event.eventId, kind: event.kind, accepted: true, duplicate: result.duplicate, code: null });
    } else {
      outcomes.push({ eventId: event.eventId, kind: event.kind, accepted: false, duplicate: false, code: result.error.code });
    }
  }
  for (const outcome of outcomes) {
    driverLog("EVENT", outcome);
  }
  const acceptedCount = outcomes.filter((o) => o.accepted && !o.duplicate).length;
  driverLog("PASS1-SUMMARY", { accepted: acceptedCount, lastSequence });

  // --- authority demonstration: premature payment is rejected by the reducer
  const premature = {
    eventId: "evt-driver-premature-pay",
    missionId: PORT_001.missionId,
    sequence: lastSequence + 1,
    kind: "task.paymentConfirmed" as const,
    payload: {
      taskId: PORT_001.tasks.sea.taskId,
      transactionSignature: "5".repeat(88), // valid base58, but never confirmed on-chain
      amountLamports: 1,
    },
    occurredAtMs: 1762000000999,
    observedAtMs: 1762000000999,
    schemaVersion: 1,
  };
  const prematureResult = await store.append(PORT_001.missionId, premature as unknown as Parameters<typeof store.append>[1], lastSequence);
  driverLog("PREMATURE-PAYMENT", { accepted: prematureResult.ok, outcome: prematureResult });

  // --- restart: reopen from the same directory (file durability) --------
  const reopened = await openMissionEventStoreFromFile(dir);
  const projection = reopened.projectionCanonical(PORT_001.missionId);
  driverLog("RESTART-PROJECTION", JSON.parse(projection ?? "null") === null ? null : {
    missionId: PORT_001.missionId,
    lifecycle: reopened.projection(PORT_001.missionId)?.lifecycle,
    lastSequence: reopened.lastSequence(PORT_001.missionId),
    seaTaskStatus: reopened.projection(PORT_001.missionId)?.tasks[PORT_001.tasks.sea.taskId]?.status,
  });

  // --- replay parity from the durable files ------------------------------
  const replay = await reopened.replay(PORT_001.missionId);
  driverLog("REPLAY", replay.ok ? { events: replay.value.rehydratedEvents, matchesLiveProjection: replay.value.matchesLiveProjection } : replay.error);

  // --- readback: durable file bytes --------------------------------------
  const stored = await reopened.readEvents(PORT_001.missionId);
  const firstLine = JSON.parse(await readFile(path.join(dir, `${PORT_001.missionId}.jsonl`), "utf8").then((raw) => raw.split("\n")[0] ?? "{}"));
  driverLog("STORED-BYTES-FIRST-EVENT", firstLine);
  driverLog("READBACK-COUNT", { stored: stored.length });

  // --- guards remain active after restart --------------------------------
  const guard = await reopened.append(PORT_001.missionId, premature as unknown as Parameters<typeof reopened.append>[1], lastSequence + 1);
  driverLog("GUARD-PREMATURE-AFTER-RESTART", { accepted: guard.ok, code: guard.ok ? null : guard.error.code });

  // --- chain_not_confirmed: payment with NO confirmed payout record -------
  // Prefix scenario: funding and the reassignment stay confirmed (escrow and
  // recovery authority work), but every PAYOUT chain transaction is
  // submitted-never-confirmed. The canonical confirmedChainRecord gate must
  // reject the payout on the unconfirmed ledger record.
  const prefixStore = await openMissionEventStoreFromFile(dir + "-prefix");
  const fundingSignature = (script[2] as { payload: { transactionSignature: string } }).payload.transactionSignature;
  const reassignmentSignature = (script[11] as { payload: { transactionSignature: string } }).payload.transactionSignature;
  const prefix = script.filter(
    (event) =>
      !(
        event.kind === "chain.transactionUpdated" &&
        (event.payload as { transactionSignature?: string }).transactionSignature !== fundingSignature &&
        (event.payload as { transactionSignature?: string }).transactionSignature !== reassignmentSignature
      ),
  ).map((event, index) => ({
    ...event,
    sequence: index + 1,
    eventId: "evt-prefix-" + String(index + 1).padStart(2, "0"),
  }));
  let prefixLast = 0;
  for (const event of prefix) {
    const result = await prefixStore.append(PORT_001.missionId, event as unknown as Parameters<typeof prefixStore.append>[1], prefixLast);
    if (result.ok) prefixLast = result.lastSequence;
    // Rejected air/land payments (chain_not_confirmed) are expected here;
    // the loop continues, mirroring a real ingestion stream.
  }

  // The canonical double-payment attack: reuse the sea payout signature
  // that WAS submitted but never confirmed in this prefix history.
  const submittedPayoutSig = prefix.find(
    (event) => event.kind === "chain.transactionSubmitted" && (event.payload as { kind?: string }).kind === "payout" && (event.payload as { taskId?: string }).taskId === PORT_001.tasks.sea.taskId,
  )?.payload as { transactionSignature: string } | undefined;
  assert(submittedPayoutSig !== undefined, "prefix kept the submitted sea payout record");
  const unconfirmedPayment = {
    eventId: "evt-driver-unconfirmed-pay",
    missionId: PORT_001.missionId,
    sequence: prefixLast + 1,
    kind: "task.paymentConfirmed" as const,
    payload: {
      taskId: PORT_001.tasks.sea.taskId,
      transactionSignature: submittedPayoutSig.transactionSignature,
      amountLamports: 1_100_000_000,
    },
    occurredAtMs: 1762000000900,
    observedAtMs: 1762000000900,
    schemaVersion: 1,
  };
  const unconfirmedResult = await prefixStore.append(PORT_001.missionId, unconfirmedPayment as unknown as Parameters<typeof prefixStore.append>[1], prefixLast);
  driverLog("CHAIN-NOT-CONFIRMED", { accepted: unconfirmedResult.ok, full: JSON.stringify(unconfirmedResult) });

  // --- the driver itself asserts the invariants (regression guard) -------
  const acceptedReal = outcomes.filter((o) => o.accepted && !o.duplicate);
  expect(acceptedReal.length, "every canonical event appends").toBe(script.length);
  expect(prematureResult.ok, "premature payment rejected by canonical authority").toBe(false);
  expect(unconfirmedResult.ok, "unconfirmed-chain payment rejected").toBe(false);
  if (!unconfirmedResult.ok) expect(unconfirmedResult.error.code).toBe("chain_not_confirmed");
  expect(replay.ok && replay.value.matchesLiveProjection, "replay matches live projection").toBe(true);
  expect(guard.ok, "guards hold after restart").toBe(false);
  expect(stored.length, "durable readback complete").toBe(script.length);
  void store;
}, 30000);
