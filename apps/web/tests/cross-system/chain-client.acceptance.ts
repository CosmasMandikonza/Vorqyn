/** Connection checks against the actual owner module when available; RPC replies here are test doubles, never chain receipts. */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "node:path";
import { toChainAttestationExpirySeconds as verifierExpiry } from "../../../../services/verifier/src/attestation";
const target = process.env.INTEGRATION_TARGET_ROOT!;
const load = () =>
  import(resolve(target, "packages/chain-client/src/lifecycle.ts"));
let client: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  client = await load();
});
function submitted() {
  const record = client.newTxRecord({
    id: "qa-tx",
    kind: "payout",
    missionId: "qa-mission-a",
    taskId: "qa-task",
    assignmentVersion: 2,
    signature: "QA-ONLY-NOT-A-CHAIN-SIGNATURE",
  });
  return client.transition(record, "submitted", "wallet");
}
it("unseen submitted signature becomes unknown, never paid or confirmed", async () => {
  const result = await client.reconcile(submitted(), {
    getSignatureStatus: async () => null,
  });
  expect(result.state).toBe("unknown");
  expect(result.confirmedAtMs).toBeUndefined();
});
it("confirmed knowledge and slot survive an RPC outage", async () => {
  const record = client.transition(submitted(), "confirmed", "rpc");
  record.slot = 42;
  const result = await client.reconcile(record, {
    getSignatureStatus: async () => {
      throw new Error("QA RPC outage");
    },
  });
  expect(result.state).toBe("confirmed");
  expect(result.slot).toBe(42);
});
it("first observed finalized status is accepted without intermediate fabricated confirmations", async () => {
  const result = await client.reconcile(submitted(), {
    getSignatureStatus: async () => ({
      confirmationStatus: "finalized",
      slot: 43,
      err: null,
    }),
  });
  expect(result.state).toBe("finalized");
  expect(result.slot).toBe(43);
  expect(result.history.map((h: { state: string }) => h.state)).not.toContain(
    "confirmed",
  );
});
it("wallet awaiting signature cannot be promoted by a client toast", () => {
  const record = client.newTxRecord({
    id: "qa-await",
    kind: "payout",
    missionId: "qa-mission-a",
  });
  expect(() => client.transition(record, "confirmed", "client")).toThrow();
});
it("chain and verifier use the same explicit ms→seconds expiry boundary", () => {
  for (const value of [1762000000000, 1762000000999, 1762000001000])
    expect(client.toChainAttestationExpirySeconds(value)).toBe(
      verifierExpiry(value),
    );
});
