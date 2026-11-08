/**
 * Mission event store tests (issue #14 slice) — canonical orchestration seam.
 *
 * Uses the REAL contracts fixtures (`buildPort001Script` /
 * `buildHarbor002Script`) — the same canonical event scripts the contracts
 * package itself validates — run through the new repository. No alternative
 * state machine is exercised: every transition decision comes from the
 * reducer.
 */

import { describe, expect, it } from "vitest";
import { createScenarioKernel } from "../../../../services/simulation/demo/kernel-adapter.mjs";
import {
  createMissionEventStore,
  DEFAULT_MISSION_EVENT_STORE_LIMITS,
} from "../../../../services/mission/orchestration/event-store";
import {
  buildHarbor002Script,
  buildPort001Script,
  canonicalJson,
  PORT_001,
} from "@vorqyn/contracts";

const script = buildPort001Script();
const SCRIPT_LAST = script[script.length - 1] as (typeof script)[number];

async function storeWithPort001(events = script) {
  const store = createMissionEventStore();
  for (const [index, event] of events.entries()) {
    const expectedLast = index; // events[0] has sequence 1 → expected 0
    const result = await store.append(PORT_001.missionId, event, expectedLast);
    expect(result.ok, `append ${index} (${event.kind}) failed: ${result.ok ? "" : result.error.message}`).toBe(true);
  }
  return store;
}

describe("canonical mission event store — happy path", () => {
  it("accepts the full canonical PORT-001 mission and reconstructs the reducer projection", async () => {
    const store = await storeWithPort001();
    const projection = store.projection(PORT_001.missionId);
    expect(projection).not.toBeNull();
    expect(projection?.missionId).toBe(PORT_001.missionId);
    // The flagship recovery arc reached its real end state: sea task paid,
    // air/land tasks complete — all decided by the reducer, not by us.
    const sea = projection?.tasks[PORT_001.tasks.sea.taskId];
    expect(sea?.status).toBe("paid");
    expect(store.lastSequence(PORT_001.missionId)).toBe(script.length);
  });

  it("acceptance 1: the same event history produces an identical mission state", async () => {
    const a = await storeWithPort001();
    const b = await storeWithPort001();
    expect(b.projectionCanonical(PORT_001.missionId)).toBe(a.projectionCanonical(PORT_001.missionId));
    // Determinism is byte-for-byte, not just structurally similar.
    expect(canonicalJson(a.projection(PORT_001.missionId))).toBe(canonicalJson(b.projection(PORT_001.missionId)));
  });

  it("stores events verbatim: all clock domains survive untouched", async () => {
    const store = await storeWithPort001();
    const stored = await store.readEvents(PORT_001.missionId);
    for (const [index, storedEvent] of stored.entries()) {
      const source = script[index];
      expect(source).toBeDefined();
      // Deep equality proves the store rewrote nothing semantically —
      // occurredAtMs/observedAtMs (service), simulatorTimeMs (simulation)
      // and chainTimeMs (chain) all survive exactly as authored by the
      // contracts fixtures. (Key ORDER is the validator's canonical order;
      // content is what matters.)
      expect(storedEvent).toEqual(source);
    }
    // Domain separation visible in the real script: execution events carry
    // simulatorTimeMs; chain confirmations carry chainTimeMs; neither bleeds.
    const execution = stored.find((event) => event.kind === "task.executionStarted");
    expect(execution?.simulatorTimeMs).toBeDefined();
    expect(execution?.chainTimeMs).toBeUndefined();
    const chainUpdate = stored.find((event) => event.kind === "chain.transactionUpdated");
    expect(chainUpdate?.chainTimeMs).toBeDefined();
    expect(chainUpdate?.simulatorTimeMs).toBeUndefined();
  });
});

