/**
 * VQ-12 chain-client tests. PDA addresses and account bytes below are
 * RUST-GENERATED fixtures (find_program_address + Anchor try_serialize in
 * the program's LiteSVM environment) — a genuine cross-implementation
 * check, not a self-referential recomputation.
 */

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { missionPda, taskPda, vaultPda, registryPda, missionAddresses } from "./pdas";
import { decodeMission, decodeTask } from "./codec";
import {
  InMemoryTxStore,
  isTerminal,
  newTxRecord,
  reconcile,
  toChainAttestationExpirySeconds,
  transition,
} from "./lifecycle";
import { fundMissionIx, initializeMissionIx, verifyAndClaimIx } from "./instructions";
import { sha256 } from "@noble/hashes/sha2.js";

function ixDiscriminatorForTest(name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`global:${name}`)).subarray(0, 8);
}
import { explorerTxUrl } from "./config";

import fixtures from "./fixtures-chain.json";
const OWNER = new PublicKey(fixtures.owner);
const MISSION_PDA = fixtures.missionPda;
const TASK_PDA = fixtures.taskPda;
const VAULT_PDA = fixtures.vaultPda;
const REGISTRY_PDA = "4NAwAQS1UzjMZCrewZmvJ8HB97S5UkVzR2qurfkWVnu6";

// Rust try_serialize output (discriminator + borsh fields).
const MISSION_HEX = fixtures.missionHex;
const TASK_HEX = fixtures.taskHex;

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));

describe("PDA derivation (cross-verified against Rust fixtures)", () => {
  it("derives the Rust-computed mission/task/vault/registry addresses", () => {
    const mission = missionPda(OWNER, "port-001");
    expect(mission.ok).toBe(true);
    if (!mission.ok) return;
    expect(mission.value.address.toBase58()).toBe(MISSION_PDA);
    const task = taskPda(mission.value.address, "task-sea-survey");
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    expect(task.value.address.toBase58()).toBe(TASK_PDA);
    expect(vaultPda(mission.value.address).toBase58()).toBe(VAULT_PDA);
    expect(registryPda().toBase58()).toBe(REGISTRY_PDA);
  });

  it("rejects invalid IDs before deriving (shared contracts rule)", () => {
    expect(missionPda(OWNER, "BAD_ID").ok).toBe(false);
    expect(taskPda(OWNER, "no").ok).toBe(false);
  });

  it("bundles a full mission address set", () => {
    const set = missionAddresses(OWNER, "port-001", ["task-sea-survey"]);
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.value.mission.toBase58()).toBe(MISSION_PDA);
    expect(set.value.tasks[0]?.address.toBase58()).toBe(TASK_PDA);
    expect(set.value.vault.toBase58()).toBe(VAULT_PDA);
  });
});

describe("account decoding (Rust-serialized fixtures)", () => {
  it("decodes a Mission account byte-for-byte", () => {
    const m = decodeMission(hexToBytes(MISSION_HEX));
    expect(m.owner.toBase58()).toBe(OWNER.toBase58());
    expect(m.missionId).toBe("port-001");
    expect(m.fundedLamports).toBe(3_000_000_001n);
    expect(m.remainingLamports).toBe(2_900_000_001n);
    expect(m.reservedLamports).toBe(100_000_000n);
    expect(m.status).toBe("Active");
    expect(m.expiry).toBe(4_102_444_800n);
    expect(m.bump).toBe(255);
  });

  it("decodes a Task account with paid markers", () => {
    const t = decodeTask(hexToBytes(TASK_HEX));
    expect(t.mission.toBase58()).toBe(MISSION_PDA);
    expect(t.taskId).toBe("task-sea-survey");
    expect(t.taskKind).toBe("Sea");
    expect(t.budgetLamports).toBe(500_000_000n);
    expect(t.currentAssignmentVersion).toBe(2n);
    expect(t.currentOperator?.toBase58()).toBe(fixtures.operator);
    expect(t.rewardLamports).toBe(400_000_000n);
    expect(t.status).toBe("Assigned");
    expect(t.paidVersion).toBe(1n);
    expect(t.evidenceDigest).toBeNull();
  });

  it("rejects data with the wrong discriminator", () => {
    expect(() => decodeMission(hexToBytes(TASK_HEX))).toThrow(/discriminator/);
  });
});

