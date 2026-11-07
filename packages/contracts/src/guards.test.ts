import { describe, expect, it } from "vitest";

import {
  asEventId,
  asLamports,
  asMissionId,
  asSolanaPublicKey,
  asTransactionSignature,
  addLamports,
  subLamports,
  CONTRACTS_SCHEMA_VERSION,
} from "./core";
import { validateMissionEvent, validateTaskAssignedPayload } from "./events";

describe("entity ID guards", () => {
  it.each(["port-001", "task-sea-survey", "a1b", "org-9x", "x".repeat(32)])(
    "accepts well-formed id %s",
    (id) => {
      expect(asMissionId(id).ok).toBe(true);
      expect(asEventId(id).ok).toBe(true);
    },
  );

  it.each(["", "A-upper", "bad_underscore", "-leading", "way-too-long-identifier-string-over-32-chars", "a"])(
    "rejects malformed id %s",
    (id) => {
      expect(asMissionId(id).ok).toBe(false);
    },
  );
});

describe("lamport guards", () => {
  it("accepts non-negative safe integers only", () => {
    expect(asLamports(0).ok).toBe(true);
    expect(asLamports(1_100_000_000).ok).toBe(true);
    expect(asLamports(-1).ok).toBe(false);
    expect(asLamports(1.5).ok).toBe(false);
    expect(asLamports(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false);
    expect(asLamports(Number.NaN).ok).toBe(false);
  });

  it("checked arithmetic refuses overflow and negative balances", () => {
    expect(addLamports(Number.MAX_SAFE_INTEGER as never, 1 as never).ok).toBe(false);
    expect(subLamports(5 as never, 6 as never).ok).toBe(false);
    expect(subLamports(6 as never, 5 as never)).toEqual({ ok: true, value: 1 });
  });
});

describe("key and signature guards", () => {
  it("accepts base58 public keys of the right length", () => {
    // Note: base58 excludes 0, O, I and l — fixture keys avoid them.
    expect(asSolanaPublicKey("VorQynTestPayKeyA11111111111111111111111111").ok).toBe(true);
    expect(asSolanaPublicKey("short").ok).toBe(false);
    expect(asSolanaPublicKey("0OIl-invalid-base58-chars-00000000000000000000").ok).toBe(false);
  });

  it("signatures require the longer base58 form (87-88 chars), not pubkey length", () => {
    const signature = "VQsigFundingTx" + "1".repeat(74); // 88 chars
    expect(asTransactionSignature(signature).ok).toBe(true);
    expect(asTransactionSignature("VQsigFundingTx111").ok).toBe(false); // too short
    expect(asTransactionSignature(signature + "!").ok).toBe(false); // non-base58
  });
});

describe("mission event envelope validation", () => {
  const baseEvent = {
    eventId: "evt-test-1",
    missionId: "port-001",
    sequence: 1,
    kind: "mission.launched",
    payload: {},
    occurredAtMs: 1_762_000_000_000,
    observedAtMs: 1_762_000_010_000,
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
  };

  it("accepts a well-formed envelope", () => {
    const result = validateMissionEvent(baseEvent);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown event kinds without partial interpretation", () => {
    const result = validateMissionEvent({ ...baseEvent, kind: "mission.teleported" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_event_kind");
  });

  it("rejects future schema versions explicitly", () => {
    const result = validateMissionEvent({ ...baseEvent, schemaVersion: CONTRACTS_SCHEMA_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported_schema_version");
  });

  it("rejects malformed payloads instead of runtime-casting them", () => {
    const result = validateTaskAssignedPayload({ taskId: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("rejects non-integer and negative clock values", () => {
    expect(validateMissionEvent({ ...baseEvent, occurredAtMs: 1.5 }).ok).toBe(false);
    expect(validateMissionEvent({ ...baseEvent, observedAtMs: -3 }).ok).toBe(false);
  });

  it("keeps clock domains separate: simulatorTimeMs only on sim-origin events", () => {
    const result = validateMissionEvent({ ...baseEvent, simulatorTimeMs: 5_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("clock_domain_violation");
  });

  it("keeps clock domains separate: chainTimeMs only on chain events", () => {
    const result = validateMissionEvent({ ...baseEvent, chainTimeMs: 1_762_000_000_500 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("clock_domain_violation");
  });

  it("rejects sequence 0 and non-integer sequences", () => {
    expect(validateMissionEvent({ ...baseEvent, sequence: 0 }).ok).toBe(false);
    expect(validateMissionEvent({ ...baseEvent, sequence: 1.5 }).ok).toBe(false);
  });
});