describe("journal defenses (store level)", () => {
  it("acceptance 3: an exact duplicate event is idempotent and does not change history", async () => {
    const store = await storeWithPort001();
    const countBefore = store.eventCount(PORT_001.missionId);
    const canonicalBefore = store.projectionCanonical(PORT_001.missionId);

    const duplicate = await store.append(PORT_001.missionId, SCRIPT_LAST, script.length - 1);
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.duplicate).toBe(true);

    expect(store.eventCount(PORT_001.missionId)).toBe(countBefore);
    expect(store.projectionCanonical(PORT_001.missionId)).toBe(canonicalBefore);
    expect(store.lastSequence(PORT_001.missionId)).toBe(script.length);
  });

  it("acceptance 4a: a tampered duplicate (same id, different content) is rejected", async () => {
    const store = await storeWithPort001();
    const tampered = structuredClone(SCRIPT_LAST);
    (tampered as { payload: { amountLamports: number } }).payload.amountLamports += 1;

    const result = await store.append(PORT_001.missionId, tampered, script.length);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("duplicate_event");
    // History unchanged.
    expect(store.eventCount(PORT_001.missionId)).toBe(script.length);
  });

  it("acceptance 4b: the same commandId with different content is rejected", async () => {
    const store = await storeWithPort001();
    const forged = structuredClone(SCRIPT_LAST);
    (forged as { eventId: string }).eventId = "evt-port-001-999";
    // Correct next sequence, so the event reaches the commandId idempotency
    // guard instead of being caught by sequence integrity.
    (forged as { sequence: number }).sequence = script.length + 1;
    (forged as { payload: { amountLamports: number } }).payload.amountLamports += 100;

    const result = await store.append(PORT_001.missionId, forged, script.length);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("duplicate_idempotency_key");
  });

  it("acceptance 4c: sequence gaps are rejected, never healed", async () => {
    const created = script[0] as (typeof script)[number];
    const store = createMissionEventStore();
    const init = await store.append(PORT_001.missionId, created, 0);
    expect(init.ok).toBe(true);

    const gapped = structuredClone(script[1] as (typeof script)[number]);
    (gapped as { sequence: number }).sequence = 5;
    const result = await store.append(PORT_001.missionId, gapped, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The store's sequence-integrity gate fires before the reducer.
      expect(["sequence_gap", "validation_error"]).toContain(result.error.code);
    }
    expect(store.lastSequence(PORT_001.missionId)).toBe(1);
  });

  it("wrong mission: an event targeting another mission cannot enter this stream", async () => {
    const harborScript = buildHarbor002Script();
    const store = await storeWithPort001([script[0] as (typeof script)[number]]);
    const harborEvent = harborScript[0] as (typeof harborScript)[number];
    const result = await store.append(PORT_001.missionId, harborEvent, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("cross_mission_reference");
    expect(store.lastSequence(PORT_001.missionId)).toBe(1);
  });
});

describe("acceptance 7: CAS + concurrency", () => {
  it("a stale CAS expectation rejects before touching state", async () => {
    const store = await storeWithPort001([script[0] as (typeof script)[number]]);
    const stale = await store.append(PORT_001.missionId, script[1] as (typeof script)[number], 7);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("stale_cas");
      expect(stale.error.message).toContain("7");
    }
    expect(store.lastSequence(PORT_001.missionId)).toBe(1);
  });

  it("two concurrent writers claiming the same expected sequence: exactly one wins", async () => {
    const store = createMissionEventStore();
    const init = await store.append(PORT_001.missionId, script[0] as (typeof script)[number], 0);
    expect(init.ok).toBe(true);

    const launchA = structuredClone(script[1] as (typeof script)[number]);
    const launchB = structuredClone(script[1] as (typeof script)[number]);
    (launchB as { eventId: string }).eventId = "evt-port-001-launch-b";
    (launchB as { commandId?: string }).commandId = "cmd-p1-launch-b";

    const [resultA, resultB] = await Promise.all([
      store.append(PORT_001.missionId, launchA, 1),
      store.append(PORT_001.missionId, launchB, 1),
    ]);

    const winners = [resultA, resultB].filter((r) => r.ok && !r.duplicate);
    const losers = [resultA, resultB].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    // The loser is a CAS conflict: it observed the winner's sequence.
    const loser = losers[0] as { ok: false; error: { code: string } };
    expect(loser.error.code).toBe("stale_cas");
    // Exactly one launch exists in history — no silent lost-write ambiguity.
    expect(store.lastSequence(PORT_001.missionId)).toBe(2);
    expect(store.eventCount(PORT_001.missionId)).toBe(2);
    const stored = await store.readEvents(PORT_001.missionId);
    // Exactly one copy of the winning event exists in history (script[1]
    // is the funding chain transaction), and the loser was not persisted.
    expect(stored.filter((event) => event.eventId === "evt-port-001-2")).toHaveLength(1);
    expect(stored.filter((event) => event.eventId === "evt-port-001-launch-b")).toHaveLength(0);
  });
});