describe("truthful transaction lifecycle", () => {
  const base = () =>
    newTxRecord({
      id: "tx-1",
      kind: "funding",
      missionId: "port-001",
      amountLamports: 3_000_000_000,
    });

  it("wallet popup alone never advances beyond awaiting_signature", () => {
    const r = base();
    expect(r.state).toBe("awaiting_signature");
    expect(isTerminal(r.state)).toBe(false);
  });

  it("happy path: submitted → processed → confirmed → finalized", () => {
    let r = transition(base(), "submitted", "wallet");
    r.signature = "Sig1111111111111111111111111111111111111111111111111111111111111111";
    r = transition(r, "processed", "rpc");
    r = transition(r, "confirmed", "rpc");
    r = transition(r, "finalized", "rpc");
    expect(r.confirmedAtMs).toBeDefined();
    expect(isTerminal(r.state)).toBe(true);
    // terminal freezes: no further transitions
    expect(() => transition(r, "unknown", "client")).toThrow(/illegal/);
  });

  it("reject transitions are terminal; duplicate transitions are no-ops", () => {
    let r = transition(base(), "submitted", "wallet");
    r = transition(r, "rejected", "rpc", "user declined");
    expect(isTerminal(r.state)).toBe(true);
    const same = transition(r, "rejected", "rpc");
    expect(same.history.length).toBe(r.history.length);
  });

  it("reconcile queries the chain before deciding — timeout stays unknown, never failed", async () => {
    let r = transition(base(), "submitted", "wallet");
    r.signature = "Sig1111111111111111111111111111111111111111111111111111111111111111";
    // RPC unreachable → unknown
    const unreachable = { getSignatureStatus: async () => { throw new Error("429"); } };
    r = await reconcile(r, unreachable);
    expect(r.state).toBe("unknown");
    // unseen signature → still unknown (not rejected!)
    const unseen = { getSignatureStatus: async () => null };
    r = await reconcile(r, unseen);
    expect(r.state).toBe("unknown");
    // chain later confirms → confirmed with slot recorded
    const confirmed = {
      getSignatureStatus: async () => ({ confirmationStatus: "confirmed" as const, slot: 251000002, err: null }),
    };
    r = await reconcile(r, confirmed);
    expect(r.state).toBe("confirmed");
    expect(r.slot).toBe(251000002);
  });

  it("reconcile surfaces on-chain failure as rejected", async () => {
    let r = transition(base(), "submitted", "wallet");
    r.signature = "Sig1111111111111111111111111111111111111111111111111111111111111111";
    const failed = {
      getSignatureStatus: async () => ({ confirmationStatus: "processed" as const, err: { InstructionError: [0, "Custom(6003)"] } }),
    };
    r = await reconcile(r, failed);
    expect(r.state).toBe("rejected");
  });

  it("persists and reloads records through the store seam", () => {
    const store = new InMemoryTxStore();
    const r = transition(base(), "submitted", "wallet");
    r.signature = "Sig2222222222222222222222222222222222222222222222222222222222222222";
    store.save(r);
    const loaded = store.load().find((x) => x.id === "tx-1");
    expect(loaded?.state).toBe("submitted");
    expect(loaded?.signature).toBe(r.signature);
  });

  it("ms→s attestation expiry conversion matches the verifier service contract", () => {
    expect(toChainAttestationExpirySeconds(1_762_000_000_999)).toBe(1_762_000_000);
    expect(() => toChainAttestationExpirySeconds(0)).toThrow();
  });
});

describe("instruction builders", () => {
  it("initialize_mission carries the Anchor discriminator + borsh args", () => {
    const ix = initializeMissionIx(OWNER, "port-001", OWNER, 4_102_444_800);
    const disc = ixDiscriminatorForTest("initialize_mission");
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(Array.from(disc));
    expect(ix.keys.length).toBe(6);
  });

  it("verify_and_claim wires all nine accounts in context order", () => {
    const ix = verifyAndClaimIx(OWNER, OWNER, OWNER, new PublicKey(MISSION_PDA), OWNER, {
      taskId: "task-sea-survey",
      expectedAssignmentVersion: 2,
      evidenceDigest: new Uint8Array(32).fill(0x5a),
      policyVersion: 1,
      attestationExpiryUnixSeconds: 1_762_000_600,
    });
    expect(ix.keys.length).toBe(9);
    expect(ix.keys[1]?.isSigner).toBe(true); // verifier co-signs
    expect(ix.keys[7]?.isWritable).toBe(true); // payout wallet is credited
  });
});

describe("lamport argument validation (review finding 3)", () => {
  it("rejects unsafe numbers before serialization", () => {
    expect(() => fundMissionIx(OWNER, new PublicKey(MISSION_PDA), 1.5)).toThrow(/unsafe lamport/);
    expect(() => fundMissionIx(OWNER, new PublicKey(MISSION_PDA), 2 ** 53)).toThrow(/unsafe lamport/);
    expect(() => fundMissionIx(OWNER, new PublicKey(MISSION_PDA), 3_000_000_000)).not.toThrow();
    expect(() => fundMissionIx(OWNER, new PublicKey(MISSION_PDA), 3_000_000_000n)).not.toThrow();
  });
});

describe("explorer links are cluster-truthful", () => {
  it("always names the cluster in the URL", () => {
    expect(explorerTxUrl("abc123", "devnet")).toContain("cluster=devnet");
    expect(explorerTxUrl("abc123", "localnet")).toContain("cluster=localnet");
  });
});

describe("CTO review P1-A: reconciliation must accept real RPC shapes monotonically", () => {
  const SIG = "Sig3333333333333333333333333333333333333333333333333333333333333333";
  const base = () =>
    newTxRecord({ id: "tx-cto-a", kind: "funding", missionId: "port-001", amountLamports: 1_000_000 });
  const submittedRecord = () => {
    const r = transition(base(), "submitted", "wallet");
    r.signature = SIG;
    return r;
  };

  it("submitted → finalized directly (first readable RPC says finalized)", async () => {
    let r = submittedRecord();
    const finalized = { getSignatureStatus: async () => ({ confirmationStatus: "finalized" as const, slot: 42, err: null }) };
    r = await reconcile(r, finalized);
    expect(r.state).toBe("finalized");
    expect(r.slot).toBe(42);
    expect(r.confirmedAtMs).toBeDefined();
  });

  it("unknown → finalized directly (delayed first observation)", async () => {
    let r = transition(submittedRecord(), "unknown", "client", "rpc timeout");
    const finalized = { getSignatureStatus: async () => ({ confirmationStatus: "finalized" as const, slot: 43, err: null }) };
    r = await reconcile(r, finalized);
    expect(r.state).toBe("finalized");
  });

  it("a stale processed response never regresses or throws on a confirmed record", async () => {
    let r = transition(submittedRecord(), "confirmed", "rpc");
    const stale = { getSignatureStatus: async () => ({ confirmationStatus: "processed" as const, slot: 9, err: null }) };
    expect(async () => { r = await reconcile(r, stale); }).not.toThrow();
    r = await reconcile(r, stale);
    expect(r.state).toBe("confirmed"); // monotonic knowledge preserved
    expect(r.slot).not.toBe(9); // stale slot not adopted
  });

  it("processed → finalized directly", async () => {
    let r = transition(submittedRecord(), "processed", "rpc");
    const finalized = { getSignatureStatus: async () => ({ confirmationStatus: "finalized" as const, slot: 44, err: null }) };
    r = await reconcile(r, finalized);
    expect(r.state).toBe("finalized");
  });

  it("an RPC exception (429/timeout) does NOT demote a confirmed record to unknown", async () => {
    // Failing-first pre-fix: the catch branch unconditionally transitioned
    // to unknown, discarding already-observed confirmation + slot. An RPC
    // error is absence of knowledge, never evidence of non-finality.
    let r = transition(submittedRecord(), "confirmed", "rpc");
    r.slot = 777;
    const exploding = { getSignatureStatus: async () => { throw new Error("429 Too Many Requests"); } };
    r = await reconcile(r, exploding);
    expect(r.state).toBe("confirmed"); // preserved
    expect(r.slot).toBe(777); // preserved
  });

  it("an RPC exception on a genuinely unconfirmed (submitted) record still yields unknown", async () => {
    let r = submittedRecord();
    const exploding = { getSignatureStatus: async () => { throw new Error("timeout"); } };
    r = await reconcile(r, exploding);
    expect(r.state).toBe("unknown");
  });

});