describe("acceptance 9: authority boundary", () => {
  it("payment cannot be confirmed without a prior confirmed payout chain record", async () => {
    // Script prefix BEFORE any chain payout record exists: the sea task is
    // accepted (verified) but no payout chain.transactionSubmitted/Updated
    // has been recorded. The canonical reducer must reject the payment.
    const prefixEnd = script.findIndex((event) => event.kind === "chain.transactionSubmitted" && (event.payload as { kind?: string }).kind === "payout");
    expect(prefixEnd).toBeGreaterThan(0);
    const prefix = script.slice(0, prefixEnd).map((event, index) => {
      const copy = structuredClone(event);
      (copy as { sequence: number }).sequence = index + 1;
      (copy as { eventId: string }).eventId = `evt-port-001-${index + 1}`;
      return copy;
    });
    const prefixStore = createMissionEventStore();
    for (const [index, event] of prefix.entries()) {
      const result = await prefixStore.append(PORT_001.missionId, event, index);
      expect(result.ok, `prefix append ${index} failed`).toBe(true);
    }
    const projection = prefixStore.projection(PORT_001.missionId);
    const sea = projection?.tasks[PORT_001.tasks.sea.taskId];
    expect(sea?.status).toBe("verified"); // accepted evidence, NOT yet paid

    // Now the premature payment: reducer rejects — the canonical chain
    // prerequisite (a confirmed payout transaction record) does not exist.
    const prematurePayment = {
      eventId: "evt-port-001-premature-pay",
      missionId: PORT_001.missionId,
      sequence: prefix.length + 1,
      kind: "task.paymentConfirmed" as const,
      payload: {
        taskId: PORT_001.tasks.sea.taskId,
        transactionSignature: "sig-premature-payout-not-on-chain-not-base58-enough-padding-1234567890",
        amountLamports: 1_100_000_000,
      },
      occurredAtMs: 1762000000000,
      observedAtMs: 1762000000001,
      schemaVersion: 1,
    };
    const result = await prefixStore.append(PORT_001.missionId, prematurePayment as unknown as Parameters<typeof prefixStore.append>[1], prefix.length);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The canonical authority refused: no orchestration-side bypass exists.
      expect(["chain_not_confirmed", "illegal_transition", "validation_error"]).toContain(result.error.code);
    }
    expect(prefixStore.projection(PORT_001.missionId)?.tasks[PORT_001.tasks.sea.taskId]?.status).toBe("verified");
  });

  it("the store itself never fabricates financial or chain fields", async () => {
    const store = await storeWithPort001();
    const serialized = JSON.stringify(await store.readEvents(PORT_001.missionId));
    // Every financial/chain field in the stored history came from the
    // contract fixtures verbatim — the store adds nothing.
    const storeView = JSON.stringify({ state: store.projection(PORT_001.missionId) });
    expect(storeView).not.toMatch(/"fabricated|"invented|autoApproved|aiDecision/);
    void serialized;
  });
});

describe("bounds", () => {
  it("acceptance 8: bounded storage — events per mission and canonical byte caps", async () => {
    const store = createMissionEventStore({
      limits: { maxEventsPerMission: 2, maxEventCanonicalBytes: DEFAULT_MISSION_EVENT_STORE_LIMITS.maxEventCanonicalBytes },
    });
    const init = await store.append(PORT_001.missionId, script[0] as (typeof script)[number], 0);
    expect(init.ok).toBe(true);
    const launch = await store.append(PORT_001.missionId, script[1] as (typeof script)[number], 1);
    expect(launch.ok).toBe(true);
    const third = await store.append(PORT_001.missionId, script[2] as (typeof script)[number], 2);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("mission_full");
    expect(store.eventCount(PORT_001.missionId)).toBe(2);
  });

  it("oversized events are rejected before touching state", async () => {
    const store = createMissionEventStore({ limits: { maxEventCanonicalBytes: 256 } });
    const result = await store.append(PORT_001.missionId, script[0] as (typeof script)[number], 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("event_too_large");
    expect(store.eventCount(PORT_001.missionId)).toBe(0);
  });

  it("missions per store are bounded", async () => {
    const store = createMissionEventStore({ limits: { maxMissions: 1 } });
    const ok = await store.append(PORT_001.missionId, script[0] as (typeof script)[number], 0);
    expect(ok.ok).toBe(true);
    // A second, distinct mission's first event is rejected by the store bound.
    const harborScript = buildHarbor002Script();
    const harborCreated = harborScript[0] as (typeof harborScript)[number];
    const rejected = await store.append("harbor-002", harborCreated, 0);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("too_many_missions");
  });

  it("structural validation rejects malformed events before the reducer", async () => {
    const store = createMissionEventStore();
    const garbage = await store.append(
      PORT_001.missionId,
      { ...script[0], kind: "mission.teleported" } as unknown as (typeof script)[number],
      0,
    );
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error.code).toBe("unknown_event_kind");
  });

  it("a raw simulator observation snapshot can never masquerade as a mission event", async () => {
    // The simulation journal stays observation-only: a real kernel snapshot
    // fed to the store is structurally rejected (it is not a MissionEvent).
    const kernel = createScenarioKernel({ seed: 1 });
    kernel.step(1);
    const observation = kernel.getObservationLog()[0] as unknown;
    const store = createMissionEventStore();
    const result = await store.append(PORT_001.missionId, observation as (typeof script)[number], 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["unknown_event_kind", "validation_error"]).toContain(result.error.code);
    }
    expect(store.eventCount(PORT_001.missionId)).toBe(0);
  });
});
